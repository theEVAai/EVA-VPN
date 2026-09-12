package ai.theeva.vpn

import ai.theeva.vpn.core.Patterns
import ai.theeva.vpn.core.RuleAction
import ai.theeva.vpn.core.RuleModules
import ai.theeva.vpn.core.Store
import ai.theeva.vpn.core.UserRule
import ai.theeva.vpn.ui.Ui
import android.os.Bundle
import android.text.Editable
import android.text.TextWatcher
import android.view.ViewGroup
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.appcompat.app.AppCompatActivity

/**
 * Правила: готовые наборы и свои.
 *
 * Это замена списку программ с компьютера. Там человек выносит из туннеля
 * .exe; здесь — адреса. Чтобы не заставлять разбираться в видах правил,
 * как в Clash, приложение само определяет, что введено, и пишет об этом
 * обычными словами прямо под полем — до того, как правило будет добавлено.
 */
class RulesActivity : AppCompatActivity() {

    private lateinit var store: Store
    private lateinit var modulesCard: LinearLayout
    private lateinit var rulesCard: LinearLayout

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        store = Store(this)

        val (scroll, column) = Ui.screen(this)
        setContentView(scroll)

        column.addView(Ui.title(this, getString(R.string.rules_title)))

        /* ---------------- готовые наборы ---------------- */
        column.addView(Ui.label(this, getString(R.string.rules_modules)))
        modulesCard = Ui.card(this)
        column.addView(modulesCard)
        renderModules()

        /* ---------------- свои правила ---------------- */
        column.addView(Ui.label(this, getString(R.string.rules_own)))
        column.addView(Ui.hint(this, getString(R.string.rules_explain)))

        val input = Ui.input(this, getString(R.string.rules_add_hint))
        column.addView(input)

        // объяснение обновляется на каждый символ: человек видит, как его
        // ввод понят, ещё до нажатия кнопки
        val understood = Ui.hint(this, "")
        column.addView(understood)

        input.addTextChangedListener(object : TextWatcher {
            override fun afterTextChanged(s: Editable?) {
                val text = s?.toString().orEmpty()
                understood.text = if (text.isBlank()) "" else Patterns.understand(text).explanation
            }

            override fun beforeTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
            override fun onTextChanged(s: CharSequence?, a: Int, b: Int, c: Int) {}
        })

        val actions = LinearLayout(this).apply { orientation = LinearLayout.HORIZONTAL }
        for (action in listOf(RuleAction.PROXY, RuleAction.DIRECT, RuleAction.REJECT)) {
            val button = Ui.ghost(this, Patterns.actionTitle(action))
            button.textSize = 10.5f
            button.setOnClickListener {
                val text = input.text.toString().trim()
                if (text.isEmpty()) {
                    toast(getString(R.string.rules_add_hint))
                    return@setOnClickListener
                }
                val list = store.userRules().toMutableList()
                list.removeAll { it.pattern.equals(text, ignoreCase = true) }
                list.add(UserRule(text, action))
                store.saveUserRules(list)
                input.setText("")
                understood.text = ""
                renderRules()
            }
            actions.addView(
                button,
                LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
            )
        }
        column.addView(actions)
        column.addView(Ui.spacer(this, 10))

        rulesCard = Ui.card(this)
        column.addView(rulesCard)
        renderRules()
    }

    private fun renderModules() {
        modulesCard.removeAllViews()
        val enabled = store.enabledModules()

        RuleModules.ALL.forEachIndexed { index, module ->
            if (index > 0) modulesCard.addView(Ui.divider(this))

            val box = Ui.check(this, "", enabled.contains(module.key))
            box.setOnCheckedChangeListener { _, checked ->
                store.setModuleEnabled(module.key, checked)
            }

            val title = buildString {
                append(module.title)
                append("  ·  ")
                append(Patterns.actionTitle(module.action))
                module.badge?.let { append("  ·  ").append(it) }
            }
            modulesCard.addView(Ui.row(this, title, module.hint, box))
        }
    }

    private fun renderRules() {
        rulesCard.removeAllViews()
        val rules = store.userRules()

        if (rules.isEmpty()) {
            rulesCard.addView(Ui.row(this, getString(R.string.rules_empty), null, null))
            return
        }

        rules.forEachIndexed { index, rule ->
            if (index > 0) rulesCard.addView(Ui.divider(this))

            val remove = Ui.ghost(this, "×")
            remove.setOnClickListener {
                store.saveUserRules(store.userRules().filterNot { it.pattern == rule.pattern })
                renderRules()
            }

            val understood = Patterns.understand(rule.pattern)
            val title = Patterns.actionTitle(rule.action) + ": " + rule.pattern
            rulesCard.addView(Ui.row(this, title, understood.explanation, remove))
        }
    }

    private fun toast(text: String) = Toast.makeText(this, text, Toast.LENGTH_SHORT).show()
}
