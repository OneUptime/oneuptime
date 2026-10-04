import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { cleanup, render } from "@testing-library/react";
import React, { ReactElement } from "react";

/*
 * The custom field settings pages. Incident fields have three more settings
 * than the other eight resources - whether they are asked for (and
 * required) when an incident is declared, and whether they go out in
 * subscriber emails - plus the key templates reach them by, and an order:
 * the order they are listed in, which is set by dragging the rows, never
 * typed in. What must hold:
 *
 *   - the incident settings page offers the three inputs on its form, and
 *     is dragged into order with no Order input or column at all;
 *   - none of them is a column: every settings table lists a field's name
 *     and type only (CustomFieldTablesTwoColumns.test.tsx covers all nine);
 *   - no other resource's page offers them, because its definition table
 *     has none of those columns and the form would fail;
 *   - every settings page, the team member one included, offers the Long
 *     text and Rich text types with readable labels.
 *
 * ModelTable is stubbed and its props recorded: the form fields and columns
 * it is handed are the page's whole contract.
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

import CustomFieldsPageBase from "../../../../App/FeatureSet/Dashboard/src/Pages/Settings/Base/CustomFieldsPageBase";
import TeamMemberCustomFields from "../../../../App/FeatureSet/Dashboard/src/Pages/Users/CustomFields";
import IncidentCustomFieldSettingsCopy, {
  CUSTOM_FIELD_TYPE_LABELS,
  CustomFieldsPageCopy,
  getCustomFieldTypeOptions,
} from "../../../../App/FeatureSet/Dashboard/src/Components/CustomFields/CustomFieldSettingsCopy";
import AlertCustomField from "../../../Models/DatabaseModels/AlertCustomField";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import IncidentCustomField from "../../../Models/DatabaseModels/IncidentCustomField";
import InventoryItemCustomField from "../../../Models/DatabaseModels/InventoryItemCustomField";
import MonitorCustomField from "../../../Models/DatabaseModels/MonitorCustomField";
import OnCallDutyPolicyCustomField from "../../../Models/DatabaseModels/OnCallDutyPolicyCustomField";
import ScheduledMaintenanceCustomField from "../../../Models/DatabaseModels/ScheduledMaintenanceCustomField";
import StatusPageCustomField from "../../../Models/DatabaseModels/StatusPageCustomField";
import TeamCustomField from "../../../Models/DatabaseModels/TeamCustomField";
import Route from "../../../Types/API/Route";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import CustomFieldType from "../../../Types/CustomField/CustomFieldType";
import { JSONObject } from "../../../Types/JSON";
import FormFieldSchemaType from "../../../UI/Components/Forms/Types/FormFieldSchemaType";

interface RecordedField {
  field?: Record<string, unknown>;
  title?: string;
  description?: string;
  fieldType?: FormFieldSchemaType;
  required?: unknown;
  showIf?: (values: JSONObject) => boolean;
  dropdownOptions?: Array<{ label: string; value: string }>;
  collapsibleSection?: { title: string };
}

interface RecordedColumn {
  field?: Record<string, unknown>;
  title?: string;
}

const INCIDENT_SETTINGS: Array<string> = [
  "showOnCreate",
  "isRequiredOnCreate",
  "includeInSubscriberNotifications",
];

function renderSettingsPage(modelType: { new (): BaseModel }): void {
  render(
    <CustomFieldsPageBase
      pageRoute={new Route("/dashboard/project/settings/custom-fields")}
      currentProject={null}
      hasPaymentMethod={true}
      title="Custom Fields"
      modelType={modelType as never}
    />,
  );
}

function lastTable(): Record<string, unknown> {
  const table: Record<string, unknown> | undefined =
    recordedTables[recordedTables.length - 1];

  if (!table) {
    throw new Error("ModelTable was not rendered.");
  }

  return table;
}

function formFields(): Array<RecordedField> {
  return lastTable()["formFields"] as Array<RecordedField>;
}

function columns(): Array<RecordedColumn> {
  return lastTable()["columns"] as Array<RecordedColumn>;
}

function formField(key: string): RecordedField | undefined {
  return formFields().find((field: RecordedField) => {
    return Boolean(field.field?.[key]);
  });
}

function column(key: string): RecordedColumn | undefined {
  return columns().find((candidate: RecordedColumn) => {
    return Boolean(candidate.field?.[key]);
  });
}

beforeEach(() => {
  recordedTables.length = 0;
});

afterEach(() => {
  cleanup();
});

describe("incident custom field settings", () => {
  test("offers show on create, required on create and subscriber notifications", () => {
    renderSettingsPage(IncidentCustomField);

    expect(formField("showOnCreate")).toMatchObject({
      title: IncidentCustomFieldSettingsCopy.showOnCreateTitle,
      fieldType: FormFieldSchemaType.Toggle,
      required: false,
    });
    expect(formField("isRequiredOnCreate")).toMatchObject({
      title: IncidentCustomFieldSettingsCopy.isRequiredOnCreateTitle,
      fieldType: FormFieldSchemaType.Toggle,
      required: false,
    });
    expect(formField("includeInSubscriberNotifications")).toMatchObject({
      title:
        IncidentCustomFieldSettingsCopy.includeInSubscriberNotificationsTitle,
      fieldType: FormFieldSchemaType.Toggle,
      required: false,
    });
  });

  /*
   * "Options like 'Show on create' and stuff ... should be hidden in the
   * advanced section of the page." After the field's type and options, and
   * after where its value comes from (Edit only), followed only by the
   * read-only template variable line - all in one Advanced section.
   */
  test("folds the three settings under Advanced, after the field's type, options and mapping", () => {
    renderSettingsPage(IncidentCustomField);

    const keys: Array<string> = formFields().map((field: RecordedField) => {
      return Object.keys(field.field || {})[0] || "";
    });

    expect(keys).toEqual([
      "name",
      "description",
      "customFieldType",
      "dropdownOptions",
      "mapFromResourceType",
      "mapFromCustomFieldName",
      ...INCIDENT_SETTINGS,
      // The template variable line, keyed by the column it is checked against.
      "",
    ]);

    for (const key of INCIDENT_SETTINGS) {
      expect(formField(key)?.collapsibleSection?.title).toBe("More fields");
    }
  });

  /*
   * The maintainer's ask: no Order number in the form or the table - the
   * rows are dragged into order and a new field goes to the end.
   */
  test("asks for no order: the form has no Order input and the table no Order column", () => {
    renderSettingsPage(IncidentCustomField);

    expect(formField("sortOrder")).toBeUndefined();
    expect(column("sortOrder")).toBeUndefined();

    for (const field of formFields()) {
      expect(field.fieldType === FormFieldSchemaType.Number).toBe(false);
      expect((field.title || "").toLowerCase()).not.toContain("order");
    }
  });

  test("is dragged into order, by the column the list keeps", () => {
    renderSettingsPage(IncidentCustomField);

    expect(lastTable()["enableDragAndDrop"]).toBe(true);
    expect(lastTable()["dragDropIndexField"]).toBe("sortOrder");
    expect(new IncidentCustomField().getListOrder()?.column).toBe(
      lastTable()["dragDropIndexField"],
    );
  });

  test("says on the card that a field is dragged to change where it appears", () => {
    renderSettingsPage(IncidentCustomField);

    expect(
      (lastTable()["cardProps"] as { description: string }).description,
    ).toBe(CustomFieldsPageCopy.reorderDescription);
  });

  test("asks whether a field is required only when it is shown on create", () => {
    renderSettingsPage(IncidentCustomField);

    const required: RecordedField = formField("isRequiredOnCreate")!;

    expect(required.showIf!({ showOnCreate: true })).toBe(true);
    expect(required.showIf!({ showOnCreate: false })).toBe(false);
    expect(required.showIf!({})).toBe(false);
  });

  test("warns that subscriber notifications go to people outside the team", () => {
    renderSettingsPage(IncidentCustomField);

    expect(
      formField("includeInSubscriberNotifications")!.description,
    ).toContain("outside your team");
    expect(formField("isRequiredOnCreate")!.description).toContain(
      "monitors, the API, Slack, Microsoft Teams or AI",
    );
  });

  /*
   * "Too many columns on the table. I think we just need to show field name
   * and field type here, and that's basically it." The settings are on the
   * form above; an incident field's template variable is listed by the
   * note and subscriber template editors, where it is used.
   */
  test("lists none of the settings, nor the template variable, as a column", () => {
    renderSettingsPage(IncidentCustomField);

    for (const key of [...INCIDENT_SETTINGS, "variableKey"]) {
      expect(column(key)).toBeUndefined();
    }

    expect(
      columns().map((candidate: RecordedColumn) => {
        return candidate.title;
      }),
    ).toEqual(["Field Name", "Field Type"]);
  });

  test("lists the fields in their order", () => {
    renderSettingsPage(IncidentCustomField);

    expect(lastTable()["sortBy"]).toBe("sortOrder");
    expect(lastTable()["sortOrder"]).toBe(SortOrder.Ascending);
  });

  test("offers Long text and Rich text with readable labels", () => {
    renderSettingsPage(IncidentCustomField);

    const options: Array<{ label: string; value: string }> =
      formField("customFieldType")!.dropdownOptions!;

    expect(options).toContainEqual({
      label: "Long text",
      value: CustomFieldType.LongText,
    });
    expect(options).toContainEqual({
      label: "Rich text (Markdown)",
      value: CustomFieldType.Markdown,
    });
    expect(options).toHaveLength(Object.values(CustomFieldType).length);
  });
});

