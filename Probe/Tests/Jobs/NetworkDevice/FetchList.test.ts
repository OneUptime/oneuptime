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
import Hostname from "Common/Types/API/Hostname";
import IPv4 from "Common/Types/IP/IPv4";
import IPv6 from "Common/Types/IP/IPv6";
import { JSONObject } from "Common/Types/JSON";
import SnmpMonitorResponse from "Common/Types/Monitor/SnmpMonitor/SnmpMonitorResponse";
import API from "Common/Utils/API";
import logger from "Common/Server/Utils/Logger";
import PingMonitor, {
  DeviceReachabilityCheck,
} from "../../../Utils/Monitors/MonitorTypes/PingMonitor";
import SnmpMonitor from "../../../Utils/Monitors/MonitorTypes/SnmpMonitor";
import {
  DevicePollConfig,
  fetchAndPollDevices,
  pollDevice,
  pollDevices,
} from "../../../Jobs/NetworkDevice/FetchList";
import { PROBE_NETWORK_DEVICE_POLL_CONCURRENCY } from "../../../Config";

/*
 * The probe's half of device-owned polling:
 *
 *   POST <ingest>/probe/network-device/list            → devices due for a poll
 *   (ping each device; ALSO walk it over SNMP when the server says it has
 *    credentials — in parallel, PROBE_NETWORK_DEVICE_POLL_CONCURRENCY
 *    devices at a time)
 *   POST <ingest>/probe/network-device/response/ingest → one result per device
 *
 * These tests pin the request contract the probe sends — URLs, per-device
 * ingest bodies (isOnline / pollMode / pingResponse / snmpResponse), and the
 * synthesized failure responses — because the server records reachability
 * and evaluates Network Device monitors from these ingested polls: a device
 * the probe silently drops never alerts as unreachable.
 *
 * Neither the OS ping binary nor an SNMP socket is ever touched:
 * PingMonitor.checkReachability and SnmpMonitor.query are spied on.
 */

function makeDevice(overrides?: Record<string, unknown>): DevicePollConfig {
  return {
    networkDeviceId: "device-1",
    projectId: "project-1",
    hostname: "10.0.0.5",
    pollMode: "snmp",
    collectEndpoints: false,
    snmpMonitor: {
      snmpVersion: "V2c",
      hostname: "10.0.0.5",
      port: 161,
      communityString: "public",
      oids: [],
      timeout: 5000,
      retries: 3,
    },
    ...overrides,
  } as unknown as DevicePollConfig;
}

// What a server that predates ping-first polling sends: SNMP config only.
function makeLegacyDevice(
  overrides?: Record<string, unknown>,
): DevicePollConfig {
  return makeDevice({ hostname: undefined, pollMode: undefined, ...overrides });
}

// A credential-less device: the server sends no SNMP config at all.
function makePingOnlyDevice(
  overrides?: Record<string, unknown>,
): DevicePollConfig {
  return makeDevice({ pollMode: "ping", snmpMonitor: undefined, ...overrides });
}

function makeSnmpResponse(
  overrides?: Partial<SnmpMonitorResponse>,
): SnmpMonitorResponse {
  return {
    isOnline: true,
    responseTimeInMs: 42,
    failureCause: "",
    oidResponses: [
      { oid: "1.3.6.1.2.1.1.5.0", value: "sw1", type: "OctetString" },
    ],
    ...overrides,
  } as SnmpMonitorResponse;
}

function makePingOk(
  overrides?: Partial<DeviceReachabilityCheck>,
): DeviceReachabilityCheck {
  return {
    isOnline: true,
    avgRttMs: 1.3,
    packetLossPercent: 0,
    failureCause: "",
    ...overrides,
  };
}

function makePingDown(
  overrides?: Partial<DeviceReachabilityCheck>,
): DeviceReachabilityCheck {
  return {
    isOnline: false,
    avgRttMs: null,
    packetLossPercent: 100,
    failureCause: "No ICMP echo reply from 10.0.0.5 (2 sent)",
    ...overrides,
  };
}

