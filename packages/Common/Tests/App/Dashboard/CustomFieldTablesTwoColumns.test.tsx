import "@testing-library/jest-dom";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import fs from "fs";
import { createInstance, i18n } from "i18next";
import path from "path";
import React, { FunctionComponent, ReactElement, ReactNode } from "react";
import { I18nextProvider } from "react-i18next";

/*
 * The custom field settings tables list a field's name and its type, and
 * nothing else. The maintainer, looking at the incident one - Field Name,
 * Field Description, Field Type, Mapped From, Order, Show on Create, In
 * Subscriber Notifications, Template Variable and Actions: "Too many columns
 * on the table. I think we just need to show field name and field type here,
 * and that's basically it."
 *
 * What must hold, for all nine tables - the eight resources that go through
 * CustomFieldsPageBase and the team member one, which has its own page:
 *
 *   - the table is handed exactly two columns, Field Name then Field Type,
 *     none of them hidden-by-default extras a viewer could switch back on;
 *   - it filters by exactly those two, the type from the same named list
 *     the form's picker offers;
 *   - a field can still be created, edited and deleted, and its form still
 *     asks for the description that is no longer a column;
 *   - the type cell names the type as the picker does - "Dropdown
 *     (multi-select)", never "MultiSelectDropdown" - in the viewer's
 *     language, and the CSV says the same.
 *
 * ModelTable is stubbed and its props recorded: the columns, filters and
 * form fields a page hands it are the page's whole contract. The real table
 * rendering these columns is CustomFieldDefinitionTableRender.test.tsx.
 */

const recordedTables: Array<Record<string, unknown>> = [];

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: Record<string, unknown>): ReactElement => {
      recordedTables.push(props);
      return React.createElement("div", { "data-testid": "model-table" });
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: () => {
        return "11111111-1111-4111-8111-111111111111";
      },
    },
  };
});

import {
  CUSTOM_FIELD_NAME_COLUMN_TITLE,
  CUSTOM_FIELD_TYPE_COLUMN_TITLE,
  CustomFieldTypeText,
  getCustomFieldDefinitionColumns,
  getCustomFieldDefinitionFilters,
} from "../../../../App/FeatureSet/Dashboard/src/Components/CustomFields/CustomFieldDefinitionTable";
import {
  CUSTOM_FIELD_TYPE_LABELS,
  getCustomFieldTypeOptions,
} from "../../../../App/FeatureSet/Dashboard/src/Components/CustomFields/CustomFieldSettingsCopy";
import AlertCustomFields from "../../../../App/FeatureSet/Dashboard/src/Pages/Alerts/Settings/AlertCustomFields";
import IncidentCustomFields from "../../../../App/FeatureSet/Dashboard/src/Pages/Incidents/Settings/IncidentCustomFields";
import InventoryCustomFields from "../../../../App/FeatureSet/Dashboard/src/Pages/Inventory/Settings/CustomFields";
import MonitorCustomFields from "../../../../App/FeatureSet/Dashboard/src/Pages/Monitor/Settings/MonitorCustomFields";
import OnCallDutyPolicyCustomFields from "../../../../App/FeatureSet/Dashboard/src/Pages/OnCallDuty/Settings/OnCallDutyPolicyCustomFields";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import ScheduledMaintenanceCustomFields from "../../../../App/FeatureSet/Dashboard/src/Pages/ScheduledMaintenanceEvents/Settings/ScheduledMaintenanceCusomFields";
import StatusPageCustomFields from "../../../../App/FeatureSet/Dashboard/src/Pages/StatusPages/Settings/StatusPageCustomFields";
import TeamCustomFields from "../../../../App/FeatureSet/Dashboard/src/Pages/Teams/CustomFields";
import TeamMemberCustomFields from "../../../../App/FeatureSet/Dashboard/src/Pages/Users/CustomFields";
import AlertCustomField from "../../../Models/DatabaseModels/AlertCustomField";
import IncidentCustomField from "../../../Models/DatabaseModels/IncidentCustomField";
import InventoryItemCustomField from "../../../Models/DatabaseModels/InventoryItemCustomField";
import MonitorCustomField from "../../../Models/DatabaseModels/MonitorCustomField";
import OnCallDutyPolicyCustomField from "../../../Models/DatabaseModels/OnCallDutyPolicyCustomField";
import ScheduledMaintenanceCustomField from "../../../Models/DatabaseModels/ScheduledMaintenanceCustomField";
import StatusPageCustomField from "../../../Models/DatabaseModels/StatusPageCustomField";
import TeamCustomField from "../../../Models/DatabaseModels/TeamCustomField";
import TeamMemberCustomField from "../../../Models/DatabaseModels/TeamMemberCustomField";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Route from "../../../Types/API/Route";
import CustomFieldType from "../../../Types/CustomField/CustomFieldType";
import FieldType from "../../../UI/Components/Types/FieldType";

