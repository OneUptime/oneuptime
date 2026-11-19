import IoTDeviceModel from "Common/Models/DatabaseModels/IoTDevice";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import {
  ResourceAttentionItem,
  ResourceAttentionSeverity,
  ResourceAttentionText,
} from "../../../Components/ResourcePart/ResourceAttention";
import { METRIC_STALE_MS, displayNameForDevice } from "./IoTDeviceUtils";

/*
 * WHICH OF A FLEET'S DEVICES NEED ATTENTION, AND WHY.
 *
 * The Overview's "Devices needing attention" card lists them, and its "3/5
 * devices online" chip and Online Devices tile count the ones offline - a
 * count that said how many and nothing else (#9594), now a pill that opens
 * exactly those devices, with when each last reported. One rule for all
 * three: the IoTDevice inventory, the same rows the side menu's badges
 * count. An offline device is critical (red); a low battery or a weak
 * signal is a warning (amber), read only from metrics fresh enough to be
 * today's, so a device that fell off the stream is never flagged on old
 * numbers.
 *
 * React-free (pages hand in routeFor), so tests read it.
 */

/*
 * The lines the list and the battery and signal tiles turn at, the default
 * IoT alert templates' (lowBattery < 20%, weakSignal < -100 dBm).
 */
export const IOT_LOW_BATTERY_PERCENT: number = 20;
export const IOT_WEAK_SIGNAL_DBM: number = -100;

const REASON_OFFLINE: string = translationKey("Offline");
const REASON_BATTERY: string = translationKey("Battery {{percent}}%");
const REASON_SIGNAL: string = translationKey("Signal {{dbm}} dBm");

/*
 * Why a device needs attention, as a sentence to translate when it is drawn
 * (so a language switch rewords it without reloading the inventory).
 */
export interface IoTAtRiskReason {
  template: string;
  values?: Record<string, string> | undefined;
}

export interface IoTAtRiskDevice {
  externalId: string;
  name: string;
  reasons: Array<IoTAtRiskReason>;
  // True drives the red (offline) treatment, false amber (a warning).
  isCritical: boolean;
  // When the device last reported, as the inventory saw it.
  lastSeenAt: Date | null;
}

function toDate(value: unknown): Date | null {
  if (!value) {
    return null;
  }
  const date: Date = value instanceof Date ? value : new Date(String(value));
  return Number.isFinite(date.getTime()) ? date : null;
}

// The devices that need attention, offline ones first, then by name.
export function getIoTAtRiskDevices(data: {
  rows: Array<IoTDeviceModel>;
  now: number;
}): Array<IoTAtRiskDevice> {
  const atRisk: Array<IoTAtRiskDevice> = [];

  for (const row of data.rows) {
    const reasons: Array<IoTAtRiskReason> = [];
    let isCritical: boolean = false;

    if (row.isUp === false) {
      reasons.push({ template: REASON_OFFLINE });
      isCritical = true;
    }

    const metricsFresh: boolean = row.metricsUpdatedAt
      ? data.now - new Date(row.metricsUpdatedAt as Date).getTime() <=
        METRIC_STALE_MS
      : false;

    if (metricsFresh) {
      if (
        row.latestBatteryPercent !== null &&
        row.latestBatteryPercent !== undefined &&
        Number(row.latestBatteryPercent) < IOT_LOW_BATTERY_PERCENT
      ) {
        reasons.push({
          template: REASON_BATTERY,
          values: {
            percent: Number(row.latestBatteryPercent).toFixed(0),
          },
        });
      }
      if (
        row.latestSignalStrengthDbm !== null &&
        row.latestSignalStrengthDbm !== undefined &&
        Number(row.latestSignalStrengthDbm) < IOT_WEAK_SIGNAL_DBM
      ) {
        reasons.push({
          template: REASON_SIGNAL,
          values: { dbm: Number(row.latestSignalStrengthDbm).toFixed(0) },
        });
      }
    }

    if (reasons.length > 0) {
      atRisk.push({
        externalId: row.externalId || "",
        name: displayNameForDevice(row),
        reasons: reasons,
        isCritical: isCritical,
        lastSeenAt: toDate(row.lastSeenAt),
      });
    }
  }

  // Critical (offline) devices first, then by name for a stable list.
  atRisk.sort((a: IoTAtRiskDevice, b: IoTAtRiskDevice): number => {
    if (a.isCritical !== b.isCritical) {
      return a.isCritical ? -1 : 1;
    }
    return a.name.localeCompare(b.name);
  });

  return atRisk;
}

// A reason's values as a list's row writes them: plain text.
function toAttentionText(reason: IoTAtRiskReason): ResourceAttentionText {
  return reason.values
    ? { text: reason.template, values: reason.values }
    : { text: reason.template };
}

/*
 * The devices the online count leaves out, as the list a press opens draws
 * them: each offline device with every reason it needs a look, when it last
 * reported, and its page.
 */
export function getIoTOfflineDeviceItems(data: {
  devices: Array<IoTAtRiskDevice>;
  routeFor: (externalId: string) => Route | undefined;
}): Array<ResourceAttentionItem> {
  return data.devices
    .filter((device: IoTAtRiskDevice): boolean => {
      return device.isCritical;
    })
    .map((device: IoTAtRiskDevice): ResourceAttentionItem => {
      const item: ResourceAttentionItem = {
        key: `Device:${device.externalId || device.name}`,
        kind: translationKey("Device"),
        icon: IconProp.Cube,
        name: device.name,
        severity: ResourceAttentionSeverity.Critical,
        reasons: device.reasons.map(toAttentionText),
        route: device.externalId ? data.routeFor(device.externalId) : undefined,
      };
      if (device.lastSeenAt) {
        item.lastReportAt = device.lastSeenAt;
      }
      return item;
    });
}