// eslint-disable-next-line @typescript-eslint/typedef
let fetchSpy = jest.spyOn(API, "fetch");
// eslint-disable-next-line @typescript-eslint/typedef
let querySpy = jest.spyOn(SnmpMonitor, "query");
// eslint-disable-next-line @typescript-eslint/typedef
let pingSpy = jest.spyOn(PingMonitor, "checkReachability");

beforeEach(() => {
  fetchSpy = jest.spyOn(API, "fetch").mockResolvedValue({ data: {} } as never);
  querySpy = jest
    .spyOn(SnmpMonitor, "query")
    .mockResolvedValue(makeSnmpResponse() as never);
  pingSpy = jest
    .spyOn(PingMonitor, "checkReachability")
    .mockResolvedValue(makePingOk());
});

afterEach(() => {
  jest.restoreAllMocks();
});

type FetchCall = {
  url: string;
  body: JSONObject;
};

function fetchCalls(): Array<FetchCall> {
  return fetchSpy.mock.calls.map((call: Array<unknown>) => {
    const arg: JSONObject = call[0] as JSONObject;
    return {
      url: String(arg["url"]),
      body: arg["data"] as JSONObject,
    };
  });
}

function ingestCalls(): Array<FetchCall> {
  return fetchCalls().filter((call: FetchCall) => {
    return call.url.endsWith("/probe/network-device/response/ingest");
  });
}

function soleIngestBody(): JSONObject {
  const ingested: Array<FetchCall> = ingestCalls();
  expect(ingested).toHaveLength(1);
  return ingested[0]!.body;
}

function pingTarget(callIndex: number = 0): Hostname | IPv4 | IPv6 {
  const call: Array<unknown> | undefined = pingSpy.mock.calls[callIndex];
  if (!call) {
    throw new Error(`checkReachability was not called ${callIndex + 1}x`);
  }
  return (call[0] as { host: Hostname | IPv4 | IPv6 }).host;
}

function pingTimeoutMs(callIndex: number = 0): number | undefined {
  const call: Array<unknown> | undefined = pingSpy.mock.calls[callIndex];
  if (!call) {
    throw new Error(`checkReachability was not called ${callIndex + 1}x`);
  }
  return (call[0] as { timeoutMs?: number | undefined }).timeoutMs;
}

describe("fetchAndPollDevices — fetching this probe's due devices", () => {
  test("asks the probe-ingest list endpoint, authenticated as this probe", async () => {
    await fetchAndPollDevices();

    const calls: Array<FetchCall> = fetchCalls();
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url.endsWith("/probe/network-device/list")).toBe(true);
    expect(calls[0]!.body["probeId"]).toBe(
      "11111111-2222-3333-4444-555555555555",
    );
    expect(calls[0]!.body["probeKey"]).toBe("test-probe-key");
  });

  /*
   * The capability gate. The server only hands ping-only (credential-less)
   * devices to a probe that says it can ping them — an older probe would
   * walk such a device with community "public" and report it Down.
   */
  test("declares the networkDevicePing capability on the list fetch", async () => {
    await fetchAndPollDevices();

    expect(fetchCalls()[0]!.body["probeCapabilities"]).toEqual([
      "networkDevicePing",
    ]);
  });

  test("no due devices: no ping, no SNMP walk, no ingest report", async () => {
    fetchSpy.mockResolvedValueOnce({ data: { devices: [] } } as never);

    await fetchAndPollDevices();

    expect(pingSpy).not.toHaveBeenCalled();
    expect(querySpy).not.toHaveBeenCalled();
    expect(fetchCalls()).toHaveLength(1);
    expect(ingestCalls()).toHaveLength(0);
  });

  test("a response with no devices key at all is treated as an empty list", async () => {
    // beforeEach default: { data: {} }
    await fetchAndPollDevices();

    expect(pingSpy).not.toHaveBeenCalled();
    expect(querySpy).not.toHaveBeenCalled();
    expect(fetchCalls()).toHaveLength(1);
  });

  test("polls every device the server hands out and reports each result", async () => {
    fetchSpy.mockResolvedValueOnce({
      data: {
        devices: [
          makeDevice({ networkDeviceId: "device-1" }),
          makePingOnlyDevice({
            networkDeviceId: "device-2",
            hostname: "10.0.0.6",
          }),
        ],
      },
    } as never);

    await fetchAndPollDevices();

    expect(pingSpy).toHaveBeenCalledTimes(2);
    // Only the credentialed device is walked.
    expect(querySpy).toHaveBeenCalledTimes(1);

    // 1 list call + 2 ingest reports.
    const calls: Array<FetchCall> = fetchCalls();
    expect(calls).toHaveLength(3);
    expect(calls[0]!.url.endsWith("/probe/network-device/list")).toBe(true);

    const ingested: Array<FetchCall> = ingestCalls();
    expect(ingested).toHaveLength(2);
    const reportedIds: Array<unknown> = ingested.map((call: FetchCall) => {
      return call.body["networkDeviceId"];
    });
    expect(reportedIds.sort()).toEqual(["device-1", "device-2"]);
  });
});

