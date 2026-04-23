import MonitorType from "../../../Types/Monitor/MonitorType";
import { JSONObject } from "../../../Types/JSON";
import ProbeMonitorResponse from "../../../Types/Probe/ProbeMonitorResponse";
import IncomingMonitorRequest from "../../../Types/Monitor/IncomingMonitor/IncomingMonitorRequest";
import ServerMonitorResponse, {
  ServerProcess,
} from "../../../Types/Monitor/ServerMonitor/ServerMonitorResponse";
import BasicInfrastructureMetrics, {
  BasicDiskMetrics,
} from "../../../Types/Infrastructure/BasicMetrics";
import SslMonitorResponse from "../../../Types/Monitor/SSLMonitor/SslMonitorResponse";
import CustomCodeMonitorResponse from "../../../Types/Monitor/CustomCodeMonitor/CustomCodeMonitorResponse";
import SyntheticMonitorResponse from "../../../Types/Monitor/SyntheticMonitors/SyntheticMonitorResponse";
import SnmpMonitorResponse, {
  SnmpOidResponse,
} from "../../../Types/Monitor/SnmpMonitor/SnmpMonitorResponse";
import DnsMonitorResponse, {
  DnsRecordResponse,
} from "../../../Types/Monitor/DnsMonitor/DnsMonitorResponse";
import DomainMonitorResponse from "../../../Types/Monitor/DomainMonitor/DomainMonitorResponse";
import ExternalStatusPageMonitorResponse, {
  ExternalStatusPageComponentStatus,
} from "../../../Types/Monitor/ExternalStatusPageMonitor/ExternalStatusPageMonitorResponse";
import MetricMonitorResponse from "../../../Types/Monitor/MetricMonitor/MetricMonitorResponse";
import Typeof from "../../../Types/Typeof";
import VMUtil from "../VM/VMAPI";
import DataToProcess from "./DataToProcess";
import logger from "../Logger";

/**
 * Utility for building template variable storage map and processing dynamic placeholders
 * shared between Incident and Alert auto-creation.
 */
