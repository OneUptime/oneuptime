import OnlineCheck from "../../OnlineCheck";
import logger from "Common/Server/Utils/Logger";
import ObjectID from "Common/Types/ObjectID";
import ProbeAttempt from "Common/Types/Probe/ProbeAttempt";
import Sleep from "Common/Types/Sleep";
import MonitorStepDnssecMonitor from "Common/Types/Monitor/MonitorStepDnssecMonitor";
import DnssecMonitorResponse, {
  DnssecDsRecord,
  DnssecKeyRecord,
  DnssecNameserverCheck,
  DnssecResolverCheck,
  DnssecRrsigRecord,
} from "Common/Types/Monitor/DnssecMonitor/DnssecMonitorResponse";
import { execFile } from "child_process";

export interface DnssecQueryOptions {
  timeout?: number | undefined;
  retry?: number | undefined;
  currentRetryCount?: number | undefined;
  monitorId?: ObjectID | undefined;
  isOnlineCheckRequest?: boolean | undefined;
  attempts?: Array<ProbeAttempt> | undefined;
}

/*
 * A DNSSEC check is not one query: it is DNSKEY, DS, RRSIG, one dig per
 * configured resolver, then an NS sweep with one dig per nameserver. Handing
 * every one of those legs the full per-query timeout meant a check against an
 * unresponsive resolver could run for minutes - with retries on top of that.
 * The legs therefore share a single deadline: one attempt gets at most the
 * per-leg timeout multiplied by this factor.
 */
const DNSSEC_TOTAL_TIMEOUT_MULTIPLIER: number = 3;

interface DnssecTimeBudget {
  perLegTimeoutMs: number;
  deadlineAt: number;
  // Set when a leg had to be skipped because the deadline had passed.
  ranOutOfTime: boolean;
}

interface DigOptions {
  digFlags?: Array<string>;
  resolver?: string | undefined;
  timeoutMs: number;
}

interface DigResult {
  stdout: string;
  status: string;
  flags: Array<string>;
  answers: Array<string>;
}

