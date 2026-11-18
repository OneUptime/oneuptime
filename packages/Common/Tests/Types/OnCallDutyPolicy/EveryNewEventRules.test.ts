import { describe, expect, test } from "@jest/globals";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import {
  EVERY_NEW_ALERT_RULE_DESCRIPTION,
  EVERY_NEW_EVENT_RULES_LANGUAGE_KEY,
  EVERY_NEW_INCIDENT_RULE_DESCRIPTION,
  PAGE_FOR_EVERY_NEW_INCIDENT_AND_ALERT_KEY,
  RULE_NAME_MAX_LENGTH,
  getEveryNewAlertRuleDescription,
  getEveryNewAlertRuleName,
  getEveryNewIncidentRuleDescription,
  getEveryNewIncidentRuleName,
  EveryNewEventRulesOfferKind,
  doesEveryNewEventRulesOfferStartOn,
  getEveryNewEventRulesOfferKind,
  readEveryNewEventRulesLanguage,
  readPageForEveryNewIncidentAndAlert,
  shouldOfferEveryNewEventRules,
} from "../../../Types/OnCallDutyPolicy/EveryNewEventRules";
import ColumnLength from "../../../Types/Database/ColumnLength";
import { createTranslator, Translator } from "../../../Types/Translator";
import {
  FIRST_STRONG_ISOLATE,
  getRecordWordsTranslator,
  POP_DIRECTIONAL_ISOLATE,
} from "../../../Server/Utils/ServerTranslation";
import { dashboardTranslator } from "../../Helpers/DashboardLocales";

/*
 * The shared rule of "Page this policy for every new incident and alert":
 * the misc data key and how the server reads it, what the two rules are
 * called, and when Create On-Call Policy offers it.
 */

function ask(value: unknown): JSONObject {
  return { [PAGE_FOR_EVERY_NEW_INCIDENT_AND_ALERT_KEY]: value } as JSONObject;
}

describe("readPageForEveryNewIncidentAndAlert", () => {
  test("the key is the one the dashboard's switch writes", () => {
    expect(PAGE_FOR_EVERY_NEW_INCIDENT_AND_ALERT_KEY).toBe(
      "pageForEveryNewIncidentAndAlert",
    );
  });

  test.each([
    ["no misc data", undefined],
    ["null misc data", null],
    ["empty misc data", {}],
    ["misc data that is a list", [] as unknown as JSONObject],
    ["false", ask(false)],
    ["null", ask(null)],
    ["the text false", ask("false")],
    ["the text False, padded", ask("  False ")],
    ["empty text", ask("")],
  ] as Array<[string, JSONObject | null | undefined]>)(
    "%s asks for nothing",
    (_label: string, miscDataProps: JSONObject | null | undefined) => {
      expect(readPageForEveryNewIncidentAndAlert(miscDataProps)).toBe(false);
    },
  );

  test.each([
    ["true", ask(true)],
    ["the text true", ask("true")],
    ["the text TRUE, padded", ask(" TRUE ")],
  ] as Array<[string, JSONObject]>)(
    "%s asks for the two rules",
    (_label: string, miscDataProps: JSONObject) => {
      expect(readPageForEveryNewIncidentAndAlert(miscDataProps)).toBe(true);
    },
  );

  test.each([
    ["a number", ask(1)],
    ["other text", ask("yes please")],
    ["a list", ask([true])],
    ["an object", ask({ incidents: true })],
  ] as Array<[string, JSONObject]>)(
    "%s is refused, not read as no",
    (_label: string, miscDataProps: JSONObject) => {
      expect(() => {
        return readPageForEveryNewIncidentAndAlert(miscDataProps);
      }).toThrow(BadDataException);
      expect(() => {
        return readPageForEveryNewIncidentAndAlert(miscDataProps);
      }).toThrow("pageForEveryNewIncidentAndAlert must be true or false.");
    },
  );
});

