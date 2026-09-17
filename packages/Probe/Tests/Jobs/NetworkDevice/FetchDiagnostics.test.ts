// Set required env vars before importing modules that pull in Config.ts.
process.env["ONEUPTIME_URL"] = "https://oneuptime.example.com";
process.env["PROBE_KEY"] = "test-probe-key";
process.env["PROBE_ID"] = "11111111-2222-3333-4444-555555555555";

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";

type CapturedCronJob = {
  jobName: string;
  options: { schedule: string; runOnStartup: boolean };
  runFunction: PromiseVoidFunction;
};

const mockCapturedCronJobs: Array<CapturedCronJob> = [];

/*
 * BasicCron would hand the runFunction to node-cron; capturing it instead
 * lets these tests drive the exact closure production runs — overlap guard
 * included — without a real scheduler.
 */
jest.mock("Common/Server/Utils/BasicCron", () => {
  return {
    __esModule: true,
    default: (props: CapturedCronJob): void => {
      mockCapturedCronJobs.push(props);
    },
  };
});

import Hostname from "Common/Types/API/Hostname";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import IPv4 from "Common/Types/IP/IPv4";
import IPv6 from "Common/Types/IP/IPv6";
import { JSONObject } from "Common/Types/JSON";
import NetworkPathTrace from "Common/Types/Monitor/NetworkMonitor/NetworkPathTrace";
import {
  NETWORK_DEVICE_DIAGNOSTIC_CLAIM_LIMIT,
  NetworkDeviceDiagnosticJob,
  NetworkDeviceDiagnosticPingResult,
  NetworkDeviceDiagnosticReport,
} from "Common/Types/NetworkDevice/NetworkDeviceDiagnosticResult";
import { NetworkDeviceDiagnosticStatus } from "Common/Types/NetworkDevice/NetworkDeviceDiagnosticStatus";
import NetworkDeviceDiagnosticType from "Common/Types/NetworkDevice/NetworkDeviceDiagnosticType";
import API from "Common/Utils/API";
import { EVERY_TEN_SECONDS } from "Common/Utils/CronTime";
import logger from "Common/Server/Utils/Logger";
import NetworkPathMonitor from "../../../Utils/Monitors/MonitorTypes/NetworkPathMonitor";
import PingMonitor from "../../../Utils/Monitors/MonitorTypes/PingMonitor";
import InitJob, {
  DIAGNOSTIC_CONCURRENCY,
  fetchAndRunDiagnostics,
  fetchDiagnosticList,
  reportDiagnosticResult,
  resetDiagnosticFetchInProgress,
  runDiagnostic,
  runDiagnostics,
} from "../../../Jobs/NetworkDevice/FetchDiagnostics";

/*
 * The probe's half of on-demand device diagnostics (issue #3745):
 *
 *   POST <ingest>/probe/network-device-diagnostic/list            → claimed jobs
 *   (ping or traceroute each one from this probe, DIAGNOSTIC_CONCURRENCY at
 *    a time)
 *   POST <ingest>/probe/network-device-diagnostic/response/ingest → one report per job
 *
 * These tests pin the wire contract the probe sends — URLs, the list body,
 * the per-job report body (networkDeviceDiagnosticId / status / pingResult
 * / traceRouteResult / statusMessage) — because the server writes the row
 * from that report and the dashboard is polling the row: a diagnostic the
 * probe silently drops leaves somebody staring at a spinner until it times
 * out.
 *
 * Neither the OS ping nor traceroute binary is ever forked:
 * PingMonitor.runDiagnosticPing and NetworkPathMonitor.trace are spied on.
 */

function makePingJob(
  overrides?: Partial<NetworkDeviceDiagnosticJob>,
): NetworkDeviceDiagnosticJob {
  return {
    id: "diag-1",
    projectId: "project-1",
    networkDeviceId: "device-1",
    diagnosticType: NetworkDeviceDiagnosticType.Ping,
    hostname: "10.0.0.5",
    timeoutInMs: 5000,
    packetCount: 5,
    ...overrides,
  };
}

function makeTracerouteJob(
  overrides?: Partial<NetworkDeviceDiagnosticJob>,
): NetworkDeviceDiagnosticJob {
  return {
    id: "diag-2",
    projectId: "project-1",
    networkDeviceId: "device-1",
    diagnosticType: NetworkDeviceDiagnosticType.Traceroute,
    hostname: "core-sw1.example.com",
    timeoutInMs: 30000,
    maxHops: 30,
    ...overrides,
  };
}

