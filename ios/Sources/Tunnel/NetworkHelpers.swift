import Foundation
import Libbox
import Network
import Darwin

/// Слежение за сетью по умолчанию.
///
/// Ядру нужно знать, когда телефон переехал с Wi-Fi на сотовую связь: без
/// этого туннель после перехода пытается идти через исчезнувший интерфейс
/// и молча встаёт. На телефоне такие переходы происходят постоянно, поэтому
/// это не мелочь, а обязательная часть.
final class NWPathMonitorBox {

    private let listener: LibboxInterfaceUpdateListenerProtocol
    private let monitor = NWPathMonitor()
    private let queue = DispatchQueue(label: "ai.theeva.vpn.path")

    init(listener: LibboxInterfaceUpdateListenerProtocol) {
        self.listener = listener
    }

    func start() {
        monitor.pathUpdateHandler = { [weak self] path in
            self?.notify(path)
        }
        monitor.start(queue: queue)
    }

    func stop() {
        monitor.cancel()
    }

    private func notify(_ path: NWPath) {
        guard path.status == .satisfied else {
            listener.updateDefaultInterface("", interfaceIndex: -1, isExpensive: false, isConstrained: false)
            return
        }
        let name = path.availableInterfaces.first {
            path.usesInterfaceType($0.type) && !$0.name.hasPrefix("utun") && !$0.name.hasPrefix("ipsec")
        }?.name ?? ""
        let index = name.isEmpty ? -1 : Int32(if_nametoindex(name))
        listener.updateDefaultInterface(
            name,
            interfaceIndex: index,
            isExpensive: path.isExpensive,
            isConstrained: path.isConstrained
        )
    }
}

/// Перечень сетевых интерфейсов устройства.
enum NetworkInterfaceList {

    struct Item {
        let name: String
        let index: Int32
        let mtu: Int32
        let type: Int32
        var flags: Int32
        var addresses: [String]
    }

    /// Возвращает интерфейсы, о которых знает система.
    ///
    /// MTU берём общим значением 1500: точное значение доступно только
    /// через ioctl, а ядру здесь важны имя, номер и вид интерфейса.
    static func current() -> [Item] {
        var out: [Item] = []

        var head: UnsafeMutablePointer<ifaddrs>?
        guard getifaddrs(&head) == 0, let first = head else { return out }
        defer { freeifaddrs(head) }

        var cursor: UnsafeMutablePointer<ifaddrs>? = first
        while let current = cursor {
            defer { cursor = current.pointee.ifa_next }

            let name = String(cString: current.pointee.ifa_name)
            let nativeFlags = current.pointee.ifa_flags
            guard nativeFlags & UInt32(IFF_UP) != 0,
                  nativeFlags & UInt32(IFF_LOOPBACK) == 0,
                  !name.hasPrefix("utun"), !name.hasPrefix("ipsec") else { continue }
            var flags: Int32 = 1 // Go net.FlagUp; Darwin's bit values differ.
            if nativeFlags & UInt32(IFF_BROADCAST) != 0 { flags |= 2 }
            if nativeFlags & UInt32(IFF_POINTOPOINT) != 0 { flags |= 8 }
            if nativeFlags & UInt32(IFF_MULTICAST) != 0 { flags |= 16 }
            if nativeFlags & UInt32(IFF_RUNNING) != 0 { flags |= 32 }
            let address = prefix(current.pointee)
            if let index = out.firstIndex(where: { $0.name == name }) {
                if let address, !out[index].addresses.contains(address) { out[index].addresses.append(address) }
            } else {
                out.append(Item(name: name, index: Int32(if_nametoindex(name)), mtu: 1500,
                                type: kind(of: name), flags: flags, addresses: address.map { [$0] } ?? []))
            }
        }
        return out
    }

    private static func prefix(_ item: ifaddrs) -> String? {
        guard let address = item.ifa_addr, let mask = item.ifa_netmask else { return nil }
        let family = Int32(address.pointee.sa_family)
        guard family == AF_INET || family == AF_INET6 else { return nil }
        var buffer = [CChar](repeating: 0, count: Int(NI_MAXHOST))
        let capacity = socklen_t(buffer.count)
        guard getnameinfo(address, socklen_t(address.pointee.sa_len), &buffer,
                          capacity, nil, 0, NI_NUMERICHOST) == 0 else { return nil }
        let host = String(cString: buffer).components(separatedBy: "%")[0]
        let bits: Int
        if family == AF_INET {
            bits = UnsafeRawPointer(mask).assumingMemoryBound(to: sockaddr_in.self).pointee.sin_addr.s_addr.nonzeroBitCount
        } else {
            let value = UnsafeRawPointer(mask).assumingMemoryBound(to: sockaddr_in6.self).pointee.sin6_addr
            bits = withUnsafeBytes(of: value) { bytes in bytes.reduce(0) { $0 + $1.nonzeroBitCount } }
        }
        return "\(host)/\(bits)"
    }

    /// Вид интерфейса по его имени — так его определяет сама система.
    private static func kind(of name: String) -> Int32 {
        if name.hasPrefix("en") { return LibboxInterfaceTypeWIFI }
        if name.hasPrefix("pdp_ip") { return LibboxInterfaceTypeCellular }
        if name.hasPrefix("utun") || name.hasPrefix("ipsec") { return LibboxInterfaceTypeOther }
        return LibboxInterfaceTypeOther
    }
}