export default class DnssecMonitorUtil {
  public static async query(
    config: MonitorStepDnssecMonitor,
    options?: DnssecQueryOptions,
  ): Promise<DnssecMonitorResponse | null> {
    if (!options) {
      options = {};
    }

    if (options.currentRetryCount === undefined) {
      options.currentRetryCount = 1;
    }

    if (!options.attempts) {
      options.attempts = [];
    }

    logger.debug(
      `DNSSEC Query: ${options.monitorId?.toString()} ${config.domainName} - Retry: ${options.currentRetryCount}`,
    );

    const startTime: [number, number] = process.hrtime();
    const attemptedAt: Date = new Date();
    const domainName: string = config.domainName.trim();

    if (!DnssecMonitorUtil.isValidHostname(domainName)) {
      return DnssecMonitorUtil.buildFailureResponse({
        domainName: domainName,
        responseTimeInMs: 0,
        failureCause: `Invalid domain name: ${domainName}`,
      });
    }

    /*
     * Defence in depth alongside the normalization in
     * MonitorStep.fromJSON: iterating an absent resolver list threw a
     * TypeError that escaped before any result could be posted, so the
     * monitor silently produced nothing. Report the misconfiguration
     * instead of throwing.
     */
    if (!config.resolvers || config.resolvers.length === 0) {
      return DnssecMonitorUtil.buildFailureResponse({
        domainName: domainName,
        responseTimeInMs: 0,
        failureCause:
          "No DNS resolvers are configured for this DNSSEC monitor.",
      });
    }

    for (const resolver of config.resolvers) {
      if (!DnssecMonitorUtil.isValidHostnameOrIP(resolver)) {
        return DnssecMonitorUtil.buildFailureResponse({
          domainName: domainName,
          responseTimeInMs: 0,
          failureCause: `Invalid resolver: ${resolver}`,
        });
      }
    }

    try {
      /*
       * An explicitly supplied options.timeout is the caller's per-step
       * setting and outranks the config default. Reading config.timeout
       * first silently dropped whatever the step asked for.
       */
      const timeoutMs: number = options.timeout || config.timeout || 10000;
      const budget: DnssecTimeBudget =
        DnssecMonitorUtil.createTimeBudget(timeoutMs);
      const defaultResolver: string = config.resolvers[0] || "1.1.1.1";

      const dnskeys: Array<DnssecKeyRecord> =
        await DnssecMonitorUtil.fetchDnskeys(
          domainName,
          defaultResolver,
          budget,
        );

      const parentDsRecords: Array<DnssecDsRecord> =
        await DnssecMonitorUtil.fetchParentDs(
          domainName,
          defaultResolver,
          budget,
        );

      const rrsigs: Array<DnssecRrsigRecord> =
        await DnssecMonitorUtil.fetchRrsigs(
          domainName,
          defaultResolver,
          budget,
        );

      const earliestExpiry: Date | undefined =
        DnssecMonitorUtil.earliestRrsigExpiration(rrsigs);

      const resolverChecks: Array<DnssecResolverCheck> =
        await DnssecMonitorUtil.checkResolvers(
          domainName,
          config.resolvers,
          budget,
        );

      let nameserverChecks: Array<DnssecNameserverCheck> = [];
      if (config.checkNameserverConsistency) {
        nameserverChecks = await DnssecMonitorUtil.checkNameserverConsistency(
          domainName,
          defaultResolver,
          budget,
        );
      }

      const endTime: [number, number] = process.hrtime(startTime);
      const responseTimeInMs: number = Math.ceil(
        (endTime[0] * 1000000000 + endTime[1]) / 1000000,
      );

      /*
       * At least one leg never ran, so the record set is incomplete. Saying
       * "zone not signed" or "resolvers disagree" off a partial sweep would
       * be a fabricated DNSSEC verdict - report the timeout that actually
       * happened instead. Not retried: the attempt already consumed a full
       * budget, so another one would only spend the same time again.
       */
      if (budget.ranOutOfTime) {
        const responseReceivedAt: Date = new Date();
        const failureCause: string = `DNSSEC check did not finish within its overall budget of ${
          timeoutMs * DNSSEC_TOTAL_TIMEOUT_MULTIPLIER
        }ms.`;

        options.attempts.push({
          attemptNumber: options.currentRetryCount,
          attemptedAt,
          responseReceivedAt,
          responseTimeInMs,
          isOnline: false,
          failureCause: failureCause,
        });

        return DnssecMonitorUtil.buildFailureResponse({
          domainName: domainName,
          responseTimeInMs: responseTimeInMs,
          failureCause: failureCause,
          isTimeout: true,
          probeAttempts: options.attempts,
          totalAttempts: options.attempts.length,
        });
      }

      const isZoneSigned: boolean = dnskeys.length > 0;
      const isParentDsPresent: boolean = parentDsRecords.length > 0;
      const resolverConsensusAd: boolean =
        resolverChecks.length > 0 &&
        resolverChecks.every((check: DnssecResolverCheck) => {
          return check.adFlag;
        });

      const isNameserverConsistent: boolean =
        DnssecMonitorUtil.areNameserversConsistent(nameserverChecks);

      const daysUntilSignatureExpiry: number | undefined = earliestExpiry
        ? Math.floor(
            (earliestExpiry.getTime() - Date.now()) / (1000 * 60 * 60 * 24),
          )
        : undefined;

      const isChainValid: boolean =
        isZoneSigned &&
        isParentDsPresent &&
        rrsigs.length > 0 &&
        resolverConsensusAd &&
        (daysUntilSignatureExpiry === undefined ||
          daysUntilSignatureExpiry > 0);

      logger.debug(
        `DNSSEC Query success: ${options.monitorId?.toString()} ${domainName} - Response Time: ${responseTimeInMs}ms`,
      );

      const responseReceivedAt: Date = new Date();
      options.attempts.push({
        attemptNumber: options.currentRetryCount,
        attemptedAt,
        responseReceivedAt,
        responseTimeInMs,
        isOnline: true,
      });

      return {
        isOnline: true,
        responseTimeInMs: responseTimeInMs,
        failureCause: "",
        domainName: domainName,
        isZoneSigned: isZoneSigned,
        dnskeys: dnskeys,
        parentDsRecords: parentDsRecords,
        isParentDsPresent: isParentDsPresent,
        rrsigs: rrsigs,
        earliestSignatureExpiration: earliestExpiry
          ? earliestExpiry.toISOString()
          : undefined,
        daysUntilSignatureExpiry: daysUntilSignatureExpiry,
        resolverChecks: resolverChecks,
        resolverConsensusAd: resolverConsensusAd,
        nameserverChecks: nameserverChecks,
        isNameserverConsistent: isNameserverConsistent,
        isChainValid: isChainValid,
        probeAttempts: options.attempts,
        totalAttempts: options.attempts.length,
      };
    } catch (err: unknown) {
      logger.debug(
        `DNSSEC Query error: ${options.monitorId?.toString()} ${domainName}`,
      );
      logger.debug(err);

      if (!options.currentRetryCount) {
        options.currentRetryCount = 0;
      }

      if (!options.attempts) {
        options.attempts = [];
      }

      const endTime: [number, number] = process.hrtime(startTime);
      const responseTimeInMs: number = Math.ceil(
        (endTime[0] * 1000000000 + endTime[1]) / 1000000,
      );

      const responseReceivedAt: Date = new Date();
      options.attempts.push({
        attemptNumber: options.currentRetryCount || 1,
        attemptedAt,
        responseReceivedAt,
        responseTimeInMs,
        isOnline: false,
        failureCause: (err as Error).message || (err as Error).toString(),
      });

      /*
       * ?? not ||: a caller asking for zero retries means zero, not "fall
       * through to the config default".
       */
      if (options.currentRetryCount < (options.retry ?? config.retries ?? 3)) {
        options.currentRetryCount++;
        await Sleep.sleep(1000);
        return await DnssecMonitorUtil.query(config, options);
      }

      if (!options.isOnlineCheckRequest) {
        if (!(await OnlineCheck.canProbeMonitorWebsiteMonitors())) {
          logger.error(
            `DnssecMonitor - Probe is not online. Cannot query ${options.monitorId?.toString()} ${domainName} - ERROR: ${err}`,
          );
          return null;
        }
      }

      const isTimeout: boolean =
        (err as Error).message?.toLowerCase().includes("timeout") ||
        (err as Error).message?.toLowerCase().includes("timed out") ||
        (err as Error).message?.toLowerCase().includes("etimeout");

      return DnssecMonitorUtil.buildFailureResponse({
        domainName: domainName,
        responseTimeInMs: responseTimeInMs,
        failureCause: (err as Error).message || (err as Error).toString() || "",
        isTimeout: isTimeout,
        probeAttempts: options.attempts,
        totalAttempts: options.attempts.length,
      });
    }
  }

