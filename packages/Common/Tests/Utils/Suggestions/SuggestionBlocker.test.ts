import { describe, expect, test } from "@jest/globals";
import {
  CodeTaskBlocker,
  CodeTaskBlockerType,
} from "../../../Types/AI/CodeTask";
import { JSONObject } from "../../../Types/JSON";
import {
  parseSuggestionBlocker,
  SuggestionBlocker,
  suggestionBlockerToJSON,
  toSuggestionBlocker,
} from "../../../Utils/Suggestions/SuggestionBlocker";
import { parseTelemetryAiFixSuggestion } from "../../../Utils/Suggestions/TelemetryAiFixSuggestion";
import { parseTracePerformanceFixSuggestion } from "../../../Utils/Suggestions/TracePerformanceFixSuggestion";
import { PerformanceFindingType } from "../../../Types/AI/CodeFixTaskContext";

/*
 * Code's gate as a suggestion carries it (SuggestionBlocker): one reader for
 * every suggestion with a set-up step - a telemetry finding's Fix with AI,
 * a trace's Fix performance with AI - so no page draws a step the answer
 * does not fully name, and every page reads the same one the same way.
 */

const REPOSITORY_ID: string = "50000000-0000-4000-8000-000000000005";

describe("a blocker from Code's gate", () => {
  test("keeps its type, its sentence and the Runner it names, and says which repository it was asked about", () => {
    const blocker: CodeTaskBlocker = {
      type: CodeTaskBlockerType.RunnerNotOnline,
      message: 'The Runner "build-box" this repository picks is not online.',
      runnerName: "build-box",
    };

    expect(toSuggestionBlocker(blocker, REPOSITORY_ID)).toEqual({
      ...blocker,
      repositoryId: REPOSITORY_ID,
    });
  });

  test("leaves out what it does not have: no Runner name, no repository", () => {
    const blocker: CodeTaskBlocker = {
      type: CodeTaskBlockerType.NoAiCredits,
      message: "This project's AI credits are used up.",
    };

    for (const repositoryId of [undefined, null, ""]) {
      const carried: SuggestionBlocker = toSuggestionBlocker(
        blocker,
        repositoryId,
      );

      expect(carried).toEqual(blocker);
      expect(Object.keys(carried).sort()).toEqual(["message", "type"]);
    }
  });

  test("never carries more than a page may read: the gate's other fields stay behind", () => {
    const carried: SuggestionBlocker = toSuggestionBlocker({
      type: CodeTaskBlockerType.PlanRequired,
      message: "AI in Code needs the Growth plan or above.",
      ...({ installationId: "secret-install" } as Record<string, unknown>),
    } as CodeTaskBlocker);

    expect(carried).toEqual({
      type: CodeTaskBlockerType.PlanRequired,
      message: "AI in Code needs the Growth plan or above.",
    });
  });
});

describe("the wire format", () => {
  test.each(Object.values(CodeTaskBlockerType))(
    "a %s blocker round-trips through JSON",
    (type: CodeTaskBlockerType) => {
      const blocker: SuggestionBlocker = {
        type,
        message: `Why ${type} stops AI.`,
        runnerName: "build-box",
        repositoryId: REPOSITORY_ID,
      };

      expect(
        parseSuggestionBlocker(
          JSON.parse(
            JSON.stringify(suggestionBlockerToJSON(blocker)),
          ) as JSONObject,
        ),
      ).toEqual(blocker);
    },
  );

  test("leaves out an empty Runner name or repository", () => {
    expect(
      suggestionBlockerToJSON({
        type: CodeTaskBlockerType.NoAgent,
        message: "No Runner is online.",
        runnerName: "",
        repositoryId: "",
      }),
    ).toEqual({
      type: CodeTaskBlockerType.NoAgent,
      message: "No Runner is online.",
    });
  });

  test.each([
    ["nothing", undefined],
    ["null", null],
    ["a list", [{ type: CodeTaskBlockerType.NoAgent, message: "No." }]],
    ["a string", "NoAgent"],
    ["no type", { message: "No Runner is online." }],
    ["a type this build does not know", { type: "Eclipse", message: "Dark." }],
    ["a lower-case type", { type: "noagent", message: "No Runner." }],
    ["no sentence", { type: CodeTaskBlockerType.NoAgent }],
    ["an empty sentence", { type: CodeTaskBlockerType.NoAgent, message: "" }],
    ["a blank sentence", { type: CodeTaskBlockerType.NoAgent, message: "  " }],
    [
      "a sentence that is not text",
      { type: CodeTaskBlockerType.NoAgent, message: 42 },
    ],
  ])("%s is no blocker", (_label: string, value: unknown) => {
    expect(parseSuggestionBlocker(value)).toBeNull();
  });

  test("a Runner name or repository that is not text is dropped, the blocker kept", () => {
    expect(
      parseSuggestionBlocker({
        type: CodeTaskBlockerType.RunnerNotOnline,
        message: "The Runner is not online.",
        runnerName: 7,
        repositoryId: { id: REPOSITORY_ID },
      }),
    ).toEqual({
      type: CodeTaskBlockerType.RunnerNotOnline,
      message: "The Runner is not online.",
    });
  });
});

/*
 * Both suggestions with a set-up step read it with this reader, so a
 * blocker reads the same on a telemetry finding and on a trace.
 */
describe("every suggestion reads a blocker the same way", () => {
  const blocker: SuggestionBlocker = {
    type: CodeTaskBlockerType.RunnerNotOnline,
    message: 'The Runner "build-box" this repository picks is not online.',
    runnerName: "build-box",
    repositoryId: REPOSITORY_ID,
  };

  test("a telemetry finding's Fix with AI", () => {
    expect(
      parseTelemetryAiFixSuggestion({ offer: "SetUp", blocker }).blocker,
    ).toEqual(parseSuggestionBlocker(blocker));
  });

  test("a trace's Fix performance with AI", () => {
    expect(
      parseTracePerformanceFixSuggestion({
        offer: "SetUp",
        blocker,
        findingCount: 1,
        finding: {
          findingType: PerformanceFindingType.NPlusOneQuery,
          headline: "N+1",
          evidence: "",
          spanCount: 14,
          combinedDurationMs: 840,
          traceDurationMs: 1600,
          percentOfTrace: 52,
          normalizedSpanName: "SELECT shop.products",
          implicatedSpans: [],
        },
      }).blocker,
    ).toEqual(parseSuggestionBlocker(blocker));
  });
});