describe("pollDevice — unpollable configs are skipped, not reported", () => {
  test("a device without an id is skipped: no ping, no walk, no ingest", async () => {
    await pollDevice(makeDevice({ networkDeviceId: undefined }));

    expect(pingSpy).not.toHaveBeenCalled();
    expect(querySpy).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("a device with neither a hostname nor an SNMP hostname is skipped with a warning", async () => {
    // eslint-disable-next-line @typescript-eslint/typedef
    const warnSpy = jest.spyOn(logger, "warn").mockImplementation(() => {
      // Keep test output clean.
    });

    await pollDevice(
      makeDevice({
        hostname: undefined,
        snmpMonitor: { hostname: "", timeout: 5000 },
      }),
    );

    expect(pingSpy).not.toHaveBeenCalled();
    expect(querySpy).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("missing device id or hostname"),
    );
  });

  test("a device with no hostname and no SNMP config at all is skipped", async () => {
    await pollDevice(
      makeDevice({ hostname: undefined, snmpMonitor: undefined }),
    );

    expect(pingSpy).not.toHaveBeenCalled();
    expect(querySpy).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  /*
   * The old rule was "no SNMP hostname → skip". That rule is gone: a
   * device with no credentials has no SNMP config, and it is exactly the
   * device that must now be pinged.
   */
  test("a device with a hostname but no SNMP config is NOT skipped — it is pinged", async () => {
    await pollDevice(makePingOnlyDevice());

    expect(pingSpy).toHaveBeenCalledTimes(1);
    expect(querySpy).not.toHaveBeenCalled();
    expect(ingestCalls()).toHaveLength(1);
  });
});

/*
 * The poll matrix. isOnline is "reachable by ping OR by SNMP"; the two
 * verdicts travel separately so the server can tell a dark device from one
 * whose SNMP is misconfigured.
 */
describe("pollDevice — the ping/SNMP verdict matrix", () => {
  test("ping ok + snmp mode: walks, reports both verdicts, isOnline true", async () => {
    const walk: SnmpMonitorResponse = makeSnmpResponse({ responseTimeInMs: 7 });
    querySpy.mockResolvedValue(walk as never);

    await pollDevice(makeDevice());

    expect(pingSpy).toHaveBeenCalledTimes(1);
    expect(querySpy).toHaveBeenCalledTimes(1);

    const body: JSONObject = soleIngestBody();
    expect(body["isOnline"]).toBe(true);
    expect(body["pollMode"]).toBe("snmp");
    expect(body["pingResponse"]).toEqual(makePingOk());
    expect(body["snmpResponse"]).toEqual(walk);
  });

  /*
   * THE rule of ping-first polling: the walk is never gated on the ping.
   * Gear that filters ICMP but answers SNMP must stay Up.
   */
  test("ping fails + snmp mode: STILL walks, and a good walk keeps the device online", async () => {
    pingSpy.mockResolvedValue(makePingDown());

    await pollDevice(makeDevice());

    expect(querySpy).toHaveBeenCalledTimes(1);

    const body: JSONObject = soleIngestBody();
    expect(body["isOnline"]).toBe(true);
    expect(body["pollMode"]).toBe("snmp");
    expect((body["pingResponse"] as JSONObject)["isOnline"]).toBe(false);
    expect((body["snmpResponse"] as JSONObject)["isOnline"]).toBe(true);
  });

  test("ping fails + snmp mode + walk fails: isOnline is the walk verdict — false", async () => {
    pingSpy.mockResolvedValue(makePingDown());
    querySpy.mockResolvedValue(
      makeSnmpResponse({
        isOnline: false,
        failureCause: "Request timed out",
      }) as never,
    );

    await pollDevice(makeDevice());

    const body: JSONObject = soleIngestBody();
    expect(body["isOnline"]).toBe(false);
    expect((body["pingResponse"] as JSONObject)["isOnline"]).toBe(false);
    expect((body["snmpResponse"] as JSONObject)["isOnline"]).toBe(false);
  });

  test("ping ok + ping mode: never walks, no snmpResponse key at all, isOnline true", async () => {
    await pollDevice(makePingOnlyDevice());

    expect(querySpy).not.toHaveBeenCalled();

    const body: JSONObject = soleIngestBody();
    expect(body["isOnline"]).toBe(true);
    expect(body["pollMode"]).toBe("ping");
    expect(body["pingResponse"]).toEqual(makePingOk());
    /*
     * ABSENT, not null and not a synthesized failure: the server reads a
     * missing snmpResponse as "no walk was attempted" (isSnmpReachable
     * NULL). A synthesized one would record every ping-only device as
     * SNMP-unreachable.
     */
    expect("snmpResponse" in body).toBe(false);
  });

  test("ping fails + ping mode: isOnline false with the ping's failure cause", async () => {
    pingSpy.mockResolvedValue(makePingDown());

    await pollDevice(makePingOnlyDevice());

    expect(querySpy).not.toHaveBeenCalled();

    const body: JSONObject = soleIngestBody();
    expect(body["isOnline"]).toBe(false);
    expect(body["pollMode"]).toBe("ping");
    expect((body["pingResponse"] as JSONObject)["failureCause"]).toBe(
      "No ICMP echo reply from 10.0.0.5 (2 sent)",
    );
    expect("snmpResponse" in body).toBe(false);
  });

  /*
   * A device on an snmp poll answers ping but the walk blows up (a wrong
   * community, a v3 auth failure). The device is reachable; the walk
   * failure is reported beside that so the server can say so.
   */
  test("ping ok + snmp mode + walk throws: snmpResponse is the failure response, isOnline follows the ping", async () => {
    querySpy.mockRejectedValue(new Error("SNMPv3 auth failed") as never);

    await expect(pollDevice(makeDevice())).resolves.toBeUndefined();

    const body: JSONObject = soleIngestBody();
    expect(body["isOnline"]).toBe(true);
    expect(body["snmpResponse"]).toEqual({
      isOnline: false,
      responseTimeInMs: 0,
      failureCause: "SNMPv3 auth failed",
      oidResponses: [],
    });
  });

  test("ping fails + snmp mode + walk throws: isOnline false, both failures reported", async () => {
    pingSpy.mockResolvedValue(makePingDown());
    querySpy.mockRejectedValue(new Error("SNMPv3 auth failed") as never);

    await pollDevice(makeDevice());

    const body: JSONObject = soleIngestBody();
    expect(body["isOnline"]).toBe(false);
    expect((body["snmpResponse"] as JSONObject)["failureCause"]).toBe(
      "SNMPv3 auth failed",
    );
    expect((body["pingResponse"] as JSONObject)["failureCause"]).toBe(
      "No ICMP echo reply from 10.0.0.5 (2 sent)",
    );
  });

  test("a walk that returns null posts a synthesized SNMP failure beside the ping verdict", async () => {
    querySpy.mockResolvedValue(null as never);

    await pollDevice(makeDevice());

    const body: JSONObject = soleIngestBody();
    expect(body["isOnline"]).toBe(true);

    const snmpResponse: JSONObject = body["snmpResponse"] as JSONObject;
    expect(snmpResponse["isOnline"]).toBe(false);
    expect(snmpResponse["responseTimeInMs"]).toBe(0);
    expect(snmpResponse["failureCause"]).toBe(
      "SNMP query returned no response",
    );
    expect(snmpResponse["oidResponses"]).toEqual([]);
  });

  test("the ping and the walk run in parallel — the walk starts before the ping has answered", async () => {
    let releasePing: (value: DeviceReachabilityCheck) => void = () => {
      // Replaced below.
    };
    pingSpy.mockReturnValue(
      new Promise<DeviceReachabilityCheck>(
        (resolve: (value: DeviceReachabilityCheck) => void) => {
          releasePing = resolve;
        },
      ),
    );

    const polling: Promise<void> = pollDevice(makeDevice());
    await new Promise<void>((resolve: () => void) => {
      setImmediate(resolve);
    });

    // The ping is still pending, yet the walk has already been asked for.
    expect(querySpy).toHaveBeenCalledTimes(1);
    expect(ingestCalls()).toHaveLength(0);

    releasePing(makePingOk());
    await polling;

    expect(ingestCalls()).toHaveLength(1);
  });
});

describe("pollDevice — old-server compatibility (no hostname, no pollMode)", () => {
  test("infers an snmp poll and pings the SNMP config's hostname", async () => {
    await pollDevice(makeLegacyDevice());

    expect(pingSpy).toHaveBeenCalledTimes(1);
    expect(pingTarget().toString()).toBe("10.0.0.5");
    expect(querySpy).toHaveBeenCalledTimes(1);

    const body: JSONObject = soleIngestBody();
    expect(body["pollMode"]).toBe("snmp");
    expect(body["isOnline"]).toBe(true);
    expect(body["snmpResponse"]).toEqual(makeSnmpResponse());
  });

  test("an snmp pollMode with no SNMP config to walk degrades to a ping poll, with a warning", async () => {
    // eslint-disable-next-line @typescript-eslint/typedef
    const warnSpy = jest.spyOn(logger, "warn").mockImplementation(() => {
      // Keep test output clean.
    });

    await pollDevice(makeDevice({ pollMode: "snmp", snmpMonitor: undefined }));

    expect(querySpy).not.toHaveBeenCalled();
    expect(pingSpy).toHaveBeenCalledTimes(1);

    const body: JSONObject = soleIngestBody();
    // Reported as what actually ran, so the server does not read the missing walk as lost.
    expect(body["pollMode"]).toBe("ping");
    expect("snmpResponse" in body).toBe(false);
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("without an SNMP config"),
    );
  });

  test("an explicit ping pollMode is honoured even when an SNMP config is present", async () => {
    await pollDevice(makeDevice({ pollMode: "ping" }));

    expect(querySpy).not.toHaveBeenCalled();
    expect(soleIngestBody()["pollMode"]).toBe("ping");
  });
});

describe("pollDevice — the ping target", () => {
  test("an IPv4 literal is pinged as an IPv4", async () => {
    await pollDevice(makePingOnlyDevice({ hostname: "192.0.2.25" }));

    expect(pingTarget()).toBeInstanceOf(IPv4);
    expect(pingTarget().toString()).toBe("192.0.2.25");
  });

  test("an IPv6 literal is pinged as an IPv6 (colons must not be read as a port)", async () => {
    await pollDevice(makePingOnlyDevice({ hostname: "2001:db8::25" }));

    expect(pingTarget()).toBeInstanceOf(IPv6);
    expect(pingTarget().toString()).toBe("2001:db8::25");
  });

  test("a DNS name is pinged as a Hostname", async () => {
    await pollDevice(makePingOnlyDevice({ hostname: "core-sw1.example.net" }));

    expect(pingTarget()).toBeInstanceOf(Hostname);
    expect((pingTarget() as Hostname).hostname).toBe("core-sw1.example.net");
  });

  test("the device's hostname wins over the SNMP config's hostname", async () => {
    await pollDevice(
      makeDevice({
        hostname: "10.0.0.7",
        snmpMonitor: { hostname: "10.0.0.5", timeout: 5000 },
      }),
    );

    expect(pingTarget().toString()).toBe("10.0.0.7");
  });

  test("the ping borrows the SNMP config's timeout so one device has one poll budget", async () => {
    await pollDevice(
      makeDevice({ snmpMonitor: { hostname: "10.0.0.5", timeout: 8000 } }),
    );

    expect(pingTimeoutMs()).toBe(8000);
  });

  test("a ping-only device (no SNMP config) pings with the 5s default", async () => {
    await pollDevice(makePingOnlyDevice());

    expect(pingTimeoutMs()).toBe(5000);
  });
});

describe("pollDevice — a successful poll's report", () => {
  test("posts to the ingest endpoint, authenticated as this probe, with a parseable monitoredAt", async () => {
    await pollDevice(makeDevice());

    const calls: Array<FetchCall> = fetchCalls();
    expect(calls).toHaveLength(1);
    expect(
      calls[0]!.url.endsWith("/probe/network-device/response/ingest"),
    ).toBe(true);

    const body: JSONObject = calls[0]!.body;
    expect(body["networkDeviceId"]).toBe("device-1");
    expect(body["probeId"]).toBe("11111111-2222-3333-4444-555555555555");
    expect(body["probeKey"]).toBe("test-probe-key");

    // monitoredAt is a parseable ISO-8601 timestamp string.
    const monitoredAt: string = body["monitoredAt"] as string;
    expect(typeof monitoredAt).toBe("string");
    expect(monitoredAt).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
    );
    expect(new Date(monitoredAt).toISOString()).toBe(monitoredAt);
  });

  /*
   * The exact wire shape the server's ingest handler reads. Pinned as a
   * key set so a renamed or dropped field fails here, not in production
   * where it would silently stop a column from being written.
   */
  test("carries exactly: auth, networkDeviceId, isOnline, pollMode, pingResponse, snmpResponse, monitoredAt", async () => {
    await pollDevice(makeDevice());

    expect(Object.keys(soleIngestBody()).sort()).toEqual([
      "isOnline",
      "monitoredAt",
      "networkDeviceId",
      "pingResponse",
      "pollMode",
      "probeCapabilities",
      "probeId",
      "probeKey",
      "snmpResponse",
    ]);
  });

  test("a ping-only report carries the same keys minus snmpResponse", async () => {
    await pollDevice(makePingOnlyDevice());

    expect(Object.keys(soleIngestBody()).sort()).toEqual([
      "isOnline",
      "monitoredAt",
      "networkDeviceId",
      "pingResponse",
      "pollMode",
      "probeCapabilities",
      "probeId",
      "probeKey",
    ]);
  });

  test("pingResponse carries the reachability check's four fields verbatim", async () => {
    pingSpy.mockResolvedValue(
      makePingOk({ avgRttMs: 12.5, packetLossPercent: 50 }),
    );

    await pollDevice(makePingOnlyDevice());

    expect(soleIngestBody()["pingResponse"]).toEqual({
      isOnline: true,
      avgRttMs: 12.5,
      packetLossPercent: 50,
      failureCause: "",
    });
  });

  test("walks with the device's SNMP config and its configured timeout", async () => {
    const device: DevicePollConfig = makeDevice();

    await pollDevice(device);

    expect(querySpy).toHaveBeenCalledTimes(1);
    expect(querySpy.mock.calls[0]![0]).toBe(device.snmpMonitor);
    expect((querySpy.mock.calls[0]![1] as JSONObject)["timeout"]).toBe(5000);
  });

  /*
   * Endpoint collection means extra SNMP table walks on every poll, so it is
   * strictly opt-in: only a literal true from the device row turns it on.
   */
  test("collectEndpoints true is passed through to the walk", async () => {
    await pollDevice(makeDevice({ collectEndpoints: true }));

    expect((querySpy.mock.calls[0]![1] as JSONObject)["collectEndpoints"]).toBe(
      true,
    );
  });

  test.each([
    ["false", false],
    ["undefined", undefined],
    ["a truthy non-boolean", "true"],
  ])(
    "collectEndpoints %s means no endpoint collection",
    async (_label: string, value: unknown) => {
      await pollDevice(makeDevice({ collectEndpoints: value }));

      expect(
        (querySpy.mock.calls[0]![1] as JSONObject)["collectEndpoints"],
      ).toBe(false);
    },
  );
});

describe("pollDevice — failures are reported, never swallowed", () => {
  /*
   * A hostname that is neither an IP nor a valid DNS name cannot even be
   * turned into a ping target. That is a failed poll, not a skipped one:
   * the device has an id and an address, so the server is waiting on a
   * verdict, and silence would leave it on its previous one forever.
   */
  test("an address that cannot become a ping target posts a failure body, and does not throw", async () => {
    jest.spyOn(logger, "error").mockImplementation(() => {
      // Keep test output clean.
    });

    await expect(
      pollDevice(makeDevice({ hostname: "not a valid host!!" })),
    ).resolves.toBeUndefined();

    expect(pingSpy).not.toHaveBeenCalled();
    expect(querySpy).not.toHaveBeenCalled();

    const body: JSONObject = soleIngestBody();
    expect(body["networkDeviceId"]).toBe("device-1");
    expect(body["isOnline"]).toBe(false);
    expect(body["pollMode"]).toBe("snmp");
    expect(body["pingResponse"]).toEqual({
      isOnline: false,
      avgRttMs: null,
      packetLossPercent: null,
      failureCause: expect.stringContaining("not in valid format"),
    });
    // No walk ran, so none is reported — even in snmp mode.
    expect("snmpResponse" in body).toBe(false);
  });

  test("a failing ingest report is logged, not thrown — the batch must keep going", async () => {
    // eslint-disable-next-line @typescript-eslint/typedef
    const errorSpy = jest.spyOn(logger, "error").mockImplementation(() => {
      // Keep test output clean.
    });
    fetchSpy.mockRejectedValue(new Error("ingest unreachable") as never);

    await expect(pollDevice(makeDevice())).resolves.toBeUndefined();

    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("device-1"));
  });
});