describe("the other resources' custom field settings", () => {
  test.each([
    ["Alert", AlertCustomField],
    ["Monitor", MonitorCustomField],
    ["Status Page", StatusPageCustomField],
    ["Inventory Item", InventoryItemCustomField],
    ["Scheduled Maintenance", ScheduledMaintenanceCustomField],
    ["On-Call Policy", OnCallDutyPolicyCustomField],
    ["Team", TeamCustomField],
  ])(
    "%s fields have none of the incident-only settings",
    (_name: string, modelType: { new (): BaseModel }) => {
      renderSettingsPage(modelType);

      for (const key of [...INCIDENT_SETTINGS, "sortOrder", "variableKey"]) {
        expect(formField(key)).toBeUndefined();
        expect(column(key)).toBeUndefined();
      }

      // Their fields have no order to keep, so there is nothing to drag.
      expect(lastTable()["sortBy"]).toBeUndefined();
      expect(lastTable()["enableDragAndDrop"]).toBeUndefined();
      expect(new modelType().getListOrder()).toBeNull();
      expect(
        (lastTable()["cardProps"] as { description: string }).description,
      ).toBe(CustomFieldsPageCopy.description);

      // They still get the two new types.
      const values: Array<string> = formField(
        "customFieldType",
      )!.dropdownOptions!.map((option: { value: string }) => {
        return option.value;
      });

      expect(values).toContain(CustomFieldType.LongText);
      expect(values).toContain(CustomFieldType.Markdown);
    },
  );
});

