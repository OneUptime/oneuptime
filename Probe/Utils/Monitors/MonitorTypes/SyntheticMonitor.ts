import {
  PROBE_SYNTHETIC_RUNNER_URL,
  PROBE_SYNTHETIC_MONITOR_SCRIPT_TIMEOUT_IN_MS,
} from "../../../Config";
import ClusterKeyAuthorization from "Common/Server/Middleware/ClusterKeyAuthorization";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPMethod from "Common/Types/API/HTTPMethod";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import BrowserType from "Common/Types/Monitor/SyntheticMonitors/BrowserType";
import ScreenSizeType from "Common/Types/Monitor/SyntheticMonitors/ScreenSizeType";
import SyntheticMonitorResponse from "Common/Types/Monitor/SyntheticMonitors/SyntheticMonitorResponse";
import ObjectID from "Common/Types/ObjectID";
import logger from "Common/Server/Utils/Logger";
import URL from "Common/Types/API/URL";
import { JSONObject } from "Common/Types/JSON";
import API from "Common/Utils/API";
import { SyntheticMonitorExecutionRequest } from "../../../SyntheticRunner/Types/SyntheticMonitorExecution";

export interface SyntheticMonitorOptions {
  monitorId?: ObjectID | undefined;
  screenSizeTypes?: Array<ScreenSizeType> | undefined;
  browserTypes?: Array<BrowserType> | undefined;
  script: string;
  retryCountOnError?: number | undefined;
}

export default class SyntheticMonitor {
  public static async execute(
    options: SyntheticMonitorOptions,
  ): Promise<Array<SyntheticMonitorResponse> | null> {
    const request: SyntheticMonitorExecutionRequest = {
      monitorId: options.monitorId?.toString(),
      screenSizeTypes: options.screenSizeTypes,
      browserTypes: options.browserTypes,
      script: options.script,
      retryCountOnError: options.retryCountOnError,
    };

    try {
      const result: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await API.fetch<JSONObject>({
          method: HTTPMethod.POST,
          url: URL.fromString(PROBE_SYNTHETIC_RUNNER_URL.toString()).addRoute(
            "/synthetic-monitor/run",
          ),
          data: request as unknown as JSONObject,
          headers: ClusterKeyAuthorization.getClusterKeyHeaders(),
          options: {
            timeout: this.getRequestTimeoutInMS(options),
          },
        });

      if (result instanceof HTTPErrorResponse || result.isFailure()) {
        const message: string =
          result instanceof HTTPErrorResponse
            ? result.message || "Synthetic runner request failed"
            : `Synthetic runner request failed with status code ${result.statusCode}`;

        logger.error(message);
        return this.buildFailureResults(options, message);
      }

      const rawResults: unknown = result.data["results"];

      if (!Array.isArray(rawResults)) {
        const message: string = "Synthetic runner returned an invalid payload";

        logger.error(message);
        return this.buildFailureResults(options, message);
      }

      return rawResults as Array<SyntheticMonitorResponse>;
    } catch (err: unknown) {
      logger.error(err);

      const message: string =
        (err as Error)?.message || (err as Error)?.toString() || String(err);

      return this.buildFailureResults(options, message);
    }
  }

  private static buildFailureResults(
    options: SyntheticMonitorOptions,
    message: string,
  ): Array<SyntheticMonitorResponse> {
    const results: Array<SyntheticMonitorResponse> = [];

    for (const browserType of options.browserTypes || []) {
      for (const screenSizeType of options.screenSizeTypes || []) {
        results.push({
          logMessages: [],
          scriptError: message,
          result: undefined,
          screenshots: {},
          executionTimeInMS: 0,
          browserType: browserType,
          screenSizeType: screenSizeType,
        });
      }
    }

    return results;
  }

  private static getRequestTimeoutInMS(
    options: SyntheticMonitorOptions,
  ): number {
    const browserCount: number = options.browserTypes?.length || 0;
    const screenSizeCount: number = options.screenSizeTypes?.length || 0;
    const combinationCount: number =
      browserCount > 0 && screenSizeCount > 0
        ? browserCount * screenSizeCount
        : 1;
    const attemptCount: number = (options.retryCountOnError || 0) + 1;

    return (
      combinationCount *
        (attemptCount * (PROBE_SYNTHETIC_MONITOR_SCRIPT_TIMEOUT_IN_MS + 30000) +
          (attemptCount - 1) * 1000) +
      5000
    );
  }
}
