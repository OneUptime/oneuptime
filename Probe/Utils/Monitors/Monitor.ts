import { INGESTOR_URL } from "../../Config";
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

export default class MonitorUtil {
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

      const result: ProbeMonitorResponse | null = await this.probeMonitorStep(
        monitorStep,
        monitor,
      );

      if (result) {
        // report this back to Probe API.

        await API.fetch<JSONObject>(
          HTTPMethod.POST,
          URL.fromString(INGESTOR_URL.toString()).addRoute(
            "/probe/response/ingest",
          ),
          {
            ...ProbeAPIRequest.getDefaultRequestBody(),
            probeMonitorResponse: result as any,
          },
          {},
          {},
        );
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

  public static async probeMonitorStep(
    monitorStep: MonitorStep,
    monitor: Monitor,
  ): Promise<ProbeMonitorResponse | null> {
    const result: ProbeMonitorResponse = {
      monitorStepId: monitorStep.id,
      monitorId: monitor.id!,
      probeId: ProbeUtil.getProbeId(),
      failureCause: "",
      monitoredAt: OneUptimeDate.getCurrentDate(),
    };

    if (!monitorStep.data) {
      return result;
    }

    if (
      monitor.monitorType === MonitorType.Ping ||
      monitor.monitorType === MonitorType.IP
    ) {
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
            retry: 5,
            monitorId: monitor.id!,
          },
        );

        if (!response) {
          return null;
        }

        result.isOnline = response.isOnline;
        result.responseTimeInMs = response.responseTimeInMS?.toNumber();
        result.failureCause = response.failureCause;
      } else {
        const response: PingResponse | null = await PingMonitor.ping(
          monitorStep.data?.monitorDestination,
          {
            retry: 5,
            monitorId: monitor.id!,
          },
        );

        if (!response) {
          return null;
        }

        result.isOnline = response.isOnline;
        result.responseTimeInMs = response.responseTimeInMS?.toNumber();
        result.failureCause = response.failureCause;
      }
    }

    if (monitor.monitorType === MonitorType.Port) {
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
          retry: 5,
          monitorId: monitor.id!,
        },
      );

      if (!response) {
        return null;
      }

      result.isOnline = response.isOnline;
      result.responseTimeInMs = response.responseTimeInMS?.toNumber();
      result.failureCause = response.failureCause;
    }

    if (monitor.monitorType === MonitorType.SyntheticMonitor) {
      if (!monitorStep.data?.customCode) {
        result.failureCause =
          "Code not specified. Please add playwright script.";
        return result;
      }

      const response: Array<SyntheticMonitorResponse> | null =
        await SyntheticMonitor.execute({
          script: monitorStep.data.customCode,
          monitorId: monitor.id!,
          screenSizeTypes: monitorStep.data
            .screenSizeTypes as Array<ScreenSizeType>,
          browserTypes: monitorStep.data.browserTypes as Array<BrowserType>,
        });

      if (!response) {
        return null;
      }

      result.syntheticMonitorResponse = response;
    }

    if (monitor.monitorType === MonitorType.CustomJavaScriptCode) {
      if (!monitorStep.data?.customCode) {
        result.failureCause =
          "Code not specified. Please add playwright script.";
        return result;
      }

      const response: CustomCodeMonitorResponse | null =
        await CustomCodeMonitor.execute({
          script: monitorStep.data.customCode,
          monitorId: monitor.id!,
        });

      if (!response) {
        return null;
      }

      result.customCodeMonitorResponse = response;
    }

    if (monitor.monitorType === MonitorType.SSLCertificate) {
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
          retry: 5,
          monitorId: monitor.id!,
        },
      );

      if (!response) {
        return null;
      }

      result.isOnline = response.isOnline;
      result.failureCause = response.failureCause;
      result.sslResponse = {
        ...response,
      };
    }

    if (monitor.monitorType === MonitorType.Website) {
      if (!monitorStep.data?.monitorDestination) {
        return result;
      }

      result.monitorDestination = monitorStep.data.monitorDestination;

      const response: ProbeWebsiteResponse | null = await WebsiteMonitor.ping(
        monitorStep.data?.monitorDestination as URL,
        {
          isHeadRequest: MonitorUtil.isHeadRequest(monitorStep),
          monitorId: monitor.id!,
          retry: 5,
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
    }

    if (monitor.monitorType === MonitorType.API) {
      if (!monitorStep.data?.monitorDestination) {
        return result;
      }

      result.monitorDestination = monitorStep.data.monitorDestination;

      let requestBody: JSONObject | undefined = undefined;
      if (
        monitorStep.data?.requestBody &&
        typeof monitorStep.data?.requestBody === "string"
      ) {
        requestBody = JSONFunctions.parseJSONObject(
          monitorStep.data?.requestBody,
        );
      }

      const response: APIResponse | null = await ApiMonitor.ping(
        monitorStep.data?.monitorDestination as URL,
        {
          requestHeaders: monitorStep.data?.requestHeaders || {},
          requestBody: requestBody || undefined,
          monitorId: monitor.id!,
          requestType: monitorStep.data?.requestType || HTTPMethod.GET,
          retry: 5,
        },
      );

      if (!response) {
        return null;
      }

      result.isOnline = response.isOnline;
      result.responseTimeInMs = response.responseTimeInMS?.toNumber();
      result.responseBody = response.responseBody;
      result.responseHeaders = response.responseHeaders;
      result.responseCode = response.statusCode;
      result.failureCause = response.failureCause;
    }

    return result;
  }
}
