import {
  CUSTOM_FIELD_TYPE_LABELS,
  getCustomFieldTypeLabelForValue,
  IncidentCustomFieldSettingsCopy,
} from "../../FeatureSet/Dashboard/src/Components/CustomFields/CustomFieldSettingsCopy";
import CustomFieldType from "Common/Types/CustomField/CustomFieldType";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Every custom field settings table lists a field's name and its type, and
 * nothing else. The maintainer, looking at the incident one with nine
 * columns: "Too many columns on the table. I think we just need to show
 * field name and field type here, and that's basically it."
 *
 * The two columns live in one place, Components/CustomFields/
 * CustomFieldDefinitionTable, and Common/Tests/App/Dashboard/
 * CustomFieldTablesTwoColumns renders them for each of the nine pages. This
 * suite keeps the rule from drifting where a render cannot see it:
 *
 *   - every custom field definition model in Common has exactly one
 *     settings table in the Dashboard, and every one of them - a tenth
 *     resource's included - takes its columns and filters from the shared
 *     module rather than listing its own;
 *   - the shared module covers every definition model;
 *   - the text of the columns that were taken away is gone from the copy
 *     and from all seventeen locales, while what the table still shows is
 *     in every one of them;
 *   - the type reads as the "Field Type" picker names it.
 */

const APP_DIR: string = path.join(__dirname, "..", "..");
const DASHBOARD_SRC: string = path.join(
  APP_DIR,
  "FeatureSet",
  "Dashboard",
  "src",
);
const MODELS_DIR: string = path.join(
  APP_DIR,
  "..",
  "Common",
  "Models",
  "DatabaseModels",
);
const LOCALES_DIR: string = path.join(DASHBOARD_SRC, "Locales");

const SHARED_MODULE: string = path.join(
  "Components",
  "CustomFields",
  "CustomFieldDefinitionTable.tsx",
);
const BASE_PAGE: string = path.join(
  "Pages",
  "Settings",
  "Base",
  "CustomFieldsPageBase.tsx",
);

const COLUMNS_PROP: string = "columns={getCustomFieldDefinitionColumns()}";
const FILTERS_PROP: string = "filters={getCustomFieldDefinitionFilters()}";

// The column description that went with the Template Variable column.
const REMOVED_LOCALE_KEYS: Array<string> = [
  "Use this in a custom subscriber notification template to show the field's value. It is made from the field's name when the field is created and does not change when the field is renamed.",
];

const listSourceFiles: (directory: string) => Array<string> = (
  directory: string,
): Array<string> => {
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
};

const readDashboardSource: (relativePath: string) => string = (
  relativePath: string,
): string => {
  return fs.readFileSync(path.join(DASHBOARD_SRC, relativePath), "utf8");
};

const readLocale: (file: string) => Record<string, unknown> = (
  file: string,
): Record<string, unknown> => {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, file), "utf8"),
  ) as Record<string, unknown>;
};

/*
 * One definition model per resource, named <Resource>CustomField: the
 * tables that say which custom fields a resource has.
 */
const DEFINITION_MODELS: Array<string> = fs
  .readdirSync(MODELS_DIR)
  .filter((file: string) => {
    return file.endsWith("CustomField.ts");
  })
  .map((file: string) => {
    return file.replace(/\.ts$/, "");
  })
  .sort();

interface SettingsTable {
  file: string;
  model: string;
  source: string;
}

// Every Dashboard file that hands one of them to a component as modelType.
const SETTINGS_TABLES: Array<SettingsTable> = listSourceFiles(DASHBOARD_SRC)
  .map((file: string): Array<SettingsTable> => {
    const source: string = fs.readFileSync(file, "utf8");
    const models: Set<string> = new Set<string>();

    for (const match of source.matchAll(
      /modelType=\{(\w+CustomField)\}|<\w+<(\w+CustomField)>/g,
    )) {
      const model: string = (match[1] || match[2]) as string;

      if (DEFINITION_MODELS.includes(model)) {
        models.add(model);
      }
    }

    return Array.from(models).map((model: string): SettingsTable => {
      return {
        file: path.relative(DASHBOARD_SRC, file),
        model: model,
        source: source,
      };
    });
  })
  .flat()
  .sort((a: SettingsTable, b: SettingsTable) => {
    return a.model.localeCompare(b.model);
  });

const LOCALE_FILES: Array<string> = fs
  .readdirSync(LOCALES_DIR)
  .filter((file: string) => {
    return file.endsWith(".json");
  })
  .sort();

