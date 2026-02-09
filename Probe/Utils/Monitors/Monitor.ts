import { PROBE_INGEST_URL, PROBE_MONITOR_RETRY_LIMIT } from "../../Config";
import ProbeUtil from "../Probe";
import ProbeAPIRequest from "../ProbeAPIRequest";
import ApiMonitor, { APIResponse } from "./MonitorTypes/ApiMonitor";
import CustomCodeMonitor from "./MonitorTypes/CustomCodeMonitor";
import PingMonitor, { PingResponse } from "./MonitorTypes/PingMonitor";
import PortMonitor, { PortMonitorResponse } from "./MonitorTypes/PortMonitor";
import SSLMonitor, { SslResponse } from "./MonitorTypes/SslMonitor";
import SyntheticMonitor from "./MonitorTypes/SyntheticMonitor";
import WebsiteMonitor, {
  ProbeWebsiteResponse,
} from "./MonitorTypes/WebsiteMonitor";
import SnmpMonitor from "./MonitorTypes/SnmpMonitor";
import SnmpMonitorResponse from "Common/Types/Monitor/SnmpMonitor/SnmpMonitorResponse";
import MonitorStepSnmpMonitor from "Common/Types/Monitor/MonitorStepSnmpMonitor";
import HTTPMethod from "Common/Types/API/HTTPMethod";
import URL from "Common/Types/API/URL";
import OneUptimeDate from "Common/Types/Date";
import { JSONObject } from "Common/Types/JSON";
import JSONFunctions from "Common/Types/JSONFunctions";
import { CheckOn, CriteriaFilter } from "Common/Types/Monitor/CriteriaFilter";
import CustomCodeMonitorResponse from "Common/Types/Monitor/CustomCodeMonitor/CustomCodeMonitorResponse";
import MonitorCriteriaInstance from "Common/Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import MonitorType from "Common/Types/Monitor/MonitorType";
import BrowserType from "Common/Types/Monitor/SyntheticMonitors/BrowserType";
import SyntheticMonitorResponse from "Common/Types/Monitor/SyntheticMonitors/SyntheticMonitorResponse";
import Port from "Common/Types/Port";
import ProbeMonitorResponse from "Common/Types/Probe/ProbeMonitorResponse";
import ScreenSizeType from "Common/Types/ScreenSizeType";
import API from "Common/Utils/API";
import LocalCache from "Common/Server/Infrastructure/LocalCache";
import logger from "Common/Server/Utils/Logger";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import PositiveNumber from "Common/Types/PositiveNumber";
import ObjectID from "Common/Types/ObjectID";
import MonitorTest from "Common/Models/DatabaseModels/MonitorTest";
import ProxyConfig from "../ProxyConfig";

export default class MonitorUtil {
  // Replace dynamic URL placeholders like {{timestamp}} and {{random}} with actual values.
  public static resolveUrlPlaceholders(url: URL): URL {
    let urlString: string = url.toString();

    if (
      !urlString.includes("{{timestamp}}") &&
      !urlString.includes("{{random}}")
    ) {
      return url;
    }

    const timestamp: string = Math.floor(Date.now() / 1000).toString();
    const random: string = ObjectID.generate().toString().replace(/-/g, "");

    urlString = urlString.replace(/\{\{timestamp\}\}/g, timestamp);
    urlString = urlString.replace(/\{\{random\}\}/g, random);

    return URL.fromString(urlString);
  }

  public static async probeMonitorTest(
    monitorTest: MonitorTest,
  ): Promise<Array<ProbeMonitorResponse | null>> {
    const results: Array<ProbeMonitorResponse | null> = [];

    if (
      !monitorTest.monitorSteps ||
      monitorTest.monitorSteps.data?.monitorStepsInstanceArray.length === 0
    ) {
      logger.debug("No monitor steps found");
      return [];
    }

    for (const monitorStep of monitorTest.monitorSteps.data
      ?.monitorStepsInstanceArray || []) {
      if (!monitorStep) {
        continue;
      }

      const result: ProbeMonitorResponse | null = await this.probeMonitorStep({
        monitorType: monitorTest.monitorType!,
        monitorId: monitorTest.id!,
        monitorStep: monitorStep,
        projectId: monitorTest.projectId!,
      });

      if (result) {
        // report this back to Probe API.
        const monitorTestIngestUrl: URL = URL.fromString(
          PROBE_INGEST_URL.toString(),
        ).addRoute(
          "/probe/response/monitor-test-ingest/" + monitorTest.id?.toString(),
        );

        await API.fetch<JSONObject>({
          method: HTTPMethod.POST,
          url: monitorTestIngestUrl,
          data: {
            ...ProbeAPIRequest.getDefaultRequestBody(),
            probeMonitorResponse: result as any,
          },
          headers: {},
          options: {
            ...ProxyConfig.getRequestProxyAgents(monitorTestIngestUrl),
          },
        });
      }

      results.push(result);
    }

    return results;
  }

