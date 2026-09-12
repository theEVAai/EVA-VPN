package ai.theeva.vpn.bg

import ai.theeva.vpn.MainActivity
import ai.theeva.vpn.R
import ai.theeva.vpn.core.ConfigBuilder
import ai.theeva.vpn.core.Store
import android.app.Notification as AndroidNotification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.ConnectivityManager
import android.net.LinkProperties
import android.net.Network
import android.net.NetworkCapabilities
import android.net.VpnService
import android.os.Build
import android.util.Log
import androidx.core.app.NotificationCompat
import io.nekohasekai.libbox.CommandServer
import io.nekohasekai.libbox.CommandServerHandler
import io.nekohasekai.libbox.ConnectionOwner
import io.nekohasekai.libbox.InterfaceUpdateListener
import io.nekohasekai.libbox.Libbox
import io.nekohasekai.libbox.LocalDNSTransport
import io.nekohasekai.libbox.Notification as BoxNotification
import io.nekohasekai.libbox.OverrideOptions
import io.nekohasekai.libbox.PlatformInterface
import io.nekohasekai.libbox.SetupOptions
import io.nekohasekai.libbox.StringIterator
import io.nekohasekai.libbox.SystemProxyStatus
import io.nekohasekai.libbox.TunOptions
import io.nekohasekai.libbox.WIFIState
import io.nekohasekai.libbox.NetworkInterface as BoxNetworkInterface
import io.nekohasekai.libbox.NetworkInterfaceIterator
import java.io.File
import java.net.InetSocketAddress

/**
 * Туннель.
 *
 * Здесь сходятся три роли, и это не случайность, а требование библиотеки:
 *
 *   VpnService          — системная служба Android, она даёт файловый
 *                         дескриптор туннеля и умеет protect();
 *   PlatformInterface   — ядро спрашивает у нас всё, чего само про телефон
 *                         не знает: открыть туннель, какие есть сети,
 *                         защитить сокет от зацикливания;
 *   CommandServerHandler— ядро сообщает нам о своих событиях: остановиться,
 *                         перезагрузиться, записать в журнал.
 *
 * Ключевой момент, из-за которого туннель обычно не работает у тех, кто
 * делает это впервые: сокеты самого ядра нужно вывести из туннеля через
 * protect(). Иначе соединение с сервером уходит в туннель, который это
 * соединение и обслуживает, — и всё встаёт намертво.
 */
class EvaVpnService : VpnService(), PlatformInterface, CommandServerHandler {

    companion object {
        private const val TAG = "EvaVpn"
        private const val CHANNEL = "eva-vpn"
        private const val NOTIFICATION_ID = 1

        const val ACTION_START = "ai.theeva.vpn.START"
        const val ACTION_STOP = "ai.theeva.vpn.STOP"

        /** Состояние для окна: простое наблюдаемое поле без лишних зависимостей. */
        @Volatile
        var status: Status = Status.Stopped
            private set

        @Volatile
        var lastError: String? = null
            private set

        private val listeners = mutableSetOf<(Status, String?) -> Unit>()

        fun observe(listener: (Status, String?) -> Unit) {
            synchronized(listeners) { listeners.add(listener) }
            listener(status, lastError)
        }

        fun unobserve(listener: (Status, String?) -> Unit) {
            synchronized(listeners) { listeners.remove(listener) }
        }

        private fun setStatus(s: Status, error: String? = null) {
            status = s
            lastError = error
            val copy = synchronized(listeners) { listeners.toList() }
            copy.forEach { it(s, error) }
        }
    }

    enum class Status { Stopped, Starting, Started, Stopping }

    private var commandServer: CommandServer? = null
    private var tunFd: android.os.ParcelFileDescriptor? = null
    private var interfaceListener: InterfaceUpdateListener? = null
    private var networkCallback: ConnectivityManager.NetworkCallback? = null

    private val connectivity: ConnectivityManager
        get() = getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager

