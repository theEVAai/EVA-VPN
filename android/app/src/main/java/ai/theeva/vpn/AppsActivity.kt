package ai.theeva.vpn

import ai.theeva.vpn.core.Store
import ai.theeva.vpn.ui.Ui
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.os.Bundle
import android.widget.LinearLayout
import android.widget.RadioButton
import android.widget.RadioGroup
import androidx.appcompat.app.AppCompatActivity
import java.util.concurrent.Executors

/**
 * Раздельное туннелирование по приложениям.
 *
 * На компьютере мы различаем программы по имени файла; на Android такого
 * нет — приложения различаются именем пакета, а система сама умеет пускать
 * или не пускать их в туннель. Поэтому здесь список пакетов, а не правил:
 * он передаётся ядру при запуске и применяется самим Android.
 */
class AppsActivity : AppCompatActivity() {

    private lateinit var store: Store
    private lateinit var listCard: LinearLayout

    private val selected = HashSet<String>()
    private val loader = Executors.newSingleThreadExecutor()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        store = Store(this)
        selected.addAll(store.splitApps())

        val (scroll, column) = Ui.screen(this)
        setContentView(scroll)

        column.addView(Ui.title(this, getString(R.string.apps_title)))
        column.addView(Ui.hint(this, getString(R.string.apps_hint)))

        /* ---------------- режим ---------------- */
        val group = RadioGroup(this).apply { orientation = RadioGroup.VERTICAL }
        val modes = listOf(
            Store.SPLIT_OFF to getString(R.string.apps_mode_off),
            Store.SPLIT_EXCLUDE to getString(R.string.apps_mode_exclude),
            Store.SPLIT_INCLUDE to getString(R.string.apps_mode_include)
        )
        val current = store.splitMode()
        modes.forEachIndexed { index, (mode, title) ->
            val button = RadioButton(this).apply {
                text = title
                id = index + 1000
                isChecked = mode == current
                setTextColor(Ui.color(this@AppsActivity, R.color.cream))
                textSize = 14f
            }
            group.addView(button)
        }
        group.setOnCheckedChangeListener { _, checkedId ->
            val mode = modes.getOrNull(checkedId - 1000)?.first ?: Store.SPLIT_OFF
            store.setSplitMode(mode)
        }
        column.addView(group)

        column.addView(Ui.label(this, "// программы"))
        listCard = Ui.card(this)
        column.addView(listCard)
        listCard.addView(Ui.row(this, "Загружаю список…", null, null))

        loadApps()
    }

    override fun onDestroy() {
        loader.shutdownNow()
        super.onDestroy()
    }

    /** Список программ читается в фоне: на телефоне их бывают сотни. */
    private fun loadApps() {
        loader.execute {
            val pm = packageManager
            val apps = try {
                pm.getInstalledApplications(PackageManager.GET_META_DATA)
            } catch (e: Exception) {
                emptyList<ApplicationInfo>()
            }

            val visible = apps
                .filter { it.packageName != packageName }
                // без доступа в интернет приложению в туннеле делать нечего
                .filter { hasInternet(pm, it.packageName) }
                .map { it.packageName to pm.getApplicationLabel(it).toString() }
                .sortedBy { it.second.lowercase() }

            runOnUiThread { renderApps(visible) }
        }
    }

    private fun hasInternet(pm: PackageManager, pkg: String): Boolean = try {
        val info = pm.getPackageInfo(pkg, PackageManager.GET_PERMISSIONS)
        info.requestedPermissions?.contains(android.Manifest.permission.INTERNET) == true
    } catch (e: Exception) {
        false
    }

    private fun renderApps(apps: List<Pair<String, String>>) {
        listCard.removeAllViews()
        if (apps.isEmpty()) {
            listCard.addView(Ui.row(this, "Ничего не нашлось", null, null))
            return
        }

        apps.forEachIndexed { index, (pkg, label) ->
            if (index > 0) listCard.addView(Ui.divider(this))
            val box = Ui.check(this, "", selected.contains(pkg))
            box.setOnCheckedChangeListener { _, checked ->
                if (checked) selected.add(pkg) else selected.remove(pkg)
                store.setSplitApps(selected)
            }
            listCard.addView(Ui.row(this, label, pkg, box))
        }
    }
}
