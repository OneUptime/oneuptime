import {
  UplinkRefusal,
  UplinkRefusalReason,
} from "./EndpointUplinkInferenceUtil";

/*
 * Turning "no cable was drawn" into a sentence somebody can act on.
 *
 * Endpoint uplink inference (issue #3489) refuses far more often than it
 * draws, and every one of its refusals has a cause the operator can fix:
 * endpoint collection left off on the site's switches, a router nobody
 * walks so no ARP binding exists, a device added by DNS name, a duplicate
 * hostname, a port that turned out to be an uplink to an unmanaged switch.
 * On a map that simply stays quiet those are all the same thing — a device
 * floating with no line — and indistinguishable from a device that is
 * genuinely unplugged.
 *
 * This is the same argument the link-rule warnings are built on, so this
 * follows their shape: at most one bullet per cause, the affected devices
 * named up to a cap with an exact count beside them, and no bullet at all
 * for a cause with nothing to report.
 *
 * Grouped by CAUSE rather than by device on purpose. Forty tills in a site
 * whose switches have endpoint collection off produce one line telling the
 * operator to turn it on, not forty lines telling them forty times.
 */

/** One bullet in the topology map's warning banner. At most one per cause. */
export interface UplinkInferenceWarning {
  reason: UplinkRefusalReason;
  message: string;
  /*
   * The affected devices themselves, in the same order the sentence names
   * them, capped at MAX_NAMED_DEVICES. A count on its own is a blast radius
   * and not something anybody can act on; this is what turns it back into
   * work, the same way LinkRuleWarning.sites does.
   */
  deviceIds: Array<string>;
  // Exact number affected, still exact when `deviceIds` was capped.
  deviceCount: number;
}

// Named in the sentence before it collapses to "and N more".
export const MAX_NAMED_DEVICES: number = 3;

// Matches the link-rule warnings' own clamp on names inside a sentence.
const MAX_DEVICE_NAME_LENGTH: number = 40;

const UNNAMED_DEVICE: string = "Unnamed device";

/*
 * Fixed bullet order, most-fixable first. Sorting by device count instead
 * would reshuffle the banner between polls as devices come and go, and a
 * warning list that moves is one people stop reading.
 */
const REASON_ORDER: ReadonlyArray<UplinkRefusalReason> = [
  "endpointCollectionOff",
  "arpOnlyAttachment",
  "noMatchableAddress",
  "deviceHasNoSite",
  "ambiguous",
  "noEndpointMatch",
  "portHasMultipleDevices",
  "transitPort",
  "attachmentStale",
  "ipBindingStale",
  "attachmentSourceUnknown",
  "endpointListTruncated",
  "selfAttachment",
];

function clampName(name: string): string {
  const trimmed: string = (name || "").trim() || UNNAMED_DEVICE;
  return trimmed.length > MAX_DEVICE_NAME_LENGTH
    ? `${trimmed.slice(0, MAX_DEVICE_NAME_LENGTH - 1)}…`
    : trimmed;
}

/*
 * "A", "A and B", "A, B and C", "A, B, C and 37 more devices" — the same
 * shape NetworkDeviceLinkRuleUtil.describeSiteList produces for sites, so
 * the two warning banners read as one voice.
 */
function describeDeviceList(names: Array<string>, total: number): string {
  const shown: Array<string> = names.slice(0, MAX_NAMED_DEVICES);
  const remaining: number = total - shown.length;

  if (remaining > 0) {
    return `${shown.join(", ")} and ${remaining} more device${
      remaining === 1 ? "" : "s"
    }`;
  }
  if (shown.length === 1) {
    return shown[0]!;
  }
  if (shown.length === 0) {
    return "";
  }
  return `${shown.slice(0, -1).join(", ")} and ${shown[shown.length - 1]!}`;
}

/*
 * The explanation for one cause. Written as "what we found" then "what to
 * do", because the second half is the only reason the first is on screen.
 * Deliberately says nothing about SNMP internals an operator would have to
 * look up — "endpoint collection", "MAC address table" and "ARP table" are
 * the words the product already uses on the device form.
 */
