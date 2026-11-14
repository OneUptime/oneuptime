import RecordedToolAnswers, {
  APPROXIMATE_TIME_TOLERANCE_MS,
  NOT_RECORDED_ERROR_MESSAGE,
  RecordedAnswerMatch,
  RecordedToolAnswerCounts,
} from "../../../../../Server/Utils/AI/Eval/RecordedToolAnswers";
import { ToolCallOutcome } from "../../../../../Server/Utils/AI/Toolbox/Index";
import { AIChatCitationTargetType } from "../../../../../Types/AI/AIChatTypes";
import { InvestigationRecordedToolCall } from "../../../../../Types/AI/InvestigationRecording";
import { JSONObject } from "../../../../../Types/JSON";
import { describe, expect, test } from "@jest/globals";

/*
 * HOW A REPLAY'S TOOL CALLS ARE ANSWERED (issue #6800): from what the
 * original run was handed back, never from the project's live data.
 *
 *  1. The same tool with the same arguments, in any key order: the recorded
 *     answers in the order the original run got them, then the last again.
 *  2. The same tool and arguments with ISO timestamps each within 15 minutes
 *     of a recorded call's: the nearest one, counted apart.
 *  3. Anything else - or a result too long to have been kept - is told no
 *     data is available, in a tool error's words, and counted as not
 *     recorded.
 *
 * The counts are what a replay's report shows beside its grade: many calls
 * not recorded mean the replay went where the recording cannot follow.
 */

const MINUTE_MS: number = 60 * 1000;
const T0: number = Date.parse("2026-11-10T07:30:00.000Z");

function at(offsetMs: number): string {
  return new Date(T0 + offsetMs).toISOString();
}

function recorded(
  toolName: string,
  toolArguments: JSONObject,
  text: string | null,
  extras: Partial<InvestigationRecordedToolCall> = {},
): InvestigationRecordedToolCall {
  return {
    toolName,
    arguments: toolArguments,
    success: true,
    text,
    ...extras,
  };
}

function logWindow(startOffsetMs: number, extra: JSONObject = {}): JSONObject {
  return {
    service: "checkout",
    startTime: at(startOffsetMs),
    endTime: at(startOffsetMs + 60 * MINUTE_MS),
    ...extra,
  };
}

function textOf(outcome: ToolCallOutcome): string {
  return outcome.textForLlm;
}

function counts(answers: RecordedToolAnswers): RecordedToolAnswerCounts {
  return answers.getCounts();
}

describe("the tolerance", () => {
  test("a timestamp may move by up to 15 minutes", () => {
    expect(APPROXIMATE_TIME_TOLERANCE_MS).toBe(15 * 60 * 1000);
  });
});