interface RecordedColumn {
  field?: Record<string, unknown>;
  title?: string;
  type?: FieldType;
  isHiddenByDefault?: boolean;
  getElement?: (item: BaseModel) => ReactElement;
  getExportValue?: (item: BaseModel) => string;
}

interface RecordedFilter {
  field?: Record<string, unknown>;
  title?: string;
  type?: FieldType;
  filterDropdownOptions?: Array<{ label: string; value: string }>;
}

interface RecordedFormField {
  field?: Record<string, unknown>;
}

type PageComponent = FunctionComponent<PageComponentProps>;

interface SettingsTable {
  name: string;
  page: PageComponent;
  modelType: { new (): BaseModel };
}

// Every custom field settings table in the Dashboard: one per resource.
const SETTINGS_TABLES: Array<SettingsTable> = [
  {
    name: "Incident",
    page: IncidentCustomFields,
    modelType: IncidentCustomField,
  },
  { name: "Alert", page: AlertCustomFields, modelType: AlertCustomField },
  { name: "Monitor", page: MonitorCustomFields, modelType: MonitorCustomField },
  {
    name: "Scheduled Maintenance",
    page: ScheduledMaintenanceCustomFields,
    modelType: ScheduledMaintenanceCustomField,
  },
  {
    name: "Status Page",
    page: StatusPageCustomFields,
    modelType: StatusPageCustomField,
  },
  {
    name: "On-Call Policy",
    page: OnCallDutyPolicyCustomFields,
    modelType: OnCallDutyPolicyCustomField,
  },
  {
    name: "Inventory",
    page: InventoryCustomFields,
    modelType: InventoryItemCustomField,
  },
  { name: "Team", page: TeamCustomFields, modelType: TeamCustomField },
  {
    name: "Team Member",
    page: TeamMemberCustomFields,
    modelType: TeamMemberCustomField,
  },
];

/*
 * What every one of them used to show besides the name and type, and must
 * not show or filter by again.
 */
const FORMER_COLUMN_KEYS: Array<string> = [
  "description",
  "mapFromResourceType",
  "mapFromCustomFieldName",
  "sortOrder",
  "showOnCreate",
  "isRequiredOnCreate",
  "includeInSubscriberNotifications",
  "variableKey",
];

const LOCALES_DIR: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "App",
  "FeatureSet",
  "Dashboard",
  "src",
  "Locales",
);

const readLocale: (locale: string) => Record<string, string> = (
  locale: string,
): Record<string, string> => {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), "utf8"),
  ) as Record<string, string>;
};

const renderPage: (table: SettingsTable) => Record<string, unknown> = (
  table: SettingsTable,
): Record<string, unknown> => {
  const Page: PageComponent = table.page;

  render(
    <Page
      pageRoute={new Route("/dashboard/project/settings/custom-fields")}
      currentProject={null}
      hasPaymentMethod={true}
    />,
  );

  const recorded: Record<string, unknown> | undefined =
    recordedTables[recordedTables.length - 1];

  if (!recorded) {
    throw new Error(`${table.name}: ModelTable was not rendered.`);
  }

  return recorded;
};

const keyOf: (entry: { field?: Record<string, unknown> }) => string = (entry: {
  field?: Record<string, unknown>;
}): string => {
  return Object.keys(entry.field || {})[0] || "";
};

const definitionOfType: (type: unknown) => BaseModel = (
  type: unknown,
): BaseModel => {
  const definition: IncidentCustomField = new IncidentCustomField();
  (definition as unknown as { customFieldType: unknown }).customFieldType =
    type;
  return definition;
};