  public static async probeMonitor(
    monitor: Monitor,
  ): Promise<Array<ProbeMonitorResponse | null>> {
    const results: Array<ProbeMonitorResponse | null> = [];

    if (
      !monitor.monitorSteps ||
      monitor.monitorSteps.data?.monitorStepsInstanceArray.length === 0
    ) {
      logger.debug("No monitor steps found");
      return [];
    }

    for (const monitorStep of monitor.monitorSteps.data
      ?.monitorStepsInstanceArray || []) {
      if (!monitorStep) {
        continue;
      }

      const result: ProbeMonitorResponse | null = await this.probeMonitorStep({
        monitorType: monitor.monitorType!,
        monitorId: monitor.id!,
        monitorStep: monitorStep,
        projectId: monitor.projectId!,
      });

      if (result) {
        // report this back to Probe API.
        const monitorIngestUrl: URL = URL.fromString(
          PROBE_INGEST_URL.toString(),
        ).addRoute("/probe/response/ingest");

        await API.fetch<JSONObject>({
          method: HTTPMethod.POST,
          url: monitorIngestUrl,
          data: {
            ...ProbeAPIRequest.getDefaultRequestBody(),
            probeMonitorResponse: result as any,
          },
          headers: {},
          options: {
            ...ProxyConfig.getRequestProxyAgents(monitorIngestUrl),
          },
        });
      }

      results.push(result);
    }

    return results;
  }

  public static isHeadRequest(monitorStep: MonitorStep): boolean {
    // If its not GET requestm it cannot be a head request
    if (
      monitorStep.data?.requestType &&
      monitorStep.data?.requestType !== HTTPMethod.GET
    ) {
      return false;
    }

    // check if monitor step has any criteria with needs request body. If no, then return true otherwise return false.

    if (
      monitorStep.data?.monitorCriteria.data?.monitorCriteriaInstanceArray &&
      monitorStep.data?.monitorCriteria.data?.monitorCriteriaInstanceArray
        .length > 0
    ) {
      const criteriaArray: Array<MonitorCriteriaInstance> =
        monitorStep.data?.monitorCriteria.data?.monitorCriteriaInstanceArray;

      for (const criteria of criteriaArray) {
        if (criteria.data?.filters && criteria.data?.filters.length > 0) {
          const filters: Array<CriteriaFilter> = criteria.data?.filters;

          for (const filter of filters) {
            if (
              filter.checkOn === CheckOn.ResponseBody ||
              filter.checkOn === CheckOn.JavaScriptExpression
            ) {
              return false;
            }
          }
        }
      }
    }

    return true;
  }

