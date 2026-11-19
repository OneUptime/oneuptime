package com.oneuptime.androidagent

import android.content.Context
import android.os.Build
import android.os.ParcelFileDescriptor
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.oneuptime.androidagent.agent.AgentRuntime
import com.oneuptime.androidagent.collect.DeviceSnapshot
import com.oneuptime.androidagent.collect.SnapshotCollector
import com.oneuptime.androidagent.config.KeystoreSecretCipher
import com.oneuptime.androidagent.config.MemoryKeyValueStore
import com.oneuptime.androidagent.config.StoredToken
import com.oneuptime.androidagent.config.TokenVault
import com.oneuptime.androidagent.config.LogcatLevel
import com.oneuptime.androidagent.logs.LogBuffer
import com.oneuptime.androidagent.logs.LogcatCollector
import com.oneuptime.androidagent.logs.LogcatState
import com.oneuptime.androidagent.logs.ProcessLauncher
import com.oneuptime.androidagent.logs.ResumePoint
import com.oneuptime.androidagent.logs.ResumePointStore
import com.oneuptime.androidagent.otlp.LogRecord
import com.oneuptime.androidagent.otlp.AttributeValue
import java.io.FileInputStream
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith

/* What the agent really reads on an Android device, and its Keystore and Logcat for real. */
@RunWith(AndroidJUnit4::class)
class OnDeviceAgentTest {
    private val context: Context = InstrumentationRegistry.getInstrumentation().targetContext

    private fun shell(command: String): String {
        val descriptor: ParcelFileDescriptor = InstrumentationRegistry.getInstrumentation().uiAutomation.executeShellCommand(command)
        return FileInputStream(descriptor.fileDescriptor).use { String(it.readBytes()) }.also { descriptor.close() }
    }

    @Test
    fun theIngestionKeyIsSealedWithTheAndroidKeystore() {
        val store = MemoryKeyValueStore()
        val vault = TokenVault(store, KeystoreSecretCipher("oneuptime-agent-test-key"))

        vault.save("4c1f2a9e-ingestion-key")

        assertEquals(StoredToken.Present("4c1f2a9e-ingestion-key"), vault.read())
        // A new cipher finds the same Keystore key: the key survives a restart of the agent.
        assertEquals(StoredToken.Present("4c1f2a9e-ingestion-key"), TokenVault(store, KeystoreSecretCipher("oneuptime-agent-test-key")).read())
        // Another key cannot open it.
        assertEquals(StoredToken.Unreadable, TokenVault(store, KeystoreSecretCipher("oneuptime-agent-other-key")).read())
    }

    @Test
    fun theDeviceGivesMemoryStorageNetworkAndUptime() {
        val snapshot: DeviceSnapshot = SnapshotCollector(context, SystemClocks).collect()

        val memory = snapshot.memory!!
        assertTrue(memory.totalBytes > 0)
        assertTrue(memory.availableBytes in 1..memory.totalBytes)
        // /proc/meminfo is still open to apps, so MemFree is known.
        assertNotNull(memory.freeBytes)
        val data = snapshot.filesystems.single()
        assertEquals("/data", data.mountpoint)
        assertTrue(data.totalBytes > 0 && data.availableBytes <= data.freeBytes)
        assertNotNull(snapshot.network)
        assertTrue(snapshot.uptimeSeconds > 0)
        assertTrue(snapshot.logicalCpuCount > 0)
    }

    @Test
    fun androidKeepsTheCpuFromAppsFromAndroid8() {
        val collector = SnapshotCollector(context, SystemClocks)
        collector.collect()
        collector.collect()

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            // What the docs say: CPU use and load are not readable by an app.
            assertTrue(!collector.capabilities.cpuUtilization)
            assertTrue(!collector.capabilities.loadAverage)
        }
    }

    @Test
    fun theBootIdIsReadable() {
        assertNotNull(AgentRuntime.get(context).bootId())
        assertEquals(AgentRuntime.get(context).bootId(), AgentRuntime.get(context).bootInfo().bootId)
    }

    /*
     * Granting READ_LOGS adds the `log` group to the app's process, so
     * Android kills the process to restart it with the group - the test's
     * own process, if it granted the permission itself. So it is granted
     * before the run (agents/AndroidAgent/README.md, "Testing on a device"):
     *
     *   ./gradlew installDebug installDebugAndroidTest
     *   adb shell pm grant com.oneuptime.androidagent android.permission.READ_LOGS
     *   adb shell am instrument -w com.oneuptime.androidagent.test/androidx.test.runner.AndroidJUnitRunner
     *
     * and is skipped, not failed, in a run that did not grant it.
     */
    @Test
    fun withReadLogsGrantedEveryAppsCrashIsRead() {
        assumeTrue("READ_LOGS is not granted: see the comment above", AgentRuntime.get(context).readLogsGranted())

        val buffer = LogBuffer()
        val logcat =
            LogcatCollector(
                clock = SystemClocks,
                sdkInt = Build.VERSION.SDK_INT,
                launcher = ProcessLauncher.SYSTEM,
                packages = { null },
                currentBootId = { AgentRuntime.get(context).bootId() },
                buffer = buffer,
                resumePoints =
                    object : ResumePointStore {
                        // Resume from now, so only the crash below is read.
                        override fun load(session: String): ResumePoint =
                            ResumePoint(AgentRuntime.get(context).bootId(), System.currentTimeMillis() * 1_000_000L)

                        override fun save(session: String, point: ResumePoint) {}
                    },
            )
        try {
            val state: LogcatState = logcat.update(enabled = true, granted = true, minLevel = LogcatLevel.WARN)
            assertTrue(state == LogcatState.CRASHES_AND_ANRS || state == LogcatState.FULL)
            Thread.sleep(1_000)

            shell("am start -W -a android.settings.SETTINGS")
            shell("am crash com.android.settings")

            val crash: LogRecord? = awaitCrash(buffer, "com.android.settings")
            assertNotNull("no app.crash record for the crash of Settings", crash)
            val type = crash!!.attributes.first { it.key == "exception.type" }.value as AttributeValue.Text
            assertTrue(type.value.contains("CrashedByAdbException"))
        } finally {
            logcat.stopAll()
        }
    }

    private fun awaitCrash(buffer: LogBuffer, packageName: String): LogRecord? {
        val deadline: Long = System.currentTimeMillis() + 20_000
        while (System.currentTimeMillis() < deadline) {
            buffer.drain().firstOrNull { record ->
                record.attributes.any { it.key == "event.name" && (it.value as? AttributeValue.Text)?.value == "app.crash" } &&
                    record.attributes.any { it.key == "android.package.name" && (it.value as? AttributeValue.Text)?.value == packageName }
            }?.let { return it }
            Thread.sleep(200)
        }
        return null
    }

    @Test
    fun withoutReadLogsNothingIsCollected() {
        val logcat =
            LogcatCollector(SystemClocks, Build.VERSION.SDK_INT, ProcessLauncher.SYSTEM, { null }, { null }, LogBuffer(), object : ResumePointStore {
                override fun load(session: String): ResumePoint? = null

                override fun save(session: String, point: ResumePoint) {}
            })

        assertEquals(LogcatState.NOT_GRANTED, logcat.update(enabled = true, granted = false, minLevel = LogcatLevel.WARN))
        assertNull(logcat.takeDroppedLinesRecord())
    }
}