  private static createTimeBudget(perLegTimeoutMs: number): DnssecTimeBudget {
    return {
      perLegTimeoutMs: perLegTimeoutMs,
      deadlineAt:
        Date.now() + perLegTimeoutMs * DNSSEC_TOTAL_TIMEOUT_MULTIPLIER,
      ranOutOfTime: false,
    };
  }

  /*
   * How long the next dig may take: never more than the per-leg timeout, and
   * never more than the shared deadline has left. Returns null once the
   * deadline has passed, which is the caller's signal to stop issuing digs.
   */
  private static nextLegTimeoutMs(budget: DnssecTimeBudget): number | null {
    const remainingMs: number = budget.deadlineAt - Date.now();

    if (remainingMs <= 0) {
      budget.ranOutOfTime = true;
      return null;
    }

    return Math.min(budget.perLegTimeoutMs, remainingMs);
  }

  private static buildFailureResponse(arg: {
    domainName: string;
    responseTimeInMs: number;
    failureCause: string;
    isTimeout?: boolean;
    probeAttempts?: Array<ProbeAttempt> | undefined;
    totalAttempts?: number | undefined;
  }): DnssecMonitorResponse {
    return {
      isOnline: false,
      responseTimeInMs: arg.responseTimeInMs,
      failureCause: arg.failureCause,
      domainName: arg.domainName,
      isTimeout: arg.isTimeout,
      isZoneSigned: false,
      dnskeys: [],
      parentDsRecords: [],
      isParentDsPresent: false,
      rrsigs: [],
      resolverChecks: [],
      resolverConsensusAd: false,
      nameserverChecks: [],
      isNameserverConsistent: false,
      isChainValid: false,
      probeAttempts: arg.probeAttempts,
      totalAttempts: arg.totalAttempts,
    };
  }

  private static isValidHostname(value: string): boolean {
    if (!value || value.length === 0 || value.length > 253) {
      return false;
    }
    const hostnamePattern: RegExp =
      /^[a-zA-Z0-9]([a-zA-Z0-9\-.]*[a-zA-Z0-9])?$/;
    return hostnamePattern.test(value);
  }

