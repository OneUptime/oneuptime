import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  TELEMETRY_AI_LANE_COPY,
  getTelemetryAiLogVerdict,
  getTelemetryAiLogVerdictRunIds,
  getTelemetryAiVerdictWords,
} from "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryAi/TelemetryAiCopy";
import AIInsightType from "../../../Types/AI/AIInsightType";
import {
  TELEMETRY_AI_LANES,
  TELEMETRY_AI_LANE_LIST,
  TelemetryAiLane,
  getTelemetryAiLaneOfInsightType,
} from "../../../Types/AI/TelemetryAi";
import {
  TelemetryAiLogKind,
  TelemetryAiLogState,
  parseTelemetryAiLogs,
} from "../../../Types/AI/TelemetryAiActivity";
import ErrorClass from "../../../Types/Telemetry/ErrorClass";

/*
 * What an investigation found, under it in a lane's AI → Logs (Activity
 * in Logs). The Profiler's and Traces' Logs said nothing: only Exceptions,
 * Logs and Metrics had words, and theirs were the Exceptions lane's - so a
 * failure that writes no log line said it "found a fault in the code".
 * Every lane says it now, each kind of finding in its own words where
 * found in the code means something else, and only the verdicts its
 * triage can reach.
 */

const LINE_LIMIT: number = 150;

// Every kind of finding a lane files.
const LANE_KINDS: Array<[TelemetryAiLane, AIInsightType]> =
  TELEMETRY_AI_LANE_LIST.flatMap(
    (lane: TelemetryAiLane): Array<[TelemetryAiLane, AIInsightType]> => {
      return TELEMETRY_AI_LANES[lane].insightTypes.map(
        (insightType: AIInsightType): [TelemetryAiLane, AIInsightType] => {
          return [lane, insightType];
        },
      );
    },
  );

/*
 * What found in the code is, for each kind: a fault for an error, the
 * change to make for the rest.
 */
const FOUND_IN_THE_CODE: Record<string, string> = {
  [AIInsightType.ProfileHotspot]: "Found avoidable work in the code",
  [AIInsightType.TraceSlowOperation]: "Found avoidable work in the code",
  [AIInsightType.TraceFailingOperation]: "Found a fault in the code",
  [AIInsightType.TraceMissingTracing]: "Found tracing the code should add",
  [AIInsightType.NewException]: "Found a fault in the code",
  [AIInsightType.ExceptionSpike]: "Found a fault in the code",
  [AIInsightType.ExceptionMissingStackTrace]:
    "Found where the code loses the stack trace",
  [AIInsightType.LogErrorPattern]: "Found a fault in the code",
  [AIInsightType.LogMissingLogging]: "Found logging the code should add",
  [AIInsightType.LogNoisyPattern]: "Found a log line the code can turn down",
  [AIInsightType.MetricHighCardinality]:
    "Found where the code records too many values",
  [AIInsightType.MetricHistogramBuckets]:
    "Found buckets the code should change",
  [AIInsightType.MetricMissingMetrics]: "Found metrics the code should add",
};

// The kinds that are errors: an expected error is one of their verdicts.
const ERROR_KINDS: Array<AIInsightType> = [
  AIInsightType.TraceFailingOperation,
  AIInsightType.NewException,
  AIInsightType.ExceptionSpike,
  AIInsightType.LogErrorPattern,
];

function verdictOf(
  lane: TelemetryAiLane,
  insightType: string | undefined,
  verdict: string,
): string | null {
  return getTelemetryAiLogVerdict(lane, {
    kind: TelemetryAiLogKind.Investigation,
    classification: verdict,
    insight: insightType ? { type: insightType } : {},
  });
}