describe("the two rules' names", () => {
  test("say what they page, and for what", () => {
    expect(getEveryNewIncidentRuleName("Payments on-call")).toBe(
      "Page Payments on-call for every incident",
    );
    expect(getEveryNewAlertRuleName("Payments on-call")).toBe(
      "Page Payments on-call for every alert",
    );
  });

  test("tidy the policy name's spaces", () => {
    expect(getEveryNewIncidentRuleName("  Payments \n  on-call ")).toBe(
      "Page Payments on-call for every incident",
    );
  });

  test("a policy with no name is the new on-call policy", () => {
    for (const name of [undefined, null, "", "   "]) {
      expect(getEveryNewIncidentRuleName(name)).toBe(
        "Page the new on-call policy for every incident",
      );
      expect(getEveryNewAlertRuleName(name)).toBe(
        "Page the new on-call policy for every alert",
      );
    }
  });

  test("fit a rule's name column, cutting the policy's name and keeping the words around it", () => {
    expect(RULE_NAME_MAX_LENGTH).toBe(ColumnLength.ShortText);

    const longName: string = "Payments platform primary on-call "
      .repeat(5)
      .trim();

    for (const name of [
      getEveryNewIncidentRuleName(longName),
      getEveryNewAlertRuleName(longName),
    ]) {
      expect(Array.from(name).length).toBeLessThanOrEqual(RULE_NAME_MAX_LENGTH);
      expect(name.startsWith("Page Payments platform primary on-call")).toBe(
        true,
      );
      expect(name).toContain("…");
    }

    expect(
      getEveryNewIncidentRuleName(longName).endsWith("… for every incident"),
    ).toBe(true);
    expect(
      getEveryNewAlertRuleName(longName).endsWith("… for every alert"),
    ).toBe(true);
  });

  test("a name that just fits is not cut", () => {
    // "Page " + name + " for every incident" is exactly the column's length.
    const room: number =
      RULE_NAME_MAX_LENGTH - "Page ".length - " for every incident".length;
    const name: string = "x".repeat(room);

    expect(getEveryNewIncidentRuleName(name)).toBe(
      `Page ${name} for every incident`,
    );
    expect(Array.from(getEveryNewIncidentRuleName(name)).length).toBe(
      RULE_NAME_MAX_LENGTH,
    );
    expect(getEveryNewIncidentRuleName(`${name}y`)).toContain("…");
  });

  test("count a character outside the basic plane as one, and never split it", () => {
    const name: string = "🚨".repeat(120);
    const ruleName: string = getEveryNewIncidentRuleName(name);

    expect(Array.from(ruleName).length).toBeLessThanOrEqual(
      RULE_NAME_MAX_LENGTH,
    );
    // No lone surrogate half left behind by the cut.
    expect(ruleName.includes("�")).toBe(false);
    for (const character of Array.from(ruleName)) {
      expect(character.length === 1 || character === "🚨").toBe(true);
    }
  });

  test("each rule's description says what it does, and that it came with the policy", () => {
    expect(EVERY_NEW_INCIDENT_RULE_DESCRIPTION).toBe(
      "Pages this on-call policy for every new incident. Added when the policy was created.",
    );
    expect(EVERY_NEW_ALERT_RULE_DESCRIPTION).toBe(
      "Pages this on-call policy for every new alert. Added when the policy was created.",
    );
  });
});

describe("shouldOfferEveryNewEventRules", () => {
  const NEW_PROJECT: {
    policyCount: number | null;
    incidentRuleCount: number | null;
    alertRuleCount: number | null;
    mayAddRules: boolean;
  } = {
    policyCount: 0,
    incidentRuleCount: 0,
    alertRuleCount: 0,
    mayAddRules: true,
  };

  test("offers it for a new project's first policy, to someone who may add rules", () => {
    expect(shouldOfferEveryNewEventRules(NEW_PROJECT)).toBe(true);
  });

  test.each([
    ["a policy already", { policyCount: 1 }],
    ["an incident on-call rule", { incidentRuleCount: 1 }],
    ["an alert on-call rule", { alertRuleCount: 3 }],
    ["no right to add rules", { mayAddRules: false }],
    ["an unknown policy count", { policyCount: null }],
    ["an unknown incident rule count", { incidentRuleCount: null }],
    ["an unknown alert rule count", { alertRuleCount: null }],
  ] as Array<[string, Partial<typeof NEW_PROJECT>]>)(
    "offers nothing with %s",
    (_label: string, change: Partial<typeof NEW_PROJECT>) => {
      expect(shouldOfferEveryNewEventRules({ ...NEW_PROJECT, ...change })).toBe(
        false,
      );
    },
  );
});

