package com.oneuptime.androidagent.device

import android.annotation.SuppressLint
import android.content.Context
import android.os.Build
import android.provider.Settings

/** Reads [DeviceFacts] from the running device. */
object AndroidDeviceFacts {
    @SuppressLint("HardwareIds")
    fun read(context: Context): DeviceFacts {
        val androidId: String? =
            try {
                Settings.Secure.getString(context.contentResolver, Settings.Secure.ANDROID_ID)
            } catch (_: RuntimeException) {
                null
            }

        return DeviceFacts(
            manufacturer = Build.MANUFACTURER.orEmpty(),
            model = Build.MODEL.orEmpty(),
            androidRelease = Build.VERSION.RELEASE.orEmpty(),
            sdkInt = Build.VERSION.SDK_INT,
            buildId = Build.ID.orEmpty(),
            buildDisplay = Build.DISPLAY.orEmpty(),
            securityPatch = Build.VERSION.SECURITY_PATCH,
            androidId = androidId,
            supportedAbis = Build.SUPPORTED_ABIS?.toList().orEmpty(),
            buildSerial = legacySerial(),
            logicalCpuCount = Runtime.getRuntime().availableProcessors(),
        )
    }

    /*
     * Android 7 gives every app the serial number in Build.SERIAL. From 8.0
     * it is "unknown" unless the app holds READ_PHONE_STATE, and from 10 not
     * even then: a device manager sends it instead (device_serial).
     */
    @Suppress("DEPRECATION")
    @SuppressLint("HardwareIds")
    private fun legacySerial(): String? =
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) DeviceFacts.usableSerial(Build.SERIAL) else null
}
