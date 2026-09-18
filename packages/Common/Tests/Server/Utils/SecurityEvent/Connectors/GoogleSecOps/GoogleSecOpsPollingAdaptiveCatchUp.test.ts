import SecurityEventConnectionPoller from "../../../../../../Server/Utils/SecurityEvent/Connectors/SecurityEventConnectionPoller";
import SecurityEventConnectorRegistry from "../../../../../../Server/Utils/SecurityEvent/Connectors/SecurityEventConnectorRegistry";
import OneUptimeDate from "../../../../../../Types/Date";
import { JSONObject } from "../../../../../../Types/JSON";
import { SecurityEventConnectionRunResult } from "../../../../../../Types/SecurityEvent/Connectors/SecurityEventConnectionDiagnostics";
import { getJestSpyOn } from "../../../../../Spy";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  GoogleSecOpsTenant,
  MINUTE_MS,
  PollPersistence,
  TenantReply,
  TenantRequest,
  findCheck,
  googleError,
  lastUpdate,
  requestWindow,
  secOpsConnection,
  stubPollPersistence,
} from "./GoogleSecOpsPollingFixtures";

/*
 * Adaptive catch-up across many Google SecOps polls, through the REAL shared
 * poller and the REAL GoogleSecOpsConnector over a simulated tenant.
 *
 * Review finding alerts-view-budget-pins-cursor-forever (F1, F1b): a window
 * holding more than one poll could read used to be re-read on every tick
 * with the cursor held, so nothing created after the first poll was ever
 * imported. The retired GoogleSecOpsPoller fixed that itself; the shared
 * loop now does it for every provider, and these are the scenarios that
 * pinned the fix, re-run against the connector's real 20 page search budget,
 * its 200 request curated budget and its 16 request alerts-view budget
 * (shared by the window's own read and the late-alert sweep behind it), and
 * Google's real response shapes.
 *
 * A simulated connection row carries cursor and lastPollResult from one poll
 * to the next the way the database does (a JSON copy, not the live object).
 */

jest.mock(
  "../../../../../../Server/Utils/SecurityEvent/Connectors/SecurityEventConnectorRegistry",
  () => {
    return {
      __esModule: true,
      default: { getConnector: jest.fn() },
    };
  },
);

const NOW: Date = new Date("2026-09-14T12:00:00.000Z");

interface ConnectionRow {
  cursor?: string | undefined;
  lastPollResult?: JSONObject | undefined;
}

interface TenantCalls {
  // Rule detection search pages, under their own 20 page budget.
  search: number;
  /*
   * The curated pass, under its own 200 request budget: the count that names
   * the curated rules with recent detections, then one search per rule,
   * because the curated route has no wildcard.
   */
  curated: number;
  // The window's own alerts-view read and the late-alert sweep behind it.
  alerts: number;
}

interface PollRecord {
  nowMs: number;
  cursorBefore: string | undefined;
  result: SecurityEventConnectionRunResult;
  update: JSONObject;
  calls: TenantCalls;
}

let tenant: GoogleSecOpsTenant;
let persistence: PollPersistence;

beforeEach(() => {
  getJestSpyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(NOW);
  persistence = stubPollPersistence();
  tenant = new GoogleSecOpsTenant();
});

afterEach(() => {
  jest.restoreAllMocks();
  (
    SecurityEventConnectorRegistry.getConnector as unknown as jest.Mock
  ).mockReset();
});

async function pollOnce(
  row: ConnectionRow,
): Promise<SecurityEventConnectionRunResult> {
  return SecurityEventConnectionPoller.executeConnection(
    secOpsConnection({
      ...(row.cursor ? { cursor: row.cursor } : {}),
      ...(row.lastPollResult ? { lastPollResult: row.lastPollResult } : {}),
    }),
    { type: "poll" },
    tenant.overrides(),
  );
}

/*
 * Runs scheduled polls one after another, carrying the row forward, and
 * checks the two properties every poll must keep: a written cursor only
 * moves forward, and no pass goes past its request budget.
 */
