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
} from "../../../../Server/Utils/SecurityEvent/Connectors/GoogleSecOps/GoogleSecOpsClient";
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
 * seen from the poller, the per-pass request budgets, the union, the
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
    /*
     * Review finding alerts-view-budget-pins-cursor-forever (F1): the chunk
     * is measured from the cursor, not from the overlapped start, so a full
     * 24 hour chunk ends 24 hours after the cursor (it used to end at 11:59).
     */
    expect(result.windowEnd).toBe("2026-09-11T12:00:00.000Z");
    expect(result.chunkMinutes).toBe(24 * 60);
    expect(result.warnings.join(" ")).toMatch(/24 hour windows/);
  });

  test.each([
    [90, "2026-09-10T13:30:00.000Z"],
    [1, "2026-09-10T12:01:00.000Z"],
    [0, "2026-09-11T12:00:00.000Z"],
    [24 * 60 + 1, "2026-09-11T12:00:00.000Z"],
    [2.5, "2026-09-11T12:00:00.000Z"],
    ["90", "2026-09-11T12:00:00.000Z"],
    [null, "2026-09-11T12:00:00.000Z"],
  ])(
    "a stored nextChunkMinutes of %j sets the chunk only when it is a whole number of minutes in range",
    async (stored: unknown, windowEnd: string) => {
      const fake: FakeClient = makeClient({});

      const result: GoogleSecOpsRunResult =
        await GoogleSecOpsPoller.executeConnection(
          connection({
            cursor: "2026-09-10T12:00:00.000Z",
            lastPollResult: {
              type: "poll",
              nextChunkMinutes: stored,
            } as unknown as JSONObject,
          }),
          { type: "poll" },
          fake.client,
        );

      expect(result.windowStart).toBe("2026-09-10T11:59:00.000Z");
      expect(result.windowEnd).toBe(windowEnd);
      expect(lastUpdate()["cursor"]).toBe(windowEnd);
    },
  );

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

  /*
   * Review findings alerts-view-budget-pins-cursor-forever and
   * budget-skipped-passes-reported-success (F1, F1b). The three passes used
   * to share twelve requests, a stopped poll held the cursor on the same
   * window forever with the advice "Narrow the time range", and a curated
   * pass or alerts view that never ran still reported success.
   */
  test("the search passes share a 20 page budget, the alerts view keeps its own, and a stopped poll narrows the next chunk", async () => {
    const fake: FakeClient = makeClient({
      rule: [page([detection("endless")], { nextPageToken: "again" })],
    });

    const result: GoogleSecOpsRunResult =
      await GoogleSecOpsPoller.executeConnection(
        connection({ cursor: "2026-09-14T11:55:00.000Z" }),
        { type: "poll" },
        fake.client,
      );

    expect(fake.searchCalls).toHaveLength(20);
    expect(
      fake.searchCalls.every((call: SearchCall): boolean => {
        return call.curated === false;
      }),
    ).toBe(true);
    // The alerts view still ran on its own budget.
    expect(fake.alertsCalls).toHaveLength(1);
    expect(result.requestCount).toBe(21);
    expect(result.status).toBe("partial");
    expect(result.complete).toBe(false);

    const rule: GoogleSecOpsDiagnosticCheck | undefined = checkNamed(
      result,
      "Read rule detections by created time",
    );
    expect(rule?.status).toBe("warn");
    expect(rule?.message).toContain(
      "stopped by the request budget after 20 requests",
    );
    const curated: GoogleSecOpsDiagnosticCheck | undefined = checkNamed(
      result,
      "Read curated rule detections by created time",
    );
    expect(curated?.status).toBe("warn");
    expect(curated?.message).toContain(
      "stopped by the request budget after 0 requests",
    );
    expect(
      checkNamed(result, "Read alerts view by detection time")?.status,
    ).toBe("success");

    // Five minutes past the cursor could not be read, so the next poll reads two.
    expect(result.chunkMinutes).toBe(5);
    expect(result.nextChunkMinutes).toBe(2);
    expect(result.forcedAdvance).toBeUndefined();
    expect(result.warnings).toContain(
      "This window holds more records than one poll can read; the next poll reads a 2 minute window from the same starting point.",
    );
    expect(result.warnings.join(" ")).not.toMatch(/recovery request limit/);
    expect(lastUpdate()).not.toHaveProperty("cursor");
    expect(lastUpdate()["lastError"]).toContain(
      "the next poll reads a 2 minute window",
    );
  });

  test("a pass the poll time budget never let start is a warning, not a success", async () => {
    const realNow: number = Date.now();
    let elapsedMs: number = 0;
    getJestSpyOn(Date, "now").mockImplementation((): number => {
      return realNow + elapsedMs;
    });
    const fake: FakeClient = makeClient({
      rule: [
        (): SearchDetectionsResult => {
          // The rule pass is slow enough to spend the whole four minutes.
          elapsedMs = 5 * 60 * 1000;
          return page([detection("slow")]);
        },
      ],
    });

    const result: GoogleSecOpsRunResult =
      await GoogleSecOpsPoller.executeConnection(
        connection({ cursor: "2026-09-14T11:55:00.000Z" }),
        { type: "poll" },
        fake.client,
      );

    expect(fake.searchCalls).toHaveLength(1);
    expect(fake.alertsCalls).toHaveLength(0);
    expect(
      checkNamed(result, "Read rule detections by created time")?.status,
    ).toBe("success");
    for (const name of [
      "Read curated rule detections by created time",
      "Read alerts view by detection time",
    ]) {
      expect(checkNamed(result, name)).toMatchObject({
        status: "warn",
        message: "Not run: the poll time budget was spent.",
      });
    }
    expect(result.warnings).toContain(
      "Read alerts view by detection time was not run: the poll time budget was spent.",
    );
    expect(result.status).toBe("partial");
    // What was read is still imported; the cursor waits for a shorter window.
    expect(result.ingestedCount).toBe(1);
    expect(result.nextChunkMinutes).toBe(2);
    expect(lastUpdate()).not.toHaveProperty("cursor");
  });

  test("a pass the poll time budget stops part way names how far it got", async () => {
    const realNow: number = Date.now();
    let elapsedMs: number = 0;
    getJestSpyOn(Date, "now").mockImplementation((): number => {
      return realNow + elapsedMs;
    });
    const fake: FakeClient = makeClient({
      rule: [
        page([detection("first")], { nextPageToken: "t1" }),
        (): SearchDetectionsResult => {
          elapsedMs = 5 * 60 * 1000;
          return page([detection("second")], { nextPageToken: "t2" });
        },
      ],
    });

    const result: GoogleSecOpsRunResult =
      await GoogleSecOpsPoller.executeConnection(
        connection({ cursor: "2026-09-14T11:55:00.000Z" }),
        { type: "poll" },
        fake.client,
      );

    expect(fake.searchCalls).toHaveLength(2);
    expect(
      checkNamed(result, "Read rule detections by created time"),
    ).toMatchObject({
      status: "warn",
      message:
        "2 rule detections returned for the window by created time. The pass was stopped by the poll time budget after 2 requests.",
    });
    expect(result.status).toBe("partial");
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

/*
 * Adaptive catch-up across many polls. Review finding
 * alerts-view-budget-pins-cursor-forever (F1, F1b): a window holding more
 * than one poll could read used to be re-read on every tick with the cursor
 * held, so nothing created after the first poll was ever imported.
 *
 * Every test here drives a fake tenant that answers the way Google
 * documents: the detection searches filter on created time and page newest
 * first; the alerts view filters on detection time, returns at most
 * maxAlerts and reports how many matched in baselineAlertsCount. A
 * simulated connection row carries cursor and lastPollResult from one poll
 * to the next the way the database does.
 */
const MINUTE_MS: number = 60 * 1000;

interface TenantDetection {
  id: string;
  createdMs: number;
  detectionMs: number;
}

interface Tenant {
  detections: Array<TenantDetection>;
  /*
   * Google may return fewer detections than the pageSize asked for. A
   * smaller page keeps the volume needed to overflow the page budget small.
   */
  searchPageSize: number;
  searchFailure?: Error | undefined;
}

interface TenantCalls {
  search: number;
  alerts: number;
}

interface ConnectionRow {
  cursor?: string | undefined;
  lastPollResult?: JSONObject | undefined;
}

interface PollRecord {
  nowMs: number;
  cursorBefore: string | undefined;
  result: GoogleSecOpsRunResult;
  update: JSONObject;
  calls: TenantCalls;
}

function tenantCollection(item: TenantDetection): JSONObject {
  return {
    id: item.id,
    type: "RULE_DETECTION",
    detectionTime: new Date(item.detectionMs).toISOString(),
    createdTime: new Date(item.createdMs).toISOString(),
    detection: [
      { ruleName: "Burst rule", alertState: "ALERTING", severity: "HIGH" },
    ],
  };
}

function inRange(timeMs: number, startTime: Date, endTime: Date): boolean {
  return timeMs >= startTime.getTime() && timeMs < endTime.getTime();
}

function tenantClient(tenant: Tenant, calls: TenantCalls): GoogleSecOpsClient {
  return {
    testAuthentication: jest.fn(async (): Promise<void> => {}),
    searchDetections: jest.fn(
      async (call: SearchCall): Promise<SearchDetectionsResult> => {
        calls.search++;
        if (tenant.searchFailure) {
          throw tenant.searchFailure;
        }
        if (call.curated) {
          return page([]);
        }
        const matched: Array<TenantDetection> = tenant.detections
          .filter((item: TenantDetection): boolean => {
            return inRange(item.createdMs, call.startTime, call.endTime);
          })
          .sort((a: TenantDetection, b: TenantDetection): number => {
            return b.createdMs - a.createdMs;
          });
        const offset: number = call.pageToken ? Number(call.pageToken) : 0;
        const next: number =
          offset + Math.min(call.pageSize || 1000, tenant.searchPageSize);
        return page(matched.slice(offset, next).map(tenantCollection), {
          nextPageToken: next < matched.length ? String(next) : null,
        });
      },
    ),
    fetchDetectionAlerts: jest.fn(
      async (call: AlertsCall): Promise<FetchAlertsResult> => {
        calls.alerts++;
        const matched: Array<TenantDetection> = tenant.detections
          .filter((item: TenantDetection): boolean => {
            return inRange(item.detectionMs, call.startTime, call.endTime);
          })
          .sort((a: TenantDetection, b: TenantDetection): number => {
            return b.detectionMs - a.detectionMs;
          });
        const returned: Array<TenantDetection> = matched.slice(
          0,
          call.maxAlerts || 1000,
        );
        return fetched(returned.map(tenantCollection), {
          truncatedByCount: matched.length > returned.length,
          baselineAlertsCount: matched.length,
          filteredAlertsCount: matched.length,
        });
      },
    ),
  } as unknown as GoogleSecOpsClient;
}

describe("GoogleSecOpsPoller adaptive catch-up across polls", () => {
  let stored: Set<string>;

  beforeEach(() => {
    stored = new Set();
    getJestSpyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(NOW);
    getJestSpyOn(Semaphore, "lock").mockResolvedValue({});
    getJestSpyOn(Semaphore, "release").mockResolvedValue(undefined);
    // Dedupe against what earlier polls stored, as ClickHouse would.
    getJestSpyOn(
      GoogleSecOpsPoller,
      "findExistingEventUids",
    ).mockImplementation(
      async (
        _projectId: ObjectID,
        ids: Array<string>,
      ): Promise<Set<string>> => {
        return new Set(
          ids.filter((id: string): boolean => {
            return stored.has(id);
          }),
        );
      },
    );
    getJestSpyOn(SecurityEventService, "insertJsonRows").mockImplementation(((
      rows: Array<JSONObject>,
    ): Promise<void> => {
      for (const row of rows) {
        stored.add(String(row["eventUid"]));
      }
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
    getJestSpyOn(logger, "debug").mockImplementation((): void => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  /*
   * Runs scheduled polls one after another, carrying the row forward, and
   * checks the two properties every poll must keep: a written cursor only
   * moves forward, and no pass goes past its request budget.
   */
  async function runPolls(data: {
    tenant: Tenant;
    row: ConnectionRow;
    startMs: number;
    stepMinutes: number;
    maxPolls: number;
    beforePoll?: ((index: number, nowMs: number) => void) | undefined;
    until?: ((record: PollRecord) => boolean) | undefined;
  }): Promise<Array<PollRecord>> {
    const records: Array<PollRecord> = [];
    for (let index: number = 0; index < data.maxPolls; index++) {
      const nowMs: number = data.startMs + index * data.stepMinutes * MINUTE_MS;
      getJestSpyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(
        new Date(nowMs),
      );
      if (data.beforePoll) {
        data.beforePoll(index, nowMs);
      }
      const calls: TenantCalls = { search: 0, alerts: 0 };
      const cursorBefore: string | undefined = data.row.cursor;
      const result: GoogleSecOpsRunResult =
        await GoogleSecOpsPoller.executeConnection(
          connection({
            ...(data.row.cursor ? { cursor: data.row.cursor } : {}),
            ...(data.row.lastPollResult
              ? { lastPollResult: data.row.lastPollResult }
              : {}),
          }),
          { type: "poll" },
          tenantClient(data.tenant, calls),
        );
      const update: JSONObject = lastUpdate();
      // The row keeps a JSON copy, not the live result object.
      data.row.lastPollResult = JSON.parse(
        JSON.stringify(update["lastPollResult"]),
      ) as JSONObject;
      const written: unknown = update["cursor"];
      if (typeof written === "string") {
        if (cursorBefore) {
          expect(Date.parse(written)).toBeGreaterThan(Date.parse(cursorBefore));
        }
        data.row.cursor = written;
      }
      expect(calls.search).toBeLessThanOrEqual(20);
      expect(calls.alerts).toBeLessThanOrEqual(16);
      const record: PollRecord = {
        nowMs,
        cursorBefore,
        result,
        update,
        calls,
      };
      records.push(record);
      if (data.until && data.until(record)) {
        break;
      }
    }
    return records;
  }

  function chunks(
    records: Array<PollRecord>,
    key: "chunkMinutes" | "nextChunkMinutes",
  ): Array<number | undefined> {
    return records.map((record: PollRecord): number | undefined => {
      return record.result[key];
    });
  }

  test("Case A: 1,200 detections created in one hour of the first 24 hour window no longer pin the cursor", async () => {
    const tenant: Tenant = { detections: [], searchPageSize: 1000 };
    const burstStartMs: number = NOW.getTime() - 6 * 60 * MINUTE_MS;
    for (let index: number = 0; index < 1200; index++) {
      const detectionMs: number =
        burstStartMs + Math.floor((index * 60 * MINUTE_MS) / 1200);
      tenant.detections.push({
        id: `burst-${index}`,
        detectionMs,
        createdMs: detectionMs + MINUTE_MS,
      });
    }
    const createdAfterFirstPollMs: number = NOW.getTime() + 3 * MINUTE_MS;
    const row: ConnectionRow = {};

    const records: Array<PollRecord> = await runPolls({
      tenant,
      row,
      startMs: NOW.getTime(),
      stepMinutes: 5,
      maxPolls: 4,
      beforePoll: (index: number): void => {
        if (index === 1) {
          tenant.detections.push({
            id: "created-after-first-poll",
            detectionMs: createdAfterFirstPollMs - MINUTE_MS,
            createdMs: createdAfterFirstPollMs,
          });
        }
      },
    });

    const first: PollRecord = records[0]!;
    /*
     * The alerts view splits the day around the burst. With the old shared
     * budget of twelve requests the two search pages and the curated page
     * left nine for it, which was not enough; on its own budget it finishes.
     */
    expect(first.calls.search).toBe(3);
    expect(first.calls.search + first.calls.alerts).toBeGreaterThan(12);
    expect(first.result).toMatchObject({
      windowStart: "2026-09-13T12:00:00.000Z",
      windowEnd: NOW.toISOString(),
      status: "success",
      complete: true,
      ingestedCount: 1200,
      chunkMinutes: 24 * 60,
      nextChunkMinutes: 24 * 60,
    });
    expect(first.update["cursor"]).toBe(NOW.toISOString());

    // The next tick reads forward from the cursor and imports the new detection.
    const second: PollRecord = records[1]!;
    expect(second.result.windowStart).toBe("2026-09-14T11:59:00.000Z");
    expect(second.result.ingestedCount).toBe(1);
    expect(stored.has("created-after-first-poll")).toBe(true);
    expect(stored.size).toBe(1201);
    expect(
      records.every((record: PollRecord): boolean => {
        return record.result.complete;
      }),
    ).toBe(true);
  });

  test("Case B: 1,001 detections sharing one detection time force one reported advance and newer detections still arrive", async () => {
    const tenant: Tenant = { detections: [], searchPageSize: 1000 };
    const sharedDetectionMs: number = NOW.getTime() - 3 * MINUTE_MS;
    for (let index: number = 0; index < 1001; index++) {
      tenant.detections.push({
        id: `shared-${index}`,
        detectionMs: sharedDetectionMs,
        createdMs: sharedDetectionMs + 30 * 1000,
      });
    }
    let laterCreatedMs: number = 0;
    const row: ConnectionRow = { cursor: "2026-09-14T11:55:00.000Z" };

    const records: Array<PollRecord> = await runPolls({
      tenant,
      row,
      startMs: NOW.getTime(),
      stepMinutes: 5,
      maxPolls: 10,
      beforePoll: (index: number, nowMs: number): void => {
        if (index === 2) {
          laterCreatedMs = nowMs - 30 * 1000;
          tenant.detections.push({
            id: "later",
            detectionMs: nowMs - MINUTE_MS,
            createdMs: laterCreatedMs,
          });
        }
      },
      until: (record: PollRecord): boolean => {
        return stored.has("later") && record.result.complete;
      },
    });

    // The created-time pass read all of them on the first poll.
    const first: PollRecord = records[0]!;
    expect(first.result.sourceCounts?.ruleDetections).toBe(1001);
    expect(stored.size).toBeGreaterThanOrEqual(1001);
    expect(first.result.status).toBe("partial");
    expect(
      checkNamed(first.result, "Read alerts view by detection time"),
    ).toMatchObject({ status: "warn" });
    expect(
      checkNamed(first.result, "Read alerts view by detection time")?.message,
    ).toContain("stopped by the request budget after 16 requests");

    // The alerts view can never split one detection time, so one minute is skipped and reported.
    const forced: Array<PollRecord> = records.filter(
      (record: PollRecord): boolean => {
        return record.result.forcedAdvance === true;
      },
    );
    expect(forced).toHaveLength(1);
    const forcedWarning: string =
      "More records were created in the one minute from 2026-09-14T11:57:00.000Z to 2026-09-14T11:58:00.000Z than one poll can read. Polling moved past this minute so newer records keep arriving; use Import this time range in Diagnostics on this minute to recover what one run can read.";
    expect(forced[0]!.result.warnings[0]).toBe(forcedWarning);
    expect(
      String(forced[0]!.update["lastError"]).startsWith(forcedWarning),
    ).toBe(true);
    expect(forced[0]!.update["cursor"]).toBe("2026-09-14T11:58:00.000Z");

    // The poll after it starts at the skipped minute's end instead of overflowing on it again.
    const afterForced: PollRecord = records[records.indexOf(forced[0]!) + 1]!;
    expect(afterForced.result.windowStart).toBe("2026-09-14T11:58:00.000Z");
    expect(afterForced.result.complete).toBe(true);

    // Bounded: the detection created after the burst is imported within ten polls.
    expect(stored.has("later")).toBe(true);
    expect(records.length).toBeLessThanOrEqual(10);
    expect(Date.parse(row.cursor!)).toBeGreaterThan(laterCreatedMs);
  });

  test("narrowing halves the chunk until a window fits, then doubles it back", async () => {
    const cursorMs: number = Date.parse("2026-09-12T12:00:00.000Z");
    const tenant: Tenant = { detections: [], searchPageSize: 100 };
    // 2,500 detections created in one hour: more than 20 pages of 100.
    for (let index: number = 0; index < 2500; index++) {
      const createdMs: number =
        cursorMs + 60 * MINUTE_MS + Math.floor((index * 60 * MINUTE_MS) / 2500);
      tenant.detections.push({
        id: `hour-${index}`,
        createdMs,
        // Detected long ago, so only the created-time searches see them.
        detectionMs: createdMs - 30 * 24 * 60 * MINUTE_MS,
      });
    }
    const row: ConnectionRow = { cursor: new Date(cursorMs).toISOString() };

    const records: Array<PollRecord> = await runPolls({
      tenant,
      row,
      startMs: NOW.getTime(),
      stepMinutes: 5,
      maxPolls: 8,
    });

    expect(chunks(records, "chunkMinutes")).toEqual([
      1440, 720, 360, 180, 90, 180, 360, 720,
    ]);
    expect(chunks(records, "nextChunkMinutes")).toEqual([
      720, 360, 180, 90, 180, 360, 720, 1440,
    ]);
    expect(
      records.map((record: PollRecord): boolean => {
        return record.result.complete;
      }),
    ).toEqual([false, false, false, false, true, true, true, true]);
    for (const record of records.slice(0, 4)) {
      expect(record.update).not.toHaveProperty("cursor");
      expect(record.result.windowStart).toBe("2026-09-12T11:59:00.000Z");
      expect(
        checkNamed(record.result, "Read rule detections by created time")
          ?.message,
      ).toContain("stopped by the request budget after 20 requests");
      expect(record.result.warnings).toContain(
        `This window holds more records than one poll can read; the next poll reads a ${record.result.nextChunkMinutes} minute window from the same starting point.`,
      );
    }
    expect(
      records.slice(4).map((record: PollRecord): unknown => {
        return record.update["cursor"];
      }),
    ).toEqual([
      "2026-09-12T13:30:00.000Z",
      "2026-09-12T16:30:00.000Z",
      "2026-09-12T22:30:00.000Z",
      "2026-09-13T10:30:00.000Z",
    ]);
    expect(stored.size).toBe(2500);
  });

  test("a one-minute window that still overflows forces an advance with the warning in lastError", async () => {
    const minuteMs: number = Date.parse("2026-09-14T11:00:00.000Z");
    const tenant: Tenant = { detections: [], searchPageSize: 100 };
    for (let index: number = 0; index < 2500; index++) {
      const createdMs: number =
        minuteMs + Math.floor((index * MINUTE_MS) / 2500);
      tenant.detections.push({
        id: `minute-${index}`,
        createdMs,
        detectionMs: createdMs - 30 * 24 * 60 * MINUTE_MS,
      });
    }
    const row: ConnectionRow = {
      cursor: "2026-09-14T11:00:00.000Z",
      lastPollResult: { type: "poll", nextChunkMinutes: 4 },
    };
    const outage: APIException = new APIException(
      'Google SecOps detections search failed (HTTP 503): {"error":{"code":503}}',
    );

    const records: Array<PollRecord> = await runPolls({
      tenant,
      row,
      startMs: NOW.getTime(),
      stepMinutes: 5,
      maxPolls: 6,
      beforePoll: (index: number): void => {
        // The poll right after the forced advance fails once.
        tenant.searchFailure = index === 3 ? outage : undefined;
      },
    });

    expect(chunks(records, "chunkMinutes")).toEqual([4, 2, 1, 1, 1, 2]);
    expect(chunks(records, "nextChunkMinutes")).toEqual([2, 1, 1, 1, 2, 4]);
    expect(
      records.map((record: PollRecord): string => {
        return record.result.status;
      }),
    ).toEqual(["partial", "partial", "partial", "failed", "empty", "empty"]);

    const forced: PollRecord = records[2]!;
    const warning: string =
      "More records were created in the one minute from 2026-09-14T11:00:00.000Z to 2026-09-14T11:01:00.000Z than one poll can read. Polling moved past this minute so newer records keep arriving; use Import this time range in Diagnostics on this minute to recover what one run can read.";
    expect(forced.result.forcedAdvance).toBe(true);
    expect(forced.result.warnings[0]).toBe(warning);
    expect(forced.update["cursor"]).toBe("2026-09-14T11:01:00.000Z");
    expect(String(forced.update["lastError"]).startsWith(warning)).toBe(true);
    expect(forced.update).not.toHaveProperty("lastSuccessfulPollAt");

    // A failure keeps the cursor and the chunk, and the retry still starts past the skipped minute.
    expect(records[3]!.update).not.toHaveProperty("cursor");
    expect(records[3]!.result.windowStart).toBe("2026-09-14T11:01:00.000Z");
    expect(records[3]!.update["lastError"]).toContain("HTTP 503");
    expect(records[4]!.result.windowStart).toBe("2026-09-14T11:01:00.000Z");
    expect(records[4]!.update["cursor"]).toBe("2026-09-14T11:02:00.000Z");
    expect(records[4]!.update["lastError"]).toBeNull();
    // Once past it, the usual one minute overlap is back.
    expect(records[5]!.result.windowStart).toBe("2026-09-14T11:01:00.000Z");
    expect(records[5]!.result.windowEnd).toBe("2026-09-14T11:04:00.000Z");
  });

  test("a caught-up poll keeps the chunk it was given, so the poll after a failure or a late tick still reaches the present", async () => {
    const tenant: Tenant = {
      detections: [],
      searchPageSize: 1000,
      searchFailure: new APIException(
        'Google SecOps detections search failed (HTTP 500): {"error":{"code":500}}',
      ),
    };
    const row: ConnectionRow = { cursor: "2026-09-14T11:55:00.000Z" };

    const records: Array<PollRecord> = await runPolls({
      tenant,
      row,
      startMs: NOW.getTime(),
      stepMinutes: 30,
      maxPolls: 3,
      beforePoll: (index: number): void => {
        if (index === 1) {
          tenant.searchFailure = undefined;
        }
      },
    });

    /*
     * These windows reach five and thirty-five minutes past the cursor only
     * because they end at the present. That length says nothing about
     * volume, so it must not become the next chunk and leave later polls
     * behind.
     */
    expect(records[0]!.result).toMatchObject({
      status: "failed",
      chunkMinutes: 5,
      nextChunkMinutes: 24 * 60,
    });
    expect(records[1]!.result).toMatchObject({
      status: "empty",
      windowStart: "2026-09-14T11:54:00.000Z",
      windowEnd: "2026-09-14T12:30:00.000Z",
      chunkMinutes: 35,
      nextChunkMinutes: 24 * 60,
    });
    expect(records[2]!.result.windowEnd).toBe("2026-09-14T13:00:00.000Z");
  });

  test("a failed poll keeps its chunk; only a finished or overflowing poll changes it", async () => {
    const tenant: Tenant = {
      detections: [],
      searchPageSize: 1000,
      searchFailure: new APIException(
        'Google SecOps detections search failed (HTTP 500): {"error":{"code":500}}',
      ),
    };
    const row: ConnectionRow = {
      cursor: "2026-09-14T10:00:00.000Z",
      lastPollResult: { type: "poll", nextChunkMinutes: 30 },
    };

    const records: Array<PollRecord> = await runPolls({
      tenant,
      row,
      startMs: NOW.getTime(),
      stepMinutes: 5,
      maxPolls: 3,
      beforePoll: (index: number): void => {
        if (index === 2) {
          tenant.searchFailure = undefined;
        }
      },
    });

    for (const record of records.slice(0, 2)) {
      expect(record.result).toMatchObject({
        status: "failed",
        windowStart: "2026-09-14T09:59:00.000Z",
        windowEnd: "2026-09-14T10:30:00.000Z",
        chunkMinutes: 30,
        nextChunkMinutes: 30,
      });
      expect(record.update).not.toHaveProperty("cursor");
    }
    expect(records[2]!.result).toMatchObject({
      status: "empty",
      windowEnd: "2026-09-14T10:30:00.000Z",
      chunkMinutes: 30,
      nextChunkMinutes: 60,
    });
    expect(records[2]!.update["cursor"]).toBe("2026-09-14T10:30:00.000Z");
  });
});
