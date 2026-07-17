import Monitor from "Common/Models/DatabaseModels/Monitor";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import MonitorType from "Common/Types/Monitor/MonitorType";
import ObjectID from "Common/Types/ObjectID";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";

/*
 * Finds the monitors that watch a given network device.
 *
 * The device reference lives inside the monitor's monitorSteps JSON column
 * (step.data.networkDeviceMonitor.networkDeviceId), which is not queryable
 * server-side. Phase 1 approach: list every Network Device monitor in the
 * project (bounded by LIMIT_PER_PROJECT — these are rare enough that one
 * page is plenty) and filter client-side by the step data. If a queryable
 * device→monitor path is added later (e.g. a join column), only this util
 * needs to change.
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

  public static async getMonitorsWatchingDevice(
    networkDeviceId: ObjectID,
  ): Promise<Array<Monitor>> {
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
        currentMonitorStatus: {
          name: true,
          color: true,
        },
      },
      sort: {
        name: SortOrder.Ascending,
      },
    });

    return result.data.filter((monitor: Monitor) => {
      return DeviceMonitorLookupUtil.monitorWatchesDevice(
        monitor,
        networkDeviceId,
      );
    });
  }
}
