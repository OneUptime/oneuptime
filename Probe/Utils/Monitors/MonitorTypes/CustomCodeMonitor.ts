import {
  PROBE_ALLOW_PRIVATE_NETWORK_MONITORS,
  PROBE_CUSTOM_CODE_MONITOR_SCRIPT_TIMEOUT_IN_MS,
  PROBE_PRIVATE_NETWORK_HINT,
} from "../../../Config";
import ProxyConfig from "../../ProxyConfig";
import ReturnResult from "Common/Types/IsolatedVM/ReturnResult";
import CustomCodeMonitorResponse from "Common/Types/Monitor/CustomCodeMonitor/CustomCodeMonitorResponse";
import ObjectID from "Common/Types/ObjectID";
import logger, { EXTERNAL_FAULT } from "Common/Server/Utils/Logger";
import VMRunner from "Common/Server/Utils/VM/VMRunner";

export interface CustomCodeMonitorOptions {
  monitorId?: ObjectID | undefined;
  script: string;
}

export default class CustomCodeMonitor {
  public static async execute(
    options: CustomCodeMonitorOptions,
  ): Promise<CustomCodeMonitorResponse | null> {
    if (!options) {
      // this should never happen
      options = {
        script: "",
      };
    }

    const scriptResult: CustomCodeMonitorResponse = {
      logMessages: [],
      capturedMetrics: [],
      scriptError: undefined,
      result: undefined,

      executionTimeInMS: 0,
    };

    try {
      let result: ReturnResult | null = null;

      try {
        const startTime: [number, number] = process.hrtime();

        // Log proxy status for custom code monitoring
        if (ProxyConfig.isProxyConfigured()) {
          logger.debug(
            `Custom Code Monitor - HTTP proxy: ${ProxyConfig.getHttpProxyUrl()}, HTTPS proxy: ${ProxyConfig.getHttpsProxyUrl()}`,
          );
        }

        result = await VMRunner.runCodeInSandbox({
          code: options.script,
          options: {
            timeout: PROBE_CUSTOM_CODE_MONITOR_SCRIPT_TIMEOUT_IN_MS,
            args: {},
            /*
             * A probe is a monitoring agent, placed on purpose inside the
             * network it watches, and every other monitor type it runs already
             * reaches whatever host the monitor names. This one inherits the
             * SSRF guard from the workflow component it shares a sandbox with,
             * so without this it is the only monitor type that cannot check an
             * internal service (issue #3424). Off unless whoever deployed this
             * probe turned it on; loopback and the cloud metadata endpoint stay
             * refused either way.
             */
            allowPrivateNetworkRequests: PROBE_ALLOW_PRIVATE_NETWORK_MONITORS,
            privateNetworkAccessIsAllowed: PROBE_ALLOW_PRIVATE_NETWORK_MONITORS,
            privateNetworkHint: PROBE_PRIVATE_NETWORK_HINT,
          },
        });

        const endTime: [number, number] = process.hrtime(startTime);

        const executionTimeInMS: number = Math.ceil(
          (endTime[0] * 1000000000 + endTime[1]) / 1000000,
        );

        scriptResult.executionTimeInMS = executionTimeInMS;

        scriptResult.logMessages = result.logMessages;
        scriptResult.capturedMetrics = result.capturedMetrics || [];

        if (scriptResult.capturedMetrics.length > 0) {
          logger.debug(
            `Custom Code Monitor ${options.monitorId?.toString()} - Captured ${scriptResult.capturedMetrics.length} custom metrics`,
          );
        }

        scriptResult.result = result?.returnValue?.data;

        /*
         * runCodeInSandbox resolves with `scriptError` when the user script
         * threw or timed out — it no longer rejects. Surface it so Error-based
         * monitor criteria keep working.
         */
        if (result.scriptError) {
          // Their script, their throw — never ours.
          logger.error(result.scriptError, EXTERNAL_FAULT);
          scriptResult.scriptError =
            result.scriptError.message || result.scriptError.toString();
        }
      } catch (err) {
        logger.error(err);
        scriptResult.scriptError =
          (err as Error)?.message || (err as Error).toString();
      }

      return scriptResult;
    } catch (err: unknown) {
      logger.error(err);
      scriptResult.scriptError =
        (err as Error)?.message || (err as Error).toString();
    }

    return scriptResult;
  }
}