describe("fetchAndPollDevices — batching", () => {
  test("all devices beyond one concurrency batch are polled, even when some walks fail", async () => {
    /*
     * 7 devices, which is fewer than the default concurrency — the point of
     * this case is the fault isolation, not the batching, and it holds
     * however the batch is sized. The batching itself is pinned below.
     */
    const devices: Array<DevicePollConfig> = Array.from(
      { length: 7 },
      (_unused: unknown, index: number) => {
        return makeDevice({ networkDeviceId: `device-${index + 1}` });
      },
    );
    fetchSpy.mockResolvedValueOnce({ data: { devices: devices } } as never);

    // Walks 2 and 6 blow up; the rest of both batches must still run.
    querySpy
      .mockResolvedValueOnce(makeSnmpResponse() as never)
      .mockRejectedValueOnce(new Error("walk failed") as never)
      .mockResolvedValueOnce(makeSnmpResponse() as never)
      .mockResolvedValueOnce(makeSnmpResponse() as never)
      .mockResolvedValueOnce(makeSnmpResponse() as never)
      .mockRejectedValueOnce(new Error("walk failed") as never)
      .mockResolvedValueOnce(makeSnmpResponse() as never);

    await fetchAndPollDevices();

    expect(querySpy).toHaveBeenCalledTimes(7);
    expect(pingSpy).toHaveBeenCalledTimes(7);

    // Every device reports back — failed walks as SNMP failure responses.
    const ingested: Array<FetchCall> = ingestCalls();
    expect(ingested).toHaveLength(7);
    const reportedIds: Array<unknown> = ingested
      .map((call: FetchCall) => {
        return call.body["networkDeviceId"];
      })
      .sort();
    expect(reportedIds).toEqual([
      "device-1",
      "device-2",
      "device-3",
      "device-4",
      "device-5",
      "device-6",
      "device-7",
    ]);
  });
});

