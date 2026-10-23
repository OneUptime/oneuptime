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

jest.mock("Common/Server/Utils/BasicCron", () => {
  return {
    __esModule: true,
    default: (): void => {
      // The job is driven directly; no scheduler.
    },
  };
});

import { JSONObject } from "Common/Types/JSON";
import MonitorStepSnmpMonitor from "Common/Types/Monitor/MonitorStepSnmpMonitor";
import SnmpDataType from "Common/Types/Monitor/SnmpMonitor/SnmpDataType";
import SnmpVersion from "Common/Types/Monitor/SnmpMonitor/SnmpVersion";
import {
  NetworkDeviceDiagnosticJob,
  NetworkDeviceDiagnosticReport,
} from "Common/Types/NetworkDevice/NetworkDeviceDiagnosticResult";
import { NetworkDeviceDiagnosticStatus } from "Common/Types/NetworkDevice/NetworkDeviceDiagnosticStatus";
import NetworkDeviceDiagnosticType from "Common/Types/NetworkDevice/NetworkDeviceDiagnosticType";
import {
  NetworkDeviceDiagnosticSnmpWalkResult,
  NetworkDeviceSnmpWalkRequest,
  SnmpWalkFailureKind,
  SnmpWalkStopReason,
} from "Common/Types/NetworkDevice/NetworkDeviceSnmpWalk";
import API from "Common/Utils/API";
import NetworkPathMonitor from "../../../Utils/Monitors/MonitorTypes/NetworkPathMonitor";
import PingMonitor from "../../../Utils/Monitors/MonitorTypes/PingMonitor";
import SnmpMonitor from "../../../Utils/Monitors/MonitorTypes/SnmpMonitor";
import {
  fetchAndRunDiagnostics,
  reportDiagnosticResult,
  resetDiagnosticFetchInProgress,
  runDiagnostic,
} from "../../../Jobs/NetworkDevice/FetchDiagnostics";

/*
 * The probe's half of an SNMP walk (issue #5184): the diagnostic job hands
 * a claimed walk, with the device's credentials and the walk's bounds, to
 * SnmpMonitor.walkOidTree, and reports what it read as a Completed
 * diagnostic whose result says how the walk went - a refusal included.
 * The walk itself is spied on; SnmpWalkEndToEnd drives the real one.
 */

const WALK_REQUEST: NetworkDeviceSnmpWalkRequest = {
  rootOid: "1.3.6.1.2.1.2",
  maxOids: 1000,
  timeBudgetInMs: 45000,
  requestTimeoutInMs: 5000,
  maxRepetitions: 25,
  pauseBetweenRequestsInMs: 20,
};

const CREDENTIALS: MonitorStepSnmpMonitor = {
  snmpVersion: SnmpVersion.V2c,
  // Whatever the server put here, the job's hostname is the one walked.
  hostname: "stale.example.com",
  port: 161,
  communityString: "s3cret",
  oids: [],
  timeout: 5000,
  monitorInterfaces: false,
};

function makeWalkJob(
  overrides?: Partial<NetworkDeviceDiagnosticJob>,
): NetworkDeviceDiagnosticJob {
  return {
    id: "diag-walk-1",
    projectId: "project-1",
    networkDeviceId: "device-1",
    diagnosticType: NetworkDeviceDiagnosticType.SnmpWalk,
    hostname: "10.0.0.5",
    timeoutInMs: 45000,
    snmpMonitor: CREDENTIALS,
    snmpWalk: WALK_REQUEST,
    ...overrides,
  };
}

function makeWalkResult(
  overrides?: Partial<NetworkDeviceDiagnosticSnmpWalkResult>,
): NetworkDeviceDiagnosticSnmpWalkResult {
  return {
    rootOid: "1.3.6.1.2.1.2",
    rows: [
      {
        oid: "1.3.6.1.2.1.2.2.1.2.1",
        type: SnmpDataType.OctetString,
        value: "GigabitEthernet0/1",
      },
    ],
    stopReason: SnmpWalkStopReason.Complete,
    snmpVersion: SnmpVersion.V2c,
    requestCount: 2,
    durationInMs: 31,
    ...overrides,
  };
}

// eslint-disable-next-line @typescript-eslint/typedef
let fetchSpy = jest.spyOn(API, "fetch");
// eslint-disable-next-line @typescript-eslint/typedef
let walkSpy = jest.spyOn(SnmpMonitor, "walkOidTree");
// eslint-disable-next-line @typescript-eslint/typedef
let pingSpy = jest.spyOn(PingMonitor, "runDiagnosticPing");
// eslint-disable-next-line @typescript-eslint/typedef
let traceSpy = jest.spyOn(NetworkPathMonitor, "trace");

beforeEach(() => {
  resetDiagnosticFetchInProgress();
  fetchSpy = jest.spyOn(API, "fetch").mockResolvedValue({ data: {} } as never);
  walkSpy = jest
    .spyOn(SnmpMonitor, "walkOidTree")
    .mockResolvedValue(makeWalkResult());
  pingSpy = jest.spyOn(PingMonitor, "runDiagnosticPing");
  traceSpy = jest.spyOn(NetworkPathMonitor, "trace");
});

afterEach(() => {
  jest.restoreAllMocks();
});

