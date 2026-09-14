import GoogleSecOpsConnection from "../../../../Models/DatabaseModels/GoogleSecOpsConnection";
import Semaphore, {
  SemaphoreLockTimeoutError,
} from "../../../../Server/Infrastructure/Semaphore";
import GoogleSecOpsConnectionService from "../../../../Server/Services/GoogleSecOpsConnectionService";
import OTelIngestService from "../../../../Server/Services/OpenTelemetryIngestService";
import SecurityEventService from "../../../../Server/Services/SecurityEventService";
import logger from "../../../../Server/Utils/Logger";
import GoogleSecOpsClient, {
  FetchAlertsResult,
  GoogleSecOpsListBasis,
  SearchDetectionsResult,
} from "../../../../Server/Utils/SecurityEvent/GoogleSecOps/GoogleSecOpsClient";
import GoogleSecOpsPoller from "../../../../Server/Utils/SecurityEvent/GoogleSecOps/GoogleSecOpsPoller";
import SecurityEventDedupe from "../../../../Server/Utils/SecurityEvent/SecurityEventDedupe";
import ThreatIntelEnricher from "../../../../Server/Utils/SecurityEvent/ThreatIntel/ThreatIntelEnricher";
import APIException from "../../../../Types/Exception/ApiException";
import OneUptimeDate from "../../../../Types/Date";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import {
  GoogleSecOpsDiagnosticCheck,
  GoogleSecOpsRunResult,
} from "../../../../Types/SecurityEvent/GoogleSecOpsDiagnostics";
import ServiceType from "../../../../Types/Telemetry/ServiceType";
import { getJestSpyOn } from "../../../Spy";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * The three-pass fetch. A scheduled poll reads one window three ways —
 * rule detections by CREATED time, curated rule detections by created
 * time, and the alerts view by detection time — and unions the results by
 * Collection.id. These tests pin the request contract of each pass as
 * seen from the poller, the shared request budget, the union, the
 * per-pass counts, the curated-rule degradation, the 24-hour first
 * window, the creation-lag statistics, and the two bookkeeping rules that
 * changed with it: a rejected object no longer holds the cursor, and a
 * busy source lock is reported in words rather than as a Redis error.
 */

const NOW: Date = new Date("2026-09-14T12:00:00.000Z");
const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const CONNECTION_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);

interface SearchCall {
  startTime: Date;
  endTime: Date;
  listBasis: GoogleSecOpsListBasis;
  alertingOnly: boolean;
  pageSize?: number | undefined;
  pageToken?: string | undefined;
  curated?: boolean | undefined;
}

interface AlertsCall {
  startTime: Date;
  endTime: Date;
  maxAlerts?: number | undefined;
  includeNonAlertingDetections?: boolean | undefined;
}

interface FakeClient {
  client: GoogleSecOpsClient;
  searchCalls: Array<SearchCall>;
  alertsCalls: Array<AlertsCall>;
}

type SearchAnswer =
  | SearchDetectionsResult
  | Error
  | ((call: SearchCall) => SearchDetectionsResult);

function page(
  detections: Array<JSONObject>,
  changes: Partial<SearchDetectionsResult> = {},
): SearchDetectionsResult {
  return { detections, nextPageToken: null, truncated: false, ...changes };
}

function fetched(
  alerts: Array<JSONObject>,
  changes: Partial<FetchAlertsResult> = {},
): FetchAlertsResult {
  return {
    alerts,
    complete: true,
    progress: 1,
    truncatedByCount: false,
    truncatedByBytes: false,
    baselineAlertsCount: alerts.length,
    filteredAlertsCount: alerts.length,
    chunkCount: 1,
    ...changes,
  };
}

function detection(id: string, changes: JSONObject = {}): JSONObject {
  return {
    id,
    type: "RULE_DETECTION",
    detectionTime: "2026-09-14T11:00:00.000Z",
    createdTime: "2026-09-14T11:02:00.000Z",
    detection: [
      { ruleName: `Rule for ${id}`, alertState: "ALERTING", severity: "HIGH" },
    ],
    ...changes,
  };
}

