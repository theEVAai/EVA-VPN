import SwiftUI

/// Настройки: то немногое, что имеет смысл трогать на телефоне.
struct SettingsView: View {

    private let store = Store.shared

    @State private var mtu: String = ""
    @State private var ipv6: Bool = true
    @State private var dnsRemote: String = ""
    @State private var dnsDirect: String = ""

    var body: some View {
        ZStack {
            Eva.black.ignoresSafeArea()

            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    Text("НАСТРОЙКИ")
                        .font(.system(size: 17, weight: .bold, design: .monospaced))
                        .foregroundColor(Eva.cream)

                    field("Размер пакета (MTU)", text: $mtu, keyboard: .numberPad)
                    Text("1400 — разумное значение для сотовой сети. Больше режется по дороге.")
                        .font(.system(size: 11))
                        .foregroundColor(Eva.creamDim)

                    Toggle(isOn: $ipv6) {
                        Text("Разрешить IPv6")
                            .font(.system(size: 14))
                            .foregroundColor(Eva.cream)
                    }
                    .tint(Eva.blue2)

                    Text("Не выключайте без причины: у многих операторов сеть работает только на IPv6, и запрет оставит телефон без интернета.")
                        .font(.system(size: 11))
                        .foregroundColor(Eva.creamDim)

                    field("DNS через VPN", text: $dnsRemote, keyboard: .URL)
                    field("Локальный DNS", text: $dnsDirect, keyboard: .URL)

                    Button("СОХРАНИТЬ") { save() }
                        .buttonStyle(PrimaryButton())
                        .padding(.top, 6)
                }
                .padding(20)
            }
        }
        .onAppear(perform: reload)
    }

    private func field(_ title: String, text: Binding<String>, keyboard: UIKeyboardType) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title)
                .font(.system(size: 11, design: .monospaced))
                .foregroundColor(Eva.creamDim)
            TextField("", text: text)
                .font(.system(size: 13, design: .monospaced))
                .foregroundColor(Eva.cream)
                .keyboardType(keyboard)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .padding(10)
                .background(Eva.panel)
                .overlay(Rectangle().stroke(Eva.line, lineWidth: 1))
        }
    }

    private func reload() {
        mtu = String(store.mtu)
        ipv6 = store.ipv6
        dnsRemote = store.dnsRemote
        dnsDirect = store.dnsDirect
    }

    private func save() {
        if let value = Int(mtu), (576...9000).contains(value) { store.mtu = value }
        store.ipv6 = ipv6
        if !dnsRemote.isEmpty { store.dnsRemote = dnsRemote }
        if !dnsDirect.isEmpty { store.dnsDirect = dnsDirect }
        reload()
    }
}
