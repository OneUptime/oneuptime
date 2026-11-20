import { getErrorInSentenceText } from "../../../UI/Utils/ErrorInSentence";
import {
  readRefusalValues,
  RefusalWithValues,
} from "../../../Types/Exception/RefusalWithValues";
import {
  EscalationRuleNames,
  getPersonOnRuleAlreadyRefusal,
  getScheduleOnRuleAlreadyRefusal,
  getTeamOnRuleAlreadyRefusal,
  NEXT_IN_ROTATION_ON_RULE_ALREADY_REFUSAL,
  NEXT_IN_ROTATION_ON_UNREAD_RULE_ALREADY_REFUSAL,
  PERSON_ON_RULE_ALREADY_REFUSAL,
  PERSON_ON_UNREAD_RULE_ALREADY_REFUSAL,
  RESPONDER_ON_RULE_ALREADY_REFUSALS,
  SCHEDULE_ON_RULE_ALREADY_REFUSAL,
  SCHEDULE_ON_UNREAD_RULE_ALREADY_REFUSAL,
  TEAM_ON_RULE_ALREADY_REFUSAL,
  TEAM_ON_UNREAD_RULE_ALREADY_REFUSAL,
} from "../../../Types/OnCallDutyPolicy/EscalationRuleResponderOnce";
import {
  DASHBOARD_LANGUAGES,
  dashboardTranslator,
  readDashboardLocale,
  readDashboardLocaleAsDrawn,
} from "../../Helpers/DashboardLocales";
import { describe, expect, test } from "@jest/globals";

/*
 * THE REFUSAL OF A RESPONDER A RULE PAGES ALREADY, IN THE READER'S LANGUAGE
 * (#10465).
 *
 * Adding a person, a team or a schedule an escalation rule pages already is
 * refused with a sentence that names it, the rule and the rule's policy
 * (#10411). The server built it with the names glued in, so no Dashboard
 * language had it: a German or a Japanese page left open while a teammate
 * added the same person, or the guided on-call setup, said it in English.
 * Each sentence is now a refusal with values (RefusalWithValues): the
 * server still answers in English, word for word as before, and the
 * Dashboard reads the names back out of it and says the sentence in the
 * reader's language with the names as written.
 */

const RULE: EscalationRuleNames = {
  ruleName: "Level 1",
  policyName: "Payments on-call",
};

interface Case {
  name: string;
  refusal: RefusalWithValues;
  message: string;
  values: Record<string, string>;
}

const CASES: Array<Case> = [
  {
    name: "a person",
    refusal: PERSON_ON_RULE_ALREADY_REFUSAL,
    message: getPersonOnRuleAlreadyRefusal({ rule: RULE, person: "Ana Lopez" }),
    values: { rule: "Level 1", policy: "Payments on-call", person: "Ana Lopez" },
  },
  {
    name: "a person, on a rule that could not be read",
    refusal: PERSON_ON_UNREAD_RULE_ALREADY_REFUSAL,
    message: getPersonOnRuleAlreadyRefusal({
      rule: null,
      person: "ana@acme.example",
    }),
    values: { person: "ana@acme.example" },
  },
  {
    name: "a team",
    refusal: TEAM_ON_RULE_ALREADY_REFUSAL,
    message: getTeamOnRuleAlreadyRefusal({ rule: RULE, team: "Platform" }),
    values: { rule: "Level 1", policy: "Payments on-call", team: "Platform" },
  },
  {
    name: "a team, on a rule that could not be read",
    refusal: TEAM_ON_UNREAD_RULE_ALREADY_REFUSAL,
    message: getTeamOnRuleAlreadyRefusal({ rule: null, team: "Platform" }),
    values: { team: "Platform" },
  },
  {
    name: "whoever is on call in a schedule",
    refusal: SCHEDULE_ON_RULE_ALREADY_REFUSAL,
    message: getScheduleOnRuleAlreadyRefusal({
      rule: RULE,
      schedule: "Primary",
      pagesNextInRotation: false,
    }),
    values: { rule: "Level 1", policy: "Payments on-call", schedule: "Primary" },
  },
  {
    name: "whoever is on call in a schedule, on a rule that could not be read",
    refusal: SCHEDULE_ON_UNREAD_RULE_ALREADY_REFUSAL,
    message: getScheduleOnRuleAlreadyRefusal({
      rule: null,
      schedule: "Primary",
      pagesNextInRotation: false,
    }),
    values: { schedule: "Primary" },
  },
  {
    name: "the next person in a schedule's rotation",
    refusal: NEXT_IN_ROTATION_ON_RULE_ALREADY_REFUSAL,
    message: getScheduleOnRuleAlreadyRefusal({
      rule: RULE,
      schedule: "Primary",
      pagesNextInRotation: true,
    }),
    values: { rule: "Level 1", policy: "Payments on-call", schedule: "Primary" },
  },
  {
    name: "the next person in a schedule's rotation, on a rule that could not be read",
    refusal: NEXT_IN_ROTATION_ON_UNREAD_RULE_ALREADY_REFUSAL,
    message: getScheduleOnRuleAlreadyRefusal({
      rule: null,
      schedule: "Primary",
      pagesNextInRotation: true,
    }),
    values: { schedule: "Primary" },
  },
];

