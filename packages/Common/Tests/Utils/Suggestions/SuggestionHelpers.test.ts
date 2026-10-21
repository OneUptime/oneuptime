import { describe, expect, test } from "@jest/globals";
import { isAiOffered } from "../../../Utils/Suggestions/AiSuggestion";
import {
  CodeFixSuggestionInput,
  getCodeFixOffer,
} from "../../../Utils/Suggestions/CodeFixSuggestion";
import SuggestionOffer, {
  parseSuggestionOffer,
} from "../../../Utils/Suggestions/SuggestionOffer";

/*
 * The shared vocabulary of every suggestion: what a page may draw (None,
 * Act, SetUp, InProgress), whether AI actions are drawn at all (the one AI
 * switch), and the decision every "AI opens a pull request" suggestion
 * shares once its own rule has said whether it applies.
 */

describe("SuggestionOffer", () => {
  test("has the four answers a page can draw", () => {
    expect(Object.values(SuggestionOffer)).toEqual([
      "None",
      "Act",
      "SetUp",
      "InProgress",
    ]);
  });

  test.each(["None", "Act", "SetUp", "InProgress"])(
    "reads %s off the wire",
    (value: string) => {
      expect(parseSuggestionOffer(value)).toBe(value);
    },
  );

  test.each([
    ["an unknown value", "Maybe"],
    ["a lower-case value", "act"],
    ["a number", 1],
    ["nothing", undefined],
    ["null", null],
    ["an object", { offer: "Act" }],
  ])(
    "reads %s as None, so it never draws an action",
    (_label: string, value: unknown) => {
      expect(parseSuggestionOffer(value)).toBe(SuggestionOffer.None);
    },
  );
});

describe("isAiOffered", () => {
  test("AI switched off: no AI action is drawn", () => {
    expect(isAiOffered({ enableAi: false })).toBe(false);
  });

  test("AI switched on: AI actions are drawn", () => {
    expect(isAiOffered({ enableAi: true })).toBe(true);
  });

  test("an unknown value is read as on, as every server read of the switch is", () => {
    expect(isAiOffered({})).toBe(true);
    expect(isAiOffered({ enableAi: undefined })).toBe(true);
    expect(isAiOffered(null)).toBe(true);
    expect(isAiOffered(undefined)).toBe(true);
  });
});

describe("getCodeFixOffer", () => {
  const applies: CodeFixSuggestionInput = {
    isAiEnabled: true,
    applies: true,
    hasActiveFix: false,
    hasConnectedRepository: true,
    isBackedByEvidence: true,
  };

  test("applies, AI on, a repository, nothing in flight: the action", () => {
    expect(getCodeFixOffer(applies)).toBe(SuggestionOffer.Act);
  });

  test("AI off: nothing, whatever else is true", () => {
    expect(getCodeFixOffer({ ...applies, isAiEnabled: false })).toBe(
      SuggestionOffer.None,
    );
    expect(
      getCodeFixOffer({
        ...applies,
        isAiEnabled: false,
        hasActiveFix: true,
        hasConnectedRepository: false,
      }),
    ).toBe(SuggestionOffer.None);
  });

  test("does not apply: nothing, whatever else is true", () => {
    expect(getCodeFixOffer({ ...applies, applies: false })).toBe(
      SuggestionOffer.None,
    );
    expect(
      getCodeFixOffer({ ...applies, applies: false, hasActiveFix: true }),
    ).toBe(SuggestionOffer.None);
  });

  test("a fix already in flight: a link to it, before any repository question", () => {
    expect(getCodeFixOffer({ ...applies, hasActiveFix: true })).toBe(
      SuggestionOffer.InProgress,
    );
    expect(
      getCodeFixOffer({
        ...applies,
        hasActiveFix: true,
        hasConnectedRepository: false,
      }),
    ).toBe(SuggestionOffer.InProgress);
  });

  test("no repository, with evidence on screen: a quiet way to connect one", () => {
    expect(getCodeFixOffer({ ...applies, hasConnectedRepository: false })).toBe(
      SuggestionOffer.SetUp,
    );
  });

  test("no repository, with no evidence on screen: nothing - a setup link on every page would be noise", () => {
    expect(
      getCodeFixOffer({
        ...applies,
        hasConnectedRepository: false,
        isBackedByEvidence: false,
      }),
    ).toBe(SuggestionOffer.None);
  });

  test("every combination of the five inputs gives one of the four answers, and Act only when everything lines up", () => {
    const booleans: Array<boolean> = [true, false];

    for (const isAiEnabled of booleans) {
      for (const doesApply of booleans) {
        for (const hasActiveFix of booleans) {
          for (const hasConnectedRepository of booleans) {
            for (const isBackedByEvidence of booleans) {
              const offer: SuggestionOffer = getCodeFixOffer({
                isAiEnabled,
                applies: doesApply,
                hasActiveFix,
                hasConnectedRepository,
                isBackedByEvidence,
              });

              expect(Object.values(SuggestionOffer)).toContain(offer);
              expect(offer === SuggestionOffer.Act).toBe(
                isAiEnabled &&
                  doesApply &&
                  !hasActiveFix &&
                  hasConnectedRepository,
              );

              if (!isAiEnabled || !doesApply) {
                expect(offer).toBe(SuggestionOffer.None);
              }
            }
          }
        }
      }
    }
  });
});
