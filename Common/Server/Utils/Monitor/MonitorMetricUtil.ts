import logger from "../Logger";
import CaptureSpan from "../Telemetry/CaptureSpan";
import TelemetryUtil from "../Telemetry/Telemetry";
import MetricService from "../../Services/MetricService";
import GlobalConfigService from "../../Services/GlobalConfigService";
import GlobalConfig from "../../../Models/DatabaseModels/GlobalConfig";
import DataToProcess from "./DataToProcess";
import {
  MetricPointType,
  ServiceType,
} from "../../../Models/AnalyticsModels/Metric";
import MetricType from "../../../Models/DatabaseModels/MetricType";
import BasicInfrastructureMetrics, {
  NetworkInterfaceMetrics,
} from "../../../Types/Infrastructure/BasicMetrics";
import Dictionary from "../../../Types/Dictionary";
import { JSONObject } from "../../../Types/JSON";
import CapturedMetric from "../../../Types/Monitor/CustomCodeMonitor/CapturedMetric";
import MonitorMetricType from "../../../Types/Monitor/MonitorMetricType";
import ProbeMonitorResponse from "../../../Types/Probe/ProbeMonitorResponse";
import ServerMonitorResponse from "../../../Types/Monitor/ServerMonitor/ServerMonitorResponse";
import SyntheticMonitorResponse from "../../../Types/Monitor/SyntheticMonitors/SyntheticMonitorResponse";
import { CheckOn } from "../../../Types/Monitor/CriteriaFilter";
import ObjectID from "../../../Types/ObjectID";
import OneUptimeDate from "../../../Types/Date";

export default class MonitorMetricUtil {
  // Default retention in days if GlobalConfig is not set
  private static readonly DEFAULT_RETENTION_DAYS: number = 1;

  // Cached retention value to avoid querying GlobalConfig on every monitor check
  private static cachedRetentionDays: number | null = null;
  private static lastCacheRefresh: Date | null = null;
  private static readonly CACHE_TTL_MS: number = 5 * 60 * 1000; // 5 minutes

  private static async getRetentionDays(): Promise<number> {
    const now: Date = OneUptimeDate.getCurrentDate();

    // Return cached value if still fresh
    if (
      this.cachedRetentionDays !== null &&
      this.lastCacheRefresh !== null &&
      now.getTime() - this.lastCacheRefresh.getTime() < this.CACHE_TTL_MS
    ) {
      return this.cachedRetentionDays;
    }

    try {
      const globalConfig: GlobalConfig | null =
        await GlobalConfigService.findOneBy({
          query: {
            _id: ObjectID.getZeroObjectID().toString(),
          },
          props: {
            isRoot: true,
          },
          select: {
            monitorMetricRetentionInDays: true,
          },
        });

      if (
        globalConfig &&
        globalConfig.monitorMetricRetentionInDays !== undefined &&
        globalConfig.monitorMetricRetentionInDays !== null &&
        globalConfig.monitorMetricRetentionInDays > 0
      ) {
        this.cachedRetentionDays = globalConfig.monitorMetricRetentionInDays;
      } else {
        this.cachedRetentionDays = this.DEFAULT_RETENTION_DAYS;
      }

      this.lastCacheRefresh = now;
    } catch (error) {
      logger.error(
        "Error fetching monitor metric retention config, using default:",
      );
      logger.error(error);
      this.cachedRetentionDays = this.DEFAULT_RETENTION_DAYS;
      this.lastCacheRefresh = now;
    }

    return this.cachedRetentionDays;
  }
  private static buildMonitorMetricAttributes(data: {
    monitorId: ObjectID;
    projectId: ObjectID;
    monitorName?: string | undefined;
    probeName?: string | undefined;
    extraAttributes?: JSONObject;
  }): JSONObject {
    const attributes: JSONObject = {
      monitorId: data.monitorId.toString(),
      projectId: data.projectId.toString(),
    };

    if (data.extraAttributes) {
      Object.assign(attributes, data.extraAttributes);
    }

    if (data.monitorName) {
      attributes["monitorName"] = data.monitorName;
    }

    if (data.probeName) {
      attributes["probeName"] = data.probeName;
    }

    return attributes;
  }

