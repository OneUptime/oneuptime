import Monitor from "Common/Models/DatabaseModels/Monitor";
import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import MonitorType from "Common/Types/Monitor/MonitorType";
import { NetworkDeviceMonitoringMethodUtil } from "Common/Types/NetworkDevice/NetworkDeviceMonitoringMethod";
import ObjectID from "Common/Types/ObjectID";
import Includes from "Common/Types/BaseDatabase/Includes";
import Select from "Common/Types/BaseDatabase/Select";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import { DEVICE_ADDRESS_MONITOR_TYPES } from "Common/Utils/Monitor/DeviceMonitorTemplateUtil";
import DeviceWebUiUtil from "Common/Utils/NetworkDevice/DeviceWebUiUtil";
import Search from "Common/Types/BaseDatabase/Search";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";

/** What a device's own row says about who reports its health. */
export interface DeviceBinding {
  boundMonitor: Monitor | null;
  isMonitorBacked: boolean;
  /*
   * The device's name and the address its probe polls: what its web UI
   * monitor is found by (DeviceWebUiUtil.isWebUiMonitorOf). Empty when the
   * device could not be read.
   */
  deviceName: string;
  deviceAddress: string;
}

/*
 * The most Website monitors named after a device read to find its web UI
 * monitor among them: a device has one or two.
 */
export const WEB_UI_MONITOR_CANDIDATES_LIMIT: number = 50;

/** Everything the device's monitor surfaces render from. */
export interface DeviceMonitorContext {
  monitors: Array<Monitor>;
  isMonitorBacked: boolean;
}

/*
 * Finds the monitors that report on a given network device.
 *
 * There are FOUR ways a monitor relates to a device, and this util has to
 * return all of them or the device's own pages contradict its status pill,
 * or the import - or the "Monitor web UI" action - that just gave it a
 * monitor. The fourth, its web UI monitor, is listWebUiMonitors'.
 *
 * 1. A Network Device monitor WATCHES the device: the reference lives inside
 *    the monitor's monitorSteps JSON column
 *    (step.data.networkDeviceMonitor.networkDeviceId), which is not queryable
 *    server-side. So: list every Network Device monitor in the project
 *    (bounded by LIMIT_PER_PROJECT — these are rare enough that one page is
 *    plenty) and filter client-side by the step data.
 *
 * 2. A monitor is BOUND to the device (NetworkDevice.monitorId): the
 *    monitor-backed contract, where that monitor's status IS the device's
 *    status. It is an ordinary Ping or IP monitor, so it is not of type
 *    NetworkDevice and its steps say nothing about the device — the query in
 *    (1) can never find it.
 *
 * 3. A monitor was MADE FOR the device (Monitor.autoProvisionedNetworkDeviceId)
 *    from a Ping, IP, Port or NTP template, by a discovery import
 *    (OneUptime issue #5145): it checks the device's address, so it too is
 *    not of type NetworkDevice. Its provenance is queryable and indexed.
 *
 * Returning only (1) is what made a ping-only device that HAS a bound monitor
 * still render "No monitors are alerting on this device yet" next to a green
 * status pill the bound monitor had just produced (OneUptime/oneuptime#3447).
 * The bound monitor leads the list: it is the one deciding the device's state.
 */
export default class DeviceMonitorLookupUtil {
  public static monitorWatchesDevice(
    monitor: Monitor,
    networkDeviceId: ObjectID,
  ): boolean {
    const steps: Array<MonitorStep> =
      monitor.monitorSteps?.data?.monitorStepsInstanceArray || [];

    return steps.some((step: MonitorStep) => {
      return (
        step.data?.networkDeviceMonitor?.networkDeviceId ===
        networkDeviceId.toString()
      );
    });
  }