function makePingResult(
  overrides?: Partial<NetworkDeviceDiagnosticPingResult>,
): NetworkDeviceDiagnosticPingResult {
  return {
    isOnline: true,
    failureCause: "",
    pingResponse: {
      packetsSent: 5,
      packetsReceived: 5,
      packetLossPercent: 0,
      minRoundTripTimeInMs: 1.1,
      maxRoundTripTimeInMs: 1.9,
      avgRoundTripTimeInMs: 1.4,
      jitterInMs: 0.3,
    },
    ...overrides,
  };
}

function makeTrace(): NetworkPathTrace {
  return {
    timestamp: new Date("2026-09-15T10:00:00.000Z"),
    dnsLookup: {
      hostName: "core-sw1.example.com",
      resolvedAddresses: ["10.0.0.5"],
      resolvedInMS: 3,
      isSuccess: true,
      errorMessage: undefined,
    },
    traceRoute: {
      hops: [
        {
          hopNumber: 1,
          address: "10.0.0.1",
          hostName: "gw.example.com",
          roundTripTimeInMS: 0.8,
          isTimeout: false,
        },
        {
          hopNumber: 2,
          address: "10.0.0.5",
          hostName: "core-sw1.example.com",
          roundTripTimeInMS: 1.4,
          isTimeout: false,
        },
      ],
      destinationAddress: "core-sw1.example.com",
      destinationHostName: "core-sw1.example.com",
      isComplete: true,
      totalHops: 2,
      failedHop: undefined,
      failureMessage: undefined,
    },
  };
}

// eslint-disable-next-line @typescript-eslint/typedef
let fetchSpy = jest.spyOn(API, "fetch");
// eslint-disable-next-line @typescript-eslint/typedef
let pingSpy = jest.spyOn(PingMonitor, "runDiagnosticPing");
// eslint-disable-next-line @typescript-eslint/typedef
let traceSpy = jest.spyOn(NetworkPathMonitor, "trace");

