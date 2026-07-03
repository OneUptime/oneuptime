/*
 * ------------------------------------------------------------------
 * IoTDeviceState
 * ------------------------------------------------------------------
 *
 * Lifecycle state of an IoTDevice inventory row. Devices are never
 * hard-deleted on staleness — they walk this state machine instead so
 * that a silent device stays visible (and alertable) rather than
 * silently vanishing from the fleet:
 *
 *   Online  — reporting, and the latest iot_device_up (if any) is 1.
 *   Offline — either the device/gateway actively reported
 *             iot_device_up = 0, or silence-based offline detection
 *             tripped (no data for 3x the expected check-in interval).
 *   Stale   — no data past the inventory stale threshold
 *             (IOT_INVENTORY_STALE_MINUTES, default 15) while the
 *             fleet itself is still connected.
 *   Retired — no data past the retirement threshold
 *             (IOT_INVENTORY_RETIRE_DAYS, default 30). Kept for
 *             history, excluded from fleet counts and default lists.
 *
 * Any fresh datapoint moves a device straight back to Online/Offline
 * (per its reported iot_device_up) regardless of prior state — the
 * transition happens inside the ingest upsert, so recovery is
 * automatic and needs no worker involvement.
 * ------------------------------------------------------------------
 */
enum IoTDeviceState {
  Online = "Online",
  Offline = "Offline",
  Stale = "Stale",
  Retired = "Retired",
}

export default IoTDeviceState;
