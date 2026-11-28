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

const CHECKOUT: { id: string; name: string } = {
  id: "11209000-0000-4000-8000-0000000000a2",
  name: "checkout",
};
const LEDGER: { id: string; name: string } = {
  id: "11209000-0000-4000-8000-0000000000a3",
  name: "ledger",
};

describe("the wire format the card reads", () => {
  test.each([
    { offer: SuggestionOffer.Act, aiRunId: null, repositories: [] },
    {
      offer: SuggestionOffer.Act,
      aiRunId: null,
      repositories: [CHECKOUT, LEDGER],
    },
    {
      offer: SuggestionOffer.InProgress,
      aiRunId: "70000000-0000-4000-8000-000000000009",
      repositories: [],
    },
    { offer: SuggestionOffer.None, aiRunId: null, repositories: [] },
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
    ).toEqual({ offer: SuggestionOffer.Act, aiRunId: null, repositories: [] });
  });
});

/*
 * THE REPOSITORIES TO PICK FROM (#11209): the card asks which repository
 * holds the service's code when several are the person's and none is named
 * like the service. Only the offer of the card carries them, whole, each
 * once - and one repository is no choice.
 */
describe("the repositories the card offers to pick from", () => {
  test("an Act offer carries them, in the server's order", () => {
    expect(
      parseTelemetryImprovementSuggestion({
        offer: "Act",
        repositories: [LEDGER, CHECKOUT],
      }).repositories,
    ).toEqual([LEDGER, CHECKOUT]);
  });

  test("one repository is no choice: none", () => {
    expect(
      parseTelemetryImprovementSuggestion({
        offer: "Act",
        repositories: [CHECKOUT],
      }).repositories,
    ).toEqual([]);
  });

  test("each once, whatever the letter case of its id", () => {
    expect(
      parseTelemetryImprovementSuggestion({
        offer: "Act",
        repositories: [
          CHECKOUT,
          { id: CHECKOUT.id.toUpperCase(), name: "checkout again" },
          LEDGER,
        ],
      }).repositories,
    ).toEqual([CHECKOUT, LEDGER]);
  });

  test.each([
    ["no id", { name: "checkout" }],
    ["an empty id", { id: " ", name: "checkout" }],
    ["no name", { id: CHECKOUT.id }],
    ["an empty name", { id: CHECKOUT.id, name: "" }],
    ["a number for a name", { id: CHECKOUT.id, name: 7 }],
    ["text", "checkout"],
    ["a list", [CHECKOUT.id, "checkout"]],
    ["null", null],
  ])("an entry with %s is left out", (_label: string, entry: unknown) => {
    expect(
      parseTelemetryImprovementSuggestion({
        offer: "Act",
        repositories: [entry, CHECKOUT, LEDGER],
      }).repositories,
    ).toEqual([CHECKOUT, LEDGER]);
  });

  test("anything but a list reads as none", () => {
    for (const repositories of [CHECKOUT, "checkout", 2, null, undefined]) {
      expect(
        parseTelemetryImprovementSuggestion({ offer: "Act", repositories })
          .repositories,
      ).toEqual([]);
    }
  });

  test("an improvement on its way carries none: a pick is the card's own step", () => {
    expect(
      parseTelemetryImprovementSuggestion({
        offer: "InProgress",
        aiRunId: "70000000-0000-4000-8000-000000000009",
        repositories: [CHECKOUT, LEDGER],
      }).repositories,
    ).toEqual([]);
  });

  test("names and ids are read trimmed", () => {
    expect(
      parseTelemetryImprovementSuggestion({
        offer: "Act",
        repositories: [{ id: ` ${CHECKOUT.id} `, name: " checkout " }, LEDGER],
      }).repositories,
    ).toEqual([CHECKOUT, LEDGER]);
  });

  test("the server writes them as the card reads them", () => {
    expect(
      telemetryImprovementSuggestionToJSON({
        offer: SuggestionOffer.Act,
        aiRunId: null,
        repositories: [CHECKOUT, LEDGER],
      }),
    ).toEqual({
      offer: SuggestionOffer.Act,
      aiRunId: null,
      repositories: [CHECKOUT, LEDGER],
    });
  });
});
