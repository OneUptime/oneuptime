package com.oneuptime.androidagent.collect

import android.os.BatteryManager
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class BatteryReadingsTest {
    private fun read(
        present: Boolean = true,
        level: Int = 80,
        scale: Int = 100,
        status: Int = BatteryManager.BATTERY_STATUS_CHARGING,
        plugged: Int = BatteryManager.BATTERY_PLUGGED_AC,
        temperatureTenths: Int = 315,
    ): BatteryReading? = BatteryReadings.from(present, level, scale, status, plugged, temperatureTenths)

    @Test
    fun `a kiosk without a battery, or one Android cannot read, reports none`() {
        assertNull(read(present = false))
        assertNull(read(level = -1))
        assertNull(read(scale = 0))
    }

    @Test
    fun `the charge is a fraction, and the temperature is in degrees`() {
        val reading: BatteryReading = read(level = 45, scale = 50)!!

        assertEquals(0.9, reading.charge, 1e-9)
        assertEquals(31.5, reading.temperatureCelsius!!, 1e-9)
        assertNull(read(temperatureTenths = Int.MIN_VALUE)!!.temperatureCelsius)
        assertEquals(1.0, read(level = 120)!!.charge, 0.0)
    }

    @Test
    fun `status and power source get their names`() {
        assertEquals("discharging", read(status = BatteryManager.BATTERY_STATUS_DISCHARGING)!!.state)
        assertEquals("full", read(status = BatteryManager.BATTERY_STATUS_FULL)!!.state)
        assertEquals("not_charging", read(status = BatteryManager.BATTERY_STATUS_NOT_CHARGING)!!.state)
        assertEquals("unknown", read(status = 99)!!.state)

        assertEquals("usb", read(plugged = BatteryManager.BATTERY_PLUGGED_USB)!!.plugged)
        assertEquals("wireless", read(plugged = BatteryManager.BATTERY_PLUGGED_WIRELESS)!!.plugged)
        assertEquals("dock", read(plugged = 8)!!.plugged)
        assertEquals("other", read(plugged = 64)!!.plugged)
        assertNull(read(plugged = 0)!!.plugged)
    }
}
