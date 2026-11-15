import { describe, expect, test } from "@jest/globals";
import {
  OnCallPersonPageNotice,
  getOnCallPersonPageCallMessage,
  getOnCallPersonPageCallSentence,
  getOnCallPersonPageEmailLine,
  getOnCallPersonPageEmailMessageLine,
  getOnCallPersonPageEmailSubject,
  getOnCallPersonPageLead,
  getOnCallPersonPagePushBody,
  getOnCallPersonPagePushTitle,
  getOnCallPersonPageQuotedMessage,
  getOnCallPersonPageWhyLine,
  isOnCallPolicyStartedByHandNotice,
} from "../../../Types/OnCallDutyPolicy/OnCallPersonPage";
import {
  getOnCallPageSmsWords,
  OnCallPageKind,
} from "../../../Types/OnCallDutyPolicy/OnCallPageWords";
import {
  buildOnCallPageSms,
  OnCallPageSmsKind,
} from "../../../Utils/Sms/OnCallPageSms";
import { TRANSLATED_LANGUAGES } from "../../../Scripts/I18n/ServerLocales";
import { getServerTranslator } from "../../../Server/Utils/ServerTranslation";
import { Translator } from "../../../Types/Translator";

/*
 * WHAT A POLICY A PERSON STARTED BY HAND SAYS (#7838).
 *
 * Execute On-Call Policy - in the Dashboard, Slack, Microsoft Teams or
 * Mattermost - or a page from Slack or Microsoft Teams that names a policy
 * starts an on-call policy for a record that is mostly hours old and
 * acknowledged by somebody already. Its notifications told the people it
 * paged "A new incident has been created", "New incident assigned to you",
 * at every level and every repeat, from nobody, and the message a page
 * that names a policy carries reached none of them.
 *
 * Its notice names the policy and the level that pages this person, and
 * each sentence says who started which policy, why this person, and the
 * message - never that the person "paged you by name", which a policy's
 * level does, not them.
 */

const BY_LEVEL: OnCallPersonPageNotice = {
  pagedByName: "Alice Kim",
  policyName: "Database escalation",
  policyLevel: 1,
};
const AS_TEAM: OnCallPersonPageNotice = {
  pagedByName: "Alice Kim",
  teamName: "Platform",
  policyName: "Database escalation",
  policyLevel: 2,
  message: "Can you check the database?",
};
const AS_SCHEDULE: OnCallPersonPageNotice = {
  pagedByName: "Alice Kim",
  scheduleName: "Primary",
  policyName: "Database escalation",
  policyLevel: 3,
};
const NO_LEVEL: OnCallPersonPageNotice = {
  pagedByName: "Alice Kim",
  policyName: "Database escalation",
};

describe("isOnCallPolicyStartedByHandNotice: a notice that names a policy", () => {
  test.each([
    ["a policy started by hand", BY_LEVEL, true],
    [
      "one whose name is only white space",
      { ...BY_LEVEL, policyName: "  " },
      false,
    ],
    [
      "a person's page",
      { pagedByName: "Alice Kim", teamName: "Platform" },
      false,
    ],
    ["no notice", undefined, false],
    ["a null notice", null, false],
  ])("%s: %p", (_name: string, notice: unknown, expected: boolean) => {
    expect(
      isOnCallPolicyStartedByHandNotice(
        notice as OnCallPersonPageNotice | null | undefined,
      ),
    ).toBe(expected);
  });
});

