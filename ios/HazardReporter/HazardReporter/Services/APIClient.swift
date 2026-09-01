import Foundation
import UIKit

enum APIError: LocalizedError {
    case invalidURL
    case badResponse(Int)
    case decoding
    case message(String)

    var errorDescription: String? {
        switch self {
        case .invalidURL: return "Invalid server URL"
        case .badResponse(let code): return "Server returned \(code)"
        case .decoding: return "Could not read server response"
        case .message(let text): return text
        }
    }
}

final class APIClient {
    /// Point at your deployed API. For local Simulator use your Mac's LAN IP or localhost via a tunnel.
    var baseURL: URL

    init(baseURL: URL = URL(string: ProcessInfo.processInfo.environment["HAZARD_API_URL"] ?? "http://127.0.0.1:3000")!) {
        self.baseURL = baseURL
    }

    func submitReport(
        hazardType: HazardType,
        description: String,
        latitude: Double,
        longitude: Double,
        imageData: Data?
    ) async throws -> ReportResponse {
        let url = baseURL.appendingPathComponent("api/reports")
        var request = URLRequest(url: url)
        request.httpMethod = "POST"

        let boundary = "Boundary-\(UUID().uuidString)"
        request.setValue("multipart/form-data; boundary=\(boundary)", forHTTPHeaderField: "Content-Type")

        var body = Data()
        func appendField(_ name: String, _ value: String) {
            body.append("--\(boundary)\r\n".data(using: .utf8)!)
            body.append("Content-Disposition: form-data; name=\"\(name)\"\r\n\r\n".data(using: .utf8)!)
            body.append("\(value)\r\n".data(using: .utf8)!)
        }

        appendField("hazardType", hazardType.rawValue)
        appendField("description", description)
        appendField("latitude", String(latitude))
        appendField("longitude", String(longitude))

        if let imageData {
            body.append("--\(boundary)\r\n".data(using: .utf8)!)
            body.append("Content-Disposition: form-data; name=\"photo\"; filename=\"hazard.jpg\"\r\n".data(using: .utf8)!)
            body.append("Content-Type: image/jpeg\r\n\r\n".data(using: .utf8)!)
            body.append(imageData)
            body.append("\r\n".data(using: .utf8)!)
        }

        body.append("--\(boundary)--\r\n".data(using: .utf8)!)
        request.httpBody = body

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse else { throw APIError.badResponse(-1) }
        guard (200..<300).contains(http.statusCode) else {
            if let obj = try? JSONDecoder().decode([String: String].self, from: data),
               let error = obj["error"] {
                throw APIError.message(error)
            }
            throw APIError.badResponse(http.statusCode)
        }
        do {
            return try JSONDecoder().decode(ReportResponse.self, from: data)
        } catch {
            throw APIError.decoding
        }
    }
}
