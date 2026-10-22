import {
  CANT_TAKE_IT,
  CANT_TAKE_IT_ESCALATE,
  ESCALATE,
  LEGACY_ON_CALL_PAGE_PASSED_ON_SKIP_TIMELINE_MESSAGE,
  LEGACY_ON_CALL_PAGE_PASSED_ON_STATUS_MESSAGE,
  ON_CALL_PAGE_ALREADY_ACKNOWLEDGED_TITLE,
  ON_CALL_PAGE_ALREADY_ESCALATED_TITLE,
  ON_CALL_PAGE_CALL_PASS_ON_DIGIT,
  ON_CALL_PAGE_ESCALATED_STATUS_LABEL,
  ON_CALL_PAGE_NOTHING_TO_ESCALATE_TITLE,
  ON_CALL_PAGE_PASSED_ON_DELIVERY_MESSAGE,
  ON_CALL_PAGE_PASSED_ON_SKIP_TIMELINE_MESSAGE,
  ON_CALL_PAGE_PASSED_ON_STATUS_MESSAGE,
  ON_CALL_PAGE_PASSED_ON_STATUS_VALUE,
  ON_CALL_PAGE_PASS_ON_ROUTE,
  ON_CALL_PASS_ON_NO_BREAK_SPACE,
  OnCallPageRecordType,
  OnCallPassOnOutcome,
  OnCallPassOnRefusal,
  OnCallPassOnResult,
  OnCallPassOnRule,
  getOnCallPageCallPassOnPrompt,
  getOnCallPageEscalatedTitle,
  getOnCallPageNotPagedAgainSentence,
  getOnCallPageRecordNoun,
  getOnCallPageStatusLabel,
  getOnCallPassOnLevelCount,
  getOnCallPassOnLevelLabel,
  getOnCallPassOnLevelName,
  getOnCallPassOnRefusalSentence,
  getOnCallPassOnSentence,
  getOnCallPassOnTime,
  getOnCallPassOnTimeOfDay,
  isOnCallPageRecordType,
  isOnCallPagePassedOnSkipTimelineMessage,
  isOnCallPagePassedOnStatusMessage,
  isOnCallPassOnPagingStopped,
  isOnCallPassOnTimeToday,
  joinOnCallPassOnNames,
  readOnCallPassOnResult,
} from "../../../Types/OnCallDutyPolicy/OnCallPagePassOn";
import OnCallDutyExecutionLogTimelineStatus from "../../../Types/OnCallDutyPolicy/OnCalDutyExecutionLogTimelineStatus";
import UserNotificationExecutionStatus from "../../../Types/UserNotification/UserNotificationExecutionStatus";
import UserNotificationStatus from "../../../Types/UserNotification/UserNotificationStatus";
import { describe, expect, test } from "@jest/globals";

