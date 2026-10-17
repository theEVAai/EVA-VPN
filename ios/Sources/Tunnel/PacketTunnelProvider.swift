import Foundation
import Libbox
import NetworkExtension
import os

/// Туннель на iOS.
///
/// Здесь, как и на Android, сходятся три роли, и по той же причине:
///
///   NEPacketTunnelProvider          — системная часть, через неё задаются
///                                     настройки сети и появляется туннель;
///   LibboxPlatformInterfaceProtocol — ядро спрашивает у нас то, чего само
///                                     про устройство не знает;
///   LibboxCommandServerHandler…     — ядро сообщает нам о своих событиях.
///
/// Главное отличие от Android: там система отдаёт файловый дескриптор
/// напрямую из VpnService.Builder.establish(). Здесь NetworkExtension его
/// не отдаёт — сначала применяются настройки сети, а потом дескриптор
/// разыскивается среди открытых через LibboxGetTunnelFileDescriptor().
///
/// Второе отличие: раздельного туннелирования по программам на iOS нет.
/// Apple не даёт обычному приложению делить трафик по программам — только
/// управлению корпоративными устройствами. Поэтому здесь работают правила
/// по адресам, и списки includePackage/excludePackage не заполняются.
class EvaTunnelProvider: NEPacketTunnelProvider,
                         LibboxPlatformInterfaceProtocol,
                         LibboxCommandServerHandlerProtocol {

    private var commandServer: LibboxCommandServer?
    private var interfaceMonitor: NWPathMonitorBox?
    private let log = Logger(subsystem: "ai.theeva.vpn", category: "tunnel")

    /* ------------------------------------------------------------------ */
    /* Жизненный цикл                                                      */
    /* ------------------------------------------------------------------ */

    override func startTunnel(options _: [String: NSObject]?) async throws {
        let store = Store()
        guard let profile = store.activeProfile else {
            throw NSError(
                domain: "ai.theeva.vpn",
                code: 1,
                userInfo: [NSLocalizedDescriptionKey: "Сначала добавьте ключ доступа"]
            )
        }

        let config = try ConfigBuilder.buildJSON(profile: profile, options: store.configOptions)

        // Рабочие каталоги ядра — внутри общей группы, чтобы их видело
        // и приложение (например, для журнала).
        guard let base = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: Store.appGroup) else {
            throw ParseError(message: "Не настроена App Group group.ai.theeva.vpn для приложения и расширения.")
        }

        let work = base.appendingPathComponent("work", isDirectory: true)
        try FileManager.default.createDirectory(at: work, withIntermediateDirectories: true)

        let setup = LibboxSetupOptions()
        setup.basePath = base.path
        setup.workingPath = work.path
        setup.tempPath = FileManager.default.temporaryDirectory.path

        var setupError: NSError?
        LibboxSetup(setup, &setupError)
        if let setupError { throw setupError }

        var serverError: NSError?
        guard let server = LibboxNewCommandServer(self, self, &serverError) else {
            throw serverError ?? NSError(
                domain: "ai.theeva.vpn", code: 2,
                userInfo: [NSLocalizedDescriptionKey: "Не удалось создать службу ядра"]
            )
        }
        commandServer = server
        do {
            try server.start()
            try server.startOrReloadService(config, options: LibboxOverrideOptions())
        } catch {
            try? server.closeService()
            server.close()
            commandServer = nil
            interfaceMonitor?.stop()
            interfaceMonitor = nil
            throw error
        }

        log.info("туннель поднят")
    }

    override func stopTunnel(with reason: NEProviderStopReason) async {
        log.info("остановка туннеля: \(reason.rawValue, privacy: .public)")
        try? commandServer?.closeService()
        commandServer?.close()
        commandServer = nil
        interfaceMonitor?.stop()
        interfaceMonitor = nil
    }

    /* ------------------------------------------------------------------ */
    /* Интерфейс платформы                                                 */
    /* ------------------------------------------------------------------ */

    func openTun(_ options: LibboxTunOptionsProtocol?, ret0_: UnsafeMutablePointer<Int32>?) throws {
        guard let options, let ret0_ else {
            throw NSError(domain: "ai.theeva.vpn", code: 3,
                          userInfo: [NSLocalizedDescriptionKey: "нет параметров туннеля"])
        }

        let settings = NEPacketTunnelNetworkSettings(tunnelRemoteAddress: "127.0.0.1")
        settings.mtu = NSNumber(value: options.getMTU())

        /* --- адреса --- */
        var v4Addresses: [String] = []
        var v4Masks: [String] = []
        let inet4 = options.getInet4Address()
        while inet4?.hasNext() == true, let prefix = inet4?.next() {
            v4Addresses.append(prefix.address())
            v4Masks.append(prefix.mask())
        }
        if !v4Addresses.isEmpty {
            let ipv4 = NEIPv4Settings(addresses: v4Addresses, subnetMasks: v4Masks)
            // Забираем весь трафик: маршрут по умолчанию.
            ipv4.includedRoutes = [NEIPv4Route.default()]
            settings.ipv4Settings = ipv4
        }

        var v6Addresses: [String] = []
        var v6Prefixes: [NSNumber] = []
        let inet6 = options.getInet6Address()
        while inet6?.hasNext() == true, let prefix = inet6?.next() {
            v6Addresses.append(prefix.address())
            v6Prefixes.append(NSNumber(value: prefix.prefix()))
        }
        if !v6Addresses.isEmpty {
            let ipv6 = NEIPv6Settings(addresses: v6Addresses, networkPrefixLengths: v6Prefixes)
            ipv6.includedRoutes = [NEIPv6Route.default()]
            settings.ipv6Settings = ipv6
        }

        /* --- DNS --- */
        if let box = try? options.getDNSServerAddress(), !box.value.isEmpty {
            let dns = NEDNSSettings(servers: [box.value])
            // весь поиск имён уводим в туннель, иначе оператор увидит,
            // куда мы ходим, даже при работающем VPN
            dns.matchDomains = [""]
            settings.dnsSettings = dns
        }

        // Настройки применяются асинхронно, а ядро ждёт дескриптор здесь и
        // сейчас. Поэтому дожидаемся завершения семафором.
        let semaphore = DispatchSemaphore(value: 0)
        var applyError: Error?
        setTunnelNetworkSettings(settings) { error in
            applyError = error
            semaphore.signal()
        }
        semaphore.wait()
        if let applyError { throw applyError }

        // Дескриптор система напрямую не отдаёт: ядро находит его само
        // среди открытых utun-сокетов.
        let fd = LibboxGetTunnelFileDescriptor()
        if fd < 0 {
            throw NSError(domain: "ai.theeva.vpn", code: 4,
                          userInfo: [NSLocalizedDescriptionKey: "не найден дескриптор туннеля"])
        }
        ret0_.pointee = fd
    }

    /// На iOS сокеты ядра выводит из туннеля сама система.
    func usePlatformAutoDetectControl() -> Bool { false }

    func autoDetectControl(_: Int32) throws {}

    func useProcFS() -> Bool { false }

    func findConnectionOwner(
        _: Int32, sourceAddress _: String?, sourcePort _: Int32,
        destinationAddress _: String?, destinationPort _: Int32
    ) throws -> LibboxConnectionOwner {
        // На iOS узнать владельца соединения приложению не дают.
        throw NSError(domain: "ai.theeva.vpn", code: 5,
                      userInfo: [NSLocalizedDescriptionKey: "на iOS недоступно"])
    }

    func startDefaultInterfaceMonitor(_ listener: LibboxInterfaceUpdateListenerProtocol?) throws {
        guard let listener else { return }
        let monitor = NWPathMonitorBox(listener: listener)
        interfaceMonitor = monitor
        monitor.start()
    }

    func closeDefaultInterfaceMonitor(_: LibboxInterfaceUpdateListenerProtocol?) throws {
        interfaceMonitor?.stop()
        interfaceMonitor = nil
    }

    func getInterfaces() throws -> LibboxNetworkInterfaceIteratorProtocol {
        var result: [LibboxNetworkInterface] = []
        for item in NetworkInterfaceList.current() {
            let boxed = LibboxNetworkInterface()
            boxed.name = item.name
            boxed.index = item.index
            boxed.mtu = item.mtu
            boxed.type = item.type
            boxed.flags = item.flags
            boxed.addresses = StringArray(item.addresses)
            boxed.dnsServer = StringArray([])
            result.append(boxed)
        }
        return NetworkInterfaceArray(result)
    }

    /// В расширении сети — да, мы именно в нём.
    func underNetworkExtension() -> Bool { true }

    func includeAllNetworks() -> Bool { false }

    func clearDNSCache() {}

    func readWIFIState() -> LibboxWIFIState? { nil }

    /// Имена решает само ядро.
    func localDNSTransport() -> LibboxLocalDNSTransportProtocol? { nil }

    func systemCertificates() -> LibboxStringIteratorProtocol? { StringArray([]) }

    func send(_: LibboxNotification?) throws {
        // уведомления показывает основное приложение
    }

    /* ------------------------------------------------------------------ */
    /* События от ядра                                                     */
    /* ------------------------------------------------------------------ */

    func serviceStop() throws {
        cancelTunnelWithError(nil)
    }

    func serviceReload() throws {
        guard let commandServer else { return }
        let store = Store()
        guard let profile = store.activeProfile else { return }
        let config = try ConfigBuilder.buildJSON(profile: profile, options: store.configOptions)
        try commandServer.startOrReloadService(config, options: LibboxOverrideOptions())
    }

    func getSystemProxyStatus() throws -> LibboxSystemProxyStatus {
        let status = LibboxSystemProxyStatus()
        status.available = false
        status.enabled = false
        return status
    }

    func setSystemProxyEnabled(_: Bool) throws {}

    func writeDebugMessage(_ message: String?) {
        guard let message else { return }
        log.debug("\(message, privacy: .private)")
    }
}

/* ---------------------------------------------------------------------- */
/* Мелкие вспомогательные типы                                             */
/* ---------------------------------------------------------------------- */

/// Список строк в виде, понятном ядру.
final class StringArray: NSObject, LibboxStringIteratorProtocol {
    private var items: [String]
    private var index = 0

    init(_ items: [String]) { self.items = items }

    func hasNext() -> Bool { index < items.count }
    func len() -> Int32 { Int32(items.count) }
    func next() -> String {
        defer { index += 1 }
        return index < items.count ? items[index] : ""
    }
}

/// Список сетевых интерфейсов в виде, понятном ядру.
final class NetworkInterfaceArray: NSObject, LibboxNetworkInterfaceIteratorProtocol {
    private var items: [LibboxNetworkInterface]
    private var index = 0

    init(_ items: [LibboxNetworkInterface]) { self.items = items }

    func hasNext() -> Bool { index < items.count }
    func next() -> LibboxNetworkInterface? {
        defer { index += 1 }
        return index < items.count ? items[index] : nil
    }
}
