import { describe, expect, test } from "@jest/globals";
import OnCallDutyPolicyExecutionLog from "../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import OnCallDutyPolicyExecutionLogTimeline from "../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLogTimeline";
import {
  DASHBOARD_LANGUAGES,
  isWordedInDashboardLocale,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";

/*
 * AN ON-CALL POLICY'S EXECUTION LOG IS NAMED IN EVERY DASHBOARD LANGUAGE
 * (#8320).
 *
 * #6817 renamed the On-Call Duty models on screen: OnCallDutyPolicyExecutionLog
 * is "On-Call Policy Execution Log", and its timeline "On-Call Policy
 * Execution Log Timeline". Their names, and the columns that point at them,
 * became Dashboard keys, but eleven languages kept them in English: an
 * Italian reader met "On-Call Policy Execution Logs" beside "Registri di
 * esecuzione" and "Policy di reperibilità".
 *
 * Each language now words them, and with its own name for an on-call policy
 * - the one its On-Call Policies menu and pages say (OneNamePerThingGuard:
 * one name per thing in each language).
 */

const NAMES: ReadonlyArray<string> = [
  "On-Call Policy Execution Log",
  "On-Call Policy Execution Log ID",
  "On-Call Policy Execution Log Timeline",
  "On-Call Policy Execution Log Timeline ID",
  "On-Call Policy Execution Logs",
];

/*
 * What each language calls an on-call policy inside a longer name, as its
 * pages say it ("On-Call Policy", "On-Call Policy Logs"), in lower case.
 */
const ON_CALL_POLICY_WORD: Readonly<Record<string, string>> = {
  de: "bereitschaftsrichtlinie",
  es: "política de guardia",
  fr: "politique d'astreinte",
  it: "policy di reperibilità",
  pt: "política de plantão",
  nl: "bereikbaarheidsbeleid",
  da: "vagtpolitik",
  no: "vaktretningslinje",
  sv: "jourpolicy",
  ru: "политики дежурства",
  ja: "オンコールポリシー",
  ko: "온콜 정책",
  "zh-CN": "值班策略",
  "zh-TW": "待命策略",
  hi: "ऑन-कॉल नीति",
  fa: "سیاست آنکال",
  ar: "سياسة المناوبة",
};

// The languages that kept the names in English until #8320.
const LEFT_IN_ENGLISH: ReadonlyArray<string> = [
  "da",
  "hi",
  "it",
  "ko",
  "nl",
  "no",
  "pt",
  "ru",
  "sv",
  "zh-CN",
  "zh-TW",
];

describe("an on-call policy's execution log, named in every Dashboard language (#8320)", () => {
  test("the names are the models' own, as the Dashboard shows them", () => {
    const log: OnCallDutyPolicyExecutionLog = new OnCallDutyPolicyExecutionLog();
    const timeline: OnCallDutyPolicyExecutionLogTimeline =
      new OnCallDutyPolicyExecutionLogTimeline();

    expect(NAMES).toContain(log.singularName);
    expect(NAMES).toContain(log.pluralName);
    expect(NAMES).toContain(timeline.singularName);
  });

  test.each(NAMES)("English has %s, as itself", (name: string) => {
    expect(readDashboardLocale("en")[name]).toBe(name);
  });

  test("every language the Dashboard offers is read, Arabic and Persian among them", () => {
    expect(DASHBOARD_LANGUAGES).toHaveLength(17);
    expect(Object.keys(ON_CALL_POLICY_WORD).sort()).toEqual(
      [...DASHBOARD_LANGUAGES].sort(),
    );
  });

  describe.each([...DASHBOARD_LANGUAGES])("%s", (language: string) => {
    test.each(NAMES)("words %s", (name: string) => {
      const text: string | undefined = readDashboardLocale(language)[name];

      expect({ language, name, worded: isWordedInDashboardLocale(name, language) }).toEqual({
        language,
        name,
        worded: true,
      });
      // Not the English, kept on a same-as-English list or not.
      expect(text).not.toBe(name);
      expect(text).not.toMatch(/On-Call|Execution|Timeline/u);
    });

    test.each(NAMES)(
      "names the on-call policy in %s as its pages do",
      (name: string) => {
        const text: string = (readDashboardLocale(language)[name] || "").toLocaleLowerCase(language);

        expect({ language, name, text, hasWord: text.includes(ON_CALL_POLICY_WORD[language]!) }).toMatchObject({
          language,
          name,
          hasWord: true,
        });
      },
    );

    test("tells the five names apart", () => {
      const words: Record<string, string> = readDashboardLocale(language);

      // An ID is never the record it identifies, nor a timeline its log.
      expect(words["On-Call Policy Execution Log ID"]).not.toBe(
        words["On-Call Policy Execution Log"],
      );
      expect(words["On-Call Policy Execution Log Timeline"]).not.toBe(
        words["On-Call Policy Execution Log"],
      );
      expect(words["On-Call Policy Execution Log Timeline ID"]).not.toBe(
        words["On-Call Policy Execution Log Timeline"],
      );
      expect(words["On-Call Policy Execution Log Timeline ID"]).not.toBe(
        words["On-Call Policy Execution Log ID"],
      );
    });

    test("the word for an on-call policy is the one its pages use", () => {
      const words: Record<string, string> = readDashboardLocale(language);
      const onCallPolicy: string = (words["On-Call Policy Logs"] || "")
        .concat(" ", words["On-Call Policy ID"] || "", " ", words["On-Call Policy"] || "")
        .toLocaleLowerCase(language);

      expect({ language, used: onCallPolicy.includes(ON_CALL_POLICY_WORD[language]!) }).toEqual({
        language,
        used: true,
      });
    });
  });

  // The languages #8320 named, each with its words for an execution log.
  test.each(LEFT_IN_ENGLISH)("%s no longer reads English", (language: string) => {
    const words: Record<string, string> = readDashboardLocale(language);

    for (const name of NAMES) {
      expect({ language, name, english: words[name] === name }).toEqual({
        language,
        name,
        english: false,
      });
    }
  });

  // The checks tell an English placeholder, and a word of another name, apart.
  test("negative control: English, or another word for the policy, is caught", () => {
    expect(
      "On-Call Policy Execution Log".toLocaleLowerCase("it").includes(
        ON_CALL_POLICY_WORD["it"]!,
      ),
    ).toBe(false);
    expect(
      "Registro di esecuzione del criterio di reperibilità"
        .toLocaleLowerCase("it")
        .includes(ON_CALL_POLICY_WORD["it"]!),
    ).toBe(false);
    expect(/On-Call|Execution|Timeline/u.test("On-Call Policy Execution Logs")).toBe(true);
  });
});