/*
 * ISSUE #7371: a later policy is offered the switch too, off to start
 * with. A project's second policy hid it, with nothing in its place, and
 * was saved paging nobody without a word.
 */
describe("getEveryNewEventRulesOfferKind (#7371)", () => {
  const NEW_PROJECT: {
    policyCount: number | null;
    incidentRuleCount: number | null;
    alertRuleCount: number | null;
    mayAddRules: boolean;
  } = {
    policyCount: 0,
    incidentRuleCount: 0,
    alertRuleCount: 0,
    mayAddRules: true,
  };

  test("a new project's first policy is offered it, on", () => {
    const kind: EveryNewEventRulesOfferKind =
      getEveryNewEventRulesOfferKind(NEW_PROJECT);

    expect(kind).toBe(EveryNewEventRulesOfferKind.FirstPolicy);
    expect(doesEveryNewEventRulesOfferStartOn(kind)).toBe(true);
  });

  test.each([
    ["a policy already", { policyCount: 1 }],
    // The list's first page says so before the rules are counted.
    [
      "a policy in the list, the rules not counted",
      { policyCount: 2, incidentRuleCount: null, alertRuleCount: null },
    ],
    ["an incident on-call rule", { incidentRuleCount: 1 }],
    ["an alert on-call rule", { alertRuleCount: 3 }],
  ] as Array<[string, Partial<typeof NEW_PROJECT>]>)(
    "a project with %s is offered it for a later policy, off",
    (_label: string, change: Partial<typeof NEW_PROJECT>) => {
      const kind: EveryNewEventRulesOfferKind = getEveryNewEventRulesOfferKind({
        ...NEW_PROJECT,
        ...change,
      });

      expect(kind).toBe(EveryNewEventRulesOfferKind.LaterPolicy);
      expect(doesEveryNewEventRulesOfferStartOn(kind)).toBe(false);
    },
  );

  test.each([
    ["no right to add rules", { mayAddRules: false }],
    [
      "no right to add rules, in a project with a policy",
      { mayAddRules: false, policyCount: 4 },
    ],
    [
      "counts not known yet",
      { policyCount: null, incidentRuleCount: null, alertRuleCount: null },
    ],
    ["counts read as nothing but unknown rules", { incidentRuleCount: null }],
  ] as Array<[string, Partial<typeof NEW_PROJECT>]>)(
    "offers nothing with %s",
    (_label: string, change: Partial<typeof NEW_PROJECT>) => {
      expect(
        getEveryNewEventRulesOfferKind({ ...NEW_PROJECT, ...change }),
      ).toBe(EveryNewEventRulesOfferKind.None);
    },
  );

  test("while the counts are on their way, the switch would start on: a new project's joins the dialog on", () => {
    expect(
      doesEveryNewEventRulesOfferStartOn(EveryNewEventRulesOfferKind.None),
    ).toBe(true);
  });

  test("the first policy's offer is exactly shouldOfferEveryNewEventRules", () => {
    for (const facts of [
      NEW_PROJECT,
      { ...NEW_PROJECT, policyCount: 1 },
      { ...NEW_PROJECT, mayAddRules: false },
      { ...NEW_PROJECT, alertRuleCount: null },
    ]) {
      expect(
        getEveryNewEventRulesOfferKind(facts) ===
          EveryNewEventRulesOfferKind.FirstPolicy,
      ).toBe(shouldOfferEveryNewEventRules(facts));
    }
  });
});

/*
 * ISSUE #7995: THE TWO RULES IN THE LANGUAGE OF THE PERSON WHO MADE THEM.
 *
 * The rules were named "Page <policy> for every incident" in English for a
 * German, an Arabic or a Japanese reader alike. They are now a whole
 * sentence with the policy's name in it, worded by the creator's
 * translator - the Dashboard's, or the server's copy of the same words -
 * and cut to fit the column by the policy's name alone, the words around it
 * whole in every language. No translator is English, byte for byte.
 */
const READER_LANGUAGES: Array<string> = ["de", "ar", "fa", "ja"];

