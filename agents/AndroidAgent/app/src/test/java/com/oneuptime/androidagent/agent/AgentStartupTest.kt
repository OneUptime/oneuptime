package com.oneuptime.androidagent.agent

import android.app.Application
import android.app.Notification
import android.app.NotificationManager
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.work.ListenableWorker
import androidx.work.WorkInfo
import androidx.work.WorkManager
import androidx.work.testing.TestListenableWorkerBuilder
import androidx.work.testing.WorkManagerTestInitHelper
import kotlinx.coroutines.runBlocking
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.Shadows.shadowOf

/* How the agent comes to be running: at boot, after an update, and from the watchdog. */
@RunWith(AndroidJUnit4::class)
class AgentStartupTest {
    private val context: Context = ApplicationProvider.getApplicationContext()

    @Before
    fun setUp() {
        WorkManagerTestInitHelper.initializeTestWorkManager(context)
        AgentRuntime.secretCipher = { com.oneuptime.androidagent.config.AesGcmSecretCipher { javax.crypto.KeyGenerator.getInstance("AES").apply { init(256) }.generateKey() } }
    }

    @After
    fun tearDown() {
        AgentRuntime.resetForTests()
    }

    private fun nextStartedService(): Intent? = shadowOf(context as Application).nextStartedService

    /*
     * Every service start so far. WorkManager runs a new periodic work's
     * first run at once, so scheduling the watchdog can start the service
     * too, before the start a test is looking for.
     */
    private fun startedServices(): List<Intent> = generateSequence { nextStartedService() }.toList()

    private fun watchdog(): List<WorkInfo> =
        WorkManager.getInstance(context).getWorkInfosForUniqueWork(WatchdogWorker.UNIQUE_NAME).get()

    @Test
    fun `at boot the service starts and the watchdog is scheduled`() {
        BootReceiver().onReceive(context, Intent(Intent.ACTION_BOOT_COMPLETED))

        assertEquals(ComponentName(context, AgentService::class.java), nextStartedService()?.component)
        assertEquals(1, watchdog().size)
        assertEquals(WorkInfo.State.ENQUEUED, watchdog().single().state)
    }

    @Test
    fun `after an update it starts again`() {
        BootReceiver().onReceive(context, Intent(Intent.ACTION_MY_PACKAGE_REPLACED))

        assertEquals(ComponentName(context, AgentService::class.java), nextStartedService()?.component)
    }

    @Test
    fun `other broadcasts start nothing`() {
        BootReceiver().onReceive(context, Intent(Intent.ACTION_SCREEN_ON))

        assertEquals(null, nextStartedService())
    }

    @Test
    fun `scheduling the watchdog twice keeps one`() {
        WatchdogWorker.schedule(context)
        WatchdogWorker.schedule(context)

        assertEquals(1, watchdog().size)
    }

    @Test
    fun `the watchdog starts the service when it is not running`() {
        val worker: WatchdogWorker = TestListenableWorkerBuilder<WatchdogWorker>(context).build()

        val result: ListenableWorker.Result = runBlocking { worker.doWork() }

        assertEquals(ListenableWorker.Result.success(), result)
        assertEquals(ComponentName(context, AgentService::class.java), nextStartedService()?.component)
    }

    @Test
    fun `asking for a report now starts the service with that action`() {
        assertTrue(AgentStarter.start(context, collectNow = true))

        val starts: List<Intent> = startedServices()
        assertTrue(starts.all { it.component == ComponentName(context, AgentService::class.java) })
        assertTrue(starts.any { it.action == AgentService.ACTION_COLLECT_NOW })
    }

    @Test
    fun `the notification is quiet, ongoing, and opens the setup screen`() {
        val notification: Notification =
            AgentNotifications.build(context, AgentStatus(Health.REPORTING, "Reporting to OneUptime", "As kiosk-02"))

        assertTrue(notification.flags and Notification.FLAG_ONGOING_EVENT != 0)
        assertNotNull(notification.contentIntent)
        assertEquals(AgentNotifications.CHANNEL_ID, notification.channelId)
        val channel = context.getSystemService(NotificationManager::class.java).getNotificationChannel(AgentNotifications.CHANNEL_ID)
        assertEquals(NotificationManager.IMPORTANCE_LOW, channel.importance)
        assertEquals("Reporting to OneUptime", shadowOf(notification).contentTitle)
        assertEquals("As kiosk-02", shadowOf(notification).contentText)
    }
}
