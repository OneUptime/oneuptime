package com.oneuptime.androidagent.ui

import android.app.Activity
import android.content.res.ColorStateList
import android.content.res.Configuration
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.text.format.DateUtils
import android.text.format.Formatter
import android.view.Gravity
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import androidx.core.content.ContextCompat
import androidx.core.view.ViewCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import com.oneuptime.androidagent.BuildConfig
import com.oneuptime.androidagent.R
import com.oneuptime.androidagent.agent.AgentEvents
import com.oneuptime.androidagent.agent.AgentRuntime
import com.oneuptime.androidagent.agent.AgentStarter
import com.oneuptime.androidagent.agent.AgentStatus
import com.oneuptime.androidagent.agent.AgentStatusText
import com.oneuptime.androidagent.agent.Health
import com.oneuptime.androidagent.collect.CollectorCapabilities
import com.oneuptime.androidagent.config.AgentConfig
import com.oneuptime.androidagent.config.EndpointParser
import com.oneuptime.androidagent.config.EndpointResult
import com.oneuptime.androidagent.config.LocalSettings
import com.oneuptime.androidagent.config.ManagedConfigKeys
import com.oneuptime.androidagent.device.DefaultDeviceName
import com.oneuptime.androidagent.logs.LogcatCollector
import com.oneuptime.androidagent.logs.LogcatState

/**
 * The agent's screen: is the device reporting, the three settings someone
 * setting up a device by hand needs, and what Android lets the agent read
 * here. Settings the device manager sets are shown locked, with their values.
 */
class SetupActivity : Activity() {
    private lateinit var runtime: AgentRuntime
    private val handler = Handler(Looper.getMainLooper())

    private lateinit var statusDot: View
    private lateinit var statusHeadline: TextView
    private lateinit var statusDetail: TextView
    private lateinit var statusLastReport: TextView
    private lateinit var managedNotice: TextView
    private lateinit var url: EditText
    private lateinit var urlHelp: TextView
    private lateinit var token: EditText
    private lateinit var tokenHelp: TextView
    private lateinit var deviceName: EditText
    private lateinit var deviceNameHelp: TextView
    private lateinit var save: Button
    private lateinit var saveMessage: TextView
    private lateinit var readings: LinearLayout
    private lateinit var logcatGrant: TextView
    private lateinit var logcatCommand: TextView

