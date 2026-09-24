/*
 * What each number on the IoT fleet pages means, in plain words. Shown in
 * the (i) tooltip beside a tile, summary field or column title.
 *
 * Each text describes what the page actually computes, not what the title
 * might suggest:
 *
 *   - The fleet overview tiles follow the time range picker and use each
 *     device's latest reading in that range, falling back to the counts the
 *     fleet sent most recently when the range has no heartbeats. The
 *     "devices online" chip beside the fleet name shows the same count, and
 *     shows the fleet's own counts until the heartbeats first load.
 *   - "Devices needing attention", the device detail fields and the Devices
 *     table read the device inventory: the last value each device sent,
 *     whatever the picker says. Only the attention list checks that battery
 *     and signal readings are fresh (15 minutes).
 *   - The Fleets list counts come from the latest data the fleet sent.
 *
 * Change the fetch, change the words.
 */

export type IoTMetric =
  // Fleet overview (Pages/IoT/View/Index.tsx)
  | "heroDevicesOnline"
  | "onlineDevices"
  | "totalDevices"
  | "avgBattery"
  | "avgSignal"
  | "devicesNeedingAttention"
  // Device detail (Pages/IoT/View/DeviceDetail.tsx)
  | "deviceStatus"
  | "uptime"
  | "battery"
  | "signalStrength"
  | "temperature"
  | "cpu"
  | "memory"
  // Devices table (Pages/IoT/View/Devices.tsx)
  | "statusColumn"
  | "batteryColumn"
  | "signalColumn"
  | "temperatureColumn"
  // Fleets list (Pages/IoT/Fleets.tsx)
  | "fleetDevices";

export const IOT_METRIC_DESCRIPTIONS: Record<IoTMetric, string> = {
  heroDevicesOnline:
    "Devices online out of all devices, counted like the Online Devices tile from each device's latest up/down heartbeat in the selected time range. Until the heartbeats first load, or if none arrived in the range, it shows the counts from the fleet's most recent data.",
  onlineDevices:
    "Devices whose latest up/down heartbeat in the selected time range says they are up, out of every device that sent a heartbeat in that range. If no heartbeats arrived in the range, the counts from the fleet's most recent data are shown.",
  totalDevices:
    "Devices that sent an up/down heartbeat at any time in the selected time range; a device that was silent for the whole range is not counted. If none arrived in the range, the count from the fleet's most recent data is shown.",
  avgBattery:
    "The average battery level of the devices that report one, using each device's most recent readings in the selected time range. The bar turns amber below 40% and red below 20%.",
  avgSignal:
    "The average wireless signal strength of the devices that report one, using each device's most recent readings in the selected time range. It is in dBm, which is negative: closer to 0 is stronger, around -50 is excellent and below -100 is weak.",
  devicesNeedingAttention:
    "Devices marked offline, plus devices whose latest reading shows battery below 20% or signal weaker than -100 dBm. Battery and signal only count if the device reported in the last 15 minutes, and this list ignores the time range picker.",
  deviceStatus:
    "Online or Offline, from the latest up/down heartbeat this device sent. If it has stopped reporting, check Last Seen: a registered device that stays silent is eventually marked Offline.",
  uptime:
    "How long the device had been running since it last started, as of its most recent report. The value does not keep counting while the device is silent.",
  battery:
    "Battery charge from this device's most recent report. If the device has stopped reporting, this is the last value it sent, so compare it with Last Seen.",
  signalStrength:
    "Wireless signal strength from this device's most recent report, in dBm. Values are negative and closer to 0 is stronger: around -50 is excellent, while below -100 is weak and data may drop.",
  temperature:
    "Temperature in degrees Celsius that this device reported most recently. Like the other values here, it is the last one sent, even if the device has since gone quiet.",
  cpu: "How busy the device's processor was at its most recent report, as a share of its full capacity. 100% means the CPU was completely busy.",
  memory:
    "Memory the device was using compared with its total memory, both from its most recent report. A dash after the slash means the device does not report its total memory.",
  statusColumn:
    "Online or Offline, from each device's latest up/down heartbeat. A dash means no heartbeat has arrived yet, and a registered device that stops reporting is eventually marked Offline.",
  batteryColumn:
    "Battery charge from each device's most recent report, shown in red at 20% or below. It is the last value sent, even if the device has since stopped reporting.",
  signalColumn:
    "Wireless signal strength in dBm from each device's most recent report. Values are negative: closer to 0 is stronger, and below -100 dBm is weak.",
  temperatureColumn:
    "Temperature in degrees Celsius from each device's most recent report. A dash means the device does not report temperature.",
  fleetDevices:
    "Devices online out of all devices, counted from the most recent data the fleet sent rather than from a time range. Shown in red when any of them is offline.",
};
