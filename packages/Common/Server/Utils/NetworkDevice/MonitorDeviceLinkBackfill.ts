import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorProbe from "../../../Models/DatabaseModels/MonitorProbe";
import NetworkDevice from "../../../Models/DatabaseModels/NetworkDevice";
import NetworkSite from "../../../Models/DatabaseModels/NetworkSite";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import LIMIT_MAX from "../../../Types/Database/LimitMax";
import ObjectID from "../../../Types/ObjectID";
import { DEVICE_TARGET_MONITOR_TYPES } from "../../../Utils/Monitor/DeviceMonitorTemplateUtil";
import {
  DeviceSeenFrom,
  ProbeReach,
  ProbeReachIndex,
  WhenReachUnknown,
  buildProbeReachIndex,
  getSiteKeysOf,
  pickDeviceSeenFrom,
  readProbeReachFacts,
  toIdKey,
  toProbeReach,
} from "../../../Utils/NetworkDevice/DeviceAddressScope";
import { getMonitorCheckedHost } from "../../../Utils/NetworkDevice/MonitorCheckedHost";
import DeviceWebUiUtil from "../../../Utils/NetworkDevice/DeviceWebUiUtil";
import MonitorProbeService from "../../Services/MonitorProbeService";
import MonitorService from "../../Services/MonitorService";
import NetworkDeviceService from "../../Services/NetworkDeviceService";
import NetworkSiteService from "../../Services/NetworkSiteService";
import QueryHelper from "../../Types/Database/QueryHelper";
import logger from "../Logger";

/*
 * TIES THE MONITORS PEOPLE MADE BEFORE ISSUE #9545 TO THEIR DEVICES.
 *
 * From #9545 on, a Ping, IP, Port, NTP, Website, API or SSL Certificate
 * monitor a person creates on the address of a network device is tied to
 * that device as it is created (Monitor.networkDeviceId, MonitorDeviceLink).
 * The monitors people made before had no such tie, so the duplicate check
 * could not see them - an import or an auto import rule still gave the
 * device a second Ping monitor beside the one a person made - and the
 * device's pages did not list them.
 *
 * This ties those, once, by the very rule a new monitor is tied by: every
 * step checks one host, and the device at that host is the one the
 * monitor's probes see there (issue #9677: two sites can each have a
 * 10.0.0.5, so one site's monitor never becomes another site's device's).
 * That is the device its probes poll, else the one in a site they look into
 * (Utils/NetworkDevice/DeviceAddressScope). A monitor whose probes are no
 * site's is tied only to a device in no site alone at its address; devices
 * its probes cannot tell apart, a monitor checking two hosts, or a host
 * written as a variable, tie nothing; a monitor an import made for a device
 * (provenance) or one already tied is left as it is. So it only ever writes
 * what a person creating that monitor today would get.
 *
 * Why a backfill rather than matching monitors to devices each time a page
 * or an import asks: the address of a monitor is inside its steps (JSON),
 * which no index can search, and an import asks for every host it brings in.
 * A tie written once is one indexed column every reader agrees on - the
 * device's pages, the "Already monitored" of Review Results, the duplicate
 * check - and a person can see it on the monitor and change it.
 *
 * Reads every device and every site once, by project, and only the monitors
 * of projects that have devices, a page at a time by id, with the probes
 * each page's monitors run on. Safe to run twice at once: each write sets a
 * tie the rule decides from the rows as they are, and a monitor tied
 * meanwhile is no longer read.
 */

export const BACKFILL_PAGE_SIZE: number = 500;

// A device as the book files it: what tells it apart from another site's.
export interface BookDevice {
  id: string;
  siteId?: string | undefined;
  probeId?: string | undefined;
}

// One project's devices by the host each is at, and what its probes reach.
export interface DeviceAddressBook {
  // By host (lower-cased): the devices there.
  byAddress: Map<string, Array<BookDevice>>;
  reach: ProbeReachIndex;
}

// How a host is filed: as a device's address is compared (isSameHost).
export function toAddressKey(host: string): string {
  return DeviceWebUiUtil.getHost(host).toLowerCase();
}

