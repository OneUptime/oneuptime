import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorTemplate from "../../../Models/DatabaseModels/MonitorTemplate";
import NetworkDevice from "../../../Models/DatabaseModels/NetworkDevice";
import NetworkDeviceDiscoveryScan from "../../../Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import LIMIT_MAX from "../../../Types/Database/LimitMax";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import MonitorType from "../../../Types/Monitor/MonitorType";
import ObjectID from "../../../Types/ObjectID";
import {
  DeviceMonitorFacts,
  findDuplicateDeviceMonitor,
  toDeviceMonitorCandidate,
  toDeviceMonitorFacts,
} from "../../../Utils/Monitor/DeviceMonitorDuplicates";
import { isDeviceAddressMonitorType } from "../../../Utils/Monitor/DeviceMonitorTemplateUtil";
import Semaphore, { SemaphoreMutex } from "../../Infrastructure/Semaphore";
import MonitorService from "../../Services/MonitorService";
import logger from "../Logger";

/*
 * NO SECOND MONITOR OF THE SAME KIND FOR A DEVICE (OneUptime issues #9509 and
 * #9510), on the server.
 *
 * Every path that makes a device's monitor from a template - an import from
 * Review Results or from the Discovered Devices list (DiscoveryImportRunner),
 * and an auto import rule (NetworkDeviceAutoImportRuleEngineService) - asks
 * this before it creates one, and reports the monitor it finds as the
 * device's ("Already monitored") instead of making a second. What counts as
 * a duplicate is the shared rule's (Utils/Monitor/DeviceMonitorDuplicates);
 * this reads the monitors it is asked about: the ones made for the device,
 * then the one bound to it.
 *
 * TWO CREATES AT ONCE. A monitor from the same template as one the device
 * has is refused by the database itself: Monitor's unique (device, template)
 * index. Two Ping templates are two pairs, so nothing in the database stops
 * an import and an auto import rule from each giving the same device a Ping
 * monitor in the same second. For a Ping, IP, Port or NTP template the check
 * and the create therefore run under one lock per device, held by every path
 * (underDeviceLock): the second waits for the first, then finds its monitor.
 * The two engines are already one run at a time each (a project's imports
 * queue behind each other; auto import rules run under one sweep lock), so
 * this is the lock BETWEEN them.
 */

export const DEVICE_MONITOR_LOCK_NAMESPACE: string = "NetworkDeviceMonitor";

export function deviceMonitorLockKey(deviceId: ObjectID | string): string {
  return `NetworkDeviceMonitor:Device:${deviceId.toString()}`;
}

/*
 * How long one holder may keep a device's lock: one check and one create,
 * which runs a monitor's whole pipeline (plan, status, owners, status pages).
 * A holder that dies lets it go after this.
 */
export const DEVICE_MONITOR_LOCK_TIMEOUT_MS: number = 2 * 60 * 1000;

/*
 * How long a path waits for another to finish with the device before it
 * gives up on this device's monitor for now.
 */
export const DEVICE_MONITOR_LOCK_ACQUIRE_TIMEOUT_MS: number = 60 * 1000;

/*
 * Why a device got no monitor this time, when another path held it the whole
 * while. Worded to read right under a heading for one host or for hundreds,
 * as the import lists its reasons, and true for an auto import rule's run
 * report too: trying again finds that path's monitor, or makes this one.
 */
export const DEVICE_MONITOR_BUSY_REASON: string =
  "Another import or auto import rule was giving this device a monitor at the same moment. Try again: the device gets one monitor, never two.";

// What a device's monitor is read with: enough to tell whether it is a duplicate.
export const DEVICE_MONITOR_FACTS_SELECT: {
  _id: true;
  name: true;
  monitorType: true;
  monitorTemplateId: true;
  monitorSteps: true;
} = {
  _id: true,
  name: true,
  monitorType: true,
  monitorTemplateId: true,
  monitorSteps: true,
};

export default class DeviceMonitorDuplicateCheck {
  /*
   * Whether a template of this kind can duplicate a monitor the database
   * cannot see: a Ping, IP, Port or NTP template, whose duplicates span
   * templates. A Network Device template's is the (device, template) pair,
   * which the unique index holds.
   */
  public static needsDeviceLock(
    monitorType: MonitorType | string | null | undefined,
  ): boolean {
    return isDeviceAddressMonitorType(monitorType);
  }