beforeEach(() => {
  mockCapturedCronJobs.length = 0;
  // A wedged in-flight fetch from a previous test must never leak in.
  resetDiagnosticFetchInProgress();
  fetchSpy = jest.spyOn(API, "fetch").mockResolvedValue({ data: {} } as never);
  pingSpy = jest
    .spyOn(PingMonitor, "runDiagnosticPing")
    .mockResolvedValue(makePingResult());
  traceSpy = jest
    .spyOn(NetworkPathMonitor, "trace")
    .mockResolvedValue(makeTrace());
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function flushMicrotasks(): Promise<void> {
  await new Promise<void>((resolve: () => void) => {
    setImmediate(resolve);
  });
}

type FetchCall = {
  url: string;
  body: JSONObject;
  options: JSONObject;
};

function fetchCalls(): Array<FetchCall> {
  return fetchSpy.mock.calls.map((call: Array<unknown>) => {
    const arg: JSONObject = call[0] as JSONObject;
    return {
      url: String(arg["url"]),
      body: arg["data"] as JSONObject,
      options: arg["options"] as JSONObject,
    };
  });
}

function listCalls(): Array<FetchCall> {
  return fetchCalls().filter((call: FetchCall) => {
    return call.url.endsWith("/probe/network-device-diagnostic/list");
  });
}

function ingestCalls(): Array<FetchCall> {
  return fetchCalls().filter((call: FetchCall) => {
    return call.url.endsWith(
      "/probe/network-device-diagnostic/response/ingest",
    );
  });
}

function soleIngestBody(): JSONObject {
  const ingested: Array<FetchCall> = ingestCalls();
  expect(ingested).toHaveLength(1);
  return ingested[0]!.body;
}

function pingCallArg(callIndex: number = 0): {
  host: Hostname | IPv4 | IPv6;
  packetCount?: number | undefined;
  timeoutMs?: number | undefined;
} {
  const call: Array<unknown> | undefined = pingSpy.mock.calls[callIndex];
  if (!call) {
    throw new Error(`runDiagnosticPing was not called ${callIndex + 1}x`);
  }
  return call[0] as {
    host: Hostname | IPv4 | IPv6;
    packetCount?: number | undefined;
    timeoutMs?: number | undefined;
  };
}

function capturedCronJob(): CapturedCronJob {
  InitJob();
  const captured: CapturedCronJob | undefined =
    mockCapturedCronJobs[mockCapturedCronJobs.length - 1];
  if (!captured) {
    throw new Error("InitJob did not register a cron job");
  }
  return captured;
}

describe("the cron registration", () => {
  /*
   * Ten seconds, like the monitor-test job: somebody is watching a spinner,
   * and the device poll's one-minute cadence would be most of the wait.
   */
  test("registers Probe:NetworkDeviceDiagnostics every ten seconds, run on startup", () => {
    const captured: CapturedCronJob = capturedCronJob();

    expect(captured.jobName).toBe("Probe:NetworkDeviceDiagnostics");
    expect(captured.options.schedule).toBe(EVERY_TEN_SECONDS);
    expect(captured.options.runOnStartup).toBe(true);
  });
});

describe("fetchDiagnosticList — claiming this probe's pending diagnostics", () => {
  test("asks the probe-ingest list endpoint, authenticated as this probe, with the claim limit", async () => {
    await fetchDiagnosticList();

    const calls: Array<FetchCall> = listCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(
      "https://oneuptime.example.com/probe-ingest/probe/network-device-diagnostic/list",
    );
    expect(calls[0]!.body["probeId"]).toBe(
      "11111111-2222-3333-4444-555555555555",
    );
    expect(calls[0]!.body["probeKey"]).toBe("test-probe-key");
    expect(calls[0]!.body["limit"]).toBe(NETWORK_DEVICE_DIAGNOSTIC_CLAIM_LIMIT);
  });

  /*
   * The deadline pin: axios's default timeout is 0 = infinite, and at six
   * ticks a minute a fetch that never settles adds up fast.
   */
  test("the list fetch carries the 45s deadline", async () => {
    await fetchDiagnosticList();

    expect(listCalls()[0]!.options["timeout"]).toBe(45000);
  });

  test("returns the jobs the server hands out", async () => {
    const jobs: Array<NetworkDeviceDiagnosticJob> = [
      makePingJob(),
      makeTracerouteJob(),
    ];
    fetchSpy.mockResolvedValueOnce({ data: { diagnostics: jobs } } as never);

    await expect(fetchDiagnosticList()).resolves.toEqual(jobs);
  });

  test("a response with no diagnostics key at all is an empty batch", async () => {
    // beforeEach default: { data: {} }
    await expect(fetchDiagnosticList()).resolves.toEqual([]);
  });

  test("a failed fetch is logged and yields an empty batch, not a rejection", async () => {
    // eslint-disable-next-line @typescript-eslint/typedef
    const errorSpy = jest.spyOn(logger, "error").mockImplementation(() => {
      // Keep test output clean.
    });
    fetchSpy.mockRejectedValue(new Error("ingest unreachable") as never);

    await expect(fetchDiagnosticList()).resolves.toEqual([]);

    expect(errorSpy).toHaveBeenCalled();
  });

  /*
   * API.fetch RETURNS an HTTPErrorResponse for a 4xx/5xx — it only throws
   * when no response arrived at all — so a try/catch alone reads
   * `diagnostics` off the error body, calls that an empty batch and never
   * logs the server's reason. A 404 is also what a server older than this
   * job answers, and that deserves a hint, not silence six times a minute.
   */
  test("a server rejection (4xx/5xx) is logged as a warning naming the status and reason, and yields an empty batch", async () => {
    // eslint-disable-next-line @typescript-eslint/typedef
    const warnSpy = jest.spyOn(logger, "warn").mockImplementation(() => {
      // Keep test output clean.
    });
    // eslint-disable-next-line @typescript-eslint/typedef
    const errorSpy = jest.spyOn(logger, "error").mockImplementation(() => {
      // Keep test output clean.
    });
    fetchSpy.mockResolvedValue(
      new HTTPErrorResponse(404, { message: "Not Found" }, {}) as never,
    );

    await expect(fetchDiagnosticList()).resolves.toEqual([]);

    expect(warnSpy).toHaveBeenCalledTimes(1);
    const warning: string = String(warnSpy.mock.calls[0]![0]);
    expect(warning).toContain("HTTP 404");
    expect(warning).toContain("Not Found");
    expect(warning).toContain("predates on-demand diagnostics");
    // The server explained itself; that is not an exception to log.
    expect(errorSpy).not.toHaveBeenCalled();
  });

  test("a rejection whose body carries no message still names the status", async () => {
    // eslint-disable-next-line @typescript-eslint/typedef
    const warnSpy = jest.spyOn(logger, "warn").mockImplementation(() => {
      // Keep test output clean.
    });
    fetchSpy.mockResolvedValue(new HTTPErrorResponse(503, {}, {}) as never);

    await expect(fetchDiagnosticList()).resolves.toEqual([]);

    expect(String(warnSpy.mock.calls[0]![0])).toContain("HTTP 503");
  });
});

describe("the job's tick — fetch-only overlap guard", () => {
  test("a failed list fetch releases the guard — the next tick fetches again", async () => {
    // eslint-disable-next-line @typescript-eslint/typedef
    const errorSpy = jest.spyOn(logger, "error").mockImplementation(() => {
      // Keep test output clean.
    });

    const runFunction: PromiseVoidFunction = capturedCronJob().runFunction;

    fetchSpy.mockRejectedValue(new Error("ingest unreachable") as never);

    // The job catches and logs internally; the tick itself must resolve.
    await expect(runFunction()).resolves.toBeUndefined();
    await expect(runFunction()).resolves.toBeUndefined();

    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(errorSpy).toHaveBeenCalled();
  });

  test("a tick that arrives while the previous fetch is still in flight is skipped", async () => {
    const runFunction: PromiseVoidFunction = capturedCronJob().runFunction;

    fetchSpy.mockReturnValue(
      new Promise<never>(() => {
        // Never settles — a list fetch stuck on an unresponsive server.
      }) as never,
    );

    const firstTick: Promise<void> = runFunction();
    await flushMicrotasks();

    await runFunction();

    expect(fetchSpy).toHaveBeenCalledTimes(1);

    // Never settles by design; module state dies with this test file.
    void firstTick;
  });

  /*
   * The guard covers ONLY the fetch. The server hands each diagnostic out
   * exactly once, so overlapping ticks run disjoint batches — and a
   * traceroute legitimately takes up to its 30 s deadline, which must not
   * delay the pickup of the next person's ping by even one tick.
   */
  test("a long-running diagnostic does not block the next tick's fetch", async () => {
    const runFunction: PromiseVoidFunction = capturedCronJob().runFunction;

    fetchSpy.mockResolvedValue({
      data: { diagnostics: [makeTracerouteJob()] },
    } as never);

    traceSpy.mockReturnValue(
      new Promise<never>(() => {
        // Never settles — a traceroute mid-run.
      }) as never,
    );

    const firstTick: Promise<void> = runFunction();
    await flushMicrotasks();

    // The trace is still running, but the guard was already released...
    const secondTick: Promise<void> = runFunction();
    await flushMicrotasks();

    // ...so the second tick fetched a fresh list.
    expect(listCalls()).toHaveLength(2);
    expect(traceSpy).toHaveBeenCalled();

    // Never settle by design; module state dies with this test file.
    void firstTick;
    void secondTick;
  });

  test("a tick whose list request the server rejects runs nothing and does not throw", async () => {
    jest.spyOn(logger, "warn").mockImplementation(() => {
      // Keep test output clean.
    });
    const runFunction: PromiseVoidFunction = capturedCronJob().runFunction;

    fetchSpy.mockResolvedValue(
      new HTTPErrorResponse(404, { message: "Not Found" }, {}) as never,
    );

    await expect(runFunction()).resolves.toBeUndefined();

    expect(pingSpy).not.toHaveBeenCalled();
    expect(traceSpy).not.toHaveBeenCalled();
    expect(ingestCalls()).toHaveLength(0);
  });

  test("no pending diagnostics: nothing runs, nothing is reported", async () => {
    fetchSpy.mockResolvedValueOnce({ data: { diagnostics: [] } } as never);

    await fetchAndRunDiagnostics();

    expect(pingSpy).not.toHaveBeenCalled();
    expect(traceSpy).not.toHaveBeenCalled();
    expect(fetchCalls()).toHaveLength(1);
    expect(ingestCalls()).toHaveLength(0);
  });
});

describe("a Ping diagnostic", () => {
  test("pings an IPv4 literal as an IPv4", async () => {
    await runDiagnostic(makePingJob({ hostname: "10.0.0.5" }));

    expect(pingSpy).toHaveBeenCalledTimes(1);
    expect(pingCallArg().host).toBeInstanceOf(IPv4);
    expect(pingCallArg().host.toString()).toBe("10.0.0.5");
  });

  test("pings a DNS name as a Hostname", async () => {
    await runDiagnostic(makePingJob({ hostname: "core-sw1.example.com" }));

    expect(pingCallArg().host).toBeInstanceOf(Hostname);
    expect((pingCallArg().host as Hostname).hostname).toBe(
      "core-sw1.example.com",
    );
  });

  test("pings an IPv6 literal as an IPv6 (colons must not be read as a port)", async () => {
    await runDiagnostic(makePingJob({ hostname: "2001:db8::1" }));

    expect(pingCallArg().host).toBeInstanceOf(IPv6);
    expect(pingCallArg().host.toString()).toBe("2001:db8::1");
  });

  test("hands the server's packet count and per-reply wait to the ping", async () => {
    await runDiagnostic(makePingJob({ packetCount: 3, timeoutInMs: 2000 }));

    expect(pingCallArg().packetCount).toBe(3);
    expect(pingCallArg().timeoutMs).toBe(2000);
  });

  test("yields a Completed report carrying the ping result", async () => {
    const pingResult: NetworkDeviceDiagnosticPingResult = makePingResult();
    pingSpy.mockResolvedValue(pingResult);

    const report: NetworkDeviceDiagnosticReport =
      await runDiagnostic(makePingJob());

    expect(report).toEqual({
      networkDeviceDiagnosticId: "diag-1",
      status: NetworkDeviceDiagnosticStatus.Completed,
      pingResult: pingResult,
    });
    expect(traceSpy).not.toHaveBeenCalled();
  });

  /*
   * A device that answered no echo is a COMPLETED diagnostic: the result
   * (isOnline false, 100% loss) is the answer the person asked for.
   */
  test("a device that does not answer is still Completed, with isOnline false", async () => {
    pingSpy.mockResolvedValue(
      makePingResult({
        isOnline: false,
        failureCause: "No ICMP echo reply from 10.0.0.5 (5 sent)",
        pingResponse: {
          packetsSent: 5,
          packetsReceived: 0,
          packetLossPercent: 100,
        },
      }),
    );

    const report: NetworkDeviceDiagnosticReport =
      await runDiagnostic(makePingJob());

    expect(report.status).toBe(NetworkDeviceDiagnosticStatus.Completed);
    expect(report.pingResult?.isOnline).toBe(false);
    expect(report.pingResult?.pingResponse?.packetLossPercent).toBe(100);
    expect(report.statusMessage).toBeUndefined();
  });

  test("the ingest body carries auth, the diagnostic id, Completed and the ping result", async () => {
    fetchSpy.mockResolvedValueOnce({
      data: { diagnostics: [makePingJob()] },
    } as never);

    await fetchAndRunDiagnostics();

    const ingested: Array<FetchCall> = ingestCalls();
    expect(ingested).toHaveLength(1);
    expect(ingested[0]!.url).toBe(
      "https://oneuptime.example.com/probe-ingest/probe/network-device-diagnostic/response/ingest",
    );

    const body: JSONObject = ingested[0]!.body;
    expect(body["probeId"]).toBe("11111111-2222-3333-4444-555555555555");
    expect(body["probeKey"]).toBe("test-probe-key");
    expect(body["networkDeviceDiagnosticId"]).toBe("diag-1");
    expect(body["status"]).toBe("Completed");
    expect(body["pingResult"]).toEqual(makePingResult());
    expect("traceRouteResult" in body).toBe(false);
    expect(ingested[0]!.options["timeout"]).toBe(45000);
  });

  /*
   * The exact wire shape the server's ingest handler reads. Pinned as a
   * key set so a renamed or dropped field fails here, not in production
   * where it would silently stop a column from being written.
   */
  test("carries exactly: auth, networkDeviceDiagnosticId, status, pingResult", async () => {
    await reportDiagnosticResult(await runDiagnostic(makePingJob()));

    expect(Object.keys(soleIngestBody()).sort()).toEqual([
      "networkDeviceDiagnosticId",
      "pingResult",
      "probeCapabilities",
      "probeId",
      "probeKey",
      "status",
    ]);
  });
});

describe("a Traceroute diagnostic", () => {
  test("traces the hostname with the server's deadline and hop limit", async () => {
    await runDiagnostic(
      makeTracerouteJob({
        hostname: "core-sw1.example.com",
        timeoutInMs: 20000,
        maxHops: 12,
      }),
    );

    expect(traceSpy).toHaveBeenCalledTimes(1);
    expect(traceSpy.mock.calls[0]![0]).toBe("core-sw1.example.com");
    expect(traceSpy.mock.calls[0]![1]).toEqual({
      timeout: 20000,
      maxHops: 12,
    });
    expect(pingSpy).not.toHaveBeenCalled();
  });

  test("leaves the hop limit to trace()'s default when the server sent none", async () => {
    await runDiagnostic(makeTracerouteJob({ maxHops: undefined }));

    expect(traceSpy.mock.calls[0]![1]).toEqual({ timeout: 30000 });
  });

  test("yields a Completed report carrying the trace", async () => {
    const trace: NetworkPathTrace = makeTrace();
    traceSpy.mockResolvedValue(trace);

    const report: NetworkDeviceDiagnosticReport =
      await runDiagnostic(makeTracerouteJob());

    expect(report).toEqual({
      networkDeviceDiagnosticId: "diag-2",
      status: NetworkDeviceDiagnosticStatus.Completed,
      traceRouteResult: trace,
    });
  });

  /*
   * trace() never rejects: a broken path, a hit deadline or an unusable
   * destination come back as a trace with zero hops and a failureMessage.
   * That message IS the result, so the diagnostic is Completed, not Failed.
   */
  test("a trace with no hops and a failure message is still Completed — the message is the result", async () => {
    traceSpy.mockResolvedValue({
      timestamp: new Date(),
      traceRoute: {
        hops: [],
        destinationAddress: "core-sw1.example.com",
        destinationHostName: undefined,
        isComplete: false,
        totalHops: 0,
        failedHop: undefined,
        failureMessage: "Traceroute timed out",
      },
    });

    const report: NetworkDeviceDiagnosticReport =
      await runDiagnostic(makeTracerouteJob());

    expect(report.status).toBe(NetworkDeviceDiagnosticStatus.Completed);
    expect(report.traceRouteResult?.traceRoute?.failureMessage).toBe(
      "Traceroute timed out",
    );
    expect(report.statusMessage).toBeUndefined();
  });

  test("the ingest body carries the diagnostic id, Completed and the trace", async () => {
    fetchSpy.mockResolvedValueOnce({
      data: { diagnostics: [makeTracerouteJob()] },
    } as never);

    await fetchAndRunDiagnostics();

    const body: JSONObject = soleIngestBody();
    expect(body["networkDeviceDiagnosticId"]).toBe("diag-2");
    expect(body["status"]).toBe("Completed");
    expect(body["traceRouteResult"]).toEqual(makeTrace());
    expect("pingResult" in body).toBe(false);
  });
});

describe("failures are reported, never swallowed", () => {
  /*
   * A hostname that is neither an IP nor a valid DNS name cannot even be
   * turned into a ping target. The row is claimed and somebody is waiting,
   * so that is a Failed report with the reason, not a skipped job.
   */
  test("an address that cannot become a ping target is a Failed report with the reason, and no ping", async () => {
    const report: NetworkDeviceDiagnosticReport = await runDiagnostic(
      makePingJob({ hostname: "not a valid host!!" }),
    );

    expect(pingSpy).not.toHaveBeenCalled();
    expect(report).toEqual({
      networkDeviceDiagnosticId: "diag-1",
      status: NetworkDeviceDiagnosticStatus.Failed,
      statusMessage: expect.stringContaining(
        "is not a valid hostname or IP address",
      ),
    });
    expect(report.statusMessage).toContain("not a valid host!!");
  });

  /*
   * Hostname.isValid accepts a whole URL authority — "user@host",
   * "host:port", "[::1]", a space inside the userinfo — because webhook
   * URLs need it, and `new Hostname` keeps the entire string. The ping
   * runner hands that string to ping(8)'s argv verbatim, so a device whose
   * hostname carries any of those must become a Failed report here, never
   * a process argument. A leading "-" is an option to ping(8), not a host.
   */
  test.each([
    "admin@10.0.0.7",
    "switch1:161",
    "-f.example.com",
    "-f@example.com",
    "[2001:db8::1]",
    "core-sw1.example.com/32",
    "core sw1",
  ])(
    '"%s" is not a ping target: Failed report with the reason, and no ping',
    async (hostname: string): Promise<void> => {
      const report: NetworkDeviceDiagnosticReport = await runDiagnostic(
        makePingJob({ hostname: hostname }),
      );

      expect(pingSpy).not.toHaveBeenCalled();
      expect(report.status).toBe(NetworkDeviceDiagnosticStatus.Failed);
      expect(report.statusMessage).toBe(
        `"${hostname}" is not a valid hostname or IP address.`,
      );
    },
  );

  test("a plain DNS name passes the guard and is pinged", async () => {
    await runDiagnostic(makePingJob({ hostname: "core-sw1.example.com" }));

    expect(pingSpy).toHaveBeenCalledTimes(1);
    expect((pingCallArg().host as Hostname).hostname).toBe(
      "core-sw1.example.com",
    );
  });

  test("a job with no hostname is a Failed report, with no ping and no trace", async () => {
    const report: NetworkDeviceDiagnosticReport = await runDiagnostic(
      makePingJob({ hostname: "" }),
    );

    expect(pingSpy).not.toHaveBeenCalled();
    expect(traceSpy).not.toHaveBeenCalled();
    expect(report.status).toBe(NetworkDeviceDiagnosticStatus.Failed);
    expect(report.statusMessage).toContain("no hostname or IP address");
  });

  test("an unknown diagnostic type is a Failed report naming the type, with no ping and no trace", async () => {
    const report: NetworkDeviceDiagnosticReport = await runDiagnostic(
      makePingJob({ diagnosticType: "PortScan" }),
    );

    expect(pingSpy).not.toHaveBeenCalled();
    expect(traceSpy).not.toHaveBeenCalled();
    expect(report.status).toBe(NetworkDeviceDiagnosticStatus.Failed);
    expect(report.statusMessage).toContain("Unsupported diagnostic type");
    expect(report.statusMessage).toContain("PortScan");
  });

  test("a runner that throws becomes a Failed report with the error, and is still posted", async () => {
    jest.spyOn(logger, "error").mockImplementation(() => {
      // Keep test output clean.
    });
    pingSpy.mockRejectedValue(new Error("spawn EAGAIN"));
    fetchSpy.mockResolvedValueOnce({
      data: { diagnostics: [makePingJob()] },
    } as never);

    await expect(fetchAndRunDiagnostics()).resolves.toBeUndefined();

    const body: JSONObject = soleIngestBody();
    expect(body["networkDeviceDiagnosticId"]).toBe("diag-1");
    expect(body["status"]).toBe("Failed");
    expect(body["statusMessage"]).toBe("spawn EAGAIN");
    expect("pingResult" in body).toBe(false);
  });

  test("a trace that throws becomes a Failed report too", async () => {
    jest.spyOn(logger, "error").mockImplementation(() => {
      // Keep test output clean.
    });
    traceSpy.mockRejectedValue(new Error("traceroute: not found"));

    const report: NetworkDeviceDiagnosticReport =
      await runDiagnostic(makeTracerouteJob());

    expect(report.status).toBe(NetworkDeviceDiagnosticStatus.Failed);
    expect(report.statusMessage).toBe("traceroute: not found");
  });

  test("a failing report POST is logged, not thrown — the batch must keep going", async () => {
    // eslint-disable-next-line @typescript-eslint/typedef
    const errorSpy = jest.spyOn(logger, "error").mockImplementation(() => {
      // Keep test output clean.
    });
    fetchSpy.mockRejectedValue(new Error("ingest unreachable") as never);

    await expect(
      reportDiagnosticResult(await runDiagnostic(makePingJob())),
    ).resolves.toBeUndefined();

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("diag-1"));
  });

  /*
   * The other way a report can fail: the server answers and refuses it
   * ("Diagnostic not found for this probe" — the row was claimed by another
   * probe, deleted, or the id was wrong). API.fetch hands that back as an
   * HTTPErrorResponse rather than throwing, so a try/catch alone would call
   * it a success, and the only record of why the row never settled is lost.
   */
  test("a report POST the server rejects (4xx/5xx) is logged with the status code and the reason, not thrown", async () => {
    // eslint-disable-next-line @typescript-eslint/typedef
    const errorSpy = jest.spyOn(logger, "error").mockImplementation(() => {
      // Keep test output clean.
    });
    fetchSpy.mockResolvedValue(
      new HTTPErrorResponse(
        400,
        { message: "Diagnostic not found for this probe" },
        {},
      ) as never,
    );

    await expect(
      reportDiagnosticResult(await runDiagnostic(makePingJob())),
    ).resolves.toBeUndefined();

    expect(errorSpy).toHaveBeenCalledTimes(1);
    const logged: string = String(errorSpy.mock.calls[0]![0]);
    expect(logged).toContain("diag-1");
    expect(logged).toContain("HTTP 400");
    expect(logged).toContain("Diagnostic not found for this probe");
  });

  test("an accepted report logs nothing", async () => {
    // eslint-disable-next-line @typescript-eslint/typedef
    const errorSpy = jest.spyOn(logger, "error").mockImplementation(() => {
      // Keep test output clean.
    });
    fetchSpy.mockResolvedValue(
      new HTTPResponse<JSONObject>(200, { result: "ok" }, {}) as never,
    );

    await reportDiagnosticResult(await runDiagnostic(makePingJob()));

    expect(errorSpy).not.toHaveBeenCalled();
  });

  test("a rejected report does not stop the rest of the batch from being reported", async () => {
    // eslint-disable-next-line @typescript-eslint/typedef
    const errorSpy = jest.spyOn(logger, "error").mockImplementation(() => {
      // Keep test output clean.
    });
    fetchSpy.mockResolvedValue(
      new HTTPErrorResponse(
        400,
        { message: "Diagnostic not found for this probe" },
        {},
      ) as never,
    );

    await runDiagnostics([
      makePingJob({ id: "diag-1" }),
      makePingJob({ id: "diag-2" }),
      makePingJob({ id: "diag-3" }),
    ]);

    expect(ingestCalls()).toHaveLength(3);
    expect(errorSpy).toHaveBeenCalledTimes(3);
  });

  test("a job with no id is skipped with a warning — there is no row to report to", async () => {
    // eslint-disable-next-line @typescript-eslint/typedef
    const warnSpy = jest.spyOn(logger, "warn").mockImplementation(() => {
      // Keep test output clean.
    });

    await runDiagnostics([makePingJob({ id: "" })]);

    expect(pingSpy).not.toHaveBeenCalled();
    expect(ingestCalls()).toHaveLength(0);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("no id"));
  });
});