/*
 * The address book of one project: each host, with the devices at it, and
 * every device and site filed for what any probes reach.
 */
export function buildDeviceAddressBook(data: {
  devices: ReadonlyArray<
    Pick<NetworkDevice, "id" | "hostname" | "siteId" | "probeId">
  >;
  sites: ReadonlyArray<Pick<NetworkSite, "id" | "probeId" | "parentSiteId">>;
}): DeviceAddressBook {
  const byAddress: Map<string, Array<BookDevice>> = new Map();
  const filed: Array<BookDevice> = [];

  for (const device of data.devices) {
    const id: string = device.id?.toString() || "";
    const key: string = toAddressKey(device.hostname || "");

    if (!id) {
      continue;
    }

    const bookDevice: BookDevice = {
      id: id,
      ...(device.siteId ? { siteId: device.siteId.toString() } : {}),
      ...(device.probeId ? { probeId: device.probeId.toString() } : {}),
    };

    // Every device tells what its probe reaches, with an address or not.
    filed.push(bookDevice);

    if (!key) {
      continue;
    }

    const devices: Array<BookDevice> = byAddress.get(key) || [];

    if (
      !devices.some((listed: BookDevice): boolean => {
        return listed.id === id;
      })
    ) {
      devices.push(bookDevice);
    }

    byAddress.set(key, devices);
  }

  return {
    byAddress: byAddress,
    reach: buildProbeReachIndex({
      devices: filed,
      sites: data.sites.map(
        (
          site: Pick<NetworkSite, "id" | "probeId" | "parentSiteId">,
        ): { id: string; probeId?: string; parentSiteId?: string } => {
          return {
            id: site.id?.toString() || "",
            ...(site.probeId ? { probeId: site.probeId.toString() } : {}),
            ...(site.parentSiteId
              ? { parentSiteId: site.parentSiteId.toString() }
              : {}),
          };
        },
      ),
    }),
  };
}

/*
 * The device a monitor is of, by the rule above, or null: the device its
 * probes see at the one host every step checks.
 */
export function pickDeviceForMonitor(data: {
  book: DeviceAddressBook;
  monitor: Pick<Monitor, "monitorType" | "monitorSteps">;
  probeIds: ReadonlyArray<string>;
}): string | null {
  const host: string = getMonitorCheckedHost({
    monitorType: data.monitor.monitorType,
    monitorSteps: data.monitor.monitorSteps,
  });

  if (!host) {
    return null;
  }

  const candidates: Array<BookDevice> =
    data.book.byAddress.get(toAddressKey(host)) || [];

  if (candidates.length === 0) {
    return null;
  }

  const reach: ProbeReach = toProbeReach(
    readProbeReachFacts({
      index: data.book.reach,
      probeIds: data.probeIds,
      siteKeys: getSiteKeysOf(candidates),
    }),
  );

  const match: DeviceSeenFrom<BookDevice> = pickDeviceSeenFrom({
    candidates: candidates,
    reach: reach,
    whenReachUnknown: WhenReachUnknown.OnlyDeviceInNoSite,
  });

  return match.kind === "device" ? match.device.id : null;
}

export interface MonitorDeviceLinkBackfillResult {
  projects: number;
  monitorsRead: number;
  monitorsTied: number;
}

export default class MonitorDeviceLinkBackfill {
  public static async run(): Promise<MonitorDeviceLinkBackfillResult> {
    const books: Map<string, DeviceAddressBook> =
      await this.readDeviceAddressBooks();

    const result: MonitorDeviceLinkBackfillResult = {
      projects: books.size,
      monitorsRead: 0,
      monitorsTied: 0,
    };

    for (const [projectId, book] of books) {
      try {
        const tied: { read: number; tied: number } =
          await this.tieMonitorsOfProject({
            projectId: new ObjectID(projectId),
            book: book,
          });

        result.monitorsRead += tied.read;
        result.monitorsTied += tied.tied;
      } catch (err) {
        /*
         * One project that cannot be read or written must not cost the
         * rest theirs: its monitors stay untied, as they were, and a
         * person can still tie them by hand.
         */
        logger.error(
          `MonitorDeviceLinkBackfill: could not tie the monitors of project ${projectId} to their network devices:`,
        );
        logger.error(err);
      }
    }

    return result;
  }

