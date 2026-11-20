import { PillTone } from "Common/UI/Components/Pill/PillTone";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * WHAT A DEVICE'S STATE MEANS WHILE ITS FLEET DOES NOT REPORT (#9730, #10014).
 *
 * An IoT fleet's devices report through the fleet's own exporter or
 * collector. While that is disconnected, every device's last state is from
 * before it stopped, and when the collector is what went away every device
 * can read offline then. A red "Offline" on each of them pointed at the
 * devices, when the thing to fix was the fleet's collector.
 *
 * So the Overview's counts say "fleet disconnected" and list no device as
 * offline, and every other place that draws a device's state - the Devices
 * list, a device's own page, the Fleets list's count - says the fleet is
 * disconnected too, and keeps what the device last reported, dated: "Last
 * reported online 3 hours ago". Everything returns once the fleet reports
 * again.
 *
 * Words are English, marked with translationKey() and looked up where they
 * are drawn. React-free, so App tests can read it.
 */

/*
 * Whether the fleet itself reports: its collector, or whatever sends its
 * devices' data, is connected. While it is not, its devices' last states
 * are from before it stopped, and say nothing of them now.
 */
export function isIoTFleetConnected(
  status: string | null | undefined,
): boolean {
  const word: string = (status || "").toLowerCase();
  return word === "connected" || word === "active";
}

export const IOT_DEVICE_ONLINE: string = translationKey("Online");
export const IOT_DEVICE_OFFLINE: string = translationKey("Offline");
// A device's state while its fleet does not report: the fleet is what stopped.
export const IOT_DEVICE_FLEET_DISCONNECTED: string =
  translationKey("Fleet disconnected");
export const IOT_DEVICE_FLEET_DISCONNECTED_TOOLTIP: string = translationKey(
  "Its fleet stopped reporting, so this is not the device's state now. Under it is the state it last reported.",
);

// What a device last reported, while its fleet is disconnected.
export const IOT_DEVICE_LAST_REPORTED_ONLINE: string = translationKey(
  "Last reported online {{time}}",
);
export const IOT_DEVICE_LAST_REPORTED_OFFLINE: string = translationKey(
  "Last reported offline {{time}}",
);

/*
 * The notice over the Devices list and over a device's page while the fleet
 * is disconnected, and where it leads: the fleet's Overview, whose
 * connection card says what to check.
 */
export const IOT_DEVICES_FLEET_DISCONNECTED_NOTICE: string = translationKey(
  "This fleet is disconnected, so no device's state is current. Each device shows the state it last reported.",
);
export const IOT_DEVICE_FLEET_DISCONNECTED_NOTICE: string = translationKey(
  "This device's fleet is disconnected, so its state is not current. This page shows what it last reported.",
);
export const IOT_FLEET_DISCONNECTED_ACTION: string =
  translationKey("See what to check");

export interface IoTDeviceStatusReading {
  // The state's word, in English: looked up where it is drawn.
  label: string;
  tone: PillTone;
  // What the word means, in English, for a pointer and a screen reader.
  tooltip?: string | undefined;
  /*
   * While the fleet is disconnected: the state the device last reported, as
   * a sentence with {{time}}, and when that was.
   */
  lastReport?: { template: string; at: Date } | undefined;
}

function toDate(value: unknown): Date | null {
  if (!value) {
    return null;
  }
  const date: Date = value instanceof Date ? value : new Date(String(value));
  return Number.isFinite(date.getTime()) ? date : null;
}

/*
 * A device's state as the list, its page and anything else that draws it
 * say it. Null until its first heartbeat: the quiet dash. While the fleet
 * reports, Online in green or Offline in red; while it does not, the fleet
 * is what is disconnected, in grey, with the state the device last
 * reported and when.
 */
export function getIoTDeviceStatus(data: {
  isUp: boolean | null | undefined;
  isFleetConnected: boolean;
  lastSeenAt?: Date | string | null | undefined;
}): IoTDeviceStatusReading | null {
  if (data.isUp === undefined || data.isUp === null) {
    return null;
  }

  if (data.isFleetConnected) {
    return data.isUp
      ? { label: IOT_DEVICE_ONLINE, tone: PillTone.Success }
      : { label: IOT_DEVICE_OFFLINE, tone: PillTone.Danger };
  }

  const reading: IoTDeviceStatusReading = {
    label: IOT_DEVICE_FLEET_DISCONNECTED,
    tone: PillTone.Neutral,
    tooltip: IOT_DEVICE_FLEET_DISCONNECTED_TOOLTIP,
  };
  const lastSeenAt: Date | null = toDate(data.lastSeenAt);
  if (lastSeenAt) {
    reading.lastReport = {
      template: data.isUp
        ? IOT_DEVICE_LAST_REPORTED_ONLINE
        : IOT_DEVICE_LAST_REPORTED_OFFLINE,
      at: lastSeenAt,
    };
  }
  return reading;
}

/*
 * The Fleets list's count of a fleet's devices: how many are online while
 * it reports, how many it has while it does not - which of them are online
 * is not known then. Red only while it reports and a device is offline.
 */
export interface IoTFleetDeviceCount {
  // Whether the count is of the devices online (else of every device).
  isOnlineCount: boolean;
  isRed: boolean;
}

export function getIoTFleetDeviceCount(data: {
  total: number;
  online: number;
  isFleetConnected: boolean;
}): IoTFleetDeviceCount {
  if (!data.isFleetConnected) {
    return { isOnlineCount: false, isRed: false };
  }
  return { isOnlineCount: true, isRed: data.online < data.total };
}
