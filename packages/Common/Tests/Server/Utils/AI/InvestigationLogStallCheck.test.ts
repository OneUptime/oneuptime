import LogAggregationService from "../../../../Server/Services/LogAggregationService";
import LogDatabaseService from "../../../../Server/Services/LogService";
import { Results } from "../../../../Server/Services/AnalyticsDatabaseService";
import { Statement } from "../../../../Server/Utils/AnalyticsDatabase/Statement";
import { ConfidenceSignal } from "../../../../Server/Utils/AI/SRE/ConfidenceSignal";
import InvestigationLogStallCheck from "../../../../Server/Utils/AI/SRE/InvestigationLogStallCheck";
import logger from "../../../../Server/Utils/Logger";
import { AIChatCitation } from "../../../../Types/AI/AIChatTypes";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import {
  InvestigationLogStall,
  InvestigationLogStallReason,
} from "../../../../Utils/AI/InvestigationLogStall";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * Whether an incident's or alert's investigation could not tell the cause
 * for lack of logs, as the server decides it once the run has its verdict:
 * a positive "could not tell", no log line in any of its searches, and
 * whether any log reached OneUptime from the hour before the record
 * started. And the one read that asks the last: the first row of the
 * project's logs in the window, and nothing more.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "5a110000-0000-4000-8000-0000000000b1",
);
const STARTED_AT: Date = new Date("2026-10-29T11:30:00.000Z");
const NOW: Date = new Date("2026-10-29T12:00:00.000Z");
const WHITESPACE: RegExp = /\s+/g;

const INCONCLUSIVE: ConfidenceSignal = {
  confident: false,
  source: "classification",
  codeFixRecommended: false,
};
const NO_EVIDENCE: ConfidenceSignal = {
  confident: false,
  source: "deterministic-floor",
  codeFixRecommended: false,
};
const FOUND_THE_CAUSE: ConfidenceSignal = {
  confident: true,
  source: "classification",
  codeFixRecommended: true,
};
const CLASSIFICATION_FAILED: ConfidenceSignal = {
  confident: false,
  source: "classification-failed",
  codeFixRecommended: false,
};

let citationNumber: number = 0;

function citation(toolName: string, rowCount: number): AIChatCitation {
  citationNumber++;

  return {
    id: `C${citationNumber}`,
    toolName,
    label: toolName,
    queryArguments: {},
    rowCount,
  };
}

