import SwiftUI

@main
struct EvaApp: App {
    var body: some Scene {
        WindowGroup {
            ContentView()
                .preferredColorScheme(.dark)
        }
    }
}

/// Главный экран: сердце-переключатель, состояние и три раздела.
struct ContentView: View {

    @StateObject private var tunnel = TunnelManager.shared
    @State private var store = Store.shared
    @State private var activeName: String = ""
    @State private var keyColor: Color = Eva.blue2
    @State private var showNoKey = false

    var body: some View {
        NavigationStack {
            ZStack {
                Eva.black.ignoresSafeArea()

                VStack(spacing: 0) {
                    Text("VPN.THEEVA.AI")
                        .font(.system(size: 15, weight: .bold, design: .monospaced))
                        .foregroundColor(Eva.cream)
                        .padding(.top, 10)

                    Spacer()

                    Button {
                        Task { await toggle() }
                    } label: {
                        HeartView(connected: tunnel.isConnected, keyColor: keyColor)
                    }
                    .buttonStyle(.plain)
                    .disabled(tunnel.isBusy)

                    Text(tunnel.status.title)
                        .font(.system(size: 19, weight: .bold, design: .monospaced))
                        .foregroundColor(tunnel.isConnected ? Eva.blue2 : Eva.creamDim)
                        .padding(.top, 22)

                    Text(subtitle)
                        .font(.system(size: 12, design: .monospaced))
                        .foregroundColor(Eva.creamDim)
                        .padding(.top, 8)

                    if let error = tunnel.lastError {
                        Text(error)
                            .font(.system(size: 11, design: .monospaced))
                            .foregroundColor(Eva.danger)
                            .multilineTextAlignment(.center)
                            .padding(.top, 8)
                            .padding(.horizontal, 20)
                    }

                    Spacer()

                    HStack(spacing: 0) {
                        NavigationLink { KeysView() } label: { tab("Ключи") }
                        NavigationLink { RulesView() } label: { tab("Правила") }
                        NavigationLink { SettingsView() } label: { tab("Настройки") }
                    }
                    .padding(.bottom, 8)
                }
                .padding(.horizontal, 20)
            }
            .toolbar(.hidden, for: .navigationBar)
        }
        .task {
            await tunnel.prepare()
            refresh()
        }
        .alert("Сначала добавьте ключ доступа", isPresented: $showNoKey) {
            Button("Понятно", role: .cancel) {}
        }
    }

    private var subtitle: String {
        activeName.isEmpty ? "// ключ не добавлен" : "// " + activeName
    }

    private func tab(_ title: String) -> some View {
        Text(title)
            .font(.system(size: 12, design: .monospaced))
            .foregroundColor(Eva.cream)
            .frame(maxWidth: .infinity, minHeight: 44)
    }

    private func refresh() {
        let profile = store.activeProfile
        activeName = profile?.name ?? ""
        if let hex = profile?.color, let parsed = Color(hex: hex) {
            keyColor = parsed
        } else {
            keyColor = Eva.blue2
        }
    }

    private func toggle() async {
        refresh()
        if store.activeProfile == nil {
            showNoKey = true
            return
        }
        await tunnel.toggle()
    }
}

extension Color {
    /// Цвет из строки вида #rrggbb — так метки ключей хранятся в настройках.
    init?(hex: String) {
        var s = hex.trimmingCharacters(in: .whitespaces)
        if s.hasPrefix("#") { s.removeFirst() }
        guard s.count == 6, let value = UInt32(s, radix: 16) else { return nil }
        self.init(
            red: Double((value >> 16) & 0xFF) / 255,
            green: Double((value >> 8) & 0xFF) / 255,
            blue: Double(value & 0xFF) / 255
        )
    }
}