describe("the words of a policy started by hand, in English", () => {
  test("the lead says who started which policy, whoever it pages", () => {
    for (const notice of [BY_LEVEL, AS_TEAM, AS_SCHEDULE, NO_LEVEL]) {
      expect(getOnCallPersonPageLead(notice)).toBe(
        "Alice Kim started Database escalation",
      );
    }
  });

  test("somebody with no name is somebody", () => {
    expect(getOnCallPersonPageLead({ ...BY_LEVEL, pagedByName: " " })).toBe(
      "Someone started Database escalation",
    );
  });

  test("why: the level that pages this person - through a team, a schedule, or by name on the level", () => {
    expect(getOnCallPersonPageWhyLine(AS_TEAM)).toBe(
      "You're getting this because you're a member of Platform, on level 2 of Database escalation.",
    );
    expect(getOnCallPersonPageWhyLine(AS_SCHEDULE)).toBe(
      "You're getting this because you're on call in Primary, on level 3 of Database escalation.",
    );
    expect(getOnCallPersonPageWhyLine(BY_LEVEL)).toBe(
      "You're getting this because you're on level 1 of Database escalation.",
    );
  });

  test("why, never that the person who started it paged you by name", () => {
    for (const notice of [BY_LEVEL, AS_TEAM, AS_SCHEDULE, NO_LEVEL]) {
      expect(getOnCallPersonPageWhyLine(notice)).not.toContain("by name");
      expect(getOnCallPersonPageWhyLine(notice)).not.toContain("Alice Kim");
    }
  });

  test("why, with no level to name: the policy, the team or the schedule", () => {
    expect(getOnCallPersonPageWhyLine(NO_LEVEL)).toBe(
      "You're getting this because Database escalation pages you.",
    );
    expect(
      getOnCallPersonPageWhyLine({ ...AS_TEAM, policyLevel: undefined }),
    ).toBe("You're getting this because you're a member of Platform.");
    expect(
      getOnCallPersonPageWhyLine({ ...AS_SCHEDULE, policyLevel: undefined }),
    ).toBe("You're getting this because you're on call in Primary.");
  });

  test.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "a level that is no level (%p) is not named",
    (level: number) => {
      expect(
        getOnCallPersonPageWhyLine({ ...BY_LEVEL, policyLevel: level }),
      ).toBe("You're getting this because Database escalation pages you.");
    },
  );

  test("a call says who started which on-call policy for what, then the message as said by them", () => {
    expect(
      getOnCallPersonPageCallSentence({
        recordNoun: "incident",
        notice: AS_TEAM,
      }),
    ).toBe(
      "Alice Kim started the on-call policy Database escalation for an incident",
    );
    expect(
      getOnCallPersonPageCallSentence({
        recordNoun: "alert episode",
        notice: BY_LEVEL,
      }),
    ).toBe(
      "Alice Kim started the on-call policy Database escalation for an alert episode",
    );
    expect(
      getOnCallPersonPageCallSentence({
        recordNoun: "alert",
        notice: { ...BY_LEVEL, pagedByName: "" },
      }),
    ).toBe(
      "Someone started the on-call policy Database escalation for an alert",
    );
    expect(getOnCallPersonPageCallMessage(AS_TEAM)).toBe(
      "Alice Kim says: Can you check the database?",
    );
    expect(getOnCallPersonPageCallMessage(BY_LEVEL)).toBe("");
  });

  test("an email opens with who started which policy for the record, then why this person", () => {
    expect(
      getOnCallPersonPageEmailLine({
        recordNoun: "incident",
        projectName: "Acme",
        recordLabel: " Incident INC-42 ",
        notice: AS_TEAM,
      }),
    ).toBe(
      "Alice Kim started Database escalation for Incident INC-42 in the project Acme. You're getting this because you're a member of Platform, on level 2 of Database escalation.",
    );
    expect(
      getOnCallPersonPageEmailLine({
        recordNoun: "alert episode",
        projectName: " ",
        recordLabel: "Alert Episode AE-3",
        notice: BY_LEVEL,
      }),
    ).toBe(
      "Alice Kim started Database escalation for Alert Episode AE-3. You're getting this because you're on level 1 of Database escalation.",
    );
  });

  test("an email given no record label names the kind of record", () => {
    expect(
      getOnCallPersonPageEmailLine({
        recordNoun: "incident episode",
        projectName: "Acme",
        notice: NO_LEVEL,
      }),
    ).toBe(
      "Alice Kim started Database escalation for incident episode in the project Acme. You're getting this because Database escalation pages you.",
    );
  });

  test("an email's message line and subject", () => {
    expect(getOnCallPersonPageEmailMessageLine(AS_TEAM)).toBe(
      "Alice Kim wrote: “Can you check the database?”",
    );
    expect(getOnCallPersonPageEmailMessageLine(BY_LEVEL)).toBe("");
    expect(
      getOnCallPersonPageEmailSubject({
        recordLabel: "Incident INC-42",
        recordTitle: " Checkout is down ",
        notice: AS_TEAM,
      }),
    ).toBe(
      "ACTION REQUIRED: Alice Kim started Database escalation for Incident INC-42 - Checkout is down",
    );
  });

  test("a push names who started which policy and the record; its body carries the message", () => {
    expect(
      getOnCallPersonPagePushTitle({
        recordLabel: "Incident INC-42",
        notice: AS_TEAM,
      }),
    ).toBe("Alice Kim started Database escalation: Incident INC-42");
    expect(
      getOnCallPersonPagePushBody({
        recordTitle: "Checkout is down",
        projectName: "Acme",
        notice: AS_TEAM,
      }),
    ).toBe("Checkout is down, in Acme. “Can you check the database?”");
    expect(getOnCallPersonPageQuotedMessage(AS_TEAM)).toBe(
      "“Can you check the database?”",
    );
  });

  test("a person's page reads exactly as before: it names no policy", () => {
    const personPage: OnCallPersonPageNotice = {
      pagedByName: "Alice Kim",
      teamName: "Platform",
    };

    expect(getOnCallPersonPageLead(personPage)).toBe(
      "Alice Kim paged Platform",
    );
    expect(getOnCallPersonPageWhyLine({ pagedByName: "Alice Kim" })).toBe(
      "You're getting this because Alice Kim paged you by name.",
    );
    expect(
      getOnCallPersonPageCallSentence({
        recordNoun: "incident",
        notice: personPage,
      }),
    ).toBe("Alice Kim paged Platform about an incident");
    expect(
      getOnCallPersonPageEmailSubject({
        recordLabel: "Incident INC-42",
        recordTitle: "Checkout is down",
        notice: personPage,
      }),
    ).toBe(
      "ACTION REQUIRED: Alice Kim paged Platform about Incident INC-42 - Checkout is down",
    );
    expect(
      getOnCallPersonPageEmailLine({
        recordNoun: "incident",
        projectName: "Acme",
        recordLabel: "Incident INC-42",
        notice: personPage,
      }),
    ).toBe(
      "Alice Kim paged Platform about this incident in the project Acme. You're a member of Platform.",
    );
  });
});