/*
 * THE WORDS OF "CAN'T TAKE IT? ESCALATE."
 *
 * One module holds what the email, the text, the call, the chat messages,
 * the pages a message's links open and the API say about escalating a page.
 * These pin those words: the name of the action - Escalate, which replaced
 * "Pass it on" (task escalate-incident-copy) - the maintainer's sentence
 * for what it does ("This will immediately page Platform leads (Level 2 of
 * 3), without waiting."), the sentence for every other way escalating can
 * come out, before (a preview) and after, and the readers that still
 * understand what runs wrote before the rename.
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

// Every outcome, before and after, with a named, a default-named and no rule.
function everyResult(): Array<OnCallPassOnResult> {
  const rules: Array<OnCallPassOnRule | undefined> = [
    { order: 2, name: "Platform leads" },
    { order: 2, name: "Level 2" },
    { order: 2 },
    undefined,
  ];
  const results: Array<OnCallPassOnResult> = [];

  for (const outcome of Object.values(OnCallPassOnOutcome)) {
    for (const isPreview of [true, false]) {
      for (const rule of rules) {
        results.push(
          result({
            outcome,
            isPreview,
            rule,
            nextRule: rule,
            pagedNames: isPreview ? [] : ["Sam Lee"],
            stillPagedNames: ["Bob Smith"],
            nextStepAt: new Date("2026-10-16T03:30:00.000Z"),
          }),
        );
      }
    }
  }

  return results;
}

describe("the action's name", () => {
  test("is Escalate, after Can't take it? where there is room", () => {
    expect(ESCALATE).toBe("Escalate");
    expect(CANT_TAKE_IT).toBe("Can't take it?");
    expect(CANT_TAKE_IT_ESCALATE).toBe("Can't take it? Escalate");
  });

  test("never the old words, and never NACK - the customer's word, not the person's", () => {
    for (const words of [ESCALATE, CANT_TAKE_IT_ESCALATE]) {
      expect(words.toLowerCase()).not.toContain("nack");
      expect(words.toLowerCase()).not.toContain("pass");
    }
  });

  test("a call asks for the second key, after the first acknowledges", () => {
    expect(ON_CALL_PAGE_CALL_PASS_ON_DIGIT).toBe("2");
    expect(getOnCallPageCallPassOnPrompt()).toBe(
      "If you can't take it, press 2 to escalate.",
    );
  });
});

describe("the one line that the person is not paged again", () => {
  test("names what the page is about, as the maintainer's dialog does", () => {
    expect(getOnCallPageNotPagedAgainSentence("incident")).toBe(
      "You will not be paged again for this incident.",
    );
    expect(getOnCallPageNotPagedAgainSentence("alert")).toBe(
      "You will not be paged again for this alert.",
    );
  });

  test("takes a record type's name as a server page writes it", () => {
    // "Alert Episode" on the pages a message's links open.
    expect(getOnCallPageNotPagedAgainSentence("Alert Episode")).toBe(
      "You will not be paged again for this alert episode.",
    );
    expect(getOnCallPageNotPagedAgainSentence("  Incident Episode ")).toBe(
      "You will not be paged again for this incident episode.",
    );
  });

  test("each record kind's noun reads in it", () => {
    for (const recordType of Object.values(OnCallPageRecordType)) {
      expect(
        getOnCallPageNotPagedAgainSentence(getOnCallPageRecordNoun(recordType)),
      ).toBe(
        `You will not be paged again for this ${getOnCallPageRecordNoun(recordType)}.`,
      );
    }
  });

  test("without a record, it is 'for it'", () => {
    expect(getOnCallPageNotPagedAgainSentence()).toBe(
      "You will not be paged again for it.",
    );
    expect(getOnCallPageNotPagedAgainSentence("   ")).toBe(
      "You will not be paged again for it.",
    );
  });
});

describe("what is stored, and what people read", () => {
  test("the status value stays Passed On on all three lists - the API and saved filters use it", () => {
    expect(ON_CALL_PAGE_PASSED_ON_STATUS_VALUE).toBe("Passed On");
    expect(OnCallDutyExecutionLogTimelineStatus.PassedOn).toBe("Passed On");
    expect(UserNotificationExecutionStatus.PassedOn).toBe("Passed On");
    expect(UserNotificationStatus.PassedOn).toBe("Passed On");
  });

  test("people read it as Escalated, and every other status as it is", () => {
    expect(ON_CALL_PAGE_ESCALATED_STATUS_LABEL).toBe("Escalated");
    expect(getOnCallPageStatusLabel("Passed On")).toBe("Escalated");

    for (const status of [
      ...Object.values(OnCallDutyExecutionLogTimelineStatus),
      ...Object.values(UserNotificationExecutionStatus),
      ...Object.values(UserNotificationStatus),
    ]) {
      expect(getOnCallPageStatusLabel(status)).toBe(
        status === "Passed On" ? "Escalated" : status,
      );
    }
  });

  test("the messages new pages are given say escalated", () => {
    expect(ON_CALL_PAGE_PASSED_ON_STATUS_MESSAGE).toBe(
      "Escalated: could not take this page.",
    );
    expect(ON_CALL_PAGE_PASSED_ON_SKIP_TIMELINE_MESSAGE).toBe(
      "Skipped because they escalated this page.",
    );
    expect(ON_CALL_PAGE_PASSED_ON_DELIVERY_MESSAGE).toBe(
      "Escalated from this notification.",
    );
  });

  test("a page's message is read back in today's words and in those written before the rename", () => {
    expect(
      isOnCallPagePassedOnStatusMessage(ON_CALL_PAGE_PASSED_ON_STATUS_MESSAGE),
    ).toBe(true);
    expect(
      isOnCallPagePassedOnStatusMessage(
        LEGACY_ON_CALL_PAGE_PASSED_ON_STATUS_MESSAGE,
      ),
    ).toBe(true);
    expect(LEGACY_ON_CALL_PAGE_PASSED_ON_STATUS_MESSAGE).toBe(
      "Passed on: could not take this page.",
    );
    // Stored with stray spaces around it, it is still the same message.
    expect(
      isOnCallPagePassedOnStatusMessage(
        ` ${ON_CALL_PAGE_PASSED_ON_STATUS_MESSAGE} `,
      ),
    ).toBe(true);
  });

  test("a skipped line is read back in either words too", () => {
    expect(
      isOnCallPagePassedOnSkipTimelineMessage(
        ON_CALL_PAGE_PASSED_ON_SKIP_TIMELINE_MESSAGE,
      ),
    ).toBe(true);
    expect(
      isOnCallPagePassedOnSkipTimelineMessage(
        LEGACY_ON_CALL_PAGE_PASSED_ON_SKIP_TIMELINE_MESSAGE,
      ),
    ).toBe(true);
    expect(LEGACY_ON_CALL_PAGE_PASSED_ON_SKIP_TIMELINE_MESSAGE).toBe(
      "Skipped because they passed this page on.",
    );
  });

  test("nothing else is mistaken for them", () => {
    for (const message of [
      undefined,
      null,
      "",
      "Notification sent by SMS.",
      "Escalated",
      "Skipped because they are away.",
      ON_CALL_PAGE_PASSED_ON_DELIVERY_MESSAGE,
    ]) {
      expect(isOnCallPagePassedOnStatusMessage(message)).toBe(false);
      expect(isOnCallPagePassedOnSkipTimelineMessage(message)).toBe(false);
    }

    // Each reader knows its own message only.
    expect(
      isOnCallPagePassedOnStatusMessage(
        ON_CALL_PAGE_PASSED_ON_SKIP_TIMELINE_MESSAGE,
      ),
    ).toBe(false);
    expect(
      isOnCallPagePassedOnSkipTimelineMessage(
        ON_CALL_PAGE_PASSED_ON_STATUS_MESSAGE,
      ),
    ).toBe(false);
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
    // The route keeps the action's first name: the app and links use it.
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

describe("names and levels in a sentence", () => {
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

  test("a level by its name, then its place: the maintainer's 'Next_level_name (Level 2 of 3)'", () => {
    expect(
      getOnCallPassOnLevelLabel({ order: 2, name: "Platform leads" }, 3),
    ).toBe("Platform leads (Level 2 of 3)");
    // The rule of the maintainer's screenshot, named in lower case.
    expect(getOnCallPassOnLevelLabel({ order: 2, name: "second" }, 3)).toBe(
      "second (Level 2 of 3)",
    );
    expect(getOnCallPassOnLevelLabel({ order: 1, name: " Triage " }, 1)).toBe(
      "Triage (Level 1 of 1)",
    );
  });

  test("a level without a name of its own is its place alone", () => {
    expect(getOnCallPassOnLevelLabel({ order: 2 }, 3)).toBe("Level 2 of 3");
    expect(getOnCallPassOnLevelLabel({ order: 2, name: "  " }, 3)).toBe(
      "Level 2 of 3",
    );
    // The name its place gives it would say the place twice.
    expect(getOnCallPassOnLevelLabel({ order: 2, name: "Level 2" }, 3)).toBe(
      "Level 2 of 3",
    );
    expect(getOnCallPassOnLevelLabel({ order: 2, name: "level  2" }, 3)).toBe(
      "Level 2 of 3",
    );
  });

  test("a name chosen for a level is kept, even one that names another place", () => {
    // "Level 1" moved to the third level: somebody chose to keep it.
    expect(getOnCallPassOnLevelName({ order: 3, name: "Level 1" })).toBe(
      "Level 1",
    );
    expect(getOnCallPassOnLevelLabel({ order: 3, name: "Level 1" }, 3)).toBe(
      "Level 1 (Level 3 of 3)",
    );
    expect(getOnCallPassOnLevelName({ order: 2, name: "Level 2" })).toBe(
      undefined,
    );
  });

  test("never says fewer levels than the level's own place", () => {
    expect(getOnCallPassOnLevelCount({ order: 4 }, 3)).toBe(4);
    expect(getOnCallPassOnLevelCount({ order: 2 }, 0)).toBe(2);
    expect(getOnCallPassOnLevelCount({ order: 2 })).toBe(2);
    expect(getOnCallPassOnLevelLabel({ order: 4 }, 3)).toBe("Level 4 of 4");
  });
});

describe("what escalating would do (a preview)", () => {
  test("the maintainer's sentence: the next level by its name and place, without waiting", () => {
    expect(
      getOnCallPassOnSentence(
        result({ isPreview: true, rule: { order: 2, name: "Platform leads" } }),
      ),
    ).toBe(
      "This will immediately page Platform leads (Level 2 of 3), without waiting.",
    );
    expect(
      getOnCallPassOnSentence(
        result({ isPreview: true, rule: { order: 2, name: "second" } }),
      ),
    ).toBe(
      "This will immediately page second (Level 2 of 3), without waiting.",
    );
  });

  test("a next level with no name of its own is its place", () => {
    for (const name of [undefined, "", "Level 2"]) {
      expect(
        getOnCallPassOnSentence(
          result({ isPreview: true, rule: { order: 2, name: name } }),
        ),
      ).toBe("This will immediately page Level 2 of 3, without waiting.");
    }
  });

  test("a next level it cannot read is 'the next level'", () => {
    expect(getOnCallPassOnSentence(result({ isPreview: true }))).toBe(
      "This will immediately page the next level, without waiting.",
    );
    // A rule whose place is not known is no rule, as on the Dashboard.
    expect(
      getOnCallPassOnSentence(
        result({ isPreview: true, rule: { order: 0, name: "Leads" } }),
      ),
    ).toBe("This will immediately page the next level, without waiting.");
  });

  test("the last level, with Repeat Policy on: the first level again", () => {
    expect(
      getOnCallPassOnSentence(
        result({
          outcome: OnCallPassOnOutcome.PolicyStartedAgain,
          isPreview: true,
          rule: { order: 1, name: "First responders" },
        }),
      ),
    ).toBe(
      "There is no level after yours, so this will immediately page First responders (Level 1 of 3) again, without waiting.",
    );
    expect(
      getOnCallPassOnSentence(
        result({
          outcome: OnCallPassOnOutcome.PolicyStartedAgain,
          isPreview: true,
          rule: { order: 1, name: "Level 1" },
        }),
      ),
    ).toBe(
      "There is no level after yours, so this will immediately page Level 1 of 3 again, without waiting.",
    );
    expect(
      getOnCallPassOnSentence(
        result({
          outcome: OnCallPassOnOutcome.PolicyStartedAgain,
          isPreview: true,
        }),
      ),
    ).toBe(
      "There is no level after yours, so this will immediately page the first level again, without waiting.",
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

describe("what escalating did", () => {
  test("the level now paging, and who", () => {
    expect(
      getOnCallPassOnSentence(
        result({
          rule: { order: 2, name: "Platform leads" },
          pagedNames: ["Sam Lee", "Kim Ito"],
        }),
      ),
    ).toBe(
      "The policy is now paging Platform leads (Level 2 of 3): Sam Lee and Kim Ito.",
    );
    expect(
      getOnCallPassOnSentence(
        result({
          rule: { order: 2, name: "Level 2" },
          pagedNames: ["Sam Lee"],
        }),
      ),
    ).toBe("The policy is now paging Level 2 of 3: Sam Lee.");
  });

  test("the level now paging, when it reached nobody yet", () => {
    expect(
      getOnCallPassOnSentence(
        result({ rule: { order: 2, name: "Platform leads" } }),
      ),
    ).toBe("The policy is now paging Platform leads (Level 2 of 3).");
    expect(getOnCallPassOnSentence(result({ rule: { order: 3 } }))).toBe(
      "The policy is now paging Level 3 of 3.",
    );
  });

  test("a level it does not know the place of is the next one", () => {
    expect(getOnCallPassOnSentence(result({ pagedNames: ["Sam"] }))).toBe(
      "The policy is now paging the next level.",
    );
  });

  test("the policy started over, on its first level", () => {
    expect(
      getOnCallPassOnSentence(
        result({
          outcome: OnCallPassOnOutcome.PolicyStartedAgain,
          rule: { order: 1, name: "First responders" },
          pagedNames: ["Bob Smith"],
        }),
      ),
    ).toBe(
      "There was no level after yours, so the policy started over and is paging First responders (Level 1 of 3) again.",
    );
    expect(
      getOnCallPassOnSentence(
        result({ outcome: OnCallPassOnOutcome.PolicyStartedAgain }),
      ),
    ).toBe(
      "There was no level after yours, so the policy started over and is paging the first level again.",
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
      "The policy has moved on already and is paging Managers (Level 3 of 3) now.",
    );
    expect(
      getOnCallPassOnSentence(
        result({
          outcome: OnCallPassOnOutcome.AlreadyEscalated,
          rule: { order: 3, name: "Level 3" },
        }),
      ),
    ).toBe("The policy has moved on already and is paging Level 3 of 3 now.");
    expect(
      getOnCallPassOnSentence(
        result({ outcome: OnCallPassOnOutcome.AlreadyEscalated }),
      ),
    ).toBe("The policy has moved on already and is paging a later level now.");
  });
});

describe("somebody else still paged", () => {
  const AT: Date = new Date("2026-10-16T03:30:00.000Z");
  // Half an hour before: the level's wait is running.
  const NOW: Date = new Date("2026-10-16T03:00:00.000Z");

  test("one person, and when the next level comes, in the reader's own zone", () => {
    expect(
      getOnCallPassOnSentence(
        result({
          outcome: OnCallPassOnOutcome.OthersStillPaged,
          stillPagedNames: ["Bob Smith"],
          nextStepAt: AT,
          nextRule: { order: 2, name: "Platform leads" },
        }),
        { timezone: "America/New_York", now: NOW },
      ),
    ).toBe(
      "Bob Smith is still being paged. If nobody acknowledges by 11:30 PM EDT, the policy pages Platform leads (Level 2 of 3) next.",
    );
  });

  test("a next level with no name of its own is its place", () => {
    expect(
      getOnCallPassOnSentence(
        result({
          outcome: OnCallPassOnOutcome.OthersStillPaged,
          stillPagedNames: ["Bob Smith"],
          nextStepAt: AT,
          nextRule: { order: 2, name: "Level 2" },
        }),
        { timezone: "UTC", now: NOW },
      ),
    ).toBe(
      "Bob Smith is still being paged. If nobody acknowledges by 3:30 AM UTC, the policy pages Level 2 of 3 next.",
    );
  });

  test("several people, with no next level known", () => {
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
    // 11 PM in New York: the next level comes after midnight there.
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
      "Bob Smith is still being paged. If nobody acknowledges by Oct 16, 2026, 12:30 AM EDT, the policy pages Level 2 of 3 next.",
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

  test("a direct page has no level to wait for", () => {
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

/*
 * A sentence drawn on a page or a phone - the confirm page, the page after
 * it, the mobile app - keeps a level's place and a time each on one line: a
 * phone broke the maintainer's own example as "Platform leads (Level 2 of"
 * / "3), without waiting." A call reads the sentence out, with plain
 * spaces.
 */
