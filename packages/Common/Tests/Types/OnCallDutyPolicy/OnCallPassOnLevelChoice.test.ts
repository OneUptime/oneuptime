import {
  ON_CALL_LEVEL_SKIPPED_BY_ESCALATION_TIMELINE_MESSAGE,
  ON_CALL_PAGE_ESCALATE_TO_LABEL,
  ON_CALL_PAGE_LEVEL_NOT_AVAILABLE_SENTENCE,
  ON_CALL_PAGE_NOT_ESCALATED_TITLE,
  ON_CALL_PAGE_PASS_ON_ESCALATE_TO_FIELD,
  ON_CALL_PAGE_PASS_ON_LEVEL_PARAM,
  ON_CALL_PAGE_PICK_LEVEL_SENTENCE,
  OnCallPassOnLevelChoice,
  OnCallPassOnOutcome,
  OnCallPassOnRefusal,
  OnCallPassOnResult,
  findOnCallPassOnLevelChoice,
  getOnCallPassOnLevelChoices,
  getOnCallPassOnPickedResult,
  getOnCallPassOnRefusalSentence,
  getOnCallPassOnSentence,
  hasOnCallPassOnLevelChoice,
  isOnCallLevelSkippedByEscalationMessage,
  isOnCallPagePassedOnSkipTimelineMessage,
  readOnCallPassOnResult,
} from "../../../Types/OnCallDutyPolicy/OnCallPagePassOn";
import {
  ON_CALL_LEVEL_HAS_NO_RESPONDERS_TIMELINE_MESSAGE,
  ON_CALL_LEVEL_PAGED_NOBODY_TIMELINE_MESSAGE,
  readOnCallEmptyLevelLine,
} from "../../../Types/OnCallDutyPolicy/OnCallEmptyLevel";
import { describe, expect, test } from "@jest/globals";

/*
 * ESCALATING TO A LEVEL THE PERSON PICKS - THE SHARED WORDS AND READERS.
 *
 * Somebody who cannot take a page escalates it; with two or more levels
 * after theirs, they can pick which one pages (#4914 asked for the next;
 * this follow-up lets them choose). The module every place reads holds the
 * levels a preview offers, how a level picked is found and what escalating
 * would do with it, the refusal for a level no longer offered, and the
 * line a level skipped gets on the run's timeline. These pin them.
 */

const LEVEL_2: OnCallPassOnLevelChoice = {
  escalationRuleId: "0fc00000-0000-4000-8000-000000000002",
  order: 2,
  name: "Platform leads",
};

const LEVEL_3: OnCallPassOnLevelChoice = {
  escalationRuleId: "0fc00000-0000-4000-8000-000000000003",
  order: 3,
  name: "DBA leads",
};

const LEVEL_4: OnCallPassOnLevelChoice = {
  escalationRuleId: "0fc00000-0000-4000-8000-000000000004",
  order: 4,
};

const PREVIEW: OnCallPassOnResult = {
  outcome: OnCallPassOnOutcome.NextRulePaged,
  isPreview: true,
  isDirectPage: false,
  policyName: "Payments",
  rule: { order: 2, name: "Platform leads" },
  pagedNames: [],
  stillPagedNames: [],
  ruleCount: 4,
  levelChoices: [LEVEL_2, LEVEL_3, LEVEL_4],
};

describe("the levels a preview offers", () => {
  test("in order, each once", () => {
    expect(
      getOnCallPassOnLevelChoices({
        ...PREVIEW,
        levelChoices: [LEVEL_4, LEVEL_2, LEVEL_3, { ...LEVEL_2 }],
      }),
    ).toEqual([LEVEL_2, LEVEL_3, LEVEL_4]);
  });

  test("an id in another case is the same level", () => {
    expect(
      getOnCallPassOnLevelChoices({
        ...PREVIEW,
        levelChoices: [
          LEVEL_2,
          {
            ...LEVEL_2,
            escalationRuleId: LEVEL_2.escalationRuleId.toUpperCase(),
          },
        ],
      }),
    ).toEqual([LEVEL_2]);
  });

  test("a level whose id or place cannot be read is left out", () => {
    expect(
      getOnCallPassOnLevelChoices({
        ...PREVIEW,
        levelChoices: [
          LEVEL_2,
          { escalationRuleId: "", order: 3 },
          { escalationRuleId: "   ", order: 3 },
          { escalationRuleId: LEVEL_3.escalationRuleId, order: 0 },
          { escalationRuleId: LEVEL_3.escalationRuleId, order: -1 },
          { escalationRuleId: LEVEL_3.escalationRuleId, order: 2.5 },
          { escalationRuleId: LEVEL_3.escalationRuleId, order: NaN },
          {
            escalationRuleId: 7,
            order: 3,
          } as unknown as OnCallPassOnLevelChoice,
          null as unknown as OnCallPassOnLevelChoice,
          "Level 3" as unknown as OnCallPassOnLevelChoice,
          LEVEL_4,
        ],
      }),
    ).toEqual([LEVEL_2, LEVEL_4]);
  });

  test("none when it offers none, or what it offers is not a list", () => {
    expect(getOnCallPassOnLevelChoices(undefined)).toEqual([]);
    expect(getOnCallPassOnLevelChoices(null)).toEqual([]);
    expect(
      getOnCallPassOnLevelChoices({ ...PREVIEW, levelChoices: undefined }),
    ).toEqual([]);
    expect(
      getOnCallPassOnLevelChoices({
        ...PREVIEW,
        levelChoices: {
          0: LEVEL_2,
        } as unknown as Array<OnCallPassOnLevelChoice>,
      }),
    ).toEqual([]);
  });

  test("there is a level to pick with two or more, not with one", () => {
    expect(hasOnCallPassOnLevelChoice(PREVIEW)).toBe(true);
    expect(
      hasOnCallPassOnLevelChoice({
        ...PREVIEW,
        levelChoices: [LEVEL_2, LEVEL_3],
      }),
    ).toBe(true);
    expect(
      hasOnCallPassOnLevelChoice({ ...PREVIEW, levelChoices: [LEVEL_2] }),
    ).toBe(false);
    expect(hasOnCallPassOnLevelChoice({ ...PREVIEW, levelChoices: [] })).toBe(
      false,
    );
    expect(hasOnCallPassOnLevelChoice(undefined)).toBe(false);
  });
});