describe("RecordedToolAnswers: the same call the original made", () => {
  test("is answered with what the original was handed back, with its citation, rows and truncation", () => {
    const answers: RecordedToolAnswers = new RecordedToolAnswers([
      recorded(
        "search_logs",
        { query: "checkout" },
        "12 errors: connection refused",
        {
          rowCount: 12,
          citationLabel: "Error logs of checkout",
          citationTarget: {
            type: AIChatCitationTargetType.Logs,
            params: { service: "checkout" },
          },
          isTruncated: true,
        },
      ),
    ]);

    const answered: { outcome: ToolCallOutcome; match: RecordedAnswerMatch } =
      answers.answerWithMatch("search_logs", { query: "checkout" });

    expect(answered.match).toBe(RecordedAnswerMatch.Exact);
    expect(answered.outcome).toStrictEqual({
      success: true,
      textForLlm: "12 errors: connection refused",
      result: {
        dataForLlm: "12 errors: connection refused",
        rowCount: 12,
        citationLabel: "Error logs of checkout",
        citationTarget: {
          type: AIChatCitationTargetType.Logs,
          params: { service: "checkout" },
        },
        redactionCount: 0,
        isTruncated: true,
      },
    });
    expect(counts(answers)).toEqual({
      exact: 1,
      nearbyTime: 0,
      notRecorded: 0,
    });
  });

  test("a call recorded without its facts is answered with plain ones: the tool's name, no rows, not cut short", () => {
    const answers: RecordedToolAnswers = new RecordedToolAnswers([
      recorded("search_logs", { query: "checkout" }, "no rows"),
    ]);

    expect(answers.answer("search_logs", { query: "checkout" })).toStrictEqual({
      success: true,
      textForLlm: "no rows",
      result: {
        dataForLlm: "no rows",
        rowCount: 0,
        citationLabel: "search_logs",
        redactionCount: 0,
        isTruncated: false,
      },
    });
  });

  test("a call that failed for the original fails the same way, with the error it read", () => {
    const answers: RecordedToolAnswers = new RecordedToolAnswers([
      {
        toolName: "query_metrics",
        arguments: { metricName: "http.server.duration" },
        success: false,
        text: "Error: no metric named http.server.duration in this project.",
      },
    ]);

    const answered: { outcome: ToolCallOutcome; match: RecordedAnswerMatch } =
      answers.answerWithMatch("query_metrics", {
        metricName: "http.server.duration",
      });

    expect(answered.match).toBe(RecordedAnswerMatch.Exact);
    expect(answered.outcome).toStrictEqual({
      success: false,
      textForLlm:
        "Error: no metric named http.server.duration in this project.",
      errorMessage:
        "Error: no metric named http.server.duration in this project.",
    });
    expect(answered.outcome.result).toBeUndefined();
    expect(counts(answers)).toEqual({
      exact: 1,
      nearbyTime: 0,
      notRecorded: 0,
    });
  });

  test("made again, it gets the recorded answers in the order the original got them, then the last one again", () => {
    const answers: RecordedToolAnswers = new RecordedToolAnswers([
      recorded("search_logs", { query: "checkout" }, "first"),
      recorded("search_logs", { query: "payments" }, "other"),
      recorded("search_logs", { query: "checkout" }, "second"),
      recorded("search_logs", { query: "checkout" }, "third"),
    ]);

    const answered: Array<string> = [1, 2, 3, 4, 5].map((): string => {
      return textOf(answers.answer("search_logs", { query: "checkout" }));
    });

    expect(answered).toEqual(["first", "second", "third", "third", "third"]);
    // Another call's own queue is untouched.
    expect(textOf(answers.answer("search_logs", { query: "payments" }))).toBe(
      "other",
    );
    expect(counts(answers)).toEqual({
      exact: 6,
      nearbyTime: 0,
      notRecorded: 0,
    });
  });

  test("the keys may come in any order, at any depth", () => {
    const answers: RecordedToolAnswers = new RecordedToolAnswers([
      recorded(
        "query_traces",
        {
          service: "checkout",
          filter: { statusCode: "Error", minDurationMs: 500 },
          limit: 20,
        },
        "3 slow traces",
      ),
    ]);

    const answered: { outcome: ToolCallOutcome; match: RecordedAnswerMatch } =
      answers.answerWithMatch("query_traces", {
        limit: 20,
        filter: { minDurationMs: 500, statusCode: "Error" },
        service: "checkout",
      });

    expect(answered.match).toBe(RecordedAnswerMatch.Exact);
    expect(textOf(answered.outcome)).toBe("3 slow traces");
  });

  test("a key left undefined is a key left out, as JSON has it", () => {
    const answers: RecordedToolAnswers = new RecordedToolAnswers([
      recorded("search_logs", { query: "checkout" }, "12 rows"),
    ]);

    expect(
      answers.answerWithMatch("search_logs", {
        query: "checkout",
        severity: undefined,
      } as unknown as JSONObject).match,
    ).toBe(RecordedAnswerMatch.Exact);
  });

  test("the order of a list is part of the call", () => {
    const answers: RecordedToolAnswers = new RecordedToolAnswers([
      recorded(
        "query_metrics",
        { metricNames: ["cpu", "memory"] },
        "two series",
      ),
    ]);

    expect(
      answers.answerWithMatch("query_metrics", {
        metricNames: ["memory", "cpu"],
      }).match,
    ).toBe(RecordedAnswerMatch.NotRecorded);
  });

  test("a call recorded with no arguments is the call made with none", () => {
    const answers: RecordedToolAnswers = new RecordedToolAnswers([
      {
        toolName: "get_setup_health",
        arguments: undefined as unknown as JSONObject,
        success: true,
        text: "healthy",
      },
    ]);

    expect(textOf(answers.answer("get_setup_health", {}))).toBe("healthy");
    expect(
      textOf(answers.answer("get_setup_health", null as unknown as JSONObject)),
    ).toBe("healthy");
  });

  test("the same arguments to another tool are another call", () => {
    const answers: RecordedToolAnswers = new RecordedToolAnswers([
      recorded("search_logs", logWindow(0), "12 rows"),
    ]);

    expect(answers.answerWithMatch("query_traces", logWindow(0)).match).toBe(
      RecordedAnswerMatch.NotRecorded,
    );
  });
});