describe("a policy started by hand's text message", () => {
  const link: string = "https://oneuptime.example.com/l/1";

  test("in English: who started which policy, for what, in one part", () => {
    const sms: string = buildOnCallPageSms({
      kind: OnCallPageSmsKind.Incident,
      productName: "OneUptime",
      severityName: "Critical",
      number: "INC-42",
      projectName: "Acme",
      title: "Checkout is down",
      link: link,
      lead: getOnCallPersonPageLead(AS_TEAM),
      isPolicyLead: true,
    }).text;

    expect(sms).toBe(
      `OneUptime: Alice Kim started Database escalation for Critical incident INC-42 in Acme: Checkout is down. Ack or escalate: ${link}`,
    );
    expect(sms.length).toBeLessThanOrEqual(160);
  });

  test("a person's page still says whom they paged about what", () => {
    const sms: string = buildOnCallPageSms({
      kind: OnCallPageSmsKind.Incident,
      productName: "OneUptime",
      severityName: "Critical",
      number: "INC-42",
      projectName: "Acme",
      title: "Checkout is down",
      link: link,
      lead: "Alice Kim paged Platform",
    }).text;

    expect(sms).toContain("Alice Kim paged Platform about Critical incident");
  });

  test("a policy lead with nothing to lead is no lead", () => {
    const sms: string = buildOnCallPageSms({
      kind: OnCallPageSmsKind.Alert,
      productName: "OneUptime",
      severityName: "High",
      number: "ALR-7",
      projectName: "Acme",
      title: "Disk almost full",
      link: link,
      isPolicyLead: true,
    }).text;

    expect(sms).toBe(
      `OneUptime: High alert ALR-7 in Acme: Disk almost full. Ack or escalate: ${link}`,
    );
  });

  test("in another language: the language's own words for it", () => {
    const german: Translator = getServerTranslator("de");

    expect(
      getOnCallPageSmsWords(german).head({
        record: "Vorfall INC-42",
        projectName: "Acme",
        isPageAgain: false,
        lead: getOnCallPersonPageLead(AS_TEAM, german),
        isPolicyLead: true,
      }),
    ).toBe(
      "Alice Kim hat Database escalation gestartet, für Vorfall INC-42 in Acme",
    );
    expect(
      getOnCallPageSmsWords(german).head({
        record: "Vorfall INC-42",
        projectName: "",
        isPageAgain: false,
        lead: getOnCallPersonPageLead(AS_TEAM, german),
        isPolicyLead: true,
      }),
    ).toBe("Alice Kim hat Database escalation gestartet, für Vorfall INC-42");
  });
});

