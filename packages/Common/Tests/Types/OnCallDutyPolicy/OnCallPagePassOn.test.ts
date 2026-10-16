import {
  CANT_TAKE_IT,
  CANT_TAKE_IT_PASS_IT_ON,
  ON_CALL_PAGE_CALL_PASS_ON_DIGIT,
  ON_CALL_PAGE_NOT_PAGED_AGAIN,
  ON_CALL_PAGE_PASS_ON_ROUTE,
  OnCallPageRecordType,
  OnCallPassOnOutcome,
  OnCallPassOnRefusal,
  OnCallPassOnResult,
  PASS_IT_ON,
  getOnCallPageCallPassOnPrompt,
  getOnCallPageRecordNoun,
  getOnCallPassOnRefusalSentence,
  getOnCallPassOnRuleLabel,
  getOnCallPassOnSentence,
  getOnCallPassOnTime,
  getOnCallPassOnTimeOfDay,
  isOnCallPageRecordType,
  isOnCallPassOnPagingStopped,
  isOnCallPassOnTimeToday,
  joinOnCallPassOnNames,
  readOnCallPassOnResult,
} from "../../../Types/OnCallDutyPolicy/OnCallPagePassOn";
import { describe, expect, test } from "@jest/globals";

/*
 * THE WORDS OF "CAN'T TAKE IT? PASS IT ON."
 *
 * One module holds what the email, the text, the call, the chat messages,
 * the pages a message's links open and the API say about passing a page
 * on. These pin those words: the name of the action, and the sentence for
 * every way passing on can come out - before (a preview) and after.
 */

function result(overrides: Partial<OnCallPassOnResult>): OnCallPassOnResult {
  return {
    outcome: OnCallPassOnOutcome.NextRulePaged,
    isPreview: false,
    isDirectPage: false,
    policyName: "Payments",
    pagedNames: [],
    stillPagedNames: [],
    ruleCount: 3,
    ...overrides,
  };
}

describe("the action's name", () => {
  test("is Pass it on, after Can't take it? where there is room", () => {
    expect(PASS_IT_ON).toBe("Pass it on");
    expect(CANT_TAKE_IT).toBe("Can't take it?");
    expect(CANT_TAKE_IT_PASS_IT_ON).toBe("Can't take it? Pass it on");
  });

  test("never says NACK: the customer's word, not the person's", () => {
    for (const words of [PASS_IT_ON, CANT_TAKE_IT_PASS_IT_ON]) {
      expect(words.toLowerCase()).not.toContain("nack");
    }
  });

  test("a call asks for the second key, after the first acknowledges", () => {
    expect(ON_CALL_PAGE_CALL_PASS_ON_DIGIT).toBe("2");
    expect(getOnCallPageCallPassOnPrompt()).toBe(
      "If you can't take it, press 2 to pass it on.",
    );
  });

  test("every place says once that the person is not paged again", () => {
    expect(ON_CALL_PAGE_NOT_PAGED_AGAIN).toBe(
      "You won't be paged about it again.",
    );
  });
});

describe("the records a page is about", () => {
  test("are the four kinds that page, by the Dashboard's names for them", () => {
    expect(Object.values(OnCallPageRecordType)).toEqual([
      "incident",
      "alert",
      "incident-episode",
      "alert-episode",
    ]);
    expect(ON_CALL_PAGE_PASS_ON_ROUTE).toBe("/on-call-page/pass-on");
  });

  test("a record type is one of them, and nothing else", () => {
    expect(isOnCallPageRecordType("incident")).toBe(true);
    expect(isOnCallPageRecordType("alert-episode")).toBe(true);
    expect(isOnCallPageRecordType("scheduled-maintenance")).toBe(false);
    expect(isOnCallPageRecordType("Incident")).toBe(false);
    expect(isOnCallPageRecordType(undefined)).toBe(false);
    expect(isOnCallPageRecordType(1)).toBe(false);
  });

  test("each is named as a sentence names it", () => {
    expect(getOnCallPageRecordNoun(OnCallPageRecordType.Incident)).toBe(
      "incident",
    );
    expect(getOnCallPageRecordNoun(OnCallPageRecordType.Alert)).toBe("alert");
    expect(getOnCallPageRecordNoun(OnCallPageRecordType.IncidentEpisode)).toBe(
      "incident episode",
    );
    expect(getOnCallPageRecordNoun(OnCallPageRecordType.AlertEpisode)).toBe(
      "alert episode",
    );
  });
});

