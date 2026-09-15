//
// HazardReporter — iOS client for public hazard reporting.
// Open this folder in Xcode (File → Open) or create a new iOS App
// target and add these sources. Requires iOS 18+, camera & location usage.
// Visual Intelligence integration requires the iOS 26+ SDK (compile-time canImport).
//

import SwiftUI

@main
struct HazardReporterApp: App {
    @StateObject private var locationService = LocationService()

    var body: some Scene {
        WindowGroup {
            ContentView()
                .environmentObject(locationService)
        }
    }
}
