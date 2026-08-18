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

interface DigCall {
  queryType: string;
  timeout: number | undefined;
}

const digCalls: Array<DigCall> = [];

/*
 * How long each simulated dig "takes". Advancing a fake clock instead of
 * really sleeping is what lets these tests exercise a multi-minute worst case
 * in milliseconds.
 */
let digDurationMs: number = 0;
let now: number = 1_700_000_000_000;

jest.mock("child_process", () => {
  return {
    __esModule: true,
    execFile: (
      _file: string,
      args: Array<string>,
      options: { timeout?: number | undefined },
      callback: (error: Error | null, stdout: string) => void,
    ): void => {
      /*
       * dig args are [...flags, queryName, queryType, @resolver]; the type is
       * the last entry before the resolver.
       */
      const queryType: string =
        args.find((arg: string) => {
          return ["DNSKEY", "DS", "SOA", "A", "NS"].includes(arg);
        }) || "";

      digCalls.push({ queryType: queryType, timeout: options?.timeout });

      // A dig never outruns the timeout it was given.
      now += Math.min(digDurationMs, options?.timeout ?? digDurationMs);

      callback(null, ";; flags: qr rd ra ad;\n");
    },
  };
});

import DnssecMonitorUtil from "../../../../Utils/Monitors/MonitorTypes/DnssecMonitor";
import DnssecMonitorResponse from "Common/Types/Monitor/DnssecMonitor/DnssecMonitorResponse";
import MonitorStepDnssecMonitor from "Common/Types/Monitor/MonitorStepDnssecMonitor";

/*
 * Follow-up to https://github.com/OneUptime/oneuptime/issues/3225.
 *
 * Two defects: query() read config.timeout and ignored the options.timeout it
 * was handed, and every leg (DNSKEY, DS, RRSIG, one dig per resolver, then the
 * nameserver sweep) started a fresh full timeout, so one attempt against an
 * unresponsive resolver ran for minutes.
 */

function buildConfig(input?: {
  timeout?: number;
  retries?: number;
  resolvers?: Array<string>;
  checkNameserverConsistency?: boolean;
}): MonitorStepDnssecMonitor {
  return {
    domainName: "example.com",
    resolvers: input?.resolvers ?? ["1.1.1.1"],
    checkNameserverConsistency: input?.checkNameserverConsistency ?? false,
    signatureExpiryWarningDays: 7,
    timeout: input?.timeout ?? 10000,
    retries: input?.retries ?? 3,
  };
}

beforeEach(() => {
  digCalls.length = 0;
  digDurationMs = 0;
  now = 1_700_000_000_000;
  jest.spyOn(Date, "now").mockImplementation(() => {
    return now;
  });
});

describe("DnssecMonitorUtil timeout precedence", () => {
  test("prefers an explicitly supplied options.timeout over the config default", async () => {
    await DnssecMonitorUtil.query(buildConfig({ timeout: 10000 }), {
      timeout: 1234,
      isOnlineCheckRequest: true,
    });

    expect(digCalls.length).toBeGreaterThan(0);
    for (const call of digCalls) {
      expect(call.timeout).toBe(1234);
    }
  });

  test("falls back to the config timeout when the caller supplies none", async () => {
    await DnssecMonitorUtil.query(buildConfig({ timeout: 2500 }), {
      isOnlineCheckRequest: true,
    });

    expect(digCalls.length).toBeGreaterThan(0);
    for (const call of digCalls) {
      expect(call.timeout).toBe(2500);
    }
  });
});

describe("DnssecMonitorUtil shared time budget across legs", () => {
  test("caps one attempt at three times the per-leg timeout instead of one timeout per leg", async () => {
    const startedAt: number = now;

    // Every leg is slow enough to burn its whole timeout.
    digDurationMs = 10000;

    await DnssecMonitorUtil.query(
      buildConfig({
        timeout: 10000,
        resolvers: ["1.1.1.1", "8.8.8.8", "9.9.9.9"],
        checkNameserverConsistency: true,
      }),
      { retry: 0, isOnlineCheckRequest: true },
    );

    /*
     * Unbudgeted this was 3 fetches + 3 resolvers + an NS sweep, i.e. seven
     * full 10s legs and counting. The shared deadline holds one attempt to
     * 3 x the per-leg timeout.
     */
    expect(now - startedAt).toBeLessThanOrEqual(30000);
    expect(digCalls).toHaveLength(3);
  });

  test("shrinks a later leg to whatever the budget has left", async () => {
    // Each leg answers just inside its timeout: 8s of the shared 30s budget.
    digDurationMs = 8000;

    await DnssecMonitorUtil.query(
      buildConfig({
        timeout: 10000,
        resolvers: ["1.1.1.1", "8.8.8.8", "9.9.9.9"],
      }),
      { retry: 0, isOnlineCheckRequest: true },
    );

    /*
     * DNSKEY, DS and RRSIG take 8s each, leaving 6s of the 30s budget. The
     * fourth leg gets that 6s, not a fresh 10s - which is exactly the
     * multiplication this budget exists to stop.
     */
    expect(digCalls[0]?.timeout).toBe(10000);
    expect(digCalls[1]?.timeout).toBe(10000);
    expect(digCalls[2]?.timeout).toBe(10000);
    expect(digCalls[3]?.timeout).toBe(6000);

    // And once the budget is spent, no further leg is even attempted.
    expect(digCalls).toHaveLength(4);
  });

  test("reports a timeout rather than a fabricated DNSSEC verdict when the budget runs out", async () => {
    digDurationMs = 10000;

    const response: DnssecMonitorResponse | null =
      await DnssecMonitorUtil.query(
        buildConfig({
          timeout: 10000,
          resolvers: ["1.1.1.1", "8.8.8.8", "9.9.9.9"],
        }),
        { retry: 0, isOnlineCheckRequest: true },
      );

    /*
     * The sweep never finished, so "zone not signed" / "resolvers disagree"
     * would be an answer we never actually established. Say it timed out.
     */
    expect(response?.isOnline).toBe(false);
    expect(response?.isTimeout).toBe(true);
    expect(response?.failureCause).toContain("30000ms");
  });

  test("still completes normally when the legs finish inside the budget", async () => {
    digDurationMs = 10;

    const response: DnssecMonitorResponse | null =
      await DnssecMonitorUtil.query(
        buildConfig({
          timeout: 10000,
          resolvers: ["1.1.1.1", "8.8.8.8", "9.9.9.9"],
          checkNameserverConsistency: true,
        }),
        { retry: 0, isOnlineCheckRequest: true },
      );

    expect(response?.isOnline).toBe(true);
    expect(response?.isTimeout).toBeUndefined();
    expect(response?.resolverChecks).toHaveLength(3);
  });
});
