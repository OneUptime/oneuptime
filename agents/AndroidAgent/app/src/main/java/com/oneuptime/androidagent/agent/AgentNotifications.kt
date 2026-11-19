package com.oneuptime.androidagent.agent

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.os.Build
import androidx.core.app.NotificationCompat
import com.oneuptime.androidagent.R
import com.oneuptime.androidagent.ui.SetupActivity

/**
 * The foreground service's notification: Android requires one while the
 * agent runs. It is silent, low priority and says the agent's state in a
 * line; tapping it opens the setup screen.
 */
object AgentNotifications {
    const val CHANNEL_ID: String = "agent_status"
    const val NOTIFICATION_ID: Int = 1

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
