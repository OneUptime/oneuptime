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

interface ResolverOptions {
  timeout?: number | undefined;
}

// Every Resolver the util builds, in construction order.
const resolverOptions: Array<ResolverOptions> = [];
// Every execFile("dig", ...) the util issues, with the options it passed.
const digCalls: Array<{ args: Array<string>; timeout: number | undefined }> =
  [];

class FakeResolver {
  public constructor(options: ResolverOptions) {
    resolverOptions.push(options);
  }

  public setServers(): void {
    // no-op: these tests never talk to a real resolver.
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
      options: { timeout?: number | undefined },
      callback: (error: Error | null, stdout: string) => void,
    ): void => {
      digCalls.push({ args: args, timeout: options?.timeout });
      callback(null, ";; flags: qr rd ra ad;\n");
    },
  };
});

import DnsMonitorUtil from "../../../../Utils/Monitors/MonitorTypes/DnsMonitor";
import DnsRecordType from "Common/Types/Monitor/DnsMonitor/DnsRecordType";
import MonitorStepDnsMonitor from "Common/Types/Monitor/MonitorStepDnsMonitor";

/*
 * Follow-up to https://github.com/OneUptime/oneuptime/issues/3225.
 *
 * DnsMonitorUtil.query built its resolver from config.timeout alone, so the
 * per-step timeout handed to it in options.timeout was silently dropped.
 */

function buildConfig(input?: {
  timeout?: number;
  retries?: number;
}): MonitorStepDnsMonitor {
  return {
    queryName: "example.com",
    recordType: DnsRecordType.A,
    hostname: "",
    port: 53,
    timeout: input?.timeout ?? 5000,
    retries: input?.retries ?? 3,
  };
}

beforeEach(() => {
  resolverOptions.length = 0;
  digCalls.length = 0;
});

describe("DnsMonitorUtil timeout precedence", () => {
  test("prefers an explicitly supplied options.timeout over the config default", async () => {
    await DnsMonitorUtil.query(buildConfig({ timeout: 5000 }), {
      timeout: 1234,
      isOnlineCheckRequest: true,
    });

    expect(resolverOptions[0]?.timeout).toBe(1234);
  });

  test("falls back to the config timeout when the caller supplies none", async () => {
    await DnsMonitorUtil.query(buildConfig({ timeout: 5000 }), {
      isOnlineCheckRequest: true,
    });

    expect(resolverOptions[0]?.timeout).toBe(5000);
  });

  test("bounds the DNSSEC AD-flag dig by the same timeout", async () => {
    await DnsMonitorUtil.query(buildConfig({ timeout: 5000 }), {
      timeout: 1234,
      isOnlineCheckRequest: true,
    });

    /*
     * The AD-flag check used a hardcoded 10s, so a DNS step configured for a
     * short timeout could still spend 10 extra seconds inside dig.
     */
    expect(digCalls).toHaveLength(1);
    expect(digCalls[0]?.timeout).toBe(1234);
  });
});