  private static async buildMonitorMetricRow(data: {
    projectId: ObjectID;
    monitorId: ObjectID;
    metricName: string;
    value: number | null | undefined;
    attributes: JSONObject;
    metricPointType?: MetricPointType;
  }): Promise<JSONObject> {
    const ingestionDate: Date = OneUptimeDate.getCurrentDate();
    const ingestionTimestamp: string =
      OneUptimeDate.toClickhouseDateTime(ingestionDate);
    const timeUnixNano: string =
      OneUptimeDate.toUnixNano(ingestionDate).toString();

    const attributes: JSONObject = { ...data.attributes };
    const attributeKeys: Array<string> =
      TelemetryUtil.getAttributeKeys(attributes);

    const retentionDays: number = await this.getRetentionDays();
    const retentionDate: Date = OneUptimeDate.addRemoveDays(
      ingestionDate,
      retentionDays,
    );

    return {
      _id: ObjectID.generate().toString(),
      createdAt: ingestionTimestamp,
      updatedAt: ingestionTimestamp,
      projectId: data.projectId.toString(),
      serviceId: data.monitorId.toString(),
      serviceType: ServiceType.Monitor,
      name: data.metricName,
      aggregationTemporality: null,
      metricPointType: data.metricPointType || MetricPointType.Sum,
      time: ingestionTimestamp,
      startTime: null,
      timeUnixNano: timeUnixNano,
      startTimeUnixNano: null,
      attributes: attributes,
      attributeKeys: attributeKeys,
      isMonotonic: null,
      count: null,
      sum: null,
      min: null,
      max: null,
      bucketCounts: [],
      explicitBounds: [],
      value: data.value ?? null,
      retentionDate: OneUptimeDate.toClickhouseDateTime(retentionDate),
    } as JSONObject;
  }

  /*
   * Helper that collapses the "build attributes → build row → push → register MetricType"
   * pattern used repeatedly below. Silently skips emission when value is missing/non-finite
   * so callers can pass optional agent fields directly.
   */
  private static async pushMonitorMetric(data: {
    projectId: ObjectID;
    monitorId: ObjectID;
    monitorName: string | undefined;
    probeName: string | undefined;
    metricName: string;
    value: number | null | undefined;
    description: string;
    unit: string;
    extraAttributes?: JSONObject;
    metricPointType?: MetricPointType;
    metricRows: Array<JSONObject>;
    metricNameServiceNameMap: Dictionary<MetricType>;
  }): Promise<void> {
    if (
      data.value === undefined ||
      data.value === null ||
      typeof data.value !== "number" ||
      !isFinite(data.value)
    ) {
      return;
    }

    const attributeInput: {
      monitorId: ObjectID;
      projectId: ObjectID;
      monitorName?: string | undefined;
      probeName?: string | undefined;
      extraAttributes?: JSONObject;
    } = {
      monitorId: data.monitorId,
      projectId: data.projectId,
      monitorName: data.monitorName,
      probeName: data.probeName,
    };

    if (data.extraAttributes) {
      attributeInput.extraAttributes = data.extraAttributes;
    }

    const attributes: JSONObject =
      this.buildMonitorMetricAttributes(attributeInput);

    const metricRow: JSONObject = await this.buildMonitorMetricRow({
      projectId: data.projectId,
      monitorId: data.monitorId,
      metricName: data.metricName,
      value: data.value,
      attributes: attributes,
      metricPointType: data.metricPointType || MetricPointType.Sum,
    });

    data.metricRows.push(metricRow);

    const metricType: MetricType = new MetricType();
    metricType.name = data.metricName;
    metricType.description = data.description;
    metricType.unit = data.unit;

    data.metricNameServiceNameMap[data.metricName] = metricType;
  }