describe("RecordedToolAnswers: the same call a few minutes off", () => {
  test("is answered by the recorded call, counted apart", () => {
    const answers: RecordedToolAnswers = new RecordedToolAnswers([
      recorded("search_logs", logWindow(0), "12 errors: connection refused", {
        rowCount: 12,
      }),
    ]);

    const answered: { outcome: ToolCallOutcome; match: RecordedAnswerMatch } =
      answers.answerWithMatch("search_logs", logWindow(5 * MINUTE_MS));

    expect(answered.match).toBe(RecordedAnswerMatch.NearbyTime);
    expect(textOf(answered.outcome)).toBe("12 errors: connection refused");
    expect(answered.outcome.result?.rowCount).toBe(12);
    expect(counts(answers)).toEqual({
      exact: 0,
      nearbyTime: 1,
      notRecorded: 0,
    });
  });

  test("of several recorded calls, the nearest answers", () => {
    const answers: RecordedToolAnswers = new RecordedToolAnswers([
      recorded("search_logs", logWindow(0), "at 07:30"),
      recorded("search_logs", logWindow(10 * MINUTE_MS), "at 07:40"),
      recorded("search_logs", logWindow(20 * MINUTE_MS), "at 07:50"),
    ]);

    expect(
      textOf(answers.answer("search_logs", logWindow(12 * MINUTE_MS))),
    ).toBe("at 07:40");
    expect(
      textOf(answers.answer("search_logs", logWindow(17 * MINUTE_MS))),
    ).toBe("at 07:50");
    expect(
      textOf(answers.answer("search_logs", logWindow(-4 * MINUTE_MS))),
    ).toBe("at 07:30");
    expect(counts(answers)).toEqual({
      exact: 0,
      nearbyTime: 3,
      notRecorded: 0,
    });
  });

  test("nearest by every timestamp of the call together", () => {
    const answers: RecordedToolAnswers = new RecordedToolAnswers([
      // Start 2 minutes off, end 13 minutes off: 15 minutes in all.
      recorded(
        "search_logs",
        {
          service: "checkout",
          startTime: at(2 * MINUTE_MS),
          endTime: at(73 * MINUTE_MS),
        },
        "far end",
      ),
      // Start 6 minutes off, end 6 minutes off: 12 minutes in all.
      recorded(
        "search_logs",
        {
          service: "checkout",
          startTime: at(6 * MINUTE_MS),
          endTime: at(66 * MINUTE_MS),
        },
        "nearer in all",
      ),
    ]);

    expect(textOf(answers.answer("search_logs", logWindow(0)))).toBe(
      "nearer in all",
    );
  });

  test("15 minutes off is still near; a millisecond more is not recorded", () => {
    const answers: RecordedToolAnswers = new RecordedToolAnswers([
      recorded(
        "search_logs",
        { service: "checkout", startTime: at(0) },
        "12 rows",
      ),
    ]);

    expect(
      answers.answerWithMatch("search_logs", {
        service: "checkout",
        startTime: at(APPROXIMATE_TIME_TOLERANCE_MS),
      }).match,
    ).toBe(RecordedAnswerMatch.NearbyTime);
    expect(
      answers.answerWithMatch("search_logs", {
        service: "checkout",
        startTime: at(-APPROXIMATE_TIME_TOLERANCE_MS),
      }).match,
    ).toBe(RecordedAnswerMatch.NearbyTime);
    expect(
      answers.answerWithMatch("search_logs", {
        service: "checkout",
        startTime: at(APPROXIMATE_TIME_TOLERANCE_MS + 1),
      }).match,
    ).toBe(RecordedAnswerMatch.NotRecorded);
    expect(counts(answers)).toEqual({
      exact: 0,
      nearbyTime: 2,
      notRecorded: 1,
    });
  });

  test("an hour off is another question: not recorded", () => {
    const answers: RecordedToolAnswers = new RecordedToolAnswers([
      recorded("search_logs", logWindow(0), "12 rows"),
    ]);

    expect(
      answers.answerWithMatch("search_logs", logWindow(60 * MINUTE_MS)).match,
    ).toBe(RecordedAnswerMatch.NotRecorded);
  });

  test("every timestamp must be near: one near and one far is not recorded", () => {
    const answers: RecordedToolAnswers = new RecordedToolAnswers([
      recorded("search_logs", logWindow(0), "12 rows"),
    ]);

    expect(
      answers.answerWithMatch("search_logs", {
        service: "checkout",
        startTime: at(MINUTE_MS),
        endTime: at(120 * MINUTE_MS),
      }).match,
    ).toBe(RecordedAnswerMatch.NotRecorded);
  });

  test("anything but a timestamp that differs is never matched approximately", () => {
    const answers: RecordedToolAnswers = new RecordedToolAnswers([
      recorded("search_logs", logWindow(0), "checkout's logs"),
    ]);

    for (const changed of [
      logWindow(MINUTE_MS, { service: "payments" }),
      logWindow(MINUTE_MS, { severity: "Error" }),
      logWindow(0, { limit: 50 }),
    ]) {
      expect({
        changed,
        match: answers.answerWithMatch("search_logs", changed).match,
      }).toEqual({ changed, match: RecordedAnswerMatch.NotRecorded });
    }
  });

  test("a call with fewer timestamps than the recorded one is not recorded", () => {
    const answers: RecordedToolAnswers = new RecordedToolAnswers([
      recorded("search_logs", logWindow(0), "12 rows"),
    ]);

    expect(
      answers.answerWithMatch("search_logs", {
        service: "checkout",
        startTime: at(MINUTE_MS),
        endTime: "now",
      }).match,
    ).toBe(RecordedAnswerMatch.NotRecorded);
  });

  test("timestamps are matched by where they sit in the arguments", () => {
    const answers: RecordedToolAnswers = new RecordedToolAnswers([
      recorded(
        "query_metrics",
        {
          metricName: "cpu",
          windows: [{ from: at(0) }, { from: at(60 * MINUTE_MS) }],
        },
        "two windows",
      ),
      recorded("search_logs", { service: "checkout", from: at(0) }, "from"),
    ]);

    expect(
      answers.answerWithMatch("query_metrics", {
        metricName: "cpu",
        windows: [{ from: at(3 * MINUTE_MS) }, { from: at(62 * MINUTE_MS) }],
      }).match,
    ).toBe(RecordedAnswerMatch.NearbyTime);

    // The same times, swapped between the two windows: too far apart, each.
    expect(
      answers.answerWithMatch("query_metrics", {
        metricName: "cpu",
        windows: [{ from: at(60 * MINUTE_MS) }, { from: at(0) }],
      }).match,
    ).toBe(RecordedAnswerMatch.NotRecorded);

    // The same time under another name is another argument.
    expect(
      answers.answerWithMatch("search_logs", { service: "checkout", to: at(0) })
        .match,
    ).toBe(RecordedAnswerMatch.NotRecorded);
  });

  test("a date with no time, or text that only looks like a time, is compared as it is written", () => {
    const answers: RecordedToolAnswers = new RecordedToolAnswers([
      recorded("query_slos", { day: "2026-11-10" }, "SLOs on the 10th"),
      recorded(
        "search_logs",
        { service: "checkout", startTime: "2026-13-45T99:99" },
        "not a time",
      ),
    ]);

    expect(
      answers.answerWithMatch("query_slos", { day: "2026-11-11" }).match,
    ).toBe(RecordedAnswerMatch.NotRecorded);
    expect(
      answers.answerWithMatch("search_logs", {
        service: "checkout",
        startTime: "2026-13-45T99:98",
      }).match,
    ).toBe(RecordedAnswerMatch.NotRecorded);
    expect(
      answers.answerWithMatch("search_logs", {
        service: "checkout",
        startTime: "2026-13-45T99:99",
      }).match,
    ).toBe(RecordedAnswerMatch.Exact);
  });

  test("a call with no timestamps that differs at all is not recorded", () => {
    const answers: RecordedToolAnswers = new RecordedToolAnswers([
      recorded("query_traces", { service: "checkout", limit: 20 }, "20 traces"),
    ]);

    expect(
      answers.answerWithMatch("query_traces", {
        service: "checkout",
        limit: 21,
      }).match,
    ).toBe(RecordedAnswerMatch.NotRecorded);
  });

  test("timestamps in another zone are the same instant", () => {
    const answers: RecordedToolAnswers = new RecordedToolAnswers([
      recorded(
        "search_logs",
        { service: "checkout", startTime: at(0) },
        "12 rows",
      ),
    ]);

    // 07:30 UTC written as 09:32 in UTC+2: two minutes off.
    expect(
      answers.answerWithMatch("search_logs", {
        service: "checkout",
        startTime: "2026-11-10T09:32:00+02:00",
      }).match,
    ).toBe(RecordedAnswerMatch.NearbyTime);
  });

  test("a failure recorded nearby replays as that failure", () => {
    const answers: RecordedToolAnswers = new RecordedToolAnswers([
      {
        toolName: "search_logs",
        arguments: logWindow(0),
        success: false,
        text: "Error: the query timed out.",
      },
    ]);

    const outcome: ToolCallOutcome = answers.answer(
      "search_logs",
      logWindow(2 * MINUTE_MS),
    );

    expect(outcome).toStrictEqual({
      success: false,
      textForLlm: "Error: the query timed out.",
      errorMessage: "Error: the query timed out.",
    });
  });
});

