import {
  decideInvestigationLogStall,
  describeInvestigationLogStall,
  getInvestigationLogSearches,
  getInvestigationLogWindow,
  INVESTIGATION_LOG_TOOL_NAMES,
  INVESTIGATION_LOG_WINDOW_MINUTES_BEFORE,
  InvestigationLogCitation,
  InvestigationLogSearches,
  InvestigationLogStall,
  InvestigationLogStallReason,
  investigationLogStallToJSON,
  isInvestigationLogTool,
  parseInvestigationLogStall,
} from "../../../Utils/AI/InvestigationLogStall";
import { describe, expect, test } from "@jest/globals";

/*
 * An investigation that could not tell the cause for lack of logs says so
 * (the follow-up of #5242 that #5273 listed). Whether the logs stood in its
 * way is the server's to decide, from its verdict, its own log searches and
 * whether any log reached OneUptime - never from what the model wrote.
 */

const NO_SEARCHES: InvestigationLogSearches = {
  searchCount: 0,
  searchesWithLines: 0,
};

describe("the log searches an investigation ran", () => {
  test("are its search_logs and log_histogram calls", () => {
    expect(INVESTIGATION_LOG_TOOL_NAMES).toEqual([
      "search_logs",
      "log_histogram",
    ]);
    expect(isInvestigationLogTool("search_logs")).toBe(true);
    expect(isInvestigationLogTool(" log_histogram ")).toBe(true);
    expect(isInvestigationLogTool("query_traces")).toBe(false);
    expect(isInvestigationLogTool("")).toBe(false);
  });

  test("counts every search, and the ones that found a line", () => {
    const citations: Array<InvestigationLogCitation> = [
      { toolName: "search_logs", rowCount: 0 },
      { toolName: "log_histogram", rowCount: 12 },
      { toolName: "query_traces", rowCount: 40 },
      { toolName: "search_logs", rowCount: 3 },
      { toolName: "query_metrics", rowCount: 0 },
    ];

    expect(getInvestigationLogSearches(citations)).toEqual({
      searchCount: 3,
      searchesWithLines: 2,
    });
  });

  test("a search that returned nothing is a search, and found nothing", () => {
    expect(
      getInvestigationLogSearches([
        { toolName: "search_logs", rowCount: 0 },
        { toolName: "log_histogram", rowCount: 0 },
      ]),
    ).toEqual({ searchCount: 2, searchesWithLines: 0 });
  });

  test("a row count that is no count found nothing", () => {
    expect(
      getInvestigationLogSearches([
        { toolName: "search_logs", rowCount: Number.NaN },
        { toolName: "search_logs", rowCount: -2 },
        {
          toolName: "search_logs",
          rowCount: "4" as unknown as number,
        },
      ]),
    ).toEqual({ searchCount: 3, searchesWithLines: 0 });
  });

  test("no citations, no searches", () => {
    expect(getInvestigationLogSearches([])).toEqual(NO_SEARCHES);
  });
});

describe("whether the logs stood in the way", () => {
  // Every combination of what decides it.
  const cases: Array<{
    isInconclusive: boolean;
    searches: InvestigationLogSearches;
    hasLogs: boolean | null;
    expected: InvestigationLogStallReason | null;
  }> = [];

  for (const isInconclusive of [true, false]) {
    for (const searches of [
      NO_SEARCHES,
      { searchCount: 3, searchesWithLines: 0 },
      { searchCount: 3, searchesWithLines: 1 },
    ]) {
      for (const hasLogs of [true, false, null]) {
        let expected: InvestigationLogStallReason | null = null;

        if (isInconclusive && searches.searchesWithLines === 0) {
          if (hasLogs === false) {
            expected = InvestigationLogStallReason.NoLogs;
          } else if (searches.searchCount > 0) {
            expected = InvestigationLogStallReason.NoMatchingLogs;
          }
        }

        cases.push({ isInconclusive, searches, hasLogs, expected });
      }
    }
  }

  test.each(cases)(
    "inconclusive=$isInconclusive, searches=$searches, hasLogs=$hasLogs: $expected",
    ({ isInconclusive, searches, hasLogs, expected }) => {
      expect(
        decideInvestigationLogStall({ isInconclusive, searches, hasLogs }),
      ).toBe(expected);
    },
  );

  test("eighteen cases, and each reason is reachable", () => {
    expect(cases).toHaveLength(18);
    expect(
      cases.filter((entry: { expected: unknown }) => {
        return entry.expected === InvestigationLogStallReason.NoLogs;
      }),
    ).toHaveLength(2);
    expect(
      cases.filter((entry: { expected: unknown }) => {
        return entry.expected === InvestigationLogStallReason.NoMatchingLogs;
      }),
    ).toHaveLength(2);
  });

  test("an investigation that found the cause never says the logs stood in its way", () => {
    expect(
      decideInvestigationLogStall({
        isInconclusive: false,
        searches: NO_SEARCHES,
        hasLogs: false,
      }),
    ).toBeNull();
  });

  test("a line found anywhere means the logs did not stand in the way", () => {
    expect(
      decideInvestigationLogStall({
        isInconclusive: true,
        searches: { searchCount: 9, searchesWithLines: 1 },
        hasLogs: false,
      }),
    ).toBeNull();
  });

  test("no logs at all is said whether or not it searched them", () => {
    for (const searches of [
      NO_SEARCHES,
      { searchCount: 2, searchesWithLines: 0 },
    ]) {
      expect(
        decideInvestigationLogStall({
          isInconclusive: true,
          searches,
          hasLogs: false,
        }),
      ).toBe(InvestigationLogStallReason.NoLogs);
    }
  });

  test("a project with logs it never searched has nothing to say about them", () => {
    expect(
      decideInvestigationLogStall({
        isInconclusive: true,
        searches: NO_SEARCHES,
        hasLogs: true,
      }),
    ).toBeNull();
  });
});

