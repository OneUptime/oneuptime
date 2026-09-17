import Monitor from "Common/Models/DatabaseModels/Monitor";
import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import MonitorType from "Common/Types/Monitor/MonitorType";
import { NetworkDeviceMonitoringMethodUtil } from "Common/Types/NetworkDevice/NetworkDeviceMonitoringMethod";
import ObjectID from "Common/Types/ObjectID";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";

/** What a device's own row says about who reports its health. */
export interface DeviceBinding {
  boundMonitor: Monitor | null;
  isMonitorBacked: boolean;
}

/** Everything the device's monitor surfaces render from. */
export interface DeviceMonitorContext {
  monitors: Array<Monitor>;
  isMonitorBacked: boolean;
}

/*
 * Finds the monitors that report on a given network device.
 *
 * There are TWO ways a monitor relates to a device, and this util has to
 * return both or the device's own pages contradict its status pill.
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
        },
      });
    } catch {
      return { boundMonitor: null, isMonitorBacked: false };
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
        boundMonitor: binding.boundMonitor,
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
      boundMonitor: binding.boundMonitor,
    });
  }

  private static async listMonitorsForDevice(data: {
    networkDeviceId: ObjectID;
    boundMonitor: Monitor | null;
  }): Promise<Array<Monitor>> {
    const networkDeviceId: ObjectID = data.networkDeviceId;
    const boundMonitor: Monitor | null = data.boundMonitor;

    const result: ListResult<Monitor> = await ModelAPI.getList<Monitor>({
      modelType: Monitor,
      query: {
        monitorType: MonitorType.NetworkDevice,
      },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      select: {
        _id: true,
        name: true,
        monitorType: true,
        monitorSteps: true,
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
      },
      sort: {
        name: SortOrder.Ascending,
      },
    });

    const watching: Array<Monitor> = result.data.filter((monitor: Monitor) => {
      return DeviceMonitorLookupUtil.monitorWatchesDevice(
        monitor,
        networkDeviceId,
      );
    });

    if (!boundMonitor) {
      return watching;
    }

    /*
     * Deduped by id, not by identity: the bound monitor arrives from a
     * different request than the watchers, so the same monitor bound to a
     * device AND watching it is two distinct objects. Without this it would
     * render twice.
     */
    const boundMonitorId: string = boundMonitor._id?.toString() || "";

    const watchingWithoutBound: Array<Monitor> = watching.filter(
      (monitor: Monitor) => {
        return !boundMonitorId || monitor._id?.toString() !== boundMonitorId;
      },
    );

    return [boundMonitor, ...watchingWithoutBound];
  }
}
