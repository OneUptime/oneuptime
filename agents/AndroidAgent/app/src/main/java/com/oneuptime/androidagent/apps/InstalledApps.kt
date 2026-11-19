package com.oneuptime.androidagent.apps

import android.content.pm.ApplicationInfo
import android.content.pm.PackageInfo
import android.content.pm.PackageManager
import android.os.Build

/** Reads every installed package. Android 11+ shows them all only to an app holding QUERY_ALL_PACKAGES. */
object InstalledApps {
    fun read(packageManager: PackageManager): List<InstalledApp> {
        val packages: List<PackageInfo> =
            try {
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                    packageManager.getInstalledPackages(PackageManager.PackageInfoFlags.of(0))
                } else {
                    @Suppress("DEPRECATION")
                    packageManager.getInstalledPackages(0)
                }
            } catch (_: RuntimeException) {
                // A parcel too large for Binder on a device with very many packages: try again next time.
                return emptyList()
            }

        return packages.mapNotNull { info ->
            val application: ApplicationInfo = info.applicationInfo ?: return@mapNotNull null
            InstalledApp(
                packageName = info.packageName,
                versionName = info.versionName,
                versionCode = versionCode(info),
                system = application.flags and ApplicationInfo.FLAG_SYSTEM != 0,
                updatedSystem = application.flags and ApplicationInfo.FLAG_UPDATED_SYSTEM_APP != 0,
                enabled = application.enabled,
                installer = installer(packageManager, info.packageName),
                firstInstallTimeMillis = info.firstInstallTime,
                lastUpdateTimeMillis = info.lastUpdateTime,
            )
        }
    }

    private fun versionCode(info: PackageInfo): Long =
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
            info.longVersionCode
        } else {
            @Suppress("DEPRECATION")
            info.versionCode.toLong()
        }

    private fun installer(packageManager: PackageManager, packageName: String): String? =
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                packageManager.getInstallSourceInfo(packageName).installingPackageName
            } else {
                @Suppress("DEPRECATION")
                packageManager.getInstallerPackageName(packageName)
            }
        } catch (_: Exception) {
            null
        }
}
