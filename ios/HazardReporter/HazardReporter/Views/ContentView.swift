import SwiftUI
import PhotosUI

struct ContentView: View {
    @EnvironmentObject private var locationService: LocationService
    @ObservedObject private var pendingReport = PendingWireReportStore.shared

    @State private var hazardType: HazardType = .wire
    @State private var descriptionText = ""
    @State private var selectedItem: PhotosPickerItem?
    @State private var imageData: Data?
    @State private var previewImage: UIImage?
    @State private var isSubmitting = false
    @State private var isClassifying = false
    @State private var visualPrediction: WireVisualPrediction?
    @State private var result: ReportResponse?
    @State private var errorText: String?
    @State private var showCamera = false

    private let api = APIClient()
    private let visualIntelligence = WireVisualIntelligenceService.shared

    var body: some View {
        NavigationStack {
            ZStack {
                LinearGradient(
                    colors: [
                        Color(red: 0.85, green: 0.91, blue: 0.87),
                        Color(red: 0.96, green: 0.94, blue: 0.90),
                        Color(red: 0.87, green: 0.91, blue: 0.89)
                    ],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
                .ignoresSafeArea()

                ScrollView {
                    VStack(alignment: .leading, spacing: 20) {
                        brandHeader
                        formCard
                        if let result {
                            resultCard(result)
                        }
                        if let errorText {
                            Text(errorText)
                                .foregroundStyle(Color(red: 0.6, green: 0.2, blue: 0.1))
                        }
                    }
                    .padding(20)
                }
            }
            .navigationBarHidden(true)
            .onAppear { locationService.request() }
            .sheet(isPresented: $showCamera) {
                CameraPicker { image in
                    previewImage = image
                    imageData = image.jpegData(compressionQuality: 0.85)
                    Task { await classifyCurrentImage() }
                }
            }
            .onChange(of: selectedItem) { _, item in
                Task {
                    if let data = try? await item?.loadTransferable(type: Data.self) {
                        imageData = data
                        previewImage = UIImage(data: data)
                        await classifyCurrentImage()
                    }
                }
            }
            .onChange(of: pendingReport.consumeToken) { _, _ in
                applyPendingVisualReport()
            }
        }
    }

    private var brandHeader: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Hazard Reporter")
                .font(.custom("Georgia", size: 36).weight(.bold))
                .foregroundStyle(Color(red: 0.04, green: 0.28, blue: 0.20))
            Text("Photograph a public hazard. On-device visual intelligence flags non-standard outside wires and routes the report to the right desk.")
                .font(.system(size: 16))
                .foregroundStyle(Color(red: 0.30, green: 0.36, blue: 0.33))
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.top, 12)
    }

    private var formCard: some View {
        VStack(alignment: .leading, spacing: 16) {
            Picker("Hazard type", selection: $hazardType) {
                ForEach(HazardType.allCases) { type in
                    Text(type.title).tag(type)
                }
            }
            .pickerStyle(.menu)

            TextField("What did you see?", text: $descriptionText, axis: .vertical)
                .lineLimit(3...6)
                .textFieldStyle(.roundedBorder)

            locationRow

            if let previewImage {
                Image(uiImage: previewImage)
                    .resizable()
                    .scaledToFill()
                    .frame(maxWidth: .infinity)
                    .frame(height: 220)
                    .clipped()
                    .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
            }

            if isClassifying {
                HStack(spacing: 8) {
                    ProgressView()
                    Text("Scanning for non-standard outside wires…")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
            } else if let visualPrediction {
                visualResultBanner(visualPrediction)
            }

            HStack(spacing: 12) {
                Button {
                    showCamera = true
                } label: {
                    Label("Camera", systemImage: "camera.fill")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.borderedProminent)
                .tint(Color(red: 0.06, green: 0.42, blue: 0.30))

                PhotosPicker(selection: $selectedItem, matching: .images) {
                    Label("Library", systemImage: "photo.on.rectangle")
                        .frame(maxWidth: .infinity)
                }
                .buttonStyle(.bordered)
            }

            Button {
                Task { await submit() }
            } label: {
                if isSubmitting {
                    ProgressView()
                        .frame(maxWidth: .infinity)
                } else {
                    Text("Submit report")
                        .frame(maxWidth: .infinity)
                }
            }
            .buttonStyle(.borderedProminent)
            .tint(Color(red: 0.06, green: 0.42, blue: 0.30))
            .disabled(isSubmitting || locationService.coordinate == nil)
        }
        .padding(18)
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
    }

    private func visualResultBanner(_ prediction: WireVisualPrediction) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(prediction.label.title)
                .font(.headline)
            Text("\(prediction.confidencePercent)% confidence · \(prediction.label.detail)")
                .font(.subheadline)
                .foregroundStyle(.secondary)
            if prediction.label.isReportableWireHazard {
                Text("Hazard type set to hanging / damaged wire.")
                    .font(.caption)
                    .foregroundStyle(Color(red: 0.06, green: 0.42, blue: 0.30))
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(Color(red: 0.06, green: 0.42, blue: 0.30).opacity(0.10))
        )
    }

    private var locationRow: some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("Location")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
            if let coordinate = locationService.coordinate {
                Text(String(format: "%.5f, %.5f", coordinate.latitude, coordinate.longitude))
                    .font(.body.monospacedDigit())
            } else {
                Text(locationService.errorMessage ?? "Waiting for GPS…")
                    .foregroundStyle(.secondary)
            }
            Button("Refresh location") { locationService.request() }
                .font(.caption)
        }
    }

    private func resultCard(_ report: ReportResponse) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Routed")
                .font(.title2.weight(.semibold))
            Text(locationSummary(report.location))
                .font(.subheadline)
                .foregroundStyle(.secondary)

            ForEach(report.authorities) { authority in
                VStack(alignment: .leading, spacing: 4) {
                    HStack {
                        Text(authority.name).font(.headline)
                        if authority.isPlaceholder {
                            Text("PLACEHOLDER")
                                .font(.caption2.weight(.bold))
                                .foregroundStyle(Color(red: 0.6, green: 0.2, blue: 0.1))
                        }
                    }
                    Text(authority.reason)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                    if let email = authority.email {
                        Text(email).font(.caption)
                    }
                    if let phone = authority.phone {
                        Text(phone).font(.caption)
                    }
                    if let note = report.notifications.first(where: { $0.authorityId == authority.id }) {
                        Text(note.detail)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
                .padding(.vertical, 6)
            }
        }
        .padding(18)
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
    }

    private func locationSummary(_ location: LocationDTO) -> String {
        [location.locality, location.county, location.state]
            .compactMap { $0 }
            .joined(separator: " · ")
    }

    private func applyPendingVisualReport() {
        hazardType = pendingReport.hazardType
        if !pendingReport.descriptionText.isEmpty {
            descriptionText = pendingReport.descriptionText
        }
        if let image = pendingReport.previewImage {
            previewImage = image
            imageData = pendingReport.imageData
        }
        visualPrediction = pendingReport.prediction
    }

    private func classifyCurrentImage() async {
        guard let previewImage else { return }
        isClassifying = true
        defer { isClassifying = false }

        guard visualIntelligence.isModelAvailable else {
            visualPrediction = nil
            return
        }

        let prediction = await visualIntelligence.classify(image: previewImage)
        visualPrediction = prediction
        if let prediction, prediction.label.isReportableWireHazard, prediction.confidence >= 0.55 {
            hazardType = .wire
            if descriptionText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                descriptionText =
                    "On-device visual intelligence detected a non-standard outside wire (\(prediction.confidencePercent)% confidence)."
            }
        }
    }

    private func submit() async {
        guard let coordinate = locationService.coordinate else { return }
        isSubmitting = true
        errorText = nil
        defer { isSubmitting = false }
        do {
            result = try await api.submitReport(
                hazardType: hazardType,
                description: descriptionText,
                latitude: coordinate.latitude,
                longitude: coordinate.longitude,
                imageData: imageData
            )
        } catch {
            errorText = error.localizedDescription
        }
    }
}

#Preview {
    ContentView()
        .environmentObject(LocationService())
}
