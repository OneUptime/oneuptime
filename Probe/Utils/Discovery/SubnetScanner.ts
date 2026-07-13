import SnmpMonitor from "../Monitors/MonitorTypes/SnmpMonitor";
import MonitorStepSnmpMonitor from "Common/Types/Monitor/MonitorStepSnmpMonitor";
import SnmpVersion from "Common/Types/Monitor/SnmpMonitor/SnmpVersion";
import logger from "Common/Server/Utils/Logger";

export interface DiscoveredHost {
  ipAddress: string;
  sysName?: string | undefined;
  sysDescr?: string | undefined;
}

export interface SubnetScanConfig {
  cidr: string;
  snmpVersion?: string | undefined;
  snmpCommunityString?: string | undefined;
  snmpPort?: number | undefined;
}

export interface SubnetScanResult {
  discoveredHosts: Array<DiscoveredHost>;
  scannedHostCount: number;
}

// Sweeping the whole subnet at once would exhaust sockets; probe in waves.
const CONCURRENCY: number = 32;
// Guard against someone entering a /8 — an IPv4 sweep that size is abuse.
const MAX_HOSTS: number = 4096;

export default class SubnetScanner {
  public static async scan(
    config: SubnetScanConfig,
  ): Promise<SubnetScanResult> {
    /*
     * Reject oversized subnets by prefix BEFORE expanding. expandCidr()
     * materializes one string per host, so validating after expansion would
     * let a /8 allocate ~16M strings (OOM) before the limit is ever checked.
     */
    const expectedHostCount: number = SubnetScanner.countHosts(config.cidr);

    if (expectedHostCount === 0) {
      throw new Error("Invalid or empty CIDR: " + config.cidr);
    }

    if (expectedHostCount > MAX_HOSTS) {
      throw new Error(
        "CIDR " +
          config.cidr +
          " expands to " +
          expectedHostCount +
          " hosts, exceeding the " +
          MAX_HOSTS +
          "-host scan limit. Use a smaller subnet.",
      );
    }

    const hosts: Array<string> = SubnetScanner.expandCidr(config.cidr);

    if (hosts.length === 0) {
      throw new Error("Invalid or empty CIDR: " + config.cidr);
    }

    const discoveredHosts: Array<DiscoveredHost> = [];
    let cursor: number = 0;

    const worker: () => Promise<void> = async (): Promise<void> => {
      while (cursor < hosts.length) {
        const host: string = hosts[cursor++]!;
        const snmpConfig: MonitorStepSnmpMonitor = {
          snmpVersion: (config.snmpVersion as SnmpVersion) || SnmpVersion.V2c,
          hostname: host,
          port: config.snmpPort || 161,
          communityString: config.snmpCommunityString || "public",
          oids: [],
          timeout: 2000,
          retries: 0,
        };

        try {
          const systemInfo: {
            sysDescr?: string | undefined;
            sysName?: string | undefined;
          } | null = await SnmpMonitor.probeSystemInfo(snmpConfig);

          if (systemInfo) {
            discoveredHosts.push({
              ipAddress: host,
              sysName: systemInfo.sysName,
              sysDescr: systemInfo.sysDescr,
            });
          }
        } catch (err) {
          logger.debug("Discovery probe error for " + host + ": " + err);
        }
      }
    };

    const workers: Array<Promise<void>> = [];
    for (let i: number = 0; i < Math.min(CONCURRENCY, hosts.length); i++) {
      workers.push(worker());
    }
    await Promise.all(workers);

    discoveredHosts.sort((a: DiscoveredHost, b: DiscoveredHost) => {
      return (
        SubnetScanner.ipToLong(a.ipAddress) -
        SubnetScanner.ipToLong(b.ipAddress)
      );
    });

    return {
      discoveredHosts: discoveredHosts,
      scannedHostCount: hosts.length,
    };
  }

  /*
   * Returns how many usable host addresses a CIDR expands to, computed from
   * the prefix alone (no allocation). Returns 0 for a malformed CIDR. Mirrors
   * expandCidr's rule: /31 and /32 count every address, larger blocks exclude
   * the network and broadcast addresses.
   */
  public static countHosts(cidr: string): number {
    const match: RegExpMatchArray | null = cidr
      .trim()
      .match(/^(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\/(\d{1,2})$/);

    if (!match) {
      return 0;
    }

    const prefix: number = parseInt(match[2]!, 10);
    if (prefix < 0 || prefix > 32) {
      return 0;
    }

    if (isNaN(SubnetScanner.ipToLong(match[1]!))) {
      return 0;
    }

    const blockSize: number = Math.pow(2, 32 - prefix);
    return blockSize <= 2 ? blockSize : blockSize - 2;
  }

  /*
   * Expands an IPv4 CIDR into its usable host addresses. For prefixes /31
   * and shorter, the network and broadcast addresses are excluded.
   */
  public static expandCidr(cidr: string): Array<string> {
    const match: RegExpMatchArray | null = cidr
      .trim()
      .match(/^(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})\/(\d{1,2})$/);

    if (!match) {
      return [];
    }

    const baseIp: string = match[1]!;
    const prefix: number = parseInt(match[2]!, 10);

    if (prefix < 0 || prefix > 32) {
      return [];
    }

    const baseLong: number = SubnetScanner.ipToLong(baseIp);
    if (isNaN(baseLong)) {
      return [];
    }

    const hostBits: number = 32 - prefix;
    const blockSize: number = Math.pow(2, hostBits);
    const networkLong: number = baseLong & (0xffffffff << hostBits);

    const hosts: Array<string> = [];

    if (blockSize <= 2) {
      // /31 and /32: every address is usable.
      for (let i: number = 0; i < blockSize; i++) {
        hosts.push(SubnetScanner.longToIp(networkLong + i));
      }
      return hosts;
    }

    // Skip network (first) and broadcast (last).
    for (let i: number = 1; i < blockSize - 1; i++) {
      hosts.push(SubnetScanner.longToIp(networkLong + i));
    }
    return hosts;
  }

  private static ipToLong(ip: string): number {
    const parts: Array<string> = ip.split(".");
    if (parts.length !== 4) {
      return NaN;
    }
    let long: number = 0;
    for (const part of parts) {
      const octet: number = parseInt(part, 10);
      if (isNaN(octet) || octet < 0 || octet > 255) {
        return NaN;
      }
      long = long * 256 + octet;
    }
    return long >>> 0;
  }

  private static longToIp(long: number): string {
    return (
      ((long >>> 24) & 0xff) +
      "." +
      ((long >>> 16) & 0xff) +
      "." +
      ((long >>> 8) & 0xff) +
      "." +
      (long & 0xff)
    );
  }
}