  /**
   * The device's binding half: the monitor bound to it, and whether it is
   * monitor-backed at all.
   *
   * Both answers come out of ONE device read because every caller needs both
   * — the card lists the monitor AND changes its copy on the method — and a
   * second round trip for a boolean already on the row would be waste.
   *
   * Failure is deliberately swallowed rather than thrown: the watching-monitor
   * list is the older, load-bearing half of this lookup, and a device the
   * caller cannot read (or one deleted mid-render) must not take the whole
   * card down with it. An unreadable device reads as "not monitor-backed",
   * which is the pre-existing behaviour.
   */
  public static async getDeviceBinding(
    networkDeviceId: ObjectID,
  ): Promise<DeviceBinding> {
    let device: NetworkDevice | null = null;

    try {
      device = await ModelAPI.getItem<NetworkDevice>({
        modelType: NetworkDevice,
        id: networkDeviceId,
        select: {
          _id: true,
          monitoringMethod: true,
          /*
           * Deliberately NOT selecting the monitor's currentMonitorStatus:
           * that relation carries no `canReadOnRelationQuery`, so reading it
           * one relation deep throws "Column currentMonitorStatus on Monitor
           * does not support read on relation query." Widening a shared
           * model's read surface to put a status pill on one card is the
           * wrong trade — the device's own status hero already shows the
           * verdict this monitor produced, and the card's pill is optional.
           */
          monitor: {
            _id: true,
            name: true,
            monitorType: true,
          },
          name: true,
          hostname: true,
        },
      });
    } catch {
      return {
        boundMonitor: null,
        isMonitorBacked: false,
        deviceName: "",
        deviceAddress: "",
      };
    }

    return {
      boundMonitor: device?.monitor || null,
      /*
       * Through the parser, never a raw compare: NULL means SNMP, which is
       * what every device that predates the column is.
       */
      isMonitorBacked: NetworkDeviceMonitoringMethodUtil.isMonitorBacked(
        device?.monitoringMethod,
      ),
      deviceName: device?.name?.toString() || "",
      deviceAddress: device?.hostname?.toString() || "",
    };
  }

  /**
   * Everything a device's monitor surfaces need, in one call: the monitors
   * that report on it, and whether an empty list is a problem.
   */
  public static async getDeviceMonitorContext(
    networkDeviceId: ObjectID,
  ): Promise<DeviceMonitorContext> {
    const binding: DeviceBinding =
      await DeviceMonitorLookupUtil.getDeviceBinding(networkDeviceId);

    return {
      monitors: await DeviceMonitorLookupUtil.listMonitorsForDevice({
        networkDeviceId,
        binding: binding,
      }),
      isMonitorBacked: binding.isMonitorBacked,
    };
  }

  public static async getMonitorsWatchingDevice(
    networkDeviceId: ObjectID,
  ): Promise<Array<Monitor>> {
    const binding: DeviceBinding =
      await DeviceMonitorLookupUtil.getDeviceBinding(networkDeviceId);

    return DeviceMonitorLookupUtil.listMonitorsForDevice({
      networkDeviceId,
      binding: binding,
    });
  }

  /*
   * 4. The device's WEB UI monitor: a Website monitor of its management
   *    page, as "Monitor web UI" on its Monitors card makes one
   *    (DeviceWebUiUtil). Nothing on a Website monitor names a device, so
   *    it is found by what it is: named after the device, with a step on
   *    the device's address. Only Website monitors whose name holds the
   *    device's are read - a handful - never the project's every one.
   *    Best effort, like the binding: a read that fails leaves the other
   *    monitors listed.
   */
  public static async listWebUiMonitors(data: {
    binding: DeviceBinding;
    select: Select<Monitor>;
  }): Promise<Array<Monitor>> {
    const deviceName: string = data.binding.deviceName.trim();

    if (!deviceName || !data.binding.deviceAddress.trim()) {
      return [];
    }

    let candidates: ListResult<Monitor>;

    try {
      candidates = await ModelAPI.getList<Monitor>({
        modelType: Monitor,
        query: {
          monitorType: MonitorType.Website,
          name: new Search(deviceName),
        },
        limit: WEB_UI_MONITOR_CANDIDATES_LIMIT,
        skip: 0,
        select: { ...data.select, monitorSteps: true },
        sort: {
          name: SortOrder.Ascending,
        },
      });
    } catch {
      return [];
    }

    return candidates.data.filter((monitor: Monitor): boolean => {
      const steps: Array<MonitorStep> =
        monitor.monitorSteps?.data?.monitorStepsInstanceArray || [];

      return DeviceWebUiUtil.isWebUiMonitorOf({
        monitorName: monitor.name,
        destinations: steps.map((step: MonitorStep) => {
          return step.data?.monitorDestination?.toString();
        }),
        deviceName: deviceName,
        deviceAddress: data.binding.deviceAddress,
      });
    });
  }

