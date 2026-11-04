import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { AI_INSIGHTS_FIX_APPROVAL_PLACES_TITLE } from "../../../../App/FeatureSet/Dashboard/src/Components/AI/ActivityInsights/AiActivityInsightsData";
import {
  REMEDIATION_FIX_DISMISS,
  REMEDIATION_FIX_DISMISS_REFUSED,
  REMEDIATION_FIX_STEP_COPY,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AutoRemediation/RemediationStepCopy";
import AutoRemediationSuggestion from "../../../Models/DatabaseModels/AutoRemediationSuggestion";

/*
 * THE WORDS #5519's FOLLOW-UPS ADD ARE EVERY LANGUAGE'S OWN.
 *
 * Dismiss fix, the refusal of it, where a fix was approved - on its step
 * and on AI Insights - the activity's Cloud environment and the two new
 * columns' titles, read from the Dashboard's locale files themselves: a key
 * that lost its translation, kept the English where the language has its
 * own words, or lost a placeholder is caught. The chats' and the product's
 * names stay as their makers write them. And Dismiss fix is never the word
 * the shared Dismiss became in most languages (#5512): their Hide.
 *
 * With them, the UI review's words: what a refused Dismiss fix says
 * happened (the fix was not dismissed - a "fix", as its button says;
 * RemediationSuggestionCardApproval holds the step to these keys), and the
 * Fixes section's verification line, right over Where fixes were approved,
 * which every language read in English.
 */

const DASHBOARD_DIR: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard",
);

const LANGUAGES: Array<string> = [
  "de",
  "fr",
  "es",
  "it",
  "pt",
  "nl",
  "da",
  "no",
  "sv",
  "ru",
  "ja",
  "ko",
  "zh-CN",
  "zh-TW",
  "hi",
  "fa",
];

function readJson(file: string): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(path.join(DASHBOARD_DIR, file), "utf8"),
  ) as Record<string, unknown>;
}

function readLocale(locale: string): Record<string, string> {
  return readJson(`src/Locales/${locale}.json`) as Record<string, string>;
}

function columnTitle(column: string): string {
  const title: string | undefined = (
    new AutoRemediationSuggestion() as unknown as {
      getTableColumnMetadata: (name: string) => { title?: string };
    }
  ).getTableColumnMetadata(column)?.title;

  return title || "";
}

// A refused Dismiss fix's headlines (RemediationStep's getActionErrorTitle).
const FIX_NOT_DISMISSED: string =
  "Could not save your action: the fix was not dismissed";
const FIX_NOT_DISMISSED_STARTED: string =
  "Could not save your action: the fix was not dismissed — it had already started; see its commands below";

// The Fixes section's verification line (describeFixVerification), as its key.
const FIX_VERIFICATION_LINE: string =
  "Verification: {{verified}} resolved the problem, {{failed}} did not, {{verifying}} still being checked.";

const WORDS: Array<string> = [
  REMEDIATION_FIX_DISMISS,
  REMEDIATION_FIX_DISMISS_REFUSED,
  REMEDIATION_FIX_STEP_COPY.approvedInSlack,
  REMEDIATION_FIX_STEP_COPY.approvedByInSlack,
  REMEDIATION_FIX_STEP_COPY.approvedInTeams,
  REMEDIATION_FIX_STEP_COPY.approvedByInTeams,
  AI_INSIGHTS_FIX_APPROVAL_PLACES_TITLE,
  "In OneUptime",
  "In Slack",
  "In Microsoft Teams",
  "Cloud environment",
  columnTitle("approvedFrom"),
  columnTitle("runbookTrackRecord"),
  FIX_NOT_DISMISSED,
  FIX_NOT_DISMISSED_STARTED,
  FIX_VERIFICATION_LINE,
];

/*
 * "In Slack" is German, Italian and Dutch as it is: each keeps it, and its
 * i18n progress says so (i18n:apply --same-as-english).
 */
const SAME_AS_ENGLISH: Readonly<Record<string, ReadonlyArray<string>>> = {
  de: ["In OneUptime", "In Slack", "In Microsoft Teams"],
  it: ["In OneUptime", "In Slack", "In Microsoft Teams"],
  nl: ["In OneUptime", "In Slack", "In Microsoft Teams"],
};

// The names each translation keeps as their makers write them.
const NAMES: Readonly<Record<string, ReadonlyArray<string>>> = {
  [REMEDIATION_FIX_STEP_COPY.approvedInSlack]: ["Slack"],
  [REMEDIATION_FIX_STEP_COPY.approvedByInSlack]: ["Slack"],
  [REMEDIATION_FIX_STEP_COPY.approvedInTeams]: ["Microsoft Teams"],
  [REMEDIATION_FIX_STEP_COPY.approvedByInTeams]: ["Microsoft Teams"],
  "In OneUptime": ["OneUptime"],
  "In Slack": ["Slack"],
  "In Microsoft Teams": ["Microsoft Teams"],
};

const PLACEHOLDER: RegExp = /\{\{[a-zA-Z]+\}\}/g;

function placeholders(text: string): Array<string> {
  return Array.from(new Set(text.match(PLACEHOLDER) || [])).sort();
}

const ENGLISH: Record<string, string> = readLocale("en");

describe("English holds every word under its own key", () => {
  test("the columns are titled as the model titles them", () => {
    expect(columnTitle("approvedFrom")).toBe("Approved From");
    expect(columnTitle("runbookTrackRecord")).toBe("Runbook Track Record");
  });

  test.each(WORDS)("%s", (word: string) => {
    expect(ENGLISH[word]).toBe(word);
  });
});

describe.each(LANGUAGES)("the %s locale", (language: string) => {
  const words: Record<string, string> = readLocale(language);
  const kept: ReadonlyArray<string> = SAME_AS_ENGLISH[language] || [];
  const sameAsEnglish: Array<unknown> =
    (readJson(`i18n/Progress/${language}.json`)["sameAsEnglish"] as
      | Array<unknown>
      | undefined) || [];

  test.each(WORDS)(
    "words %s its own way, with the same placeholders and names",
    (word: string) => {
      const translated: string | undefined = words[word];

      expect(translated).toBeDefined();
      expect(translated!.trim().length).toBeGreaterThan(0);
      expect({
        word,
        translated: translated !== word || kept.includes(word),
      }).toEqual({ word, translated: true });
      expect(placeholders(translated!)).toEqual(placeholders(word));

      for (const name of NAMES[word] || []) {
        expect(translated).toContain(name);
      }
    },
  );

  test("what it keeps as English, its progress says it keeps", () => {
    for (const word of kept) {
      expect(words[word]).toBe(word);
      expect(sameAsEnglish).toContain(word);
    }
  });

  test("Dismiss fix is never its Hide, whatever the shared Dismiss became", () => {
    const dismissFix: string = words[REMEDIATION_FIX_DISMISS]!;

    expect(dismissFix).not.toBe(words["Hide"]);
    expect(dismissFix).not.toBe(words["Dismiss"]);
  });
});
