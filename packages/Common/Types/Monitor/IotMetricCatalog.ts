import { IoTResourceScope } from "./MonitorStepIoTMonitor";
import MetricsAggregationType from "../Metrics/MetricsAggregationType";

export type IoTMetricCategory =
  | "Availability"
  | "Power"
  | "Connectivity"
  | "Environment"
  | "System";

export interface IoTMetricDefinition {
  id: string;
  friendlyName: string;
  description: string;
  metricName: string;
  category: IoTMetricCategory;
  defaultAggregation: MetricsAggregationType;
  defaultResourceScope: IoTResourceScope;
  unit?: string;
}

/*
 * Metric names follow the OneUptime IoT naming scheme. Each series carries a
 * `device.id` datapoint label identifying the IoT device it belongs to, plus
 * the agent stamps `iot.scope` (fleet | device), `iot.device.type` and
 * `iot.device.kind` as datapoint attributes — `defaultResourceScope` is the
 * `iot.scope` value the metric is usually filtered to (Fleet = spans the whole
 * fleet; don't pre-filter).
 */
const iotMetricCatalog: Array<IoTMetricDefinition> = [
  // Availability Metrics
  {
    id: "iot-device-up",
    friendlyName: "Device Up",
    description:
      "Whether an IoT device is up (1) or down/offline (0). Reported per device — filter on the device.id label to scope to one device.",
    metricName: "iot_device_up",
    category: "Availability",
    defaultAggregation: MetricsAggregationType.Min,
    defaultResourceScope: IoTResourceScope.Device,
  },

  // Power Metrics
  {
    id: "iot-battery-percent",
    friendlyName: "Battery Level",
    description:
      "Remaining battery charge of a device as a percentage (0 to 100). Falling levels indicate a device that will soon go offline.",
    metricName: "iot_battery_percent",
    category: "Power",
    defaultAggregation: MetricsAggregationType.Avg,
    defaultResourceScope: IoTResourceScope.Device,
    unit: "%",
  },

  // Connectivity Metrics
  {
    id: "iot-signal-strength",
    friendlyName: "Signal Strength",
    description:
      "Wireless signal strength of a device in dBm (closer to 0 is stronger; more negative is weaker). Weak signal precedes connectivity loss.",
    metricName: "iot_signal_strength_dbm",
    category: "Connectivity",
    defaultAggregation: MetricsAggregationType.Avg,
    defaultResourceScope: IoTResourceScope.Device,
    unit: "dBm",
  },

  // Environment Metrics
  {
    id: "iot-temperature",
    friendlyName: "Temperature",
    description:
      "Temperature reported by a device in degrees Celsius. High readings can indicate overheating hardware or an environmental issue.",
    metricName: "iot_temperature_celsius",
    category: "Environment",
    defaultAggregation: MetricsAggregationType.Avg,
    defaultResourceScope: IoTResourceScope.Device,
    unit: "°C",
  },

  // System Metrics
  {
    id: "iot-cpu-usage",
    friendlyName: "CPU Usage Ratio",
    description:
      "CPU usage of a device as a ratio of available CPU (0 to 1, where 1 = fully used).",
    metricName: "iot_cpu_usage_ratio",
    category: "System",
    defaultAggregation: MetricsAggregationType.Avg,
    defaultResourceScope: IoTResourceScope.Device,
    unit: "ratio",
  },
  {
    id: "iot-memory-usage",
    friendlyName: "Memory Usage",
    description:
      "Memory currently in use by a device, in bytes. Compare against the device's total memory to gauge memory pressure.",
    metricName: "iot_memory_usage_bytes",
    category: "System",
    defaultAggregation: MetricsAggregationType.Avg,
    defaultResourceScope: IoTResourceScope.Device,
    unit: "bytes",
  },
  {
    id: "iot-uptime",
    friendlyName: "Uptime",
    description:
      "How long a device has been running. Drops to zero when the device is restarted or rebooted.",
    metricName: "iot_uptime_seconds",
    category: "System",
    defaultAggregation: MetricsAggregationType.Max,
    defaultResourceScope: IoTResourceScope.Device,
    unit: "s",
  },
];

export function getAllIoTMetrics(): Array<IoTMetricDefinition> {
  return iotMetricCatalog;
}

export function getIoTMetricsByCategory(
  category: IoTMetricCategory,
): Array<IoTMetricDefinition> {
  return iotMetricCatalog.filter((m: IoTMetricDefinition) => {
    return m.category === category;
  });
}

export function getIoTMetricById(id: string): IoTMetricDefinition | undefined {
  return iotMetricCatalog.find((m: IoTMetricDefinition) => {
    return m.id === id;
  });
}

export function getIoTMetricByMetricName(
  metricName: string,
): IoTMetricDefinition | undefined {
  return iotMetricCatalog.find((m: IoTMetricDefinition) => {
    return m.metricName === metricName;
  });
}

export function getAllIoTMetricCategories(): Array<IoTMetricCategory> {
  return ["Availability", "Power", "Connectivity", "Environment", "System"];
}
