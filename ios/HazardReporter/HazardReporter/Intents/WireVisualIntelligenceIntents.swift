import AppIntents
import CoreGraphics
import CoreVideo
import UIKit

#if canImport(VisualIntelligence)
import VisualIntelligence
#endif

/// App entity surfaced in system Visual Intelligence for outdoor wire hazards.
struct WireHazardEntity: AppEntity, Identifiable {
    static var typeDisplayRepresentation = TypeDisplayRepresentation(name: "Outside Wire Hazard")
    static var defaultQuery = WireHazardEntityQuery()

    var id: String
    var label: WireVisualLabel
    var confidence: Double
    var summary: String

    var displayRepresentation: DisplayRepresentation {
        DisplayRepresentation(
            title: "\(label.title)",
            subtitle: "\(summary)",
            image: .init(systemName: label.isReportableWireHazard ? "bolt.trianglebadge.exclamationmark" : "checkmark.circle")
        )
    }
}

struct WireHazardEntityQuery: EntityQuery {
    func entities(for identifiers: [WireHazardEntity.ID]) async throws -> [WireHazardEntity] {
        WireHazardCatalog.shared.entities.filter { identifiers.contains($0.id) }
    }

    func suggestedEntities() async throws -> [WireHazardEntity] {
        WireHazardCatalog.shared.entities
    }
}

/// In-memory catalog so Visual Intelligence OpenIntent can resolve entities after a search.
final class WireHazardCatalog: @unchecked Sendable {
    static let shared = WireHazardCatalog()
    private let lock = NSLock()
    private var storage: [WireHazardEntity] = []

    var entities: [WireHazardEntity] {
        lock.lock(); defer { lock.unlock() }
        return storage
    }

    func replace(with entities: [WireHazardEntity]) {
        lock.lock(); defer { lock.unlock() }
        storage = entities
    }
}

struct OpenWireHazardIntent: OpenIntent {
    static var title: LocalizedStringResource = "Open Outside Wire Hazard"
    static var openAppWhenRun: Bool = true

    @Parameter(title: "Wire Hazard")
    var target: WireHazardEntity

    @MainActor
    func perform() async throws -> some IntentResult {
        let store = PendingWireReportStore.shared
        store.hazardType = target.label.suggestedHazardType ?? .wire
        store.descriptionText = target.summary
        store.prediction = WireVisualPrediction(
            label: target.label,
            confidence: target.confidence,
            allScores: [target.label: target.confidence]
        )
        store.consumeToken = UUID()
        return .result()
    }
}

enum WireVisualFrameConverter {
    static func cgImage(from pixelBuffer: CVPixelBuffer) -> CGImage? {
        let ciImage = CIImage(cvPixelBuffer: pixelBuffer)
        let context = CIContext(options: nil)
        return context.createCGImage(ciImage, from: ciImage.extent)
    }
}

#if canImport(VisualIntelligence)

/// System Visual Intelligence query — runs the on-device wire classifier on the captured frame.
struct WireVisualIntelligenceQuery: IntentValueQuery {
    func values(for input: SemanticContentDescriptor) async throws -> [WireHazardEntity] {
        let semanticHints = input.labels.map { $0.lowercased() }
        let hintSuggestsWire = semanticHints.contains { label in
            label.contains("wire")
                || label.contains("cable")
                || label.contains("power line")
                || label.contains("utility pole")
                || label.contains("electric")
        }

        guard let readonlyBuffer = input.pixelBuffer else {
            return hintSuggestsWire ? [Self.fallbackEntity(confidence: 0.6)] : []
        }

        let cgImage: CGImage? = readonlyBuffer.withUnsafeBuffer { buffer in
            WireVisualFrameConverter.cgImage(from: buffer)
        }
        guard let cgImage else { return [] }

        let prediction = await WireVisualIntelligenceService.shared.classify(cgImage: cgImage)

        var results: [WireHazardEntity] = []
        if let prediction, prediction.confidence >= 0.45 {
            if prediction.label.isReportableWireHazard || prediction.confidence >= 0.75 || hintSuggestsWire {
                results.append(
                    WireHazardEntity(
                        id: "wire-\(prediction.label.rawValue)",
                        label: prediction.label,
                        confidence: prediction.confidence,
                        summary: "\(prediction.confidencePercent)% · \(prediction.label.detail)"
                    )
                )
            }
        } else if hintSuggestsWire {
            results.append(Self.fallbackEntity(confidence: 0.55))
        }

        WireHazardCatalog.shared.replace(with: results)
        return results
    }

    private static func fallbackEntity(confidence: Double) -> WireHazardEntity {
        WireHazardEntity(
            id: "wire-non_standard_outside_wire-hint",
            label: .nonStandardOutsideWire,
            confidence: confidence,
            summary: "Possible non-standard outside wire from Visual Intelligence labels."
        )
    }
}

@AppIntent(schema: .visualIntelligence.semanticContentSearch)
struct ContinueWireVisualSearchIntent: AppIntent {
    static var title: LocalizedStringResource = "Continue Wire Search in Hazard Reporter"
    static var openAppWhenRun: Bool = true

    var semanticContent: SemanticContentDescriptor

    @MainActor
    func perform() async throws -> some IntentResult {
        guard let readonlyBuffer = semanticContent.pixelBuffer else { return .result() }
        let cgImage: CGImage? = readonlyBuffer.withUnsafeBuffer { buffer in
            WireVisualFrameConverter.cgImage(from: buffer)
        }
        guard let cgImage else { return .result() }

        let uiImage = UIImage(cgImage: cgImage)
        if let prediction = await WireVisualIntelligenceService.shared.classify(image: uiImage) {
            PendingWireReportStore.shared.apply(prediction: prediction, image: uiImage)
        }
        return .result()
    }
}

#endif
