import {
  PROBE_ALLOW_PRIVATE_NETWORK_MONITORS,
  PROBE_CUSTOM_CODE_MONITOR_SCRIPT_TIMEOUT_IN_MS,
  PROBE_PRIVATE_NETWORK_HINT,
} from "../../../Config";
import ProxyConfig from "../../ProxyConfig";
import ReturnResult from "Common/Types/IsolatedVM/ReturnResult";
import CapturedMetric from "Common/Types/Monitor/CustomCodeMonitor/CapturedMetric";
import TotpCodeIssuer from "Common/Utils/Monitor/MonitorSecretTotp";
import { TotpSecrets } from "Common/Utils/Totp/TotpParameters";
import CustomCodeMonitorResponse from "Common/Types/Monitor/CustomCodeMonitor/CustomCodeMonitorResponse";
import ObjectID from "Common/Types/ObjectID";
import logger, { EXTERNAL_FAULT } from "Common/Server/Utils/Logger";
import VMRunner from "Common/Server/Utils/VM/VMRunner";

export interface CustomCodeMonitorOptions {
  monitorId?: ObjectID | undefined;
  script: string;
  /*
   * The one-time code (TOTP) secrets the script references (issue #9703):
   * its {{monitorSecrets.NAME}} is filled in with the code just before it
   * runs, and oneuptime.getTotpCode makes one when it asks.
   */
  totpSecrets?: TotpSecrets | undefined;
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

    const totpCodes: TotpCodeIssuer = new TotpCodeIssuer({
      secrets: options.totpSecrets || {},
    });

    try {
      let result: ReturnResult | null = null;

      try {
        /*
         * Filled in before the clock starts: a wait for a code about to
         * expire is OneUptime's, not the script's.
         */
        const script: string = totpCodes.hasSecrets()
          ? await totpCodes.fill(options.script)
          : options.script;
        const waitedBeforeRunInMs: number = totpCodes.getWaitedInMs();

        const startTime: [number, number] = process.hrtime();

        // Log proxy status for custom code monitoring
        if (ProxyConfig.isProxyConfigured()) {
          logger.debug(
            `Custom Code Monitor - HTTP proxy: ${ProxyConfig.getHttpProxyUrl()}, HTTPS proxy: ${ProxyConfig.getHttpsProxyUrl()}`,
          );
        }

        result = await VMRunner.runCodeInSandbox({
          code: script,
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
            /*
             * Same rule as the HTTP monitors (HttpMonitorRequest): a script on
             * a shared probe must not learn whether a name resolved and where
             * to, or it can enumerate the probe's internal DNS.
             */
            includeResolutionDetailInError: false,
            totpCodes,
          },
        });

        const endTime: [number, number] = process.hrtime(startTime);

        const executionTimeInMS: number = Math.ceil(
          (endTime[0] * 1000000000 + endTime[1]) / 1000000,
        );

        // Waits the script made for codes about to expire are left out too.
        scriptResult.executionTimeInMS = Math.max(
          0,
          executionTimeInMS - (totpCodes.getWaitedInMs() - waitedBeforeRunInMs),
        );

        /*
         * Every code the check made is taken out of what it reports (issue
         * #9703): its logs, metrics, returned data and error.
         */
        result = CustomCodeMonitor.withoutTotpCodes(result, totpCodes);

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
        const message: string = totpCodes.redact(
          (err as Error)?.message || (err as Error).toString(),
        );
        logger.error(message);
        scriptResult.scriptError = message;
      }

      return scriptResult;
    } catch (err: unknown) {
      const message: string = totpCodes.redact(
        (err as Error)?.message || (err as Error).toString(),
      );
      logger.error(message);
      scriptResult.scriptError = message;
    }

    return scriptResult;
  }

  /*
   * A run's result with every one-time code the check made masked to its
   * own length: in its log messages, its metrics' names and attributes,
   * its returned data and its error.
   */
  private static withoutTotpCodes(
    result: ReturnResult,
    totpCodes: TotpCodeIssuer,
  ): ReturnResult {
    if (totpCodes.getIssuedCodes().length === 0) {
      return result;
    }

    const redacted: ReturnResult = {
      ...result,
      returnValue: totpCodes.redact(result.returnValue),
      logMessages: totpCodes.redact(result.logMessages),
      capturedMetrics: (result.capturedMetrics || []).map(
        (metric: CapturedMetric): CapturedMetric => {
          return {
            ...metric,
            name: totpCodes.redact(metric.name),
            attributes: metric.attributes
              ? totpCodes.redact(metric.attributes)
              : undefined,
          };
        },
      ),
    };

    if (result.scriptError) {
      const error: Error = new Error(
        totpCodes.redact(result.scriptError.message || ""),
      );
      error.name = result.scriptError.name;
      redacted.scriptError = error;
    }

    return redacted;
  }
}
