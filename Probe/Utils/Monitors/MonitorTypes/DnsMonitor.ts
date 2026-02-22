import OnlineCheck from "../../OnlineCheck";
import logger from "Common/Server/Utils/Logger";
import ObjectID from "Common/Types/ObjectID";
import Sleep from "Common/Types/Sleep";
import MonitorStepDnsMonitor from "Common/Types/Monitor/MonitorStepDnsMonitor";
import DnsMonitorResponse, {
  DnsRecordResponse,
} from "Common/Types/Monitor/DnsMonitor/DnsMonitorResponse";
import DnsRecordType from "Common/Types/Monitor/DnsMonitor/DnsRecordType";
import dns from "dns";
import { execFile } from "child_process";

export interface DnsQueryOptions {
  timeout?: number | undefined;
  retry?: number | undefined;
  currentRetryCount?: number | undefined;
  monitorId?: ObjectID | undefined;
  isOnlineCheckRequest?: boolean | undefined;
}

export default class DnsMonitorUtil {
  public static async query(
    config: MonitorStepDnsMonitor,
    options?: DnsQueryOptions,
  ): Promise<DnsMonitorResponse | null> {
    if (!options) {
      options = {};
    }

    if (options?.currentRetryCount === undefined) {
      options.currentRetryCount = 1;
    }

    logger.debug(
      `DNS Query: ${options?.monitorId?.toString()} ${config.queryName} ${config.recordType} - Retry: ${options?.currentRetryCount}`,
    );

    const startTime: [number, number] = process.hrtime();

    try {
      const resolver: dns.promises.Resolver = new dns.promises.Resolver({
        timeout: config.timeout || 5000,
      });

      if (config.hostname) {
        const server: string =
          config.port && config.port !== 53
            ? `${config.hostname}:${config.port}`
            : config.hostname;
        resolver.setServers([server]);
      }

      const records: Array<DnsRecordResponse> =
        await DnsMonitorUtil.resolveRecords(
          resolver,
          config.queryName,
          config.recordType,
        );

      const endTime: [number, number] = process.hrtime(startTime);
      const responseTimeInMs: number = Math.ceil(
        (endTime[0] * 1000000000 + endTime[1]) / 1000000,
      );

      // Check DNSSEC
      let isDnssecValid: boolean | undefined = undefined;
      try {
        isDnssecValid = await DnsMonitorUtil.checkDnssec(
          config.queryName,
          config.recordType,
          config.hostname,
        );
      } catch (dnssecErr) {
        logger.debug(
          `DNSSEC check failed for ${config.queryName}: ${dnssecErr}`,
        );
        isDnssecValid = undefined;
      }

      logger.debug(
        `DNS Query success: ${options?.monitorId?.toString()} ${config.queryName} ${config.recordType} - Response Time: ${responseTimeInMs}ms`,
      );

      return {
        isOnline: true,
        responseTimeInMs: responseTimeInMs,
        failureCause: "",
        records: records,
        isDnssecValid: isDnssecValid,
      };
    } catch (err: unknown) {
      logger.debug(
        `DNS Query error: ${options?.monitorId?.toString()} ${config.queryName} ${config.recordType}`,
      );
      logger.debug(err);

      if (!options) {
        options = {};
      }

      if (!options.currentRetryCount) {
        options.currentRetryCount = 0;
      }

      if (options.currentRetryCount < (options.retry || config.retries || 3)) {
        options.currentRetryCount++;
        await Sleep.sleep(1000);
        return await DnsMonitorUtil.query(config, options);
      }

      // Check if the probe is online
      if (!options.isOnlineCheckRequest) {
        if (!(await OnlineCheck.canProbeMonitorWebsiteMonitors())) {
          logger.error(
            `DnsMonitor - Probe is not online. Cannot query ${options?.monitorId?.toString()} ${config.queryName} - ERROR: ${err}`,
          );
          return null;
        }
      }

      const endTime: [number, number] = process.hrtime(startTime);
      const responseTimeInMs: number = Math.ceil(
        (endTime[0] * 1000000000 + endTime[1]) / 1000000,
      );

      // Check if timeout
      const isTimeout: boolean =
        (err as Error).message?.toLowerCase().includes("timeout") ||
        (err as Error).message?.toLowerCase().includes("timed out") ||
        (err as Error).message?.toLowerCase().includes("etimeout");

      if (isTimeout) {
        return {
          isOnline: false,
          isTimeout: true,
          responseTimeInMs: responseTimeInMs,
          failureCause:
            "Request was tried " +
            options.currentRetryCount +
            " times and it timed out.",
          records: [],
        };
      }

      return {
        isOnline: false,
        isTimeout: false,
        responseTimeInMs: responseTimeInMs,
        failureCause: (err as Error).message || (err as Error).toString(),
        records: [],
      };
    }
  }