  // Every device and site of the server, filed by project and by host.
  public static async readDeviceAddressBooks(): Promise<
    Map<string, DeviceAddressBook>
  > {
    const devicesByProject: Map<
      string,
      Array<Pick<NetworkDevice, "id" | "hostname" | "siteId" | "probeId">>
    > = new Map();

    let afterId: ObjectID | undefined = undefined;

    for (;;) {
      const page: Array<NetworkDevice> = await NetworkDeviceService.findBy({
        query: {
          ...(afterId ? { _id: QueryHelper.greaterThan(afterId) } : {}),
        },
        select: {
          _id: true,
          projectId: true,
          hostname: true,
          siteId: true,
          probeId: true,
        },
        sort: { _id: SortOrder.Ascending },
        limit: LIMIT_MAX,
        skip: 0,
        props: { isRoot: true },
      });

      for (const device of page) {
        const projectId: string = device.projectId?.toString() || "";

        if (!projectId) {
          continue;
        }

        const devices: Array<
          Pick<NetworkDevice, "id" | "hostname" | "siteId" | "probeId">
        > = devicesByProject.get(projectId) || [];
        devices.push(device);
        devicesByProject.set(projectId, devices);
      }

      const last: NetworkDevice | undefined = page[page.length - 1];

      if (page.length < LIMIT_MAX || !last?.id) {
        break;
      }

      afterId = last.id;
    }

    const sitesByProject: Map<
      string,
      Array<Pick<NetworkSite, "id" | "probeId" | "parentSiteId">>
    > = await this.readSitesOfProjects(new Set(devicesByProject.keys()));

    const books: Map<string, DeviceAddressBook> = new Map();

    for (const [projectId, devices] of devicesByProject) {
      books.set(
        projectId,
        buildDeviceAddressBook({
          devices: devices,
          sites: sitesByProject.get(projectId) || [],
        }),
      );
    }

    return books;
  }

  /*
   * The sites of the projects that have devices, with their default probes
   * and the sites above them: what a probe that polls none of a site's
   * devices yet still reaches (DeviceAddressScope).
   */
  public static async readSitesOfProjects(
    projectIds: ReadonlySet<string>,
  ): Promise<
    Map<string, Array<Pick<NetworkSite, "id" | "probeId" | "parentSiteId">>>
  > {
    const sitesByProject: Map<
      string,
      Array<Pick<NetworkSite, "id" | "probeId" | "parentSiteId">>
    > = new Map();

    if (projectIds.size === 0) {
      return sitesByProject;
    }

    let afterId: ObjectID | undefined = undefined;

    for (;;) {
      const page: Array<NetworkSite> = await NetworkSiteService.findBy({
        query: {
          ...(afterId ? { _id: QueryHelper.greaterThan(afterId) } : {}),
        },
        select: {
          _id: true,
          projectId: true,
          probeId: true,
          parentSiteId: true,
        },
        sort: { _id: SortOrder.Ascending },
        limit: LIMIT_MAX,
        skip: 0,
        props: { isRoot: true },
      });

      for (const site of page) {
        const projectId: string = site.projectId?.toString() || "";

        if (!projectId || !projectIds.has(projectId)) {
          continue;
        }

        const sites: Array<
          Pick<NetworkSite, "id" | "probeId" | "parentSiteId">
        > = sitesByProject.get(projectId) || [];
        sites.push(site);
        sitesByProject.set(projectId, sites);
      }

      const last: NetworkSite | undefined = page[page.length - 1];

      if (page.length < LIMIT_MAX || !last?.id) {
        break;
      }

      afterId = last.id;
    }

    return sitesByProject;
  }

