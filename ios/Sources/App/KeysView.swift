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

                        Button("ДОБАВИТЬ") { add() }
                            .buttonStyle(PrimaryButton())
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
                    store.removeProfile(id: profile.id)
                    reload()
                }
                .buttonStyle(GhostButton())
            )
        )
        .contentShape(Rectangle())
        .onTapGesture {
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

    private func add() {
        let parsed = Keys.parseMany(text)
        if parsed.isEmpty {
            message = "Не похоже на ключ или ссылку подписки"
            return
        }
        let added = store.addProfiles(parsed)
        text = ""
        message = "Добавлено: \(added)"
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