describe("the two rules' names and descriptions, in the creator's language (#7995)", () => {
  test("English is the same as it always was, with a translator or without", () => {
    const english: Translator = createTranslator(undefined);

    for (const translator of [undefined, english, dashboardTranslator("en")]) {
      expect(getEveryNewIncidentRuleName("Payments on-call", translator)).toBe(
        "Page Payments on-call for every incident",
      );
      expect(getEveryNewAlertRuleName("Payments on-call", translator)).toBe(
        "Page Payments on-call for every alert",
      );
      expect(getEveryNewIncidentRuleName(undefined, translator)).toBe(
        "Page the new on-call policy for every incident",
      );
      expect(getEveryNewIncidentRuleDescription(translator)).toBe(
        EVERY_NEW_INCIDENT_RULE_DESCRIPTION,
      );
      expect(getEveryNewAlertRuleDescription(translator)).toBe(
        EVERY_NEW_ALERT_RULE_DESCRIPTION,
      );
    }

    // The server's English: no translator at all.
    expect(getRecordWordsTranslator("en")).toBeUndefined();
  });

  test.each(READER_LANGUAGES)(
    "in %s, each rule is the reader's whole sentence, with the policy's name in it as written",
    (language: string) => {
      const translator: Translator = dashboardTranslator(language);
      const incident: string = getEveryNewIncidentRuleName(
        "Payments on-call",
        translator,
      );
      const alert: string = getEveryNewAlertRuleName(
        "Payments on-call",
        translator,
      );

      expect(incident).toBe(
        translator.translateTemplate("Page {{policy}} for every incident", {
          policy: "Payments on-call",
        }),
      );
      expect(alert).toBe(
        translator.translateTemplate("Page {{policy}} for every alert", {
          policy: "Payments on-call",
        }),
      );

      for (const name of [incident, alert]) {
        expect(name).toContain("Payments on-call");
        expect(name).not.toContain("for every");
        expect(name).not.toContain("{{");
        // A record's name keeps no invisible marks.
        expect(name).not.toContain(FIRST_STRONG_ISOLATE);
        expect(name).not.toContain(POP_DIRECTIONAL_ISOLATE);
      }

      expect(incident).not.toBe(alert);
    },
  );

  test.each(READER_LANGUAGES)(
    "in %s, a policy with no name is the new on-call policy in the reader's words",
    (language: string) => {
      const translator: Translator = dashboardTranslator(language);
      const unnamed: string =
        translator.translateText("the new on-call policy") || "";

      expect(unnamed).not.toBe("the new on-call policy");

      for (const name of [undefined, null, "", "  "]) {
        expect(getEveryNewIncidentRuleName(name, translator)).toContain(
          unnamed,
        );
        expect(getEveryNewAlertRuleName(name, translator)).toContain(unnamed);
        expect(getEveryNewIncidentRuleName(name, translator)).not.toContain(
          "the new on-call policy",
        );
      }
    },
  );

  test.each(READER_LANGUAGES)(
    "in %s, each description is the reader's",
    (language: string) => {
      const translator: Translator = dashboardTranslator(language);

      for (const [description, english] of [
        [
          getEveryNewIncidentRuleDescription(translator),
          EVERY_NEW_INCIDENT_RULE_DESCRIPTION,
        ],
        [
          getEveryNewAlertRuleDescription(translator),
          EVERY_NEW_ALERT_RULE_DESCRIPTION,
        ],
      ]) {
        expect(description).toBe(translator.translateText(english));
        expect(description).not.toBe(english);
        expect(description).not.toContain("Added when the policy");
      }
    },
  );

  test.each(["en", ...READER_LANGUAGES])(
    "in %s, a long policy name is cut to fit the column, and the words around it stay whole",
    (language: string) => {
      const translator: Translator = dashboardTranslator(language);
      const longName: string = "Payments platform primary on-call "
        .repeat(6)
        .trim();
      const [before, after] = translator
        .translateTemplate("Page {{policy}} for every incident", {
          policy: "\u0000",
        })
        .split("\u0000");

      const name: string = getEveryNewIncidentRuleName(longName, translator);

      expect(Array.from(name).length).toBeLessThanOrEqual(RULE_NAME_MAX_LENGTH);
      // The words around the name, whole: only the name gave way.
      expect(name.startsWith(before!)).toBe(true);
      expect(name.endsWith(after!)).toBe(true);
      expect(name).toContain("…");

      const shown: string = name.slice(
        before!.length,
        name.length - after!.length,
      );

      expect(shown.endsWith("…")).toBe(true);
      expect(longName.startsWith(shown.slice(0, -1).trimEnd())).toBe(true);
      // As much of the name as fits: one more character would not.
      expect(
        Array.from(before!).length +
          Array.from(shown).length +
          Array.from(after!).length,
      ).toBeGreaterThanOrEqual(RULE_NAME_MAX_LENGTH - 1);
    },
  );

  test.each(READER_LANGUAGES)(
    "in %s, a name that just fits is not cut, and one character more is",
    (language: string) => {
      const translator: Translator = dashboardTranslator(language);
      const around: number =
        Array.from(
          translator.translateTemplate("Page {{policy}} for every alert", {
            policy: "",
          }),
        ).length - "{{policy}}".length;
      const roomWithMarker: number =
        RULE_NAME_MAX_LENGTH -
        (Array.from(
          translator.translateTemplate("Page {{policy}} for every alert", {
            policy: "x",
          }),
        ).length -
          1);
      const fits: string = "y".repeat(roomWithMarker);

      expect(around).toBeGreaterThan(0);
      expect(getEveryNewAlertRuleName(fits, translator)).toContain(fits);
      expect(
        Array.from(getEveryNewAlertRuleName(fits, translator)).length,
      ).toBe(RULE_NAME_MAX_LENGTH);
      expect(getEveryNewAlertRuleName(`${fits}y`, translator)).toContain("…");
    },
  );

  test.each(READER_LANGUAGES)(
    "in %s, the server's copy of the words names the rules as the Dashboard does",
    (language: string) => {
      const server: Translator | undefined = getRecordWordsTranslator(language);
      const dashboard: Translator = dashboardTranslator(language);

      expect(server).toBeDefined();

      for (const policyName of [
        "Payments on-call",
        "Bereitschaft Zahlungen",
        undefined,
        "Payments platform primary on-call ".repeat(6),
      ]) {
        expect(getEveryNewIncidentRuleName(policyName, server)).toBe(
          getEveryNewIncidentRuleName(policyName, dashboard),
        );
        expect(getEveryNewAlertRuleName(policyName, server)).toBe(
          getEveryNewAlertRuleName(policyName, dashboard),
        );
      }

      expect(getEveryNewIncidentRuleDescription(server)).toBe(
        getEveryNewIncidentRuleDescription(dashboard),
      );
      expect(getEveryNewAlertRuleDescription(server)).toBe(
        getEveryNewAlertRuleDescription(dashboard),
      );
    },
  );
});

