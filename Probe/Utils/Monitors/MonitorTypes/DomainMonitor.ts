import OnlineCheck from "../../OnlineCheck";
import logger from "Common/Server/Utils/Logger";
import ObjectID from "Common/Types/ObjectID";
import ProbeAttempt from "Common/Types/Probe/ProbeAttempt";
import Sleep from "Common/Types/Sleep";
import MonitorStepDomainMonitor from "Common/Types/Monitor/MonitorStepDomainMonitor";
import DomainLookupMethod from "Common/Types/Monitor/DomainMonitor/DomainLookupMethod";
import DomainMonitorResponse from "Common/Types/Monitor/DomainMonitor/DomainMonitorResponse";
import DomainNameUtil from "../../Domain/DomainName";
import {
  DomainLookupErrorUtil,
  DomainLookupUnsupportedError,
  DomainNotFoundError,
} from "../../Domain/DomainLookupError";
import { DomainLookupResult, DomainRecord } from "../../Domain/DomainRecord";
import RdapLookup, { RdapLookupResult } from "../../Domain/RdapLookup";
import WhoisLookup from "../../Domain/WhoisLookup";

export interface DomainQueryOptions {
  timeout?: number | undefined;
  retry?: number | undefined;
  currentRetryCount?: number | undefined;
  monitorId?: ObjectID | undefined;
  isOnlineCheckRequest?: boolean | undefined;
  attempts?: Array<ProbeAttempt> | undefined;
}

export const DEFAULT_DOMAIN_QUERY_TIMEOUT_IN_MS: number = 10000;

export default class DomainMonitorUtil {
  public static async query(
    config: MonitorStepDomainMonitor,
    options?: DomainQueryOptions,
  ): Promise<DomainMonitorResponse | null> {
    if (!options) {
      options = {};
    }

    if (options.currentRetryCount === undefined) {
      options.currentRetryCount = 1;
    }

    if (!options.attempts) {
      options.attempts = [];
    }

    const lookupMethod: DomainLookupMethod =
      DomainMonitorUtil.getLookupMethod(config);

    const domainName: string = DomainNameUtil.normalize(config.domainName);

    logger.debug(
      `Domain Query: ${options.monitorId?.toString()} ${domainName} - Method: ${lookupMethod} - Retry: ${options.currentRetryCount}`,
    );

    const startTime: [number, number] = process.hrtime();
    const attemptedAt: Date = new Date();

    /*
     * A malformed name is a configuration mistake. Reporting it straight away
     * beats spending three network round trips discovering the same thing.
     */
    if (!DomainNameUtil.isValid(domainName)) {
      return {
        isOnline: false,
        isTimeout: false,
        responseTimeInMs: 0,
        failureCause: `"${config.domainName}" is not a valid domain name.`,
        domainName: domainName || config.domainName,
        lookupMethod: lookupMethod,
        probeAttempts: options.attempts,
        totalAttempts: options.attempts.length,
      };
    }

    try {
      const lookupResult: DomainLookupResult = await DomainMonitorUtil.lookup({
        domainName: domainName,
        lookupMethod: lookupMethod,
        timeoutInMs:
          options.timeout ||
          config.timeout ||
          DEFAULT_DOMAIN_QUERY_TIMEOUT_IN_MS,
      });

      const responseTimeInMs: number =
        DomainMonitorUtil.getElapsedInMs(startTime);

      options.attempts.push({
        attemptNumber: options.currentRetryCount,
        attemptedAt,
        responseReceivedAt: new Date(),
        responseTimeInMs,
        isOnline: true,
      });

      logger.debug(
        `Domain Query success: ${options.monitorId?.toString()} ${domainName} - Method: ${lookupResult.lookupMethod}${
          lookupResult.rdapServerUrl ? ` (${lookupResult.rdapServerUrl})` : ""
        } - Response Time: ${responseTimeInMs}ms`,
      );

      const record: DomainRecord = lookupResult.record;

      return {
        isOnline: true,
        /*
         * Explicitly false, not absent: criteria compare booleans, and an
         * undefined isTimeout makes an "Is Request Timeout / False" filter
         * undecidable, which under FilterCondition.All would stop the
         * monitor ever going back online.
         */
        isTimeout: false,
        responseTimeInMs: responseTimeInMs,
        failureCause: "",
        domainName: record.domainName || domainName,
        registrar: record.registrar,
        registrarUrl: record.registrarUrl,
        createdDate: record.createdDate,
        updatedDate: record.updatedDate,
        expiresDate: record.expiresDate,
        nameServers: record.nameServers,
        dnssec: record.dnssec,
        domainStatus: record.domainStatus,
        lookupMethod: lookupResult.lookupMethod,
        probeAttempts: options.attempts,
        totalAttempts: options.attempts.length,
      };
    } catch (err: unknown) {
      const responseTimeInMs: number =
        DomainMonitorUtil.getElapsedInMs(startTime);

      const failureCause: string = DomainLookupErrorUtil.getMessage(err);
      const isTimeout: boolean = DomainLookupErrorUtil.isTimeout(err);
      const isRetryable: boolean = DomainLookupErrorUtil.isRetryable(err);

      logger.debug(
        `Domain Query error: ${options.monitorId?.toString()} ${domainName} - ${failureCause}`,
      );

      options.attempts.push({
        attemptNumber: options.currentRetryCount || 1,
        attemptedAt,
        responseReceivedAt: new Date(),
        responseTimeInMs,
        isOnline: false,
        failureCause: failureCause,
      });

      /*
       * ?? not ||: a caller asking for zero retries means zero, not "fall
       * through to the config default".
       */
      const maxRetries: number = options.retry ?? config.retries ?? 3;

      /*
       * "This domain is not registered" and "this TLD has no usable
       * registration service" are settled answers. Retrying them just adds
       * one second of sleep per attempt before reporting the same thing.
       */
      if (isRetryable && options.currentRetryCount < maxRetries) {
        options.currentRetryCount++;
        await Sleep.sleep(1000);
        return await DomainMonitorUtil.query(config, options);
      }

      /*
       * The probe-connectivity gate only applies to failures that could have
       * been caused by the probe's own network. A registry that answered
       * "not registered" has already proved the network works, and dropping
       * that result would hide the very failure we are trying to report.
       */
      if (isRetryable && !options.isOnlineCheckRequest) {
        if (!(await OnlineCheck.canProbeMonitorWebsiteMonitors())) {
          logger.error(
            `DomainMonitor - Probe is not online. Cannot query ${options.monitorId?.toString()} ${domainName} - ERROR: ${failureCause}`,
          );
          return null;
        }
      }

      return {
        isOnline: false,
        isTimeout: isTimeout,
        responseTimeInMs: responseTimeInMs,
        failureCause: isTimeout
          ? `Request was tried ${options.currentRetryCount} times and it timed out.`
          : failureCause,
        domainName: domainName,
        lookupMethod: lookupMethod,
        probeAttempts: options.attempts,
        totalAttempts: options.attempts.length,
      };
    }
  }

