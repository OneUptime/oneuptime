/*
 * "Fix with AI" on a finding of a telemetry product's (TelemetryAiFix
 * Suggestion): the offer decided by the gates the create route checks, and
 * the answer read defensively - whatever does not hold together offers
 * nothing.
 */

import { CodeTaskBlockerType } from "../../../Types/AI/CodeTask";
import CodeFixTaskType from "../../../Types/AI/CodeFixTaskType";
import SuggestionOffer from "../../../Utils/Suggestions/SuggestionOffer";
import {
  NO_TELEMETRY_AI_FIX_SUGGESTION,
  TELEMETRY_AI_FIX_CONNECT_REPOSITORY_MESSAGE,
  TelemetryAiFixOffer,
  TelemetryAiFixSuggestion,
  getTelemetryAiFixOffer,
  parseTelemetryAiFixSuggestion,
  telemetryAiFixSuggestionToJSON,
} from "../../../Utils/Suggestions/TelemetryAiFixSuggestion";
import { describe, expect, test } from "@jest/globals";

const REPO: string = "5229cccc-0000-4000-8000-0000000000a1";

describe("getTelemetryAiFixOffer", () => {
  const ready: Parameters<typeof getTelemetryAiFixOffer>[0] = {
    isAiEnabled: true,
    isFixable: true,
    hasActiveFix: false,
    hasConnectedRepository: true,
  };

  test("everything in place: Fix with AI", () => {
    expect(getTelemetryAiFixOffer(ready)).toEqual({
      offer: SuggestionOffer.Act,
      blocker: null,
    });
  });

  test("AI off, or nothing to fix: nothing", () => {
    expect(getTelemetryAiFixOffer({ ...ready, isAiEnabled: false })).toEqual({
      offer: SuggestionOffer.None,
      blocker: null,
    });
    expect(getTelemetryAiFixOffer({ ...ready, isFixable: false })).toEqual({
      offer: SuggestionOffer.None,
      blocker: null,
    });
  });

  test("a task already on its way: in progress", () => {
    expect(getTelemetryAiFixOffer({ ...ready, hasActiveFix: true }).offer).toBe(
      SuggestionOffer.InProgress,
    );
  });

  test("no repository: the one step, connect one, in words that name no host", () => {
    const offer: TelemetryAiFixOffer = getTelemetryAiFixOffer({
      ...ready,
      hasConnectedRepository: false,
    });

    expect(offer).toEqual({
      offer: SuggestionOffer.SetUp,
      blocker: {
        type: CodeTaskBlockerType.RepositoryNotConnected,
        message: TELEMETRY_AI_FIX_CONNECT_REPOSITORY_MESSAGE,
      },
    });
    expect(TELEMETRY_AI_FIX_CONNECT_REPOSITORY_MESSAGE).not.toContain("GitHub");
  });

  test("Code's gate says no: that step, in its words", () => {
    expect(
      getTelemetryAiFixOffer({
        ...ready,
        blocker: {
          type: CodeTaskBlockerType.NoAiCredits,
          message: "No AI credits left.",
        },
      }),
    ).toEqual({
      offer: SuggestionOffer.SetUp,
      blocker: {
        type: CodeTaskBlockerType.NoAiCredits,
        message: "No AI credits left.",
      },
    });
  });

  test("the person may not ask in the repository: nothing they could do here", () => {
    expect(
      getTelemetryAiFixOffer({
        ...ready,
        blocker: {
          type: CodeTaskBlockerType.NoPermission,
          message: "You cannot ask AI to work in this repository.",
        },
      }),
    ).toEqual({ offer: SuggestionOffer.None, blocker: null });
  });
});

