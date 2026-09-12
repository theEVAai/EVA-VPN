import Foundation
import Libbox
import Network

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
        let name = path.availableInterfaces.first?.name ?? ""
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
    }

    /// Возвращает интерфейсы, о которых знает система.
    ///
    /// MTU берём общим значением 1500: точное значение доступно только
    /// через ioctl, а ядру здесь важны имя, номер и вид интерфейса.
    static func current() -> [Item] {
        var out: [Item] = []
        var seen = Set<String>()

        var head: UnsafeMutablePointer<ifaddrs>?
        guard getifaddrs(&head) == 0, let first = head else { return out }
        defer { freeifaddrs(head) }

        var cursor: UnsafeMutablePointer<ifaddrs>? = first
        while let current = cursor {
            defer { cursor = current.pointee.ifa_next }

            let name = String(cString: current.pointee.ifa_name)
            if seen.contains(name) { continue }
            seen.insert(name)

            out.append(
                Item(
                    name: name,
                    index: Int32(if_nametoindex(name)),
                    mtu: 1500,
                    type: kind(of: name)
                )
            )
        }
        return out
    }

    /// Вид интерфейса по его имени — так его определяет сама система.
    private static func kind(of name: String) -> Int32 {
        if name.hasPrefix("en") { return LibboxInterfaceTypeWIFI }
        if name.hasPrefix("pdp_ip") { return LibboxInterfaceTypeCellular }
        if name.hasPrefix("utun") || name.hasPrefix("ipsec") { return LibboxInterfaceTypeOther }
        return LibboxInterfaceTypeOther
    }
}