    private val refresher: Runnable =
        object : Runnable {
            override fun run() {
                render()
                handler.postDelayed(this, REFRESH_MILLIS)
            }
        }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_setup)
        runtime = AgentRuntime.get(this)

        statusDot = findViewById(R.id.status_dot)
        statusHeadline = findViewById(R.id.status_headline)
        statusDetail = findViewById(R.id.status_detail)
        statusLastReport = findViewById(R.id.status_last_report)
        managedNotice = findViewById(R.id.managed_notice)
        url = findViewById(R.id.url)
        urlHelp = findViewById(R.id.url_help)
        token = findViewById(R.id.token)
        tokenHelp = findViewById(R.id.token_help)
        deviceName = findViewById(R.id.device_name)
        deviceNameHelp = findViewById(R.id.device_name_help)
        save = findViewById(R.id.save)
        saveMessage = findViewById(R.id.save_message)
        readings = findViewById(R.id.readings)
        logcatGrant = findViewById(R.id.logcat_grant)
        logcatCommand = findViewById(R.id.logcat_command)
        findViewById<TextView>(R.id.version).text = getString(R.string.setup_version, BuildConfig.VERSION_NAME)

        layOutEdgeToEdge()
        fillForm(runtime.configRepository.load())
        save.setOnClickListener { saveSettings() }

        // Opening the app starts the agent: the first launch after a device manager installs it is what lets it start at boot.
        AgentStarter.start(this)
    }

    override fun onResume() {
        super.onResume()
        handler.post(refresher)
    }

    override fun onPause() {
        handler.removeCallbacks(refresher)
        super.onPause()
    }

    private fun fillForm(config: AgentConfig) {
        val local: LocalSettings = runtime.localSettings.read()
        val managed: Set<String> = config.managedKeys
        val organization: String = getString(R.string.setup_set_by_organization)

        val urlManaged: Boolean = ManagedConfigKeys.ONEUPTIME_URL in managed
        url.setText(if (urlManaged) config.endpoint?.base.orEmpty() else local.oneUptimeUrl.orEmpty())
        url.hint = getString(R.string.setup_url_hint_default)
        url.isEnabled = !urlManaged
        urlHelp.text = if (urlManaged) organization else getString(R.string.setup_url_help)

        val tokenManaged: Boolean = ManagedConfigKeys.ONEUPTIME_TOKEN in managed
        token.setText("")
        token.isEnabled = !tokenManaged
        token.hint =
            when {
                tokenManaged -> organization
                local.token != null -> getString(R.string.setup_token_stored_hint)
                else -> getString(R.string.setup_token_hint)
            }
        tokenHelp.text =
            when {
                tokenManaged -> organization
                runtime.localSettings.tokenIsUnreadable() -> getString(R.string.setup_token_unreadable)
                else -> getString(R.string.setup_token_help)
            }

        val nameManaged: Boolean = ManagedConfigKeys.DEVICE_NAME in managed
        deviceName.setText(if (nameManaged) config.identity.name else local.deviceName.orEmpty())
        deviceName.hint = DefaultDeviceName.of(runtime.facts)
        deviceName.isEnabled = !nameManaged
        deviceNameHelp.text = if (nameManaged) organization else getString(R.string.setup_device_name_help)

        managedNotice.visibility = if (urlManaged || tokenManaged || nameManaged) View.VISIBLE else View.GONE
        save.isEnabled = !(urlManaged && tokenManaged && nameManaged)
    }

    private fun saveSettings() {
        val config: AgentConfig = runtime.configRepository.load()
        val urlText: String = url.text.toString().trim()
        val tokenText: String = token.text.toString().trim()
        val nameText: String = deviceName.text.toString().trim()

        if (url.isEnabled && urlText.isNotEmpty()) {
            val parsed: EndpointResult = EndpointParser.parse(urlText)
            if (parsed is EndpointResult.Invalid) {
                url.error = AgentStatusText.addressProblem(parsed.problem)
                url.requestFocus()
                return
            }
        }
        if (token.isEnabled && tokenText.isEmpty() && config.token.isNullOrBlank()) {
            token.error = getString(R.string.setup_token_required)
            token.requestFocus()
            return
        }

        try {
            runtime.localSettings.save(
                url = if (url.isEnabled) urlText else null,
                token = if (token.isEnabled) tokenText else null,
                deviceName = if (deviceName.isEnabled) nameText else null,
            )
        } catch (error: Exception) {
            showSaveMessage(getString(R.string.setup_save_failed, error.message ?: error.javaClass.simpleName))
            return
        }

        showSaveMessage(getString(R.string.setup_saved))
        fillForm(runtime.configRepository.load())
        AgentStarter.start(this, collectNow = true)
        render()
    }

    private fun showSaveMessage(message: String) {
        saveMessage.text = message
        saveMessage.visibility = View.VISIBLE
    }

    private fun render() {
        val config: AgentConfig = runtime.configRepository.load()
        val pending: Long = runtime.outbox.totalBytes()
        val status: AgentStatus = AgentStatusText.of(config, runtime.uploader.status, pending)

        statusHeadline.text = status.headline
        statusDetail.text = status.detail
        statusDot.backgroundTintList = ColorStateList.valueOf(ContextCompat.getColor(this, colorFor(status.health)))

        val lastSuccess: Long? = runtime.uploader.status.lastSuccessAtMillis
        val lastReport: String =
            if (lastSuccess != null) {
                getString(
                    R.string.setup_last_report,
                    DateUtils.getRelativeTimeSpanString(lastSuccess, System.currentTimeMillis(), DateUtils.SECOND_IN_MILLIS),
                )
            } else {
                getString(R.string.setup_no_report_yet)
            }
        statusLastReport.text =
            if (pending > 0) {
                getString(
                    R.string.setup_report_and_waiting,
                    lastReport,
                    getString(R.string.setup_waiting, Formatter.formatShortFileSize(this, pending)),
                )
            } else {
                lastReport
            }

        renderReadings(config)
    }

    private fun renderReadings(config: AgentConfig) {
        readings.removeAllViews()
        val collected: Boolean = runtime.core.lastCollectionAtMillis != null
        val capabilities: CollectorCapabilities = runtime.collector.capabilities
        val yes: String = getString(R.string.setup_reading_yes)
        val unknown: String = getString(R.string.setup_reading_unknown)

        addReading(
            getString(R.string.setup_reading_cpu),
            when {
                collected && capabilities.cpuUtilization -> yes
                collected || Build.VERSION.SDK_INT >= Build.VERSION_CODES.O -> getString(R.string.setup_reading_cpu_unavailable)
                else -> unknown
            },
        )
        addReading(getString(R.string.setup_reading_memory), if (collected) yes else unknown)
        addReading(
            getString(R.string.setup_reading_battery),
            when {
                !collected -> unknown
                capabilities.battery -> yes
                else -> getString(R.string.setup_reading_no_battery)
            },
        )
        addReading(
            getString(R.string.setup_reading_thermal),
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) yes else getString(R.string.setup_reading_thermal_unavailable),
        )

        val granted: Boolean = runtime.readLogsGranted()
        val logcat: LogcatState =
            when {
                !config.logcatEnabled -> LogcatState.DISABLED
                !granted -> LogcatState.NOT_GRANTED
                Build.VERSION.SDK_INT >= LogcatCollector.ANDROID_13 -> LogcatState.CRASHES_AND_ANRS
                else -> LogcatState.FULL
            }
        addReading(getString(R.string.setup_reading_logcat), AgentStatusText.logcat(logcat))
        addReading(
            getString(R.string.setup_reading_apps),
            if (config.installedAppsEnabled) yes else getString(R.string.setup_reading_apps_off),
        )

        val showGrant: Boolean = logcat == LogcatState.NOT_GRANTED
        logcatGrant.visibility = if (showGrant) View.VISIBLE else View.GONE
        logcatCommand.visibility = if (showGrant) View.VISIBLE else View.GONE
        logcatCommand.text = AgentEvents.GRANT_COMMAND
    }

    private fun addReading(label: String, value: String) {
        val row = LinearLayout(this)
        row.orientation = LinearLayout.HORIZONTAL
        row.setPadding(0, dp(8), 0, dp(8))

        val name = TextView(this, null, 0, R.style.AgentText)
        name.text = label
        name.layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1f)

        val reading = TextView(this, null, 0, R.style.AgentText_Secondary)
        reading.text = value
        reading.gravity = Gravity.END
        reading.layoutParams = LinearLayout.LayoutParams(0, LinearLayout.LayoutParams.WRAP_CONTENT, 1.2f)

        row.addView(name)
        row.addView(reading)
        readings.addView(row)
    }

    /*
     * Android 15 draws apps under the status and navigation bars: pad the
     * content by them (and by the keyboard), and on a wide screen - a kiosk
     * in landscape - keep the form a readable width in the middle.
     */
    private fun layOutEdgeToEdge() {
        WindowCompat.setDecorFitsSystemWindows(window, false)
        val night: Boolean =
            resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK == Configuration.UI_MODE_NIGHT_YES
        WindowCompat.getInsetsController(window, window.decorView).apply {
            isAppearanceLightStatusBars = !night
            isAppearanceLightNavigationBars = !night
        }

        val scroll: View = findViewById(R.id.scroll)
        val content: View = findViewById(R.id.content)
        val widthDp: Int = resources.configuration.screenWidthDp
        val side: Int = dp(maxOf(20, (widthDp - MAX_CONTENT_WIDTH_DP) / 2))
        content.setPadding(side, content.paddingTop, side, content.paddingBottom)

        ViewCompat.setOnApplyWindowInsetsListener(scroll) { view, insets ->
            val bars =
                insets.getInsets(
                    WindowInsetsCompat.Type.systemBars() or WindowInsetsCompat.Type.displayCutout() or WindowInsetsCompat.Type.ime(),
                )
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            insets
        }
    }

    private fun colorFor(health: Health): Int =
        when (health) {
            Health.REPORTING -> R.color.status_ok
            Health.STARTING -> R.color.status_idle
            Health.NOT_SET_UP -> R.color.status_warn
            Health.FAILING -> R.color.status_error
        }

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()

    companion object {
        private const val REFRESH_MILLIS: Long = 3_000
        private const val MAX_CONTENT_WIDTH_DP: Int = 640
    }
}