describe("every kind of finding says what its investigation found", () => {
  test("the table names every kind a lane files, and no other", () => {
    expect(
      LANE_KINDS.map(([, insightType]: [TelemetryAiLane, AIInsightType]) => {
        return insightType;
      }).sort(),
    ).toEqual(Object.keys(FOUND_IN_THE_CODE).sort());
  });

  test.each(LANE_KINDS)(
    "%s: a %s found in the code says what it is for that kind",
    (lane: TelemetryAiLane, insightType: AIInsightType) => {
      expect(verdictOf(lane, insightType, ErrorClass.CodeFault)).toBe(
        FOUND_IN_THE_CODE[insightType],
      );
    },
  );

  test.each(LANE_KINDS)(
    "%s: a %s caused outside the code, or not told, reads as every other kind's",
    (lane: TelemetryAiLane, insightType: AIInsightType) => {
      expect(verdictOf(lane, insightType, ErrorClass.Infrastructure)).toBe(
        "Found a cause outside the code",
      );
      expect(verdictOf(lane, insightType, ErrorClass.Unknown)).toBe(
        "Could not tell the cause",
      );
    },
  );

  test.each(LANE_KINDS)(
    "%s: a %s says an expected error only if it is an error",
    (lane: TelemetryAiLane, insightType: AIInsightType) => {
      const isError: boolean = ERROR_KINDS.includes(insightType);

      expect(verdictOf(lane, insightType, ErrorClass.UserError)).toBe(
        isError ? "Found an expected error: invalid input" : null,
      );
      expect(verdictOf(lane, insightType, ErrorClass.ExpectedDenial)).toBe(
        isError ? "Found an expected error: a check doing its job" : null,
      );
    },
  );

  test("each line is short, says what was found, and never promises a pull request", () => {
    for (const [lane, insightType] of LANE_KINDS) {
      for (const words of Object.values(
        getTelemetryAiVerdictWords(lane, insightType),
      )) {
        expect(words!.length).toBeLessThanOrEqual(LINE_LIMIT);
        expect(words).toMatch(/^(Found|Could not tell)/);
        expect(words).not.toContain("pull request");
        expect(words).not.toMatch(/[.!]$/);
      }
    }
  });

  test("an entry with no kind - an older server's - says its lane's words", () => {
    expect(
      verdictOf(TelemetryAiLane.Profile, undefined, ErrorClass.CodeFault),
    ).toBe("Found avoidable work in the code");
    // Traces' and Logs' lane words are an error's: their failing kinds'.
    expect(
      verdictOf(TelemetryAiLane.Trace, undefined, ErrorClass.CodeFault),
    ).toBe("Found a fault in the code");
    expect(
      verdictOf(TelemetryAiLane.Log, undefined, ErrorClass.UserError),
    ).toBe("Found an expected error: invalid input");
    // A kind of another lane reads as no kind of this one.
    expect(
      verdictOf(
        TelemetryAiLane.Profile,
        AIInsightType.LogMissingLogging,
        ErrorClass.CodeFault,
      ),
    ).toBe("Found avoidable work in the code");
  });

  test("a pull request, an investigation with no verdict, and a verdict outside the vocabulary say nothing", () => {
    for (const [lane, insightType] of LANE_KINDS) {
      expect(
        getTelemetryAiLogVerdict(lane, {
          kind: TelemetryAiLogKind.PullRequest,
          classification: ErrorClass.CodeFault,
          insight: { type: insightType },
        }),
      ).toBeNull();
      expect(
        getTelemetryAiLogVerdict(lane, {
          kind: TelemetryAiLogKind.Investigation,
          insight: { type: insightType },
        }),
      ).toBeNull();
      expect(verdictOf(lane, insightType, "Actionable")).toBeNull();
    }
  });

  test("one wording for one meaning: a lane's own words are its kinds' or the shared ones", () => {
    const shared: Set<string> = new Set<string>([
      "Found a fault in the code",
      "Found an expected error: invalid input",
      "Found an expected error: a check doing its job",
      "Found a cause outside the code",
      "Could not tell the cause",
      ...Object.values(FOUND_IN_THE_CODE),
    ]);

    for (const lane of TELEMETRY_AI_LANE_LIST) {
      const copy: {
        investigationVerdicts: Readonly<Partial<Record<ErrorClass, string>>>;
        investigationVerdictsByInsightType?:
          | Readonly<
              Partial<
                Record<
                  AIInsightType,
                  Readonly<Partial<Record<ErrorClass, string>>>
                >
              >
            >
          | undefined;
      } = TELEMETRY_AI_LANE_COPY[lane];

      for (const words of Object.values(copy.investigationVerdicts)) {
        expect(shared.has(words!)).toBe(true);
      }

      // A kind's own words are for a kind of this lane.
      for (const insightType of Object.keys(
        copy.investigationVerdictsByInsightType || {},
      )) {
        expect(getTelemetryAiLaneOfInsightType(insightType)).toBe(lane);
      }
    }
  });
});