describe("a sentence drawn on a screen keeps its short phrases on one line", () => {
  const AT: Date = new Date("2026-10-16T03:30:00.000Z");
  const NOW: Date = new Date("2026-10-16T03:00:00.000Z");
  const NBSP: string = ON_CALL_PASS_ON_NO_BREAK_SPACE;

  // A phrase as a screen draws it: no line breaks inside it.
  const kept: (phrase: string) => string = (phrase: string): string => {
    return phrase.split(" ").join(NBSP);
  };

  test("the space is U+00A0, a space no line breaks at", () => {
    expect(NBSP).toBe(String.fromCharCode(0xa0));
    expect(NBSP).not.toBe(" ");
  });

  test("a level's place stays on one line; its name, somebody's text, does not have to", () => {
    expect(
      getOnCallPassOnLevelLabel({ order: 2, name: "Platform leads" }, 3, true),
    ).toBe(`Platform leads (${kept("Level 2 of 3")})`);
    expect(getOnCallPassOnLevelLabel({ order: 2 }, 3, true)).toBe(
      kept("Level 2 of 3"),
    );
    expect(
      getOnCallPassOnLevelLabel({ order: 2, name: "Level 2" }, 3, true),
    ).toBe(kept("Level 2 of 3"));
  });

  test("the maintainer's sentence, as the confirm page draws it", () => {
    expect(
      getOnCallPassOnSentence(
        result({
          isPreview: true,
          rule: { order: 2, name: "Platform leads" },
        }),
        { keepTogether: true },
      ),
    ).toBe(
      `This will immediately page Platform leads (${kept("Level 2 of 3")}), without waiting.`,
    );
  });

  test("a time stays on one line too, the next level's place with it", () => {
    expect(
      getOnCallPassOnSentence(
        result({
          outcome: OnCallPassOnOutcome.OthersStillPaged,
          stillPagedNames: ["Bob Smith"],
          nextStepAt: AT,
          nextRule: { order: 3, name: "Managers" },
        }),
        { timezone: "UTC", now: NOW, keepTogether: true },
      ),
    ).toBe(
      `Bob Smith is still being paged. If nobody acknowledges by ${kept("3:30 AM UTC")}, the policy pages Managers (${kept("Level 3 of 3")}) next.`,
    );

    // A time on another day keeps its date, on one line with it.
    expect(
      getOnCallPassOnSentence(
        result({
          outcome: OnCallPassOnOutcome.OthersStillPaged,
          stillPagedNames: ["Bob"],
          nextStepAt: AT,
        }),
        {
          timezone: "UTC",
          now: new Date("2026-10-15T21:00:00.000Z"),
          keepTogether: true,
        },
      ),
    ).toBe(
      `Bob is still being paged. If nobody acknowledges by ${kept("Oct 16, 2026, 3:30 AM UTC")}, the policy moves on.`,
    );
  });

  test("whatever came of it, only the place and the time are joined - every word else breaks as it did", () => {
    for (const each of everyResult()) {
      const wording: { timezone: string; now: Date } = {
        timezone: "UTC",
        now: NOW,
      };
      const drawn: string = getOnCallPassOnSentence(each, {
        ...wording,
        keepTogether: true,
      });
      const plain: string = getOnCallPassOnSentence(each, wording);

      // The same words: only some of the spaces differ.
      expect(drawn.split(NBSP).join(" ")).toBe(plain);
      // Read out - a call - the sentence has plain spaces only.
      expect(plain).not.toContain(NBSP);

      // Every joined space is inside "Level 2 of 3" or the time.
      const rest: string = [kept("Level 2 of 3"), kept("3:30 AM UTC")].reduce(
        (text: string, phrase: string): string => {
          return text.split(phrase).join("");
        },
        drawn,
      );

      expect(rest).not.toContain(NBSP);
    }
  });
});