describe("finding the level picked", () => {
  const choices: Array<OnCallPassOnLevelChoice> = [LEVEL_2, LEVEL_3, LEVEL_4];

  test("by its escalation rule's id, in any case and with spaces around it", () => {
    expect(findOnCallPassOnLevelChoice(choices, LEVEL_3.escalationRuleId)).toBe(
      LEVEL_3,
    );
    expect(
      findOnCallPassOnLevelChoice(
        choices,
        ` ${LEVEL_3.escalationRuleId.toUpperCase()} `,
      ),
    ).toBe(LEVEL_3);
  });

  test("none for an id it does not offer, or no id", () => {
    expect(
      findOnCallPassOnLevelChoice(
        choices,
        "0fc00000-0000-4000-8000-0000000000ff",
      ),
    ).toBeUndefined();
    expect(findOnCallPassOnLevelChoice(choices, "")).toBeUndefined();
    expect(findOnCallPassOnLevelChoice(choices, undefined)).toBeUndefined();
    expect(findOnCallPassOnLevelChoice(choices, null)).toBeUndefined();
  });
});

describe("what escalating would do with a later level picked", () => {
  test("pages the level picked, and skips the levels before it", () => {
    const picked: ReturnType<typeof getOnCallPassOnPickedResult> =
      getOnCallPassOnPickedResult(PREVIEW, LEVEL_4.escalationRuleId);

    expect(picked.result.rule).toEqual({ order: 4, name: undefined });
    expect(picked.skipped).toEqual([
      { order: 2, name: "Platform leads" },
      { order: 3, name: "DBA leads" },
    ]);
    expect(getOnCallPassOnSentence(picked.result)).toBe(
      "This will immediately page Level 4 of 4, without waiting.",
    );
  });

  test("a named level is named, as the maintainer's sentence names the next", () => {
    expect(
      getOnCallPassOnSentence(
        getOnCallPassOnPickedResult(PREVIEW, LEVEL_3.escalationRuleId).result,
      ),
    ).toBe(
      "This will immediately page DBA leads (Level 3 of 4), without waiting.",
    );
  });

  test("the next level is the preview as it is, skipping nothing", () => {
    expect(
      getOnCallPassOnPickedResult(PREVIEW, LEVEL_2.escalationRuleId),
    ).toEqual({
      result: PREVIEW,
      skipped: [],
    });
  });

  test("no level, or one the preview does not offer, is the preview as it is", () => {
    for (const id of [
      undefined,
      null,
      "",
      "0fc00000-0000-4000-8000-0000000000ff",
    ]) {
      expect(getOnCallPassOnPickedResult(PREVIEW, id)).toEqual({
        result: PREVIEW,
        skipped: [],
      });
    }
  });

  test("a preview that pages no level now has nothing a pick could change", () => {
    const stillPaged: OnCallPassOnResult = {
      ...PREVIEW,
      outcome: OnCallPassOnOutcome.OthersStillPaged,
      stillPagedNames: ["Bob Smith"],
    };

    expect(
      getOnCallPassOnPickedResult(stillPaged, LEVEL_3.escalationRuleId),
    ).toEqual({ result: stillPaged, skipped: [] });
  });

  test("the preview itself is not changed", () => {
    getOnCallPassOnPickedResult(PREVIEW, LEVEL_4.escalationRuleId);

    expect(PREVIEW.rule).toEqual({ order: 2, name: "Platform leads" });
  });
});

