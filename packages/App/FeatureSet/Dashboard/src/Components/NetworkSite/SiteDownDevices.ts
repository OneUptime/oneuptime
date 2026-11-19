import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import Route from "Common/Types/API/Route";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import { translateRecordName } from "Common/Utils/DefaultRecordNames";
import { StateListType } from "Common/Utils/StateOrder";
import DeviceStatusUtil, {
  DeviceReachabilityResult,
  NetworkDeviceStatus,
  PROBE_POLLED_DOWN_TOOLTIP,
} from "../NetworkDevice/DeviceStatusUtil";
import {
  ResourceAttentionItem,
  ResourceAttentionSeverity,
  ResourceAttentionText,
  sortResourceAttention,
} from "../ResourcePart/ResourceAttention";

/*
 * WHICH DEVICES OF A SITE ARE DOWN, AND WHY (#9596).
 *
 * A site's hero said "Devices 12 · 10 up · 2 down" and nothing about which
 * two: the reader opened the Devices tab and looked for the red ones. "2
 * down" now opens them (ResourceAttentionPill), each with why, by the one
 * rule every device surface reads (DeviceStatusUtil):
 *
 *   - a device its probe polls: the last poll reached it by neither ping
 *     nor SNMP, and when it last answered;
 *   - a device a monitor reports for: the monitor's status, as its badge
 *     names it;
 *
 * and View, a step from its page. The hero has read the devices for their
 * counts already, so nothing more is read.
 *
 * React-free and route-free (the hero hands the routes in), so tests read
 * it as it is.
 */

export const SITE_DOWN_DEVICES_HINT: string = translationKey(
  "Show which devices and why",
);

export const SITE_DOWN_DEVICES_DESCRIPTION: string = translationKey(
  "The devices of this site that are down now, and why.",
);

export const SITE_DOWN_DEVICES_EMPTY: string = translationKey(
  "No device of this site is down now.",
);

// The device list's own sentence for a down device a monitor reports for.
export const MONITOR_BACKED_DOWN_SENTENCE: string = translationKey(
  "The monitor bound to this device reports it offline.",
);

// The columns this reads, beside DEVICE_STATUS_SELECT's.
export const SITE_DEVICE_NAME_SELECT: {
  _id: boolean;
  name: boolean;
  hostname: boolean;
} = {
  _id: true,
  name: true,
  hostname: true,
};

/*
 * A site's health says what everything beneath it rolls up to, so an
 * Offline or Degraded site opens what is not operational under it: its own
 * devices that are down, then each child site that is not operational -
 * whose own hero says, in turn, what is wrong under it.
 */
export const SITE_HEALTH_HINT: string = translationKey("Show why");

export const SITE_HEALTH_TITLE: string = translationKey(
  "Why is this site {{status}}?",
);

export const SITE_HEALTH_DESCRIPTION: string = translationKey(
  "What is not operational under this site now: its devices that are down, then its child sites.",
);

export const SITE_HEALTH_EMPTY: string = translationKey(
  "Nothing under this site is down now. Its health is from its last rollup.",
);

export const CHILD_SITE_SENTENCE: string = translationKey(
  "Something under this child site is not operational. Open it to see what.",
);

export const SITE_HEALTH_LOAD_FAILED: string = translationKey(
  "Couldn't read this site's child sites.",
);

// How many child sites one read lists: the worst are the ones not operational.
export const SITE_CHILD_SITES_LIMIT: number = 100;

// A child site, as the health dialog reads it.
export interface SiteChildRow {
  id: string;
  name: string;
  statusName: string;
  isOperationalState: boolean;
  isOfflineState: boolean;
}

export function getSiteChildItems(data: {
  children: Array<SiteChildRow>;
  translator: Translator;
  getSiteRoute: (siteId: string) => Route;
}): Array<ResourceAttentionItem> {
  const items: Array<ResourceAttentionItem> = [];

  for (const child of data.children) {
    if (!child.statusName || child.isOperationalState) {
      continue;
    }

    items.push({
      key: `site-${child.id}`,
      kind: "Child Site",
      icon: IconProp.BuildingOffice,
      name: child.name || child.id,
      severity: child.isOfflineState
        ? ResourceAttentionSeverity.Critical
        : ResourceAttentionSeverity.Warning,
      reasons: [
        {
          text: "{{reason}}",
          values: {
            reason: translateRecordName(
              data.translator,
              StateListType.MonitorStatus,
              child.statusName,
            ),
          },
        },
      ],
      explanation:
        data.translator.translateText(CHILD_SITE_SENTENCE) ||
        CHILD_SITE_SENTENCE,
      route: data.getSiteRoute(child.id),
    });
  }

  return sortResourceAttention(items);
}

export function getSiteDownDeviceItems(data: {
  devices: Array<NetworkDevice>;
  translator: Translator;
  getDeviceRoute: (deviceId: string) => Route;
}): Array<ResourceAttentionItem> {
  const items: Array<ResourceAttentionItem> = [];

  for (const device of data.devices) {
    const reachability: DeviceReachabilityResult =
      DeviceStatusUtil.getReachability(device);

    if (reachability.status !== NetworkDeviceStatus.Down) {
      continue;
    }

    const deviceId: string = device._id?.toString() || "";
    const statusName: string = device.currentMonitorStatus?.name || "";
    const reasons: Array<ResourceAttentionText> = [];

    /*
     * The monitor's status, as its badge names it: one of OneUptime's own
     * in the reader's words, a status the project named as written. A
     * template of nothing but its value reads as the value in every
     * language.
     */
    if (reachability.isMonitorBacked && statusName) {
      reasons.push({
        text: "{{reason}}",
        values: {
          reason: translateRecordName(
            data.translator,
            StateListType.MonitorStatus,
            statusName,
          ),
        },
      });
    }

    const sentence: string = reachability.isMonitorBacked
      ? MONITOR_BACKED_DOWN_SENTENCE
      : PROBE_POLLED_DOWN_TOOLTIP;
    const lastSeenAt: Date | undefined = device.lastSeenAt
      ? OneUptimeDate.fromString(device.lastSeenAt)
      : undefined;

    items.push({
      key: `device-${deviceId}`,
      kind: "Network Device",
      icon: IconProp.Signal,
      name: device.name || device.hostname || deviceId,
      detail:
        device.hostname && device.hostname !== device.name
          ? device.hostname
          : undefined,
      severity: ResourceAttentionSeverity.Critical,
      reasons: reasons,
      explanation: data.translator.translateText(sentence) || sentence,
      // When it last answered a poll: a device its probe polls.
      lastReportAt: reachability.isMonitorBacked ? undefined : lastSeenAt,
      route: deviceId ? data.getDeviceRoute(deviceId) : undefined,
    });
  }

  return sortResourceAttention(items);
}
