import CoreML
import UIKit
import Vision

/// On-device + server Visual Intelligence for public hazards
/// (wires, potholes, road damage, debris).
final class HazardVisualIntelligenceService {
    static let shared = HazardVisualIntelligenceService()

    private let confidenceThreshold: Double
    private var visionModel: VNCoreMLModel?
    private let api = APIClient()

    init(confidenceThreshold: Double = 0.42) {
        self.confidenceThreshold = confidenceThreshold
        self.visionModel = Self.loadVisionModel()
    }

    var isCoreMLAvailable: Bool { visionModel != nil }

    func classify(image: UIImage, description: String? = nil) async -> VisionPrediction? {
        if let onDevice = await classifyOnDevice(image: image),
           onDevice.confidence >= confidenceThreshold {
            return onDevice
        }

        if let data = image.jpegData(compressionQuality: 0.85) {
            if let server = try? await api.classifyVision(imageData: data, description: description) {
                return server
            }
        }

        return await classifyOnDevice(image: image)
    }

    func classifyOnDevice(image: UIImage) async -> VisionPrediction? {
        if let coreML = await classifyWithCoreML(image: image) {
            return coreML
        }
        return await classifyWithAppleVision(image: image)
    }

    private func classifyWithCoreML(image: UIImage) async -> VisionPrediction? {
        guard let visionModel, let cgImage = image.cgImage else { return nil }
        let orientation = Self.cgOrientation(from: image.imageOrientation)

        return await withCheckedContinuation { continuation in
            let request = VNCoreMLRequest(model: visionModel) { request, _ in
                let observations = (request.results as? [VNClassificationObservation]) ?? []
                continuation.resume(returning: Self.prediction(from: observations, source: "coreml"))
            }
            request.imageCropAndScaleOption = .centerCrop
            let handler = VNImageRequestHandler(cgImage: cgImage, orientation: orientation, options: [:])
            do {
                try handler.perform([request])
            } catch {
                continuation.resume(returning: nil)
            }
        }
    }

    /// Fallback taxonomy mapping when the custom Core ML package is not bundled.
    private func classifyWithAppleVision(image: UIImage) async -> VisionPrediction? {
        guard let cgImage = image.cgImage else { return nil }
        let orientation = Self.cgOrientation(from: image.imageOrientation)

        return await withCheckedContinuation { continuation in
            let request = VNClassifyImageRequest { request, _ in
                let observations = (request.results as? [VNClassificationObservation]) ?? []
                continuation.resume(returning: Self.mapAppleTaxonomy(observations))
            }
            let handler = VNImageRequestHandler(cgImage: cgImage, orientation: orientation, options: [:])
            do {
                try handler.perform([request])
            } catch {
                continuation.resume(returning: nil)
            }
        }
    }

    private static func prediction(
        from observations: [VNClassificationObservation],
        source: String
    ) -> VisionPrediction? {
        guard let top = observations.first,
              let label = VisionLabel(rawValue: top.identifier) else {
            return nil
        }
        var scores: [VisionLabel: Double] = [:]
        for observation in observations {
            if let label = VisionLabel(rawValue: observation.identifier) {
                scores[label] = Double(observation.confidence)
            }
        }
        return VisionPrediction(
            label: label,
            confidence: Double(top.confidence),
            source: source,
            allScores: scores
        )
    }

    private static func mapAppleTaxonomy(_ observations: [VNClassificationObservation]) -> VisionPrediction? {
        let keywords: [(VisionLabel, [String])] = [
            (.hangingWire, ["wire", "cable", "power line", "utility pole", "electrical"]),
            (.pothole, ["pothole", "hole", "crater", "manhole"]),
            (.roadDamage, ["asphalt", "pavement", "road", "crack", "street"]),
            (.debrisObstacle, ["debris", "trash", "branch", "obstacle", "rubble"]),
        ]

        var scores: [VisionLabel: Double] = [
            .hangingWire: 0.05,
            .pothole: 0.05,
            .roadDamage: 0.05,
            .debrisObstacle: 0.05,
            .safeScene: 0.2,
        ]

        for observation in observations.prefix(12) {
            let id = observation.identifier.lowercased()
            let conf = Double(observation.confidence)
            for (label, words) in keywords {
                if words.contains(where: { id.contains($0) }) {
                    scores[label, default: 0] += conf
                }
            }
        }

        let sorted = scores.sorted { $0.value > $1.value }
        guard let top = sorted.first else { return nil }
        return VisionPrediction(
            label: top.key,
            confidence: min(0.95, top.value),
            source: "vision_taxonomy",
            allScores: scores
        )
    }

    private static func loadVisionModel() -> VNCoreMLModel? {
        let config = MLModelConfiguration()
        config.computeUnits = .all

        let candidates: [URL?] = [
            Bundle.main.url(forResource: "PublicHazardClassifier", withExtension: "mlmodelc"),
            Bundle.main.url(forResource: "PublicHazardClassifier", withExtension: "mlpackage"),
            Bundle.main.url(
                forResource: "PublicHazardClassifier",
                withExtension: "mlpackage",
                subdirectory: "Resources"
            ),
            Bundle.main.url(forResource: "NonStandardOutsideWireClassifier", withExtension: "mlmodelc"),
            Bundle.main.url(forResource: "NonStandardOutsideWireClassifier", withExtension: "mlpackage"),
        ]

        for case let url? in candidates {
            do {
                let model = try MLModel(contentsOf: url, configuration: config)
                return try VNCoreMLModel(for: model)
            } catch {
                continue
            }
        }
        return nil
    }

    private static func cgOrientation(from orientation: UIImage.Orientation) -> CGImagePropertyOrientation {
        switch orientation {
        case .up: return .up
        case .down: return .down
        case .left: return .left
        case .right: return .right
        case .upMirrored: return .upMirrored
        case .downMirrored: return .downMirrored
        case .leftMirrored: return .leftMirrored
        case .rightMirrored: return .rightMirrored
        @unknown default: return .up
        }
    }
}
