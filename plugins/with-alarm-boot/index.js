/**
 * CheckOff — with-alarm-boot config plugin.
 *
 * What it does (Android):
 * 1. Registers `AlarmBootReceiver` for BOOT_COMPLETED in AndroidManifest.xml
 *    (non-dangerous `withAndroidManifest` mod).
 * 2. Writes `AlarmBootReceiver.kt` into the app's package source set via
 *    `withDangerousMod` (file creation only — no existing files touched).
 *
 * What the receiver does on boot:
 * expo-notifications ALREADY re-arms its own scheduled notifications on
 * BOOT_COMPLETED natively (NotificationsService -> onSetupScheduledNotifications,
 * verified in expo-notifications v57 source). This receiver is a belt-and-braces
 * second layer: it posts a "tap to restore alarms" notification. Tapping opens
 * the app through the checkoff://restore-alarms deep link, and the app's
 * bootstrap then runs rescheduleAllAlarms() against its own scheduled_alarms
 * ledger (the JS-side source of truth).
 *
 * What it deliberately does NOT do: run headless JS on boot. On Android 12+
 * the OS will not reliably start the JS engine from a background receiver,
 * so claiming a silent restore would be fake. Receiver -> notification ->
 * user tap -> full bootstrap is the honest pattern.
 *
 * Coordinator wiring: on bootstrap (and on deep link checkoff://restore-alarms),
 * call rescheduleAllAlarms(db) + processMissedAlarms(db, new Date()).
 */
const { withAndroidManifest, withDangerousMod } = require('@expo/config-plugins');
const path = require('path');
const fs = require('fs');

const RECEIVER_CLASS = 'AlarmBootReceiver';

function receiverKotlin(packageName) {
  return `package ${packageName}

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
class ${RECEIVER_CLASS} : BroadcastReceiver() {
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
      .setContentText("Device restarted \\u2014 tap to restore your task alarms.")
      .setSmallIcon(android.R.drawable.ic_lock_idle_alarm)
      .setContentIntent(pending)
      .setAutoCancel(true)
      .setPriority(NotificationCompat.PRIORITY_HIGH)
      .build()

    manager.notify(9001, notification)
  }
}
`;
}

function withAlarmBootManifest(config) {
  return withAndroidManifest(config, (modConfig) => {
    const manifest = modConfig.modResults.manifest;
    const application = manifest.application && manifest.application[0];
    if (!application) return modConfig;

    // RECEIVE_BOOT_COMPLETED is declared in app.json (and also by
    // expo-notifications' own manifest); the receiver needs it to fire.
    application.receiver = application.receiver || [];
    const name = `.${RECEIVER_CLASS}`;
    const exists = application.receiver.some((r) => r.$ && r.$['android:name'] === name);
    if (!exists) {
      application.receiver.push({
        $: {
          'android:name': name,
          'android:enabled': 'true',
          'android:exported': 'false',
        },
        'intent-filter': [
          {
            action: [{ $: { 'android:name': 'android.intent.action.BOOT_COMPLETED' } }],
          },
        ],
      });
    }
    return modConfig;
  });
}

function withAlarmBootSource(config) {
  return withDangerousMod(config, [
    'android',
    async (modConfig) => {
      const packageName =
        (modConfig.android && modConfig.android.package) || 'com.yuvrajmishra.checkoff';
      const packageDir = packageName.replace(/\./g, '/');
      const srcDir = path.join(
        modConfig.modRequest.platformProjectRoot,
        'app/src/main/java',
        packageDir
      );
      await fs.promises.mkdir(srcDir, { recursive: true });
      const filePath = path.join(srcDir, `${RECEIVER_CLASS}.kt`);
      await fs.promises.writeFile(filePath, receiverKotlin(packageName));
      return modConfig;
    },
  ]);
}

module.exports = function withAlarmBoot(config) {
  config = withAlarmBootManifest(config);
  config = withAlarmBootSource(config);
  return config;
};