describe("the custom field settings tables", () => {
  test("there are nine definition models, one per resource", () => {
    expect(DEFINITION_MODELS).toEqual([
      "AlertCustomField",
      "IncidentCustomField",
      "InventoryItemCustomField",
      "MonitorCustomField",
      "OnCallDutyPolicyCustomField",
      "ScheduledMaintenanceCustomField",
      "StatusPageCustomField",
      "TeamCustomField",
      "TeamMemberCustomField",
    ]);
  });

  test("every definition model has exactly one settings table", () => {
    expect(
      SETTINGS_TABLES.map((table: SettingsTable) => {
        return table.model;
      }),
    ).toEqual(DEFINITION_MODELS);
  });

  test("the shared columns cover every definition model", () => {
    const shared: string = readDashboardSource(SHARED_MODULE);
    const union: string =
      shared.match(/export type CustomFieldDefinitionModel =([^;]+);/)?.[1] ||
      "";

    const members: Array<string> = union
      .split("|")
      .map((member: string) => {
        return member.trim();
      })
      .filter((member: string) => {
        return member.length > 0;
      })
      .sort();

    expect(members).toEqual(DEFINITION_MODELS);
  });

  test.each(
    SETTINGS_TABLES.map((table: SettingsTable) => {
      return [`${table.file} (${table.model})`, table] as [
        string,
        SettingsTable,
      ];
    }),
  )(
    "%s lists the shared two columns and nothing of its own",
    (_name: string, table: SettingsTable) => {
      /*
       * Either the page is one of the eight that hand their model to the
       * shared base, or it is a table of its own that still takes the
       * shared columns and filters.
       */
      const viaBase: boolean = table.source.includes("<CustomFieldsPageBase");
      const source: string = viaBase
        ? readDashboardSource(BASE_PAGE)
        : table.source;

      if (viaBase) {
        expect(table.source).not.toMatch(/\bcolumns=/);
        expect(table.source).not.toMatch(/\bfilters=/);
      } else {
        expect(table.source).toContain("<ModelTable");
      }

      expect(source).toContain(COLUMNS_PROP);
      expect(source).toContain(FILTERS_PROP);
      expect(source).not.toContain("columns={[");
      expect(source).not.toContain("filters={[");
    },
  );

  test("the shared base page renders one table, with the shared columns", () => {
    const base: string = readDashboardSource(BASE_PAGE);

    expect(base.match(/<ModelTable</g) || []).toHaveLength(1);
    expect(base.split(COLUMNS_PROP)).toHaveLength(2);
    expect(base.split(FILTERS_PROP)).toHaveLength(2);
  });
});

describe("what the taken-away columns said", () => {
  test("the incident settings copy has no column titles left", () => {
    expect(
      Object.keys(IncidentCustomFieldSettingsCopy).filter((key: string) => {
        return key.toLowerCase().includes("column");
      }),
    ).toEqual([]);
  });

  test("there are seventeen Dashboard locales", () => {
    expect(LOCALE_FILES).toHaveLength(17);
  });

  test.each(LOCALE_FILES)(
    "%s no longer carries the Template Variable column's description",
    (file: string) => {
      const translations: Record<string, unknown> = readLocale(file);

      for (const key of REMOVED_LOCALE_KEYS) {
        expect(translations[key]).toBeUndefined();
      }
    },
  );

  test("no Dashboard source still shows that description", () => {
    for (const file of listSourceFiles(DASHBOARD_SRC)) {
      const source: string = fs.readFileSync(file, "utf8");

      for (const key of REMOVED_LOCALE_KEYS) {
        expect({
          file: path.relative(DASHBOARD_SRC, file),
          shows: source.includes(key),
        }).toEqual({ file: path.relative(DASHBOARD_SRC, file), shows: false });
      }
    }
  });

  /*
   * "Template Variable" and "In Subscriber Notifications" stay: the
   * subscriber template editors' list of incident custom fields uses them
   * (IncidentCustomFieldTemplateVariablesCopy).
   */
  test.each(LOCALE_FILES)(
    "%s still names what the table and the template editors show",
    (file: string) => {
      const translations: Record<string, unknown> = readLocale(file);

      for (const key of [
        "Field Name",
        "Field Type",
        "Template Variable",
        "In Subscriber Notifications",
        ...Object.values(CUSTOM_FIELD_TYPE_LABELS),
      ]) {
        expect({ key: key, type: typeof translations[key] }).toEqual({
          key: key,
          type: "string",
        });
      }
    },
  );
});

describe("a field's type, as the table names it", () => {
  test.each(Object.values(CustomFieldType))(
    "%s reads as the picker's name for it",
    (type: CustomFieldType) => {
      expect(getCustomFieldTypeLabelForValue(type)).toBe(
        CUSTOM_FIELD_TYPE_LABELS[type],
      );
    },
  );

  test("the stored names that read badly are never what is shown", () => {
    expect(
      getCustomFieldTypeLabelForValue(CustomFieldType.MultiSelectDropdown),
    ).toBe("Dropdown (multi-select)");
    expect(getCustomFieldTypeLabelForValue(CustomFieldType.Dropdown)).toBe(
      "Dropdown (single select)",
    );
    expect(getCustomFieldTypeLabelForValue(CustomFieldType.DateTime)).toBe(
      "Date and time",
    );
    expect(getCustomFieldTypeLabelForValue(CustomFieldType.LongText)).toBe(
      "Long text",
    );
    expect(getCustomFieldTypeLabelForValue(CustomFieldType.Markdown)).toBe(
      "Rich text (Markdown)",
    );
  });

  test("a type it does not know reads as stored, so the cell is never blank", () => {
    expect(getCustomFieldTypeLabelForValue("Geolocation")).toBe("Geolocation");
  });

  test("an object's own property names are not types", () => {
    for (const name of ["toString", "constructor", "hasOwnProperty"]) {
      expect(getCustomFieldTypeLabelForValue(name)).toBe(name);
    }
  });

  test("no type at all reads as nothing", () => {
    for (const value of [undefined, null, "", "   ", 42, true, {}, []]) {
      expect(getCustomFieldTypeLabelForValue(value)).toBeUndefined();
    }
  });
});