describe("names and rules in a sentence", () => {
  test("names: one, two, and a list", () => {
    expect(joinOnCallPassOnNames([])).toBe("");
    expect(joinOnCallPassOnNames(["Ana"])).toBe("Ana");
    expect(joinOnCallPassOnNames(["Ana", "Bob"])).toBe("Ana and Bob");
    expect(joinOnCallPassOnNames(["Ana", "Bob", "Carl"])).toBe(
      "Ana, Bob and Carl",
    );
  });

  test("blank names are left out", () => {
    expect(joinOnCallPassOnNames([" ", "Ana", ""])).toBe("Ana");
  });

  test("a rule by its place, with the count and its name when known", () => {
    expect(getOnCallPassOnRuleLabel({ order: 2, name: "Managers" }, 3)).toBe(
      "escalation rule 2 of 3 (Managers)",
    );
    expect(getOnCallPassOnRuleLabel({ order: 2 }, 3)).toBe(
      "escalation rule 2 of 3",
    );
    expect(getOnCallPassOnRuleLabel({ order: 2, name: "  " })).toBe(
      "escalation rule 2",
    );
    // A count the rule is beyond is no count at all.
    expect(getOnCallPassOnRuleLabel({ order: 4 }, 3)).toBe("escalation rule 4");
  });
});

describe("what passing it on would do (a preview)", () => {
  test("the next rule, paged right away", () => {
    expect(
      getOnCallPassOnSentence(
        result({ isPreview: true, rule: { order: 2, name: "Level 2" } }),
      ),
    ).toBe(
      "Escalation rule 2 of 3 (Level 2) is paged right away, without waiting.",
    );
  });

  test("the policy starting again, on its last rule", () => {
    expect(
      getOnCallPassOnSentence(
        result({
          outcome: OnCallPassOnOutcome.PolicyStartedAgain,
          isPreview: true,
        }),
      ),
    ).toBe(
      "This is the policy's last escalation rule, so the policy starts again from escalation rule 1 right away.",
    );
  });

  test("paging stopping, for a policy and for a direct page", () => {
    expect(
      getOnCallPassOnSentence(
        result({ outcome: OnCallPassOnOutcome.PagingStopped, isPreview: true }),
      ),
    ).toBe(
      "Nobody else is left to page: paging stops, and somebody needs to take it.",
    );
    expect(
      getOnCallPassOnSentence(
        result({
          outcome: OnCallPassOnOutcome.PagingStopped,
          isPreview: true,
          isDirectPage: true,
        }),
      ),
    ).toBe(
      "Nobody else is being paged: paging stops, and somebody needs to take it.",
    );
  });
});

describe("what passing it on did", () => {
  test("the next rule, and who it is paging now", () => {
    expect(
      getOnCallPassOnSentence(
        result({
          rule: { order: 2, name: "Level 2" },
          pagedNames: ["Sam Lee", "Kim Ito"],
        }),
      ),
    ).toBe(
      "Escalation rule 2 of 3 (Level 2) is paging Sam Lee and Kim Ito now.",
    );
  });

  test("the next rule, when it reached nobody yet", () => {
    expect(
      getOnCallPassOnSentence(result({ rule: { order: 2, name: "Level 2" } })),
    ).toBe("Escalation rule 2 of 3 (Level 2) is next, and is being paged now.");
  });

  test("a rule it does not know the place of is the next one", () => {
    expect(getOnCallPassOnSentence(result({ pagedNames: ["Sam"] }))).toBe(
      "The next escalation rule is paging Sam now.",
    );
  });

  test("the policy started again, and who it is paging", () => {
    expect(
      getOnCallPassOnSentence(
        result({
          outcome: OnCallPassOnOutcome.PolicyStartedAgain,
          pagedNames: ["Bob Smith"],
        }),
      ),
    ).toBe(
      "That was the policy's last escalation rule, so the policy started again from escalation rule 1. It is paging Bob Smith now.",
    );
  });

  test("paging stopped: somebody needs to take it", () => {
    expect(
      getOnCallPassOnSentence(
        result({ outcome: OnCallPassOnOutcome.PagingStopped }),
      ),
    ).toBe(
      "Nobody else is left to page, so paging stopped. Somebody needs to take it.",
    );
  });

  test("the run had moved on already", () => {
    expect(
      getOnCallPassOnSentence(
        result({
          outcome: OnCallPassOnOutcome.AlreadyEscalated,
          rule: { order: 3, name: "Managers" },
        }),
      ),
    ).toBe(
      "The policy has moved on already: escalation rule 3 of 3 (Managers) is paging now.",
    );
    expect(
      getOnCallPassOnSentence(
        result({ outcome: OnCallPassOnOutcome.AlreadyEscalated }),
      ),
    ).toBe(
      "The policy has moved on already: a later escalation rule is paging now.",
    );
  });
});

