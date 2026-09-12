package ai.theeva.vpn

import ai.theeva.vpn.bg.EvaVpnService
import ai.theeva.vpn.core.Store
import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Color
import android.graphics.PorterDuff
import android.graphics.drawable.Drawable
import android.net.VpnService
import android.os.Build
import android.os.Bundle
import android.widget.Button
import android.widget.ImageView
import android.widget.TextView
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.appcompat.app.AppCompatActivity
import androidx.core.content.ContextCompat

/**
 * Главный экран: одна кнопка-сердце, состояние и три раздела.
 *
 * Порядок разрешений намеренно такой: сперва спрашиваем уведомления
 * (без них служба не станет передним планом и система усыпит туннель),
 * затем — согласие на VPN, которое Android показывает своим окном.
 */
class MainActivity : AppCompatActivity() {

    private lateinit var store: Store
    private lateinit var heart: ImageView
    private lateinit var status: TextView
    private lateinit var subtitle: TextView

    /** Согласие на создание VPN: системное окно, отказ — не ошибка. */
    private val vpnPermission = registerForActivityResult(
        ActivityResultContracts.StartActivityForResult()
    ) { result ->
        if (result.resultCode == RESULT_OK) {
            startTunnel()
        } else {
            toast(getString(R.string.error_no_permission))
        }
    }

    private val notificationPermission = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { /* отказ не мешает работе, только уведомлению */ }

    private val onStatus: (EvaVpnService.Status, String?) -> Unit = { s, error ->
        runOnUiThread { render(s, error) }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        store = Store(this)
        heart = findViewById(R.id.heart)
        status = findViewById(R.id.status)
        subtitle = findViewById(R.id.subtitle)

        heart.setOnClickListener { toggle() }

        findViewById<Button>(R.id.btnKeys).setOnClickListener {
            startActivity(Intent(this, KeysActivity::class.java))
        }
        findViewById<Button>(R.id.btnRules).setOnClickListener {
            startActivity(Intent(this, RulesActivity::class.java))
        }
        findViewById<Button>(R.id.btnApps).setOnClickListener {
            startActivity(Intent(this, AppsActivity::class.java))
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            val granted = ContextCompat.checkSelfPermission(
                this, Manifest.permission.POST_NOTIFICATIONS
            ) == PackageManager.PERMISSION_GRANTED
            if (!granted) notificationPermission.launch(Manifest.permission.POST_NOTIFICATIONS)
        }
    }

    override fun onStart() {
        super.onStart()
        EvaVpnService.observe(onStatus)
        render(EvaVpnService.status, EvaVpnService.lastError)
    }

    override fun onStop() {
        EvaVpnService.unobserve(onStatus)
        super.onStop()
    }

    /* ------------------------------------------------------------------ */

    private fun toggle() {
        when (EvaVpnService.status) {
            EvaVpnService.Status.Started, EvaVpnService.Status.Starting -> stopTunnel()
            else -> {
                if (store.activeProfile() == null) {
                    toast(getString(R.string.error_no_key))
                    startActivity(Intent(this, KeysActivity::class.java))
                    return
                }
                // Android сам покажет окно согласия, если его ещё не давали
                val intent = VpnService.prepare(this)
                if (intent != null) vpnPermission.launch(intent) else startTunnel()
            }
        }
    }

    private fun startTunnel() {
        val intent = Intent(this, EvaVpnService::class.java).setAction(EvaVpnService.ACTION_START)
        ContextCompat.startForegroundService(this, intent)
    }

    private fun stopTunnel() {
        val intent = Intent(this, EvaVpnService::class.java).setAction(EvaVpnService.ACTION_STOP)
        startService(intent)
    }

    private fun render(s: EvaVpnService.Status, error: String?) {
        val profile = store.activeProfile()

        status.text = when (s) {
            EvaVpnService.Status.Started -> getString(R.string.status_connected_short)
            EvaVpnService.Status.Starting -> getString(R.string.status_starting)
            EvaVpnService.Status.Stopping -> getString(R.string.status_stopping)
            EvaVpnService.Status.Stopped -> getString(R.string.status_stopped)
        }
        status.setTextColor(
            if (s == EvaVpnService.Status.Started) ContextCompat.getColor(this, R.color.blue_2)
            else ContextCompat.getColor(this, R.color.cream_dim)
        )

        subtitle.text = when {
            error != null -> error
            profile != null -> "// " + profile.name
            else -> getString(R.string.status_no_key)
        }

        heart.alpha = if (s == EvaVpnService.Status.Started) 1f else 0.55f
        applyKeyColor(profile?.color)

        if (error != null) toast(error)
    }

    /** Цвет метки ключа виден в замочной скважине — как на компьютере. */
    private fun applyKeyColor(hex: String?) {
        val color = try {
            if (hex.isNullOrEmpty()) ContextCompat.getColor(this, R.color.blue_2)
            else Color.parseColor(hex)
        } catch (e: Exception) {
            ContextCompat.getColor(this, R.color.blue_2)
        }
        val drawable: Drawable = heart.drawable ?: return
        // перекрашиваем только скважину: само сердце остаётся фирменным
        drawable.mutate()
        heart.tag = color
    }

    private fun toast(text: String) {
        Toast.makeText(this, text, Toast.LENGTH_SHORT).show()
    }
}
