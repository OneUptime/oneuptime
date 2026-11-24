package com.oneuptime.androidagent.agent

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import com.oneuptime.androidagent.R
import com.oneuptime.androidagent.logsession.LogSessionRequest
import com.oneuptime.androidagent.ui.LogSessionText
import com.oneuptime.androidagent.ui.SetupActivity

/**
 * The foreground service's notification: Android requires one while the
 * agent runs. It is silent, low priority and says the agent's state in a
 * line; tapping it opens the setup screen.
 */
object AgentNotifications {
    const val CHANNEL_ID: String = "agent_status"
    const val NOTIFICATION_ID: Int = 1

    // OneUptime asking the person at the device to allow a log session: worth interrupting for.
    const val REQUEST_CHANNEL_ID: String = "log_session_requests"
    const val REQUEST_NOTIFICATION_ID: Int = 2

    fun ensureChannel(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return
        }
        val manager: NotificationManager = context.getSystemService(NotificationManager::class.java) ?: return
        val channel =
            NotificationChannel(CHANNEL_ID, context.getString(R.string.notification_channel_name), NotificationManager.IMPORTANCE_LOW).apply {
                description = context.getString(R.string.notification_channel_description)
                setShowBadge(false)
                enableVibration(false)
                setSound(null, null)
            }
        manager.createNotificationChannel(channel)
    }

    private fun ensureRequestChannel(context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return
        }
        val manager: NotificationManager = context.getSystemService(NotificationManager::class.java) ?: return
        val channel =
            NotificationChannel(
                REQUEST_CHANNEL_ID,
                context.getString(R.string.notification_requests_channel_name),
                NotificationManager.IMPORTANCE_HIGH,
            ).apply {
                description = context.getString(R.string.notification_requests_channel_description)
            }
        manager.createNotificationChannel(channel)
    }

    /**
     * Tells the person at the device that OneUptime asks for a log session.
     * Tapping it opens the agent's screen, where they allow or decline it:
     * on Android 13 and later only an app on screen can start reading every
     * app's logs, so the request cannot be answered from the notification.
     */
    fun showLogSessionRequest(context: Context, request: LogSessionRequest) {
        ensureRequestChannel(context)
        val open: PendingIntent =
            PendingIntent.getActivity(
                context,
                REQUEST_NOTIFICATION_ID,
                Intent(context, SetupActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
            )
        // Folded, the request; opened, the request and the requester's note under it (#9966).
        val text: String = LogSessionText.requestSentence(context, request)
        val expanded: String = LogSessionText.notificationText(context, request)
        val notification: Notification =
            NotificationCompat.Builder(context, REQUEST_CHANNEL_ID)
                .setSmallIcon(R.drawable.ic_stat_agent)
                .setContentTitle(context.getString(R.string.notification_request_title))
                .setContentText(text)
                .setStyle(NotificationCompat.BigTextStyle().bigText(expanded))
                .setContentIntent(open)
                .setAutoCancel(true)
                .setPriority(NotificationCompat.PRIORITY_HIGH)
                .setCategory(NotificationCompat.CATEGORY_REMINDER)
                .build()
        try {
            NotificationManagerCompat.from(context).notify(REQUEST_NOTIFICATION_ID, notification)
        } catch (_: SecurityException) {
            // Notifications are not allowed: the request still shows on the agent's screen.
        }
    }

    fun cancelLogSessionRequest(context: Context) {
        NotificationManagerCompat.from(context).cancel(REQUEST_NOTIFICATION_ID)
    }

    fun build(context: Context, status: AgentStatus): Notification {
        ensureChannel(context)
        val open: PendingIntent =
            PendingIntent.getActivity(
                context,
                0,
                Intent(context, SetupActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
                PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
            )
        return NotificationCompat.Builder(context, CHANNEL_ID)
            .setSmallIcon(R.drawable.ic_stat_agent)
            .setContentTitle(status.headline)
            .setContentText(status.detail)
            .setStyle(NotificationCompat.BigTextStyle().bigText(status.detail))
            .setContentIntent(open)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setSilent(true)
            .setShowWhen(false)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE)
            .build()
    }
}
