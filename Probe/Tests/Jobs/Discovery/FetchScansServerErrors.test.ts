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
import { JSONArray, JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import NetworkDeviceDiscoveryScan from "Common/Models/DatabaseModels/NetworkDeviceDiscoveryScan";
import API from "Common/Utils/API";
import logger from "Common/Server/Utils/Logger";
import SubnetScanner, {
  SubnetScanResult,
} from "../../../Utils/Discovery/SubnetScanner";
import {
  fetchAndRunScans,
  getRejectionReason,
  runScan,
  resetDiscoveryRunInProgress,
} from "../../../Jobs/Discovery/FetchScans";

/*
 * What the probe does when the SERVER says no.
 *
 * API.fetch returns a rejected request as an HTTPErrorResponse rather than
 * throwing — it only throws when no response arrived at all — and none of the
 * three discovery calls discriminated the union. The list call fed the error
 * BODY (a JSON object) straight into BaseModel.fromJSONArray, whose `for...of`
 * threw "json is not iterable"; the two upload calls discarded the response
 * entirely and logged success.
 *
 * The cost was not cosmetic. A scan leaves "Pending" only when the probe's
 * list call succeeds, so a server that rejects that call leaves every scan
 * Pending forever — and the one place that could have said why printed a
 * TypeError about a shape instead of the server's own sentence. That is the
 * shape of OneUptime issue #3287: four scans, an hour apart, all Pending,
 * nothing to act on.
 *
 * These tests pin that the server's words survive.
 */

const scanId: ObjectID = ObjectID.generate();

function makeScan(overrides?: JSONObject): NetworkDeviceDiscoveryScan {
  return {
    id: scanId,
    cidr: "10.0.0.0/24",
    snmpVersion: "V2c",
    snmpCommunityString: "public",
    snmpPort: 161,
    ...overrides,
  } as unknown as NetworkDeviceDiscoveryScan;
}

function makeScanResult(): SubnetScanResult {
  return {
    discoveredHosts: [],
    scannedHostCount: 254,
    /*
     * The sweep reports the distinct ports it touched (a scan can carry
     * several credential sets, and they may disagree about the port) and how
     * many hosts each credential answered. This is the single-credential
     * shape, which is what a scan configured through the flattened columns
     * produces.
     */
    scannedPorts: [161],
    responderCountByConfigId: { legacy: 0 },
    respondedToPingCount: 0,
    snmpErrorHostCount: 0,
    icmpFilteredFallbackHostCount: 0,
  } as unknown as SubnetScanResult;
}

// A real list response, envelope already unwrapped by HTTPResponse.
function okListResponse(
  scans: Array<JSONObject>,
): HTTPResponse<JSONArray> | HTTPErrorResponse {
  return new HTTPResponse<JSONArray>(
    200,
    { data: scans, count: scans.length, skip: 0, limit: 10 },
    {},
  ) as unknown as HTTPResponse<JSONArray>;
}

function errorResponse(
  statusCode: number,
  body: JSONObject,
): HTTPErrorResponse {
  return new HTTPErrorResponse(statusCode, body, {});
}

// eslint-disable-next-line @typescript-eslint/typedef
let fetchSpy = jest.spyOn(API, "fetch");
// eslint-disable-next-line @typescript-eslint/typedef
let scanSpy = jest.spyOn(SubnetScanner, "scan");
// eslint-disable-next-line @typescript-eslint/typedef
let errorSpy = jest.spyOn(logger, "error");
// eslint-disable-next-line @typescript-eslint/typedef
let debugSpy = jest.spyOn(logger, "debug");

beforeEach(() => {
  resetDiscoveryRunInProgress();
  fetchSpy = jest.spyOn(API, "fetch").mockResolvedValue({ data: [] } as never);
  scanSpy = jest
    .spyOn(SubnetScanner, "scan")
    .mockResolvedValue(makeScanResult() as never);
  errorSpy = jest.spyOn(logger, "error").mockImplementation(() => {
    // Keep test output clean.
  });
  debugSpy = jest.spyOn(logger, "debug").mockImplementation(() => {
    // Keep test output clean.
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

function loggedErrors(): string {
  return errorSpy.mock.calls
    .map((call: Array<unknown>) => {
      return String(call[0]);
    })
    .join("\n");
}

describe("getRejectionReason", () => {
  test("an accepted request produces no reason at all", () => {
    expect(getRejectionReason(okListResponse([]))).toBe("");
  });

  /*
   * The whole point: the server's own sentence reaches the log verbatim.
   * "Probe not found" and "Invalid Probe ID or Probe Key" are the two the
   * claim endpoint actually sends, and they name completely different fixes.
   */
  test("quotes the server's message alongside the status code", () => {
    expect(
      getRejectionReason(errorResponse(400, { message: "Probe not found" })),
    ).toBe("HTTP 400 — Probe not found");
  });

  test("reads the message out of a nested error body too", () => {
    expect(
      getRejectionReason(
        errorResponse(400, { error: { message: "Invalid Probe ID" } }),
      ),
    ).toContain("Invalid Probe ID");
  });

  test("a body with no message still reports the status code", () => {
    expect(getRejectionReason(errorResponse(502, {}))).toBe("HTTP 502");
  });

  /*
   * A 2xx that is not exactly 200 is an ACCEPTED request. HTTPResponse's
   * isSuccess() is `statusCode === 200`, so testing on that instead of the
   * response type would report a 204 as a rejection and silently stop
   * discovery on a server that answered perfectly well.
   */
  test("a 204 is not a rejection", () => {
    const noContent: HTTPResponse<JSONArray> = new HTTPResponse<JSONArray>(
      204,
      [],
      {},
    );

    expect(getRejectionReason(noContent)).toBe("");
  });
});

describe("fetchAndRunScans — the server rejects the claim request", () => {
  /*
   * The regression itself. Before the fix this threw
   * "TypeError: json is not iterable" out of fromJSONArray, which the cron's
   * catch logged in place of the server's explanation.
   */
  test("does not throw an opaque parse error", async () => {
    fetchSpy.mockResolvedValue(
      errorResponse(400, { message: "Probe not found" }) as never,
    );

    await expect(fetchAndRunScans()).resolves.toBeUndefined();

    expect(loggedErrors()).not.toContain("iterable");
  });

  test("logs the server's own reason, with the status code", async () => {
    fetchSpy.mockResolvedValue(
      errorResponse(400, { message: "Invalid Probe ID or Probe Key" }) as never,
    );

    await fetchAndRunScans();

    const logged: string = loggedErrors();
    expect(logged).toContain("HTTP 400");
    expect(logged).toContain("Invalid Probe ID or Probe Key");
  });

  /*
   * The operator's actual question is "why is my scan still Pending". The log
   * line has to connect the rejection to that symptom, or it reads as an
   * unrelated warning.
   */
  test("says what the rejection means for the scans that are waiting", async () => {
    fetchSpy.mockResolvedValue(errorResponse(500, {}) as never);

    await fetchAndRunScans();

    expect(loggedErrors()).toContain("Pending");
  });

  test("sweeps nothing — a rejected list is not an empty list", async () => {
    fetchSpy.mockResolvedValue(errorResponse(403, {}) as never);

    await fetchAndRunScans();

    expect(scanSpy).not.toHaveBeenCalled();
    // The failed list call, and no follow-up result upload.
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });
});

describe("fetchAndRunScans — the response is not a list of scans", () => {
  /*
   * A 200 whose body is an HTML login page or a proxy's JSON. Same
   * "not iterable" crash, different cause, and the fix has to name the cause
   * rather than the shape.
   */
  test("a 200 carrying an object instead of a list is reported, not thrown", async () => {
    fetchSpy.mockResolvedValue(
      new HTTPResponse<JSONArray>(200, { loginRequired: true }, {}) as never,
    );

    await expect(fetchAndRunScans()).resolves.toBeUndefined();

    const logged: string = loggedErrors();
    expect(logged).toContain("PROBE_INGEST_URL");
    expect(scanSpy).not.toHaveBeenCalled();
  });

  test("a real, empty list is NOT treated as an error", async () => {
    fetchSpy.mockResolvedValue(okListResponse([]) as never);

    await fetchAndRunScans();

    expect(errorSpy).not.toHaveBeenCalled();
    expect(scanSpy).not.toHaveBeenCalled();
  });

  test("a real list is still swept", async () => {
    fetchSpy.mockResolvedValue(
      okListResponse([
        { _id: scanId.toString(), cidr: "10.0.0.0/30" },
      ]) as never,
    );

    await fetchAndRunScans();

    expect(scanSpy).toHaveBeenCalledTimes(1);
  });
});

describe("runScan — the server rejects the result upload", () => {
  test("a rejected result upload is an error, not a debug 'found N hosts'", async () => {
    fetchSpy.mockResolvedValue(
      errorResponse(413, { message: "Payload too large" }) as never,
    );

    await runScan(makeScan());

    const logged: string = loggedErrors();
    expect(logged).toContain("HTTP 413");
    expect(logged).toContain("Payload too large");

    // The success line must not also have been written.
    const debugLines: string = debugSpy.mock.calls
      .map((call: Array<unknown>) => {
        return String(call[0]);
      })
      .join("\n");
    expect(debugLines).not.toContain("found 0 SNMP hosts");
  });

  test("names how many discovered hosts were lost", async () => {
    scanSpy.mockResolvedValue({
      ...makeScanResult(),
      discoveredHosts: [
        { ipAddress: "10.0.0.1", snmpReachable: true },
        { ipAddress: "10.0.0.2", snmpReachable: false },
      ],
    } as never);
    fetchSpy.mockResolvedValue(errorResponse(500, {}) as never);

    await runScan(makeScan());

    expect(loggedErrors()).toContain("2 discovered host(s) were not saved");
  });

  test("an accepted upload logs no error", async () => {
    fetchSpy.mockResolvedValue(
      new HTTPResponse<JSONArray>(200, { result: "ok" }, {}) as never,
    );

    await runScan(makeScan());

    expect(errorSpy).not.toHaveBeenCalled();
  });
});

describe("runScan — the server rejects the FAILURE report", () => {
  /*
   * The sweep failed AND the report of that failure was refused. The scan is
   * now stranded In Progress until the server's reaper times it out, and this
   * probe is the only place that knows the real reason — so the rejection
   * itself has to be logged, not swallowed.
   */
  test("the rejected failure report is logged with the scan id", async () => {
    scanSpy.mockRejectedValue(new Error("target is malformed") as never);
    fetchSpy.mockResolvedValue(
      errorResponse(400, { message: "nope" }) as never,
    );

    await runScan(makeScan());

    const logged: string = loggedErrors();
    expect(logged).toContain(scanId.toString());
    expect(logged).toContain("HTTP 400");
  });

  test("an accepted failure report logs only the sweep failure", async () => {
    scanSpy.mockRejectedValue(new Error("target is malformed") as never);
    fetchSpy.mockResolvedValue(
      new HTTPResponse<JSONArray>(200, { result: "ok" }, {}) as never,
    );

    await runScan(makeScan());

    const logged: string = loggedErrors();
    expect(logged).toContain("target is malformed");
    expect(logged).not.toContain("rejected the failure report");
  });
});
