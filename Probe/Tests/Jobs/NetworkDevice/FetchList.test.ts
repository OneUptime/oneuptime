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
import { JSONObject } from "Common/Types/JSON";
import SnmpMonitorResponse from "Common/Types/Monitor/SnmpMonitor/SnmpMonitorResponse";
import API from "Common/Utils/API";
import logger from "Common/Server/Utils/Logger";
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
 *   POST <ingest>/probe/network-device/list            → devices due for a walk
 *   (walk each device over SNMP, PROBE_NETWORK_DEVICE_POLL_CONCURRENCY
 *    at a time)
 *   POST <ingest>/probe/network-device/response/ingest → one result per device
 *
 * These tests pin the request contract the probe sends — URLs, per-device
 * ingest bodies, and the synthesized failure response — because the server
 * evaluates Network Device monitors from these ingested walks: a device the
 * probe silently drops never alerts as unreachable.
 */

function makeDevice(overrides?: Record<string, unknown>): DevicePollConfig {
  return {
    networkDeviceId: "device-1",
    projectId: "project-1",
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

// eslint-disable-next-line @typescript-eslint/typedef
let fetchSpy = jest.spyOn(API, "fetch");
// eslint-disable-next-line @typescript-eslint/typedef
let querySpy = jest.spyOn(SnmpMonitor, "query");

beforeEach(() => {
  fetchSpy = jest.spyOn(API, "fetch").mockResolvedValue({ data: {} } as never);
  querySpy = jest
    .spyOn(SnmpMonitor, "query")
    .mockResolvedValue(makeSnmpResponse() as never);
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

  test("no due devices: no SNMP walk, no ingest report", async () => {
    fetchSpy.mockResolvedValueOnce({ data: { devices: [] } } as never);

    await fetchAndPollDevices();

    expect(querySpy).not.toHaveBeenCalled();
    expect(fetchCalls()).toHaveLength(1);
    expect(ingestCalls()).toHaveLength(0);
  });

  test("a response with no devices key at all is treated as an empty list", async () => {
    // beforeEach default: { data: {} }
    await fetchAndPollDevices();

    expect(querySpy).not.toHaveBeenCalled();
    expect(fetchCalls()).toHaveLength(1);
  });

  test("walks every device the server hands out and reports each result", async () => {
    fetchSpy.mockResolvedValueOnce({
      data: {
        devices: [
          makeDevice({ networkDeviceId: "device-1" }),
          makeDevice({
            networkDeviceId: "device-2",
            snmpMonitor: { hostname: "10.0.0.6", timeout: 5000 },
          }),
        ],
      },
    } as never);

    await fetchAndPollDevices();

    expect(querySpy).toHaveBeenCalledTimes(2);

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
  test("a device without an id is skipped: no walk, no ingest", async () => {
    await pollDevice(makeDevice({ networkDeviceId: undefined }));

    expect(querySpy).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("a device whose SNMP config has no hostname is skipped", async () => {
    await pollDevice(
      makeDevice({ snmpMonitor: { hostname: "", timeout: 5000 } }),
    );

    expect(querySpy).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("a device with no SNMP config at all is skipped", async () => {
    await pollDevice(makeDevice({ snmpMonitor: undefined }));

    expect(querySpy).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("pollDevice — a successful walk", () => {
  test("posts the walk result to the ingest endpoint, authenticated as this probe", async () => {
    const response: SnmpMonitorResponse = makeSnmpResponse({
      responseTimeInMs: 7,
    });
    querySpy.mockResolvedValue(response as never);

    await pollDevice(makeDevice());

    const calls: Array<FetchCall> = fetchCalls();
    expect(calls).toHaveLength(1);
    expect(
      calls[0]!.url.endsWith("/probe/network-device/response/ingest"),
    ).toBe(true);

    const body: JSONObject = calls[0]!.body;
    expect(body["networkDeviceId"]).toBe("device-1");
    expect(body["snmpResponse"]).toEqual(response);
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
  test("a walk that returns null posts a synthesized unreachable response", async () => {
    querySpy.mockResolvedValue(null as never);

    await pollDevice(makeDevice());

    const ingested: Array<FetchCall> = ingestCalls();
    expect(ingested).toHaveLength(1);

    const snmpResponse: JSONObject = ingested[0]!.body[
      "snmpResponse"
    ] as JSONObject;
    expect(snmpResponse["isOnline"]).toBe(false);
    expect(snmpResponse["responseTimeInMs"]).toBe(0);
    expect(snmpResponse["failureCause"]).toBe(
      "SNMP query returned no response",
    );
    expect(snmpResponse["oidResponses"]).toEqual([]);
  });

  test("a walk that throws posts the error as the failure cause and does not throw", async () => {
    querySpy.mockRejectedValue(new Error("SNMPv3 auth failed") as never);

    await expect(pollDevice(makeDevice())).resolves.toBeUndefined();

    const ingested: Array<FetchCall> = ingestCalls();
    expect(ingested).toHaveLength(1);

    const snmpResponse: JSONObject = ingested[0]!.body[
      "snmpResponse"
    ] as JSONObject;
    expect(snmpResponse["isOnline"]).toBe(false);
    expect(snmpResponse["failureCause"]).toBe("SNMPv3 auth failed");
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

    // Every device reports back — failed walks as unreachable responses.
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

  test("walks run concurrently up to the configured width", async () => {
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
  test("never runs more walks at once than the configured width", async () => {
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
  });
});
