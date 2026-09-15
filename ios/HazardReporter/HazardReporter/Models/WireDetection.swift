import Foundation

/// Labels produced by NonStandardOutsideWireClassifier.
enum WireVisualLabel: String, CaseIterable, Identifiable, Codable {
    case nonStandardOutsideWire = "non_standard_outside_wire"
    case standardOutsideWire = "standard_outside_wire"
    case noOutsideWire = "no_outside_wire"

    var id: String { rawValue }

    var title: String {
        switch self {
        case .nonStandardOutsideWire: return "Non-standard outside wire"
        case .standardOutsideWire: return "Standard outside wire"
        case .noOutsideWire: return "No outside wire"
        }
    }

    var detail: String {
        switch self {
        case .nonStandardOutsideWire:
            return "Sagging, dangling, tangled, low-clearance, or downed aerial plant."
        case .standardOutsideWire:
            return "Even-tension outdoor span that does not look reportable."
        case .noOutsideWire:
            return "Outdoor scene without recognizable aerial plant."
        }
    }

    var isReportableWireHazard: Bool {
        self == .nonStandardOutsideWire
    }

    var suggestedHazardType: HazardType? {
        isReportableWireHazard ? .wire : nil
    }
}

struct WireVisualPrediction: Identifiable, Equatable {
    let id = UUID()
    let label: WireVisualLabel
    let confidence: Double
    let allScores: [WireVisualLabel: Double]

    var confidencePercent: Int {
        Int((confidence * 100).rounded())
    }
}
