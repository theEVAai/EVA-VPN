import SwiftUI

/// Настройки: то немногое, что имеет смысл трогать на телефоне.
struct SettingsView: View {

    private let store = Store.shared

    @State private var mtu: String = ""
    @State private var connectTimeout = 30
    @State private var feedback: String?
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
                    Text("По умолчанию 1400. Меняйте только при необходимости: MTU туннеля отличается от MTU внешнего соединения.")
                        .font(.system(size: 11))
                        .foregroundColor(Eva.creamDim)

                    Toggle(isOn: $ipv6) {
                        Text("Разрешить IPv6")
                            .font(.system(size: 14))
                            .foregroundColor(Eva.cream)
                    }
                    .tint(Eva.blue2)

                    Text("IPv6 для трафика внутри VPN. Включайте, если выбранный сервер поддерживает выход в IPv6.")
                        .font(.system(size: 11))
                        .foregroundColor(Eva.creamDim)

                    field("DNS через VPN", text: $dnsRemote, keyboard: .URL)
                    field("Локальный DNS", text: $dnsDirect, keyboard: .URL)

                    Picker("Ожидание подключения", selection: $connectTimeout) {
                        ForEach([15, 30, 60, 120], id: \.self) { seconds in
                            Text("\(seconds) с").tag(seconds)
                        }
                    }
                    .tint(Eva.blue2)
                    Text("Увеличьте время, если соединение обрывается по таймауту. Изменения применяются после переподключения.")
                        .font(.system(size: 14))
                        .foregroundColor(Eva.creamDim)

                    Button("СОХРАНИТЬ") { save() }
                        .buttonStyle(PrimaryButton())
                        .padding(.top, 6)
                    if let feedback {
                        Text(feedback).font(.system(size: 14)).foregroundColor(Eva.cream)
                    }
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
        connectTimeout = store.connectTimeout
        ipv6 = store.ipv6
        dnsRemote = store.dnsRemote
        dnsDirect = store.dnsDirect
    }

    private func save() {
        guard let value = Int(mtu), (1280...9000).contains(value) else {
            feedback = "Укажите MTU от 1280 до 9000."
            return
        }
        store.mtu = value
        store.connectTimeout = connectTimeout
        store.ipv6 = ipv6
        if !dnsRemote.isEmpty { store.dnsRemote = dnsRemote }
        if !dnsDirect.isEmpty { store.dnsDirect = dnsDirect }
        reload()
        feedback = "Сохранено. Переподключите VPN, чтобы применить настройки."
    }
}
