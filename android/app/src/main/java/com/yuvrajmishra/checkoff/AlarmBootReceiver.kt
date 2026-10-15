package com.yuvrajmishra.checkoff

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Build
import androidx.core.app.NotificationCompat

/**
 * Posted on BOOT_COMPLETED. See plugins/with-alarm-boot/index.js for the
 * full design rationale. Belt-and-braces: expo-notifications natively
 * re-arms scheduled notifications on boot; this posts a tap-to-restore
 * prompt so the app's own scheduled_alarms ledger is reconciled on next open.
 */
class AlarmBootReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent?) {
    if (intent?.action != Intent.ACTION_BOOT_COMPLETED) return

    val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    val channelId = "checkoff-boot"
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      manager.createNotificationChannel(
        NotificationChannel(channelId, "Alarm restore", NotificationManager.IMPORTANCE_HIGH)
      )
    }

    val launch = context.packageManager.getLaunchIntentForPackage(context.packageName)?.apply {
      data = Uri.parse("checkoff://restore-alarms")
    } ?: return

    val pending = PendingIntent.getActivity(
      context,
      0,
      launch,
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
    )

    val notification = NotificationCompat.Builder(context, channelId)
      .setContentTitle("CheckOff")
      .setContentText("Device restarted \u2014 tap to restore your task alarms.")
      .setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
      .setContentIntent(pending)
      .setAutoCancel(true)
      .setPriority(NotificationCompat.PRIORITY_HIGH)
      .build()

    manager.notify(9001, notification)
  }
}
