import Foundation
import UIKit

/// Shared hand-off from Visual Intelligence / in-app classification into the report form.
@MainActor
final class PendingWireReportStore: ObservableObject {
    static let shared = PendingWireReportStore()

    @Published var hazardType: HazardType = .wire
    @Published var descriptionText: String = ""
    @Published var previewImage: UIImage?
    @Published var imageData: Data?
    @Published var prediction: WireVisualPrediction?
    @Published var consumeToken: UUID?

    func apply(prediction: WireVisualPrediction, image: UIImage?) {
        self.prediction = prediction
        if prediction.label.isReportableWireHazard {
            hazardType = .wire
            if descriptionText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                descriptionText =
                    "Visual Intelligence detected a non-standard outside wire (\(prediction.confidencePercent)% confidence)."
            }
        }
        if let image {
            previewImage = image
            imageData = image.jpegData(compressionQuality: 0.85)
        }
        consumeToken = UUID()
    }

    func clearPredictionBanner() {
        prediction = nil
    }
}