    /* ------------------------------------------------------------------ */
    /* Жизненный цикл службы                                               */
    /* ------------------------------------------------------------------ */

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> {
                stopTunnel()
                return START_NOT_STICKY
            }
            else -> startTunnel()
        }
        return START_STICKY
    }

    override fun onDestroy() {
        stopTunnel()
        super.onDestroy()
    }

    /** Человек отключил VPN из системных настроек. */
    override fun onRevoke() {
        stopTunnel()
        super.onRevoke()
    }

    private fun startTunnel() {
        if (status == Status.Started || status == Status.Starting) return
        setStatus(Status.Starting)

        createChannel()
        startForegroundSafely(getString(R.string.status_starting))

        try {
            val store = Store(this)
            val profile = store.activeProfile()
                ?: throw IllegalStateException(getString(R.string.error_no_key))

            // Рабочие каталоги ядра: кэш, временные файлы, состояние.
            val setup = SetupOptions()
            setup.basePath = filesDir.absolutePath
            setup.workingPath = File(filesDir, "work").also { it.mkdirs() }.absolutePath
            setup.tempPath = cacheDir.absolutePath
            // На Android стек горутин нужно поправлять — иначе падение в native.
            setup.fixAndroidStack = true
            Libbox.setup(setup)
            Libbox.redirectStderr(File(filesDir, "core.log").absolutePath)

            val config = ConfigBuilder.buildJson(profile, store.configOptions())
            Libbox.checkConfig(config)

            val server = Libbox.newCommandServer(this, this)
            server.start()
            commandServer = server

            server.startOrReloadService(config, buildOverrides(store))

            setStatus(Status.Started)
            startForegroundSafely(getString(R.string.status_connected, profile.name))
        } catch (e: Exception) {
            Log.e(TAG, "запуск не удался", e)
            stopTunnel(e.message ?: e.toString())
        }
    }

    /**
     * Раздельное туннелирование. На Android оно задаётся списком пакетов
     * при запуске, а не правилами в конфигурации: путей к программам,
     * по которым мы различаем их на компьютере, здесь нет.
     */
    private fun buildOverrides(store: Store): OverrideOptions {
        val o = OverrideOptions()
        val apps = store.splitApps()
        if (apps.isNotEmpty()) {
            when (store.splitMode()) {
                Store.SPLIT_INCLUDE ->
                    // себя добавляем всегда: иначе приложение не достучится
                    // до сайта за ключом, находясь снаружи собственного туннеля
                    o.includePackage = StringArray(apps + packageName)
                Store.SPLIT_EXCLUDE ->
                    o.excludePackage = StringArray(apps - packageName)
                else -> {}
            }
        }
        return o
    }

    private fun stopTunnel(error: String? = null) {
        if (status == Status.Stopped && error == null) return
        setStatus(Status.Stopping, error)

        try {
            commandServer?.closeService()
        } catch (e: Exception) {
            Log.w(TAG, "остановка ядра", e)
        }
        try {
            commandServer?.close()
        } catch (e: Exception) {
            Log.w(TAG, "закрытие командного сервера", e)
        }
        commandServer = null

        try {
            tunFd?.close()
        } catch (e: Exception) {
            Log.w(TAG, "закрытие дескриптора", e)
        }
        tunFd = null

        stopNetworkMonitor()

        setStatus(Status.Stopped, error)
        stopForegroundCompat()
        stopSelf()
    }

    /* ------------------------------------------------------------------ */
    /* PlatformInterface: что ядро спрашивает у телефона                   */
    /* ------------------------------------------------------------------ */

    /** Открыть туннель и вернуть дескриптор. Это сердце связки. */
    override fun openTun(options: TunOptions): Int {
        if (prepare(this) != null) error("нет разрешения на VPN")

        val builder = Builder()
            .setSession("EVA VPN")
            .setMtu(options.mtu)

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) builder.setMetered(false)

        val inet4 = options.inet4Address
        while (inet4.hasNext()) {
            val a = inet4.next()
            builder.addAddress(a.address(), a.prefix())
        }
        val inet6 = options.inet6Address
        while (inet6.hasNext()) {
            val a = inet6.next()
            builder.addAddress(a.address(), a.prefix())
        }

        if (options.autoRoute) {
            // Забираем весь трафик: 0.0.0.0/0 и ::/0.
            builder.addRoute("0.0.0.0", 0)
            if (options.inet6Address.hasNext()) builder.addRoute("::", 0)

            val dns = try {
                options.dnsServerAddress?.value.orEmpty()
            } catch (e: Exception) {
                ""
            }
            if (dns.isNotEmpty()) builder.addDnsServer(dns)
        }

        // Списки приложений приходят из OverrideOptions и попадают сюда.
        val include = options.includePackage
        while (include.hasNext()) {
            val pkg = include.next()
            try {
                builder.addAllowedApplication(pkg)
            } catch (e: Exception) {
                // приложение удалили — не повод не поднимать туннель
                Log.w(TAG, "нет такого приложения: $pkg")
            }
        }
        val exclude = options.excludePackage
        while (exclude.hasNext()) {
            val pkg = exclude.next()
            try {
                builder.addDisallowedApplication(pkg)
            } catch (e: Exception) {
                Log.w(TAG, "нет такого приложения: $pkg")
            }
        }

        val pfd = builder.establish() ?: error("система не дала дескриптор туннеля")
        tunFd = pfd
        return pfd.fd
    }

    /**
     * Вывести сокет ядра из туннеля.
     *
     * Без этого соединение до сервера уходит в туннель, который сам же
     * этим соединением и живёт. Трафик встаёт, а причина не видна в журнале.
     */
    override fun autoDetectInterfaceControl(fd: Int) {
        protect(fd)
    }

    override fun usePlatformAutoDetectInterfaceControl(): Boolean = true

    override fun useProcFS(): Boolean = Build.VERSION.SDK_INT < Build.VERSION_CODES.Q

    override fun findConnectionOwner(
        ipProtocol: Int,
        sourceAddress: String,
        sourcePort: Int,
        destinationAddress: String,
        destinationPort: Int
    ): ConnectionOwner {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) error("нужен Android 10 и новее")
        val uid = connectivity.getConnectionOwnerUid(
            ipProtocol,
            InetSocketAddress(sourceAddress, sourcePort),
            InetSocketAddress(destinationAddress, destinationPort)
        )
        if (uid == android.os.Process.INVALID_UID) error("владелец соединения не найден")
        val names = packageManager.getPackagesForUid(uid)?.toList() ?: emptyList()
        val owner = ConnectionOwner()
        owner.userId = uid
        owner.userName = names.firstOrNull() ?: ""
        owner.setAndroidPackageNames(StringArray(names))
        return owner
    }

    override fun getInterfaces(): NetworkInterfaceIterator {
        val out = ArrayList<BoxNetworkInterface>()
        for (network in connectivity.allNetworks) {
            val caps = connectivity.getNetworkCapabilities(network) ?: continue
            val link: LinkProperties = connectivity.getLinkProperties(network) ?: continue
            val name = link.interfaceName ?: continue

            val item = BoxNetworkInterface()
            item.name = name
            item.type = when {
                caps.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) -> Libbox.InterfaceTypeWIFI
                caps.hasTransport(NetworkCapabilities.TRANSPORT_CELLULAR) -> Libbox.InterfaceTypeCellular
                caps.hasTransport(NetworkCapabilities.TRANSPORT_ETHERNET) -> Libbox.InterfaceTypeEthernet
                else -> Libbox.InterfaceTypeOther
            }
            item.metered = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                !caps.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED)
            } else {
                connectivity.isActiveNetworkMetered
            }

            val jvmInterface = try {
                java.net.NetworkInterface.getByName(name)
            } catch (e: Exception) {
                null
            }
            item.index = jvmInterface?.index ?: -1
            item.mtu = try {
                jvmInterface?.mtu ?: 1500
            } catch (e: Exception) {
                1500
            }
            item.addresses = StringArray(
                link.linkAddresses.map { it.toString() }
            )
            item.dnsServer = StringArray(link.dnsServers.mapNotNull { it.hostAddress })
            out.add(item)
        }
        return InterfaceArray(out)
    }

    override fun startDefaultInterfaceMonitor(listener: InterfaceUpdateListener) {
        interfaceListener = listener
        val callback = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) = notifyDefault(network)
            override fun onLost(network: Network) {
                listener.updateDefaultInterface("", -1, false, false)
            }

            override fun onCapabilitiesChanged(network: Network, caps: NetworkCapabilities) =
                notifyDefault(network)
        }
        networkCallback = callback
        try {
            connectivity.registerDefaultNetworkCallback(callback)
        } catch (e: Exception) {
            Log.w(TAG, "слежение за сетью не включилось", e)
        }
        connectivity.activeNetwork?.let { notifyDefault(it) }
    }

    private fun notifyDefault(network: Network) {
        val listener = interfaceListener ?: return
        val link = connectivity.getLinkProperties(network)
        val caps = connectivity.getNetworkCapabilities(network)
        val name = link?.interfaceName ?: return
        val index = try {
            java.net.NetworkInterface.getByName(name)?.index ?: -1
        } catch (e: Exception) {
            -1
        }
        val expensive = caps?.hasCapability(NetworkCapabilities.NET_CAPABILITY_NOT_METERED) == false
        val constrained = false
        listener.updateDefaultInterface(name, index, expensive, constrained)
    }

    override fun closeDefaultInterfaceMonitor(listener: InterfaceUpdateListener) {
        stopNetworkMonitor()
    }

    private fun stopNetworkMonitor() {
        networkCallback?.let {
            try {
                connectivity.unregisterNetworkCallback(it)
            } catch (e: Exception) {
                // уже снят
            }
        }
        networkCallback = null
        interfaceListener = null
    }

    override fun includeAllNetworks(): Boolean = false

    override fun underNetworkExtension(): Boolean = false

    override fun clearDNSCache() {
        // системного кэша имён, который можно сбросить, на Android нет
    }

    override fun readWIFIState(): WIFIState? = null

    /** Имена решает само ядро: свой преобразователь не подставляем. */
    override fun localDNSTransport(): LocalDNSTransport? = null

    override fun systemCertificates(): StringIterator = StringArray(emptyList())

    override fun sendNotification(notification: BoxNotification) {
        val manager = getSystemService(NotificationManager::class.java) ?: return
        val n = NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(notification.title)
            .setContentText(notification.body)
            .setAutoCancel(true)
            .build()
        manager.notify(notification.identifier.hashCode(), n)
    }

    /* ------------------------------------------------------------------ */
    /* CommandServerHandler: что ядро сообщает нам                         */
    /* ------------------------------------------------------------------ */

    override fun serviceStop() {
        stopTunnel()
    }

    override fun serviceReload() {
        // перезапуск по требованию ядра: поднимаем заново с текущими настройками
        stopTunnel()
        startTunnel()
    }

    override fun getSystemProxyStatus(): SystemProxyStatus =
        SystemProxyStatus().apply {
            available = false
            enabled = false
        }

    override fun setSystemProxyEnabled(enabled: Boolean) {
        // на Android системный прокси приложению не подчиняется
    }

    override fun writeDebugMessage(message: String) {
        Log.d(TAG, message)
    }

    /* ------------------------------------------------------------------ */
    /* Уведомление                                                         */
    /* ------------------------------------------------------------------ */

    private fun createChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
        val manager = getSystemService(NotificationManager::class.java) ?: return
        if (manager.getNotificationChannel(CHANNEL) != null) return
        manager.createNotificationChannel(
            NotificationChannel(CHANNEL, "EVA VPN", NotificationManager.IMPORTANCE_LOW).apply {
                setShowBadge(false)
            }
        )
    }

    private fun startForegroundSafely(text: String) {
        val open = PendingIntent.getActivity(
            this, 0,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_IMMUTABLE
        )
        val stop = PendingIntent.getService(
            this, 1,
            Intent(this, EvaVpnService::class.java).setAction(ACTION_STOP),
            PendingIntent.FLAG_IMMUTABLE
        )
        val notification: AndroidNotification = NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_notification)
            .setContentTitle(getString(R.string.app_name))
            .setContentText(text)
            .setContentIntent(open)
            .addAction(0, getString(R.string.action_disconnect), stop)
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .build()

        try {
            startForeground(NOTIFICATION_ID, notification)
        } catch (e: Exception) {
            // на Android 14+ служба без разрешения на уведомления просто
            // не станет передним планом; туннель при этом работает
            Log.w(TAG, "передний план недоступен", e)
        }
    }

    private fun stopForegroundCompat() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
            stopForeground(STOP_FOREGROUND_REMOVE)
        } else {
            @Suppress("DEPRECATION")
            stopForeground(true)
        }
    }
}

/** Список строк в виде, понятном ядру. */
class StringArray(private val items: List<String>) : StringIterator {
    private var index = 0
    override fun hasNext(): Boolean = index < items.size
    override fun next(): String = items[index++]
    override fun len(): Int = items.size
}

/** Список сетевых интерфейсов в виде, понятном ядру. */
class InterfaceArray(private val items: List<BoxNetworkInterface>) : NetworkInterfaceIterator {
    private var index = 0
    override fun hasNext(): Boolean = index < items.size
    override fun next(): BoxNetworkInterface = items[index++]
}