describe("RecordedToolAnswers: a call the recording cannot answer", () => {
  test("is told no data is available, in a tool error's words, and never that it is a replay", () => {
    const answers: RecordedToolAnswers = new RecordedToolAnswers([
      recorded("search_logs", { query: "checkout" }, "12 rows"),
    ]);

    const answered: { outcome: ToolCallOutcome; match: RecordedAnswerMatch } =
      answers.answerWithMatch("query_traces", { service: "checkout" });

    expect(answered.match).toBe(RecordedAnswerMatch.NotRecorded);
    expect(answered.outcome).toStrictEqual({
      success: false,
      textForLlm:
        "Error: no data is available for query_traces with these arguments in this run. Answer with the data you already have, or try a different call.",
      errorMessage: NOT_RECORDED_ERROR_MESSAGE,
    });
    expect(answered.outcome.textForLlm.toLowerCase()).not.toMatch(
      /replay|record/,
    );
    expect(counts(answers)).toEqual({
      exact: 0,
      nearbyTime: 0,
      notRecorded: 1,
    });
  });

  test("a recorded result too long to have been kept is not recorded, and its slot is still used up", () => {
    const answers: RecordedToolAnswers = new RecordedToolAnswers([
      recorded("search_logs", { query: "checkout" }, null),
      recorded("search_logs", { query: "checkout" }, "the second answer"),
    ]);

    const first: { outcome: ToolCallOutcome; match: RecordedAnswerMatch } =
      answers.answerWithMatch("search_logs", { query: "checkout" });
    const second: { outcome: ToolCallOutcome; match: RecordedAnswerMatch } =
      answers.answerWithMatch("search_logs", { query: "checkout" });

    expect(first.match).toBe(RecordedAnswerMatch.NotRecorded);
    expect(first.outcome.errorMessage).toBe(NOT_RECORDED_ERROR_MESSAGE);
    expect(second.match).toBe(RecordedAnswerMatch.Exact);
    expect(textOf(second.outcome)).toBe("the second answer");
    expect(counts(answers)).toEqual({
      exact: 1,
      nearbyTime: 0,
      notRecorded: 1,
    });
  });

  test("a recorded call kept without its text never answers a nearby call", () => {
    const answers: RecordedToolAnswers = new RecordedToolAnswers([
      recorded("search_logs", logWindow(0), null),
    ]);

    expect(
      answers.answerWithMatch("search_logs", logWindow(MINUTE_MS)).match,
    ).toBe(RecordedAnswerMatch.NotRecorded);
  });

  test("the very call whose result was too long to keep is not recorded, even with a kept call a few minutes off", () => {
    /*
     * The original made this call and read something we no longer have;
     * a sibling call's window, a minute away, is not what it read.
     */
    const answers: RecordedToolAnswers = new RecordedToolAnswers([
      recorded("search_logs", logWindow(0), null),
      recorded("search_logs", logWindow(MINUTE_MS), "the minute after"),
    ]);

    const replayed: { outcome: ToolCallOutcome; match: RecordedAnswerMatch } =
      answers.answerWithMatch("search_logs", logWindow(0));

    expect(replayed.match).toBe(RecordedAnswerMatch.NotRecorded);
    expect(replayed.outcome.success).toBe(false);
    expect(replayed.outcome.errorMessage).toBe(NOT_RECORDED_ERROR_MESSAGE);
    expect(textOf(replayed.outcome)).not.toContain("the minute after");

    // The sibling still answers its own call, and a call near it.
    expect(
      answers.answerWithMatch("search_logs", logWindow(MINUTE_MS)).match,
    ).toBe(RecordedAnswerMatch.Exact);
    expect(
      answers.answerWithMatch("search_logs", logWindow(2 * MINUTE_MS)).match,
    ).toBe(RecordedAnswerMatch.NearbyTime);
    expect(counts(answers)).toEqual({
      exact: 1,
      nearbyTime: 1,
      notRecorded: 1,
    });
  });

  test("a recording with nothing in it answers every call as not recorded", () => {
    const answers: RecordedToolAnswers = new RecordedToolAnswers([]);

    answers.answer("search_logs", logWindow(0));
    answers.answer("query_metrics", {});

    expect(counts(answers)).toEqual({
      exact: 0,
      nearbyTime: 0,
      notRecorded: 2,
    });
  });

  test("entries that are not tool calls are passed over, never thrown on", () => {
    const answers: RecordedToolAnswers = new RecordedToolAnswers([
      null as unknown as InvestigationRecordedToolCall,
      {
        arguments: {},
        success: true,
        text: "x",
      } as unknown as InvestigationRecordedToolCall,
      recorded("search_logs", { query: "checkout" }, "12 rows"),
    ]);

    expect(textOf(answers.answer("search_logs", { query: "checkout" }))).toBe(
      "12 rows",
    );
  });
});