  private static async listMonitorsForDevice(data: {
    networkDeviceId: ObjectID;
    binding: DeviceBinding;
  }): Promise<Array<Monitor>> {
    const networkDeviceId: ObjectID = data.networkDeviceId;
    const boundMonitor: Monitor | null = data.binding.boundMonitor;

    const select: Select<Monitor> = {
      _id: true,
      name: true,
      monitorType: true,
      /*
       * Whether an alert policy owns this monitor — the id only, not the
       * policy row. The `networkAlertPolicy` RELATION carries no
       * `canReadOnRelationQuery` (same reason the status pill above reads
       * the way it does), and widening a shared model's read surface to
       * put a policy's name on one card is the wrong trade. The id is
       * enough for what the operator needs to know here: that editing or
       * deleting this monitor by hand will be undone by the engine.
       */
      networkAlertPolicyId: true,
      currentMonitorStatus: {
        name: true,
        color: true,
      },
    };

    const [networkDeviceMonitors, madeForDevice, webUiMonitors]: [
      ListResult<Monitor>,
      ListResult<Monitor>,
      Array<Monitor>,
    ] = await Promise.all([
      ModelAPI.getList<Monitor>({
        modelType: Monitor,
        query: {
          monitorType: MonitorType.NetworkDevice,
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        select: { ...select, monitorSteps: true },
        sort: {
          name: SortOrder.Ascending,
        },
      }),
      /*
       * 3. A monitor made FOR the device from a Ping, IP, Port or NTP
       *    template - a discovery import gives each device one (OneUptime
       *    issue #5145) - checks the device's address. Its steps name an
       *    address, not the device; its provenance names the device: the
       *    column that finds it again and deletes it with the device.
       */
      ModelAPI.getList<Monitor>({
        modelType: Monitor,
        query: {
          autoProvisionedNetworkDeviceId: networkDeviceId,
          monitorType: new Includes([...DEVICE_ADDRESS_MONITOR_TYPES]),
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        select: select,
        sort: {
          name: SortOrder.Ascending,
        },
      }),
      // 4. Its web UI monitor (listWebUiMonitors).
      DeviceMonitorLookupUtil.listWebUiMonitors({
        binding: data.binding,
        select: select,
      }),
    ]);

    const watching: Array<Monitor> = networkDeviceMonitors.data.filter(
      (monitor: Monitor) => {
        return DeviceMonitorLookupUtil.monitorWatchesDevice(
          monitor,
          networkDeviceId,
        );
      },
    );

    /*
     * Deduped by id, not by identity: the bound monitor arrives from a
     * different request than the rest, so the same monitor bound to a
     * device AND made for it is two distinct objects. Without this it would
     * render twice. The bound monitor leads: it decides the device's state.
     */
    const listed: Array<Monitor> = [];
    const listedIds: Set<string> = new Set<string>();

    for (const monitor of [
      ...(boundMonitor ? [boundMonitor] : []),
      ...watching,
      ...madeForDevice.data,
      ...webUiMonitors,
    ]) {
      const monitorId: string = monitor._id?.toString() || "";

      if (monitorId && listedIds.has(monitorId)) {
        continue;
      }

      if (monitorId) {
        listedIds.add(monitorId);
      }

      listed.push(monitor);
    }

    return listed;
  }
}