  /*
   * The device's monitors, oldest first: the ones made for it, then the one
   * bound to it when that is another. Read as OneUptime: the question is
   * about the device, whoever asks.
   */
  public static async readDeviceMonitors(data: {
    projectId: ObjectID;
    device: Pick<NetworkDevice, "id" | "monitorId">;
  }): Promise<Array<DeviceMonitorFacts>> {
    const deviceId: ObjectID | null = data.device.id;

    if (!deviceId) {
      return [];
    }

    const madeForDevice: Array<Monitor> = await MonitorService.findBy({
      query: {
        projectId: data.projectId,
        autoProvisionedNetworkDeviceId: deviceId,
      },
      select: DEVICE_MONITOR_FACTS_SELECT,
      sort: { createdAt: SortOrder.Ascending },
      limit: LIMIT_MAX,
      skip: 0,
      props: { isRoot: true },
    });

    const monitors: Array<DeviceMonitorFacts> = (madeForDevice || []).map(
      toDeviceMonitorFacts,
    );

    const boundMonitorId: string = data.device.monitorId?.toString() || "";

    if (
      boundMonitorId &&
      !monitors.some((monitor: DeviceMonitorFacts): boolean => {
        return monitor.id.toLowerCase() === boundMonitorId.toLowerCase();
      })
    ) {
      const bound: Monitor | null = await MonitorService.findOneBy({
        query: {
          _id: boundMonitorId,
          projectId: data.projectId,
        },
        select: DEVICE_MONITOR_FACTS_SELECT,
        props: { isRoot: true },
      });

      if (bound) {
        monitors.push(toDeviceMonitorFacts(bound));
      }
    }

    return monitors;
  }

  /*
   * The monitor of the device's that one made from this template would
   * duplicate, or null when there is none and the template's may be made.
   */
  public static async findDuplicate(data: {
    projectId: ObjectID;
    device: Pick<NetworkDevice, "id" | "monitorId">;
    template: Pick<MonitorTemplate, "id" | "monitorType" | "monitorSteps">;
  }): Promise<DeviceMonitorFacts | null> {
    const monitors: Array<DeviceMonitorFacts> = await this.readDeviceMonitors({
      projectId: data.projectId,
      device: data.device,
    });

    return findDuplicateDeviceMonitor({
      candidate: toDeviceMonitorCandidate({
        monitorType: data.template.monitorType,
        monitorTemplateId: data.template.id,
        monitorSteps: data.template.monitorSteps,
      }),
      monitors: monitors,
    });
  }

  /*
   * Runs `work` - a check and a create - holding the device's lock, when a
   * template of this kind needs it (needsDeviceLock); otherwise runs it as
   * it is. A lock another path holds for longer than
   * DEVICE_MONITOR_LOCK_ACQUIRE_TIMEOUT_MS is refused with
   * DEVICE_MONITOR_BUSY_REASON, which the caller records for the device.
   */
  public static async underDeviceLock<T>(
    data: {
      deviceId: ObjectID;
      monitorType: MonitorType | string | null | undefined;
    },
    work: () => Promise<T>,
  ): Promise<T> {
    if (!this.needsDeviceLock(data.monitorType)) {
      return await work();
    }

    let mutex: SemaphoreMutex;

    try {
      mutex = await Semaphore.lock({
        key: deviceMonitorLockKey(data.deviceId),
        namespace: DEVICE_MONITOR_LOCK_NAMESPACE,
        lockTimeout: DEVICE_MONITOR_LOCK_TIMEOUT_MS,
        acquireTimeout: DEVICE_MONITOR_LOCK_ACQUIRE_TIMEOUT_MS,
      });
    } catch (error) {
      logger.debug(
        `Device monitor: could not lock device ${data.deviceId.toString()} to give it a monitor; another path holds it (or Redis is unavailable): ${error}`,
      );

      throw new BadDataException(DEVICE_MONITOR_BUSY_REASON);
    }

    try {
      return await work();
    } finally {
      try {
        await Semaphore.release(mutex);
      } catch (error) {
        logger.error(
          `Device monitor: could not release the lock on device ${data.deviceId.toString()}: ${error}`,
        );
      }
    }
  }

  /*
   * The probe a Ping, IP, Port or NTP monitor made for a device runs on: the
   * one that polls the device, else the scan's - each reached the address.
   * The project's default probes would be global ones, which cannot reach a
   * device on a private network, so they are what a device with neither
   * gets, and only then (the monitor create attaches them when no probe is
   * named, MonitorService.addProbesToMonitor).
   */
  public static getAddressMonitorProbes(data: {
    device: Pick<NetworkDevice, "probeId">;
    scan: Pick<NetworkDeviceDiscoveryScan, "probeId"> | null | undefined;
  }): JSONObject {
    const probeId: string =
      data.device.probeId?.toString() || data.scan?.probeId?.toString() || "";

    return probeId ? { probes: [probeId] } : {};
  }
}