function explain(
  reason: UplinkRefusalReason,
  deviceList: string,
  count: number,
  portMacCount: number | undefined,
): string {
  const subject: string = count === 1 ? "device" : "devices";
  const verb: string = count === 1 ? "is" : "are";

  switch (reason) {
    case "endpointCollectionOff":
      return `${count} ping-monitored ${subject} cannot be placed because no device in ${
        count === 1 ? "its" : "their"
      } site reads MAC address tables (${deviceList}). Turn on Collect Endpoints for the switches and the router in that site, and their forwarding and ARP tables will place ${
        count === 1 ? "it" : "them"
      } automatically.`;

    case "noEndpointMatch":
      return `${count} ping-monitored ${subject} could not be found in any switch's MAC address table in ${
        count === 1 ? "its" : "their"
      } site (${deviceList}), even though endpoint collection is on there. Usually the router that supplies the ARP address binding is not walked, or ${
        count === 1 ? "the device is" : "the devices are"
      } on a VLAN the forwarding-table walk cannot read.`;

    case "deviceHasNoSite":
      return `${count} ping-monitored ${subject} ${verb} not assigned to a site (${deviceList}). Addresses are only matched within a site, because every site in an estate reuses the same private ranges, so an unassigned device cannot be placed. Set ${
        count === 1 ? "its" : "their"
      } site to place ${count === 1 ? "it" : "them"}.`;

    case "portHasMultipleDevices":
      return `${count} ping-monitored ${subject} resolved to a switch port that more than one device answers on (${deviceList}). Something unmanaged sits between them and the switch — a hub, a desk switch or a daisy-chained handset — so no single cable can be drawn.`;

    case "ipBindingStale":
      return `${count} ping-monitored ${subject} matched an address no router has confirmed recently (${deviceList}). A stored address is never cleared, so it may now belong to a different device; the match is not trusted until a router's ARP table confirms it again.`;

    case "attachmentSourceUnknown":
      return `${count} ping-monitored ${subject} matched an endpoint recorded before OneUptime tracked which walk placed it (${deviceList}). Nothing needs doing — the next walk of that switch records it, and the cable appears then.`;

    case "endpointListTruncated":
      return `${count} ping-monitored ${subject} could not be placed because this map reads more discovered endpoints than it can hold at once (${deviceList}). Open a single site from the Network Sites list to place ${
        count === 1 ? "it" : "them"
      } — the checks that keep a cable honest cannot be made on a partial list.`;

    case "arpOnlyAttachment":
      return `${count} ping-monitored ${subject} ${verb} only in a router's ARP table, not in any switch's MAC address table (${deviceList}). That says which subnet ${
        count === 1 ? "it is" : "they are"
      } on, not which port ${
        count === 1 ? "it is" : "they are"
      } plugged into, so no cable is drawn. Turn on Collect Endpoints for the switches in that site.`;

    case "noMatchableAddress":
      return `${count} ping-monitored ${subject} ${verb} recorded by hostname rather than by IP address (${deviceList}). A switch's tables are keyed on addresses and MACs, so there is nothing to match a name against. Set the device's hostname to its IP address to place it automatically.`;

    case "ambiguous":
      return `${count} ping-monitored ${subject} ${
        count === 1 ? "shares" : "share"
      } an address with another device or another discovered endpoint in the same site (${deviceList}). Which one is plugged into which port cannot be told apart, so no cable is drawn for either. Correct the duplicate address to place ${
        count === 1 ? "it" : "them"
      }.`;

    case "transitPort":
      return `${count} ping-monitored ${subject} ${verb} on a switch port carrying ${
        portMacCount ? `${portMacCount} ` : "too many "
      }MAC addresses to be an access port (${deviceList}). That port leads to gear that reports no neighbours — an unmanaged switch, a hub or a media converter — so which switch ${
        count === 1 ? "the device" : "each device"
      } really hangs off cannot be established from it.`;

    case "attachmentStale":
      return `${count} ping-monitored ${subject} ${
        count === 1 ? "was" : "were"
      } last seen by ${
        count === 1 ? "its" : "their"
      } switch too long ago to draw a current cable from (${deviceList}). Either the switch has stopped being polled, or ${
        count === 1 ? "the device has" : "the devices have"
      } been unplugged.`;

    case "selfAttachment":
      return `${count} ping-monitored ${subject} resolved to a port on ${
        count === 1 ? "itself" : "themselves"
      } (${deviceList}), which cannot be drawn. This usually means two devices were created for one box.`;

    default:
      return `${count} ping-monitored ${subject} could not be placed automatically (${deviceList}).`;
  }
}

export default class EndpointUplinkWarningUtil {
  /*
   * Groups refusals into at most one bullet per cause.
   *
   * `deviceNameById` is best-effort: a refusal whose device is not in it
   * still counts, it is simply named generically. The count is what the
   * operator acts on and it must never be smaller than the truth.
   */
  public static getWarnings(
    refusals: Array<UplinkRefusal>,
    deviceNameById: Map<string, string>,
  ): Array<UplinkInferenceWarning> {
    const byReason: Map<UplinkRefusalReason, Array<UplinkRefusal>> = new Map<
      UplinkRefusalReason,
      Array<UplinkRefusal>
    >();

    for (const refusal of refusals) {
      const bucket: Array<UplinkRefusal> | undefined = byReason.get(
        refusal.reason,
      );
      if (bucket) {
        bucket.push(refusal);
      } else {
        byReason.set(refusal.reason, [refusal]);
      }
    }

    const warnings: Array<UplinkInferenceWarning> = [];

    for (const reason of REASON_ORDER) {
      const bucket: Array<UplinkRefusal> | undefined = byReason.get(reason);
      if (!bucket || bucket.length === 0) {
        continue;
      }

      /*
       * Sorted by NAME, not by id. The id order the inference returns is
       * stable but meaningless to a reader, and a banner that lists tills
       * in a jumble is harder to scan than one that lists them in order.
       */
      const named: Array<{ deviceId: string; name: string }> = bucket
        .map((refusal: UplinkRefusal) => {
          return {
            deviceId: refusal.deviceId,
            name: clampName(deviceNameById.get(refusal.deviceId) || ""),
          };
        })
        .sort(
          (
            a: { deviceId: string; name: string },
            b: { deviceId: string; name: string },
          ): number => {
            const aName: string = a.name.toLowerCase();
            const bName: string = b.name.toLowerCase();
            if (aName !== bName) {
              return aName < bName ? -1 : 1;
            }
            return a.deviceId < b.deviceId ? -1 : 1;
          },
        );

      /*
       * The port occupancy of the FIRST listed device, used only to make
       * the transit-port sentence concrete. Different devices behind one
       * uplink report the same number anyway.
       */
      const portMacCount: number | undefined = bucket.find(
        (refusal: UplinkRefusal) => {
          return refusal.portMacCount !== undefined;
        },
      )?.portMacCount;

      warnings.push({
        reason: reason,
        deviceCount: named.length,
        deviceIds: named
          .slice(0, MAX_NAMED_DEVICES)
          .map((entry: { deviceId: string; name: string }) => {
            return entry.deviceId;
          }),
        message: explain(
          reason,
          describeDeviceList(
            named.map((entry: { deviceId: string; name: string }) => {
              return entry.name;
            }),
            named.length,
          ),
          named.length,
          portMacCount,
        ),
      });
    }

    return warnings;
  }
}
