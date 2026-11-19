import Monitor from "../../../Models/DatabaseModels/Monitor";
import NetworkDevice from "../../../Models/DatabaseModels/NetworkDevice";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import LIMIT_MAX from "../../../Types/Database/LimitMax";
import ObjectID from "../../../Types/ObjectID";
import { DEVICE_TARGET_MONITOR_TYPES } from "../../../Utils/Monitor/DeviceMonitorTemplateUtil";
import { getMonitorCheckedHost } from "../../../Utils/NetworkDevice/MonitorCheckedHost";
import DeviceWebUiUtil from "../../../Utils/NetworkDevice/DeviceWebUiUtil";
import MonitorService from "../../Services/MonitorService";
import NetworkDeviceService from "../../Services/NetworkDeviceService";
import QueryHelper from "../../Types/Database/QueryHelper";
import logger from "../Logger";

/*
 * TIES THE MONITORS PEOPLE MADE BEFORE ISSUE #9545 TO THEIR DEVICES.
 *
 * From #9545 on, a Ping, IP, Port, NTP, Website, API or SSL Certificate
 * monitor a person creates on an address exactly one device in the project
 * has is tied to that device as it is created (Monitor.networkDeviceId,
 * MonitorDeviceLink). The monitors people made before had no such tie, so
 * the duplicate check could not see them - an import or an auto import
 * rule still gave the device a second Ping monitor beside the one a person
 * made - and the device's pages did not list them.
 *
 * This ties those, once, by the very rule a new monitor is tied by: every
 * step checks one host, and exactly one device in the project is at that
 * host. A host two devices share (two sites' 10.0.0.5) ties nothing; a
 * monitor checking two hosts, or a host written as a variable, ties
 * nothing; a monitor an import made for a device (provenance) or one
 * already tied is left as it is. So it only ever writes what a person
 * creating that monitor today would get.
 *
 * Why a backfill rather than matching monitors to devices each time a page
 * or an import asks: the address of a monitor is inside its steps (JSON),
 * which no index can search, and an import asks for every host it brings in.
 * A tie written once is one indexed column every reader agrees on - the
 * device's pages, the "Already monitored" of Review Results, the duplicate
 * check - and a person can see it on the monitor and change it.
 *
 * Reads every device once, by project, and only the monitors of projects
 * that have devices, a page at a time by id. Safe to run twice at once:
 * each write sets a tie the rule decides from the rows as they are, and a
 * monitor tied meanwhile is no longer read.
 */

export const BACKFILL_PAGE_SIZE: number = 500;

// The devices of one project, by the host each is at (lower-cased).
export type DeviceAddressBook = Map<string, Array<string>>;

// How a host is filed: as a device's address is compared (isSameHost).
export function toAddressKey(host: string): string {
  return DeviceWebUiUtil.getHost(host).toLowerCase();
}

/*
 * The address book of one project's devices: each host, with the ids of the
 * devices at it.
 */
export function buildDeviceAddressBook(
  devices: ReadonlyArray<Pick<NetworkDevice, "id" | "hostname">>,
): DeviceAddressBook {
  const book: DeviceAddressBook = new Map<string, Array<string>>();

  for (const device of devices) {
    const id: string = device.id?.toString() || "";
    const key: string = toAddressKey(device.hostname || "");

    if (!id || !key) {
      continue;
    }

    const ids: Array<string> = book.get(key) || [];

    if (!ids.includes(id)) {
      ids.push(id);
    }

    book.set(key, ids);
  }

  return book;
}

/*
 * The device a monitor is of, by the rule above, or null: the one device at
 * the one host every step checks.
 */
export function pickDeviceForMonitor(data: {
  book: DeviceAddressBook;
  monitor: Pick<Monitor, "monitorType" | "monitorSteps">;
}): string | null {
  const host: string = getMonitorCheckedHost({
    monitorType: data.monitor.monitorType,
    monitorSteps: data.monitor.monitorSteps,
  });

  if (!host) {
    return null;
  }

  const ids: Array<string> = data.book.get(toAddressKey(host)) || [];

  return ids.length === 1 ? ids[0]! : null;
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

  // Every device of the server, filed by project and by host.
  public static async readDeviceAddressBooks(): Promise<
    Map<string, DeviceAddressBook>
  > {
    const devicesByProject: Map<
      string,
      Array<Pick<NetworkDevice, "id" | "hostname">>
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

        const devices: Array<Pick<NetworkDevice, "id" | "hostname">> =
          devicesByProject.get(projectId) || [];
        devices.push(device);
        devicesByProject.set(projectId, devices);
      }

      const last: NetworkDevice | undefined = page[page.length - 1];

      if (page.length < LIMIT_MAX || !last?.id) {
        break;
      }

      afterId = last.id;
    }

    const books: Map<string, DeviceAddressBook> = new Map();

    for (const [projectId, devices] of devicesByProject) {
      books.set(projectId, buildDeviceAddressBook(devices));
    }

    return books;
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

      const monitorIdsByDevice: Map<string, Array<ObjectID>> = new Map();

      for (const monitor of page) {
        const deviceId: string | null = pickDeviceForMonitor({
          book: data.book,
          monitor: monitor,
        });

        if (!deviceId || !monitor.id) {
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