// The type cell the table would draw for a definition of this type.
const typeCell: (type: unknown) => ReactElement = (
  type: unknown,
): ReactElement => {
  const column: RecordedColumn = (
    getCustomFieldDefinitionColumns() as unknown as Array<RecordedColumn>
  )[1]!;

  return column.getElement!(definitionOfType(type));
};

beforeEach(() => {
  recordedTables.length = 0;
});

afterEach(() => {
  cleanup();
});

describe.each(SETTINGS_TABLES)(
  "the $name custom field settings table",
  (table: SettingsTable) => {
    test("is a table of that resource's custom field definitions", () => {
      expect(renderPage(table)["modelType"]).toBe(table.modelType);
    });

    test("has exactly two columns: Field Name, then Field Type", () => {
      const columns: Array<RecordedColumn> = renderPage(table)[
        "columns"
      ] as Array<RecordedColumn>;

      expect(
        columns.map((column: RecordedColumn) => {
          return { key: keyOf(column), title: column.title };
        }),
      ).toEqual([
        { key: "name", title: "Field Name" },
        { key: "customFieldType", title: "Field Type" },
      ]);
      expect(columns[0]!.type).toBe(FieldType.Text);
      expect(columns[1]!.type).toBe(FieldType.Element);
    });

    test("has no hidden extra column a viewer could switch back on", () => {
      const columns: Array<RecordedColumn> = renderPage(table)[
        "columns"
      ] as Array<RecordedColumn>;

      for (const column of columns) {
        expect(column.isHiddenByDefault).toBeFalsy();
      }

      const keys: Array<string> = columns.map(keyOf);

      for (const key of FORMER_COLUMN_KEYS) {
        expect(keys).not.toContain(key);
      }
    });

    test("filters by the name and the type, and nothing else", () => {
      const filters: Array<RecordedFilter> = renderPage(table)[
        "filters"
      ] as Array<RecordedFilter>;

      expect(
        filters.map((filter: RecordedFilter) => {
          return { key: keyOf(filter), title: filter.title };
        }),
      ).toEqual([
        { key: "name", title: "Field Name" },
        { key: "customFieldType", title: "Field Type" },
      ]);
      expect(filters[0]!.type).toBe(FieldType.Text);
    });

    test("filters the type from the picker's own list of names", () => {
      const filters: Array<RecordedFilter> = renderPage(table)[
        "filters"
      ] as Array<RecordedFilter>;

      const typeFilter: RecordedFilter = filters[1]!;

      expect(typeFilter.type).toBe(FieldType.Dropdown);
      expect(typeFilter.filterDropdownOptions).toEqual(
        getCustomFieldTypeOptions().map(
          (option: { label: string; value: string }) => {
            return { label: option.label, value: option.value };
          },
        ),
      );
    });

    test("still creates, edits and deletes fields - the rest is on the form", () => {
      const recorded: Record<string, unknown> = renderPage(table);

      expect(recorded["isCreateable"]).toBe(true);
      expect(recorded["isEditable"]).toBe(true);
      expect(recorded["isDeleteable"]).toBe(true);

      const formKeys: Array<string> = (
        recorded["formFields"] as Array<RecordedFormField>
      ).map(keyOf);

      // The description left the table, not the field.
      expect(formKeys).toContain("description");
      expect(formKeys).toContain("name");
      expect(formKeys).toContain("customFieldType");
    });

    test("names a field's type as the picker does", () => {
      const columns: Array<RecordedColumn> = renderPage(table)[
        "columns"
      ] as Array<RecordedColumn>;

      render(
        columns[1]!.getElement!(
          definitionOfType(CustomFieldType.MultiSelectDropdown),
        ),
      );

      expect(screen.getByText("Dropdown (multi-select)")).toBeInTheDocument();
      expect(screen.queryByText("MultiSelectDropdown")).not.toBeInTheDocument();
    });
  },
);

describe("the incident table keeps its drag order", () => {
  test("still drags by sortOrder with only the two columns", () => {
    const recorded: Record<string, unknown> = renderPage(SETTINGS_TABLES[0]!);

    expect(recorded["enableDragAndDrop"]).toBe(true);
    expect(recorded["dragDropIndexField"]).toBe("sortOrder");
    expect((recorded["columns"] as Array<RecordedColumn>).map(keyOf)).toEqual([
      "name",
      "customFieldType",
    ]);
  });
});

