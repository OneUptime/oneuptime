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
  resourceFilters: IoTDeviceFilters;
  metricViewConfig: MetricsViewConfig;
  rollingTime: RollingTime;
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
}