export default class MonitorTemplateUtil {
  /**
   * Build a storage map of variables available for templating based on monitor type.
   */
  public static buildTemplateStorageMap(data: {
    monitorType: MonitorType;
    dataToProcess: DataToProcess;
    /**
     * When set, the attribute values identifying the specific series
     * this template is being rendered for. Each label is exposed to
     * the template under its own key (so `{{host.name}}` works) and
     * also collected under a `seriesLabels` object for iteration.
     * Only populated when a metric monitor fires per-series.
     */
    seriesLabels?: JSONObject | undefined;
  }): JSONObject {
    let storageMap: JSONObject = {};

    try {
      if (
        data.monitorType === MonitorType.API ||
        data.monitorType === MonitorType.Website
      ) {
        let responseBody: JSONObject | null = null;
        try {
          responseBody = JSON.parse(
            ((data.dataToProcess as ProbeMonitorResponse)
              .responseBody as string) || "{}",
          );
        } catch (err) {
          logger.error(err);
          responseBody = (data.dataToProcess as ProbeMonitorResponse)
            .responseBody as JSONObject;
        }

        if (
          typeof responseBody === Typeof.String &&
          responseBody?.toString() === ""
        ) {
          responseBody = {};
        }

        storageMap = {
          responseBody: responseBody,
          responseHeaders: (data.dataToProcess as ProbeMonitorResponse)
            .responseHeaders,
          responseStatusCode: (data.dataToProcess as ProbeMonitorResponse)
            .responseCode,
          responseTimeInMs: (data.dataToProcess as ProbeMonitorResponse)
            .responseTimeInMs,
          isOnline: (data.dataToProcess as ProbeMonitorResponse).isOnline,
        } as JSONObject;
      }

      if (data.monitorType === MonitorType.IncomingRequest) {
        storageMap = {
          requestBody: (data.dataToProcess as IncomingMonitorRequest)
            .requestBody,
          requestHeaders: (data.dataToProcess as IncomingMonitorRequest)
            .requestHeaders,
          requestMethod: (data.dataToProcess as IncomingMonitorRequest)
            .requestMethod,
          incomingRequestReceivedAt: (
            data.dataToProcess as IncomingMonitorRequest
          ).incomingRequestReceivedAt,
        } as JSONObject;
      }

      if (
        data.monitorType === MonitorType.Ping ||
        data.monitorType === MonitorType.IP ||
        data.monitorType === MonitorType.Port
      ) {
        storageMap = {
          isOnline: (data.dataToProcess as ProbeMonitorResponse).isOnline,
          responseTimeInMs: (data.dataToProcess as ProbeMonitorResponse)
            .responseTimeInMs,
          failureCause: (data.dataToProcess as ProbeMonitorResponse)
            .failureCause,
          isTimeout: (data.dataToProcess as ProbeMonitorResponse).isTimeout,
        } as JSONObject;
      }

      if (data.monitorType === MonitorType.SSLCertificate) {
        const sslResponse: SslMonitorResponse | undefined = (
          data.dataToProcess as ProbeMonitorResponse
        ).sslResponse;
        storageMap = {
          isOnline: (data.dataToProcess as ProbeMonitorResponse).isOnline,
          isSelfSigned: sslResponse?.isSelfSigned,
          createdAt: sslResponse?.createdAt,
          expiresAt: sslResponse?.expiresAt,
          commonName: sslResponse?.commonName,
          organizationalUnit: sslResponse?.organizationalUnit,
          organization: sslResponse?.organization,
          locality: sslResponse?.locality,
          state: sslResponse?.state,
          country: sslResponse?.country,
          serialNumber: sslResponse?.serialNumber,
          fingerprint: sslResponse?.fingerprint,
          fingerprint256: sslResponse?.fingerprint256,
          failureCause: (data.dataToProcess as ProbeMonitorResponse)
            .failureCause,
        } as JSONObject;
      }

      if (data.monitorType === MonitorType.Server) {
        const serverResponse: ServerMonitorResponse =
          data.dataToProcess as ServerMonitorResponse;
        const infraMetrics: BasicInfrastructureMetrics | undefined =
          serverResponse.basicInfrastructureMetrics;

        storageMap = {
          hostname: serverResponse.hostname,
          requestReceivedAt: serverResponse.requestReceivedAt,
          failureCause: serverResponse.failureCause,
        } as JSONObject;

        // Add CPU metrics if available
        if (infraMetrics?.cpuMetrics) {
          storageMap["cpuUsagePercent"] = infraMetrics.cpuMetrics.percentUsed;
          storageMap["cpuCores"] = infraMetrics.cpuMetrics.cores;
        }

        // Add memory metrics if available
        if (infraMetrics?.memoryMetrics) {
          storageMap["memoryUsagePercent"] =
            infraMetrics.memoryMetrics.percentUsed;
          storageMap["memoryFreePercent"] =
            infraMetrics.memoryMetrics.percentFree;
          storageMap["memoryTotalBytes"] = infraMetrics.memoryMetrics.total;
        }

        // Add disk metrics if available
        if (infraMetrics?.diskMetrics) {
          storageMap["diskMetrics"] = infraMetrics.diskMetrics.map(
            (disk: BasicDiskMetrics) => {
              return {
                diskPath: disk.diskPath,
                usagePercent: disk.percentUsed,
                freePercent: disk.percentFree,
                totalBytes: disk.total,
              };
            },
          );
        }

        // Add processes if available
        if (serverResponse.processes) {
          storageMap["processes"] = serverResponse.processes.map(
            (process: ServerProcess) => {
              return {
                pid: process.pid,
                name: process.name,
                command: process.command,
              };
            },
          );
        }
      }

      if (data.monitorType === MonitorType.CustomJavaScriptCode) {
        const customCodeResponse: CustomCodeMonitorResponse | undefined = (
          data.dataToProcess as ProbeMonitorResponse
        ).customCodeMonitorResponse;

        storageMap = {
          executionTimeInMs: customCodeResponse?.executionTimeInMS,
          result: customCodeResponse?.result,
          scriptError: customCodeResponse?.scriptError,
          logMessages: customCodeResponse?.logMessages || [],
          failureCause: (data.dataToProcess as ProbeMonitorResponse)
            .failureCause,
        } as JSONObject;
      }

      if (data.monitorType === MonitorType.SyntheticMonitor) {
        const syntheticResponse: SyntheticMonitorResponse[] | undefined = (
          data.dataToProcess as ProbeMonitorResponse
        ).syntheticMonitorResponse;

        /*
         * Synthetic monitors run across multiple browser / screen-size combinations.
         * Each run is exposed through the syntheticResponses array — use
         * {{syntheticResponses[i].*}} or {{#each syntheticResponses}} in templates.
         */
        storageMap = {
          syntheticResponses: (syntheticResponse || []).map(
            (response: SyntheticMonitorResponse) => {
              return {
                executionTimeInMs: response.executionTimeInMS,
                result: response.result,
                scriptError: response.scriptError,
                logMessages: response.logMessages || [],
                screenshots: response.screenshots,
                browserType: response.browserType,
                screenSizeType: response.screenSizeType,
              };
            },
          ),
          failureCause: (data.dataToProcess as ProbeMonitorResponse)
            .failureCause,
        } as JSONObject;
      }

      if (data.monitorType === MonitorType.SNMP) {
        const snmpResponse: SnmpMonitorResponse | undefined = (
          data.dataToProcess as ProbeMonitorResponse
        ).snmpResponse;

        storageMap = {
          isOnline: (data.dataToProcess as ProbeMonitorResponse).isOnline,
          responseTimeInMs: snmpResponse?.responseTimeInMs,
          failureCause: snmpResponse?.failureCause,
          isTimeout: snmpResponse?.isTimeout,
        } as JSONObject;

        // Add OID responses as key-value pairs
        if (snmpResponse?.oidResponses) {
          storageMap["oidResponses"] = snmpResponse.oidResponses.map(
            (oidResponse: SnmpOidResponse) => {
              return {
                oid: oidResponse.oid,
                name: oidResponse.name,
                value: oidResponse.value,
                type: oidResponse.type,
              };
            },
          );

          // Also add OIDs by name for easier templating
          for (const oidResponse of snmpResponse.oidResponses) {
            if (oidResponse.name) {
              storageMap[oidResponse.name] = oidResponse.value;
            }
          }
        }
      }

      if (data.monitorType === MonitorType.DNS) {
        const dnsResponse: DnsMonitorResponse | undefined = (
          data.dataToProcess as ProbeMonitorResponse
        ).dnsResponse;

        storageMap = {
          isOnline: (data.dataToProcess as ProbeMonitorResponse).isOnline,
          responseTimeInMs: dnsResponse?.responseTimeInMs,
          failureCause: dnsResponse?.failureCause,
          isTimeout: dnsResponse?.isTimeout,
          isDnssecValid: dnsResponse?.isDnssecValid,
        } as JSONObject;

        // Add DNS records
        if (dnsResponse?.records) {
          storageMap["records"] = dnsResponse.records.map(
            (record: DnsRecordResponse) => {
              return {
                type: record.type,
                value: record.value,
                ttl: record.ttl,
              };
            },
          );

          // Add record values as a flat array for easier templating
          storageMap["recordValues"] = dnsResponse.records.map(
            (record: DnsRecordResponse) => {
              return record.value;
            },
          );
        }
      }

      if (data.monitorType === MonitorType.Domain) {
        const domainResponse: DomainMonitorResponse | undefined = (
          data.dataToProcess as ProbeMonitorResponse
        ).domainResponse;

        storageMap = {
          isOnline: (data.dataToProcess as ProbeMonitorResponse).isOnline,
          responseTimeInMs: domainResponse?.responseTimeInMs,
          failureCause: domainResponse?.failureCause,
          domainName: domainResponse?.domainName,
          registrar: domainResponse?.registrar,
          createdDate: domainResponse?.createdDate,
          updatedDate: domainResponse?.updatedDate,
          expiresDate: domainResponse?.expiresDate,
          nameServers: domainResponse?.nameServers,
          domainStatus: domainResponse?.domainStatus,
          dnssec: domainResponse?.dnssec,
        } as JSONObject;
      }

      if (
        data.monitorType === MonitorType.Metrics ||
        data.monitorType === MonitorType.Kubernetes ||
        data.monitorType === MonitorType.Docker
      ) {
        const metricResponse: MetricMonitorResponse =
          data.dataToProcess as MetricMonitorResponse;

        const queryConfigs: Array<unknown> =
          metricResponse.metricViewConfig?.queryConfigs || [];

        const firstQuery: unknown = queryConfigs[0];
        const metricName: string | undefined = (
          firstQuery as
            | {
                metricQueryData?: { filterData?: { metricName?: string } };
              }
            | undefined
        )?.metricQueryData?.filterData?.metricName;

        storageMap = {
          metricName: metricName || "",
        } as JSONObject;
      }

      if (data.monitorType === MonitorType.ExternalStatusPage) {
        const externalStatusPageResponse:
          | ExternalStatusPageMonitorResponse
          | undefined = (data.dataToProcess as ProbeMonitorResponse)
          .externalStatusPageResponse;

        storageMap = {
          isOnline: (data.dataToProcess as ProbeMonitorResponse).isOnline,
          responseTimeInMs: externalStatusPageResponse?.responseTimeInMs,
          failureCause: externalStatusPageResponse?.failureCause,
          overallStatus: externalStatusPageResponse?.overallStatus,
          activeIncidentCount: externalStatusPageResponse?.activeIncidentCount,
        } as JSONObject;

        // Add component statuses
        if (externalStatusPageResponse?.componentStatuses) {
          storageMap["componentStatuses"] =
            externalStatusPageResponse.componentStatuses.map(
              (component: ExternalStatusPageComponentStatus) => {
                return {
                  name: component.name,
                  status: component.status,
                  description: component.description,
                };
              },
            );
        }
      }
    } catch (err) {
      logger.error(err);
    }

    /*
     * Fold series labels onto the storage map so templates like
     * `{{host.name}}` or `{{resource.k8s.container.name}}` resolve at
     * render time. The template engine walks dotted paths as nested
     * property access (`host` → `.name`), so for each dotted label
     * key we build up a nested object rather than storing the flat
     * key. Also expose the full label map under `seriesLabels` for
     * iteration-style templates.
     */
    if (data.seriesLabels && Object.keys(data.seriesLabels).length > 0) {
      for (const key of Object.keys(data.seriesLabels)) {
        const value: unknown = data.seriesLabels[key];
        if (value === undefined || value === null) {
          continue;
        }
        const parts: Array<string> = key.split(".");
        let cursor: JSONObject = storageMap;
        for (let i: number = 0; i < parts.length - 1; i++) {
          const part: string = parts[i]!;
          const existing: unknown = cursor[part];
          if (
            !existing ||
            typeof existing !== "object" ||
            Array.isArray(existing)
          ) {
            cursor[part] = {};
          }
          cursor = cursor[part] as JSONObject;
        }
        cursor[parts[parts.length - 1]!] = value as JSONObject[string];
      }
      storageMap["seriesLabels"] = data.seriesLabels;
    }

    logger.debug(`Storage Map: ${JSON.stringify(storageMap, null, 2)}`);

    return storageMap;
  }

  /**
   * Replace {{var}} placeholders in the given string with values from the storage map.
   */
  public static processTemplateString(data: {
    value: string | undefined;
    storageMap: JSONObject;
  }): string {
    try {
      const { value, storageMap } = data;

      if (!value) {
        return "";
      }

      let replaced: string = VMUtil.replaceValueInPlace(
        storageMap,
        value,
        false,
      );
      replaced =
        replaced !== undefined && replaced !== null ? `${replaced}` : "";

      logger.debug(`Original Value: ${data.value}`);
      logger.debug(`Replaced Value: ${replaced}`);

      return replaced;
    } catch (err) {
      logger.error(err);
      return data.value || "";
    }
  }
}