describe("InvestigationLogStallCheck.check", () => {
  let hasLogs: SpyInstance<typeof LogAggregationService.hasLogsInWindow>;

  beforeEach(() => {
    hasLogs = jest
      .spyOn(LogAggregationService, "hasLogsInWindow")
      .mockResolvedValue(true);
    jest.spyOn(logger, "warn").mockImplementation((): void => {});
    jest.spyOn(logger, "error").mockImplementation((): void => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function check(
    confidence: ConfidenceSignal,
    citations: Array<AIChatCitation>,
  ): Promise<InvestigationLogStall | null> {
    return InvestigationLogStallCheck.check({
      projectId: PROJECT_ID,
      confidence,
      citations,
      subjectStartedAt: STARTED_AT,
      now: NOW,
    });
  }

  test("no log reached OneUptime: NoLogs, with the window it checked", async () => {
    hasLogs.mockResolvedValue(false);

    expect(await check(NO_EVIDENCE, [])).toEqual({
      reason: InvestigationLogStallReason.NoLogs,
      logSearchCount: 0,
      windowStart: "2026-10-29T10:30:00.000Z",
      windowEnd: "2026-10-29T12:00:00.000Z",
    });
    expect(hasLogs).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      startTime: new Date("2026-10-29T10:30:00.000Z"),
      endTime: NOW,
    });
  });

  test("logs reached OneUptime, and its searches found none about it: NoMatchingLogs", async () => {
    expect(
      await check(INCONCLUSIVE, [
        citation("search_logs", 0),
        citation("query_traces", 30),
        citation("log_histogram", 0),
      ]),
    ).toEqual({
      reason: InvestigationLogStallReason.NoMatchingLogs,
      logSearchCount: 2,
      windowStart: "2026-10-29T10:30:00.000Z",
      windowEnd: "2026-10-29T12:00:00.000Z",
    });
  });

  test("an investigation that found the cause says nothing, and reads nothing", async () => {
    hasLogs.mockResolvedValue(false);

    expect(await check(FOUND_THE_CAUSE, [])).toBeNull();
    expect(hasLogs).not.toHaveBeenCalled();
  });

  test("a failed classification is no verdict: nothing is said", async () => {
    hasLogs.mockResolvedValue(false);

    expect(await check(CLASSIFICATION_FAILED, [])).toBeNull();
    expect(hasLogs).not.toHaveBeenCalled();
  });

  test("a search that found a line: the logs did not stand in the way, and nothing is read", async () => {
    hasLogs.mockResolvedValue(false);

    expect(
      await check(INCONCLUSIVE, [
        citation("search_logs", 0),
        citation("search_logs", 12),
      ]),
    ).toBeNull();
    expect(hasLogs).not.toHaveBeenCalled();
  });

  test("a project with logs it never searched: nothing to say", async () => {
    expect(await check(INCONCLUSIVE, [citation("query_metrics", 0)])).toBeNull();
  });

  test("the logs could not be read: its own empty searches still speak", async () => {
    hasLogs.mockRejectedValue(new Error("ClickHouse is restarting"));

    expect(
      (await check(INCONCLUSIVE, [citation("search_logs", 0)]))?.reason,
    ).toBe(InvestigationLogStallReason.NoMatchingLogs);
    expect(await check(INCONCLUSIVE, [])).toBeNull();
  });

  test("never throws: a check that fails says nothing", async () => {
    expect(
      await InvestigationLogStallCheck.check({
        projectId: PROJECT_ID,
        confidence: INCONCLUSIVE,
        citations: null as unknown as Array<AIChatCitation>,
        subjectStartedAt: STARTED_AT,
        now: NOW,
      }),
    ).toBeNull();
  });

  test("a record with no start looks at the last hour", async () => {
    hasLogs.mockResolvedValue(false);

    const stall: InvestigationLogStall | null =
      await InvestigationLogStallCheck.check({
        projectId: PROJECT_ID,
        confidence: NO_EVIDENCE,
        citations: [],
        subjectStartedAt: undefined,
        now: NOW,
      });

    expect(stall?.windowStart).toBe("2026-10-29T11:00:00.000Z");
  });
});

describe("LogAggregationService.hasLogsInWindow: the first row, and nothing more", () => {
  function stubAndCapture(rows: Array<JSONObject>): Array<Statement> {
    const captured: Array<Statement> = [];
    const fakeResult: Results = {
      json: () => {
        return Promise.resolve({ data: rows });
      },
    } as unknown as Results;

    jest
      .spyOn(LogDatabaseService, "executeQuery")
      .mockImplementation((statement: Statement | string): Promise<Results> => {
        captured.push(statement as Statement);
        return Promise.resolve(fakeResult);
      });

    return captured;
  }

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("a row is logs; none is none", async () => {
    stubAndCapture([{ found: 1 }]);

    expect(
      await LogAggregationService.hasLogsInWindow({
        projectId: PROJECT_ID,
        startTime: new Date("2026-10-29T10:30:00.000Z"),
        endTime: NOW,
      }),
    ).toBe(true);

    jest.restoreAllMocks();
    stubAndCapture([]);

    expect(
      await LogAggregationService.hasLogsInWindow({
        projectId: PROJECT_ID,
        startTime: new Date("2026-10-29T10:30:00.000Z"),
        endTime: NOW,
      }),
    ).toBe(false);
  });

  test("reads one half-open window of the project, past retention left out, one row at most, bounded", async () => {
    const captured: Array<Statement> = stubAndCapture([]);

    await LogAggregationService.hasLogsInWindow({
      projectId: PROJECT_ID,
      startTime: new Date("2026-10-29T10:30:00.000Z"),
      endTime: NOW,
    });

    expect(captured).toHaveLength(1);

    const query: string = captured[0]!.query.replace(WHITESPACE, " ");
    const params: Array<unknown> = Object.values(captured[0]!.query_params);

    expect(query).toContain("SELECT 1 AS found FROM");
    expect(query).toMatch(/WHERE projectId = \{p\d+:\w+\} AND time >= /u);
    expect(query).toMatch(/AND time < \{p\d+:\w+\}/u);
    expect(query).toContain("retentionDate >= now()");
    expect(query).toContain("LIMIT 1");
    expect(query).toContain("max_execution_time = 45");
    expect(query).toContain("timeout_overflow_mode = 'throw'");
    expect(query).not.toContain("GROUP BY");
    expect(params).toContain(PROJECT_ID.toString());
    // Nothing a caller supplies reaches the SQL text.
    expect(query).not.toContain(PROJECT_ID.toString());
  });
});
