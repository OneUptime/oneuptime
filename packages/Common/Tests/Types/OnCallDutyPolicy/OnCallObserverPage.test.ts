import { describe, expect, test } from "@jest/globals";
import OnCallPageAs from "../../../Types/OnCallDutyPolicy/OnCallPageAs";
import {
  ON_CALL_OBSERVERS_NEED_A_RECORD_MESSAGE,
  ON_CALL_OBSERVER_PAGE_ACKNOWLEDGE_LABEL,
  ON_CALL_OBSERVER_PAGE_CALL_ANSWERED,
  ON_CALL_OBSERVER_PAGE_LABEL,
  ON_CALL_OBSERVER_PAGE_SMS_ACTION,
  ON_CALL_OBSERVER_PAGE_SMS_LEAD,
  OnCallObserverPageRecordKind,
  getOnCallObserverPageCallPrompt,
  getOnCallObserverPageCallSentence,
  getOnCallObserverPageEmailSubject,
  getOnCallObserverPageEmailWhy,
  getOnCallObserverPageLead,
  getOnCallObserverPageNotice,
  getOnCallObserverPagePushBody,
  getOnCallObserverPagePushTitle,
  getOnCallObserverPageSeenMessage,
  getOnCallObserverPageSpokenNotice,
  isOnCallObserverPage,
  isPageAsObservers,
  toOnCallPageAs,
} from "../../../Types/OnCallDutyPolicy/OnCallObserverPage";
import { OnCallPersonPageNotice } from "../../../Types/OnCallDutyPolicy/OnCallPersonPage";

/*
 * AN OBSERVER'S PAGE keeps people informed while somebody else responds:
 * answering it says they have seen it, and acknowledges nothing else. These
 * are the rule and the words every part of OneUptime reads it by.
 */

const KINDS: Array<OnCallObserverPageRecordKind> = [
  "incident",
  "alert",
  "incident episode",
  "alert episode",
];

describe("isOnCallObserverPage: which runs page as observers", () => {
  test.each([
    ["a run that pages as observers", { isObserverPage: true }, true],
    ["a run that pages responders", { isObserverPage: false }, false],
    [
      "a run from before observers existed (the column read empty)",
      { isObserverPage: null },
      false,
    ],
    ["a run read without the column", {}, false],
    ["no run at all", null, false],
    ["no run, undefined", undefined, false],
  ])("%s: %p", (_name: string, run: unknown, expected: boolean) => {
    expect(
      isOnCallObserverPage(run as Parameters<typeof isOnCallObserverPage>[0]),
    ).toBe(expected);
  });
});

describe("toOnCallPageAs: what a rule, a step or a form said, read as one of the two", () => {
  test.each([
    [OnCallPageAs.Observers, OnCallPageAs.Observers],
    [OnCallPageAs.Responders, OnCallPageAs.Responders],
    ["observers", OnCallPageAs.Observers],
    ["  OBSERVERS  ", OnCallPageAs.Observers],
    // Written by hand in a workflow or the API.
    ["Observer", OnCallPageAs.Observers],
    ["observer", OnCallPageAs.Observers],
    ["responders", OnCallPageAs.Responders],
    ["Responder", OnCallPageAs.Responders],
  ])("%p -> %p", (value: string, expected: OnCallPageAs) => {
    expect(toOnCallPageAs(value)).toBe(expected);
  });

  test.each([
    ["nothing", undefined],
    ["null", null],
    ["an empty text", ""],
    ["a word that is neither", "watchers"],
    ["a number", 1],
    ["true", true],
    ["an object", { pageAs: "Observers" }],
    ["a list", ["Observers"]],
  ])(
    "%s is Responders, as every page was before",
    (_name: string, value: unknown) => {
      expect(toOnCallPageAs(value)).toBe(OnCallPageAs.Responders);
      expect(isPageAsObservers(value)).toBe(false);
    },
  );

  test("isPageAsObservers agrees with toOnCallPageAs", () => {
    expect(isPageAsObservers("Observers")).toBe(true);
    expect(isPageAsObservers("Responders")).toBe(false);
  });
});