/*
 * Answers are queued per (curated, basis) pair so a test can script the
 * rule pass and the curated pass independently; each queue repeats its
 * last entry, so one entry means "answer this way every time".
 */
function makeClient(data: {
  rule?: Array<SearchAnswer> | undefined;
  curated?: Array<SearchAnswer> | undefined;
  alerts?: Array<FetchAlertsResult | Error> | undefined;
}): FakeClient {
  const searchCalls: Array<SearchCall> = [];
  const alertsCalls: Array<AlertsCall> = [];
  const indexes: Map<string, number> = new Map();
  let alertsIndex: number = 0;

  const client: GoogleSecOpsClient = {
    testAuthentication: jest.fn(async (): Promise<void> => {}),
    searchDetections: jest.fn(
      async (call: SearchCall): Promise<SearchDetectionsResult> => {
        searchCalls.push(call);
        const queue: Array<SearchAnswer> = (call.curated
          ? data.curated
          : data.rule) || [page([])];
        const key: string = `${call.curated ? "curated" : "rule"}:${call.listBasis}`;
        const index: number = indexes.get(key) || 0;
        indexes.set(key, index + 1);
        const answer: SearchAnswer = queue[
          Math.min(index, queue.length - 1)
        ] as SearchAnswer;

        if (answer instanceof Error) {
          throw answer;
        }

        return typeof answer === "function" ? answer(call) : answer;
      },
    ),
    fetchDetectionAlerts: jest.fn(
      async (call: AlertsCall): Promise<FetchAlertsResult> => {
        alertsCalls.push(call);
        const queue: Array<FetchAlertsResult | Error> = data.alerts || [
          fetched([]),
        ];
        const answer: FetchAlertsResult | Error = queue[
          Math.min(alertsIndex++, queue.length - 1)
        ] as FetchAlertsResult | Error;

        if (answer instanceof Error) {
          throw answer;
        }

        return answer;
      },
    ),
  } as unknown as GoogleSecOpsClient;

  return { client, searchCalls, alertsCalls };
}

function connection(
  changes: Partial<GoogleSecOpsConnection> = {},
): GoogleSecOpsConnection {
  const item: GoogleSecOpsConnection = new GoogleSecOpsConnection();
  item._id = CONNECTION_ID.toString();
  item.projectId = PROJECT_ID;
  item.region = "us";
  item.instanceResourceName = "projects/p/locations/us/instances/i";
  item.serviceAccountJson = "{}";
  item.pollIntervalInMinutes = 5;
  Object.assign(item, changes);
  return item;
}

function lastUpdate(): JSONObject {
  const calls: Array<Array<unknown>> = getJestSpyOn(
    GoogleSecOpsConnectionService,
    "updateOneById",
  ).mock.calls;
  return (calls[calls.length - 1]![0] as { data: JSONObject }).data;
}

function checkNamed(
  result: GoogleSecOpsRunResult,
  name: string,
): GoogleSecOpsDiagnosticCheck | undefined {
  return result.checks.find((check: GoogleSecOpsDiagnosticCheck): boolean => {
    return check.name === name;
  });
}