describe("team member custom field settings", () => {
  test("offers every type, with the same labels as the other pages", () => {
    render(
      <TeamMemberCustomFields
        pageRoute={new Route("/dashboard/project/users/custom-fields")}
        currentProject={null}
        hasPaymentMethod={true}
      />,
    );

    const options: Array<{ label: string; value: string }> =
      formField("customFieldType")!.dropdownOptions!;

    expect(options).toEqual(
      getCustomFieldTypeOptions().map(
        (option: { label: string; value: string }) => {
          return { label: option.label, value: option.value };
        },
      ),
    );
    expect(options).toContainEqual({
      label: "Long text",
      value: CustomFieldType.LongText,
    });
    expect(options).toContainEqual({
      label: "Rich text (Markdown)",
      value: CustomFieldType.Markdown,
    });
  });
});

describe("field type labels", () => {
  test("every type has a label, and every label is used once", () => {
    const labels: Array<string> = Object.values(CustomFieldType).map(
      (type: CustomFieldType) => {
        return CUSTOM_FIELD_TYPE_LABELS[type];
      },
    );

    for (const label of labels) {
      expect(typeof label).toBe("string");
      expect(label.length).toBeGreaterThan(0);
    }

    expect(new Set<string>(labels).size).toBe(labels.length);
  });
});