  @CaptureSpan()
  public static async saveMonitorMetrics(data: {
    monitorId: ObjectID;
    projectId: ObjectID;
    dataToProcess: DataToProcess;
    probeName: string | undefined;
    monitorName: string | undefined;
  }): Promise<void> {
    if (!data.monitorId) {
      return;
    }

    if (!data.projectId) {
      return;
    }

    if (!data.dataToProcess) {
      return;
    }

    const metricRows: Array<JSONObject> = [];

    /*
     * Metric name to serviceId map
     * example: "cpu.usage" -> [serviceId1, serviceId2]
     * since these are monitor metrics. They dont belong to any service so we can keep the array empty.
     */
    const metricNameServiceNameMap: Dictionary<MetricType> = {};

    if (
      (data.dataToProcess as ServerMonitorResponse).basicInfrastructureMetrics
    ) {
      // store cpu, memory, disk metrics.

      if ((data.dataToProcess as ServerMonitorResponse).requestReceivedAt) {
        let isOnline: boolean = true;

        const differenceInMinutes: number =
          OneUptimeDate.getDifferenceInMinutes(
            (data.dataToProcess as ServerMonitorResponse).requestReceivedAt,
            OneUptimeDate.getCurrentDate(),
          );

        if (differenceInMinutes > 2) {
          isOnline = false;
        }

        const attributes: JSONObject = this.buildMonitorMetricAttributes({
          monitorId: data.monitorId,
          projectId: data.projectId,
          monitorName: data.monitorName,
          probeName: data.probeName,
        });

        const metricRow: JSONObject = await this.buildMonitorMetricRow({
          projectId: data.projectId,
          monitorId: data.monitorId,
          metricName: MonitorMetricType.IsOnline,
          value: isOnline ? 1 : 0,
          attributes: attributes,
          metricPointType: MetricPointType.Sum,
        });

        metricRows.push(metricRow);

        // add MetricType
        const metricType: MetricType = new MetricType();
        metricType.name = MonitorMetricType.IsOnline;
        metricType.description = CheckOn.IsOnline + " status for monitor";
        metricType.unit = "";

        // add to map
        metricNameServiceNameMap[MonitorMetricType.IsOnline] = metricType;
      }

      const basicMetrics: BasicInfrastructureMetrics | undefined = (
        data.dataToProcess as ServerMonitorResponse
      ).basicInfrastructureMetrics;

      if (!basicMetrics) {
        return;
      }

      if (basicMetrics.cpuMetrics) {
        const attributes: JSONObject = this.buildMonitorMetricAttributes({
          monitorId: data.monitorId,
          projectId: data.projectId,
          monitorName: data.monitorName,
          probeName: data.probeName,
        });

        const metricRow: JSONObject = await this.buildMonitorMetricRow({
          projectId: data.projectId,
          monitorId: data.monitorId,
          metricName: MonitorMetricType.CPUUsagePercent,
          value: basicMetrics.cpuMetrics.percentUsed ?? null,
          attributes: attributes,
          metricPointType: MetricPointType.Sum,
        });

        metricRows.push(metricRow);

        const metricType: MetricType = new MetricType();
        metricType.name = MonitorMetricType.CPUUsagePercent;
        metricType.description = CheckOn.CPUUsagePercent + " of Server/VM";
        metricType.unit = "%";

        metricNameServiceNameMap[MonitorMetricType.CPUUsagePercent] =
          metricType;
      }

      if (basicMetrics.memoryMetrics) {
        const attributes: JSONObject = this.buildMonitorMetricAttributes({
          monitorId: data.monitorId,
          projectId: data.projectId,
          monitorName: data.monitorName,
          probeName: data.probeName,
        });

        const metricRow: JSONObject = await this.buildMonitorMetricRow({
          projectId: data.projectId,
          monitorId: data.monitorId,
          metricName: MonitorMetricType.MemoryUsagePercent,
          value: basicMetrics.memoryMetrics.percentUsed ?? null,
          attributes: attributes,
          metricPointType: MetricPointType.Sum,
        });

        metricRows.push(metricRow);

        const metricType: MetricType = new MetricType();
        metricType.name = MonitorMetricType.MemoryUsagePercent;
        metricType.description = CheckOn.MemoryUsagePercent + " of Server/VM";
        metricType.unit = "%";

        metricNameServiceNameMap[MonitorMetricType.MemoryUsagePercent] =
          metricType;
      }

      if (basicMetrics.diskMetrics && basicMetrics.diskMetrics.length > 0) {
        for (const diskMetric of basicMetrics.diskMetrics) {
          const extraAttributes: JSONObject = {};

          if (diskMetric.diskPath) {
            extraAttributes["diskPath"] = diskMetric.diskPath;
          }

          const attributes: JSONObject = this.buildMonitorMetricAttributes({
            monitorId: data.monitorId,
            projectId: data.projectId,
            monitorName: data.monitorName,
            probeName: data.probeName,
            extraAttributes: extraAttributes,
          });

          const metricRow: JSONObject = await this.buildMonitorMetricRow({
            projectId: data.projectId,
            monitorId: data.monitorId,
            metricName: MonitorMetricType.DiskUsagePercent,
            value: diskMetric.percentUsed ?? null,
            attributes: attributes,
            metricPointType: MetricPointType.Sum,
          });

          metricRows.push(metricRow);

          const metricType: MetricType = new MetricType();
          metricType.name = MonitorMetricType.DiskUsagePercent;
          metricType.description = CheckOn.DiskUsagePercent + " of Server/VM";
          metricType.unit = "%";

          metricNameServiceNameMap[MonitorMetricType.DiskUsagePercent] =
            metricType;
        }

        // Per-disk I/O counters (cumulative since boot).
        for (const diskMetric of basicMetrics.diskMetrics) {
          const diskAttrs: JSONObject = {};
          if (diskMetric.diskPath) {
            diskAttrs["diskPath"] = diskMetric.diskPath;
          }
          if (diskMetric.device) {
            diskAttrs["device"] = diskMetric.device;
          }
          if (diskMetric.fstype) {
            diskAttrs["fstype"] = diskMetric.fstype;
          }

          await this.pushMonitorMetric({
            projectId: data.projectId,
            monitorId: data.monitorId,
            monitorName: data.monitorName,
            probeName: data.probeName,
            metricName: MonitorMetricType.DiskReadBytesTotal,
            value: diskMetric.readBytes,
            description: "Total bytes read from disk since boot",
            unit: "bytes",
            extraAttributes: diskAttrs,
            metricRows,
            metricNameServiceNameMap,
          });

          await this.pushMonitorMetric({
            projectId: data.projectId,
            monitorId: data.monitorId,
            monitorName: data.monitorName,
            probeName: data.probeName,
            metricName: MonitorMetricType.DiskWriteBytesTotal,
            value: diskMetric.writeBytes,
            description: "Total bytes written to disk since boot",
            unit: "bytes",
            extraAttributes: diskAttrs,
            metricRows,
            metricNameServiceNameMap,
          });

          await this.pushMonitorMetric({
            projectId: data.projectId,
            monitorId: data.monitorId,
            monitorName: data.monitorName,
            probeName: data.probeName,
            metricName: MonitorMetricType.DiskReadOpsTotal,
            value: diskMetric.readCount,
            description: "Total disk read operations since boot",
            unit: "ops",
            extraAttributes: diskAttrs,
            metricRows,
            metricNameServiceNameMap,
          });

          await this.pushMonitorMetric({
            projectId: data.projectId,
            monitorId: data.monitorId,
            monitorName: data.monitorName,
            probeName: data.probeName,
            metricName: MonitorMetricType.DiskWriteOpsTotal,
            value: diskMetric.writeCount,
            description: "Total disk write operations since boot",
            unit: "ops",
            extraAttributes: diskAttrs,
            metricRows,
            metricNameServiceNameMap,
          });
        }
      }

      // Load average (1/5/15 min). Emitted only when the agent provides it.
      if (basicMetrics.loadMetrics) {
        await this.pushMonitorMetric({
          projectId: data.projectId,
          monitorId: data.monitorId,
          monitorName: data.monitorName,
          probeName: data.probeName,
          metricName: MonitorMetricType.LoadAverage1Min,
          value: basicMetrics.loadMetrics.load1,
          description: "1-minute load average",
          unit: "",
          metricRows,
          metricNameServiceNameMap,
        });
        await this.pushMonitorMetric({
          projectId: data.projectId,
          monitorId: data.monitorId,
          monitorName: data.monitorName,
          probeName: data.probeName,
          metricName: MonitorMetricType.LoadAverage5Min,
          value: basicMetrics.loadMetrics.load5,
          description: "5-minute load average",
          unit: "",
          metricRows,
          metricNameServiceNameMap,
        });
        await this.pushMonitorMetric({
          projectId: data.projectId,
          monitorId: data.monitorId,
          monitorName: data.monitorName,
          probeName: data.probeName,
          metricName: MonitorMetricType.LoadAverage15Min,
          value: basicMetrics.loadMetrics.load15,
          description: "15-minute load average",
          unit: "",
          metricRows,
          metricNameServiceNameMap,
        });
      }

      // Memory extras: swap + available.
      if (basicMetrics.memoryMetrics) {
        await this.pushMonitorMetric({
          projectId: data.projectId,
          monitorId: data.monitorId,
          monitorName: data.monitorName,
          probeName: data.probeName,
          metricName: MonitorMetricType.SwapUsagePercent,
          value: basicMetrics.memoryMetrics.swapPercentUsed,
          description: "Swap memory usage percentage",
          unit: "%",
          metricRows,
          metricNameServiceNameMap,
        });
        await this.pushMonitorMetric({
          projectId: data.projectId,
          monitorId: data.monitorId,
          monitorName: data.monitorName,
          probeName: data.probeName,
          metricName: MonitorMetricType.MemoryAvailableBytes,
          value: basicMetrics.memoryMetrics.available,
          description: "Memory available to new allocations",
          unit: "bytes",
          metricRows,
          metricNameServiceNameMap,
        });
      }

      // CPU time breakdown — drills down into what the CPU was doing.
      if (basicMetrics.cpuMetrics) {
        await this.pushMonitorMetric({
          projectId: data.projectId,
          monitorId: data.monitorId,
          monitorName: data.monitorName,
          probeName: data.probeName,
          metricName: MonitorMetricType.CPUTimeUserPercent,
          value: basicMetrics.cpuMetrics.timeUserPercent,
          description: "CPU time spent in user space",
          unit: "%",
          metricRows,
          metricNameServiceNameMap,
        });
        await this.pushMonitorMetric({
          projectId: data.projectId,
          monitorId: data.monitorId,
          monitorName: data.monitorName,
          probeName: data.probeName,
          metricName: MonitorMetricType.CPUTimeSystemPercent,
          value: basicMetrics.cpuMetrics.timeSystemPercent,
          description: "CPU time spent in kernel space",
          unit: "%",
          metricRows,
          metricNameServiceNameMap,
        });
        await this.pushMonitorMetric({
          projectId: data.projectId,
          monitorId: data.monitorId,
          monitorName: data.monitorName,
          probeName: data.probeName,
          metricName: MonitorMetricType.CPUTimeIoWaitPercent,
          value: basicMetrics.cpuMetrics.timeIoWaitPercent,
          description: "CPU time spent waiting on I/O",
          unit: "%",
          metricRows,
          metricNameServiceNameMap,
        });
        await this.pushMonitorMetric({
          projectId: data.projectId,
          monitorId: data.monitorId,
          monitorName: data.monitorName,
          probeName: data.probeName,
          metricName: MonitorMetricType.CPUTimeIdlePercent,
          value: basicMetrics.cpuMetrics.timeIdlePercent,
          description: "CPU time spent idle",
          unit: "%",
          metricRows,
          metricNameServiceNameMap,
        });
        await this.pushMonitorMetric({
          projectId: data.projectId,
          monitorId: data.monitorId,
          monitorName: data.monitorName,
          probeName: data.probeName,
          metricName: MonitorMetricType.CPUTimeStealPercent,
          value: basicMetrics.cpuMetrics.timeStealPercent,
          description: "CPU time stolen by the hypervisor",
          unit: "%",
          metricRows,
          metricNameServiceNameMap,
        });
      }

      // Network counters — both per-interface and aggregate.
      if (basicMetrics.networkMetrics) {
        const net: typeof basicMetrics.networkMetrics =
          basicMetrics.networkMetrics;

        for (const iface of net.interfaces || []) {
          const ifaceAttrs: JSONObject = {
            interfaceName: (iface as NetworkInterfaceMetrics).interfaceName,
          };

          await this.pushMonitorMetric({
            projectId: data.projectId,
            monitorId: data.monitorId,
            monitorName: data.monitorName,
            probeName: data.probeName,
            metricName: MonitorMetricType.NetworkBytesReceivedTotal,
            value: iface.bytesReceived,
            description: "Network bytes received since boot (per-interface)",
            unit: "bytes",
            extraAttributes: ifaceAttrs,
            metricRows,
            metricNameServiceNameMap,
          });
          await this.pushMonitorMetric({
            projectId: data.projectId,
            monitorId: data.monitorId,
            monitorName: data.monitorName,
            probeName: data.probeName,
            metricName: MonitorMetricType.NetworkBytesSentTotal,
            value: iface.bytesSent,
            description: "Network bytes sent since boot (per-interface)",
            unit: "bytes",
            extraAttributes: ifaceAttrs,
            metricRows,
            metricNameServiceNameMap,
          });
          await this.pushMonitorMetric({
            projectId: data.projectId,
            monitorId: data.monitorId,
            monitorName: data.monitorName,
            probeName: data.probeName,
            metricName: MonitorMetricType.NetworkPacketsReceivedTotal,
            value: iface.packetsReceived,
            description: "Network packets received since boot (per-interface)",
            unit: "packets",
            extraAttributes: ifaceAttrs,
            metricRows,
            metricNameServiceNameMap,
          });
          await this.pushMonitorMetric({
            projectId: data.projectId,
            monitorId: data.monitorId,
            monitorName: data.monitorName,
            probeName: data.probeName,
            metricName: MonitorMetricType.NetworkPacketsSentTotal,
            value: iface.packetsSent,
            description: "Network packets sent since boot (per-interface)",
            unit: "packets",
            extraAttributes: ifaceAttrs,
            metricRows,
            metricNameServiceNameMap,
          });
          await this.pushMonitorMetric({
            projectId: data.projectId,
            monitorId: data.monitorId,
            monitorName: data.monitorName,
            probeName: data.probeName,
            metricName: MonitorMetricType.NetworkErrorsIn,
            value: iface.errorsIn,
            description: "Network receive errors since boot (per-interface)",
            unit: "errors",
            extraAttributes: ifaceAttrs,
            metricRows,
            metricNameServiceNameMap,
          });
          await this.pushMonitorMetric({
            projectId: data.projectId,
            monitorId: data.monitorId,
            monitorName: data.monitorName,
            probeName: data.probeName,
            metricName: MonitorMetricType.NetworkErrorsOut,
            value: iface.errorsOut,
            description: "Network transmit errors since boot (per-interface)",
            unit: "errors",
            extraAttributes: ifaceAttrs,
            metricRows,
            metricNameServiceNameMap,
          });
        }

        await this.pushMonitorMetric({
          projectId: data.projectId,
          monitorId: data.monitorId,
          monitorName: data.monitorName,
          probeName: data.probeName,
          metricName: MonitorMetricType.NetworkConnectionsEstablished,
          value: net.connectionsEstablished,
          description: "Count of ESTABLISHED network connections",
          unit: "connections",
          metricRows,
          metricNameServiceNameMap,
        });
        await this.pushMonitorMetric({
          projectId: data.projectId,
          monitorId: data.monitorId,
          monitorName: data.monitorName,
          probeName: data.probeName,
          metricName: MonitorMetricType.NetworkConnectionsListen,
          value: net.connectionsListen,
          description: "Count of LISTENing network sockets",
          unit: "connections",
          metricRows,
          metricNameServiceNameMap,
        });
      }

      // Host uptime.
      if (basicMetrics.hostMetrics) {
        await this.pushMonitorMetric({
          projectId: data.projectId,
          monitorId: data.monitorId,
          monitorName: data.monitorName,
          probeName: data.probeName,
          metricName: MonitorMetricType.HostUptimeSeconds,
          value: basicMetrics.hostMetrics.uptimeSeconds,
          description: "Host uptime in seconds",
          unit: "seconds",
          metricRows,
          metricNameServiceNameMap,
        });
      }

      // Process count — simple scalar derived from the processes array.
      const serverProcesses: Array<unknown> | undefined = (
        data.dataToProcess as ServerMonitorResponse
      ).processes;
      if (serverProcesses && serverProcesses.length >= 0) {
        await this.pushMonitorMetric({
          projectId: data.projectId,
          monitorId: data.monitorId,
          monitorName: data.monitorName,
          probeName: data.probeName,
          metricName: MonitorMetricType.ProcessCountTotal,
          value: serverProcesses.length,
          description: "Total running processes on the server",
          unit: "processes",
          metricRows,
          metricNameServiceNameMap,
        });
      }
    }

    if (
      (data.dataToProcess as ProbeMonitorResponse).customCodeMonitorResponse
        ?.executionTimeInMS
    ) {
      const extraAttributes: JSONObject = {
        probeId: (
          data.dataToProcess as ProbeMonitorResponse
        ).probeId.toString(),
      };

      const attributes: JSONObject = this.buildMonitorMetricAttributes({
        monitorId: data.monitorId,
        projectId: data.projectId,
        extraAttributes: extraAttributes,
      });

      const metricRow: JSONObject = await this.buildMonitorMetricRow({
        projectId: data.projectId,
        monitorId: data.monitorId,
        metricName: MonitorMetricType.ExecutionTime,
        value:
          (data.dataToProcess as ProbeMonitorResponse).customCodeMonitorResponse
            ?.executionTimeInMS ?? null,
        attributes: attributes,
        metricPointType: MetricPointType.Sum,
      });

      metricRows.push(metricRow);

      const metricType: MetricType = new MetricType();
      metricType.name = MonitorMetricType.ExecutionTime;
      metricType.description = CheckOn.ExecutionTime + " of this monitor";
      metricType.unit = "ms";

      metricNameServiceNameMap[MonitorMetricType.ExecutionTime] = metricType;
    }

    if (
      (data.dataToProcess as ProbeMonitorResponse) &&
      (data.dataToProcess as ProbeMonitorResponse).syntheticMonitorResponse &&
      (
        (data.dataToProcess as ProbeMonitorResponse).syntheticMonitorResponse ||
        []
      ).length > 0
    ) {
      const syntheticResponses: Array<SyntheticMonitorResponse> =
        (data.dataToProcess as ProbeMonitorResponse).syntheticMonitorResponse ||
        [];

      for (const syntheticMonitorResponse of syntheticResponses) {
        const extraAttributes: JSONObject = {
          probeId: (
            data.dataToProcess as ProbeMonitorResponse
          ).probeId.toString(),
        };

        if (syntheticMonitorResponse.browserType) {
          extraAttributes["browserType"] = syntheticMonitorResponse.browserType;
        }

        if (syntheticMonitorResponse.screenSizeType) {
          extraAttributes["screenSizeType"] =
            syntheticMonitorResponse.screenSizeType;
        }

        const attributes: JSONObject = this.buildMonitorMetricAttributes({
          monitorId: data.monitorId,
          projectId: data.projectId,
          monitorName: data.monitorName,
          probeName: data.probeName,
          extraAttributes: extraAttributes,
        });

        const metricRow: JSONObject = await this.buildMonitorMetricRow({
          projectId: data.projectId,
          monitorId: data.monitorId,
          metricName: MonitorMetricType.ExecutionTime,
          value: syntheticMonitorResponse.executionTimeInMS ?? null,
          attributes: attributes,
          metricPointType: MetricPointType.Sum,
        });

        metricRows.push(metricRow);

        const metricType: MetricType = new MetricType();
        metricType.name = MonitorMetricType.ExecutionTime;
        metricType.description = CheckOn.ExecutionTime + " of this monitor";
        metricType.unit = "ms";

        metricNameServiceNameMap[MonitorMetricType.ExecutionTime] = metricType;
      }
    }

    if ((data.dataToProcess as ProbeMonitorResponse).responseTimeInMs) {
      const extraAttributes: JSONObject = {
        probeId: (
          data.dataToProcess as ProbeMonitorResponse
        ).probeId.toString(),
      };

      const attributes: JSONObject = this.buildMonitorMetricAttributes({
        monitorId: data.monitorId,
        projectId: data.projectId,
        monitorName: data.monitorName,
        probeName: data.probeName,
        extraAttributes: extraAttributes,
      });

      const metricRow: JSONObject = await this.buildMonitorMetricRow({
        projectId: data.projectId,
        monitorId: data.monitorId,
        metricName: MonitorMetricType.ResponseTime,
        value:
          (data.dataToProcess as ProbeMonitorResponse).responseTimeInMs ?? null,
        attributes: attributes,
        metricPointType: MetricPointType.Sum,
      });

      metricRows.push(metricRow);

      const metricType: MetricType = new MetricType();
      metricType.name = MonitorMetricType.ResponseTime;
      metricType.description = CheckOn.ResponseTime + " of this monitor";
      metricType.unit = "ms";

      metricNameServiceNameMap[MonitorMetricType.ResponseTime] = metricType;
    }

    if ((data.dataToProcess as ProbeMonitorResponse).isOnline !== undefined) {
      const extraAttributes: JSONObject = {
        probeId: (
          data.dataToProcess as ProbeMonitorResponse
        ).probeId.toString(),
      };

      const attributes: JSONObject = this.buildMonitorMetricAttributes({
        monitorId: data.monitorId,
        projectId: data.projectId,
        monitorName: data.monitorName,
        probeName: data.probeName,
        extraAttributes: extraAttributes,
      });

      const metricRow: JSONObject = await this.buildMonitorMetricRow({
        projectId: data.projectId,
        monitorId: data.monitorId,
        metricName: MonitorMetricType.IsOnline,
        value: (data.dataToProcess as ProbeMonitorResponse).isOnline ? 1 : 0,
        attributes: attributes,
        metricPointType: MetricPointType.Sum,
      });

      metricRows.push(metricRow);

      const metricType: MetricType = new MetricType();
      metricType.name = MonitorMetricType.IsOnline;
      metricType.description = CheckOn.IsOnline + " status for monitor";
      metricType.unit = "";

      metricNameServiceNameMap[MonitorMetricType.IsOnline] = metricType;
    }

    if ((data.dataToProcess as ProbeMonitorResponse).responseCode) {
      const extraAttributes: JSONObject = {
        probeId: (
          data.dataToProcess as ProbeMonitorResponse
        ).probeId.toString(),
      };

      const attributes: JSONObject = this.buildMonitorMetricAttributes({
        monitorId: data.monitorId,
        projectId: data.projectId,
        monitorName: data.monitorName,
        probeName: data.probeName,
        extraAttributes: extraAttributes,
      });

      const metricRow: JSONObject = await this.buildMonitorMetricRow({
        projectId: data.projectId,
        monitorId: data.monitorId,
        metricName: MonitorMetricType.ResponseStatusCode,
        value:
          (data.dataToProcess as ProbeMonitorResponse).responseCode ?? null,
        attributes: attributes,
        metricPointType: MetricPointType.Sum,
      });

      metricRows.push(metricRow);

      const metricType: MetricType = new MetricType();
      metricType.name = MonitorMetricType.ResponseStatusCode;
      metricType.description = CheckOn.ResponseStatusCode + " for this monitor";
      metricType.unit = "Status Code";

      metricNameServiceNameMap[MonitorMetricType.ResponseStatusCode] =
        metricType;
    }

    // Process custom metrics from Custom Code and Synthetic Monitor responses
    const customCodeMetrics: CapturedMetric[] =
      (data.dataToProcess as ProbeMonitorResponse).customCodeMonitorResponse
        ?.capturedMetrics || [];

    const syntheticCustomMetrics: CapturedMetric[] = [];
    const syntheticResponsesForMetrics: Array<SyntheticMonitorResponse> =
      (data.dataToProcess as ProbeMonitorResponse).syntheticMonitorResponse ||
      [];
    for (const resp of syntheticResponsesForMetrics) {
      if (resp.capturedMetrics) {
        syntheticCustomMetrics.push(...resp.capturedMetrics);
      }
    }

    const allCustomMetrics: CapturedMetric[] = [
      ...customCodeMetrics,
      ...syntheticCustomMetrics,
    ].slice(0, 100);

    if (allCustomMetrics.length > 0) {
      logger.debug(
        `${data.monitorId.toString()} - Processing ${allCustomMetrics.length} custom metrics`,
      );
    }

    const reservedAttributeKeys: Set<string> = new Set([
      "monitorId",
      "projectId",
      "monitorName",
      "probeName",
      "probeId",
    ]);

    for (const customMetric of allCustomMetrics) {
      if (
        !customMetric.name ||
        typeof customMetric.name !== "string" ||
        typeof customMetric.value !== "number" ||
        isNaN(customMetric.value)
      ) {
        continue;
      }

      const prefixedName: string = `custom.monitor.${customMetric.name}`;

      const extraAttributes: JSONObject = {
        isCustomMetric: "true",
      };

      if ((data.dataToProcess as ProbeMonitorResponse).probeId) {
        extraAttributes["probeId"] = (
          data.dataToProcess as ProbeMonitorResponse
        ).probeId.toString();
      }

      if (customMetric.attributes) {
        for (const [key, val] of Object.entries(customMetric.attributes)) {
          if (typeof val === "string" && !reservedAttributeKeys.has(key)) {
            extraAttributes[key] = val;
          }
        }
      }

      const attributes: JSONObject = this.buildMonitorMetricAttributes({
        monitorId: data.monitorId,
        projectId: data.projectId,
        monitorName: data.monitorName,
        probeName: data.probeName,
        extraAttributes: extraAttributes,
      });

      const metricRow: JSONObject = await this.buildMonitorMetricRow({
        projectId: data.projectId,
        monitorId: data.monitorId,
        metricName: prefixedName,
        value: customMetric.value,
        attributes: attributes,
        metricPointType: MetricPointType.Gauge,
      });

      metricRows.push(metricRow);

      const metricType: MetricType = new MetricType();
      metricType.name = prefixedName;
      metricType.description = `Custom metric: ${customMetric.name}`;
      metricType.unit = "";

      metricNameServiceNameMap[prefixedName] = metricType;
    }

    if (metricRows.length > 0) {
      await MetricService.insertJsonRows(metricRows);
    }

    // index metrics
    TelemetryUtil.indexMetricNameServiceNameMap({
      projectId: data.projectId,
      metricNameServiceNameMap: metricNameServiceNameMap,
    }).catch((err: Error) => {
      logger.error(err);
    });
  }
}
