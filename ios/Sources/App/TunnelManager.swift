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
    @Published private(set) var preparing = false
    private static let providerID = "ai.theeva.vpn.tunnel"

    private var manager: NETunnelProviderManager?
    private var observer: NSObjectProtocol?

    private init() {
        observer = NotificationCenter.default.addObserver(
            forName: .NEVPNStatusDidChange,
            object: nil,
            queue: .main
        ) { [weak self] notification in
            guard let connection = notification.object as? NEVPNConnection else { return }
            Task { @MainActor in
                guard let self, connection === self.manager?.connection else { return }
                self.status = connection.status
            }
        }
    }

    var isConnected: Bool { status == .connected }
    var isBusy: Bool { preparing || status == .connecting || status == .disconnecting || status == .reasserting }

    /// Read existing state without asking for VPN permission on app launch.
    func load() async {
        do {
            let all = try await NETunnelProviderManager.loadAllFromPreferences()
            manager = all.first { ($0.protocolConfiguration as? NETunnelProviderProtocol)?.providerBundleIdentifier == Self.providerID }
            status = manager?.connection.status ?? .invalid
        } catch { lastError = error.localizedDescription }
    }

    /// Загружает профиль VPN или создаёт его при первом запуске.
    func prepare() async {
        do {
            let all = try await NETunnelProviderManager.loadAllFromPreferences()
            let existing = all.first {
                ($0.protocolConfiguration as? NETunnelProviderProtocol)?.providerBundleIdentifier == Self.providerID
            } ?? NETunnelProviderManager()

            let proto = (existing.protocolConfiguration as? NETunnelProviderProtocol)
                ?? NETunnelProviderProtocol()
            // адрес сервера система показывает в настройках; настоящий
            // адрес берётся из ключа, поэтому здесь просто имя сервиса
            proto.serverAddress = "EVA VPN"
            proto.providerBundleIdentifier = Self.providerID

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
        guard !isBusy && !isConnected else { return }
        preparing = true
        defer { preparing = false }
        await prepare()
        guard lastError == nil else { return }
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
        case .connected: return "VPN ВКЛЮЧЁН"
        case .connecting: return "ПОДКЛЮЧЕНИЕ"
        case .disconnecting: return "ОТКЛЮЧЕНИЕ"
        case .reasserting: return "ПЕРЕПОДКЛЮЧЕНИЕ"
        default: return "НЕ ЗАЩИЩЕНО"
        }
    }
}
