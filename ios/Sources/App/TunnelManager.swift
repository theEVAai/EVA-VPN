import Combine
import Foundation
import NetworkExtension

/// Управление туннелем из приложения.
///
/// На iOS приложение не запускает туннель напрямую: оно заводит в системе
/// профиль VPN, а система поднимает расширение. Профиль появляется в
/// «Настройки → VPN», и человек один раз подтверждает его установку.
@MainActor
final class TunnelManager: ObservableObject {

    static let shared = TunnelManager()

    @Published private(set) var status: NEVPNStatus = .invalid
    @Published private(set) var lastError: String?

    private var manager: NETunnelProviderManager?
    private var observer: NSObjectProtocol?

    private init() {
        observer = NotificationCenter.default.addObserver(
            forName: .NEVPNStatusDidChange,
            object: nil,
            queue: .main
        ) { [weak self] notification in
            guard let connection = notification.object as? NEVPNConnection else { return }
            Task { @MainActor in self?.status = connection.status }
        }
    }

    var isConnected: Bool { status == .connected }
    var isBusy: Bool { status == .connecting || status == .disconnecting || status == .reasserting }

    /// Загружает профиль VPN или создаёт его при первом запуске.
    func prepare() async {
        do {
            let all = try await NETunnelProviderManager.loadAllFromPreferences()
            let existing = all.first ?? NETunnelProviderManager()

            let proto = (existing.protocolConfiguration as? NETunnelProviderProtocol)
                ?? NETunnelProviderProtocol()
            // адрес сервера система показывает в настройках; настоящий
            // адрес берётся из ключа, поэтому здесь просто имя сервиса
            proto.serverAddress = "EVA VPN"
            proto.providerBundleIdentifier = "ai.theeva.vpn.tunnel"

            existing.protocolConfiguration = proto
            existing.localizedDescription = "EVA VPN"
            existing.isEnabled = true

            try await existing.saveToPreferences()
            // перечитываем: система возвращает профиль с заполненными полями
            try await existing.loadFromPreferences()

            manager = existing
            status = existing.connection.status
            lastError = nil
        } catch {
            lastError = error.localizedDescription
        }
    }

    func start() async {
        if manager == nil { await prepare() }
        guard let manager else { return }
        do {
            try manager.connection.startVPNTunnel()
            lastError = nil
        } catch {
            lastError = error.localizedDescription
        }
    }

    func stop() {
        manager?.connection.stopVPNTunnel()
    }

    func toggle() async {
        if isConnected || isBusy { stop() } else { await start() }
    }
}

extension NEVPNStatus {
    /// Название состояния так, как его стоит показать человеку.
    var title: String {
        switch self {
        case .connected: return "ЗАЩИЩЕНО"
        case .connecting: return "ПОДКЛЮЧЕНИЕ"
        case .disconnecting: return "ОТКЛЮЧЕНИЕ"
        case .reasserting: return "ПЕРЕПОДКЛЮЧЕНИЕ"
        default: return "НЕ ЗАЩИЩЕНО"
        }
    }
}