describe("runDiagnostics — batching", () => {
  test("every job in a batch is reported, even when some fail", async () => {
    jest.spyOn(logger, "error").mockImplementation(() => {
      // Keep test output clean.
    });
    const jobs: Array<NetworkDeviceDiagnosticJob> = Array.from(
      { length: 7 },
      (_unused: unknown, index: number) => {
        return makePingJob({ id: `diag-${index + 1}` });
      },
    );

    // Pings 2 and 6 blow up; the rest of both batches must still run.
    pingSpy
      .mockResolvedValueOnce(makePingResult())
      .mockRejectedValueOnce(new Error("ping failed"))
      .mockResolvedValueOnce(makePingResult())
      .mockResolvedValueOnce(makePingResult())
      .mockResolvedValueOnce(makePingResult())
      .mockRejectedValueOnce(new Error("ping failed"))
      .mockResolvedValueOnce(makePingResult());

    await runDiagnostics(jobs);

    expect(pingSpy).toHaveBeenCalledTimes(7);

    const reportedIds: Array<unknown> = ingestCalls()
      .map((call: FetchCall) => {
        return call.body["networkDeviceDiagnosticId"];
      })
      .sort();
    expect(reportedIds).toEqual([
      "diag-1",
      "diag-2",
      "diag-3",
      "diag-4",
      "diag-5",
      "diag-6",
      "diag-7",
    ]);

    const failed: Array<FetchCall> = ingestCalls().filter((call: FetchCall) => {
      return call.body["status"] === "Failed";
    });
    expect(failed).toHaveLength(2);
  });

  /*
   * The batch is a bound, not a target: a burst of traceroutes must not
   * fork more processes at once than the bound, or one person's twelve
   * clicks starve the probe's other work.
   */
  test("never runs more diagnostics at once than DIAGNOSTIC_CONCURRENCY", async () => {
    expect(DIAGNOSTIC_CONCURRENCY).toBe(5);

    const jobs: Array<NetworkDeviceDiagnosticJob> = Array.from(
      { length: 12 },
      (_unused: unknown, index: number) => {
        return makePingJob({ id: `diag-${index + 1}` });
      },
    );

    let inFlight: number = 0;
    let peakInFlight: number = 0;

    pingSpy.mockImplementation(
      async (): Promise<NetworkDeviceDiagnosticPingResult> => {
        inFlight++;
        peakInFlight = Math.max(peakInFlight, inFlight);
        await flushMicrotasks();
        inFlight--;
        return makePingResult();
      },
    );

    await runDiagnostics(jobs);

    expect(peakInFlight).toBeLessThanOrEqual(DIAGNOSTIC_CONCURRENCY);
    expect(peakInFlight).toBeGreaterThan(1);
    // And every job was still run and reported.
    expect(pingSpy).toHaveBeenCalledTimes(12);
    expect(ingestCalls()).toHaveLength(12);
  });
});