describe("the shared columns and filters", () => {
  test("are titled through constants the locale files carry", () => {
    expect(CUSTOM_FIELD_NAME_COLUMN_TITLE).toBe("Field Name");
    expect(CUSTOM_FIELD_TYPE_COLUMN_TITLE).toBe("Field Type");

    for (const locale of ["en", "de", "fr", "ja", "fa"]) {
      const translations: Record<string, string> = readLocale(locale);

      expect(typeof translations[CUSTOM_FIELD_NAME_COLUMN_TITLE]).toBe(
        "string",
      );
      expect(typeof translations[CUSTOM_FIELD_TYPE_COLUMN_TITLE]).toBe(
        "string",
      );
    }
  });

  test("are built afresh for every table, so no page can change another's", () => {
    expect(getCustomFieldDefinitionColumns()).not.toBe(
      getCustomFieldDefinitionColumns(),
    );
    expect(getCustomFieldDefinitionFilters()).not.toBe(
      getCustomFieldDefinitionFilters(),
    );
    expect(getCustomFieldDefinitionColumns()).toHaveLength(2);
    expect(getCustomFieldDefinitionFilters()).toHaveLength(2);
  });
});

describe("the Field Type cell", () => {
  test.each(Object.values(CustomFieldType))(
    "names %s as the picker does",
    (type: CustomFieldType) => {
      render(typeCell(type));

      expect(screen.getByTestId("custom-field-type").textContent).toBe(
        CUSTOM_FIELD_TYPE_LABELS[type],
      );
    },
  );

  test("never shows a stored value where the picker has a name for it", () => {
    for (const type of [
      CustomFieldType.MultiSelectDropdown,
      CustomFieldType.DateTime,
      CustomFieldType.LongText,
      CustomFieldType.Markdown,
    ]) {
      render(typeCell(type));

      expect(screen.getByTestId("custom-field-type").textContent).not.toBe(
        type,
      );

      cleanup();
    }
  });

  test("shows a type it does not know as it is stored, rather than nothing", () => {
    render(typeCell("Geolocation"));

    expect(screen.getByTestId("custom-field-type").textContent).toBe(
      "Geolocation",
    );
  });

  test("shows a dash for a definition with no type", () => {
    for (const missing of [undefined, null, "", "   "]) {
      render(typeCell(missing));

      expect(screen.getByTestId("custom-field-type").textContent).toBe("-");

      cleanup();
    }
  });

  test("puts the picker's name in the CSV, not the stored value", () => {
    const column: RecordedColumn = (
      getCustomFieldDefinitionColumns() as unknown as Array<RecordedColumn>
    )[1]!;

    expect(
      column.getExportValue!(
        definitionOfType(CustomFieldType.MultiSelectDropdown),
      ),
    ).toBe("Dropdown (multi-select)");
    expect(column.getExportValue!(definitionOfType(CustomFieldType.Text))).toBe(
      "Text",
    );
    expect(column.getExportValue!(definitionOfType(undefined))).toBe("");
  });

  describe("in another language", () => {
    const german: i18n = createInstance();

    beforeAll(async () => {
      await german.init({
        lng: "de",
        fallbackLng: "de",
        resources: {
          de: {
            translation: readLocale("de"),
          },
        },
        interpolation: { escapeValue: false },
      });
    });

    const InGerman: FunctionComponent<{ children?: ReactNode }> = (props: {
      children?: ReactNode;
    }): ReactElement => {
      return <I18nextProvider i18n={german}>{props.children}</I18nextProvider>;
    };

    test.each(Object.values(CustomFieldType))(
      "translates the name of %s",
      (type: CustomFieldType) => {
        const translated: string | undefined =
          readLocale("de")[CUSTOM_FIELD_TYPE_LABELS[type]];

        expect(typeof translated).toBe("string");

        render(<CustomFieldTypeText value={type} />, { wrapper: InGerman });

        expect(screen.getByTestId("custom-field-type").textContent).toBe(
          translated,
        );
      },
    );

    test("a multi-select reads as German, not as the English label", () => {
      render(
        <CustomFieldTypeText value={CustomFieldType.MultiSelectDropdown} />,
        {
          wrapper: InGerman,
        },
      );

      expect(screen.getByTestId("custom-field-type").textContent).toBe(
        "Dropdown (Mehrfachauswahl)",
      );
    });
  });
});