describe("the window the logs are looked for in", () => {
  const NOW: Date = new Date("2026-10-29T12:00:00.000Z");

  test("from the hour before the record started until now", () => {
    expect(INVESTIGATION_LOG_WINDOW_MINUTES_BEFORE).toBe(60);
    expect(
      getInvestigationLogWindow({
        subjectStartedAt: new Date("2026-10-29T11:30:00.000Z"),
        now: NOW,
      }),
    ).toEqual({
      startTime: new Date("2026-10-29T10:30:00.000Z"),
      endTime: NOW,
    });
  });

  test("a record with no start, a start in the future or no time at all: the last hour", () => {
    for (const subjectStartedAt of [
      undefined,
      null,
      new Date("2026-10-29T13:00:00.000Z"),
      new Date(Number.NaN),
    ]) {
      expect(getInvestigationLogWindow({ subjectStartedAt, now: NOW })).toEqual(
        {
          startTime: new Date("2026-10-29T11:00:00.000Z"),
          endTime: NOW,
        },
      );
    }
  });
});

describe("what a run records, and how it is read back", () => {
  const STALL: InvestigationLogStall = {
    reason: InvestigationLogStallReason.NoMatchingLogs,
    logSearchCount: 4,
    windowStart: "2026-10-29T10:30:00.000Z",
    windowEnd: "2026-10-29T12:00:00.000Z",
  };

  test("round-trips", () => {
    expect(
      parseInvestigationLogStall(investigationLogStallToJSON(STALL)),
    ).toEqual(STALL);

    const noLogs: InvestigationLogStall = {
      ...STALL,
      reason: InvestigationLogStallReason.NoLogs,
      logSearchCount: 0,
    };

    expect(
      parseInvestigationLogStall(investigationLogStallToJSON(noLogs)),
    ).toEqual(noLogs);
  });

  test.each([
    ["nothing", undefined],
    ["null", null],
    ["a string", "NoLogs"],
    ["an array", [STALL]],
    ["an unknown reason", { ...STALL, reason: "NoTraces" }],
    ["no reason", { ...STALL, reason: undefined }],
    ["a count that is a string", { ...STALL, logSearchCount: "4" }],
    ["a negative count", { ...STALL, logSearchCount: -1 }],
    ["a fractional count", { ...STALL, logSearchCount: 1.5 }],
    ["no matching logs after no search", { ...STALL, logSearchCount: 0 }],
    ["no window start", { ...STALL, windowStart: undefined }],
    ["a window end that is no time", { ...STALL, windowEnd: "soon" }],
    ["an empty window start", { ...STALL, windowStart: "  " }],
  ])("%s reads as no stall", (_name: string, value: unknown) => {
    expect(parseInvestigationLogStall(value)).toBeNull();
  });

  test("its English line says what stood in the way", () => {
    expect(
      describeInvestigationLogStall(
        { ...STALL, reason: InvestigationLogStallReason.NoLogs },
        "incident",
      ),
    ).toBe(
      "No logs reached OneUptime from the hour before this incident started, so OneUptime AI had none to read.",
    );
    expect(describeInvestigationLogStall(STALL, "alert")).toBe(
      "OneUptime AI searched the logs 4 times and found nothing about this alert.",
    );
    expect(
      describeInvestigationLogStall(
        { ...STALL, logSearchCount: 1 },
        "incident",
      ),
    ).toBe(
      "OneUptime AI searched the logs once and found nothing about this incident.",
    );
  });
});