  public static async probeMonitorStep(data: {
    monitorStep: MonitorStep;
    monitorType: MonitorType;
    monitorId: ObjectID;
    projectId: ObjectID;
  }): Promise<ProbeMonitorResponse | null> {
    const monitorStep: MonitorStep = data.monitorStep;
    const monitorType: MonitorType = data.monitorType;
    const monitorId: ObjectID = data.monitorId;

    const result: ProbeMonitorResponse = {
      monitorStepId: monitorStep.id,
      projectId: data.projectId,
      monitorId: monitorId!,
      probeId: ProbeUtil.getProbeId(),
      failureCause: "",
      monitoredAt: OneUptimeDate.getCurrentDate(),
    };

    if (!monitorStep.data) {
      return result;
    }

    if (monitorType === MonitorType.Ping || monitorType === MonitorType.IP) {
      if (!monitorStep.data?.monitorDestination) {
        return result;
      }

      result.monitorDestination = monitorStep.data.monitorDestination;

      if (LocalCache.getString("PROBE", "PING_MONITORING") === "PORT") {
        // probe is online but ping monitoring is blocked by the cloud provider. Fallback to port monitoring.

        const response: PortMonitorResponse | null = await PortMonitor.ping(
          monitorStep.data?.monitorDestination,
          new Port(80), // use port 80 by default.
          {
            retry: PROBE_MONITOR_RETRY_LIMIT,
            monitorId: monitorId,
            timeout: new PositiveNumber(60000), // 60 seconds
          },
        );

        if (!response) {
          return null;
        }

        result.isOnline = response.isOnline;
        result.isTimeout = response.isTimeout;
        result.responseTimeInMs = response.responseTimeInMS?.toNumber();
        result.failureCause = response.failureCause;
      } else {
        const response: PingResponse | null = await PingMonitor.ping(
          monitorStep.data?.monitorDestination,
          {
            retry: PROBE_MONITOR_RETRY_LIMIT,
            monitorId: monitorId,
            timeout: new PositiveNumber(60000), // 60 seconds
          },
        );

        if (!response) {
          return null;
        }

        result.isOnline = response.isOnline;
        result.isTimeout = response.isTimeout;
        result.responseTimeInMs = response.responseTimeInMS?.toNumber();
        result.failureCause = response.failureCause;
      }
    }

    if (monitorType === MonitorType.Port) {
      if (!monitorStep.data?.monitorDestination) {
        return result;
      }

      result.monitorDestination = monitorStep.data.monitorDestination;

      if (!monitorStep.data?.monitorDestinationPort) {
        result.isOnline = false;
        result.responseTimeInMs = 0;
        result.failureCause = "Port is not specified";

        return result;
      }

      result.monitorDestinationPort = monitorStep.data.monitorDestinationPort;

      const response: PortMonitorResponse | null = await PortMonitor.ping(
        monitorStep.data?.monitorDestination,
        monitorStep.data.monitorDestinationPort,
        {
          retry: PROBE_MONITOR_RETRY_LIMIT,
          monitorId: monitorId,
          timeout: new PositiveNumber(60000), // 60 seconds
        },
      );

      if (!response) {
        return null;
      }

      result.isOnline = response.isOnline;
      result.responseTimeInMs = response.responseTimeInMS?.toNumber();
      result.failureCause = response.failureCause;
      result.isTimeout = response.isTimeout;
    }

    if (monitorType === MonitorType.SyntheticMonitor) {
      if (!monitorStep.data?.customCode) {
        result.failureCause =
          "Code not specified. Please add playwright script.";
        return result;
      }

      const response: Array<SyntheticMonitorResponse> | null =
        await SyntheticMonitor.execute({
          script: monitorStep.data.customCode,
          monitorId: monitorId,
          screenSizeTypes: monitorStep.data
            .screenSizeTypes as Array<ScreenSizeType>,
          browserTypes: monitorStep.data.browserTypes as Array<BrowserType>,
          retryCountOnError: monitorStep.data.retryCountOnError || 0,
        });

      if (!response) {
        return null;
      }

      result.syntheticMonitorResponse = response;
    }

    if (monitorType === MonitorType.CustomJavaScriptCode) {
      if (!monitorStep.data?.customCode) {
        result.failureCause =
          "Code not specified. Please add playwright script.";
        return result;
      }

      const response: CustomCodeMonitorResponse | null =
        await CustomCodeMonitor.execute({
          script: monitorStep.data.customCode,
          monitorId: monitorId,
        });

      if (!response) {
        return null;
      }

      result.customCodeMonitorResponse = response;
    }

    if (monitorType === MonitorType.SSLCertificate) {
      if (!monitorStep.data?.monitorDestination) {
        return result;
      }

      result.monitorDestination = monitorStep.data.monitorDestination;

      if (!monitorStep.data?.monitorDestination) {
        result.isOnline = false;
        result.responseTimeInMs = 0;
        result.failureCause = "Port is not specified";

        return result;
      }

      const response: SslResponse | null = await SSLMonitor.ping(
        monitorStep.data?.monitorDestination as URL,
        {
          retry: PROBE_MONITOR_RETRY_LIMIT,
          monitorId: monitorId,
          timeout: new PositiveNumber(60000), // 60 seconds
        },
      );

      if (!response) {
        return null;
      }

      result.isOnline = response.isOnline;
      result.failureCause = response.failureCause;
      result.isTimeout = response.isTimeout;
      result.sslResponse = {
        ...response,
      };
    }

    if (monitorType === MonitorType.Website) {
      if (!monitorStep.data?.monitorDestination) {
        return result;
      }

      result.monitorDestination = monitorStep.data.monitorDestination;

      const websiteUrl: URL = MonitorUtil.resolveUrlPlaceholders(
        monitorStep.data?.monitorDestination as URL,
      );

      const response: ProbeWebsiteResponse | null = await WebsiteMonitor.ping(
        websiteUrl,
        {
          isHeadRequest: MonitorUtil.isHeadRequest(monitorStep),
          monitorId: monitorId,
          retry: PROBE_MONITOR_RETRY_LIMIT,
          timeout: new PositiveNumber(60000), // 60 seconds
          doNotFollowRedirects: monitorStep.data?.doNotFollowRedirects || false,
        },
      );

      if (!response) {
        return null;
      }

      result.isOnline = response.isOnline;
      result.responseTimeInMs = response.responseTimeInMS?.toNumber();
      result.responseBody = response.responseBody?.toString();
      result.responseHeaders = response.responseHeaders;
      result.responseCode = response.statusCode;
      result.failureCause = response.failureCause;
      result.isTimeout = response.isTimeout;
      result.requestFailedDetails = response.requestFailedDetails;
    }

    if (monitorType === MonitorType.API) {
      if (!monitorStep.data?.monitorDestination) {
        return result;
      }

      result.monitorDestination = monitorStep.data.monitorDestination;

      const apiUrl: URL = MonitorUtil.resolveUrlPlaceholders(
        monitorStep.data?.monitorDestination as URL,
      );

      let requestBody: JSONObject | undefined = undefined;
      if (
        monitorStep.data?.requestBody &&
        typeof monitorStep.data?.requestBody === "string"
      ) {
        requestBody = JSONFunctions.parseJSONObject(
          monitorStep.data?.requestBody,
        );
      }

      const response: APIResponse | null = await ApiMonitor.ping(apiUrl, {
        requestHeaders: monitorStep.data?.requestHeaders || {},
        requestBody: requestBody || undefined,
        monitorId: monitorId,
        requestType: monitorStep.data?.requestType || HTTPMethod.GET,
        retry: PROBE_MONITOR_RETRY_LIMIT,
        timeout: new PositiveNumber(60000), // 60 seconds
        doNotFollowRedirects: monitorStep.data?.doNotFollowRedirects || false,
      });

      if (!response) {
        return null;
      }

      result.isOnline = response.isOnline;
      result.isTimeout = response.isTimeout;
      result.responseTimeInMs = response.responseTimeInMS?.toNumber();
      result.responseBody = response.responseBody;
      result.responseHeaders = response.responseHeaders;
      result.responseCode = response.statusCode;
      result.failureCause = response.failureCause;
      result.requestFailedDetails = response.requestFailedDetails;
    }

    if (monitorType === MonitorType.SNMP) {
      if (!monitorStep.data?.snmpMonitor) {
        result.failureCause = "SNMP configuration not specified";
        return result;
      }

      const snmpConfig: MonitorStepSnmpMonitor = monitorStep.data.snmpMonitor;

      if (!snmpConfig.hostname) {
        result.failureCause = "SNMP hostname not specified";
        return result;
      }

      if (!snmpConfig.oids || snmpConfig.oids.length === 0) {
        result.failureCause = "No OIDs configured for SNMP monitor";
        return result;
      }

      const response: SnmpMonitorResponse | null = await SnmpMonitor.query(
        snmpConfig,
        {
          retry: PROBE_MONITOR_RETRY_LIMIT,
          monitorId: monitorId,
          timeout: snmpConfig.timeout || 5000,
        },
      );

      if (!response) {
        return null;
      }

      result.isOnline = response.isOnline;
      result.isTimeout = response.isTimeout;
      result.responseTimeInMs = response.responseTimeInMs;
      result.failureCause = response.failureCause;
      result.snmpResponse = response;
    }

    // update the monitoredAt time to the current time.
    result.monitoredAt = OneUptimeDate.getCurrentDate();

    return result;
  }
}