  public static getLookupMethod(
    config: MonitorStepDomainMonitor,
  ): DomainLookupMethod {
    const values: Array<string> = Object.values(DomainLookupMethod);

    /*
     * Monitors created before RDAP support existed carry no lookupMethod,
     * and MonitorStep deserialization has historically handed the probe the
     * raw JSON - so this cannot assume the field is populated.
     */
    if (config.lookupMethod && values.includes(config.lookupMethod)) {
      return config.lookupMethod;
    }

    return DomainLookupMethod.Auto;
  }

  private static async lookup(input: {
    domainName: string;
    lookupMethod: DomainLookupMethod;
    timeoutInMs: number;
  }): Promise<DomainLookupResult> {
    const { domainName, lookupMethod, timeoutInMs } = input;

    if (lookupMethod === DomainLookupMethod.WHOIS) {
      return {
        record: await WhoisLookup.lookup(domainName, {
          timeoutInMs: timeoutInMs,
        }),
        lookupMethod: DomainLookupMethod.WHOIS,
      };
    }

    if (lookupMethod === DomainLookupMethod.RDAP) {
      const result: RdapLookupResult = await RdapLookup.lookup(domainName, {
        timeoutInMs: timeoutInMs,
      });

      return {
        record: result.record,
        lookupMethod: DomainLookupMethod.RDAP,
        rdapServerUrl: result.rdapServerUrl,
      };
    }

    return await DomainMonitorUtil.lookupAuto(domainName, timeoutInMs);
  }

  /*
   * RDAP first, WHOIS second. RDAP is discovered from IANA so it stays
   * correct as registries move, but roughly half the ccTLDs publish no RDAP
   * service at all - for those the bootstrap lookup returns nothing and
   * WHOIS is the only option. Both are tried inside a single attempt so the
   * retry budget is not doubled.
   */
  private static async lookupAuto(
    domainName: string,
    timeoutInMs: number,
  ): Promise<DomainLookupResult> {
    let rdapError: unknown = null;

    try {
      const result: RdapLookupResult = await RdapLookup.lookup(domainName, {
        timeoutInMs: timeoutInMs,
      });

      return {
        record: result.record,
        lookupMethod: DomainLookupMethod.RDAP,
        rdapServerUrl: result.rdapServerUrl,
      };
    } catch (err: unknown) {
      /*
       * The registry's own RDAP service is authoritative about whether a
       * domain exists. Asking WHOIS for a second opinion would only turn a
       * clear answer into a vague one.
       */
      if (err instanceof DomainNotFoundError) {
        throw err;
      }

      rdapError = err;

      logger.debug(
        `RDAP lookup for ${domainName} did not produce a record, falling back to WHOIS: ${DomainLookupErrorUtil.getMessage(
          err,
        )}`,
      );
    }

    try {
      return {
        record: await WhoisLookup.lookup(domainName, {
          timeoutInMs: timeoutInMs,
        }),
        lookupMethod: DomainLookupMethod.WHOIS,
      };
    } catch (whoisError: unknown) {
      throw DomainMonitorUtil.combineAutoFailures({
        domainName,
        rdapError,
        whoisError,
      });
    }
  }

  /*
   * When both protocols fail the operator needs to see both reasons - "WHOIS
   * returned nothing" on its own does not explain why RDAP was not used.
   */
  private static combineAutoFailures(input: {
    domainName: string;
    rdapError: unknown;
    whoisError: unknown;
  }): Error {
    const rdapMessage: string = DomainLookupErrorUtil.getMessage(
      input.rdapError,
    );
    const whoisMessage: string = DomainLookupErrorUtil.getMessage(
      input.whoisError,
    );

    const message: string = `Could not read registration data for ${input.domainName}. RDAP: ${rdapMessage} WHOIS: ${whoisMessage}`;

    const bothPermanent: boolean =
      !DomainLookupErrorUtil.isRetryable(input.rdapError) &&
      !DomainLookupErrorUtil.isRetryable(input.whoisError);

    if (bothPermanent) {
      return new DomainLookupUnsupportedError(message);
    }

    return new Error(message);
  }

  private static getElapsedInMs(startTime: [number, number]): number {
    const endTime: [number, number] = process.hrtime(startTime);

    return Math.ceil((endTime[0] * 1000000000 + endTime[1]) / 1000000);
  }
}