// The sentence in `language`, with the values put where its wording puts them.
function wordedIn(language: string, kase: Case): string {
  let sentence: string = readDashboardLocaleAsDrawn(language)[
    kase.refusal.template
  ]!;

  for (const [name, value] of Object.entries(kase.values)) {
    sentence = sentence.split(`{{${name}}}`).join(value);
  }

  return sentence;
}

describe("the server's words are as they were", () => {
  test("in English, word for word as the API, the CLI and Terraform read them", () => {
    expect(CASES.map((kase: Case): string => {
      return kase.message;
    })).toEqual([
      'The escalation rule "Level 1" of the on-call policy "Payments on-call" pages Ana Lopez already, so they were not added again.',
      "This escalation rule pages ana@acme.example already, so they were not added again.",
      'The escalation rule "Level 1" of the on-call policy "Payments on-call" pages the team "Platform" already, so it was not added again.',
      'This escalation rule pages the team "Platform" already, so it was not added again.',
      'The escalation rule "Level 1" of the on-call policy "Payments on-call" pages whoever is on call in the on-call schedule "Primary" already, so the schedule was not added again.',
      'This escalation rule pages whoever is on call in the on-call schedule "Primary" already, so the schedule was not added again.',
      'The escalation rule "Level 1" of the on-call policy "Payments on-call" pages the next person in the rotation of the on-call schedule "Primary" already, so the schedule was not added again.',
      'This escalation rule pages the next person in the rotation of the on-call schedule "Primary" already, so the schedule was not added again.',
    ]);
  });

  test("a rule with a blank name, or a blank policy name, is a rule that could not be read", () => {
    expect(
      getPersonOnRuleAlreadyRefusal({
        rule: { ruleName: " ", policyName: "Payments on-call" },
        person: "Ana Lopez",
      }),
    ).toBe(
      "This escalation rule pages Ana Lopez already, so they were not added again.",
    );
  });

  test("every refusal is in the list the Dashboard reads, once", () => {
    expect(new Set(RESPONDER_ON_RULE_ALREADY_REFUSALS).size).toBe(8);
    for (const kase of CASES) {
      expect(RESPONDER_ON_RULE_ALREADY_REFUSALS).toContain(kase.refusal);
    }
  });
});

describe("the Dashboard reads the names back out of the English", () => {
  test.each(CASES)("$name", (kase: Case) => {
    expect(readRefusalValues(kase.refusal, kase.message)).toEqual(
      kase.values,
    );
  });

  test.each(CASES)("$name is read as that refusal and no other", (kase: Case) => {
    const readAs: Array<RefusalWithValues> =
      RESPONDER_ON_RULE_ALREADY_REFUSALS.filter(
        (refusal: RefusalWithValues): boolean => {
          return readRefusalValues(refusal, kase.message) !== null;
        },
      );

    expect(readAs).toEqual([kase.refusal]);
  });

  test("names holding quotes and the sentence's own words read back whole", () => {
    const message: string = getTeamOnRuleAlreadyRefusal({
      rule: { ruleName: 'Night "shift"', policyName: "Payments, already" },
      team: "Ops pages already",
    });

    expect(
      readRefusalValues(TEAM_ON_RULE_ALREADY_REFUSAL, message),
    ).toEqual({
      rule: 'Night "shift"',
      policy: "Payments, already",
      team: "Ops pages already",
    });
  });
});

describe("in every Dashboard language", () => {
  test.each(DASHBOARD_LANGUAGES)(
    "%s words each sentence: none is left in English",
    (language: string) => {
      const locale: Record<string, string> = readDashboardLocale(language);

      for (const refusal of RESPONDER_ON_RULE_ALREADY_REFUSALS) {
        expect([language, locale[refusal.template]]).not.toEqual([
          language,
          refusal.template,
        ]);
        expect(locale[refusal.template]).toBeTruthy();
      }
    },
  );

  test.each(DASHBOARD_LANGUAGES)(
    "in %s, the refusal is said in that language with the names as written",
    (language: string) => {
      for (const kase of CASES) {
        const said: string = getErrorInSentenceText({
          message: kase.message,
          translator: dashboardTranslator(language),
        });

        expect(said).toBe(wordedIn(language, kase));

        for (const value of Object.values(kase.values)) {
          expect(said).toContain(value);
        }

        expect(said).not.toContain("not added again");
      }
    },
  );

  test("in English, as the server wrote it", () => {
    for (const kase of CASES) {
      expect(
        getErrorInSentenceText({
          message: kase.message,
          translator: dashboardTranslator("en"),
        }),
      ).toBe(kase.message);
    }
  });
});