describe("RecordedToolAnswers: the counts", () => {
  test("count each kind of answer, and answer() counts as answerWithMatch() does", () => {
    const answers: RecordedToolAnswers = new RecordedToolAnswers([
      recorded("search_logs", logWindow(0), "12 rows"),
      recorded("query_traces", { service: "checkout" }, "3 traces"),
    ]);

    answers.answer("search_logs", logWindow(0));
    answers.answer("query_traces", { service: "checkout" });
    answers.answer("search_logs", logWindow(3 * MINUTE_MS));
    answers.answer("search_logs", logWindow(90 * MINUTE_MS));
    answers.answerWithMatch("get_trace", { traceId: "abc" });

    expect(counts(answers)).toEqual({
      exact: 2,
      nearbyTime: 1,
      notRecorded: 2,
    });
  });

  test("are a copy: changing one read does not change the next", () => {
    const answers: RecordedToolAnswers = new RecordedToolAnswers([]);
    const read: RecordedToolAnswerCounts = answers.getCounts();

    read.notRecorded = 99;

    expect(answers.getCounts()).toEqual({
      exact: 0,
      nearbyTime: 0,
      notRecorded: 0,
    });
  });
});

describe("RecordedToolAnswers.canonicalJson and getExactKey", () => {
  test("write the same arguments the same way, whatever their key order", () => {
    expect(
      RecordedToolAnswers.canonicalJson({
        b: 1,
        a: { d: [2, { f: 1, e: 0 }], c: 3 },
      }),
    ).toBe('{"a":{"c":3,"d":[2,{"e":0,"f":1}]},"b":1}');
    expect(RecordedToolAnswers.canonicalJson(undefined)).toBe("null");
    expect(RecordedToolAnswers.getExactKey("search_logs", { b: 1, a: 2 })).toBe(
      RecordedToolAnswers.getExactKey("search_logs", { a: 2, b: 1 }),
    );
    expect(RecordedToolAnswers.getExactKey("search_logs", { a: 2 })).not.toBe(
      RecordedToolAnswers.getExactKey("query_traces", { a: 2 }),
    );
  });
});