describe("the words of an observer's page", () => {
  test.each(KINDS)(
    "the notice about the %s says they are an observer and what answering does - and does not do",
    (kind: OnCallObserverPageRecordKind) => {
      const notice: string = getOnCallObserverPageNotice(kind);

      expect(notice).toContain("observer");
      expect(notice).toContain("keep you informed");
      expect(notice).toContain(`stay on this ${kind}`);
      expect(notice).toContain("only says you've seen it");
      expect(notice).toContain(`does not acknowledge the ${kind}`);
    },
  );

  test.each(KINDS)(
    "a call about the %s says it in words read aloud: who stays on it, then what 1 does",
    (kind: OnCallObserverPageRecordKind) => {
      const spoken: string = getOnCallObserverPageSpokenNotice(kind);
      const prompt: string = getOnCallObserverPageCallPrompt(kind);

      expect(spoken).toBe(
        `You are kept informed: the people responding stay on this ${kind}.`,
      );
      expect(prompt).toBe(
        `To say you have heard this, press 1. This does not acknowledge the ${kind}.`,
      );

      // A voice reads them: no contractions that sound odd, no symbols.
      for (const said of [
        spoken,
        prompt,
        ON_CALL_OBSERVER_PAGE_CALL_ANSWERED,
      ]) {
        expect(said).not.toMatch(/[’'"“”()]/);
      }
    },
  );

  test("a call opens by saying it pages an observer, with who paged them for a person's page", () => {
    expect(getOnCallObserverPageCallSentence({ recordNoun: "incident" })).toBe(
      "You are paged as an observer about an incident",
    );

    const personPage: OnCallPersonPageNotice = { pagedByName: "Alice Kim" };

    expect(
      getOnCallObserverPageCallSentence({
        recordNoun: "alert",
        personPage: personPage,
      }),
    ).toBe("Alice Kim paged you about an alert, as an observer");
  });

  test("the run's status once an observer answers names them and what it did not do", () => {
    expect(
      getOnCallObserverPageSeenMessage({
        kind: "incident",
        userName: "Ana Lopez",
        userEmail: "ana@example.com",
      }),
    ).toBe(
      "Seen by Ana Lopez (ana@example.com), paged as an observer. The incident is not acknowledged by this.",
    );
  });

  test.each([
    [
      "a name only",
      { userName: "Ana Lopez", userEmail: "" },
      "Seen by Ana Lopez,",
    ],
    [
      "an email only",
      { userName: "", userEmail: "ana@example.com" },
      "Seen by ana@example.com,",
    ],
    [
      "white space only",
      { userName: "  ", userEmail: " " },
      "Seen by somebody,",
    ],
  ])(
    "with %s it still reads",
    (
      _name: string,
      who: { userName: string; userEmail: string },
      start: string,
    ) => {
      const message: string = getOnCallObserverPageSeenMessage({
        kind: "alert",
        ...who,
      });

      expect(message.startsWith(start)).toBe(true);
      expect(message).toContain("The alert is not acknowledged by this.");
    },
  );

  test("the Dashboard's line under a run's status", () => {
    expect(ON_CALL_OBSERVER_PAGE_LABEL).toBe("Paged as observers");
  });

  test.each([
    ["no person's page", undefined, "You're paged as an observer"],
    [
      "a person's page by name",
      { pagedByName: "Alice Kim" },
      "Alice Kim paged you as an observer",
    ],
    [
      "a person's page to a team: observers, plural",
      { pagedByName: "Alice Kim", teamName: "Oversight" },
      "Alice Kim paged Oversight as observers",
    ],
    [
      "a person's page through a schedule",
      { pagedByName: "Alice Kim", scheduleName: "Primary" },
      "Alice Kim paged whoever is on call in Primary as an observer",
    ],
  ])(
    "the lead of %s",
    (
      _name: string,
      personPage: OnCallPersonPageNotice | undefined,
      expected: string,
    ) => {
      expect(getOnCallObserverPageLead(personPage)).toBe(expected);
    },
  );

  test("an email's subject asks nothing of them: FYI, never ACTION REQUIRED", () => {
    const subject: string = getOnCallObserverPageEmailSubject({
      recordLabel: "Incident INC-42",
      recordTitle: "Mesh network down",
    });

    expect(subject).toBe("FYI (observer): Incident INC-42 - Mesh network down");
    expect(subject).not.toContain("ACTION REQUIRED");

    expect(
      getOnCallObserverPageEmailSubject({
        recordLabel: " Incident INC-42 ",
        recordTitle: " Mesh network down ",
        personPage: { pagedByName: "Alice Kim", teamName: "Oversight" },
      }),
    ).toBe(
      "FYI (observer): Alice Kim paged Oversight about Incident INC-42 - Mesh network down",
    );
  });

  test.each(KINDS)(
    "an email says why it came: they are paged as an observer of the %s",
    (kind: OnCallObserverPageRecordKind) => {
      expect(getOnCallObserverPageEmailWhy(kind)).toContain(
        `paged as an observer: to keep you informed about this ${kind}`,
      );
    },
  );

  test("a push opens with FYI and says who stays on it, and where", () => {
    expect(
      getOnCallObserverPagePushTitle({
        recordLabel: "Incident INC-42",
        recordTitle: "Mesh network down",
      }),
    ).toBe("FYI: Incident INC-42: Mesh network down");

    expect(
      getOnCallObserverPagePushBody({
        kind: "incident",
        projectName: "Acme",
      }),
    ).toBe(
      "You're paged as an observer, in Acme: the people responding stay on this incident. Tap to view.",
    );

    // No project to name: no ", in".
    expect(
      getOnCallObserverPagePushBody({
        kind: "alert",
        projectName: "  ",
        personPage: { pagedByName: "Alice Kim" },
      }),
    ).toBe(
      "Alice Kim paged you as an observer: the people responding stay on this alert. Tap to view.",
    );
  });

  test("the words a text, a link and a call close with", () => {
    expect(ON_CALL_OBSERVER_PAGE_SMS_ACTION).toBe("Mark seen:");
    expect(ON_CALL_OBSERVER_PAGE_SMS_LEAD).toBe("FYI (observer)");
    expect(ON_CALL_OBSERVER_PAGE_ACKNOWLEDGE_LABEL).toBe("I've seen it");
    expect(ON_CALL_OBSERVER_PAGE_CALL_ANSWERED).toContain("Good bye");
  });

  test("a page as observers about something new is refused, and says what to do instead", () => {
    expect(ON_CALL_OBSERVERS_NEED_A_RECORD_MESSAGE).toContain("already there");
    expect(ON_CALL_OBSERVERS_NEED_A_RECORD_MESSAGE).toContain(
      "page responders",
    );
  });
});