  private static async resolveRecords(
    resolver: dns.promises.Resolver,
    queryName: string,
    recordType: DnsRecordType,
  ): Promise<Array<DnsRecordResponse>> {
    const records: Array<DnsRecordResponse> = [];

    switch (recordType) {
      case DnsRecordType.A: {
        const results: Array<dns.RecordWithTtl> = await resolver.resolve4(
          queryName,
          { ttl: true },
        );
        for (const result of results) {
          records.push({
            type: DnsRecordType.A,
            value: result.address,
            ttl: result.ttl,
          });
        }
        break;
      }
      case DnsRecordType.AAAA: {
        const results: Array<dns.RecordWithTtl> = await resolver.resolve6(
          queryName,
          { ttl: true },
        );
        for (const result of results) {
          records.push({
            type: DnsRecordType.AAAA,
            value: result.address,
            ttl: result.ttl,
          });
        }
        break;
      }
      case DnsRecordType.CNAME: {
        const results: Array<string> = await resolver.resolveCname(queryName);
        for (const result of results) {
          records.push({
            type: DnsRecordType.CNAME,
            value: result,
          });
        }
        break;
      }
      case DnsRecordType.MX: {
        const results: Array<dns.MxRecord> =
          await resolver.resolveMx(queryName);
        for (const result of results) {
          records.push({
            type: DnsRecordType.MX,
            value: `${result.priority} ${result.exchange}`,
          });
        }
        break;
      }
      case DnsRecordType.NS: {
        const results: Array<string> = await resolver.resolveNs(queryName);
        for (const result of results) {
          records.push({
            type: DnsRecordType.NS,
            value: result,
          });
        }
        break;
      }
      case DnsRecordType.TXT: {
        const results: Array<Array<string>> =
          await resolver.resolveTxt(queryName);
        for (const result of results) {
          records.push({
            type: DnsRecordType.TXT,
            value: result.join(""),
          });
        }
        break;
      }
      case DnsRecordType.SOA: {
        const result: dns.SoaRecord = await resolver.resolveSoa(queryName);
        records.push({
          type: DnsRecordType.SOA,
          value: `${result.nsname} ${result.hostmaster} ${result.serial} ${result.refresh} ${result.retry} ${result.expire} ${result.minttl}`,
          ttl: result.minttl,
        });
        break;
      }
      case DnsRecordType.PTR: {
        const results: Array<string> = await resolver.resolvePtr(queryName);
        for (const result of results) {
          records.push({
            type: DnsRecordType.PTR,
            value: result,
          });
        }
        break;
      }
      case DnsRecordType.SRV: {
        const results: Array<dns.SrvRecord> =
          await resolver.resolveSrv(queryName);
        for (const result of results) {
          records.push({
            type: DnsRecordType.SRV,
            value: `${result.priority} ${result.weight} ${result.port} ${result.name}`,
          });
        }
        break;
      }
      case DnsRecordType.CAA: {
        // resolveCaa is not on the Resolver class type, use standalone function
        const results: Array<dns.CaaRecord> =
          await dns.promises.resolveCaa(queryName);
        for (const result of results) {
          records.push({
            type: DnsRecordType.CAA,
            value:
              `${result.critial} ${result.issue || result.issuewild || result.iodef || ""}`.trim(),
          });
        }
        break;
      }
    }

    return records;
  }

  private static isValidHostnameOrIP(value: string): boolean {
    if (!value || value.length === 0 || value.length > 253) {
      return false;
    }

    // IPv4
    const ipv4Pattern: RegExp = /^(\d{1,3}\.){3}\d{1,3}$/;
    // IPv6 (simplified)
    const ipv6Pattern: RegExp =
      /^([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$|^::$|^([0-9a-fA-F]{1,4}:)*:([0-9a-fA-F]{1,4}:)*[0-9a-fA-F]{1,4}$/;

    if (ipv4Pattern.test(value) || ipv6Pattern.test(value)) {
      return true;
    }

    // Hostname: only alphanumeric, hyphens, and dots allowed
    const hostnamePattern: RegExp =
      /^[a-zA-Z0-9]([a-zA-Z0-9\-.]*[a-zA-Z0-9])?$/;
    return hostnamePattern.test(value);
  }

  private static async checkDnssec(
    queryName: string,
    recordType: DnsRecordType,
    dnsServer?: string | undefined,
  ): Promise<boolean | undefined> {
    // Validate queryName to prevent argument injection
    if (!this.isValidHostnameOrIP(queryName)) {
      throw new Error(
        `Invalid query name: ${queryName}. Must be a valid hostname or IP address.`,
      );
    }

    // Validate dnsServer if provided
    if (dnsServer && !this.isValidHostnameOrIP(dnsServer)) {
      throw new Error(
        `Invalid DNS server: ${dnsServer}. Must be a valid hostname or IP address.`,
      );
    }

    return new Promise((resolve: (value: boolean | undefined) => void) => {
      const args: Array<string> = ["+dnssec", queryName, recordType];

      /*
       * Always use a DNSSEC-validating resolver for the check.
       * Docker's internal DNS and many default resolvers don't validate DNSSEC,
       * so the AD flag would never be set. If the user specified a custom DNS
       * server, use that (assuming they picked a validating resolver); otherwise
       * fall back to Google Public DNS which supports DNSSEC validation.
       */
      args.push(`@${dnsServer || "8.8.8.8"}`);

      execFile(
        "dig",
        args,
        { timeout: 10000 },
        (error: Error | null, stdout: string) => {
          if (error) {
            // dig not available, return undefined
            resolve(undefined);
            return;
          }

          // Check for the AD (Authenticated Data) flag in the response
          const adFlagPattern: RegExp = /flags:.*\bad\b/i;
          const hasAdFlag: boolean = adFlagPattern.test(stdout);
          resolve(hasAdFlag);
        },
      );
    });
  }
}
