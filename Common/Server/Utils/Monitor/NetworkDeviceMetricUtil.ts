import logger from "../Logger";
import TelemetryUtil from "../Telemetry/Telemetry";
import MetricService from "../../Services/MetricService";
import {
  MAX_INTERFACE_METRIC_SERIES,
  MAX_OID_METRIC_SERIES,
} from "../../../Types/Monitor/SnmpMonitor/SnmpOidListUtil";
import GlobalConfigService from "../../Services/GlobalConfigService";
import GlobalConfig from "../../../Models/DatabaseModels/GlobalConfig";
import { MetricPointType } from "../../../Models/AnalyticsModels/Metric";
import ServiceType from "../../../Types/Telemetry/ServiceType";
import MetricType from "../../../Models/DatabaseModels/MetricType";
import Dictionary from "../../../Types/Dictionary";
import { JSONObject } from "../../../Types/JSON";
import MonitorMetricType from "../../../Types/Monitor/MonitorMetricType";
import PingMonitorResponse from "../../../Types/Monitor/PingMonitor/PingMonitorResponse";
import SnmpInterface from "../../../Types/Monitor/SnmpMonitor/SnmpInterface";
import SnmpMonitorResponse, {
  SnmpOidResponse,
} from "../../../Types/Monitor/SnmpMonitor/SnmpMonitorResponse";
import ObjectID from "../../../Types/ObjectID";
import OneUptimeDate from "../../../Types/Date";
import CaptureSpan from "../Telemetry/CaptureSpan";

/*
 * Ping round-trip time of a network device, in ms.
 *
 * Ping monitors write their RTT into MonitorMetricType.ResponseTime, but on
 * a network device that series is the SNMP walk's time (and is absent on a
 * ping-only poll), so the RTT needs a series of its own. It sits in the
 * `oneuptime.monitor.ping.*` namespace beside PacketLossPercent and Jitter,
 * which ARE reused from the Ping monitor. MonitorMetricType has no member
 * for it yet; this constant should graduate into that enum (and the device
 * metric catalog) rather than be duplicated.
 */
export const NETWORK_DEVICE_PING_ROUND_TRIP_TIME_METRIC_NAME: string =
  "oneuptime.monitor.ping.round.trip.time";

/*
 * Emits device-scoped metrics from each device poll — reachability, ping
 * RTT / packet loss, SNMP walk time, per-interface
 * status/bandwidth/utilization/errors, and polled health-OID values.
 * Series are keyed to the NetworkDevice (primaryEntityId = deviceId,
 * attributes.networkDeviceId), NOT to a monitor, so the device pages can
 * chart health for every registered device — including devices no monitor
 * watches. Mirrors the SNMP sections of MonitorMetricUtil, which continue
 * to emit monitor-scoped series for monitors that alert on the device.
 */
export default class NetworkDeviceMetricUtil {
  /*
   * Caps mirror MonitorMetricUtil: bound what a single walk can write —
   * large routers can expose thousands of subinterfaces.
   *
   * They now live in one shared constant instead of a named const here and a
   * bare literal in MonitorMetricUtil. The OID cap was 50 while nothing
   * capped how many OIDs a device could be CONFIGURED with, so a longer list
   * silently charted its first 50 in jsonb array order. It is now equal to
   * the per-device configuration ceiling, which is what makes "everything you
   * configure is charted" true rather than aspirational — and both writers
   * have to move together or the raise is only half applied.
   */
  private static readonly maxInterfaceSeries: number =
    MAX_INTERFACE_METRIC_SERIES;
  private static readonly maxOidSeries: number = MAX_OID_METRIC_SERIES;

  // Retention handling mirrors MonitorMetricUtil (shared GlobalConfig knob).
  private static readonly DEFAULT_RETENTION_DAYS: number = 30;
  private static cachedRetentionDays: number | null = null;
  private static lastCacheRefresh: Date | null = null;
  private static readonly CACHE_TTL_MS: number = 5 * 60 * 1000;

