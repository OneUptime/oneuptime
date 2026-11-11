import { JSONObject } from "../JSON";
import RollingTime from "../RollingTime/RollingTime";
import RollingTimeUtil from "../RollingTime/RollingTimeUtil";
import MonitorType from "./MonitorType";

/*
 * THE ROLLING TIME OF A MONITOR STEP.
 *
 * Every metric-backed monitor type keeps how far back each check looks as
 * `rollingTime` in its step settings, and a step's settings are stored as
 * JSON that nothing checked. The API, Terraform, a workflow or an AI
 * through the MCP server could store a rolling time OneUptime does not
 * write - a Metrics monitor stored "15 minutes" - and no reader knew it:
 * every check judged a window of no length, found no data, and a rule
 * that triggers on no data opened an alert on every run.
 *
 * So a rolling time written another way is read as the one it means
 * whenever a step is read (readSettings, from MonitorStep.fromJSON), and
 * a write whose rolling time means none is refused (getUnreadableError,
 * from MonitorStep.getValidationError and the server's
 * MonitorStepsValuesUtil). CriteriaFilterValues does the same for the
 * values of a criteria's filters.
 */

/*
 * Where each monitor type that reads a rolling time keeps its settings -
 * the keys MonitorStepMetricQueries reads the same steps by.
 */
const ROLLING_TIME_STEP_KEYS: Partial<Record<MonitorType, string>> = {
  [MonitorType.Metrics]: "metricMonitor",
  [MonitorType.Kubernetes]: "kubernetesMonitor",
  [MonitorType.Docker]: "dockerMonitor",
  [MonitorType.Host]: "hostMonitor",
  [MonitorType.Podman]: "podmanMonitor",
  [MonitorType.DockerSwarm]: "dockerSwarmMonitor",
  [MonitorType.Proxmox]: "proxmoxMonitor",
  [MonitorType.OpenStack]: "openstackMonitor",
  [MonitorType.VMware]: "vmwareMonitor",
  [MonitorType.Ceph]: "cephMonitor",
  [MonitorType.StorageArray]: "storageArrayMonitor",
  [MonitorType.IoTDevice]: "iotMonitor",
};

// The longest part of a written value an error quotes back.
const MAX_QUOTED_LENGTH: number = 64;

const asObject: (value: unknown) => JSONObject | undefined = (
  value: unknown,
): JSONObject | undefined => {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JSONObject)
    : undefined;
};

// A written value, as an error quotes it back.
const describeWrittenValue: (value: unknown) => string = (
  value: unknown,
): string => {
  if (typeof value === "string") {
    return JSON.stringify(
      value.length > MAX_QUOTED_LENGTH
        ? `${value.slice(0, MAX_QUOTED_LENGTH)}…`
        : value,
    );
  }

  if (typeof value === "number" || typeof value === "boolean") {
    return `${value}`;
  }

  return Array.isArray(value) ? "a list" : `a value of type ${typeof value}`;
};

export default class MonitorStepRollingTime {
  // The monitor types whose steps keep a rolling time.
  public static getMonitorTypes(): Array<MonitorType> {
    return Object.keys(ROLLING_TIME_STEP_KEYS) as Array<MonitorType>;
  }

  // Every step settings key that keeps a rolling time.
  public static getStepKeys(): Array<string> {
    return Object.values(ROLLING_TIME_STEP_KEYS) as Array<string>;
  }

  // Where a monitor type keeps its rolling time; null for one that has none.
  public static getStepKey(
    monitorType: MonitorType | undefined | null,
  ): string | null {
    return (monitorType && ROLLING_TIME_STEP_KEYS[monitorType]) || null;
  }

  /*
   * A step's settings as stored, with a rolling time written another way
   * ("15 minutes", "PT15M") read as the one it means ("Past 15 Minutes").
   * A rolling time OneUptime writes, none at all, and one that means none
   * are left as they are: a missing one reads as the default, as it always
   * has, and one that means none is for a write to refuse.
   */
  public static readSettings(settings: JSONObject): JSONObject {
    const written: unknown = settings?.["rollingTime"];

    if (
      written === undefined ||
      written === null ||
      RollingTimeUtil.isRollingTime(written)
    ) {
      return settings;
    }

    const rollingTime: RollingTime | null = RollingTimeUtil.fromValue(written);

    return rollingTime ? { ...settings, rollingTime } : settings;
  }

  /*
   * Why a step's rolling time cannot be read - it means no rolling time -
   * or null when it can, or the step keeps none. Only the settings of the
   * step's own monitor type are read: they are the ones its checks use.
   * The words name the field, since the server's readers are API callers.
   */
  public static getUnreadableError(data: {
    monitorType: MonitorType | undefined | null;
    stepData: unknown;
  }): string | null {
    const stepKey: string | null = MonitorStepRollingTime.getStepKey(
      data.monitorType,
    );

    if (!stepKey) {
      return null;
    }

    const settings: JSONObject | undefined = asObject(
      asObject(data.stepData)?.[stepKey],
    );
    const written: unknown = settings?.["rollingTime"];

    // None at all reads as the default, as it always has.
    if (written === undefined || written === null || written === "") {
      return null;
    }

    if (RollingTimeUtil.fromValue(written)) {
      return null;
    }

    return `${stepKey}.rollingTime ${describeWrittenValue(
      written,
    )} is not a rolling time. Use one of ${RollingTimeUtil.getValuesText()} - or a length exactly as long as one of them, such as "15 minutes", "1h" or "PT15M".`;
  }
}
