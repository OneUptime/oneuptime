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
 * Criteria names the scan cannot read off a rule form, because the table
 * builds them from the kind of record it matches: RunbookRulesTable takes
 * them from its copy for incidents, alerts and scheduled maintenance events
 * (getRunbookRuleCopy). Every other name is read off the forms, both
 * branches of a condition included (AutoRemediationRulesTable).
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

// The files those names are built in.
const COMPUTED_CRITERIA_SOURCES: Array<string> = [
  "packages/App/FeatureSet/Dashboard/src/Components/Runbook/RunbookRulesTable.tsx",
];

const forms: Array<FormFacts> = scanFormFiles({
  repositoryRoot: REPOSITORY_ROOT,
  files: listScanRoots(REPOSITORY_ROOT).flatMap(
    (root: string): Array<string> => {
      return listSourceFiles(root);
    },
  ),
});

const CRITERIA_FIELDS: Array<FormFieldFacts> = forms
  .filter((form: FormFacts): boolean => {
    return form.isRuleModel;
  })
  .flatMap((form: FormFacts): Array<FormFieldFacts> => {
    return form.fields;
  })
  .filter((field: FormFieldFacts): boolean => {
    return field.stepId === RULE_CRITERIA_STEP_ID;
  });

const WRITTEN_CRITERIA_NAMES: Array<string> = Array.from(
  new Set(
    CRITERIA_FIELDS.flatMap((field: FormFieldFacts): Array<string> => {
      return field.titleTexts || [];
    }).filter((title: string): boolean => {
      return title.length > 0;
    }),
  ),
).sort();

// Criteria whose title is computed (titleTexts null): a copy's property.
const COMPUTED_CRITERIA_FIELDS: Array<FormFieldFacts> = CRITERIA_FIELDS.filter(
  (field: FormFieldFacts): boolean => {
    return field.titleTexts === null;
  },
);

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

  /*
   * A name the scan cannot read is checked below only if it is listed above,
   * so every criteria name a table computes has to come from a file the list
   * speaks for, and the list has to hold exactly the names built there.
   */
  test("every criteria name a table computes is listed above", () => {
    expect(
      Array.from(
        new Set(
          COMPUTED_CRITERIA_FIELDS.map((field: FormFieldFacts): string => {
            return field.file;
          }),
        ),
      ).sort(),
    ).toEqual(COMPUTED_CRITERIA_SOURCES);

    const built: Set<string> = new Set<string>();

    for (const field of COMPUTED_CRITERIA_FIELDS) {
      // `copy.labelsTitle`: every value the file gives that property.
      const property: string | undefined =
        field.title.match(/^\w+\.(\w+)$/)?.[1];

      expect({ title: field.title, isCopyProperty: Boolean(property) }).toEqual(
        { title: field.title, isCopyProperty: true },
      );

      const source: string = fs.readFileSync(
        path.join(REPOSITORY_ROOT, field.file),
        "utf8",
      );
      const values: Array<string> = [
        ...source.matchAll(
          new RegExp(`\\b${property}: translationKey\\(\\s*"([^"]+)"`, "g"),
        ),
      ].map((match: RegExpMatchArray): string => {
        return match[1] as string;
      });

      expect({ title: field.title, hasValues: values.length > 0 }).toEqual({
        title: field.title,
        hasValues: true,
      });

      for (const value of values) {
        built.add(value);
      }
    }

    expect(Array.from(built).sort()).toEqual(
      [...COMPUTED_CRITERIA_NAMES].sort(),
    );
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