  // The probes each of these monitors runs on, by monitor id key.
  public static async readProbesOfMonitors(data: {
    projectId: ObjectID;
    monitorIds: Array<ObjectID>;
  }): Promise<Map<string, Array<string>>> {
    const probesByMonitor: Map<string, Array<string>> = new Map();

    if (data.monitorIds.length === 0) {
      return probesByMonitor;
    }

    const monitorProbes: Array<MonitorProbe> = await MonitorProbeService.findBy(
      {
        query: {
          projectId: data.projectId,
          monitorId: QueryHelper.any(data.monitorIds),
        },
        select: { monitorId: true, probeId: true },
        limit: LIMIT_MAX,
        skip: 0,
        props: { isRoot: true },
      },
    );

    for (const monitorProbe of monitorProbes) {
      const monitorId: string = toIdKey(monitorProbe.monitorId);
      const probeId: string = toIdKey(monitorProbe.probeId);

      if (!monitorId || !probeId) {
        continue;
      }

      const probeIds: Array<string> = probesByMonitor.get(monitorId) || [];
      probeIds.push(probeId);
      probesByMonitor.set(monitorId, probeIds);
    }

    return probesByMonitor;
  }

  /*
   * One project's untied monitors, a page at a time by id, each tied to its
   * device when the rule names one. The monitors of one device are tied in
   * one write.
   */
  public static async tieMonitorsOfProject(data: {
    projectId: ObjectID;
    book: DeviceAddressBook;
  }): Promise<{ read: number; tied: number }> {
    let afterId: ObjectID | undefined = undefined;
    let read: number = 0;
    let tied: number = 0;

    for (;;) {
      const page: Array<Monitor> = await MonitorService.findBy({
        query: {
          projectId: data.projectId,
          monitorType: QueryHelper.any([...DEVICE_TARGET_MONITOR_TYPES]),
          networkDeviceId: QueryHelper.isNull(),
          autoProvisionedNetworkDeviceId: QueryHelper.isNull(),
          ...(afterId ? { _id: QueryHelper.greaterThan(afterId) } : {}),
        },
        select: {
          _id: true,
          monitorType: true,
          monitorSteps: true,
        },
        sort: { _id: SortOrder.Ascending },
        limit: BACKFILL_PAGE_SIZE,
        skip: 0,
        props: { isRoot: true },
      });

      read += page.length;

      const probesByMonitor: Map<
        string,
        Array<string>
      > = await this.readProbesOfMonitors({
        projectId: data.projectId,
        monitorIds: page
          .map((monitor: Monitor): ObjectID | null => {
            return monitor.id;
          })
          .filter((id: ObjectID | null): id is ObjectID => {
            return Boolean(id);
          }),
      });

      const monitorIdsByDevice: Map<string, Array<ObjectID>> = new Map();

      for (const monitor of page) {
        if (!monitor.id) {
          continue;
        }

        const deviceId: string | null = pickDeviceForMonitor({
          book: data.book,
          monitor: monitor,
          probeIds: probesByMonitor.get(toIdKey(monitor.id)) || [],
        });

        if (!deviceId) {
          continue;
        }

        const ids: Array<ObjectID> = monitorIdsByDevice.get(deviceId) || [];
        ids.push(monitor.id);
        monitorIdsByDevice.set(deviceId, ids);
      }

      for (const [deviceId, monitorIds] of monitorIdsByDevice) {
        await MonitorService.updateBy({
          query: {
            projectId: data.projectId,
            _id: QueryHelper.any(monitorIds),
            // Tied meanwhile, or made for a device meanwhile: left alone.
            networkDeviceId: QueryHelper.isNull(),
            autoProvisionedNetworkDeviceId: QueryHelper.isNull(),
          },
          data: {
            networkDeviceId: new ObjectID(deviceId),
          },
          limit: monitorIds.length,
          skip: 0,
          props: { isRoot: true },
        });

        tied += monitorIds.length;
      }

      const last: Monitor | undefined = page[page.length - 1];

      if (page.length < BACKFILL_PAGE_SIZE || !last?.id) {
        break;
      }

      afterId = last.id;
    }

    return { read: read, tied: tied };
  }
}
