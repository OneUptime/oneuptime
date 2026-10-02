import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  listScanRoots,
  listSourceFiles,
} from "../../../ForeignHiddenRuleGuard";
import {
  FormFacts,
  FormFieldFacts,
  RULE_CRITERIA_STEP_ID,
  scanFormFiles,
} from "../../../Helpers/FormStepsScan";
import {
  RULE_CRITERIA_ADDRESS_RANGE_OPERATOR_LABELS,
  RULE_CRITERIA_OPERATOR_LABELS,
  RuleCriteriaCopy,
} from "../../../../UI/Components/RuleCriteria/RuleCriteriaFields";

/*
 * The conditions builder is drawn in the dashboard, which looks every string
 * up in its locale files by its English text; a string with no entry silently
 * stays English. This holds to all seventeen files every sentence the builder
 * says, every operator it offers and every criteria name a rule page gives it.
 */

// packages/Common/Tests/UI/Components/RuleCriteria -> the repository root.
const REPOSITORY_ROOT: string = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "..",
  "..",
);

const LOCALES_DIR: string = path.join(
  REPOSITORY_ROOT,
  "packages",
  "App",
  "FeatureSet",
  "Dashboard",
  "src",
  "Locales",
);

const OTHER_LOCALES: Array<string> = [
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

type ReadLocaleFunction = (locale: string) => Record<string, string>;

const readLocale: ReadLocaleFunction = (
  locale: string,
): Record<string, string> => {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), "utf8"),
  );
};

const ENGLISH: Record<string, string> = readLocale("en");

const BUILDER_STRINGS: Array<string> = Array.from(
  new Set([
    ...Object.values(RuleCriteriaCopy),
    ...Object.values(RULE_CRITERIA_OPERATOR_LABELS),
    ...Object.values(RULE_CRITERIA_ADDRESS_RANGE_OPERATOR_LABELS),
    // The form field the builder is, and the step it is on.
    "Conditions",
    "Match Criteria",
  ]),
);

/*
 * Criteria names written as plain strings on every rule form, and the ones
 * two tables build from the kind of record they match
 * (AutoRemediationRulesTable, RunbookRulesTable).
 */
const COMPUTED_CRITERIA_NAMES: Array<string> = [
  "Incident Labels",
  "Alert Labels",
  "Event Labels",
  "Incident Title",
  "Alert Title",
  "Event Title",
  "Incident Description",
  "Alert Description",
  "Event Description",
];

const forms: Array<FormFacts> = scanFormFiles({
  repositoryRoot: REPOSITORY_ROOT,
  files: listScanRoots(REPOSITORY_ROOT).flatMap(
    (root: string): Array<string> => {
      return listSourceFiles(root);
    },
  ),
});

const WRITTEN_CRITERIA_NAMES: Array<string> = Array.from(
  new Set(
    forms
      .filter((form: FormFacts): boolean => {
        return form.isRuleModel;
      })
      .flatMap((form: FormFacts): Array<FormFieldFacts> => {
        return form.fields;
      })
      .filter((field: FormFieldFacts): boolean => {
        return (
          field.stepId === RULE_CRITERIA_STEP_ID &&
          field.title.length > 0 &&
          !field.title.startsWith("`")
        );
      })
      .map((field: FormFieldFacts): string => {
        return field.title;
      }),
  ),
).sort();

const CRITERIA_NAMES: Array<string> = Array.from(
  new Set([...WRITTEN_CRITERIA_NAMES, ...COMPUTED_CRITERIA_NAMES]),
).sort();

const PLACEHOLDER: RegExp = /\{\{[^}]+\}\}/g;

function placeholdersOf(text: string): Array<string> {
  return (text.match(PLACEHOLDER) || []).sort();
}

describe("the conditions builder in every dashboard language", () => {
  test("the lists are not empty, so the checks below are not vacuous", () => {
    expect(BUILDER_STRINGS.length).toBeGreaterThanOrEqual(45);
    expect(BUILDER_STRINGS).toContain("Match all");
    expect(BUILDER_STRINGS).toContain("Is in");
    expect(WRITTEN_CRITERIA_NAMES.length).toBeGreaterThan(80);
    expect(WRITTEN_CRITERIA_NAMES).toContain("Incident Title");
    expect(WRITTEN_CRITERIA_NAMES).toContain("Kubernetes Cluster Name");
  });

  test("English maps every string to itself", () => {
    for (const text of [...BUILDER_STRINGS, ...CRITERIA_NAMES]) {
      expect({ text, english: ENGLISH[text] }).toEqual({ text, english: text });
    }
  });

  test.each(OTHER_LOCALES)("%s translates every string", (locale: string) => {
    const translations: Record<string, string> = readLocale(locale);

    for (const text of [...BUILDER_STRINGS, ...CRITERIA_NAMES]) {
      const translated: string | undefined = translations[text];

      expect({ locale, text, has: typeof translated === "string" }).toEqual({
        locale,
        text,
        has: true,
      });
      expect((translated || "").trim().length).toBeGreaterThan(0);
      expect({
        locale,
        text,
        placeholders: placeholdersOf(translated || ""),
      }).toEqual({ locale, text, placeholders: placeholdersOf(text) });

      // Sentences are translated, not left in English.
      if (text.split(" ").length > 3) {
        expect({ locale, text, same: translated === text }).toEqual({
          locale,
          text,
          same: false,
        });
      }
    }
  });
});
