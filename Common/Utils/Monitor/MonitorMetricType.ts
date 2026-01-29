import AggregationType from "../../Types/BaseDatabase/AggregationType";
import { CheckOn } from "../../Types/Monitor/CriteriaFilter";
import MonitorMetricType from "../../Types/Monitor/MonitorMetricType";
import MonitorType from "../../Types/Monitor/MonitorType";

class MonitorMetricTypeUtil {
  public static getAggregationTypeByMonitorMetricType(
    monitorMetricType: MonitorMetricType,
  ): AggregationType {
    switch (monitorMetricType) {
      case MonitorMetricType.ResponseTime:
        return AggregationType.Avg;
      case MonitorMetricType.ResponseStatusCode:
        return AggregationType.Max;
      case MonitorMetricType.IsOnline:
        return AggregationType.Min;
      case MonitorMetricType.DiskUsagePercent:
        return AggregationType.Max;
      case MonitorMetricType.CPUUsagePercent:
        return AggregationType.Avg;
      case MonitorMetricType.MemoryUsagePercent:
        return AggregationType.Avg;
      case MonitorMetricType.ExecutionTime:
        return AggregationType.Avg;
      default:
        throw new Error("Invalid MonitorMetricType value");
    }
  }

  public static getMonitorMeticTypeByCheckOn(
    checkOn: CheckOn,
  ): MonitorMetricType {
    switch (checkOn) {
      case CheckOn.ResponseTime:
        return MonitorMetricType.ResponseTime;
      case CheckOn.ResponseStatusCode:
        return MonitorMetricType.ResponseStatusCode;
      case CheckOn.IsOnline:
        return MonitorMetricType.IsOnline;
      case CheckOn.DiskUsagePercent:
        return MonitorMetricType.DiskUsagePercent;
      case CheckOn.CPUUsagePercent:
        return MonitorMetricType.CPUUsagePercent;
      case CheckOn.MemoryUsagePercent:
        return MonitorMetricType.MemoryUsagePercent;
      case CheckOn.ExecutionTime:
        return MonitorMetricType.ExecutionTime;
      default:
        throw new Error("Invalid CheckOn value");
    }
  }

  public static getMonitorMetricTypesByMonitorType(
    monitorType: MonitorType,
  ): Array<MonitorMetricType> {
    if (
      monitorType === MonitorType.API ||
      monitorType === MonitorType.Website
    ) {
      return [
        MonitorMetricType.IsOnline,
        MonitorMetricType.ResponseTime,
        MonitorMetricType.ResponseStatusCode,
      ];
    }

    if (monitorType === MonitorType.Server) {
      return [
        MonitorMetricType.IsOnline,
        MonitorMetricType.DiskUsagePercent,
        MonitorMetricType.CPUUsagePercent,
        MonitorMetricType.MemoryUsagePercent,
      ];
    }

    if (monitorType === MonitorType.CustomJavaScriptCode) {
      return [MonitorMetricType.ExecutionTime];
    }

    if (monitorType === MonitorType.SyntheticMonitor) {
      return [MonitorMetricType.ExecutionTime];
    }

    if (
      monitorType === MonitorType.Ping ||
      monitorType === MonitorType.IP ||
      monitorType === MonitorType.Port ||
      monitorType === MonitorType.SNMP
    ) {
      return [MonitorMetricType.IsOnline, MonitorMetricType.ResponseTime];
    }

    return [];
  }

  public static getTitleByMonitorMetricType(
    monitorMetricType: MonitorMetricType,
  ): string {
    switch (monitorMetricType) {
      case MonitorMetricType.ResponseTime:
        return "Response Time";
      case MonitorMetricType.ResponseStatusCode:
        return "Response Status Code";
      case MonitorMetricType.IsOnline:
        return "Is Online";
      case MonitorMetricType.DiskUsagePercent:
        return "Disk Usage Percent";
      case MonitorMetricType.CPUUsagePercent:
        return "CPU Usage Percent";
      case MonitorMetricType.MemoryUsagePercent:
        return "Memory Usage Percent";
      case MonitorMetricType.ExecutionTime:
        return "Execution Time";
      default:
        return "";
    }
  }

  public static getLegendByMonitorMetricType(
    monitorMetricType: MonitorMetricType,
  ): string {
    switch (monitorMetricType) {
      case MonitorMetricType.ResponseTime:
        return "Response Time";
      case MonitorMetricType.ResponseStatusCode:
        return "Response Status Code";
      case MonitorMetricType.IsOnline:
        return "Is Online";
      case MonitorMetricType.DiskUsagePercent:
        return "Disk Usage Percent";
      case MonitorMetricType.CPUUsagePercent:
        return "CPU Usage Percent";
      case MonitorMetricType.MemoryUsagePercent:
        return "Memory Usage Percent";
      case MonitorMetricType.ExecutionTime:
        return "Execution Time";
      default:
        return "";
    }
  }

  public static getLegendUnitByMonitorMetricType(
    monitorMetricType: MonitorMetricType,
  ): string {
    switch (monitorMetricType) {
      case MonitorMetricType.ResponseTime:
        return "ms";
      case MonitorMetricType.ResponseStatusCode:
        return "";
      case MonitorMetricType.IsOnline:
        return "";
      case MonitorMetricType.DiskUsagePercent:
        return "%";
      case MonitorMetricType.CPUUsagePercent:
        return "%";
      case MonitorMetricType.MemoryUsagePercent:
        return "%";
      case MonitorMetricType.ExecutionTime:
        return "ms";
      default:
        return "";
    }
  }

  public static getDescriptionByMonitorMetricType(
    monitorMetricType: MonitorMetricType,
  ): string {
    switch (monitorMetricType) {
      case MonitorMetricType.ResponseTime:
        return "Response time is the time taken for a server to respond to a request. It is the sum of the time spent waiting to establish the connection, the time spent waiting for the request to be processed, and the time spent waiting for the response to be sent.";
      case MonitorMetricType.ResponseStatusCode:
        return "Response status code is a server response code that indicates the status of the server's response to a client's request. It is a three-digit code that is returned by a server in response to a client's request.";
      case MonitorMetricType.IsOnline:
        return "Is online is a metric that indicates whether a server is online or offline. It is a boolean value that is returned by a server in response to a client's request.";
      case MonitorMetricType.DiskUsagePercent:
        return "Disk usage percent is the percentage of disk space that is currently being used on a server. It is a measure of how much disk space is being used by the server's files and data.";
      case MonitorMetricType.CPUUsagePercent:
        return "CPU usage percent is the percentage of CPU capacity that is currently being used on a server. It is a measure of how much of the server's processing power is being used.";
      case MonitorMetricType.MemoryUsagePercent:
        return "Memory usage percent is the percentage of memory that is currently being used on a server. It is a measure of how much of the server's memory is being used.";
      case MonitorMetricType.ExecutionTime:
        return "Execution time is the time taken for a custom JavaScript code or a synthetic monitor to execute.";
      default:
        return "";
    }
  }
}

export default MonitorMetricTypeUtil;
