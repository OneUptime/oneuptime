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

      if (
        data.monitorType === MonitorType.SyntheticMonitor ||
        data.monitorType === MonitorType.CustomJavaScriptCode
      ) {
        const customCodeResponse: CustomCodeMonitorResponse | undefined = (
          data.dataToProcess as ProbeMonitorResponse
        ).customCodeMonitorResponse;
        const syntheticResponse: SyntheticMonitorResponse[] | undefined = (
          data.dataToProcess as ProbeMonitorResponse
        ).syntheticMonitorResponse;

        storageMap = {
          executionTimeInMs: customCodeResponse?.executionTimeInMS,
          result: customCodeResponse?.result,
          scriptError: customCodeResponse?.scriptError,
          logMessages: customCodeResponse?.logMessages || [],
          failureCause: (data.dataToProcess as ProbeMonitorResponse)
            .failureCause,
        } as JSONObject;

        // Add synthetic monitor specific fields if available
        if (syntheticResponse && syntheticResponse.length > 0) {
          const firstResponse: SyntheticMonitorResponse = syntheticResponse[0]!;
          if (firstResponse) {
            storageMap["screenshots"] = firstResponse.screenshots;
            storageMap["browserType"] = firstResponse.browserType;
            storageMap["screenSizeType"] = firstResponse.screenSizeType;
          }
        }
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
    } catch (err) {
      logger.error(err);
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