async function runPolls(data: {
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

    const requestsBefore: number = tenant.requests.length;
    const updatesBefore: number = persistence.updates.length;
    const cursorBefore: string | undefined = data.row.cursor;
    const result: SecurityEventConnectionRunResult = await pollOnce(data.row);

    // Every scheduled poll books itself exactly once.
    expect(persistence.updates.length).toBe(updatesBefore + 1);
    const update: JSONObject = lastUpdate(persistence);
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

    const sent: Array<TenantRequest> = tenant.requests.slice(requestsBefore);
    const calls: TenantCalls = {
      search: sent.filter((request: TenantRequest): boolean => {
        return request.route === "search";
      }).length,
      curated: sent.filter((request: TenantRequest): boolean => {
        return request.route === "curatedCounts" || request.route === "curated";
      }).length,
      alerts: sent.filter((request: TenantRequest): boolean => {
        return request.route === "alerts";
      }).length,
    };
    expect(calls.search).toBeLessThanOrEqual(20);
    expect(calls.curated).toBeLessThanOrEqual(200);
    expect(calls.alerts).toBeLessThanOrEqual(16);

    const record: PollRecord = { nowMs, cursorBefore, result, update, calls };
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

function checkMessage(
  result: SecurityEventConnectionRunResult,
  key: string,
): string {
  return findCheck(result.checks, key).message;
}

/*
 * The interval one countAllCuratedRuleSetDetections request asked for. That
 * route is a POST, so its range is in the JSON body rather than the query
 * string requestWindow reads.
 */
function countsInterval(request: TenantRequest): {
  startTime: string;
  endTime: string;
} {
  const interval: JSONObject = (JSON.parse(request.body || "{}") as JSONObject)[
    "interval"
  ] as JSONObject;

  return {
    startTime: String(interval["startTime"]),
    endTime: String(interval["endTime"]),
  };
}

describe("Google SecOps poll windows through the shared poller", () => {
  test("the first poll of a new connection looks back 24 hours by created time", async () => {
    const result: SecurityEventConnectionRunResult = await pollOnce({});

    expect(result.windowStart).toBe("2026-09-13T12:00:00.000Z");
    expect(result.windowEnd).toBe(NOW.toISOString());
    const firstSearch: TenantRequest = tenant.requestsTo("search")[0]!;
    expect(requestWindow(firstSearch).startTime).toBe(
      "2026-09-13T12:00:00.000Z",
    );
    expect(firstSearch.url.searchParams.get("listBasis")).toBe("CREATED_TIME");
  });

  test("a saved cursor starts the window one minute earlier and ends now", async () => {
    const result: SecurityEventConnectionRunResult = await pollOnce({
      cursor: "2026-09-14T11:55:00.000Z",
    });

    expect(result.windowStart).toBe("2026-09-14T11:54:00.000Z");
    expect(result.windowEnd).toBe(NOW.toISOString());
    expect(lastUpdate(persistence)["cursor"]).toBe(NOW.toISOString());
  });

  test("a stale cursor is caught up in 24 hour chunks", async () => {
    const result: SecurityEventConnectionRunResult = await pollOnce({
      cursor: "2026-09-10T12:00:00.000Z",
    });

    expect(result.windowStart).toBe("2026-09-10T11:59:00.000Z");
    /*
     * Review finding alerts-view-budget-pins-cursor-forever (F1): the chunk
     * is measured from the cursor, not from the overlapped start, so a full
     * 24 hour chunk ends 24 hours after the cursor.
     */
    expect(result.windowEnd).toBe("2026-09-11T12:00:00.000Z");
    expect(result.chunkMinutes).toBe(24 * 60);
    expect(result.warnings.join(" ")).toMatch(/24 hour windows/);
  });

  /*
   * The third column is where the late-alert sweep starts: a scheduled
   * window shorter than a day is followed by an alerts-view read of the
   * whole day before it, and a window that already reaches back that far
   * (every 24 hour chunk here) is followed by none.
   */
  test.each([
    [90, "2026-09-10T13:30:00.000Z", "2026-09-09T13:30:00.000Z"],
    [1, "2026-09-10T12:01:00.000Z", "2026-09-09T12:01:00.000Z"],
    [0, "2026-09-11T12:00:00.000Z", null],
    [24 * 60 + 1, "2026-09-11T12:00:00.000Z", null],
    [2.5, "2026-09-11T12:00:00.000Z", null],
    ["90", "2026-09-11T12:00:00.000Z", null],
    [null, "2026-09-11T12:00:00.000Z", null],
  ])(
    "a stored nextChunkMinutes of %j sets the chunk only when it is a whole number of minutes in range",
    async (stored: unknown, windowEnd: string, sweepStart: string | null) => {
      const result: SecurityEventConnectionRunResult = await pollOnce({
        cursor: "2026-09-10T12:00:00.000Z",
        lastPollResult: {
          type: "poll",
          nextChunkMinutes: stored,
        } as unknown as JSONObject,
      });

      expect(result.windowStart).toBe("2026-09-10T11:59:00.000Z");
      expect(result.windowEnd).toBe(windowEnd);
      // Both detection searches read exactly that window.
      for (const request of tenant.requests.filter(
        (candidate: TenantRequest): boolean => {
          return candidate.route === "search" || candidate.route === "curated";
        },
      )) {
        expect(requestWindow(request)).toEqual({
          startTime: "2026-09-10T11:59:00.000Z",
          endTime: windowEnd,
        });
      }
      /*
       * The curated rule counts reach a week further back than the window:
       * they name the rules the wildcard-less curated search then reads, and
       * a detection created in this window can carry a detection time days
       * earlier.
       */
      expect(countsInterval(tenant.requestsTo("curatedCounts")[0]!)).toEqual({
        startTime: "2026-09-03T11:59:00.000Z",
        endTime: windowEnd,
      });
      /*
       * The alerts view reads the window itself, then sweeps the day in
       * front of it for alerts Google made readable after their detection
       * time - the sweep ends exactly where the window begins.
       */
      expect(
        tenant
          .requestsTo("alerts")
          .map(
            (
              request: TenantRequest,
            ): { startTime: string; endTime: string } => {
              return requestWindow(request);
            },
          ),
      ).toEqual([
        { startTime: "2026-09-10T11:59:00.000Z", endTime: windowEnd },
        ...(sweepStart
          ? [{ startTime: sweepStart, endTime: "2026-09-10T11:59:00.000Z" }]
          : []),
      ]);
      expect(lastUpdate(persistence)["cursor"]).toBe(windowEnd);
    },
  );
});

describe("Google SecOps adaptive catch-up across polls through the shared poller", () => {
  test("Case A: 1,200 detections created in one hour of the first 24 hour window no longer pin the cursor", async () => {
    const burstStartMs: number = NOW.getTime() - 6 * 60 * MINUTE_MS;
    for (let index: number = 0; index < 1200; index++) {
      const detectionMs: number =
        burstStartMs + Math.floor((index * 60 * MINUTE_MS) / 1200);
      tenant.add({
        id: `burst-${index}`,
        detectionMs,
        createdMs: detectionMs + MINUTE_MS,
      });
    }
    const createdAfterFirstPollMs: number = NOW.getTime() + 3 * MINUTE_MS;
    const row: ConnectionRow = {};

    const records: Array<PollRecord> = await runPolls({
      row,
      startMs: NOW.getTime(),
      stepMinutes: 5,
      maxPolls: 4,
      beforePoll: (index: number): void => {
        if (index === 1) {
          tenant.add({
            id: "created-after-first-poll",
            detectionMs: createdAfterFirstPollMs - MINUTE_MS,
            createdMs: createdAfterFirstPollMs,
          });
        }
      },
    });

    const first: PollRecord = records[0]!;
    /*
     * Two rule search pages, and one curated request: the count, which names
     * no curated rule for this tenant and so asks for no curated search.
     * Meanwhile the alerts view splits the day around the burst eleven ways.
     * With the old shared budget of twelve requests that was not enough; on
     * its own budget it finishes.
     */
    expect(first.calls).toEqual({ search: 2, curated: 1, alerts: 11 });
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
    expect(persistence.stored.has("created-after-first-poll")).toBe(true);
    expect(persistence.stored.size).toBe(1201);
    expect(
      records.every((record: PollRecord): boolean => {
        return record.result.complete;
      }),
    ).toBe(true);
  });

  test("Case B: 1,001 detections sharing one detection time force one reported advance and newer detections still arrive", async () => {
    const sharedDetectionMs: number = NOW.getTime() - 3 * MINUTE_MS;
    for (let index: number = 0; index < 1001; index++) {
      tenant.add({
        id: `shared-${index}`,
        detectionMs: sharedDetectionMs,
        createdMs: sharedDetectionMs + 30 * 1000,
      });
    }
    let laterCreatedMs: number = 0;
    const row: ConnectionRow = { cursor: "2026-09-14T11:55:00.000Z" };

    const records: Array<PollRecord> = await runPolls({
      row,
      startMs: NOW.getTime(),
      stepMinutes: 5,
      maxPolls: 10,
      beforePoll: (index: number, nowMs: number): void => {
        if (index === 2) {
          laterCreatedMs = nowMs - 30 * 1000;
          tenant.add({
            id: "later",
            detectionMs: nowMs - MINUTE_MS,
            createdMs: laterCreatedMs,
          });
        }
      },
      until: (record: PollRecord): boolean => {
        return persistence.stored.has("later") && record.result.complete;
      },
    });

    // The created-time pass read all of them on the first poll.
    const first: PollRecord = records[0]!;
    expect(first.result.providerDetails?.["sourceCounts"]).toMatchObject({
      ruleDetections: 1001,
    });
    expect(persistence.stored.size).toBeGreaterThanOrEqual(1001);
    expect(first.result.status).toBe("partial");
    expect(findCheck(first.result.checks, "read-alerts-view")).toMatchObject({
      name: "Read alerts view by detection time",
      status: "warn",
    });
    expect(checkMessage(first.result, "read-alerts-view")).toContain(
      "stopped by the request budget after 16 requests",
    );
    /*
     * The shared loop's summary read check warns for a window it did not
     * finish; the retired poller had no summary step.
     */
    expect(findCheck(first.result.checks, "read").status).toBe("warn");

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
    expect(forced[0]!.result.overlapFloor).toBe("2026-09-14T11:58:00.000Z");

    // The poll after it starts at the skipped minute's end (overlapFloor) instead of overflowing on it again.
    const afterForced: PollRecord = records[records.indexOf(forced[0]!) + 1]!;
    expect(afterForced.result.windowStart).toBe("2026-09-14T11:58:00.000Z");
    expect(afterForced.result.complete).toBe(true);

    // Bounded: the detection created after the burst is imported within ten polls.
    expect(persistence.stored.has("later")).toBe(true);
    expect(records.length).toBeLessThanOrEqual(10);
    expect(Date.parse(row.cursor!)).toBeGreaterThan(laterCreatedMs);
  });

  test("narrowing halves the chunk until a window fits, then doubles it back", async () => {
    const cursorMs: number = Date.parse("2026-09-12T12:00:00.000Z");
    tenant.searchPageSize = 100;
    // 2,500 detections created in one hour: more than 20 pages of 100.
    for (let index: number = 0; index < 2500; index++) {
      const createdMs: number =
        cursorMs + 60 * MINUTE_MS + Math.floor((index * 60 * MINUTE_MS) / 2500);
      tenant.add({
        id: `hour-${index}`,
        createdMs,
        // Detected long ago, so only the created-time searches see them.
        detectionMs: createdMs - 30 * 24 * 60 * MINUTE_MS,
      });
    }
    const row: ConnectionRow = { cursor: new Date(cursorMs).toISOString() };

    const records: Array<PollRecord> = await runPolls({
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
      expect(checkMessage(record.result, "read-rule-detections")).toContain(
        "stopped by the request budget after 20 requests",
      );
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
    expect(persistence.stored.size).toBe(2500);
  });

  test("a one-minute window that still overflows forces an advance with the warning in lastError", async () => {
    const minuteMs: number = Date.parse("2026-09-14T11:00:00.000Z");
    tenant.searchPageSize = 100;
    for (let index: number = 0; index < 2500; index++) {
      const createdMs: number =
        minuteMs + Math.floor((index * MINUTE_MS) / 2500);
      tenant.add({
        id: `minute-${index}`,
        createdMs,
        detectionMs: createdMs - 30 * 24 * 60 * MINUTE_MS,
      });
    }
    const row: ConnectionRow = {
      cursor: "2026-09-14T11:00:00.000Z",
      lastPollResult: { type: "poll", nextChunkMinutes: 4 },
    };
    let outage: boolean = false;
    tenant.scripts.search = (): TenantReply | undefined => {
      return outage
        ? { status: 503, body: JSON.stringify({ error: { code: 503 } }) }
        : undefined;
    };

    const records: Array<PollRecord> = await runPolls({
      row,
      startMs: NOW.getTime(),
      stepMinutes: 5,
      maxPolls: 6,
      beforePoll: (index: number): void => {
        // The poll right after the forced advance fails once.
        outage = index === 3;
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
    expect(records[3]!.result.overlapFloor).toBe("2026-09-14T11:01:00.000Z");
    expect(records[4]!.result.windowStart).toBe("2026-09-14T11:01:00.000Z");
    expect(records[4]!.update["cursor"]).toBe("2026-09-14T11:02:00.000Z");
    expect(records[4]!.update["lastError"]).toBeNull();
    // Once past it, the usual one minute overlap is back.
    expect(records[5]!.result.windowStart).toBe("2026-09-14T11:01:00.000Z");
    expect(records[5]!.result.windowEnd).toBe("2026-09-14T11:04:00.000Z");
    expect(records[5]!.result.overlapFloor).toBeUndefined();
  });

  test("a caught-up poll keeps the chunk it was given, so the poll after a failure or a late tick still reaches the present", async () => {
    let failing: boolean = true;
    tenant.scripts.search = (): TenantReply | undefined => {
      return failing
        ? googleError(500, "INTERNAL", "Internal error encountered.")
        : undefined;
    };
    const row: ConnectionRow = { cursor: "2026-09-14T11:55:00.000Z" };

    const records: Array<PollRecord> = await runPolls({
      row,
      startMs: NOW.getTime(),
      stepMinutes: 30,
      maxPolls: 3,
      beforePoll: (index: number): void => {
        if (index === 1) {
          failing = false;
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
    let failing: boolean = true;
    tenant.scripts.search = (): TenantReply | undefined => {
      return failing
        ? googleError(500, "INTERNAL", "Internal error encountered.")
        : undefined;
    };
    const row: ConnectionRow = {
      cursor: "2026-09-14T10:00:00.000Z",
      lastPollResult: { type: "poll", nextChunkMinutes: 30 },
    };

    const records: Array<PollRecord> = await runPolls({
      row,
      startMs: NOW.getTime(),
      stepMinutes: 5,
      maxPolls: 3,
      beforePoll: (index: number): void => {
        if (index === 2) {
          failing = false;
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
      expect(record.update["lastError"]).toContain(
        "Google SecOps detections search failed (HTTP 500)",
      );
    }
    expect(records[2]!.result).toMatchObject({
      status: "empty",
      windowEnd: "2026-09-14T10:30:00.000Z",
      chunkMinutes: 30,
      nextChunkMinutes: 60,
    });
    expect(records[2]!.update["cursor"]).toBe("2026-09-14T10:30:00.000Z");
  });

  test("a request that times out halves the next window instead of keeping it", async () => {
    /*
     * The retired poller kept the chunk for every failure. The shared loop
     * halves it after a timeout, because a window too heavy to answer in
     * time would otherwise time out forever (accepted when Google SecOps
     * moved into the framework). The transport rejects with the client's own
     * deadline wording, which its fetch wrapper passes through unchanged.
     */
    tenant.scripts.search = (): Error => {
      return new Error(
        "Google SecOps detections search timed out after 60 seconds with no response.",
      );
    };

    const records: Array<PollRecord> = await runPolls({
      row: {
        cursor: "2026-09-14T10:00:00.000Z",
        lastPollResult: { type: "poll", nextChunkMinutes: 30 },
      },
      startMs: NOW.getTime(),
      stepMinutes: 5,
      maxPolls: 1,
    });

    expect(records[0]!.result).toMatchObject({
      status: "failed",
      chunkMinutes: 30,
      nextChunkMinutes: 15,
    });
    expect(records[0]!.result.warnings).toContain(
      "The source did not answer in time for this window; the next poll reads a 15 minute window from the same starting point.",
    );
    expect(records[0]!.update).not.toHaveProperty("cursor");
    expect(records[0]!.update["lastError"]).toContain(
      "timed out after 60 seconds",
    );
    // The failure is named after the pass that timed out.
    expect(findCheck(records[0]!.result.checks, "failure").name).toBe(
      "Read rule detections by created time",
    );
  });
});