/*
 * The probe half of the fleet's poll cadence.
 *
 * A probe fetches once a minute and the server advances every claimed
 * device's nextPollAt at claim time, so a probe that cannot get through a
 * batch inside its cycle does not poll those devices late — it skips them.
 * At the old fixed concurrency of 5 that ceiling was low enough that a
 * large fleet fell minutes behind its configured intervals, which is the
 * throughput half of issue #3220.
 */
describe("PROBE_NETWORK_DEVICE_POLL_CONCURRENCY", () => {
  test("defaults wide enough to keep a real fleet on cadence", () => {
    expect(PROBE_NETWORK_DEVICE_POLL_CONCURRENCY).toBeGreaterThanOrEqual(25);
  });

  test("polls run concurrently up to the configured width", async () => {
    const deviceCount: number = PROBE_NETWORK_DEVICE_POLL_CONCURRENCY;
    const devices: Array<DevicePollConfig> = Array.from(
      { length: deviceCount },
      (_unused: unknown, index: number) => {
        return makeDevice({ networkDeviceId: `device-${index + 1}` });
      },
    );

    let inFlight: number = 0;
    let peakInFlight: number = 0;
    const releases: Array<() => void> = [];

    querySpy.mockImplementation((): Promise<SnmpMonitorResponse> => {
      inFlight++;
      peakInFlight = Math.max(peakInFlight, inFlight);

      return new Promise<SnmpMonitorResponse>(
        (resolve: (value: SnmpMonitorResponse) => void) => {
          releases.push(() => {
            inFlight--;
            resolve(makeSnmpResponse());
          });
        },
      );
    });

    const polling: Promise<void> = pollDevices(devices);

    // Let every walk in the first batch start.
    await new Promise<void>((resolve: () => void) => {
      setImmediate(resolve);
    });

    expect(peakInFlight).toBe(deviceCount);

    for (const release of [...releases]) {
      release();
    }
    await polling;
  });

  /*
   * The batch is a bound, not a target: it must not fan out past the
   * configured width, or a probe with thousands of devices opens thousands
   * of sockets at once.
   */
  test("never runs more polls at once than the configured width", async () => {
    const devices: Array<DevicePollConfig> = Array.from(
      { length: PROBE_NETWORK_DEVICE_POLL_CONCURRENCY * 2 + 3 },
      (_unused: unknown, index: number) => {
        return makeDevice({ networkDeviceId: `device-${index + 1}` });
      },
    );

    let inFlight: number = 0;
    let peakInFlight: number = 0;

    querySpy.mockImplementation(async (): Promise<SnmpMonitorResponse> => {
      inFlight++;
      peakInFlight = Math.max(peakInFlight, inFlight);
      await Promise.resolve();
      inFlight--;
      return makeSnmpResponse();
    });

    await pollDevices(devices);

    expect(peakInFlight).toBeLessThanOrEqual(
      PROBE_NETWORK_DEVICE_POLL_CONCURRENCY,
    );
    // And every device was still polled.
    expect(querySpy).toHaveBeenCalledTimes(devices.length);
    expect(pingSpy).toHaveBeenCalledTimes(devices.length);
  });
});
