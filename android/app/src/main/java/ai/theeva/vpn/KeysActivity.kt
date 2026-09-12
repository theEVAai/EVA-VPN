package ai.theeva.vpn

import ai.theeva.vpn.core.Keys
import ai.theeva.vpn.core.Profile
import ai.theeva.vpn.core.Store
import ai.theeva.vpn.ui.Ui
import android.content.ClipboardManager
import android.content.Context
import android.os.Bundle
import android.view.ViewGroup
import android.widget.LinearLayout
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity

/**
 * Ключи доступа: добавить, выбрать, удалить.
 *
 * Принимается и одна ссылка, и много строк сразу, и содержимое подписки —
 * разбором занимается общий с компьютером код (core/Profile.kt).
 */
class KeysActivity : AppCompatActivity() {

    private lateinit var store: Store
    private lateinit var column: LinearLayout
    private lateinit var listCard: LinearLayout

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        store = Store(this)

        val (scroll, col) = Ui.screen(this)
        column = col
        setContentView(scroll)

        column.addView(Ui.title(this, getString(R.string.keys_title)))

        val input = Ui.input(this, getString(R.string.keys_add_hint))
        input.minLines = 2
        column.addView(input)
        column.addView(Ui.spacer(this, 10))

        val buttons = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        val paste = Ui.ghost(this, getString(R.string.keys_paste))
        val add = Ui.primary(this, getString(R.string.keys_add))
        buttons.addView(
            paste,
            LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
        )
        buttons.addView(Ui.spacer(this, 0).apply {
            layoutParams = LinearLayout.LayoutParams(Ui.dp(this@KeysActivity, 8), 1)
        })
        buttons.addView(
            add,
            LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
        )
        column.addView(buttons)

        paste.setOnClickListener {
            val clip = getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
            val text = clip.primaryClip?.getItemAt(0)?.coerceToText(this)?.toString().orEmpty()
            if (text.isBlank()) toast(getString(R.string.keys_bad)) else input.setText(text)
        }

        add.setOnClickListener {
            val text = input.text.toString()
            val parsed = Keys.parseMany(text)
            if (parsed.isEmpty()) {
                toast(getString(R.string.keys_bad))
                return@setOnClickListener
            }
            val added = store.addProfiles(parsed)
            input.setText("")
            toast(getString(R.string.keys_added, added))
            renderList()
        }

        column.addView(Ui.label(this, "// добавленные"))
        listCard = Ui.card(this)
        column.addView(listCard)
        renderList()
    }

    private fun renderList() {
        listCard.removeAllViews()
        val profiles = store.profiles()

        if (profiles.isEmpty()) {
            listCard.addView(Ui.row(this, getString(R.string.keys_empty), null, null))
            return
        }

        val activeId = store.activeProfile()?.id
        profiles.forEachIndexed { index, p ->
            if (index > 0) listCard.addView(Ui.divider(this))

            val remove = Ui.ghost(this, "×")
            remove.setOnClickListener {
                store.removeProfile(p.id)
                toast(getString(R.string.keys_removed))
                renderList()
            }

            val marker = if (p.id == activeId) "● " else "○ "
            val row = Ui.row(
                this,
                marker + p.name,
                describe(p),
                remove
            )
            row.setOnClickListener {
                store.setActiveId(p.id)
                renderList()
            }
            listCard.addView(row)
        }
    }

    /** Короткая строка о ключе: протокол, адрес и откуда он взялся. */
    private fun describe(p: Profile): String {
        val where = if (p.source == "manual") "вручную" else "подписка"
        return "${p.type} · ${p.server}:${p.port} · $where"
    }

    private fun toast(text: String) = Toast.makeText(this, text, Toast.LENGTH_SHORT).show()
}
