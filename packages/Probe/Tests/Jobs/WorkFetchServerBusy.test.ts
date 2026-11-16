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
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { JSONObject } from "Common/Types/JSON";
import API from "Common/Utils/API";
import logger from "Common/Server/Utils/Logger";
import { fetchTableHealthWork } from "../../Jobs/DataObservability/CollectTableHealth";
import { fetchDataSecurityWork } from "../../Jobs/DataSecurity/ScanDatabases";
import {
  fetchAndRunScans,
  resetDiscoveryRunInProgress,
} from "../../Jobs/Discovery/FetchScans";
import { fetchDiagnosticList } from "../../Jobs/NetworkDevice/FetchDiagnostics";
import { fetchOpenStackChecks } from "../../Jobs/OpenStack/FetchOpenStackChecks";
import { fetchOpenStackWork } from "../../Jobs/OpenStack/FetchOpenStackWork";
import {
  fetchPacketCaptures,
  resetPacketCaptureState,
} from "../../Jobs/PacketCapture/FetchPacketCaptures";
import { fetchVMwareWork } from "../../Jobs/VMware/FetchVMwareWork";
import { PROBE_CAPABILITIES } from "../../Utils/ProbeAPIRequest";
import ServerBusy, {
  DEFAULT_SERVER_BUSY_BACK_OFF_MS,
} from "../../Utils/ServerBusy";

/*
 * THE PROBE'S OTHER WORK FETCHES, ANSWERED BUSY (issue #8051).
 *
 * The server holds every request a probe makes for work to its probe
 * scheduling limit, not only the monitor, monitor test and network device
 * fetches (#7920): discovery scans, device diagnostics, packet captures,
 * VMware and OpenStack collections, OpenStack checks, Data Security and Data
 * Observability. A request past the limit has claimed nothing, and a probe
 * that declares "retryAllWorkWhenBusy" - this one - is answered 429 with a
 * Retry-After. Each fetch reads that as "the server is busy, the work stays
 * due": it hands out nothing, logs no error - a warning a minute at most -
 * and asks again only once the Retry-After has passed. Before this, each
 * logged a 429 as a failed request every tick (the discovery fetch at
 * error, "No scan on this probe can leave Pending").
 *
 * The packet capture list is the one fetch that does not wait: it is also
 * the heartbeat of the captures running, and the server answers it busy with
 * the stops alone, never a 429.
 */

interface WorkFetch {
  name: string;
  // The work as the busy warning names it.
  work: string;
  route: string;
  // Runs the fetch as its job does: what it handed out.
  fetch: () => Promise<unknown>;
  nothing: unknown;
  // An older server's empty answer, which reads as nothing due.
  emptyAnswer: unknown;
  backsOff: boolean;
}