describe("the server's triage and the words agree", () => {
  /*
   * Which verdicts an investigation can reach is the server's: each kind's
   * triage framing (InsightTriageRunner) tells the model which apply. The
   * words must say each of them, and say none it rules out - read here
   * from the framings themselves, so a new kind or a changed framing that
   * the words do not follow fails.
   */
  const RUNNER: string = fs.readFileSync(
    path.join(
      __dirname,
      "../../../Server/Utils/AI/SRE/Insights/InsightTriageRunner.ts",
    ),
    "utf8",
  );

  // The map from a kind to its framing, as the runner writes it.
  const FRAMING_MAP: string = RUNNER.slice(
    RUNNER.indexOf("const TRIAGE_FRAMING_BY_TYPE"),
    RUNNER.indexOf("};", RUNNER.indexOf("const TRIAGE_FRAMING_BY_TYPE")),
  );

  // The framing each kind is triaged with, by the map's own entries.
  function getFramingOf(insightType: AIInsightType): string | null {
    const key: string = `[AIInsightType.${insightType}]:`;
    const at: number = FRAMING_MAP.indexOf(key);

    if (at === -1) {
      // Not in the map: the preventive framing, which allows every verdict.
      return null;
    }

    const entryEnd: number = FRAMING_MAP.indexOf(",", at);
    const name: string = FRAMING_MAP.slice(at + key.length, entryEnd).trim();
    const start: number = RUNNER.indexOf(`const ${name}: string = \``);

    expect(start).toBeGreaterThan(-1);

    const end: number = RUNNER.indexOf("`;", start);

    return RUNNER.slice(start, end);
  }

  test.each(LANE_KINDS)(
    "%s: %s is worded for exactly the verdicts its triage may reach",
    (lane: TelemetryAiLane, insightType: AIInsightType) => {
      const framing: string | null = getFramingOf(insightType);
      const rulesOutExpectedErrors: boolean = Boolean(
        framing &&
          framing.includes("user-error and expected-denial do not apply"),
      );
      const words: Readonly<Partial<Record<ErrorClass, string>>> =
        getTelemetryAiVerdictWords(lane, insightType);

      expect(Boolean(words[ErrorClass.UserError])).toBe(
        !rulesOutExpectedErrors,
      );
      expect(Boolean(words[ErrorClass.ExpectedDenial])).toBe(
        !rulesOutExpectedErrors,
      );

      for (const always of [
        ErrorClass.CodeFault,
        ErrorClass.Infrastructure,
        ErrorClass.Unknown,
      ]) {
        expect(words[always]).toBeTruthy();
      }

      // The words' kinds are the framing's: an error kind is triaged as one.
      expect(rulesOutExpectedErrors).toBe(!ERROR_KINDS.includes(insightType));
    },
  );
});

describe("the Logs entry carries its finding's kind", () => {
  test("the kind is read off the wire, and an entry without one still reads", () => {
    const logs: ReturnType<typeof parseTelemetryAiLogs> = parseTelemetryAiLogs({
      totalCount: 2,
      entries: [
        {
          runId: "r1",
          kind: TelemetryAiLogKind.Investigation,
          at: "2026-10-25T10:00:00.000Z",
          state: TelemetryAiLogState.Done,
          classification: ErrorClass.CodeFault,
          insight: {
            id: "i1",
            title: "GET /orders in checkout runs the same query 40 times",
            type: AIInsightType.TraceSlowOperation,
          },
        },
        {
          runId: "r2",
          kind: TelemetryAiLogKind.Investigation,
          at: "2026-10-25T09:00:00.000Z",
          state: TelemetryAiLogState.Done,
          classification: ErrorClass.CodeFault,
          insight: { id: "i2", title: "POST /checkout fails", type: 12 },
        },
      ],
    });

    expect(logs!.entries[0]!.insight.type).toBe(
      AIInsightType.TraceSlowOperation,
    );
    // Not text: no kind, and the lane's words.
    expect(logs!.entries[1]!.insight.type).toBeUndefined();
    expect(
      getTelemetryAiLogVerdict(TelemetryAiLane.Trace, logs!.entries[0]!),
    ).toBe("Found avoidable work in the code");
    expect(
      getTelemetryAiLogVerdict(TelemetryAiLane.Trace, logs!.entries[1]!),
    ).toBe("Found a fault in the code");
  });

  test("a finding's verdict is still said once, on its newest finished investigation, whatever its kind", () => {
    const done: TelemetryAiLogState = TelemetryAiLogState.Done;
    const entries: Array<{
      runId: string;
      kind: TelemetryAiLogKind;
      state: TelemetryAiLogState;
      classification?: string;
      insight: { id: string; type?: string };
    }> = [
      {
        runId: "r1",
        kind: TelemetryAiLogKind.Investigation,
        state: done,
        classification: ErrorClass.UserError,
        insight: { id: "slow", type: AIInsightType.TraceSlowOperation },
      },
      {
        runId: "r2",
        kind: TelemetryAiLogKind.Investigation,
        state: done,
        classification: ErrorClass.CodeFault,
        insight: { id: "slow", type: AIInsightType.TraceSlowOperation },
      },
      {
        runId: "r3",
        kind: TelemetryAiLogKind.Investigation,
        state: done,
        classification: ErrorClass.UserError,
        insight: { id: "failing", type: AIInsightType.TraceFailingOperation },
      },
    ];

    /*
     * The slow operation's newest says nothing a slow operation can say
     * (an expected error), so the next one speaks for it; the failing
     * operation's expected error is said.
     */
    expect(
      Array.from(
        getTelemetryAiLogVerdictRunIds(TelemetryAiLane.Trace, entries),
      ),
    ).toEqual(["r2", "r3"]);
  });
});
