process.env["ONEUPTIME_URL"] = "https://oneuptime.com";
process.env["PROBE_KEY"] = "test-probe-key";

import { beforeEach, describe, expect, jest, test } from "@jest/globals";

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      error: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
    },
  };
});

interface CaaAnswer {
  critical: number;
  issue?: string | undefined;
}

// What every Resolver the util builds was asked, in order.
const serversSet: Array<Array<string>> = [];
const caaQueries: Array<string> = [];
// Calls to the module-level dns.promises.resolveCaa, which must not happen.
const systemResolverCaaQueries: Array<string> = [];
// Every execFile("dig", ...) the util issues.
const digArgs: Array<Array<string>> = [];

class FakeResolver {
  public setServers(servers: Array<string>): void {
    serversSet.push(servers);
  }

  public async resolveCaa(queryName: string): Promise<Array<CaaAnswer>> {
    caaQueries.push(queryName);
    return [{ critical: 0, issue: "letsencrypt.org" }];
  }

  public async resolve4(): Promise<Array<{ address: string; ttl: number }>> {
    return [{ address: "192.0.2.1", ttl: 60 }];
  }
}

jest.mock("dns", () => {
  return {
    __esModule: true,
    default: {
      promises: {
        Resolver: FakeResolver,
        resolveCaa: async (queryName: string): Promise<Array<CaaAnswer>> => {
          systemResolverCaaQueries.push(queryName);
          return [{ critical: 0, issue: "system-resolver.example" }];
        },
      },
    },
  };
});

jest.mock("child_process", () => {
  return {
    __esModule: true,
    execFile: (
      _file: string,
      args: Array<string>,
      _options: { timeout?: number | undefined },
      callback: (error: Error | null, stdout: string) => void,
    ): void => {
      digArgs.push(args);
      callback(null, ";; flags: qr rd ra ad;\n");
    },
  };
});

import DnsMonitorUtil from "../../../../Utils/Monitors/MonitorTypes/DnsMonitor";
import DnsMonitorResponse from "Common/Types/Monitor/DnsMonitor/DnsMonitorResponse";
import DnsRecordType from "Common/Types/Monitor/DnsMonitor/DnsRecordType";
import MonitorStepDnsMonitor from "Common/Types/Monitor/MonitorStepDnsMonitor";

/*
 * The DNS Monitor docs promise that DNS Server (Optional) and its Port are
 * where every query goes. Two queries did not follow them: a CAA record was
 * looked up with the module-level dns.promises.resolveCaa, which always asks
 * the probe's own resolver, and the DNSSEC AD-flag dig named the server but
 * never its port. These hold both to the step's server.
 */

function buildConfig(input: {
  recordType: DnsRecordType;
  hostname?: string;
  port?: number;
}): MonitorStepDnsMonitor {
  return {
    queryName: "example.com",
    recordType: input.recordType,
    hostname: input.hostname ?? "",
    port: input.port ?? 53,
    timeout: 5000,
    retries: 0,
  };
}

beforeEach(() => {
  serversSet.length = 0;
  caaQueries.length = 0;
  systemResolverCaaQueries.length = 0;
  digArgs.length = 0;
});

describe("a CAA query", () => {
  test("is asked of the step's DNS server and port", async () => {
    const response: DnsMonitorResponse | null = await DnsMonitorUtil.query(
      buildConfig({
        recordType: DnsRecordType.CAA,
        hostname: "10.0.0.53",
        port: 5353,
      }),
      { isOnlineCheckRequest: true },
    );

    expect(serversSet).toEqual([["10.0.0.53:5353"]]);
    expect(caaQueries).toEqual(["example.com"]);
    expect(systemResolverCaaQueries).toEqual([]);
    expect(response?.isOnline).toBe(true);
    expect(response?.records).toEqual([
      { type: DnsRecordType.CAA, value: "0 letsencrypt.org" },
    ]);
  });

  test("uses the probe's resolver through the same Resolver when no server is set", async () => {
    await DnsMonitorUtil.query(buildConfig({ recordType: DnsRecordType.CAA }), {
      isOnlineCheckRequest: true,
    });

    // No servers set: the Resolver keeps the system's.
    expect(serversSet).toEqual([]);
    expect(caaQueries).toEqual(["example.com"]);
    expect(systemResolverCaaQueries).toEqual([]);
  });
});

describe("the DNSSEC AD-flag check", () => {
  test("asks a custom server on its own port", async () => {
    await DnsMonitorUtil.query(
      buildConfig({
        recordType: DnsRecordType.A,
        hostname: "10.0.0.53",
        port: 5353,
      }),
      { isOnlineCheckRequest: true },
    );

    expect(digArgs).toHaveLength(1);
    expect(digArgs[0]).toEqual([
      "+dnssec",
      "example.com",
      "A",
      "@10.0.0.53",
      "-p",
      "5353",
    ]);
  });

  test("leaves dig on its default port for a server on 53", async () => {
    await DnsMonitorUtil.query(
      buildConfig({
        recordType: DnsRecordType.A,
        hostname: "10.0.0.53",
        port: 53,
      }),
      { isOnlineCheckRequest: true },
    );

    expect(digArgs[0]).toEqual(["+dnssec", "example.com", "A", "@10.0.0.53"]);
  });

  test("asks Google Public DNS on 53 when no server is set, whatever the port says", async () => {
    await DnsMonitorUtil.query(
      buildConfig({ recordType: DnsRecordType.A, port: 5353 }),
      { isOnlineCheckRequest: true },
    );

    expect(digArgs[0]).toEqual(["+dnssec", "example.com", "A", "@8.8.8.8"]);
  });

  test("ignores a port that is not a port", async () => {
    await DnsMonitorUtil.query(
      buildConfig({
        recordType: DnsRecordType.A,
        hostname: "10.0.0.53",
        port: 70000,
      }),
      { isOnlineCheckRequest: true },
    );

    expect(digArgs[0]).toEqual(["+dnssec", "example.com", "A", "@10.0.0.53"]);
  });
});