const FETCHES: Array<WorkFetch> = [
  {
    name: "the discovery scan fetch",
    work: "discovery scans",
    route: "/probe/discovery-scan/list",
    fetch: async (): Promise<unknown> => {
      await fetchAndRunScans();
      return [];
    },
    nothing: [],
    emptyAnswer: new HTTPResponse(200, [], {}),
    backsOff: true,
  },
  {
    name: "the device diagnostic fetch",
    work: "network device diagnostics",
    route: "/probe/network-device-diagnostic/list",
    fetch: fetchDiagnosticList,
    nothing: [],
    emptyAnswer: new HTTPResponse(200, { diagnostics: [] }, {}),
    backsOff: true,
  },
  {
    name: "the VMware work fetch",
    work: "VMware collections",
    route: "/probe/vmware/work",
    fetch: fetchVMwareWork,
    nothing: { collections: [], tests: [] },
    emptyAnswer: new HTTPResponse(200, { collections: [], tests: [] }, {}),
    backsOff: true,
  },
  {
    name: "the OpenStack work fetch",
    work: "OpenStack collections",
    route: "/probe/openstack/work",
    fetch: fetchOpenStackWork,
    nothing: { collections: [], tests: [] },
    emptyAnswer: new HTTPResponse(200, { collections: [], tests: [] }, {}),
    backsOff: true,
  },
  {
    name: "the OpenStack check fetch",
    work: "OpenStack checks",
    route: "/probe/openstack/checks/work",
    fetch: fetchOpenStackChecks,
    nothing: { apiChecks: [], lifecycleChecks: [] },
    emptyAnswer: new HTTPResponse(
      200,
      { apiChecks: [], lifecycleChecks: [] },
      {},
    ),
    backsOff: true,
  },
  {
    name: "the Data Security fetch",
    work: "Data Security scans",
    route: "/probe/data-security/work",
    fetch: fetchDataSecurityWork,
    nothing: [],
    emptyAnswer: new HTTPResponse(200, { stores: [] }, {}),
    backsOff: true,
  },
  {
    name: "the Data Observability fetch",
    work: "Data Observability collections",
    route: "/probe/data-observability/work",
    fetch: fetchTableHealthWork,
    nothing: [],
    emptyAnswer: new HTTPResponse(200, { stores: [] }, {}),
    backsOff: true,
  },
  {
    name: "the packet capture fetch",
    work: "packet captures",
    route: "/probe/packet-capture/list",
    fetch: (): Promise<unknown> => {
      return fetchPacketCaptures({ limit: 2, runningPacketCaptureIds: [] });
    },
    nothing: { packetCaptures: [], stopPacketCaptureIds: [] },
    emptyAnswer: new HTTPResponse(
      200,
      { packetCaptures: [], stopPacketCaptureIds: [] },
      {},
    ),
    backsOff: false,
  },
];

function busyAnswer(retryAfter: string = "10"): HTTPErrorResponse {
  return new HTTPErrorResponse(
    429,
    {
      message:
        "This OneUptime server is busy handing out work to probes. The probe asks again at its next tick.",
    },
    { "retry-after": retryAfter },
  );
}

// eslint-disable-next-line @typescript-eslint/typedef
let fetchSpy = jest.spyOn(API, "fetch");
// eslint-disable-next-line @typescript-eslint/typedef
let warnSpy = jest.spyOn(logger, "warn");
// eslint-disable-next-line @typescript-eslint/typedef
let errorSpy = jest.spyOn(logger, "error");

let now: number = 1_000_000;

