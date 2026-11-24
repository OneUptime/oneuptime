import { JSONValue } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import {
  AmbiguousAddressReason,
  DeviceAtAddressLike,
  DeviceSeenFrom,
  NoDeviceReason,
  toIdKey,
} from "./DeviceAddressScope";

/*
 * A MONITOR THAT CHECKS A DEVICE'S ADDRESS BUT IS TIED TO NO DEVICE, as a
 * device's page lists it (OneUptime issue #9903): what its probes see at
 * the address, by the rule a tie is made by (DeviceAddressScope). The
 * server works it out (Server/Utils/NetworkDevice/UntiedDeviceMonitors)
 * and the device's Monitors card reads its answer
 * (readUntiedDeviceMonitorsAnswer). Pure, for both.
 */

export enum UntiedMonitorMatch {
  // Its probes see this device at the address: one click ties it.
  ThisDevice = "ThisDevice",
  // Its probes see this device and others there, and cannot tell them apart.
  CannotTellApart = "CannotTellApart",
  /*
   * Its probes poll no device and are no site's default probe, so where they
   * look cannot be known - and this device, the only one at the address, is
   * in a site.
   */
  ProbesInNoSite = "ProbesInNoSite",
}

export interface UntiedDeviceMonitor {
  monitorId: string;
  name: string;
  monitorType: string;
  match: UntiedMonitorMatch;
  // Why its probes cannot tell the devices apart (CannotTellApart).
  ambiguousReason?: AmbiguousAddressReason | undefined;
  // The other devices they cannot tell this one from, by id (lower case).
  otherDeviceIds?: Array<string> | undefined;
}

export interface UntiedDeviceMonitorsAnswer {
  monitors: Array<UntiedDeviceMonitor>;
  // More monitors held the address than were read.
  hasMore: boolean;
}

export type UntiedMonitorMatchFacts = Pick<
  UntiedDeviceMonitor,
  "match" | "ambiguousReason" | "otherDeviceIds"
>;

/*
 * How one monitor's probes see this device at its address, or null when
 * the monitor checks some other host there: another device, or none
 * OneUptime knows.
 */
export function getUntiedMonitorMatch<T extends DeviceAtAddressLike>(data: {
  deviceId: ObjectID | string;
  seen: DeviceSeenFrom<T> | null | undefined;
}): UntiedMonitorMatchFacts | null {
  const deviceKey: string = toIdKey(data.deviceId);
  const seen: DeviceSeenFrom<T> | null | undefined = data.seen;

  if (!deviceKey || !seen) {
    return null;
  }

  if (seen.kind === "device") {
    return toIdKey(seen.device.id) === deviceKey
      ? { match: UntiedMonitorMatch.ThisDevice }
      : null;
  }

  if (seen.kind === "ambiguous") {
    const ids: Array<string> = seen.devices.map((device: T): string => {
      return toIdKey(device.id);
    });

    if (!ids.includes(deviceKey)) {
      return null;
    }

    return {
      match: UntiedMonitorMatch.CannotTellApart,
      ambiguousReason: seen.reason,
      otherDeviceIds: Array.from(
        new Set<string>(
          ids.filter((id: string): boolean => {
            return Boolean(id) && id !== deviceKey;
          }),
        ),
      ),
    };
  }

  /*
   * The probes are no site's and the one device at the address is in a
   * site: a monitor is never tied to it on a guess, but it may well be it.
   */
  if (seen.reason === NoDeviceReason.ReachUnknownDeviceInASite) {
    return { match: UntiedMonitorMatch.ProbesInNoSite };
  }

  return null;
}

function isOneOf<T extends string>(
  values: ReadonlyArray<T>,
  value: unknown,
): value is T {
  return typeof value === "string" && values.includes(value as T);
}

const MATCHES: ReadonlyArray<UntiedMonitorMatch> =
  Object.values(UntiedMonitorMatch);

const AMBIGUOUS_REASONS: ReadonlyArray<AmbiguousAddressReason> = Object.values(
  AmbiguousAddressReason,
);

/*
 * The server's answer as a page reads it: each monitor once, with an id
 * that is one and a match it knows - and, for one whose probes cannot tell
 * this device from others, a reason the page can say, with the others' ids
 * that are ids. Anything else is left out, so a page never draws a row it
 * cannot explain.
 */
export function readUntiedDeviceMonitorsAnswer(
  value: JSONValue | undefined,
): UntiedDeviceMonitorsAnswer {
  const answer: UntiedDeviceMonitorsAnswer = { monitors: [], hasMore: false };

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return answer;
  }

  const body: { [key: string]: JSONValue } = value as {
    [key: string]: JSONValue;
  };

  answer.hasMore = body["hasMore"] === true;

  const rows: JSONValue = body["monitors"];

  if (!Array.isArray(rows)) {
    return answer;
  }

  const seen: Set<string> = new Set<string>();

  for (const row of rows) {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      continue;
    }

    const item: { [key: string]: JSONValue } = row as {
      [key: string]: JSONValue;
    };
    const monitorId: string = toIdKey(
      typeof item["monitorId"] === "string" ? item["monitorId"] : "",
    );
    const match: JSONValue = item["match"];

    if (
      !monitorId ||
      !ObjectID.isValidUUID(monitorId) ||
      seen.has(monitorId) ||
      !isOneOf(MATCHES, match)
    ) {
      continue;
    }

    const ambiguousReason: JSONValue = item["ambiguousReason"];

    if (
      match === UntiedMonitorMatch.CannotTellApart &&
      !isOneOf(AMBIGUOUS_REASONS, ambiguousReason)
    ) {
      continue;
    }

    seen.add(monitorId);

    const monitor: UntiedDeviceMonitor = {
      monitorId: monitorId,
      name: typeof item["name"] === "string" ? item["name"] : "",
      monitorType:
        typeof item["monitorType"] === "string" ? item["monitorType"] : "",
      match: match,
    };

    if (
      match === UntiedMonitorMatch.CannotTellApart &&
      isOneOf(AMBIGUOUS_REASONS, ambiguousReason)
    ) {
      monitor.ambiguousReason = ambiguousReason;

      const others: JSONValue = item["otherDeviceIds"];
      const otherDeviceIds: Array<string> = [];

      for (const id of Array.isArray(others) ? others : []) {
        const key: string = toIdKey(typeof id === "string" ? id : "");

        if (key && ObjectID.isValidUUID(key) && !otherDeviceIds.includes(key)) {
          otherDeviceIds.push(key);
        }
      }

      monitor.otherDeviceIds = otherDeviceIds;
    }

    answer.monitors.push(monitor);
  }

  return answer;
}
