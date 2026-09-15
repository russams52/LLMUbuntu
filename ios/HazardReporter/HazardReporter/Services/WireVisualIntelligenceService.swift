import CoreML
import UIKit
import Vision

/// On-device classifier for non-standard outside wires (Core ML + Vision).
final class WireVisualIntelligenceService {
    static let shared = WireVisualIntelligenceService()

    private let confidenceThreshold: Double
    private var visionModel: VNCoreMLModel?

    init(confidenceThreshold: Double = 0.55) {
        self.confidenceThreshold = confidenceThreshold
        self.visionModel = Self.loadVisionModel()
    }

    var isModelAvailable: Bool { visionModel != nil }

    func classify(image: UIImage) async -> WireVisualPrediction? {
        guard let cgImage = image.cgImage else { return nil }
        return await classify(cgImage: cgImage, orientation: Self.cgOrientation(from: image.imageOrientation))
    }

    func classify(cgImage: CGImage, orientation: CGImagePropertyOrientation = .up) async -> WireVisualPrediction? {
        guard let visionModel else { return nil }

        return await withCheckedContinuation { continuation in
            let request = VNCoreMLRequest(model: visionModel) { request, _ in
                let observations = (request.results as? [VNClassificationObservation]) ?? []
                continuation.resume(returning: Self.prediction(from: observations))
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

    /// Returns a prediction only when it clears the reportable-wire threshold.
    func detectReportableWire(image: UIImage) async -> WireVisualPrediction? {
        guard let prediction = await classify(image: image) else { return nil }
        guard prediction.label.isReportableWireHazard,
              prediction.confidence >= confidenceThreshold else {
            return nil
        }
        return prediction
    }

    private static func prediction(from observations: [VNClassificationObservation]) -> WireVisualPrediction? {
        guard !observations.isEmpty else { return nil }

        var scores: [WireVisualLabel: Double] = [:]
        for observation in observations {
            if let label = WireVisualLabel(rawValue: observation.identifier) {
                scores[label] = Double(observation.confidence)
            }
        }

        guard let top = observations.first,
              let label = WireVisualLabel(rawValue: top.identifier) else {
            return nil
        }

        return WireVisualPrediction(
            label: label,
            confidence: Double(top.confidence),
            allScores: scores
        )
    }

    private static func loadVisionModel() -> VNCoreMLModel? {
        let config = MLModelConfiguration()
        config.computeUnits = .all

        let candidates: [URL?] = [
            Bundle.main.url(forResource: "NonStandardOutsideWireClassifier", withExtension: "mlmodelc"),
            Bundle.main.url(forResource: "NonStandardOutsideWireClassifier", withExtension: "mlpackage"),
            Bundle.main.url(
                forResource: "NonStandardOutsideWireClassifier",
                withExtension: "mlpackage",
                subdirectory: "Resources"
            ),
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