  private static async getRetentionDays(): Promise<number> {
    const now: Date = OneUptimeDate.getCurrentDate();

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
        globalConfig.monitorMetricRetentionInDays !== null
      ) {
        this.cachedRetentionDays = globalConfig.monitorMetricRetentionInDays;
      } else {
        this.cachedRetentionDays = this.DEFAULT_RETENTION_DAYS;
      }
    } catch (err) {
      logger.error(err);
      this.cachedRetentionDays = this.DEFAULT_RETENTION_DAYS;
    }

    this.lastCacheRefresh = now;
    return this.cachedRetentionDays;
  }

  @CaptureSpan()
  public static async saveWalkMetrics(data: {
    projectId: ObjectID;
    networkDeviceId: ObjectID;
    deviceName: string | undefined;
    probeId: ObjectID | undefined;
    // The SNMP walk when one ran; undefined on a ping-only poll.
    snmpResponse: SnmpMonitorResponse | undefined;
    // The walk's time only - undefined on a ping-only poll, never the RTT.
    responseTimeInMs: number | undefined;
    // Device reachability: answered ping OR the walk succeeded.
    isOnline: boolean | undefined;
    // RTT / packet loss from the probe's ping, when it ran one.
    pingResponse?: PingMonitorResponse | undefined;
  }): Promise<void> {
    const metricRows: Array<JSONObject> = [];
    const metricNameServiceNameMap: Dictionary<MetricType> = {};

    const retentionDays: number =
      await NetworkDeviceMetricUtil.getRetentionDays();
    const retentionDate: Date = OneUptimeDate.addRemoveDays(
      OneUptimeDate.getCurrentDate(),
      retentionDays,
    );

    const baseAttributes: JSONObject = {
      projectId: data.projectId.toString(),
      networkDeviceId: data.networkDeviceId.toString(),
    };

    if (data.deviceName) {
      baseAttributes["deviceName"] = data.deviceName;
    }

    if (data.probeId) {
      baseAttributes["probeId"] = data.probeId.toString();
    }

    const pushMetric: (metric: {
      metricName: string;
      value: number | null | undefined;
      description: string;
      unit: string;
      extraAttributes?: JSONObject | undefined;
    }) => void = (metric: {
      metricName: string;
      value: number | null | undefined;
      description: string;
      unit: string;
      extraAttributes?: JSONObject | undefined;
    }) => {
      if (metric.value === undefined || metric.value === null) {
        return;
      }

      if (typeof metric.value !== "number" || !isFinite(metric.value)) {
        return;
      }

      metricRows.push(
        NetworkDeviceMetricUtil.buildDeviceMetricRow({
          projectId: data.projectId,
          networkDeviceId: data.networkDeviceId,
          metricName: metric.metricName,
          value: metric.value,
          retentionDate: retentionDate,
          attributes: {
            ...baseAttributes,
            ...(metric.extraAttributes || {}),
          },
        }),
      );

      const metricType: MetricType = new MetricType();
      metricType.name = metric.metricName;
      metricType.description = metric.description;
      metricType.unit = metric.unit;

      metricNameServiceNameMap[metric.metricName] = metricType;
    };

    if (data.isOnline !== undefined) {
      pushMetric({
        metricName: MonitorMetricType.IsOnline,
        value: data.isOnline ? 1 : 0,
        description:
          "Reachability of this network device by ping or SNMP (1 up, 0 down)",
        unit: "",
      });
    }

    /*
     * Walk time only. A ping-only poll has no walk and writes no point
     * here; its latency is the RTT series below. Mixing the two into one
     * series would chart a 1 ms ICMP echo and a 400 ms 48-port walk as the
     * same thing.
     */
    if (data.responseTimeInMs !== undefined) {
      pushMetric({
        metricName: MonitorMetricType.ResponseTime,
        value: data.responseTimeInMs,
        description:
          "SNMP walk time of this network device (absent when the poll ran no walk)",
        unit: "ms",
      });
    }

    /*
     * The probe's ping, when it ran one. Packet loss and jitter reuse the
     * Ping monitor's series so the same charts and criteria vocabulary
     * apply; the RTT gets its own (see the constant's comment). pushMetric
     * skips undefined values, so an older probe that reports no ping
     * writes nothing here.
     */
    if (data.pingResponse) {
      pushMetric({
        metricName: NETWORK_DEVICE_PING_ROUND_TRIP_TIME_METRIC_NAME,
        value: data.pingResponse.avgRoundTripTimeInMs,
        description: "Ping round-trip time to this network device",
        unit: "ms",
      });
      pushMetric({
        metricName: MonitorMetricType.PacketLossPercent,
        value: data.pingResponse.packetLossPercent,
        description: "Ping packet loss to this network device",
        unit: "%",
      });
      pushMetric({
        metricName: MonitorMetricType.Jitter,
        value: data.pingResponse.jitterInMs,
        description: "Ping jitter to this network device",
        unit: "ms",
      });
    }

    const snmpInterfaces: Array<SnmpInterface> | undefined =
      data.snmpResponse?.interfaces;

    if (snmpInterfaces && snmpInterfaces.length > 0) {
      const interfacesToEmit: Array<SnmpInterface> = snmpInterfaces.slice(
        0,
        NetworkDeviceMetricUtil.maxInterfaceSeries,
      );

      if (interfacesToEmit.length < snmpInterfaces.length) {
        logger.warn(
          `Device ${data.networkDeviceId.toString()}: emitting metrics for first ${interfacesToEmit.length} of ${snmpInterfaces.length} SNMP interfaces`,
        );
      }

      for (const snmpInterface of interfacesToEmit) {
        const interfaceAttributes: JSONObject = {
          interfaceName: snmpInterface.name,
          interfaceIndex: snmpInterface.interfaceIndex.toString(),
        };

        pushMetric({
          metricName: MonitorMetricType.SnmpInterfaceOperStatus,
          value: snmpInterface.isOperationallyUp ? 1 : 0,
          description: "SNMP interface operational status (1 up, 0 down)",
          unit: "",
          extraAttributes: interfaceAttributes,
        });
        pushMetric({
          metricName: MonitorMetricType.SnmpInterfaceInBitsPerSecond,
          value: snmpInterface.inBitsPerSecond,
          description: "SNMP interface inbound bandwidth",
          unit: "bps",
          extraAttributes: interfaceAttributes,
        });
        pushMetric({
          metricName: MonitorMetricType.SnmpInterfaceOutBitsPerSecond,
          value: snmpInterface.outBitsPerSecond,
          description: "SNMP interface outbound bandwidth",
          unit: "bps",
          extraAttributes: interfaceAttributes,
        });
        pushMetric({
          metricName: MonitorMetricType.SnmpInterfaceUtilizationPercent,
          value: snmpInterface.utilizationPercent,
          description: "SNMP interface utilization",
          unit: "%",
          extraAttributes: interfaceAttributes,
        });
        pushMetric({
          metricName: MonitorMetricType.SnmpInterfaceErrorsPerSecond,
          value: snmpInterface.errorsPerSecond,
          description: "SNMP interface errors per second",
          unit: "errors/s",
          extraAttributes: interfaceAttributes,
        });
      }
    }

    /*
     * Polled health-OID values (vendor-template CPU/memory/temperature and
     * custom OIDs configured on the device). One series per OID, keyed by
     * the oid/oidName attributes; non-numeric values (strings, OIDs, MACs)
     * are skipped — they carry no chartable signal.
     */
    const snmpOidResponses: Array<SnmpOidResponse> | undefined =
      data.snmpResponse?.oidResponses;

    if (snmpOidResponses && snmpOidResponses.length > 0) {
      const oidResponsesToEmit: Array<SnmpOidResponse> = snmpOidResponses.slice(
        0,
        NetworkDeviceMetricUtil.maxOidSeries,
      );

      if (oidResponsesToEmit.length < snmpOidResponses.length) {
        logger.warn(
          `Device ${data.networkDeviceId.toString()}: emitting metrics for first ${oidResponsesToEmit.length} of ${snmpOidResponses.length} SNMP OID responses`,
        );
      }

      for (const oidResponse of oidResponsesToEmit) {
        const numericValue: number | undefined =
          typeof oidResponse.value === "number" && isFinite(oidResponse.value)
            ? oidResponse.value
            : undefined;

        if (numericValue === undefined) {
          continue;
        }

        pushMetric({
          metricName: MonitorMetricType.SnmpOidValue,
          value: numericValue,
          description: "Value of a polled SNMP OID",
          unit: "",
          extraAttributes: {
            oid: oidResponse.oid,
            oidName: oidResponse.name || oidResponse.oid,
          },
        });
      }
    }

    if (metricRows.length === 0) {
      return;
    }

    await MetricService.insertJsonRows(metricRows);

    TelemetryUtil.indexMetricNameServiceNameMap({
      projectId: data.projectId,
      metricNameServiceNameMap: metricNameServiceNameMap,
    }).catch((err: Error) => {
      logger.error(err);
    });
  }

  // Row shape must stay in lockstep with MonitorMetricUtil.buildMonitorMetricRow.
  private static buildDeviceMetricRow(data: {
    projectId: ObjectID;
    networkDeviceId: ObjectID;
    metricName: string;
    value: number;
    retentionDate: Date;
    attributes: JSONObject;
  }): JSONObject {
    const ingestionDate: Date = OneUptimeDate.getCurrentDate();
    const ingestionTimestamp: string =
      OneUptimeDate.toClickhouseDateTime(ingestionDate);
    const timeUnixNano: string =
      OneUptimeDate.toUnixNano(ingestionDate).toString();

    const attributes: JSONObject = { ...data.attributes };
    const attributeKeys: Array<string> =
      TelemetryUtil.getAttributeKeys(attributes);

    return {
      _id: ObjectID.generateTimeOrdered().toString(),
      createdAt: ingestionTimestamp,
      projectId: data.projectId.toString(),
      primaryEntityId: data.networkDeviceId.toString(),
      primaryEntityType: ServiceType.NetworkDevice,
      name: data.metricName,
      aggregationTemporality: null,
      metricPointType: MetricPointType.Sum,
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
      value: data.value,
      retentionDate: OneUptimeDate.toClickhouseDateTime(data.retentionDate),
    } as JSONObject;
  }
}