beforeEach(() => {
  ServerBusy.reset();
  resetDiscoveryRunInProgress();
  resetPacketCaptureState();
  now = 1_000_000;
  // The probe's Jest cannot fake timers on this Node; the clock is enough.
  jest.spyOn(Date, "now").mockImplementation((): number => {
    return now;
  });
  fetchSpy = jest.spyOn(API, "fetch").mockResolvedValue(busyAnswer() as never);
  warnSpy = jest.spyOn(logger, "warn").mockImplementation(() => {
    return undefined as never;
  });
  errorSpy = jest.spyOn(logger, "error").mockImplementation(() => {
    return undefined as never;
  });
  jest.spyOn(logger, "debug").mockImplementation(() => {
    return undefined as never;
  });
  jest.spyOn(logger, "info").mockImplementation(() => {
    return undefined as never;
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

function routesAsked(): Array<string> {
  return fetchSpy.mock.calls.map((call: Array<unknown>): string => {
    return String((call[0] as JSONObject)["url"]);
  });
}

describe.each(FETCHES)("$name", (fetch: WorkFetch) => {
  test("tells the server it reads a 429 from this fetch as busy", async () => {
    fetchSpy.mockResolvedValue(fetch.emptyAnswer as never);

    await fetch.fetch();

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(routesAsked()[0]).toContain(fetch.route);

    const body: JSONObject = (
      fetchSpy.mock.calls[0]![0] as unknown as JSONObject
    )["data"] as JSONObject;

    expect(body["probeCapabilities"]).toContain("retryAllWorkWhenBusy");
    expect(body["probeCapabilities"]).toContain("retryWhenBusy");
  });

  test("answered busy, it hands out nothing, logs no error, and says so at warn once", async () => {
    expect(await fetch.fetch()).toEqual(fetch.nothing);

    expect(errorSpy).not.toHaveBeenCalled();
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(String(warnSpy.mock.calls[0]![0])).toContain(
      `busy handing out ${fetch.work}: 1 fetch(es) answered busy since the last report. Nothing is lost`,
    );
  });

  test("an older server's empty answer reads as nothing due, quietly", async () => {
    fetchSpy.mockResolvedValue(fetch.emptyAnswer as never);

    expect(await fetch.fetch()).toEqual(fetch.nothing);
    expect(warnSpy).not.toHaveBeenCalled();
    expect(errorSpy).not.toHaveBeenCalled();
  });

  if (fetch.backsOff) {
    test("answered busy, it does not ask again until the Retry-After has passed, then does", async () => {
      await fetch.fetch();
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      // Its next tick, five seconds on: the server asked for ten.
      now += 5_000;
      expect(await fetch.fetch()).toEqual(fetch.nothing);
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      now += 5_000;
      fetchSpy.mockResolvedValue(fetch.emptyAnswer as never);
      await fetch.fetch();
      expect(fetchSpy).toHaveBeenCalledTimes(2);
      expect(errorSpy).not.toHaveBeenCalled();
    });

    test("a busy answer for other work does not hold this fetch back", async () => {
      ServerBusy.note("monitors", busyAnswer("60"));
      fetchSpy.mockResolvedValue(fetch.emptyAnswer as never);

      await fetch.fetch();

      expect(fetchSpy).toHaveBeenCalledTimes(1);
    });
  } else {
    test("answered busy, it still asks at its next tick: it is the running captures' heartbeat", async () => {
      await fetch.fetch();

      now += 5_000;
      await fetch.fetch();

      expect(fetchSpy).toHaveBeenCalledTimes(2);
      expect(errorSpy).not.toHaveBeenCalled();
    });
  }
});

describe("the warnings while the server stays busy", () => {
  test("each kind of work warns at most once a minute, with how many fetches were refused since", async () => {
    await fetchVMwareWork();
    await fetchDiagnosticList();

    expect(warnSpy).toHaveBeenCalledTimes(2);

    // A minute of ten-second ticks, each refused once the wait is over.
    for (let tick: number = 1; tick <= 5; tick++) {
      now += DEFAULT_SERVER_BUSY_BACK_OFF_MS;
      await fetchVMwareWork();
    }

    expect(warnSpy).toHaveBeenCalledTimes(2);

    now += DEFAULT_SERVER_BUSY_BACK_OFF_MS;
    await fetchVMwareWork();

    expect(warnSpy).toHaveBeenCalledTimes(3);
    expect(String(warnSpy.mock.calls[2]![0])).toContain(
      "busy handing out VMware collections: 6 fetch(es) answered busy since the last report",
    );
    expect(errorSpy).not.toHaveBeenCalled();
  });
});

describe("the discovery scan fetch, answered busy", () => {
  test("no longer says no scan can leave Pending", async () => {
    await fetchAndRunScans();

    expect(errorSpy).not.toHaveBeenCalled();
    for (const call of warnSpy.mock.calls) {
      expect(String(call[0])).not.toContain('can leave "Pending"');
    }
    // It asked for scans, and nothing else: no scan ran.
    expect(routesAsked()).toEqual([
      "https://oneuptime.example.com/probe-ingest/probe/discovery-scan/list",
    ]);
  });

  test("any other refusal still says what the server said, at error", async () => {
    fetchSpy.mockResolvedValue(
      new HTTPErrorResponse(400, { message: "Probe not found" }, {}) as never,
    );

    await fetchAndRunScans();

    expect(String(errorSpy.mock.calls[0]![0])).toContain(
      "HTTP 400 — Probe not found",
    );
  });
});

test("this probe build declares every capability its fetches honour", () => {
  expect(PROBE_CAPABILITIES).toEqual(
    expect.arrayContaining(["retryWhenBusy", "retryAllWorkWhenBusy"]),
  );
});