  private static isValidHostnameOrIP(value: string): boolean {
    if (!value || value.length === 0 || value.length > 253) {
      return false;
    }
    const ipv4Pattern: RegExp = /^(\d{1,3}\.){3}\d{1,3}$/;
    const ipv6Pattern: RegExp =
      /^([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$|^::$|^([0-9a-fA-F]{1,4}:)*:([0-9a-fA-F]{1,4}:)*[0-9a-fA-F]{1,4}$/;
    if (ipv4Pattern.test(value) || ipv6Pattern.test(value)) {
      return true;
    }
    return DnssecMonitorUtil.isValidHostname(value);
  }

  private static dig(
    queryName: string,
    queryType: string,
    options: DigOptions,
  ): Promise<DigResult> {
    return new Promise(
      (
        resolve: (value: DigResult) => void,
        reject: (err: Error) => void,
      ): void => {
        const args: Array<string> = [];
        if (options.digFlags) {
          args.push(...options.digFlags);
        }
        args.push(queryName, queryType);
        if (options.resolver) {
          args.push(`@${options.resolver}`);
        }

        execFile(
          "dig",
          args,
          { timeout: options.timeoutMs },
          (error: Error | null, stdout: string) => {
            if (error) {
              reject(error);
              return;
            }

            const parsed: DigResult = DnssecMonitorUtil.parseDigOutput(stdout);
            resolve(parsed);
          },
        );
      },
    );
  }

  private static parseDigOutput(stdout: string): DigResult {
    const statusMatch: RegExpMatchArray | null =
      stdout.match(/status:\s*([A-Z]+)/i);
    const flagsMatch: RegExpMatchArray | null =
      stdout.match(/flags:\s*([^;]+);/i);

    const status: string = statusMatch ? statusMatch[1]!.toUpperCase() : "";
    const flags: Array<string> = flagsMatch
      ? flagsMatch[1]!.trim().split(/\s+/).filter(Boolean)
      : [];

    const answers: Array<string> = [];
    const answerSectionIdx: number = stdout.indexOf(";; ANSWER SECTION:");
    if (answerSectionIdx >= 0) {
      const afterAnswer: string = stdout.slice(answerSectionIdx);
      const lines: Array<string> = afterAnswer.split("\n");
      for (const line of lines) {
        const trimmed: string = line.trim();
        if (!trimmed || trimmed.startsWith(";") || trimmed.startsWith(";;")) {
          continue;
        }
        if (trimmed.length === 0) {
          break;
        }
        answers.push(trimmed);
      }
    }

    return {
      stdout: stdout,
      status: status,
      flags: flags,
      answers: answers,
    };
  }

  private static async fetchDnskeys(
    domainName: string,
    resolver: string,
    budget: DnssecTimeBudget,
  ): Promise<Array<DnssecKeyRecord>> {
    const timeoutMs: number | null = DnssecMonitorUtil.nextLegTimeoutMs(budget);
    if (timeoutMs === null) {
      return [];
    }

    try {
      const result: DigResult = await DnssecMonitorUtil.dig(
        domainName,
        "DNSKEY",
        {
          digFlags: ["+dnssec", "+short"],
          resolver: resolver,
          timeoutMs: timeoutMs,
        },
      );

      const keys: Array<DnssecKeyRecord> = [];
      for (const line of result.stdout.split("\n")) {
        const trimmed: string = line.trim();
        if (!trimmed || trimmed.startsWith(";")) {
          continue;
        }
        // Short-form DNSKEY: "<flags> <protocol> <algo> <pubkey...>"
        const parts: Array<string> = trimmed.split(/\s+/);
        if (parts.length < 4) {
          continue;
        }
        const flagsNum: number = Number(parts[0]);
        const algoNum: number = Number(parts[2]);
        if (Number.isNaN(flagsNum) || Number.isNaN(algoNum)) {
          continue;
        }
        keys.push({
          flags: flagsNum,
          algorithm: algoNum,
        });
      }
      return keys;
    } catch (err: unknown) {
      logger.debug(`DNSSEC DNSKEY fetch failed for ${domainName}: ${err}`);
      return [];
    }
  }

  private static async fetchParentDs(
    domainName: string,
    resolver: string,
    budget: DnssecTimeBudget,
  ): Promise<Array<DnssecDsRecord>> {
    const timeoutMs: number | null = DnssecMonitorUtil.nextLegTimeoutMs(budget);
    if (timeoutMs === null) {
      return [];
    }

    try {
      const result: DigResult = await DnssecMonitorUtil.dig(domainName, "DS", {
        digFlags: ["+dnssec", "+short"],
        resolver: resolver,
        timeoutMs: timeoutMs,
      });

      const ds: Array<DnssecDsRecord> = [];
      for (const line of result.stdout.split("\n")) {
        const trimmed: string = line.trim();
        if (!trimmed || trimmed.startsWith(";")) {
          continue;
        }
        const parts: Array<string> = trimmed.split(/\s+/);
        if (parts.length < 4) {
          continue;
        }
        const keyTag: number = Number(parts[0]);
        const algorithm: number = Number(parts[1]);
        const digestType: number = Number(parts[2]);
        if (
          Number.isNaN(keyTag) ||
          Number.isNaN(algorithm) ||
          Number.isNaN(digestType)
        ) {
          continue;
        }
        ds.push({
          keyTag: keyTag,
          algorithm: algorithm,
          digestType: digestType,
          digest: parts.slice(3).join(""),
        });
      }
      return ds;
    } catch (err: unknown) {
      logger.debug(`DNSSEC DS fetch failed for ${domainName}: ${err}`);
      return [];
    }
  }

  private static async fetchRrsigs(
    domainName: string,
    resolver: string,
    budget: DnssecTimeBudget,
  ): Promise<Array<DnssecRrsigRecord>> {
    const timeoutMs: number | null = DnssecMonitorUtil.nextLegTimeoutMs(budget);
    if (timeoutMs === null) {
      return [];
    }

    try {
      // Ask for SOA + DNSSEC; the authoritative answer set includes RRSIG records.
      const result: DigResult = await DnssecMonitorUtil.dig(domainName, "SOA", {
        digFlags: ["+dnssec"],
        resolver: resolver,
        timeoutMs: timeoutMs,
      });

      const rrsigs: Array<DnssecRrsigRecord> = [];
      for (const line of result.answers) {
        const parts: Array<string> = line.split(/\s+/);
        if (parts.length < 10) {
          continue;
        }
        // Format: name TTL class RRSIG type algo labels origTtl expiration inception keyTag signer ...
        const recordType: string | undefined = parts[3];
        if (recordType !== "RRSIG") {
          continue;
        }
        rrsigs.push({
          typeCovered: parts[4] || "",
          algorithm: Number(parts[5]) || 0,
          signerName: parts[11] || "",
          keyTag: Number(parts[10]) || 0,
          expiration: DnssecMonitorUtil.parseDigTimestamp(parts[8]),
          inception: DnssecMonitorUtil.parseDigTimestamp(parts[9]),
        });
      }

      return rrsigs;
    } catch (err: unknown) {
      logger.debug(`DNSSEC RRSIG fetch failed for ${domainName}: ${err}`);
      return [];
    }
  }

  // dig prints timestamps as YYYYMMDDHHMMSS in UTC.
  private static parseDigTimestamp(
    value: string | undefined,
  ): string | undefined {
    if (!value || value.length < 14) {
      return undefined;
    }
    const year: string = value.slice(0, 4);
    const month: string = value.slice(4, 6);
    const day: string = value.slice(6, 8);
    const hour: string = value.slice(8, 10);
    const minute: string = value.slice(10, 12);
    const second: string = value.slice(12, 14);
    const iso: string = `${year}-${month}-${day}T${hour}:${minute}:${second}Z`;
    const date: Date = new Date(iso);
    if (Number.isNaN(date.getTime())) {
      return undefined;
    }
    return date.toISOString();
  }

  private static earliestRrsigExpiration(
    rrsigs: Array<DnssecRrsigRecord>,
  ): Date | undefined {
    let earliest: Date | undefined = undefined;
    for (const sig of rrsigs) {
      if (!sig.expiration) {
        continue;
      }
      const d: Date = new Date(sig.expiration);
      if (Number.isNaN(d.getTime())) {
        continue;
      }
      if (!earliest || d.getTime() < earliest.getTime()) {
        earliest = d;
      }
    }
    return earliest;
  }

  private static async checkResolvers(
    domainName: string,
    resolvers: Array<string>,
    budget: DnssecTimeBudget,
  ): Promise<Array<DnssecResolverCheck>> {
    const checks: Array<DnssecResolverCheck> = [];

    for (const resolver of resolvers) {
      /*
       * One slow resolver used to cost a full timeout each for every
       * resolver behind it. Once the shared deadline is gone we stop; the
       * caller turns the truncated sweep into a timeout verdict.
       */
      const timeoutMs: number | null =
        DnssecMonitorUtil.nextLegTimeoutMs(budget);
      if (timeoutMs === null) {
        break;
      }

      try {
        // With CD=0 the resolver validates and SERVFAILs on bogus.
        const validating: DigResult = await DnssecMonitorUtil.dig(
          domainName,
          "A",
          {
            digFlags: ["+dnssec", "+nocdflag"],
            resolver: resolver,
            timeoutMs: timeoutMs,
          },
        );

        const servfail: boolean = validating.status === "SERVFAIL";
        const adFlag: boolean = validating.flags
          .map((f: string) => {
            return f.toLowerCase();
          })
          .includes("ad");

        checks.push({
          resolver: resolver,
          adFlag: adFlag,
          servfailWhenValidating: servfail,
        });
      } catch (err: unknown) {
        checks.push({
          resolver: resolver,
          adFlag: false,
          servfailWhenValidating: false,
          error: (err as Error).message || (err as Error).toString(),
        });
      }
    }

    return checks;
  }

  private static async checkNameserverConsistency(
    domainName: string,
    resolver: string,
    budget: DnssecTimeBudget,
  ): Promise<Array<DnssecNameserverCheck>> {
    const enumerationTimeoutMs: number | null =
      DnssecMonitorUtil.nextLegTimeoutMs(budget);
    if (enumerationTimeoutMs === null) {
      return [];
    }

    let nsList: Array<string> = [];
    try {
      const nsResult: DigResult = await DnssecMonitorUtil.dig(
        domainName,
        "NS",
        {
          digFlags: ["+short"],
          resolver: resolver,
          timeoutMs: enumerationTimeoutMs,
        },
      );
      nsList = nsResult.stdout
        .split("\n")
        .map((s: string) => {
          return s.trim().replace(/\.$/, "");
        })
        .filter((s: string) => {
          return s.length > 0 && !s.startsWith(";");
        });
    } catch (err: unknown) {
      logger.debug(
        `DNSSEC nameserver enumeration failed for ${domainName}: ${err}`,
      );
      return [];
    }

    const results: Array<DnssecNameserverCheck> = [];
    for (const ns of nsList) {
      if (!DnssecMonitorUtil.isValidHostnameOrIP(ns)) {
        continue;
      }

      const timeoutMs: number | null =
        DnssecMonitorUtil.nextLegTimeoutMs(budget);
      if (timeoutMs === null) {
        break;
      }

      try {
        const soaResult: DigResult = await DnssecMonitorUtil.dig(
          domainName,
          "SOA",
          {
            digFlags: ["+dnssec", "+norecurse"],
            resolver: ns,
            timeoutMs: timeoutMs,
          },
        );

        let soaSerial: string | undefined = undefined;
        for (const line of soaResult.answers) {
          const parts: Array<string> = line.split(/\s+/);
          if (parts[3] === "SOA" && parts.length >= 8) {
            soaSerial = parts[6];
            break;
          }
        }

        let rrsigExpiration: string | undefined = undefined;
        for (const line of soaResult.answers) {
          const parts: Array<string> = line.split(/\s+/);
          if (parts[3] === "RRSIG" && parts.length >= 10) {
            rrsigExpiration = DnssecMonitorUtil.parseDigTimestamp(parts[8]);
            break;
          }
        }

        results.push({
          nameServer: ns,
          soaSerial: soaSerial,
          rrsigExpiration: rrsigExpiration,
        });
      } catch (err: unknown) {
        results.push({
          nameServer: ns,
          error: (err as Error).message || (err as Error).toString(),
        });
      }
    }

    return results;
  }

  private static areNameserversConsistent(
    checks: Array<DnssecNameserverCheck>,
  ): boolean {
    if (checks.length === 0) {
      return true;
    }

    const serials: Set<string> = new Set();
    let hasError: boolean = false;
    for (const c of checks) {
      if (c.error || !c.soaSerial) {
        hasError = true;
        continue;
      }
      serials.add(c.soaSerial);
    }
    if (hasError) {
      return false;
    }
    return serials.size <= 1;
  }
}
