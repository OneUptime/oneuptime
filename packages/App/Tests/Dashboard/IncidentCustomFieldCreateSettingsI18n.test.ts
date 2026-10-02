import IncidentCustomFieldCreateSettingsCopy, {
  INCIDENT_TEMPLATE_CUSTOM_FIELD_SETTINGS_STEP_ID,
  INCIDENT_TEMPLATE_CUSTOM_FIELD_SETTINGS_STEP_TITLE,
} from "../../FeatureSet/Dashboard/src/Components/Incident/IncidentCustomFieldCreateSettingsCopy";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Which incident custom fields are asked for when an incident is declared
 * from a template (issue #4114): an incident template's "Custom Fields on
 * Create" card and wizard step - IncidentCustomFieldSettingsCard and its
 * dropdowns. (Incident forms, which once used the same card for their
 * questions, became the Forms product, whose builder asks custom fields its
 * own way.) Their text reaches the screen by looking its English text up in
 * the Dashboard locale files, and a string with no entry silently stays
 * English, so this pins:
 *
 *   - the glossary's words, exactly - the docs quote them;
 *   - en.json maps every string to itself, and all sixteen other locales
 *     carry a real translation, with sentences still sentences, each new key
 *     between the same neighbours as in en.json;
 *   - no string holds a "{{", which the lookup would take for a placeholder;
 *   - the card, the wizard and the pages render through the shared copy, and
 *     the Declare Incident page applies a template's settings and sends its
 *     owners where the server reads them.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

const COMMON_ROOT: string = path.join(__dirname, "..", "..", "..", "Common");

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
 * The same word in that language, not a copy somebody forgot to translate:
 * German says "Optional".
 */
const SAME_WORD: Record<string, Array<string>> = {
  de: ["Optional"],
};

const SENTENCE_ENDINGS: Array<string> = [".", "。", "।"];

const STRINGS: Array<string> = Array.from(
  new Set(Object.values(IncidentCustomFieldCreateSettingsCopy)),
);

const PLACEHOLDER: RegExp = /\{\{[^}]+\}\}/g;

function placeholders(text: string): Array<string> {
  return (text.match(PLACEHOLDER) || []).sort();
}

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

function neighboursOf(
  keys: Array<string>,
  key: string,
): { before: string | undefined; after: string | undefined } {
  const index: number = keys.indexOf(key);

  return {
    before: index > 0 ? keys[index - 1] : undefined,
    after: index >= 0 ? keys[index + 1] : undefined,
  };
}

const englishKeys: Array<string> = Object.keys(readLocale("en"));

describe("the glossary's words", () => {
  test("an incident template's card and wizard step", () => {
    expect(IncidentCustomFieldCreateSettingsCopy.templateTitle).toBe(
      "Custom Fields on Create",
    );
    expect(INCIDENT_TEMPLATE_CUSTOM_FIELD_SETTINGS_STEP_TITLE).toBe(
      IncidentCustomFieldCreateSettingsCopy.templateTitle,
    );
    expect(IncidentCustomFieldCreateSettingsCopy.templateDescription).toBe(
      "Choose which custom fields the Details step asks for when an incident is declared from this template, and which of them must be filled in. Fields left on Default follow their own Show on Create and Required on Create settings.",
    );
    expect([
      IncidentCustomFieldCreateSettingsCopy.templateDefaultRequired,
      IncidentCustomFieldCreateSettingsCopy.templateDefaultOptional,
      IncidentCustomFieldCreateSettingsCopy.templateDefaultNotShown,
      IncidentCustomFieldCreateSettingsCopy.required,
      IncidentCustomFieldCreateSettingsCopy.optional,
      IncidentCustomFieldCreateSettingsCopy.templateHidden,
    ]).toEqual([
      "Default (Required)",
      "Default (Optional)",
      "Default (Not Shown)",
      "Required",
      "Optional",
      "Hidden",
    ]);
    // Beside a setting of the template's own.
    expect([
      IncidentCustomFieldCreateSettingsCopy.templateProjectDefaultRequired,
      IncidentCustomFieldCreateSettingsCopy.templateProjectDefaultOptional,
      IncidentCustomFieldCreateSettingsCopy.templateProjectDefaultNotShown,
    ]).toEqual([
      "Project default: Required",
      "Project default: Optional",
      "Project default: Not Shown",
    ]);
  });

  test("no longer has an incident form's words: forms ask custom fields in their builder", () => {
    expect(
      Object.keys(IncidentCustomFieldCreateSettingsCopy).filter(
        (key: string): boolean => {
          return key.startsWith("form");
        },
      ),
    ).toEqual([]);
  });

  test("the wizard step has an id of its own", () => {
    expect(INCIDENT_TEMPLATE_CUSTOM_FIELD_SETTINGS_STEP_ID).toBe(
      "custom-field-settings",
    );
  });
});