describe("somebody else still paged", () => {
  const AT: Date = new Date("2026-10-16T03:30:00.000Z");
  // Half an hour before: the rule's wait is running.
  const NOW: Date = new Date("2026-10-16T03:00:00.000Z");

  test("one person, and when the next rule comes, in the reader's own zone", () => {
    expect(
      getOnCallPassOnSentence(
        result({
          outcome: OnCallPassOnOutcome.OthersStillPaged,
          stillPagedNames: ["Bob Smith"],
          nextStepAt: AT,
          nextRule: { order: 2, name: "Level 2" },
        }),
        { timezone: "America/New_York", now: NOW },
      ),
    ).toBe(
      "Bob Smith is still being paged. If nobody acknowledges by 11:30 PM EDT, escalation rule 2 of 3 (Level 2) is next.",
    );
  });

  test("several people", () => {
    expect(
      getOnCallPassOnSentence(
        result({
          outcome: OnCallPassOnOutcome.OthersStillPaged,
          stillPagedNames: ["Bob", "Carl"],
          nextStepAt: AT,
        }),
        { timezone: "UTC", now: NOW },
      ),
    ).toBe(
      "Bob and Carl are still being paged. If nobody acknowledges by 3:30 AM UTC, the policy moves on.",
    );
  });

  test("a time on another day keeps its date - on the reader's own calendar", () => {
    // 11 PM in New York: the next rule comes after midnight there.
    expect(
      getOnCallPassOnSentence(
        result({
          outcome: OnCallPassOnOutcome.OthersStillPaged,
          stillPagedNames: ["Bob Smith"],
          nextStepAt: new Date("2026-10-16T04:30:00.000Z"),
          nextRule: { order: 2, name: "Level 2" },
        }),
        { timezone: "America/New_York", now: NOW },
      ),
    ).toBe(
      "Bob Smith is still being paged. If nobody acknowledges by Oct 16, 2026, 12:30 AM EDT, escalation rule 2 of 3 (Level 2) is next.",
    );

    // A long wait, read the evening before.
    expect(
      getOnCallPassOnSentence(
        result({
          outcome: OnCallPassOnOutcome.OthersStillPaged,
          stillPagedNames: ["Bob"],
          nextStepAt: AT,
        }),
        { timezone: "UTC", now: new Date("2026-10-15T21:00:00.000Z") },
      ),
    ).toBe(
      "Bob is still being paged. If nobody acknowledges by Oct 16, 2026, 3:30 AM UTC, the policy moves on.",
    );
  });

  test("a direct page has no rule to wait for", () => {
    expect(
      getOnCallPassOnSentence(
        result({
          outcome: OnCallPassOnOutcome.OthersStillPaged,
          isDirectPage: true,
          stillPagedNames: ["Bob"],
          nextStepAt: AT,
        }),
      ),
    ).toBe("Bob is still being paged.");
  });

  test("with no names to give", () => {
    expect(
      getOnCallPassOnSentence(
        result({ outcome: OnCallPassOnOutcome.OthersStillPaged }),
      ),
    ).toBe("Somebody else is still being paged.");
  });
});

describe("when the policy moves on, as a time", () => {
  const AT: Date = new Date("2026-10-16T03:30:00.000Z");

  test("is the day's time when it is today on the reader's clock", () => {
    expect(
      isOnCallPassOnTimeToday({
        at: AT,
        now: new Date("2026-10-16T00:10:00.000Z"),
        timezone: "UTC",
      }),
    ).toBe(true);
    expect(
      getOnCallPassOnTime(AT, {
        timezone: "Europe/Berlin",
        now: new Date("2026-10-16T03:00:00.000Z"),
      }),
    ).toBe("5:30 AM CEST");
  });

  test("today is the reader's today, not the server's", () => {
    // 11:55 PM in UTC, but already 1:55 AM on the 16th in Berlin.
    const now: Date = new Date("2026-10-15T23:55:00.000Z");

    expect(isOnCallPassOnTimeToday({ at: AT, now: now, timezone: "UTC" })).toBe(
      false,
    );
    expect(
      isOnCallPassOnTimeToday({
        at: AT,
        now: now,
        timezone: "Europe/Berlin",
      }),
    ).toBe(true);
  });

  test("a time of day names its zone, as it was then", () => {
    expect(getOnCallPassOnTimeOfDay({ at: AT, timezone: "UTC" })).toBe(
      "3:30 AM UTC",
    );
    // New York is on EST in January.
    expect(
      getOnCallPassOnTimeOfDay({
        at: new Date("2027-01-16T03:30:00.000Z"),
        timezone: "America/New_York",
      }),
    ).toBe("10:30 PM EST");
  });

  test("reads the clock when it is not told the time", () => {
    const soon: Date = new Date(Date.now() + 60 * 1000);

    expect(isOnCallPassOnTimeToday({ at: new Date(), timezone: "UTC" })).toBe(
      true,
    );
    expect(
      getOnCallPassOnTime(soon, { timezone: "UTC" }).endsWith(" UTC"),
    ).toBe(true);
  });
});

