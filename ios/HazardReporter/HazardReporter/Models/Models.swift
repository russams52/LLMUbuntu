import Foundation

enum HazardType: String, CaseIterable, Identifiable, Codable {
    case wire
    case pothole
    case roadIssue = "road_issue"
    case other

    var id: String { rawValue }

    var title: String {
        switch self {
        case .wire: return "Hanging / damaged wire"
        case .pothole: return "Pothole"
        case .roadIssue: return "Other road issue"
        case .other: return "Other public hazard"
        }
    }
}

/// Labels produced by on-device / server Visual Intelligence.
enum VisionLabel: String, CaseIterable, Identifiable, Codable {
    case hangingWire = "hanging_wire"
    case pothole = "pothole"
    case roadDamage = "road_damage"
    case debrisObstacle = "debris_obstacle"
    case safeScene = "safe_scene"

    var id: String { rawValue }

    var title: String {
        switch self {
        case .hangingWire: return "Hanging / damaged wire"
        case .pothole: return "Pothole"
        case .roadDamage: return "Road damage"
        case .debrisObstacle: return "Debris / obstacle"
        case .safeScene: return "No reportable hazard"
        }
    }

    var detail: String {
        switch self {
        case .hangingWire:
            return "Sagging, dangling, tangled, or downed aerial plant."
        case .pothole:
            return "Broken pavement cavity or crater in the roadway."
        case .roadDamage:
            return "Cracks, upheaval, or other road surface failure."
        case .debrisObstacle:
            return "Object blocking or endangering a public area."
        case .safeScene:
            return "Scene does not appear to show a public safety hazard."
        }
    }

    var isReportable: Bool {
        self != .safeScene
    }

    var suggestedHazardType: HazardType? {
        switch self {
        case .hangingWire: return .wire
        case .pothole: return .pothole
        case .roadDamage: return .roadIssue
        case .debrisObstacle: return .other
        case .safeScene: return nil
        }
    }
}

struct VisionPrediction: Identifiable, Equatable {
    let id = UUID()
    let label: VisionLabel
    let confidence: Double
    let source: String
    let allScores: [VisionLabel: Double]

    var confidencePercent: Int {
        Int((confidence * 100).rounded())
    }

    var isReportable: Bool {
        label.isReportable && confidence >= 0.42
    }
}

struct AuthorityDTO: Codable, Identifiable {
    let id: String
    let name: String
    let type: String
    let role: String
    let reason: String
    let email: String?
    let phone: String?
    let website: String?
    let isPlaceholder: Bool
}

struct LocationDTO: Codable {
    let latitude: Double
    let longitude: Double
    let locality: String?
    let county: String?
    let state: String?
    let inLongIsland: Bool
}

struct NotificationDTO: Codable {
    let authorityId: String
    let sent: Bool
    let detail: String
}

struct VisionDTO: Codable {
    let label: String
    let title: String?
    let detail: String?
    let confidence: Double
    let reportable: Bool
    let hazardType: String?
    let source: String
    let cues: [String]?
}

struct ReportResponse: Codable {
    let id: String
    let status: String
    let hazardType: String
    let location: LocationDTO
    let photoUrl: String?
    let vision: VisionDTO?
    let authorities: [AuthorityDTO]
    let notifications: [NotificationDTO]
}

struct PreviewResponse: Codable {
    let geo: GeoDTO
    let authorities: [AuthorityDTO]
}

struct GeoDTO: Codable {
    let locality: String?
    let county: String?
    let state: String?
    let stateCode: String?
    let inLongIsland: Bool
}

struct ClassifyResponse: Codable {
    let vision: VisionDTO
}
