import { JSONObject } from "../JSON";
import MetricsViewConfig from "../Metrics/MetricsViewConfig";
import RollingTime from "../RollingTime/RollingTime";

/**
 * The kind of IoT resource a metric series belongs to. Enum values are
 * byte-equal to the `iot.scope` datapoint attribute stamped by the IoT
 * agent / gateway, so the monitor worker can map a scope filter to an
 * attribute-equality clause with no translation.
 */
export enum IoTResourceScope {
  Fleet = "fleet",
  Device = "device",
}

/*
 * IoT datapoint label semantics: device-level data metrics (iot_device_up,
 * iot_battery_percent, iot_signal_strength_dbm, iot_temperature_celsius,
 * iot_cpu_usage_ratio, iot_memory_usage_bytes, iot_uptime_seconds) carry the
 * `device.id` datapoint label and the agent-stamped `iot.scope` /
 * `iot.device.type` attributes. Filters therefore target those keys.
 */
export interface IoTDeviceFilters {
  /**
   * → equality on the `iot.scope` datapoint attribute (fleet | device).
   */
  scope?: IoTResourceScope | undefined;
  /**
   * → equality on the `device.id` datapoint label.
   */
  deviceId?: string | undefined;
  /**
   * → equality on the `iot.device.type` attribute.
   */
  deviceType?: string | undefined;
}

export default interface MonitorStepIoTMonitor {
  fleetIdentifier: string;
  /*
   * The resource's id. Bound on every write and read by the worker, so a
   * rename keeps the monitor on its resource (InfrastructureResourceBinding).
   */
  resourceId?: string | undefined;
  resourceFilters: IoTDeviceFilters;
  metricViewConfig: MetricsViewConfig;
  rollingTime: RollingTime;
  /*
   * Each device is judged on its latest reading in the window, not on every
   * reading in it: a device that reported down and then up again is up.
   * Device Offline sets it - a down reading is a state, and holding it for
   * the whole 30-minute window kept the incident open that long after the
   * device came back. Not set: every reading in the window counts.
   */
  judgeLatestReading?: boolean | undefined;
}

export class MonitorStepIoTMonitorUtil {
  public static getDefault(): MonitorStepIoTMonitor {
    return {
      fleetIdentifier: "",
      resourceFilters: {},
      metricViewConfig: {
        queryConfigs: [],
        formulaConfigs: [],
      },
      rollingTime: RollingTime.Past1Minute,
    };
  }

  public static fromJSON(json: JSONObject): MonitorStepIoTMonitor {
    return json as any as MonitorStepIoTMonitor;
  }

  public static toJSON(monitor: MonitorStepIoTMonitor): JSONObject {
    return monitor as any as JSONObject;
  }

  /*
   * A per-device breakdown judged on each device's latest reading
   * (judgeLatestReading): every query's and formula's series keeps only its
   * newest row. A series with no rows stays empty, so a silent device is
   * still judged by its no-data policy.
   */
  public static keepLatestReadings<
    T extends {
      aggregatedResults: Array<{ data: Array<{ timestamp: Date }> }>;
    },
  >(series: Array<T>): Array<T> {
    return series.map((entry: T): T => {
      return {
        ...entry,
        aggregatedResults: entry.aggregatedResults.map(
          (result: { data: Array<{ timestamp: Date }> }) => {
            let latest: { timestamp: Date } | undefined = undefined;

            for (const row of result.data || []) {
              if (
                !latest ||
                new Date(row.timestamp).getTime() >
                  new Date(latest.timestamp).getTime()
              ) {
                latest = row;
              }
            }

            return { ...result, data: latest ? [latest] : [] };
          },
        ),
      };
    });
  }
}
