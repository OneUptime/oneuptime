// Set required env vars before importing anything that pulls Config.ts
process.env["ONEUPTIME_URL"] = "https://oneuptime.com";
process.env["PROBE_KEY"] = "test-probe-key";

import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import PortMonitor, {
  DEFAULT_PORT_ATTEMPT_TIMEOUT_IN_MS,
  PortMonitorResponse,
} from "../../../../Utils/Monitors/MonitorTypes/PortMonitor";
import {
  MIN_MONITOR_CHECK_ATTEMPT_TIMEOUT_IN_MS,
  MONITOR_CHECK_RETRY_DELAY_IN_MS,
} from "Common/Types/Monitor/MonitorCheckBudget";
import Hostname from "Common/Types/API/Hostname";
import Port from "Common/Types/Port";
import PositiveNumber from "Common/Types/PositiveNumber";
import net, { AddressInfo } from "net";

/*
 * A Ping monitor falls back to PortMonitor when the cloud provider blocks
 * ICMP, so it carries the same failure mode: without a check-level deadline a
 * dead target costs `timeout × retries` and the check overruns its monitoring
 * interval.
 */

describe("PortMonitor.getAttemptTimeoutInMs", () => {
  it("uses the configured timeout when there is no check deadline", () => {
    expect(
      PortMonitor.getAttemptTimeoutInMs({
        timeout: new PositiveNumber(15000),
      }),
    ).toBe(15000);
  });

  it("falls back to the default when no timeout is configured", () => {
    expect(PortMonitor.getAttemptTimeoutInMs({})).toBe(
      DEFAULT_PORT_ATTEMPT_TIMEOUT_IN_MS,
    );
  });

  it("shortens the attempt to what is left of the check budget", () => {
    expect(
      PortMonitor.getAttemptTimeoutInMs({
        timeout: new PositiveNumber(15000),
        deadlineAt: new Date(Date.now() + 4000),
      }),
    ).toBeLessThanOrEqual(4000);
  });

  it("never stretches an attempt past the configured timeout", () => {
    expect(
      PortMonitor.getAttemptTimeoutInMs({
        timeout: new PositiveNumber(3000),
        deadlineAt: new Date(Date.now() + 600000),
      }),
    ).toBe(3000);
  });

  it("keeps a floor once the budget is spent, so the attempt still happens", () => {
    expect(
      PortMonitor.getAttemptTimeoutInMs({
        timeout: new PositiveNumber(15000),
        deadlineAt: new Date(Date.now() - 30000),
      }),
    ).toBe(MIN_MONITOR_CHECK_ATTEMPT_TIMEOUT_IN_MS);
  });
});

describe("PortMonitor.canRetry", () => {
  it("retries while attempts remain and no deadline is set", () => {
    expect(PortMonitor.canRetry({ retry: 3, currentRetryCount: 1 })).toBe(true);
  });

  it("stops once the retry count is exhausted", () => {
    expect(PortMonitor.canRetry({ retry: 3, currentRetryCount: 3 })).toBe(
      false,
    );
  });

  it("stops when the check deadline has passed, even with retries left", () => {
    expect(
      PortMonitor.canRetry({
        retry: 3,
        currentRetryCount: 1,
        deadlineAt: new Date(Date.now() - 1000),
      }),
    ).toBe(false);
  });

  it("stops when what is left cannot fit a backoff plus a real attempt", () => {
    const tooLittleInMs: number =
      MONITOR_CHECK_RETRY_DELAY_IN_MS + MIN_MONITOR_CHECK_ATTEMPT_TIMEOUT_IN_MS;

    expect(
      PortMonitor.canRetry({
        retry: 3,
        currentRetryCount: 1,
        deadlineAt: new Date(Date.now() + tooLittleInMs - 100),
      }),
    ).toBe(false);
  });
});

describe("PortMonitor.ping against a real socket", () => {
  let server: net.Server;
  let openPort: Port;

  beforeAll(async () => {
    server = net.createServer();

    await new Promise<void>((resolve: () => void) => {
      server.listen(0, "127.0.0.1", resolve);
    });

    openPort = new Port((server.address() as AddressInfo).port);
  });

  afterAll(async () => {
    await new Promise<void>((resolve: () => void) => {
      server.close(() => {
        resolve();
      });
    });
  });

  it("reports an open port as online in a single attempt", async () => {
    const response: PortMonitorResponse | null = await PortMonitor.ping(
      new Hostname("127.0.0.1"),
      openPort,
      {
        retry: 3,
        timeout: new PositiveNumber(5000),
        deadlineAt: new Date(Date.now() + 20000),
        isOnlineCheckRequest: true,
      },
    );

    expect(response?.isOnline).toBe(true);
    expect(response?.totalAttempts).toBe(1);
  });

  it("retries a refused connection up to the configured count", async () => {
    // Port 1 on loopback is not listening, so connect fails immediately.
    const response: PortMonitorResponse | null = await PortMonitor.ping(
      new Hostname("127.0.0.1"),
      new Port(1),
      {
        retry: 3,
        timeout: new PositiveNumber(2000),
        deadlineAt: new Date(Date.now() + 30000),
        isOnlineCheckRequest: true,
      },
    );

    expect(response?.isOnline).toBe(false);
    expect(response?.totalAttempts).toBe(3);
  });

  it("stops retrying a refused connection once the deadline has passed", async () => {
    const startedAtInMs: number = Date.now();

    const response: PortMonitorResponse | null = await PortMonitor.ping(
      new Hostname("127.0.0.1"),
      new Port(1),
      {
        retry: 3,
        timeout: new PositiveNumber(2000),
        // Already spent: not enough left for a backoff plus a real attempt.
        deadlineAt: new Date(startedAtInMs),
        isOnlineCheckRequest: true,
      },
    );

    expect(response?.isOnline).toBe(false);
    expect(response?.totalAttempts).toBe(1);

    /*
     * With the old unbudgeted loop this would have paid two 1s backoffs on
     * top of the failed attempts.
     */
    expect(Date.now() - startedAtInMs).toBeLessThan(
      2 * MONITOR_CHECK_RETRY_DELAY_IN_MS,
    );
  });
});
