import {
  CheckOn,
  CriteriaFilter,
  FilterType,
} from "../../Types/Monitor/CriteriaFilter";
import MonitorSteps from "../../Types/Monitor/MonitorSteps";

/*
 * Small, defensive reads of a monitor's criteria for the overview facts.
 * Steps are user-authored JSON that has been through several schema
 * versions, so every level is treated as possibly missing.
 */

interface StepLike {
  data?:
    | {
        monitorCriteria?:
          | {
              data?:
                | {
                    monitorCriteriaInstanceArray?: Array<unknown> | undefined;
                  }
                | undefined;
            }
          | undefined;
        networkDeviceMonitor?: { networkDeviceId?: unknown } | undefined;
      }
    | undefined;
}

interface CriteriaInstanceLike {
  data?:
    | {
        filters?: Array<CriteriaFilter> | undefined;
        isEnabled?: boolean | undefined;
      }
    | undefined;
}

const getSteps: (monitorSteps: MonitorSteps | undefined) => Array<StepLike> = (
  monitorSteps: MonitorSteps | undefined,
): Array<StepLike> => {
  const steps: unknown = monitorSteps?.data?.monitorStepsInstanceArray;

  if (!Array.isArray(steps)) {
    return [];
  }

  return steps.filter((step: unknown) => {
    return Boolean(step) && typeof step === "object";
  }) as Array<StepLike>;
};

/*
 * The filters of every criteria instance the server evaluates. Criteria that
 * are switched off are skipped: the server does not evaluate them, so
 * quoting them would promise an alert that never comes.
 */
const getEnabledFilters: (
  monitorSteps: MonitorSteps | undefined,
) => Array<CriteriaFilter> = (
  monitorSteps: MonitorSteps | undefined,
): Array<CriteriaFilter> => {
  const enabledFilters: Array<CriteriaFilter> = [];

  for (const step of getSteps(monitorSteps)) {
    const instances: unknown =
      step.data?.monitorCriteria?.data?.monitorCriteriaInstanceArray;

    if (!Array.isArray(instances)) {
      continue;
    }

    for (const rawInstance of instances) {
      if (!rawInstance || typeof rawInstance !== "object") {
        continue;
      }

      const instance: CriteriaInstanceLike =
        rawInstance as CriteriaInstanceLike;

      if (instance.data?.isEnabled === false) {
        continue;
      }

      const filters: unknown = instance.data?.filters;

      if (!Array.isArray(filters)) {
        continue;
      }

      for (const filter of filters as Array<CriteriaFilter>) {
        if (filter && typeof filter === "object") {
          enabledFilters.push(filter);
        }
      }
    }
  }

  return enabledFilters;
};

export default class MonitorOverviewCriteriaUtil {
  /*
   * The "missing heartbeat" window a heartbeat or inbound-email monitor
   * alerts on, in minutes. With several such filters the smallest wins,
   * because that is the one that fires first.
   */
  public static getMissingSignalMinutes(data: {
    monitorSteps: MonitorSteps | undefined;
    checkOn: CheckOn;
  }): number | null {
    let smallest: number | null = null;

    for (const filter of getEnabledFilters(data.monitorSteps)) {
      if (filter.checkOn !== data.checkOn) {
        continue;
      }

      if (
        filter.filterType !== FilterType.NotRecievedInMinutes &&
        filter.filterType !== FilterType.RecievedInMinutes
      ) {
        continue;
      }

      const minutes: number =
        typeof filter.value === "number"
          ? filter.value
          : Number(String(filter.value ?? "").trim() || NaN);

      if (!Number.isFinite(minutes) || minutes <= 0) {
        continue;
      }

      if (smallest === null || minutes < smallest) {
        smallest = minutes;
      }
    }

    return smallest;
  }

  /*
   * Whether an enabled criteria filter checks on `checkOn`. A server
   * monitor is only judged offline for a missing agent report when its
   * criteria check "Is Online" (ServerMonitor/CheckOnlineStatus skips the
   * rest).
   */
  public static hasFilterOn(data: {
    monitorSteps: MonitorSteps | undefined;
    checkOn: CheckOn;
  }): boolean {
    return getEnabledFilters(data.monitorSteps).some(
      (filter: CriteriaFilter) => {
        return filter.checkOn === data.checkOn;
      },
    );
  }

  public static getStepCount(monitorSteps: MonitorSteps | undefined): number {
    return getSteps(monitorSteps).length;
  }

  /*
   * The device the monitor alerts on, from the first step. Deliberately not
   * Monitor.autoProvisionedNetworkDeviceId: that records which device
   * created the monitor, and a user can point the step at another one.
   */
  public static getNetworkDeviceId(
    monitorSteps: MonitorSteps | undefined,
  ): string | null {
    const id: unknown =
      getSteps(monitorSteps)[0]?.data?.networkDeviceMonitor?.networkDeviceId;

    if (typeof id === "string") {
      return id.trim() || null;
    }

    if (id && typeof id === "object") {
      const text: string = String(id).trim();

      return text && text !== "[object Object]" ? text : null;
    }

    return null;
  }
}
