import SwiftUI

/// Ключи доступа: добавить, выбрать, удалить.
///
/// Принимается и одна ссылка, и много строк, и содержимое подписки —
/// разбором занимается общий с другими платформами код (Core/Profile.swift).
struct KeysView: View {

    private let store = Store.shared

    @State private var text: String = ""
    @State private var profiles: [Profile] = []
    @State private var activeId: String = ""
    @State private var message: String?
    @State private var loading = false
    @StateObject private var tunnel = TunnelManager.shared

    var body: some View {
        ZStack {
            Eva.black.ignoresSafeArea()

            ScrollView {
                VStack(alignment: .leading, spacing: 14) {
                    Text("КЛЮЧИ ДОСТУПА")
                        .font(.system(size: 17, weight: .bold, design: .monospaced))
                        .foregroundColor(Eva.cream)

                    TextEditor(text: $text)
                        .font(.system(size: 13, design: .monospaced))
                        .foregroundColor(Eva.cream)
                        .scrollContentBackground(.hidden)
                        .background(Eva.panel)
                        .frame(height: 84)
                        .overlay(Rectangle().stroke(Eva.line, lineWidth: 1))
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .accessibilityLabel("Ключ или HTTPS-ссылка на подписку")

                    Text("Вставьте vless:// или ссылку на подписку")
                        .font(.system(size: 11, design: .monospaced))
                        .foregroundColor(Eva.creamDim)

                    HStack(spacing: 8) {
                        Button("ИЗ БУФЕРА") {
                            #if canImport(UIKit)
                            text = UIPasteboard.general.string ?? ""
                            #endif
                        }
                        .buttonStyle(GhostButton())

                        Button(loading ? "ЗАГРУЗКА…" : "ДОБАВИТЬ") { Task { await add() } }
                            .buttonStyle(PrimaryButton())
                    }
                    .disabled(loading)

                    if profiles.contains(where: { $0.source.hasPrefix("sub:https://") }) {
                        Button("ОБНОВИТЬ ПОДПИСКИ") { Task { await refreshSubscriptions() } }
                            .buttonStyle(GhostButton())
                            .disabled(loading)
                    }

                    if let message {
                        Text(message)
                            .font(.system(size: 12, design: .monospaced))
                            .foregroundColor(Eva.creamDim)
                    }

                    Text("// добавленные")
                        .font(.system(size: 11, design: .monospaced))
                        .foregroundColor(Eva.creamDim)
                        .padding(.top, 6)

                    VStack(spacing: 0) {
                        if profiles.isEmpty {
                            row(title: "Пока нет ни одного ключа", hint: nil, trailing: nil)
                        } else {
                            ForEach(Array(profiles.enumerated()), id: \.element.id) { index, profile in
                                if index > 0 { Divider().background(Eva.line) }
                                keyRow(profile)
                            }
                        }
                    }
                    .background(Eva.panel)
                    .overlay(Rectangle().stroke(Eva.line, lineWidth: 1))
                }
                .padding(20)
            }
        }
        .onAppear(perform: reload)
    }

    private func keyRow(_ profile: Profile) -> some View {
        let isActive = profile.id == activeId
        return row(
            title: (isActive ? "● " : "○ ") + profile.name,
            hint: "\(profile.type) · \(profile.server):\(profile.port) · " +
                  (profile.source == "manual" ? "вручную" : "подписка"),
            trailing: AnyView(
                Button("×") {
                    guard !loading else { return }
                    if isActive && (tunnel.isConnected || tunnel.isBusy) {
                        message = "Отключите VPN перед удалением активного ключа."
                        return
                    }
                    store.removeProfile(id: profile.id)
                    reload()
                }
                .buttonStyle(GhostButton())
                .accessibilityLabel("Удалить ключ \(profile.name)")
            )
        )
        .contentShape(Rectangle())
        .onTapGesture {
            guard !loading else { return }
            if tunnel.isConnected || tunnel.isBusy {
                message = "Отключите VPN перед выбором другого ключа."
                return
            }
            store.activeId = profile.id
            reload()
        }
    }

    private func row(title: String, hint: String?, trailing: AnyView?) -> some View {
        HStack(alignment: .center, spacing: 10) {
            VStack(alignment: .leading, spacing: 3) {
                Text(title)
                    .font(.system(size: 14))
                    .foregroundColor(Eva.cream)
                if let hint {
                    Text(hint)
                        .font(.system(size: 11))
                        .foregroundColor(Eva.creamDim)
                }
            }
            Spacer()
            trailing
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 11)
    }

    @MainActor
    private func add() async {
        guard !loading else { return }
        loading = true
        defer { loading = false }
        let input = text.trimmingCharacters(in: .whitespacesAndNewlines)
        do {
            let count: Int
            if input.hasPrefix("https://") || input.hasPrefix("http://") {
                let parsed = try await Subscription.fetch(input)
                count = store.replaceSubscription("sub:" + input, incoming: parsed)
            } else {
                let parsed = try Keys.parseMany(input)
                guard !parsed.isEmpty else { throw ParseError(message: "Не похоже на ключ или ссылку подписки.") }
                count = store.addProfiles(parsed)
            }
            text = ""
            message = "Ключей добавлено или обновлено: \(count)"
            if tunnel.isConnected { message! += ". Для применения переподключите VPN." }
            reload()
        } catch {
            message = error is ParseError ? error.localizedDescription : "Подписка не загрузилась. Проверьте ссылку и соединение."
        }
    }

    @MainActor
    private func refreshSubscriptions() async {
        guard !loading else { return }
        loading = true
        defer { loading = false }
        let sources = Set(store.profiles.map(\.source).filter { $0.hasPrefix("sub:https://") })
        var updated = 0
        var failed = 0
        for source in sources {
            do {
                let incoming = try await Subscription.fetch(String(source.dropFirst(4)))
                store.replaceSubscription(source, incoming: incoming)
                updated += 1
            } catch { failed += 1 }
        }
        message = "Подписок обновлено: \(updated). Ошибок: \(failed). При ошибке прежние ключи сохранены."
        if tunnel.isConnected { message! += " Переподключите VPN для применения." }
        reload()
    }

    private func reload() {
        profiles = store.profiles
        activeId = store.activeProfile?.id ?? ""
    }
}

struct PrimaryButton: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 12, design: .monospaced))
            .foregroundColor(.white)
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            .frame(maxWidth: .infinity)
            .background(configuration.isPressed ? Eva.blue2 : Eva.blue)
    }
}

struct GhostButton: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: 12, design: .monospaced))
            .foregroundColor(Eva.cream)
            .padding(.horizontal, 14)
            .padding(.vertical, 10)
            .overlay(Rectangle().stroke(Eva.line, lineWidth: 1))
            .background(configuration.isPressed ? Eva.blue.opacity(0.2) : Color.clear)
    }
}
