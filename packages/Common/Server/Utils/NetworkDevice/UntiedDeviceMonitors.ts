import Monitor from "../../../Models/DatabaseModels/Monitor";
import NetworkDevice from "../../../Models/DatabaseModels/NetworkDevice";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import ObjectID from "../../../Types/ObjectID";
import { DEVICE_TARGET_MONITOR_TYPES } from "../../../Utils/Monitor/DeviceMonitorTemplateUtil";
import {
  DeviceSeenFrom,
  WhenReachUnknown,
  toIdKey,
} from "../../../Utils/NetworkDevice/DeviceAddressScope";
import {
  getHostLookupValues,
  getMonitorCheckedHost,
  isSameHost,
} from "../../../Utils/NetworkDevice/MonitorCheckedHost";
import MonitorService from "../../Services/MonitorService";
import NetworkDeviceService from "../../Services/NetworkDeviceService";
import QueryHelper from "../../Types/Database/QueryHelper";
import MonitorDeviceLinkBackfill from "./MonitorDeviceLinkBackfill";
import {
  UntiedDeviceMonitor,
  UntiedDeviceMonitorsAnswer,
  UntiedMonitorMatchFacts,
  getUntiedMonitorMatch,
} from "../../../Utils/NetworkDevice/UntiedDeviceMonitor";

/*
 * THE MONITORS THAT CHECK A DEVICE'S ADDRESS BUT ARE TIED TO NO DEVICE
 * (OneUptime issue #9903).
 *
 * A Ping, IP, Port, NTP, Website, API or SSL Certificate monitor made from
 * Monitors is tied to the device its probes see at the address it checks
 * (Monitor.networkDeviceId; issues #9545, #9677) - when there is one as it
 * is made. One made before the device was added, one whose probes could not
 * tell two sites' devices apart, and one whose probes are no site's is left
 * untied: it is not on the device's pages, what it raises is not linked to
 * the device, and imports may give the device a second monitor like it.
 * Nothing pointed a person to those, short of opening every monitor.
 *
 * So a device's page asks which monitors check its address and are tied to
 * no device, and, for each, what its probes see there by the same rule
 * (DeviceAddressScope, as a tie is made):
 *
 *   - this device: one click ties it (UntiedMonitorMatch.ThisDevice);
 *   - this device and others its probes cannot tell apart: the page says
 *     so, and which (CannotTellApart);
 *   - nothing it can know: its probes poll no device and are no site's
 *     default probe, and this device is in a site (ProbesInNoSite).
 *
 * A monitor whose probes see another device at the address, or none there
 * - another network's host at the same address - checks some other host,
 * and is not listed.
 *
 * The address of a monitor is inside its steps (JSON), which no index can
 * search: the monitors are found by their steps' text holding the device's
 * address (QueryHelper.textContainsAnyOf) among the project's untied
 * monitors of those kinds, at most UNTIED_MONITORS_READ_LIMIT, and each is
 * checked as a tie checks it (getMonitorCheckedHost). Read as OneUptime,
 * then held to what the caller may read.
 */

// The most monitors one device's page reads for its address.
export const UNTIED_MONITORS_READ_LIMIT: number = 100;

// What the device is read with: its address, and where it is.
export type DeviceForUntiedMonitors = Pick<
  NetworkDevice,
  "id" | "hostname" | "siteId" | "probeId"
>;

// The probes each monitor runs on, sorted, as one key per set.
function getProbeSetKey(probeIds: ReadonlyArray<string>): string {
  return Array.from(new Set<string>(probeIds)).sort().join(",");
}