describe("a level picked that is not offered any more", () => {
  test("is refused, saying nothing was escalated and what to do", () => {
    expect(
      getOnCallPassOnRefusalSentence({
        passedOn: false,
        refusal: OnCallPassOnRefusal.LevelNotAvailable,
      }),
    ).toBe(ON_CALL_PAGE_LEVEL_NOT_AVAILABLE_SENTENCE);
    expect(ON_CALL_PAGE_LEVEL_NOT_AVAILABLE_SENTENCE).toBe(
      "The policy's levels have changed, so nothing was escalated. Escalate again to pick a level.",
    );
  });

  test("its heading says what happened, never the button's word alone", () => {
    expect(ON_CALL_PAGE_NOT_ESCALATED_TITLE).toBe("Not escalated");
  });
});

describe("the words where a level is picked", () => {
  test("the radio group is 'Escalate to', and the page says it pages the level picked", () => {
    expect(ON_CALL_PAGE_ESCALATE_TO_LABEL).toBe("Escalate to");
    expect(ON_CALL_PAGE_PICK_LEVEL_SENTENCE).toBe(
      "This will immediately page the level you pick, without waiting.",
    );
  });

  test("the form field and the API's body field", () => {
    expect(ON_CALL_PAGE_PASS_ON_LEVEL_PARAM).toBe("escalationRuleId");
    expect(ON_CALL_PAGE_PASS_ON_ESCALATE_TO_FIELD).toBe("escalateTo");
  });
});

describe("the line a level skipped gets", () => {
  test("is read back as it was written, and nothing else is", () => {
    expect(
      isOnCallLevelSkippedByEscalationMessage(
        ON_CALL_LEVEL_SKIPPED_BY_ESCALATION_TIMELINE_MESSAGE,
      ),
    ).toBe(true);
    expect(
      isOnCallLevelSkippedByEscalationMessage(
        `  ${ON_CALL_LEVEL_SKIPPED_BY_ESCALATION_TIMELINE_MESSAGE}  `,
      ),
    ).toBe(true);

    for (const other of [
      undefined,
      null,
      "",
      ON_CALL_LEVEL_HAS_NO_RESPONDERS_TIMELINE_MESSAGE,
      ON_CALL_LEVEL_PAGED_NOBODY_TIMELINE_MESSAGE,
      "Skipped because they escalated this page.",
    ]) {
      expect(isOnCallLevelSkippedByEscalationMessage(other)).toBe(false);
    }
  });

  test("is no empty level, and no line of a person who escalated", () => {
    expect(
      readOnCallEmptyLevelLine(
        ON_CALL_LEVEL_SKIPPED_BY_ESCALATION_TIMELINE_MESSAGE,
      ),
    ).toBeNull();
    expect(
      isOnCallPagePassedOnSkipTimelineMessage(
        ON_CALL_LEVEL_SKIPPED_BY_ESCALATION_TIMELINE_MESSAGE,
      ),
    ).toBe(false);
  });
});

describe("an answer read back from JSON", () => {
  test("keeps the levels it offers, as far as they can be read", () => {
    const json: unknown = JSON.parse(
      JSON.stringify({
        ...PREVIEW,
        levelChoices: [
          LEVEL_3,
          { escalationRuleId: "", order: 9 },
          { ...LEVEL_2, name: "" },
          LEVEL_4,
        ],
      }),
    );

    expect(
      readOnCallPassOnResult(json as OnCallPassOnResult).levelChoices,
    ).toEqual([
      { escalationRuleId: LEVEL_2.escalationRuleId, order: 2 },
      LEVEL_3,
      { escalationRuleId: LEVEL_4.escalationRuleId, order: 4 },
    ]);
  });

  test("an answer that offers none, or offers something else, offers none", () => {
    expect(
      readOnCallPassOnResult({ ...PREVIEW, levelChoices: undefined })
        .levelChoices,
    ).toBeUndefined();
    expect(
      readOnCallPassOnResult({ ...PREVIEW, levelChoices: [] }).levelChoices,
    ).toBeUndefined();
    expect(
      readOnCallPassOnResult({
        ...PREVIEW,
        levelChoices: "all" as unknown as Array<OnCallPassOnLevelChoice>,
      }).levelChoices,
    ).toBeUndefined();
  });

  test("still reads its time back, choices or not", () => {
    const read: OnCallPassOnResult = readOnCallPassOnResult(
      JSON.parse(
        JSON.stringify({
          ...PREVIEW,
          nextStepAt: new Date("2026-10-16T03:30:00.000Z"),
        }),
      ) as OnCallPassOnResult,
    );

    expect(read.nextStepAt).toEqual(new Date("2026-10-16T03:30:00.000Z"));
    expect(read.levelChoices).toHaveLength(3);
  });
});