describe("the answer, on the wire", () => {
  const act: TelemetryAiFixSuggestion = {
    offer: SuggestionOffer.Act,
    blocker: null,
    repository: { id: REPO, name: "acme/checkout" },
    repositories: [],
    taskId: null,
  };

  test("round-trips every offer", () => {
    const suggestions: Array<TelemetryAiFixSuggestion> = [
      act,
      {
        ...NO_TELEMETRY_AI_FIX_SUGGESTION,
        offer: SuggestionOffer.Act,
        repositories: [
          { id: REPO, name: "acme/checkout" },
          { id: "5229cccc-0000-4000-8000-0000000000b2", name: "acme/web" },
        ],
      },
      {
        ...NO_TELEMETRY_AI_FIX_SUGGESTION,
        offer: SuggestionOffer.SetUp,
        blocker: {
          type: CodeTaskBlockerType.RunnerNotOnline,
          message: "The Runner prod-eu is not online.",
          runnerName: "prod-eu",
          repositoryId: REPO,
        },
      },
      {
        ...NO_TELEMETRY_AI_FIX_SUGGESTION,
        offer: SuggestionOffer.InProgress,
        taskId: "5229cccc-0000-4000-8000-0000000000f1",
      },
      NO_TELEMETRY_AI_FIX_SUGGESTION,
    ];

    for (const suggestion of suggestions) {
      expect(
        parseTelemetryAiFixSuggestion(
          JSON.parse(
            JSON.stringify(telemetryAiFixSuggestionToJSON(suggestion)),
          ),
        ),
      ).toEqual(suggestion);
    }
  });

  test("whatever does not hold together offers nothing", () => {
    for (const value of [
      null,
      undefined,
      "Act",
      [],
      {},
      { offer: "Acting" },
      // In progress with no task to link to.
      { offer: SuggestionOffer.InProgress },
      // A set-up step that says nothing.
      { offer: SuggestionOffer.SetUp, blocker: { type: "Nope", message: "x" } },
      { offer: SuggestionOffer.SetUp, blocker: { type: "NoAiCredits" } },
      // An action with nowhere to ask it.
      { offer: SuggestionOffer.Act, repository: null, repositories: [] },
      { offer: SuggestionOffer.Act, repository: { id: REPO } },
      /*
       * A finished fix, which this suggestion never says (a finding with
       * its fix offers nothing) - never read as an action, even with
       * somewhere to ask it.
       */
      {
        offer: SuggestionOffer.Done,
        repository: { id: REPO, name: "acme/checkout" },
        taskId: "5229cccc-0000-4000-8000-0000000000f1",
      },
    ]) {
      expect(parseTelemetryAiFixSuggestion(value)).toEqual(
        NO_TELEMETRY_AI_FIX_SUGGESTION,
      );
    }
  });

  test("a found repository is the one: no list to pick from beside it", () => {
    expect(
      parseTelemetryAiFixSuggestion({
        offer: SuggestionOffer.Act,
        repository: { id: REPO, name: "acme/checkout" },
        repositories: [{ id: "x", name: "acme/other" }],
      }).repositories,
    ).toEqual([]);
  });

  test("repositories that do not hold together are left out of the list", () => {
    expect(
      parseTelemetryAiFixSuggestion({
        offer: SuggestionOffer.Act,
        repositories: [
          { id: REPO, name: "acme/checkout" },
          { id: "", name: "acme/blank" },
          { name: "acme/no-id" },
          "acme/text",
        ],
      }).repositories,
    ).toEqual([{ id: REPO, name: "acme/checkout" }]);
  });
});

/*
 * An exception finding's offer says which pull request it would be - a fix,
 * or better handling of an expected error - so the strip can say so. Only a
 * Code recipe there is, and only on an offer to act, is read.
 */
describe("the recipe, on the wire", () => {
  const act: TelemetryAiFixSuggestion = {
    offer: SuggestionOffer.Act,
    blocker: null,
    repository: { id: REPO, name: "acme/checkout" },
    repositories: [],
    taskId: null,
  };

  test("round-trips with an offer to act", () => {
    for (const recipe of [
      CodeFixTaskType.FixException,
      CodeFixTaskType.ImproveExceptionHandling,
      CodeFixTaskType.CodeRequest,
    ]) {
      const suggestion: TelemetryAiFixSuggestion = { ...act, recipe };

      expect(telemetryAiFixSuggestionToJSON(suggestion)["recipe"]).toBe(recipe);
      expect(
        parseTelemetryAiFixSuggestion(
          JSON.parse(
            JSON.stringify(telemetryAiFixSuggestionToJSON(suggestion)),
          ),
        ),
      ).toEqual(suggestion);
    }
  });

  test("absent, it stays absent: a request in Code, as before", () => {
    expect(telemetryAiFixSuggestionToJSON(act)).not.toHaveProperty("recipe");
    expect(
      parseTelemetryAiFixSuggestion(telemetryAiFixSuggestionToJSON(act)),
    ).not.toHaveProperty("recipe");
  });

  test("a recipe that is not one, or on an offer that is not to act, is left out", () => {
    for (const recipe of ["DropDatabase", "", 42, null]) {
      expect(
        parseTelemetryAiFixSuggestion({
          ...telemetryAiFixSuggestionToJSON(act),
          recipe,
        }),
      ).not.toHaveProperty("recipe");
    }

    expect(
      parseTelemetryAiFixSuggestion({
        offer: SuggestionOffer.InProgress,
        taskId: "5229cccc-0000-4000-8000-0000000000f1",
        recipe: CodeFixTaskType.FixException,
      }),
    ).not.toHaveProperty("recipe");
  });
});