describe("readEveryNewEventRulesLanguage (#7995)", () => {
  function sent(value: unknown): JSONObject {
    return { [EVERY_NEW_EVENT_RULES_LANGUAGE_KEY]: value } as JSONObject;
  }

  test("the key is the one the Dashboard and Ask AI send beside the ask for the rules", () => {
    expect(EVERY_NEW_EVENT_RULES_LANGUAGE_KEY).toBe(
      "everyNewEventRulesLanguage",
    );
  });

  test("a language OneUptime writes in is read exactly as written", () => {
    for (const language of ["en", "de", "ar", "fa", "ja", "zh-TW", "zh-CN"]) {
      expect(readEveryNewEventRulesLanguage(sent(language))).toBe(language);
    }
  });

  test("anything else is no language at all: the caller decides", () => {
    for (const value of [
      undefined,
      null,
      "",
      "xx",
      "de-DE",
      "DE",
      " de",
      7,
      true,
      ["de"],
      { language: "de" },
    ]) {
      expect([value, readEveryNewEventRulesLanguage(sent(value))]).toEqual([
        value,
        undefined,
      ]);
    }

    expect(readEveryNewEventRulesLanguage(undefined)).toBeUndefined();
    expect(readEveryNewEventRulesLanguage(null)).toBeUndefined();
    expect(readEveryNewEventRulesLanguage({})).toBeUndefined();
    expect(
      readEveryNewEventRulesLanguage(["de"] as unknown as JSONObject),
    ).toBeUndefined();
  });
});