/*
 * Every language a page is written in has the policy's sentences (the
 * server's locale set, OnCallPageWords): each reads in that language, with
 * every value in it, and none of them is the English.
 */
describe.each(
  TRANSLATED_LANGUAGES.map((language: string) => {
    return [language];
  }),
)("a policy started by hand, in %s", (language: string) => {
  const translator: Translator = getServerTranslator(language);

  function sentences(): Array<[string, string, Array<string>]> {
    return [
      [
        getOnCallPersonPageLead(AS_TEAM, translator),
        getOnCallPersonPageLead(AS_TEAM),
        ["Alice Kim", "Database escalation"],
      ],
      [
        getOnCallPersonPageWhyLine(AS_TEAM, translator),
        getOnCallPersonPageWhyLine(AS_TEAM),
        ["Platform", "2", "Database escalation"],
      ],
      [
        getOnCallPersonPageWhyLine(AS_SCHEDULE, translator),
        getOnCallPersonPageWhyLine(AS_SCHEDULE),
        ["Primary", "3", "Database escalation"],
      ],
      [
        getOnCallPersonPageWhyLine(BY_LEVEL, translator),
        getOnCallPersonPageWhyLine(BY_LEVEL),
        ["1", "Database escalation"],
      ],
      [
        getOnCallPersonPageWhyLine(NO_LEVEL, translator),
        getOnCallPersonPageWhyLine(NO_LEVEL),
        ["Database escalation"],
      ],
      [
        getOnCallPersonPageEmailLine({
          recordNoun: OnCallPageKind.Incident,
          projectName: "Acme",
          recordLabel: "INC-42",
          notice: AS_TEAM,
          translator: translator,
        }),
        getOnCallPersonPageEmailLine({
          recordNoun: OnCallPageKind.Incident,
          projectName: "Acme",
          recordLabel: "INC-42",
          notice: AS_TEAM,
        }),
        ["Alice Kim", "Database escalation", "INC-42", "Acme", "Platform"],
      ],
      [
        getOnCallPersonPageEmailLine({
          recordNoun: OnCallPageKind.Alert,
          projectName: "",
          recordLabel: "ALR-7",
          notice: BY_LEVEL,
          translator: translator,
        }),
        getOnCallPersonPageEmailLine({
          recordNoun: OnCallPageKind.Alert,
          projectName: "",
          recordLabel: "ALR-7",
          notice: BY_LEVEL,
        }),
        ["Alice Kim", "Database escalation", "ALR-7"],
      ],
      [
        getOnCallPersonPageEmailSubject({
          recordLabel: "INC-42",
          recordTitle: "Checkout is down",
          notice: AS_TEAM,
          translator: translator,
        }),
        getOnCallPersonPageEmailSubject({
          recordLabel: "INC-42",
          recordTitle: "Checkout is down",
          notice: AS_TEAM,
        }),
        ["Alice Kim", "Database escalation", "INC-42", "Checkout is down"],
      ],
      [
        getOnCallPageSmsWords(translator).head({
          record: "INC-42",
          projectName: "Acme",
          isPageAgain: false,
          lead: "LEAD",
          isPolicyLead: true,
        }),
        "LEAD for INC-42 in Acme",
        ["LEAD", "INC-42", "Acme"],
      ],
      [
        getOnCallPageSmsWords(translator).head({
          record: "INC-42",
          projectName: "",
          isPageAgain: false,
          lead: "LEAD",
          isPolicyLead: true,
        }),
        "LEAD for INC-42",
        ["LEAD", "INC-42"],
      ],
    ];
  }

  test("every sentence is worded in it, with every value", () => {
    for (const [worded, english, values] of sentences()) {
      expect(worded).not.toBe(english);

      for (const value of values) {
        expect(worded).toContain(value);
      }
    }
  });

  test("no English is left in them: the lead inside the email's sentences is worded too", () => {
    for (const [worded] of sentences()) {
      expect(worded).not.toMatch(/\bstarted\b/);
      expect(worded).not.toContain("You're getting this");
      expect(worded).not.toMatch(/\bfor (INC|ALR)-/);
    }
  });
});
