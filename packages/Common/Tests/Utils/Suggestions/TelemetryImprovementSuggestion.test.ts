import { describe, expect, test } from "@jest/globals";
import SuggestionOffer from "../../../Utils/Suggestions/SuggestionOffer";
import {
  NO_TELEMETRY_IMPROVEMENT_SUGGESTION,
  TelemetryImprovementSuggestion,
  getTelemetryImprovementOffer,
  parseTelemetryImprovementSuggestion,
  telemetryImprovementSuggestionToJSON,
} from "../../../Utils/Suggestions/TelemetryImprovementSuggestion";

/*
 * "Improve logging / tracing with AI" on a service's Logs and Traces pages:
 * the card shows only with AI on, a repository for the pull request and
 * nothing Code's gate says stops the run, a fix already on its way is
 * linked instead of offered again, and nothing else - not even a "connect
 * a repository" link, or what Code's gate says, which on every page of
 * every service would be noise.
 */

describe("getTelemetryImprovementOffer", () => {
  test("AI on, a repository, nothing in flight: the card", () => {
    expect(
      getTelemetryImprovementOffer({
        isAiEnabled: true,
        hasActiveFix: false,
        hasConnectedRepository: true,
      }),
    ).toBe(SuggestionOffer.Act);
  });

  test("an improvement already on its way: a link to it", () => {
    expect(
      getTelemetryImprovementOffer({
        isAiEnabled: true,
        hasActiveFix: true,
        hasConnectedRepository: true,
      }),
    ).toBe(SuggestionOffer.InProgress);
  });

  test("no repository: nothing, never a setup link", () => {
    expect(
      getTelemetryImprovementOffer({
        isAiEnabled: true,
        hasActiveFix: false,
        hasConnectedRepository: false,
      }),
    ).toBe(SuggestionOffer.None);
  });

  test("Code's gate says something stops the run (the plan, AI credits, a Runner): nothing, never a set-up step", () => {
    expect(
      getTelemetryImprovementOffer({
        isAiEnabled: true,
        hasActiveFix: false,
        hasConnectedRepository: true,
        isBlocked: true,
      }),
    ).toBe(SuggestionOffer.None);
  });

  test("an improvement on its way is linked whatever Code's gate says now", () => {
    expect(
      getTelemetryImprovementOffer({
        isAiEnabled: true,
        hasActiveFix: true,
        hasConnectedRepository: true,
        isBlocked: true,
      }),
    ).toBe(SuggestionOffer.InProgress);
  });

  test("never says an improvement is done: it stands for good", () => {
    for (const isBlocked of [true, false]) {
      for (const hasActiveFix of [true, false]) {
        expect(
          getTelemetryImprovementOffer({
            isAiEnabled: true,
            hasActiveFix,
            hasConnectedRepository: true,
            isBlocked,
          }),
        ).not.toBe(SuggestionOffer.Done);
      }
    }
  });

  test("AI off: nothing, whatever else is true", () => {
    for (const hasActiveFix of [true, false]) {
      for (const hasConnectedRepository of [true, false]) {
        expect(
          getTelemetryImprovementOffer({
            isAiEnabled: false,
            hasActiveFix,
            hasConnectedRepository,
          }),
        ).toBe(SuggestionOffer.None);
      }
    }
  });

  test("never answers SetUp", () => {
    for (const isAiEnabled of [true, false]) {
      for (const hasActiveFix of [true, false]) {
        for (const hasConnectedRepository of [true, false]) {
          for (const isBlocked of [true, false]) {
            expect(
              getTelemetryImprovementOffer({
                isAiEnabled,
                hasActiveFix,
                hasConnectedRepository,
                isBlocked,
              }),
            ).not.toBe(SuggestionOffer.SetUp);
          }
        }
      }
    }
  });
});

describe("the wire format the card reads", () => {
  test.each([
    { offer: SuggestionOffer.Act, aiRunId: null },
    {
      offer: SuggestionOffer.InProgress,
      aiRunId: "70000000-0000-4000-8000-000000000009",
    },
    { offer: SuggestionOffer.None, aiRunId: null },
  ])("round-trips $offer", (suggestion: TelemetryImprovementSuggestion) => {
    expect(
      parseTelemetryImprovementSuggestion(
        JSON.parse(
          JSON.stringify(telemetryImprovementSuggestionToJSON(suggestion)),
        ),
      ),
    ).toEqual(suggestion);
  });

  test.each([
    ["nothing", undefined],
    ["null", null],
    ["a list", ["Act"]],
    ["an unknown offer", { offer: "Soon" }],
    ["SetUp, which this suggestion never makes", { offer: "SetUp" }],
    [
      "Done, which this suggestion never makes",
      { offer: "Done", aiRunId: "70000000-0000-4000-8000-000000000009" },
    ],
    ["in progress with no run", { offer: "InProgress" }],
    ["in progress with an empty run", { offer: "InProgress", aiRunId: "" }],
  ])("%s reads as nothing", (_label: string, value: unknown) => {
    expect(parseTelemetryImprovementSuggestion(value)).toEqual(
      NO_TELEMETRY_IMPROVEMENT_SUGGESTION,
    );
  });

  test("a run id on an Act offer is dropped", () => {
    expect(
      parseTelemetryImprovementSuggestion({ offer: "Act", aiRunId: "x" }),
    ).toEqual({ offer: SuggestionOffer.Act, aiRunId: null });
  });
});
