package ai.theeva.vpn.ui

import ai.theeva.vpn.R
import android.content.Context
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.CheckBox
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import androidx.core.content.ContextCompat

/**
 * Оформление экранов.
 *
 * Разметка собирается кодом, а не XML: экранов немного, зато так нет
 * рассинхрона между идентификаторами в файле и в коде, и весь фирменный
 * стиль задан в одном месте.
 */
object Ui {

    fun color(ctx: Context, id: Int): Int = ContextCompat.getColor(ctx, id)

    fun dp(ctx: Context, value: Int): Int =
        (value * ctx.resources.displayMetrics.density).toInt()

    /** Корневой столбец экрана с отступами и прокруткой. */
    fun screen(ctx: Context): Pair<ScrollView, LinearLayout> {
        val scroll = ScrollView(ctx)
        scroll.setBackgroundColor(color(ctx, R.color.black))
        scroll.isFillViewport = true

        val column = LinearLayout(ctx)
        column.orientation = LinearLayout.VERTICAL
        column.setPadding(dp(ctx, 18), dp(ctx, 18), dp(ctx, 18), dp(ctx, 24))
        scroll.addView(
            column,
            ViewGroup.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.WRAP_CONTENT
            )
        )
        return scroll to column
    }

    /** Заголовок экрана. */
    fun title(ctx: Context, text: String): TextView = TextView(ctx).apply {
        this.text = text
        setTextColor(color(ctx, R.color.cream))
        textSize = 17f
        typeface = Typeface.create(Typeface.MONOSPACE, Typeface.BOLD)
        setPadding(0, 0, 0, dp(ctx, 14))
    }

    /** Подпись раздела в духе «// что режем». */
    fun label(ctx: Context, text: String): TextView = TextView(ctx).apply {
        this.text = text
        setTextColor(color(ctx, R.color.cream_dim))
        textSize = 11f
        typeface = Typeface.MONOSPACE
        setPadding(0, dp(ctx, 16), 0, dp(ctx, 8))
    }

    /** Пояснение обычными словами. */
    fun hint(ctx: Context, text: String): TextView = TextView(ctx).apply {
        this.text = text
        setTextColor(color(ctx, R.color.cream_dim))
        textSize = 12f
        setLineSpacing(dp(ctx, 3).toFloat(), 1f)
        setPadding(0, dp(ctx, 2), 0, dp(ctx, 10))
    }

    fun body(ctx: Context, text: String): TextView = TextView(ctx).apply {
        this.text = text
        setTextColor(color(ctx, R.color.cream))
        textSize = 14f
    }

    /** Рамка-карточка, в которую складываются строки списка. */
    fun card(ctx: Context): LinearLayout = LinearLayout(ctx).apply {
        orientation = LinearLayout.VERTICAL
        background = GradientDrawable().apply {
            setColor(color(ctx, R.color.panel))
            setStroke(dp(ctx, 1), color(ctx, R.color.line))
        }
    }

    fun input(ctx: Context, hintText: String): EditText = EditText(ctx).apply {
        hint = hintText
        setHintTextColor(color(ctx, R.color.cream_dim))
        setTextColor(color(ctx, R.color.cream))
        textSize = 13f
        typeface = Typeface.MONOSPACE
        setPadding(dp(ctx, 10), dp(ctx, 10), dp(ctx, 10), dp(ctx, 10))
        background = GradientDrawable().apply {
            setColor(Color.parseColor("#00000066"))
            setStroke(dp(ctx, 1), color(ctx, R.color.line))
        }
    }

    fun primary(ctx: Context, text: String): Button = Button(ctx).apply {
        this.text = text
        setTextColor(Color.WHITE)
        textSize = 12f
        typeface = Typeface.MONOSPACE
        isAllCaps = true
        background = GradientDrawable().apply { setColor(color(ctx, R.color.blue)) }
    }

    fun ghost(ctx: Context, text: String): Button = Button(ctx).apply {
        this.text = text
        setTextColor(color(ctx, R.color.cream))
        textSize = 12f
        typeface = Typeface.MONOSPACE
        isAllCaps = true
        background = GradientDrawable().apply {
            setColor(Color.TRANSPARENT)
            setStroke(dp(ctx, 1), color(ctx, R.color.line))
        }
    }

    fun check(ctx: Context, text: String, checked: Boolean): CheckBox = CheckBox(ctx).apply {
        this.text = text
        isChecked = checked
        setTextColor(color(ctx, R.color.cream))
        textSize = 14f
    }

    /** Строка списка: заголовок, пояснение и произвольная кнопка справа. */
    fun row(
        ctx: Context,
        title: String,
        hintText: String?,
        right: View?
    ): LinearLayout {
        val row = LinearLayout(ctx).apply {
            orientation = LinearLayout.HORIZONTAL
            gravity = Gravity.CENTER_VERTICAL
            setPadding(dp(ctx, 12), dp(ctx, 11), dp(ctx, 12), dp(ctx, 11))
        }
        val texts = LinearLayout(ctx).apply { orientation = LinearLayout.VERTICAL }
        texts.addView(
            TextView(ctx).apply {
                this.text = title
                setTextColor(color(ctx, R.color.cream))
                textSize = 14f
            }
        )
        if (!hintText.isNullOrEmpty()) {
            texts.addView(
                TextView(ctx).apply {
                    this.text = hintText
                    setTextColor(color(ctx, R.color.cream_dim))
                    textSize = 11.5f
                    setPadding(0, dp(ctx, 3), 0, 0)
                }
            )
        }
        row.addView(
            texts,
            LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f)
        )
        right?.let { row.addView(it) }
        return row
    }

    /** Тонкая черта между строками. */
    fun divider(ctx: Context): View = View(ctx).apply {
        setBackgroundColor(color(ctx, R.color.line))
        layoutParams = LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, dp(ctx, 1)
        )
    }

    fun spacer(ctx: Context, height: Int): View = View(ctx).apply {
        layoutParams = LinearLayout.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, dp(ctx, height)
        )
    }
}
