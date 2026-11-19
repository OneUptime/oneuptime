package com.oneuptime.androidagent.admin

import android.app.admin.DeviceAdminReceiver

/**
 * Lets the agent be the device owner of a device no other device manager
 * owns, set once with adb on a device without accounts:
 *
 *   adb shell dpm set-device-owner com.oneuptime.androidagent/.admin.AgentDeviceAdminReceiver
 *
 * Android gives the device's CPU use to the device owner only, from Android
 * 8 (HardwarePropertiesManager.getCpuUsages), so this is how a fleet without
 * a device manager gets CPU use from the agent (collect/CoreTimes.kt). It
 * asks for no policy (res/xml/device_admin.xml): the agent never locks,
 * wipes or restricts the device, and a device whose device owner is Esper,
 * Intune or another manager keeps it.
 */
class AgentDeviceAdminReceiver : DeviceAdminReceiver()