describe("Custom Fields on Create strings in every Dashboard locale", () => {
  test("there are strings to check", () => {
    expect(STRINGS.length).toBe(13);
  });

  test.each(STRINGS)("%j holds no placeholder braces", (text: string) => {
    expect(text).not.toContain("{{");
  });

  test.each(STRINGS)("en.json maps %j to itself", (text: string) => {
    expect(readLocale("en")[text]).toBe(text);
  });

  describe.each(OTHER_LOCALES)("%s", (locale: string) => {
    const translations: Record<string, unknown> = readLocale(locale);
    const keys: Array<string> = Object.keys(translations);

    test.each(STRINGS)("translates %j", (text: string) => {
      const value: unknown = translations[text];

      expect(typeof value).toBe("string");
      expect((value as string).trim().length).toBeGreaterThan(0);
      expect((value as string).includes("{{")).toBe(false);
      expect(placeholders(value as string)).toEqual(placeholders(text));

      if (!(SAME_WORD[locale] || []).includes(text)) {
        expect(value).not.toBe(text);
      }
    });

    test("keeps sentences as sentences and labels as labels", () => {
      const problems: Array<string> = STRINGS.filter(
        (text: string): boolean => {
          const value: string = String(translations[text] || "").trim();
          const isSentence: boolean = text.endsWith(".");
          const endsLikeSentence: boolean = SENTENCE_ENDINGS.some(
            (ending: string): boolean => {
              return value.endsWith(ending);
            },
          );

          return isSentence !== endsLikeSentence;
        },
      );

      expect(problems).toEqual([]);
    });

    test("places every new key between the same neighbours as en.json", () => {
      const misplaced: Array<string> = STRINGS.filter(
        (text: string): boolean => {
          return (
            JSON.stringify(neighboursOf(keys, text)) !==
            JSON.stringify(neighboursOf(englishKeys, text))
          );
        },
      );

      expect(misplaced).toEqual([]);
    });
  });
});

describe("the card, the wizard and the pages render the shared strings and wiring", () => {
  test("the card takes its titles, descriptions and buttons from the copy", () => {
    const card: string = readSource(
      "Components",
      "Incident",
      "IncidentCustomFieldSettingsCard.tsx",
    );

    for (const key of [
      "templateTitle",
      "templateDescription",
      "templateEditButton",
      "templateNotFound",
    ]) {
      expect(card).toContain(`IncidentCustomFieldCreateSettingsCopy.${key}`);
    }

    // Everything it draws itself goes through the lookup.
    expect(card).toContain("translateString(settingLabel)");
    expect(card).toContain("translateString(typeLabel)");
  });

  /*
   * When Edit cannot read the settings again, the modal's button reads them
   * again instead of saving, in words the Dashboard already had. The modal
   * looks them up; pinned so their entries cannot quietly go.
   */
  test("the modal's Try again is in every Dashboard locale", () => {
    const card: string = readSource(
      "Components",
      "Incident",
      "IncidentCustomFieldSettingsCard.tsx",
    );

    expect(card).toContain(
      'const READ_AGAIN_BUTTON_TEXT: string = "Try again";',
    );
    expect(readLocale("en")["Try again"]).toBe("Try again");

    for (const locale of OTHER_LOCALES) {
      const value: unknown = readLocale(locale)["Try again"];

      expect(typeof value).toBe("string");
      expect(value).not.toBe("Try again");
    }
  });

  test("the dropdowns' choices come from the copy", () => {
    const form: string = readSource(
      "Components",
      "Incident",
      "IncidentCustomFieldCreateSettingsForm.ts",
    );

    for (const key of [
      "templateDefaultRequired",
      "templateDefaultOptional",
      "templateDefaultNotShown",
      "templateProjectDefaultRequired",
      "templateProjectDefaultOptional",
      "templateProjectDefaultNotShown",
      "templateHidden",
      "required",
      "optional",
    ]) {
      expect(form).toContain(`IncidentCustomFieldCreateSettingsCopy.${key}`);
    }
  });

  test("a template's page shows the card", () => {
    const view: string = readSource(
      "Pages",
      "Incidents",
      "Settings",
      "IncidentTemplatesView.tsx",
    );

    expect(view).toContain(
      "<IncidentCustomFieldSettingsCard modelId={modelId} />",
    );
    // The card has one job now: no mode to choose.
    expect(
      readSource(
        "Components",
        "Incident",
        "IncidentCustomFieldSettingsCard.tsx",
      ),
    ).not.toContain('mode="form"');
  });

  test("a new template's wizard has the step, packs it and keeps it out of the misc data", () => {
    const list: string = readSource(
      "Pages",
      "Incidents",
      "Settings",
      "IncidentTemplates.tsx",
    );

    expect(list).toContain(
      "title: INCIDENT_TEMPLATE_CUSTOM_FIELD_SETTINGS_STEP_TITLE",
    );
    expect(list).toContain(
      "id: INCIDENT_TEMPLATE_CUSTOM_FIELD_SETTINGS_STEP_ID",
    );
    expect(list).toContain("packCustomFieldSettingsFormValues({");
    expect(list).toContain("removeCustomFieldSettingsFormKeys(miscDataProps)");
    // The step that sets the values is still there.
    expect(list).toContain("INCIDENT_TEMPLATE_CUSTOM_FIELDS_STEP_TITLE");
  });

  test("the Declare Incident page applies a template's settings to the Details step", () => {
    const create: string = readSource("Pages", "Incidents", "Create.tsx");

    expect(create).toContain("customFieldSettings: true,");
    expect(create).toContain(
      "getDetailsStepDefinitions( applyTemplateCustomFieldCreateSettings( customFieldDefinitions, templateCustomFieldSettings, ), )",
    );
    expect(create).toContain('delete initialValue["customFieldSettings"];');
  });

  test("the Declare Incident page sends a template's owners where the server reads them", () => {
    const create: string = readSource("Pages", "Incidents", "Create.tsx");

    expect(create).toContain(
      'miscDataProps["ownerUsers"] = templateOwners.userIds;',
    );
    expect(create).toContain(
      'miscDataProps["ownerTeams"] = templateOwners.teamIds;',
    );

    const incidentService: string = fs
      .readFileSync(
        path.join(COMMON_ROOT, "Server", "Services", "IncidentService.ts"),
        "utf8",
      )
      .replace(/\s+/g, " ");

    expect(incidentService).toMatch(/miscDataProps\[ ?"ownerUsers" ?\]/);
    expect(incidentService).toMatch(/miscDataProps\[ ?"ownerTeams" ?\]/);
  });
});
