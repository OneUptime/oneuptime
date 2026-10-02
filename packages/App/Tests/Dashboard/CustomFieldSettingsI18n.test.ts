import IncidentCustomFieldSettingsCopy, {
  CUSTOM_FIELD_TYPE_LABELS,
  CustomFieldsPageCopy,
} from "../../FeatureSet/Dashboard/src/Components/CustomFields/CustomFieldSettingsCopy";
import { INCIDENT_CUSTOM_FIELD_TABLE_VIEW_IDS } from "Common/Types/CustomField/CustomFieldSavedViews";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The custom field settings pages' text - the field type names, the card's
 * description (and the one that says the fields can be dragged into order),
 * and the incident-only settings (show and require on create, subscriber
 * notifications, template variable) - reaches the screen by looking its
 * English text up in the Dashboard locale files. A string with no entry
 * silently stays English, so this pins:
 *
 *   - en.json maps every string to itself, and all sixteen other locales
 *     carry a translation with the same {{placeholders}};
 *   - the settings pages render through the shared constants;
 *   - every table of incidents that can save views is one whose saved views
 *     a custom field rename rewrites (INCIDENT_CUSTOM_FIELD_TABLE_VIEW_IDS).
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
 * Entries other pages already had, some of them spelled the same in some
 * languages ("Text" in German), and one that is simply the same word
 * ("Date" in French).
 */
const SHARED_WITH_OTHER_FEATURES: Array<string> = ["Text", "Number"];
const SAME_WORD: Record<string, Array<string>> = {
  fr: ["Date"],
};

const STRINGS: Array<string> = Array.from(
  new Set([
    ...Object.values(CUSTOM_FIELD_TYPE_LABELS),
    ...Object.values(CustomFieldsPageCopy),
    ...Object.values(IncidentCustomFieldSettingsCopy),
  ]),
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

function listSourceFiles(directory: string): Array<string> {
  const files: Array<string> = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      if (entry.name === "Locales" || entry.name === "node_modules") {
        continue;
      }

      files.push(...listSourceFiles(fullPath));
    } else if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) {
      files.push(fullPath);
    }
  }

  return files;
}

describe("custom field settings strings in every Dashboard locale", () => {
  test("there are strings to check", () => {
    expect(STRINGS.length).toBeGreaterThan(15);
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
      expect(placeholders(value as string)).toEqual(placeholders(text));

      if (
        !SHARED_WITH_OTHER_FEATURES.includes(text) &&
        !(SAME_WORD[locale] || []).includes(text)
      ) {
        expect(value).not.toBe(text);
      }
    });
  });
});

describe("the settings pages render the shared strings", () => {
  test("every custom field settings page labels the types from one list", () => {
    const base: string = readSource(
      "Pages",
      "Settings",
      "Base",
      "CustomFieldsPageBase.tsx",
    );
    const teamMembers: string = readSource(
      "Pages",
      "Users",
      "CustomFields.tsx",
    );

    for (const source of [base, teamMembers]) {
      expect(source).toContain("dropdownOptions: getCustomFieldTypeOptions()");
      expect(source).not.toContain("Object.keys(CustomFieldType)");
    }
  });

  test("the incident settings take their text from the shared copy", () => {
    const source: string = readSource(
      "Pages",
      "Settings",
      "Base",
      "CustomFieldsPageBase.tsx",
    );

    for (const key of [
      "showOnCreateTitle",
      "showOnCreateDescription",
      "isRequiredOnCreateTitle",
      "isRequiredOnCreateDescription",
      "includeInSubscriberNotificationsTitle",
      "includeInSubscriberNotificationsDescription",
      "includeInSubscriberNotificationsColumnTitle",
      "variableKeyColumnTitle",
      "variableKeyColumnDescription",
    ]) {
      expect(source).toContain(`IncidentCustomFieldSettingsCopy.${key}`);
    }
  });

  /*
   * Where a field sits is set by dragging the rows, so the form has no Order
   * to type in and the card says how to change it instead.
   */
  test("the card describes itself through the shared copy, and never asks for an order", () => {
    const source: string = readSource(
      "Pages",
      "Settings",
      "Base",
      "CustomFieldsPageBase.tsx",
    );

    expect(source).toContain("CUSTOM_FIELDS_REORDER_DESCRIPTION");
    expect(source).toContain("CUSTOM_FIELDS_DESCRIPTION");
    expect(source).toContain("enableDragAndDrop: true");
    expect(source).not.toContain("sortOrder: true");
    expect(source).not.toContain("SORT_ORDER_PLACEHOLDER");
    expect(
      Object.keys(IncidentCustomFieldSettingsCopy).filter((key: string) => {
        return key.toLowerCase().includes("order");
      }),
    ).toEqual([]);
  });
});

describe("saved views that a custom field rename rewrites", () => {
  const files: Array<string> = listSourceFiles(DASHBOARD_SRC);

  test("only the incidents table shows incident custom field columns", () => {
    const tables: Array<string> = files
      .filter((file: string) => {
        return fs
          .readFileSync(file, "utf8")
          .includes("customFieldsModelType={IncidentCustomField}");
      })
      .map((file: string) => {
        return path.relative(DASHBOARD_SRC, file);
      });

    expect(tables).toEqual([
      path.join("Components", "Incident", "IncidentsTable.tsx"),
    ]);
  });

  test("every incidents table with saved views is listed", () => {
    const tableIds: Array<string> = [];

    for (const file of files) {
      const source: string = fs.readFileSync(file, "utf8");
      let from: number = source.indexOf("<IncidentsTable");

      while (from !== -1) {
        const end: number = source.indexOf("/>", from);
        const element: string = source.slice(
          from,
          end === -1 ? undefined : end,
        );
        const match: RegExpMatchArray | null = element.match(
          /saveFilterProps=\{\{\s*tableId:\s*"([^"]+)"/,
        );

        if (match) {
          tableIds.push(match[1]!);
        }

        from = source.indexOf("<IncidentsTable", from + 1);
      }
    }

    // The Incidents list has saved views today.
    expect(tableIds).toContain("all-incidents-table");

    for (const tableId of tableIds) {
      expect(INCIDENT_CUSTOM_FIELD_TABLE_VIEW_IDS).toContain(tableId);
    }
  });
});