function ingestBodies(): Array<JSONObject> {
  return fetchSpy.mock.calls
    .map((call: Array<unknown>) => {
      return call[0] as JSONObject;
    })
    .filter((arg: JSONObject) => {
      return String(arg["url"]).endsWith(
        "/probe/network-device-diagnostic/response/ingest",
      );
    })
    .map((arg: JSONObject) => {
      return arg["data"] as JSONObject;
    });
}

describe("an SNMP Walk diagnostic", () => {
  test("walks the job's address with the credentials and the bounds the server sent", async () => {
    await runDiagnostic(makeWalkJob());

    expect(walkSpy).toHaveBeenCalledTimes(1);
    const [config, request] = walkSpy.mock.calls[0]!;
    expect(config).toEqual({ ...CREDENTIALS, hostname: "10.0.0.5" });
    expect(request).toEqual(WALK_REQUEST);
    expect(pingSpy).not.toHaveBeenCalled();
    expect(traceSpy).not.toHaveBeenCalled();
  });

  test("is a Completed report carrying what the walk read", async () => {
    const report: NetworkDeviceDiagnosticReport =
      await runDiagnostic(makeWalkJob());

    expect(report).toEqual({
      networkDeviceDiagnosticId: "diag-walk-1",
      status: NetworkDeviceDiagnosticStatus.Completed,
      snmpWalkResult: makeWalkResult(),
    });
  });

  /*
   * As an unanswered ping is a Completed ping: the refusal is the answer,
   * and the dashboard explains it from the result's failure.
   */
  test("a device that refuses the credentials is still Completed, its result saying why", async () => {
    const refused: NetworkDeviceDiagnosticSnmpWalkResult = makeWalkResult({
      rows: [],
      stopReason: SnmpWalkStopReason.Failed,
      failure: {
        kind: SnmpWalkFailureKind.Timeout,
        message: "Request timed out",
      },
    });
    walkSpy.mockResolvedValue(refused);

    const report: NetworkDeviceDiagnosticReport =
      await runDiagnostic(makeWalkJob());

    expect(report.status).toBe(NetworkDeviceDiagnosticStatus.Completed);
    expect(report.snmpWalkResult).toEqual(refused);
  });

  test.each([
    ["no credentials", { snmpMonitor: undefined }],
    ["no walk request", { snmpWalk: undefined }],
  ])(
    "a job with %s is Failed with the reason, and nothing is walked",
    async (_label: string, overrides: Partial<NetworkDeviceDiagnosticJob>) => {
      const report: NetworkDeviceDiagnosticReport = await runDiagnostic(
        makeWalkJob(overrides),
      );

      expect(report.status).toBe(NetworkDeviceDiagnosticStatus.Failed);
      expect(report.statusMessage).toContain("without the device's SNMP");
      expect(report.snmpWalkResult).toBeUndefined();
      expect(walkSpy).not.toHaveBeenCalled();
    },
  );

  test("a walk that throws anyway becomes a Failed report with the error", async () => {
    walkSpy.mockRejectedValue(new Error("net-snmp blew up"));

    const report: NetworkDeviceDiagnosticReport =
      await runDiagnostic(makeWalkJob());

    expect(report.status).toBe(NetworkDeviceDiagnosticStatus.Failed);
    expect(report.statusMessage).toBe("net-snmp blew up");
  });

  test("a job with no address is Failed before anything is walked", async () => {
    const report: NetworkDeviceDiagnosticReport = await runDiagnostic(
      makeWalkJob({ hostname: " " }),
    );

    expect(report.status).toBe(NetworkDeviceDiagnosticStatus.Failed);
    expect(walkSpy).not.toHaveBeenCalled();
  });
});

describe("reporting a walk", () => {
  test("carries exactly: auth, networkDeviceDiagnosticId, status, snmpWalkResult", async () => {
    await reportDiagnosticResult(await runDiagnostic(makeWalkJob()));

    const bodies: Array<JSONObject> = ingestBodies();
    expect(bodies).toHaveLength(1);
    expect(Object.keys(bodies[0]!).sort()).toEqual([
      "networkDeviceDiagnosticId",
      "probeCapabilities",
      "probeId",
      "probeKey",
      "snmpWalkResult",
      "status",
    ]);
    expect(bodies[0]!["snmpWalkResult"]).toEqual(makeWalkResult());
  });

  test("the credentials the server sent never travel back in the report", async () => {
    await reportDiagnosticResult(await runDiagnostic(makeWalkJob()));

    expect(JSON.stringify(ingestBodies())).not.toContain("s3cret");
  });

  test("a claimed walk is run and reported by the job's tick", async () => {
    fetchSpy.mockResolvedValueOnce({
      data: { diagnostics: [makeWalkJob()] },
    } as never);

    await fetchAndRunDiagnostics();

    expect(walkSpy).toHaveBeenCalledTimes(1);
    const bodies: Array<JSONObject> = ingestBodies();
    expect(bodies).toHaveLength(1);
    expect(bodies[0]!["networkDeviceDiagnosticId"]).toBe("diag-walk-1");
    expect(bodies[0]!["status"]).toBe("Completed");
  });

  test("the list request declares that this probe walks", async () => {
    await fetchAndRunDiagnostics();

    const listBody: JSONObject = (
      fetchSpy.mock.calls[0]![0] as unknown as JSONObject
    )["data"] as JSONObject;
    expect(listBody["probeCapabilities"]).toContain("snmpWalk");
  });
});