describe("every sentence, whatever came of it", () => {
  test("starts with a capital: a level's name - text somebody typed - never opens it", () => {
    for (const each of everyResult()) {
      const sentence: string = getOnCallPassOnSentence(
        {
          ...each,
          rule: each.rule ? { ...each.rule, name: "second" } : each.rule,
        },
        { timezone: "UTC", now: new Date("2026-10-16T03:00:00.000Z") },
      );

      expect({ outcome: each.outcome, first: sentence[0] }).toEqual({
        outcome: each.outcome,
        first: sentence[0]!.toUpperCase(),
      });
    }
  });

  test("ends with a full stop, and never says the old words", () => {
    for (const each of everyResult()) {
      const sentence: string = getOnCallPassOnSentence(each, {
        timezone: "UTC",
        now: new Date("2026-10-16T03:00:00.000Z"),
      });

      expect(sentence.endsWith(".")).toBe(true);
      expect(sentence.toLowerCase()).not.toContain("pass");
      // "escalation rule 2 of 3" was the old way to name a level.
      expect(sentence).not.toContain("escalation rule");
      expect(sentence).not.toContain("Escalation rule");
    }
  });

  test("never names the product: a licence may rename it", () => {
    for (const each of everyResult()) {
      expect(getOnCallPassOnSentence(each)).not.toContain("OneUptime");
    }
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

describe("escalating that leaves nobody being paged", () => {
  test("is the one outcome said as a warning", () => {
    for (const outcome of Object.values(OnCallPassOnOutcome)) {
      expect(isOnCallPassOnPagingStopped(result({ outcome: outcome }))).toBe(
        outcome === OnCallPassOnOutcome.PagingStopped,
      );
    }
  });
});

describe("why it could not be escalated", () => {
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
      "Incident INC-42 was already acknowledged by Bob Smith, so there is nothing to escalate.",
    );
    expect(
      getOnCallPassOnRefusalSentence(
        { passedOn: false, refusal: OnCallPassOnRefusal.RecordAcknowledged },
        { recordLabel: "Alert #12" },
      ),
    ).toBe(
      "Alert #12 is already acknowledged, so there is nothing to escalate.",
    );
    expect(
      getOnCallPassOnRefusalSentence({
        passedOn: false,
        refusal: OnCallPassOnRefusal.RecordAcknowledged,
      }),
    ).toBe("It is already acknowledged, so there is nothing to escalate.");
  });

  test("escalated already, over, not paged, a link that cannot", () => {
    expect(
      getOnCallPassOnRefusalSentence({
        passedOn: false,
        refusal: OnCallPassOnRefusal.AlreadyPassedOn,
      }),
    ).toBe("You escalated it already, so you will not be paged again for it.");
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
      "This link cannot escalate the page: it is not valid, or it has expired. Use the link in the newest message you were paged with.",
    );
  });

  test("never names the product, and never the old words", () => {
    for (const refusal of Object.values(OnCallPassOnRefusal)) {
      const sentence: string = getOnCallPassOnRefusalSentence({
        passedOn: false,
        refusal: refusal,
        acknowledgedByName: "Ana Lopez",
      });

      expect(sentence).not.toContain("OneUptime");
      expect(sentence.toLowerCase()).not.toContain("pass");
    }
  });
});

describe("the headings over what came of it", () => {
  test("a refusal says why in a few words, never the button's own word", () => {
    expect(ON_CALL_PAGE_ALREADY_ACKNOWLEDGED_TITLE).toBe(
      "Already acknowledged",
    );
    expect(ON_CALL_PAGE_ALREADY_ESCALATED_TITLE).toBe("Already escalated");
    expect(ON_CALL_PAGE_NOTHING_TO_ESCALATE_TITLE).toBe("Nothing to escalate");

    for (const title of [
      ON_CALL_PAGE_ALREADY_ACKNOWLEDGED_TITLE,
      ON_CALL_PAGE_ALREADY_ESCALATED_TITLE,
      ON_CALL_PAGE_NOTHING_TO_ESCALATE_TITLE,
    ]) {
      expect(title).not.toBe(ESCALATE);
    }
  });

  test("once done, what was escalated, by its kind", () => {
    expect(getOnCallPageEscalatedTitle("Incident")).toBe("Incident escalated");
    expect(getOnCallPageEscalatedTitle("Alert Episode")).toBe(
      "Alert Episode escalated",
    );
    expect(getOnCallPageEscalatedTitle("  ")).toBe("Escalated");
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