describe("GoogleSecOpsPoller three-pass fetch", () => {
  let insertedRows: Array<JSONObject>;

  beforeEach(() => {
    insertedRows = [];
    getJestSpyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(NOW);
    getJestSpyOn(Semaphore, "lock").mockResolvedValue({});
    getJestSpyOn(Semaphore, "release").mockResolvedValue(undefined);
    getJestSpyOn(GoogleSecOpsPoller, "findExistingEventUids").mockResolvedValue(
      new Set(),
    );
    getJestSpyOn(SecurityEventService, "insertJsonRows").mockImplementation(((
      rows: Array<JSONObject>,
    ): Promise<void> => {
      insertedRows.push(...rows);
      return Promise.resolve();
    }) as never);
    getJestSpyOn(
      OTelIngestService,
      "telemetryServiceFromName",
    ).mockResolvedValue({
      serviceName: "Google SecOps",
      primaryEntityId: PROJECT_ID,
      primaryEntityType: ServiceType.OpenTelemetry,
      dataRententionInDays: 15,
      serviceRetentionConfig: null,
      serviceRetentionInDays: null,
      projectRetentionConfig: null,
      projectRetentionInDays: 15,
    });
    getJestSpyOn(
      ThreatIntelEnricher,
      "enrichNormalizedEvents",
    ).mockResolvedValue({ eventsMatched: 0, valuesLookedUp: 0 });
    getJestSpyOn(
      GoogleSecOpsConnectionService,
      "updateOneById",
    ).mockResolvedValue(undefined);
    getJestSpyOn(logger, "warn").mockImplementation((): void => {});
    getJestSpyOn(logger, "error").mockImplementation((): void => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("a poll reads three passes over one window and unions them by Collection.id", async () => {
    const fake: FakeClient = makeClient({
      rule: [page([detection("a"), detection("b")])],
      curated: [page([detection("b"), detection("c")])],
      alerts: [fetched([detection("c"), detection("d")])],
    });

    const result: GoogleSecOpsRunResult =
      await GoogleSecOpsPoller.executeConnection(
        connection(),
        { type: "poll" },
        fake.client,
      );

    expect(result).toMatchObject({
      status: "success",
      complete: true,
      basis: "created-time",
      fetchedCount: 4,
      ingestedCount: 4,
      requestCount: 3,
      sourceCounts: { ruleDetections: 2, curatedDetections: 2, alertsView: 2 },
    });
    expect(
      insertedRows
        .map((row: JSONObject): unknown => {
          return row["eventUid"];
        })
        .sort(),
    ).toEqual(["a", "b", "c", "d"]);
    expect(
      result.checks.map((check: GoogleSecOpsDiagnosticCheck): string => {
        return `${check.name}:${check.status}`;
      }),
    ).toEqual([
      "Validate configuration:success",
      "Read rule detections by created time:success",
      "Read curated rule detections by created time:success",
      "Read alerts view by detection time:success",
      "Normalize detections:success",
      "Import detections:success",
    ]);
    expect(lastUpdate()["cursor"]).toBe(NOW.toISOString());
  });

  test("the search passes ask for created time, the saved scope, full pages and the right route", async () => {
    const fake: FakeClient = makeClient({});

    await GoogleSecOpsPoller.executeConnection(
      connection(),
      { type: "poll" },
      fake.client,
    );

    expect(fake.searchCalls).toHaveLength(2);
    expect(fake.searchCalls[0]).toMatchObject({
      listBasis: "CREATED_TIME",
      alertingOnly: true,
      pageSize: 1000,
      curated: false,
    });
    expect(fake.searchCalls[0]!.pageToken).toBeUndefined();
    expect(fake.searchCalls[1]).toMatchObject({
      listBasis: "CREATED_TIME",
      alertingOnly: true,
      pageSize: 1000,
      curated: true,
    });
    // All three passes cover exactly the same window.
    for (const call of fake.searchCalls) {
      expect(call.startTime).toEqual(fake.alertsCalls[0]!.startTime);
      expect(call.endTime).toEqual(fake.alertsCalls[0]!.endTime);
    }
    expect(fake.alertsCalls[0]).toMatchObject({
      maxAlerts: 1000,
      includeNonAlertingDetections: false,
    });
  });

  test("Alerts and detections drops alertState from the searches and widens the alerts view", async () => {
    const fake: FakeClient = makeClient({});

    await GoogleSecOpsPoller.executeConnection(
      connection({ includeNonAlertingDetections: true }),
      { type: "poll" },
      fake.client,
    );

    expect(
      fake.searchCalls.every((call: SearchCall): boolean => {
        return call.alertingOnly === false;
      }),
    ).toBe(true);
    expect(fake.alertsCalls[0]!.includeNonAlertingDetections).toBe(true);
  });

  test("the first poll of a new connection looks back 24 hours by created time", async () => {
    const fake: FakeClient = makeClient({});

    const result: GoogleSecOpsRunResult =
      await GoogleSecOpsPoller.executeConnection(
        connection(),
        { type: "poll" },
        fake.client,
      );

    expect(result.windowStart).toBe("2026-09-13T12:00:00.000Z");
    expect(result.windowEnd).toBe(NOW.toISOString());
    expect(fake.searchCalls[0]!.startTime.toISOString()).toBe(
      "2026-09-13T12:00:00.000Z",
    );
  });

  test("a saved cursor starts the window one minute earlier and ends now", async () => {
    const fake: FakeClient = makeClient({});

    const result: GoogleSecOpsRunResult =
      await GoogleSecOpsPoller.executeConnection(
        connection({ cursor: "2026-09-14T11:55:00.000Z" }),
        { type: "poll" },
        fake.client,
      );

    expect(result.windowStart).toBe("2026-09-14T11:54:00.000Z");
    expect(result.windowEnd).toBe(NOW.toISOString());
    expect(lastUpdate()["cursor"]).toBe(NOW.toISOString());
  });

  test("a stale cursor is caught up in 24 hour chunks", async () => {
    const fake: FakeClient = makeClient({});

    const result: GoogleSecOpsRunResult =
      await GoogleSecOpsPoller.executeConnection(
        connection({ cursor: "2026-09-10T12:00:00.000Z" }),
        { type: "poll" },
        fake.client,
      );

    expect(result.windowStart).toBe("2026-09-10T11:59:00.000Z");
    expect(result.windowEnd).toBe("2026-09-11T11:59:00.000Z");
    expect(result.warnings.join(" ")).toMatch(/24 hour windows/);
  });

  test("nextPageToken is followed and the token is forwarded", async () => {
    const fake: FakeClient = makeClient({
      rule: [
        page([detection("p1")], { nextPageToken: "t1" }),
        page([detection("p2")], { nextPageToken: "t2" }),
        page([detection("p3")]),
      ],
    });

    const result: GoogleSecOpsRunResult =
      await GoogleSecOpsPoller.executeConnection(
        connection(),
        { type: "poll" },
        fake.client,
      );

    const ruleCalls: Array<SearchCall> = fake.searchCalls.filter(
      (call: SearchCall): boolean => {
        return call.curated !== true;
      },
    );
    expect(
      ruleCalls.map((call: SearchCall): string | undefined => {
        return call.pageToken;
      }),
    ).toEqual([undefined, "t1", "t2"]);
    expect(result).toMatchObject({
      complete: true,
      fetchedCount: 3,
      requestCount: 5,
      sourceCounts: { ruleDetections: 3, curatedDetections: 0, alertsView: 0 },
    });
  });

  test("the request budget is shared across passes and holds the cursor when exhausted", async () => {
    const fake: FakeClient = makeClient({
      rule: [page([detection("endless")], { nextPageToken: "again" })],
    });

    const result: GoogleSecOpsRunResult =
      await GoogleSecOpsPoller.executeConnection(
        connection({ cursor: "2026-09-14T11:55:00.000Z" }),
        { type: "poll" },
        fake.client,
      );

    expect(result.requestCount).toBe(12);
    expect(fake.searchCalls).toHaveLength(12);
    expect(fake.alertsCalls).toHaveLength(0);
    expect(result.status).toBe("partial");
    expect(result.complete).toBe(false);
    expect(result.warnings.join(" ")).toMatch(/request limit/);
    expect(lastUpdate()).not.toHaveProperty("cursor");
  });

  test("a page truncated by size holds the cursor and says so", async () => {
    const fake: FakeClient = makeClient({
      rule: [page([detection("t")], { truncated: true })],
    });

    const result: GoogleSecOpsRunResult =
      await GoogleSecOpsPoller.executeConnection(
        connection({ cursor: "2026-09-14T11:55:00.000Z" }),
        { type: "poll" },
        fake.client,
      );

    expect(result.status).toBe("partial");
    expect(result.ingestedCount).toBe(1);
    expect(result.warnings.join(" ")).toMatch(/truncated a page/);
    expect(lastUpdate()).not.toHaveProperty("cursor");
  });

  test.each([400, 403, 404])(
    "a curated pass answering HTTP %s is a warning, not a failed poll",
    async (status: number) => {
      const fake: FakeClient = makeClient({
        rule: [page([detection("r")])],
        curated: [
          new APIException(
            `Google SecOps detections search failed (HTTP ${status}): {"error":{"code":${status}}}`,
          ),
        ],
      });

      const result: GoogleSecOpsRunResult =
        await GoogleSecOpsPoller.executeConnection(
          connection(),
          { type: "poll" },
          fake.client,
        );

      expect(result.status).toBe("success");
      expect(result.complete).toBe(true);
      expect(result.ingestedCount).toBe(1);
      expect(
        checkNamed(result, "Read curated rule detections by created time")
          ?.status,
      ).toBe("warn");
      expect(result.warnings.join(" ")).toContain(`(HTTP ${status})`);
      expect(fake.alertsCalls).toHaveLength(1);
      expect(lastUpdate()["cursor"]).toBe(NOW.toISOString());
    },
  );

  test.each([401, 429, 500])(
    "a curated pass answering HTTP %s fails the run and holds the cursor",
    async (status: number) => {
      const fake: FakeClient = makeClient({
        rule: [page([detection("r")])],
        curated: [
          new APIException(
            `Google SecOps detections search failed (HTTP ${status}): {"error":{"code":${status}}}`,
          ),
        ],
      });

      const result: GoogleSecOpsRunResult =
        await GoogleSecOpsPoller.executeConnection(
          connection({ cursor: "2026-09-14T11:55:00.000Z" }),
          { type: "poll" },
          fake.client,
        );

      expect(result.status).toBe("failed");
      expect(result.error).toContain(`(HTTP ${status})`);
      expect(
        checkNamed(result, "Read curated rule detections by created time")
          ?.status,
      ).toBe("failed");
      expect(fake.alertsCalls).toHaveLength(0);
      expect(insertedRows).toHaveLength(0);
      expect(lastUpdate()).not.toHaveProperty("cursor");
    },
  );

  test("a curated pass timing out or answering unreadably fails the run like any other pass", async () => {
    const fake: FakeClient = makeClient({
      curated: [
        new APIException(
          "Google SecOps detections search returned a non-JSON body.",
        ),
      ],
    });

    const result: GoogleSecOpsRunResult =
      await GoogleSecOpsPoller.executeConnection(
        connection(),
        { type: "poll" },
        fake.client,
      );

    expect(result.status).toBe("failed");
    expect(result.error).toBe(
      "Google SecOps detections search returned a non-JSON body.",
    );
  });

  test("a rule pass failure names its own step", async () => {
    const fake: FakeClient = makeClient({
      rule: [
        new APIException(
          "Google SecOps detections search failed (HTTP 403): denied",
        ),
      ],
    });

    const result: GoogleSecOpsRunResult =
      await GoogleSecOpsPoller.executeConnection(
        connection(),
        { type: "poll" },
        fake.client,
      );

    expect(result.status).toBe("failed");
    expect(result.checks[result.checks.length - 1]).toMatchObject({
      name: "Read rule detections by created time",
      status: "failed",
    });
    expect(fake.searchCalls).toHaveLength(1);
    expect(fake.alertsCalls).toHaveLength(0);
  });

  test("rejected objects are counted and warned but no longer hold the cursor", async () => {
    const fake: FakeClient = makeClient({
      rule: [page([{ arbitrary: "envelope" }, detection("ok")])],
    });

    const result: GoogleSecOpsRunResult =
      await GoogleSecOpsPoller.executeConnection(
        connection({ cursor: "2026-09-14T11:55:00.000Z" }),
        { type: "poll" },
        fake.client,
      );

    expect(result).toMatchObject({
      status: "success",
      complete: true,
      rejectedCount: 1,
      ingestedCount: 1,
    });
    expect(checkNamed(result, "Normalize detections")?.status).toBe("warn");
    expect(result.warnings.join(" ")).toMatch(/do not hold the poll cursor/);
    expect(lastUpdate()["cursor"]).toBe(NOW.toISOString());
    expect(lastUpdate()["lastError"]).toBeNull();
  });

  test("a normalization failure still holds the cursor", async () => {
    const poison: JSONObject = { id: "poison" };
    Object.defineProperty(poison, "detection", {
      get: (): never => {
        throw new Error("poison");
      },
      enumerable: true,
    });
    const fake: FakeClient = makeClient({
      rule: [page([poison, detection("ok")])],
    });

    const result: GoogleSecOpsRunResult =
      await GoogleSecOpsPoller.executeConnection(
        connection({ cursor: "2026-09-14T11:55:00.000Z" }),
        { type: "poll" },
        fake.client,
      );

    expect(result).toMatchObject({
      status: "partial",
      failedCount: 1,
      ingestedCount: 1,
      complete: false,
    });
    expect(checkNamed(result, "Normalize detections")?.status).toBe("failed");
    expect(lastUpdate()).not.toHaveProperty("cursor");
  });

  test("creation lag is measured and a lag beyond the poll interval explains the created-time basis", async () => {
    const fake: FakeClient = makeClient({
      rule: [
        page([
          detection("late", {
            detectionTime: "2026-09-14T08:00:00.000Z",
            createdTime: "2026-09-14T11:00:00.000Z",
          }),
          detection("prompt", {
            detectionTime: "2026-09-14T11:00:00.000Z",
            createdTime: "2026-09-14T11:02:00.000Z",
          }),
          detection("no-created", { createdTime: undefined }),
        ]),
      ],
    });

    const result: GoogleSecOpsRunResult =
      await GoogleSecOpsPoller.executeConnection(
        connection({ pollIntervalInMinutes: 5 }),
        { type: "poll" },
        fake.client,
      );

    expect(result.creationLag).toEqual({
      measured: 2,
      lateCount: 1,
      maxLagMinutes: 180,
    });
    expect(result.warnings.join(" ")).toMatch(
      /1 of 2 detections were created more than 6 minutes after their detection time \(up to 180 minutes\)\. This is why the connector polls by created time/,
    );
    // Informational: the run is complete and the cursor moves.
    expect(result.status).toBe("success");
    expect(lastUpdate()["cursor"]).toBe(NOW.toISOString());
  });

  test("creation lag within the interval produces statistics but no warning", async () => {
    const fake: FakeClient = makeClient({
      rule: [page([detection("prompt")])],
    });

    const result: GoogleSecOpsRunResult =
      await GoogleSecOpsPoller.executeConnection(
        connection(),
        { type: "poll" },
        fake.client,
      );

    expect(result.creationLag).toEqual({
      measured: 1,
      lateCount: 0,
      maxLagMinutes: 2,
    });
    expect(result.warnings).toEqual([]);
  });

  test("preview reads the search passes by both bases and reports the detection-time basis", async () => {
    const fake: FakeClient = makeClient({
      rule: [page([detection("x")])],
    });

    const result: GoogleSecOpsRunResult =
      await GoogleSecOpsPoller.executeConnection(
        connection(),
        {
          type: "preview",
          startTime: "2026-09-13T00:00:00.000Z",
          endTime: NOW.toISOString(),
        },
        fake.client,
      );

    expect(
      fake.searchCalls.map((call: SearchCall): string => {
        return `${call.curated ? "curated" : "rule"}:${call.listBasis}`;
      }),
    ).toEqual([
      "rule:CREATED_TIME",
      "rule:DETECTION_TIME",
      "curated:CREATED_TIME",
      "curated:DETECTION_TIME",
    ]);
    expect(result.basis).toBe("detection-time");
    expect(result.sourceCounts).toEqual({
      ruleDetections: 2,
      curatedDetections: 0,
      alertsView: 0,
    });
    // The same record read by both bases is one record.
    expect(result.fetchedCount).toBe(1);
    expect(
      checkNamed(result, "Read rule detections by created and detection time"),
    ).toBeDefined();
    expect(insertedRows).toHaveLength(0);
    expect(GoogleSecOpsConnectionService.updateOneById).not.toHaveBeenCalled();
  });

  test("a connection test reads at most one record per pass and never paginates", async () => {
    const fake: FakeClient = makeClient({
      rule: [page([detection("one")], { nextPageToken: "more" })],
      curated: [page([detection("two")], { nextPageToken: "more" })],
      alerts: [fetched([detection("three")])],
    });

    const result: GoogleSecOpsRunResult =
      await GoogleSecOpsPoller.executeConnection(
        connection(),
        { type: "test" },
        fake.client,
      );

    expect(result.status).toBe("success");
    expect(fake.searchCalls).toHaveLength(2);
    expect(
      fake.searchCalls.every((call: SearchCall): boolean => {
        return call.pageSize === 1;
      }),
    ).toBe(true);
    expect(fake.alertsCalls[0]!.maxAlerts).toBe(1);
    expect(result.requestCount).toBe(3);
    expect(insertedRows).toHaveLength(0);
    expect(GoogleSecOpsConnectionService.updateOneById).not.toHaveBeenCalled();
    expect(Semaphore.lock).not.toHaveBeenCalled();
  });

  test("a busy source lock is reported in words and does not read Google", async () => {
    getJestSpyOn(Semaphore, "lock").mockRejectedValue(
      new SemaphoreLockTimeoutError("Acquire GoogleSecOpsSource lock timeout"),
    );
    const fake: FakeClient = makeClient({});

    await expect(
      GoogleSecOpsPoller.executeConnection(
        connection(),
        { type: "poll" },
        fake.client,
      ),
    ).rejects.toThrow(
      "Another poll or import for this source is still running in this project. This run was skipped; polling continues on the next scheduled tick.",
    );
    expect(fake.searchCalls).toHaveLength(0);
    expect(fake.alertsCalls).toHaveLength(0);
    expect(GoogleSecOpsConnectionService.updateOneById).not.toHaveBeenCalled();
  });

  test("any other lock failure is passed through unchanged", async () => {
    getJestSpyOn(Semaphore, "lock").mockRejectedValue(
      new Error("Redis client is not connected"),
    );

    await expect(
      GoogleSecOpsPoller.executeConnection(
        connection(),
        { type: "poll" },
        makeClient({}).client,
      ),
    ).rejects.toThrow("Redis client is not connected");
  });

  test("the dedupe lookup delegates to the shared SecurityEventDedupe with the Google source names", async () => {
    getJestSpyOn(GoogleSecOpsPoller, "findExistingEventUids").mockRestore();
    const shared: ReturnType<typeof getJestSpyOn> = getJestSpyOn(
      SecurityEventDedupe,
      "findExistingEventUids",
    ).mockResolvedValue(new Set(["already"]));

    const found: Set<string> = await GoogleSecOpsPoller.findExistingEventUids(
      PROJECT_ID,
      ["already", "new"],
    );

    expect(found).toEqual(new Set(["already"]));
    expect(shared).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      vendorName: "Google",
      productName: "Google SecOps",
      ids: ["already", "new"],
    });
  });
});