export default class UntiedDeviceMonitors {
  public static async findFor(data: {
    projectId: ObjectID;
    device: DeviceForUntiedMonitors;
    props: DatabaseCommonInteractionProps;
  }): Promise<UntiedDeviceMonitorsAnswer> {
    const host: string = (data.device.hostname || "").trim();
    const empty: UntiedDeviceMonitorsAnswer = { monitors: [], hasMore: false };

    if (!data.device.id || getHostLookupValues(host).length === 0) {
      return empty;
    }

    // The untied monitors of those kinds whose steps hold the address.
    const candidates: Array<Monitor> = await MonitorService.findBy({
      query: {
        projectId: data.projectId,
        monitorType: QueryHelper.any([...DEVICE_TARGET_MONITOR_TYPES]),
        networkDeviceId: QueryHelper.isNull(),
        autoProvisionedNetworkDeviceId: QueryHelper.isNull(),
        monitorSteps: QueryHelper.textContainsAnyOf(getHostLookupValues(host)),
      },
      select: {
        _id: true,
        monitorType: true,
        monitorSteps: true,
      },
      sort: { name: SortOrder.Ascending },
      limit: UNTIED_MONITORS_READ_LIMIT + 1,
      skip: 0,
      props: { isRoot: true },
    });

    const hasMore: boolean = candidates.length > UNTIED_MONITORS_READ_LIMIT;

    // Those whose every step checks the device's address, as a tie reads it.
    const checking: Array<Monitor> = candidates
      .slice(0, UNTIED_MONITORS_READ_LIMIT)
      .filter((monitor: Monitor): boolean => {
        return (
          Boolean(monitor.id) &&
          isSameHost(
            getMonitorCheckedHost({
              monitorType: monitor.monitorType,
              monitorSteps: monitor.monitorSteps,
            }),
            host,
          )
        );
      });

    if (checking.length === 0) {
      return { monitors: [], hasMore: hasMore };
    }

    // Of those, the ones the caller may read, with their names.
    const readable: Array<Monitor> = await MonitorService.findBy({
      query: {
        projectId: data.projectId,
        _id: QueryHelper.any(
          checking.map((monitor: Monitor): ObjectID => {
            return monitor.id!;
          }),
        ),
      },
      select: { _id: true, name: true, monitorType: true },
      sort: { name: SortOrder.Ascending },
      limit: checking.length,
      skip: 0,
      props: data.props,
    });

    if (readable.length === 0) {
      return { monitors: [], hasMore: hasMore };
    }

    // The probes each runs on, enabled or not, as a tie reads them.
    const probesByMonitor: Map<
      string,
      Array<string>
    > = await MonitorDeviceLinkBackfill.readProbesOfMonitors({
      projectId: data.projectId,
      monitorIds: readable.map((monitor: Monitor): ObjectID => {
        return monitor.id!;
      }),
    });

    // Every device in the project at the address.
    const atHostnames: Map<
      string,
      Array<NetworkDevice>
    > = await NetworkDeviceService.getAllDevicesAtHostnames({
      projectId: data.projectId,
      hostnames: getHostLookupValues(host),
      select: { _id: true, hostname: true, siteId: true, probeId: true },
      props: { isRoot: true },
    });

    const candidatesAtAddress: Array<NetworkDevice> = [];

    for (const devices of atHostnames.values()) {
      candidatesAtAddress.push(...devices);
    }

    // What each set of probes sees there: asked once per set.
    const seenByProbeSet: Map<string, DeviceSeenFrom<NetworkDevice> | null> =
      new Map();

    const monitors: Array<UntiedDeviceMonitor> = [];

    for (const monitor of readable) {
      const probeIds: Array<string> =
        probesByMonitor.get(toIdKey(monitor.id)) || [];
      const probeSetKey: string = getProbeSetKey(probeIds);

      if (!seenByProbeSet.has(probeSetKey)) {
        seenByProbeSet.set(
          probeSetKey,
          await this.seeFrom({
            projectId: data.projectId,
            host: host,
            candidates: candidatesAtAddress,
            probeIds: probeIds,
          }),
        );
      }

      const match: UntiedMonitorMatchFacts | null = getUntiedMonitorMatch({
        deviceId: data.device.id,
        seen: seenByProbeSet.get(probeSetKey),
      });

      if (!match) {
        continue;
      }

      monitors.push({
        monitorId: monitor.id!.toString(),
        name: monitor.name || "",
        monitorType: String(monitor.monitorType || ""),
        ...match,
      });
    }

    return { monitors: monitors, hasMore: hasMore };
  }

  // What monitors running on these probes see at the address.
  private static async seeFrom(data: {
    projectId: ObjectID;
    host: string;
    candidates: Array<NetworkDevice>;
    probeIds: Array<string>;
  }): Promise<DeviceSeenFrom<NetworkDevice> | null> {
    if (data.candidates.length === 0) {
      return null;
    }

    const seen: Map<
      string,
      DeviceSeenFrom<NetworkDevice>
    > = await NetworkDeviceService.resolveDevicesSeenFrom({
      projectId: data.projectId,
      devicesByAddress: new Map<string, Array<NetworkDevice>>([
        [data.host, data.candidates],
      ]),
      seenFrom: {
        probeIds: data.probeIds,
        // As a monitor's tie reads it: never another site's on a guess.
        whenReachUnknown: WhenReachUnknown.OnlyDeviceInNoSite,
      },
    });

    return seen.get(data.host) || null;
  }
}
