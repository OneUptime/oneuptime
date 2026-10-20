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
 * the card shows only with AI on and a repository for the pull request, a
 * fix already on its way is linked instead of offered again, and nothing
 * else - not even a "connect a repository" link, which on every page of
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
          expect(
            getTelemetryImprovementOffer({
              isAiEnabled,
              hasActiveFix,
              hasConnectedRepository,
            }),
          ).not.toBe(SuggestionOffer.SetUp);
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