describe("passing on that leaves nobody being paged", () => {
  test("is the one outcome said as a warning", () => {
    for (const outcome of Object.values(OnCallPassOnOutcome)) {
      expect(isOnCallPassOnPagingStopped(result({ outcome: outcome }))).toBe(
        outcome === OnCallPassOnOutcome.PagingStopped,
      );
    }
  });
});

describe("why it could not be passed on", () => {
  test("the record was acknowledged - by whom, when known", () => {
    expect(
      getOnCallPassOnRefusalSentence(
        {
          passedOn: false,
          refusal: OnCallPassOnRefusal.RecordAcknowledged,
          acknowledgedByName: "Bob Smith",
        },
        { recordLabel: "Incident INC-42" },
      ),
    ).toBe(
      "Incident INC-42 was already acknowledged by Bob Smith, so there is nothing to pass on.",
    );
    expect(
      getOnCallPassOnRefusalSentence(
        { passedOn: false, refusal: OnCallPassOnRefusal.RecordAcknowledged },
        { recordLabel: "Alert #12" },
      ),
    ).toBe(
      "Alert #12 is already acknowledged, so there is nothing to pass on.",
    );
    expect(
      getOnCallPassOnRefusalSentence({
        passedOn: false,
        refusal: OnCallPassOnRefusal.RecordAcknowledged,
      }),
    ).toBe("It is already acknowledged, so there is nothing to pass on.");
  });

  test("passed on already, over, not paged, a link that cannot", () => {
    expect(
      getOnCallPassOnRefusalSentence({
        passedOn: false,
        refusal: OnCallPassOnRefusal.AlreadyPassedOn,
      }),
    ).toBe(
      "You passed this page on already. You won't be paged about it again.",
    );
    expect(
      getOnCallPassOnRefusalSentence({
        passedOn: false,
        refusal: OnCallPassOnRefusal.PageOver,
      }),
    ).toBe("This page is over: the on-call policy has stopped paging.");
    expect(
      getOnCallPassOnRefusalSentence({
        passedOn: false,
        refusal: OnCallPassOnRefusal.NotPaged,
      }),
    ).toBe("You are not being paged about this right now.");
    expect(
      getOnCallPassOnRefusalSentence({
        passedOn: false,
        refusal: OnCallPassOnRefusal.InvalidLink,
      }),
    ).toBe(
      "This link cannot pass the page on: it is not valid, or it has expired. Use the link in the newest message you were paged with.",
    );
  });

  test("never names the product: a licence may rename it", () => {
    for (const refusal of Object.values(OnCallPassOnRefusal)) {
      expect(
        getOnCallPassOnRefusalSentence({ passedOn: false, refusal: refusal }),
      ).not.toContain("OneUptime");
    }
  });
});

describe("an answer read back from JSON", () => {
  test("its time is a Date again", () => {
    const read: OnCallPassOnResult = readOnCallPassOnResult(
      JSON.parse(
        JSON.stringify(
          result({
            outcome: OnCallPassOnOutcome.OthersStillPaged,
            nextStepAt: new Date("2026-10-16T03:30:00.000Z"),
          }),
        ),
      ) as OnCallPassOnResult,
    );

    expect(read.nextStepAt).toBeInstanceOf(Date);
    expect(read.nextStepAt?.toISOString()).toBe("2026-10-16T03:30:00.000Z");
  });

  test("no time, or a time that cannot be read, is none", () => {
    expect(readOnCallPassOnResult(result({})).nextStepAt).toBeUndefined();
    expect(
      readOnCallPassOnResult({
        ...result({}),
        nextStepAt: "not a date" as unknown as Date,
      }).nextStepAt,
    ).toBeUndefined();
  });
});
