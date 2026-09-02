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

struct ReportResponse: Codable {
    let id: String
    let status: String
    let hazardType: String
    let location: LocationDTO
    let photoUrl: String?
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
