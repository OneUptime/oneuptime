import IncidentCustomFieldTemplateVariablesCopy from "../../FeatureSet/Dashboard/src/Components/StatusPage/IncidentCustomFieldTemplateVariablesCopy";
import { IncidentCustomFieldSettingsCopy } from "../../FeatureSet/Dashboard/src/Components/CustomFields/CustomFieldSettingsCopy";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The text under a subscriber notification template's variable reference
 * for an incident event - who may place custom fields and labels, and the
 * project's incident custom fields with their template variables - reaches
 * the screen by looking its English text up in the Dashboard locale files.
 * A string with no entry silently stays English, so this pins:
 *
 *   - en.json maps every string to itself, and all sixteen other locales
 *     carry a translation;
 *   - no string holds a "{{", which the lookup would take for a placeholder
 *     of its own (the variables are shown as code, outside the lookup);
 *   - both template pages render the panel under the variable reference;
 *   - the "Include in Subscriber Notifications" setting says where the field
 *     goes now: email, Slack, Microsoft Teams and webhooks, not SMS.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

const LOCALES_DIR: string = path.join(DASHBOARD_SRC, "Locales");

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

/*
 * Entries other pages had before this one, some of them spelled the same in
 * some languages.
 */
const SHARED_WITH_OTHER_FEATURES: Array<string> = [
  "Incident Custom Fields",
  "Template Variable",
  "Field Name",
  "Field Type",
  "In Subscriber Notifications",
  "Yes",
  "No",
];

const STRINGS: Array<string> = Array.from(
  new Set([
    ...Object.values(IncidentCustomFieldTemplateVariablesCopy),
    IncidentCustomFieldSettingsCopy.includeInSubscriberNotificationsDescription,
  ]),
);

function readLocale(locale: string): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), "utf8"),
  ) as Record<string, unknown>;
}

function readSource(...relativePath: Array<string>): string {
  return fs
    .readFileSync(path.join(DASHBOARD_SRC, ...relativePath), "utf8")
    .replace(/\s+/g, " ");
}

describe("the incident custom field template variable strings in every Dashboard locale", () => {
  test("there are strings to check", () => {
    expect(STRINGS.length).toBeGreaterThan(10);
  });

  test.each(STRINGS)("%j holds no placeholder braces", (text: string) => {
    expect(text).not.toContain("{{");
  });

  test.each(STRINGS)("en.json maps %j to itself", (text: string) => {
    expect(readLocale("en")[text]).toBe(text);
  });

  describe.each(OTHER_LOCALES)("%s", (locale: string) => {
    const translations: Record<string, unknown> = readLocale(locale);

    test.each(STRINGS)("translates %j", (text: string) => {
      const value: unknown = translations[text];

      expect(typeof value).toBe("string");
      expect((value as string).trim().length).toBeGreaterThan(0);
      expect(value as string).not.toContain("{{");

      if (!SHARED_WITH_OTHER_FEATURES.includes(text)) {
        expect(value).not.toBe(text);
      }
    });
  });

  test("the setting's old wording, which said only emails, is gone from every locale", () => {
    for (const locale of ["en", ...OTHER_LOCALES]) {
      expect(
        Object.keys(readLocale(locale)).some((key: string): boolean => {
          return key.startsWith(
            "Show this field and its value in the emails status page subscribers get",
          );
        }),
      ).toBe(false);
    }
  });

  test("the setting says which channels carry the field", () => {
    const description: string =
      IncidentCustomFieldSettingsCopy.includeInSubscriberNotificationsDescription;

    for (const channel of ["email", "Slack", "Microsoft Teams", "webhooks"]) {
      expect(description).toContain(channel);
    }
    expect(description).toContain("SMS");
  });
});

describe("the template pages show the incident custom fields", () => {
  test("a template's page renders the panel under its variable reference card", () => {
    const source: string = readSource(
      "Pages",
      "StatusPages",
      "Settings",
      "SubscriberNotificationTemplateView.tsx",
    );

    expect(source).toContain(
      "<IncidentCustomFieldTemplateVariables eventType={eventType} />",
    );
    expect(
      source.indexOf(
        "getSubscriberNotificationTemplateVariablesDocumentation(",
      ),
    ).toBeLessThan(
      source.indexOf("<IncidentCustomFieldTemplateVariables eventType"),
    );
  });

  /*
   * In the template's forms the fields are variables like the rest: under
   * the body, collapsed, each one a click (or a "{{") from going in - with
   * the line on who may place them at the end of that list.
   */
  test.each([
    ["SubscriberNotificationTemplates.tsx"],
    ["SubscriberNotificationTemplateView.tsx"],
  ])("%s offers them in the body's variables", (file: string) => {
    const source: string = readSource("Pages", "StatusPages", "Settings", file);

    expect(source).toContain("getSubscriberTemplateVariableGroups(");
    expect(source).toContain("<SubscriberTemplateVariablesFooter");
    expect(source).toContain("onCustomFieldsChange={setCustomFields}");
  });
});
