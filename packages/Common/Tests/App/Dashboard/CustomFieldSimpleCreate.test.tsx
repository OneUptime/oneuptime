import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen } from "@testing-library/react";
import React, { FunctionComponent, ReactElement } from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The custom field form, simple. The maintainer, on Create New Incident
 * Custom Field:
 *
 *   "when I create a new custom field By default, it should be 'Enter values
 *   by hand.' If I want to create a mapped custom field, I can go to the
 *   model table header. In the more options, there should be an option to
 *   create a mapped custom field. When I click on that, only show me those
 *   options. In the default model, we should only have 'Enter values by
 *   hand,' and you shouldn't even show that dropdown ... options like 'Show
 *   on create' and stuff ... should be hidden in the advanced section of the
 *   page. There should be an advanced section, which should be collapsed by
 *   default ... The only thing I should see by default is: field name, field
 *   description, type."
 *
 * What must hold, for all nine custom field settings pages:
 *
 *   - the form is one page (no steps), and what it shows when it opens is
 *     the name, the description and the type - plus a dropdown's options,
 *     under a dropdown type;
 *   - the Create form never asks where values come from: they are typed in;
 *   - everything else is in ONE Advanced section, after those, that stays
 *     folded on Create and on Edit (getAdvancedFormSection);
 *   - the Edit form still reaches every option: where a value is copied
 *     from (alerts, incidents, scheduled maintenance), an incident field's
 *     settings and, read only, its template variable;
 *   - a resource whose fields can copy a value (CustomFieldMappingCatalog)
 *     has "Create Mapped Custom Field" in its card's More menu, which opens a
 *     dialog asking the field to copy, a name and a description, and saves
 *     the new field with the copied field's type and options.
 *
 * ModelTable and ModelFormModal are stubbed and their props recorded: what a
 * page hands them is its whole contract. CustomFieldSimpleCreateRender
 * draws the same forms for real.
 */

const recordedTables: Array<Record<string, unknown>> = [];
const recordedModals: Array<Record<string, unknown>> = [];

interface MockState {
  isMasterAdmin: boolean;
  permissions: Array<string>;
}

const mockState: MockState = {
  isMasterAdmin: true,
  permissions: [],
};

const getListMock: MockFunction = getJestMockFunction();
const getItemMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: Record<string, unknown>): ReactElement => {
      recordedTables.push(props);
      return React.createElement("div", { "data-testid": "model-table" });
    },
  };
});

jest.mock("../../../UI/Components/ModelFormModal/ModelFormModal", () => {
  return {
    __esModule: true,
    default: (props: Record<string, unknown>): ReactElement => {
      recordedModals.push(props);
      return React.createElement("div", {
        "data-testid": "mapped-custom-field-modal",
      });
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

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return mockState.isMasterAdmin;
      },
      getUserId: (): null => {
        return null;
      },
    },
  };
});

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<string> => {
        return mockState.permissions;
      },
      getProjectPermissions: (): null => {
        return null;
      },
      getGlobalPermissions: (): null => {
        return null;
      },
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<unknown>) => {
        return getListMock(...args);
      },
      getItem: (...args: Array<unknown>) => {
        return getItemMock(...args);
      },
    },
  };
});

import { MORE_FIELDS_SECTION_TITLE } from "../../../UI/Components/Forms/Utils/AdvancedFormSection";
import {
  CustomFieldFormCopy,
  getCustomFieldTypeOptions,
  IncidentCustomFieldSettingsCopy,
  MAPPED_CUSTOM_FIELD_SOURCE_COPY,
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
import { TEMPLATE_VARIABLE_FORM_KEY } from "../../../../App/FeatureSet/Dashboard/src/Pages/Settings/Base/CustomFieldsPageBase";
import AlertCustomField from "../../../Models/DatabaseModels/AlertCustomField";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import IncidentCustomField from "../../../Models/DatabaseModels/IncidentCustomField";
import InventoryItemCustomField from "../../../Models/DatabaseModels/InventoryItemCustomField";
import MonitorCustomField from "../../../Models/DatabaseModels/MonitorCustomField";
import OnCallDutyPolicyCustomField from "../../../Models/DatabaseModels/OnCallDutyPolicyCustomField";
import ScheduledMaintenanceCustomField from "../../../Models/DatabaseModels/ScheduledMaintenanceCustomField";
import StatusPageCustomField from "../../../Models/DatabaseModels/StatusPageCustomField";
import TeamCustomField from "../../../Models/DatabaseModels/TeamCustomField";
import TeamMemberCustomField from "../../../Models/DatabaseModels/TeamMemberCustomField";
import Route from "../../../Types/API/Route";
import CustomFieldMappingSourceResource from "../../../Types/CustomField/CustomFieldMappingSourceResource";
import CustomFieldType from "../../../Types/CustomField/CustomFieldType";
import IconProp from "../../../Types/Icon/IconProp";
import { JSONObject } from "../../../Types/JSON";
import Permission from "../../../Types/Permission";
import { ButtonStyleType } from "../../../UI/Components/Button/Button";
import { CardButtonSchema } from "../../../UI/Components/Card/Card";
import { FormType } from "../../../UI/Components/Forms/ModelForm";
import { FormFieldCollapsibleSection } from "../../../UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "../../../UI/Components/Forms/Types/FormFieldSchemaType";

interface RecordedField {
  field?: Record<string, unknown>;
  overrideField?: Record<string, unknown>;
  overrideFieldKey?: string;
  title?: string;
  description?: string;
  placeholder?: string;
  fieldType?: FormFieldSchemaType;
  required?: unknown;
  showIf?: (values: JSONObject) => boolean;
  dropdownOptions?: Array<{ label: string; value: string }>;
  collapsibleSection?: FormFieldCollapsibleSection<JSONObject>;
  doNotShowWhenCreating?: boolean;
  doNotShowWhenEditing?: boolean;
  formOnly?: boolean;
  showEvenIfPermissionDoesNotExist?: boolean;
  hideOptionalLabel?: boolean;
  onChange?: (
    value: unknown,
    values: JSONObject,
    setNewFormValues: (values: JSONObject) => void,
  ) => void;
  getCustomElement?: (
    values: JSONObject,
    props: Record<string, unknown>,
  ) => ReactElement;
}

type PageComponent = FunctionComponent<PageComponentProps>;

interface SettingsPage {
  name: string;
  page: PageComponent;
  modelType: { new (): BaseModel };
  // Copies its values from a monitor (CustomFieldMappingCatalog).
  canMap: boolean;
  // Has an incident field's settings.
  isIncident: boolean;
}

const SETTINGS_PAGES: Array<SettingsPage> = [
  {
    name: "Incident",
    page: IncidentCustomFields,
    modelType: IncidentCustomField,
    canMap: true,
    isIncident: true,
  },
  {
    name: "Alert",
    page: AlertCustomFields,
    modelType: AlertCustomField,
    canMap: true,
    isIncident: false,
  },
  {
    name: "Scheduled Maintenance",
    page: ScheduledMaintenanceCustomFields,
    modelType: ScheduledMaintenanceCustomField,
    canMap: true,
    isIncident: false,
  },
  {
    name: "Monitor",
    page: MonitorCustomFields,
    modelType: MonitorCustomField,
    canMap: false,
    isIncident: false,
  },
  {
    name: "Status Page",
    page: StatusPageCustomFields,
    modelType: StatusPageCustomField,
    canMap: false,
    isIncident: false,
  },
  {
    name: "On-Call Policy",
    page: OnCallDutyPolicyCustomFields,
    modelType: OnCallDutyPolicyCustomField,
    canMap: false,
    isIncident: false,
  },
  {
    name: "Inventory",
    page: InventoryCustomFields,
    modelType: InventoryItemCustomField,
    canMap: false,
    isIncident: false,
  },
  {
    name: "Team",
    page: TeamCustomFields,
    modelType: TeamCustomField,
    canMap: false,
    isIncident: false,
  },
  {
    name: "Team Member",
    page: TeamMemberCustomFields,
    modelType: TeamMemberCustomField,
    canMap: false,
    isIncident: false,
  },
];

const MAPPABLE_PAGES: Array<SettingsPage> = SETTINGS_PAGES.filter(
  (page: SettingsPage): boolean => {
    return page.canMap;
  },
);

const INCIDENT_PAGE: SettingsPage = SETTINGS_PAGES[0]!;

const UNFOLDED_KEYS: Array<string> = [
  "name",
  "description",
  "customFieldType",
  "dropdownOptions",
];

const REGION_OPTIONS: string = JSON.stringify([
  { label: "us-east-1", color: "#4f46e5" },
  { label: "eu-west-1" },
]);

function renderPage(page: SettingsPage): Record<string, unknown> {
  const Page: PageComponent = page.page;

  render(
    <Page
      pageRoute={new Route("/dashboard/project/settings/custom-fields")}
      currentProject={null}
      hasPaymentMethod={true}
    />,
  );

  return lastTable();
}

function lastTable(): Record<string, unknown> {
  const table: Record<string, unknown> | undefined =
    recordedTables[recordedTables.length - 1];

  if (!table) {
    throw new Error("ModelTable was not rendered.");
  }

  return table;
}

function lastModal(): Record<string, unknown> | undefined {
  return recordedModals[recordedModals.length - 1];
}

function formFields(): Array<RecordedField> {
  return lastTable()["formFields"] as Array<RecordedField>;
}

function keyOf(field: RecordedField): string {
  return (
    field.overrideFieldKey ||
    Object.keys(field.field || field.overrideField || {})[0] ||
    ""
  );
}

function onCreate(): Array<RecordedField> {
  return formFields().filter((field: RecordedField): boolean => {
    return !field.doNotShowWhenCreating;
  });
}

function onEdit(): Array<RecordedField> {
  return formFields().filter((field: RecordedField): boolean => {
    return !field.doNotShowWhenEditing;
  });
}

function unfolded(fields: Array<RecordedField>): Array<string> {
  return fields
    .filter((field: RecordedField): boolean => {
      return !field.collapsibleSection;
    })
    .map(keyOf);
}

function folded(fields: Array<RecordedField>): Array<string> {
  return fields
    .filter((field: RecordedField): boolean => {
      return Boolean(field.collapsibleSection);
    })
    .map(keyOf);
}

function field(key: string): RecordedField {
  const found: RecordedField | undefined = formFields().find(
    (candidate: RecordedField): boolean => {
      return keyOf(candidate) === key;
    },
  );

  if (!found) {
    throw new Error(`The form has no ${key} field.`);
  }

  return found;
}

function cardButtons(): Array<CardButtonSchema> {
  return (
    ((lastTable()["cardProps"] as Record<string, unknown>)[
      "buttons"
    ] as Array<CardButtonSchema>) || []
  );
}

beforeEach(() => {
  recordedTables.length = 0;
  recordedModals.length = 0;
  mockState.isMasterAdmin = true;
  mockState.permissions = [];
  getListMock.mockReset();
  getItemMock.mockReset();
});

afterEach(() => {
  cleanup();
});

describe.each(SETTINGS_PAGES)(
  "the $name custom field form",
  (page: SettingsPage) => {
    test("is one page: no steps to walk", () => {
      const table: Record<string, unknown> = renderPage(page);

      expect(table["formSteps"] || []).toEqual([]);

      for (const candidate of formFields()) {
        expect((candidate as Record<string, unknown>)["stepId"]).toBe(
          undefined,
        );
      }
    });

    test("shows the name, the description and the type - and a dropdown's options - when it opens", () => {
      renderPage(page);

      expect(unfolded(onCreate())).toEqual(UNFOLDED_KEYS);
      expect(unfolded(onEdit())).toEqual(UNFOLDED_KEYS);

      expect(field("name").required).toBe(true);
      expect(field("name").title).toBe("Field Name");
      expect(field("description").required).toBe(false);
      expect(field("description").title).toBe("Field Description");
      expect(field("customFieldType").required).toBe(true);
      expect(field("customFieldType").title).toBe("Field Type");
      expect(field("customFieldType").dropdownOptions).toEqual(
        getCustomFieldTypeOptions().map(
          (option: { label: string; value: string }) => {
            return { label: option.label, value: option.value };
          },
        ),
      );
    });

    test("asks for a dropdown's options only under a dropdown type", () => {
      renderPage(page);

      const options: RecordedField = field("dropdownOptions");

      for (const type of Object.values(CustomFieldType)) {
        const isDropdown: boolean =
          type === CustomFieldType.Dropdown ||
          type === CustomFieldType.MultiSelectDropdown;

        expect(options.showIf!({ customFieldType: type })).toBe(isDropdown);
      }

      expect(options.showIf!({})).toBe(false);
    });

    test("never asks on Create where values come from: they are typed in", () => {
      renderPage(page);

      const keys: Array<string> = onCreate().map(keyOf);

      expect(keys).not.toContain("mapFromResourceType");
      expect(keys).not.toContain("mapFromCustomFieldName");

      for (const candidate of onCreate()) {
        expect(candidate.title).not.toBe(CustomFieldFormCopy.mapValueFromTitle);
      }
    });

    test("folds everything else into one Advanced section, after the rest, folded on Edit too", () => {
      renderPage(page);

      const sections: Set<FormFieldCollapsibleSection<JSONObject>> = new Set<
        FormFieldCollapsibleSection<JSONObject>
      >();

      let seenFolded: boolean = false;

      for (const candidate of formFields()) {
        if (candidate.collapsibleSection) {
          sections.add(candidate.collapsibleSection);
          seenFolded = true;
          continue;
        }

        // Nothing unfolded comes after the section: it is one block.
        expect({ key: keyOf(candidate), afterAdvanced: seenFolded }).toEqual({
          key: keyOf(candidate),
          afterAdvanced: false,
        });
      }

      expect(sections.size).toBeLessThanOrEqual(1);

      for (const section of sections) {
        expect(section.title).toBe(MORE_FIELDS_SECTION_TITLE);
        expect(section.openWhenConfigured).toBe(false);
        // "Configured" is worked out from the fields in it.
        expect(section.isConfigured).toBeUndefined();
      }
    });
  },
);

describe("what is under Advanced", () => {
  test("an incident field: its three settings on Create; where its value comes from and its template variable too on Edit", () => {
    renderPage(INCIDENT_PAGE);

    expect(folded(onCreate())).toEqual([
      "showOnCreate",
      "isRequiredOnCreate",
      "includeInSubscriberNotifications",
    ]);
    expect(folded(onEdit())).toEqual([
      "mapFromResourceType",
      "mapFromCustomFieldName",
      "showOnCreate",
      "isRequiredOnCreate",
      "includeInSubscriberNotifications",
      TEMPLATE_VARIABLE_FORM_KEY,
    ]);
  });

  test("an incident field's settings keep their own text and switches", () => {
    renderPage(INCIDENT_PAGE);

    expect(field("showOnCreate")).toMatchObject({
      title: IncidentCustomFieldSettingsCopy.showOnCreateTitle,
      description: IncidentCustomFieldSettingsCopy.showOnCreateDescription,
      fieldType: FormFieldSchemaType.Toggle,
      required: false,
    });
    expect(field("includeInSubscriberNotifications")).toMatchObject({
      title:
        IncidentCustomFieldSettingsCopy.includeInSubscriberNotificationsTitle,
      fieldType: FormFieldSchemaType.Toggle,
      required: false,
    });
    expect(field("isRequiredOnCreate").showIf!({ showOnCreate: true })).toBe(
      true,
    );
    expect(field("isRequiredOnCreate").showIf!({ showOnCreate: false })).toBe(
      false,
    );
  });

  test.each(
    MAPPABLE_PAGES.filter((page: SettingsPage): boolean => {
      return !page.isIncident;
    }).map((page: SettingsPage): [string, SettingsPage] => {
      return [page.name, page];
    }),
  )(
    "a %s field: nothing on Create, where its value comes from on Edit",
    (_name: string, page: SettingsPage) => {
      renderPage(page);

      expect(folded(onCreate())).toEqual([]);
      expect(folded(onEdit())).toEqual([
        "mapFromResourceType",
        "mapFromCustomFieldName",
      ]);
    },
  );

  test.each(
    SETTINGS_PAGES.filter((page: SettingsPage): boolean => {
      return !page.canMap;
    }).map((page: SettingsPage): [string, SettingsPage] => {
      return [page.name, page];
    }),
  )(
    "a %s field has no Advanced section: nothing to put there",
    (_name: string, page: SettingsPage) => {
      renderPage(page);

      expect(folded(formFields())).toEqual([]);
      expect(formFields().map(keyOf)).toEqual(UNFOLDED_KEYS);
    },
  );
});

describe.each(MAPPABLE_PAGES)(
  "the $name Edit form keeps where a value comes from",
  (page: SettingsPage) => {
    test("offers typing by hand or copying from a monitor", () => {
      renderPage(page);

      const mapFrom: RecordedField = field("mapFromResourceType");

      expect(mapFrom).toMatchObject({
        title: CustomFieldFormCopy.mapValueFromTitle,
        description: CustomFieldFormCopy.mapValueFromDescription,
        fieldType: FormFieldSchemaType.Dropdown,
        required: false,
        doNotShowWhenCreating: true,
        placeholder: CustomFieldFormCopy.mapValueByHand,
      });
      expect(mapFrom.dropdownOptions).toEqual([
        { label: "Enter values by hand", value: "" },
        {
          label: "Copy from a monitor custom field",
          value: CustomFieldMappingSourceResource.Monitor,
        },
      ]);
    });

    test("asks for the field to copy only once a source is chosen", () => {
      renderPage(page);

      const copyFrom: RecordedField = field("mapFromCustomFieldName");

      expect(copyFrom.title).toBe(CustomFieldFormCopy.fieldToCopyFromTitle);
      expect(copyFrom.doNotShowWhenCreating).toBe(true);
      expect(copyFrom.showIf!({ mapFromResourceType: "Monitor" })).toBe(true);
      expect(copyFrom.showIf!({ mapFromResourceType: "" })).toBe(false);
      expect(
        (copyFrom.required as (values: JSONObject) => boolean)({
          mapFromResourceType: "Monitor",
        }),
      ).toBe(true);
      expect((copyFrom.required as (values: JSONObject) => boolean)({})).toBe(
        false,
      );
    });

    test("picks the field to copy among the monitor's fields of the same type", async () => {
      getListMock.mockResolvedValue({
        data: [
          Object.assign(new MonitorCustomField(), {
            name: "Region",
            customFieldType: CustomFieldType.Text,
          }),
        ],
        count: 1,
        skip: 0,
        limit: 1,
      } as never);

      renderPage(page);

      const element: ReactElement = field("mapFromCustomFieldName")
        .getCustomElement!(
        {
          mapFromResourceType: "Monitor",
          customFieldType: CustomFieldType.Text,
        },
        { initialValue: "Region" },
      );

      cleanup();
      render(element);

      // The field it copies from now, picked.
      expect(await screen.findByText("Region")).toBeInTheDocument();
      expect(screen.getByRole("combobox")).toBeInTheDocument();
      // Of the field's own type, so no type is said under it.
      expect(screen.queryByTestId("map-from-selected-field-type")).toBeNull();
      expect(getListMock).toHaveBeenCalled();
      expect(
        (getListMock.mock.calls[0]![0] as Record<string, unknown>)["modelType"],
      ).toBe(MonitorCustomField);
    });

    test("draws nothing for a source the resource cannot copy from", () => {
      renderPage(page);

      const element: ReactElement = field("mapFromCustomFieldName")
        .getCustomElement!({ mapFromResourceType: "Service" }, {});

      cleanup();

      const { container } = render(element);

      expect(container.textContent).toBe("");
    });
  },
);

describe("the incident field's template variable", () => {
  test("is a read-only line at the bottom of Advanced, on Edit only, never sent", () => {
    renderPage(INCIDENT_PAGE);

    const line: RecordedField = field(TEMPLATE_VARIABLE_FORM_KEY);

    expect(line).toMatchObject({
      title: CustomFieldFormCopy.templateVariableTitle,
      description: CustomFieldFormCopy.templateVariableDescription,
      fieldType: FormFieldSchemaType.CustomComponent,
      doNotShowWhenCreating: true,
      formOnly: true,
      showEvenIfPermissionDoesNotExist: true,
      hideOptionalLabel: true,
      required: false,
    });
    // Checked against the column nobody may write, and never selected.
    expect(line.overrideField).toEqual({ variableKey: true });
    expect(line.field).toBeUndefined();
  });

  test("shows the field's {{incident.customFields.<key>}}, read by the field's id", async () => {
    getItemMock.mockResolvedValue(
      Object.assign(new IncidentCustomField(), {
        _id: "22222222-2222-4222-8222-222222222222",
        variableKey: "impact",
      }) as never,
    );

    renderPage(INCIDENT_PAGE);

    const element: ReactElement = field(TEMPLATE_VARIABLE_FORM_KEY)
      .getCustomElement!({ _id: "22222222-2222-4222-8222-222222222222" }, {});

    cleanup();
    render(element);

    expect(
      (await screen.findByTestId("custom-field-template-variable")).textContent,
    ).toBe("{{incident.customFields.impact}}");

    const request: Record<string, unknown> = getItemMock.mock
      .calls[0]![0] as Record<string, unknown>;

    expect(request["modelType"]).toBe(IncidentCustomField);
    expect(String(request["id"])).toBe("22222222-2222-4222-8222-222222222222");
    expect(request["select"]).toEqual({ variableKey: true });
  });

  test("says so when it cannot be read", async () => {
    getItemMock.mockRejectedValue(new Error("Not allowed") as never);

    renderPage(INCIDENT_PAGE);

    const element: ReactElement = field(TEMPLATE_VARIABLE_FORM_KEY)
      .getCustomElement!({ _id: "22222222-2222-4222-8222-222222222222" }, {});

    cleanup();
    render(element);

    expect(
      (await screen.findByTestId("custom-field-template-variable-not-loaded"))
        .textContent,
    ).toBe(CustomFieldFormCopy.templateVariableNotLoaded);
  });

  test("is only on incident fields: no other resource has one", () => {
    for (const page of SETTINGS_PAGES.slice(1)) {
      cleanup();
      recordedTables.length = 0;
      renderPage(page);

      expect(formFields().map(keyOf)).not.toContain(TEMPLATE_VARIABLE_FORM_KEY);
    }
  });
});

describe("Create Mapped Custom Field, in the card's More menu", () => {
  test.each(
    MAPPABLE_PAGES.map((page: SettingsPage): [string, SettingsPage] => {
      return [page.name, page];
    }),
  )(
    "the %s card has it, with an icon, never in the Create button's place",
    (_name: string, page: SettingsPage) => {
      renderPage(page);

      expect(cardButtons()).toHaveLength(1);

      const button: CardButtonSchema = cardButtons()[0]!;

      expect(button.title).toBe("Create Mapped Custom Field");
      expect(button.icon).toBe(IconProp.Link);
      expect(button.disabled).toBeFalsy();
      // Says, on hover, what a mapped field is.
      expect(button.tooltip).toBe(
        MAPPED_CUSTOM_FIELD_SOURCE_COPY[
          CustomFieldMappingSourceResource.Monitor
        ].menuTooltip,
      );
      expect(button.buttonStyle).toBe(ButtonStyleType.OUTLINE);
      /*
       * A NORMAL button with the Add icon is the one the table shows as its
       * main button (BaseModelTable splitButtonsForHeader); everything else
       * goes in the More menu.
       */
      expect(
        button.buttonStyle === ButtonStyleType.NORMAL &&
          button.icon === IconProp.Add,
      ).toBe(false);
      // The table's own Create stays.
      expect(lastTable()["isCreateable"]).toBe(true);
    },
  );

  test.each(
    SETTINGS_PAGES.filter((page: SettingsPage): boolean => {
      return !page.canMap;
    }).map((page: SettingsPage): [string, SettingsPage] => {
      return [page.name, page];
    }),
  )(
    "the %s card has nothing to map, so no such item",
    (_name: string, page: SettingsPage) => {
      renderPage(page);

      expect(cardButtons()).toEqual([]);
    },
  );

  test("is locked, saying why, for someone who may not create fields", () => {
    mockState.isMasterAdmin = false;
    mockState.permissions = [Permission.ProjectMember];

    renderPage(INCIDENT_PAGE);

    const button: CardButtonSchema = cardButtons()[0]!;

    expect(button.disabled).toBe(true);
    expect(button.tooltip).toContain("permission");
    expect(button.tooltip).toContain("Incident Custom Field");

    act(() => {
      button.onClick?.();
    });

    expect(recordedModals).toHaveLength(0);
  });

  test("opens for someone who may create fields", () => {
    mockState.isMasterAdmin = false;
    mockState.permissions = [Permission.CreateIncidentCustomField];

    renderPage(INCIDENT_PAGE);

    expect(cardButtons()[0]!.disabled).toBeFalsy();
  });

  test("opens a dialog that asks only what a mapped field needs", () => {
    renderPage(INCIDENT_PAGE);

    expect(recordedModals).toHaveLength(0);

    act(() => {
      cardButtons()[0]!.onClick?.();
    });

    const modal: Record<string, unknown> = lastModal()!;
    const formProps: Record<string, unknown> = modal["formProps"] as Record<
      string,
      unknown
    >;

    expect(modal["title"]).toBe("Create Mapped Custom Field");
    expect(modal["description"]).toBe(
      MAPPED_CUSTOM_FIELD_SOURCE_COPY[CustomFieldMappingSourceResource.Monitor]
        .dialogDescription,
    );
    expect(modal["submitButtonText"]).toBe("Create Custom Field");
    expect(modal["modelType"]).toBe(IncidentCustomField);
    expect(formProps["formType"]).toBe(FormType.Create);
    expect(formProps["steps"]).toBeUndefined();
    expect((formProps["fields"] as Array<RecordedField>).map(keyOf)).toEqual([
      "mapFromCustomFieldName",
      "name",
      "description",
    ]);

    const [source, name, description] = formProps[
      "fields"
    ] as Array<RecordedField>;

    expect(source).toMatchObject({
      title: "Monitor Field",
      fieldType: FormFieldSchemaType.CustomComponent,
      required: true,
    });
    expect(name).toMatchObject({ title: "Field Name", required: true });
    expect(description).toMatchObject({
      title: "Field Description",
      required: false,
    });

    // Nothing else: no type, no "Map Value From", no Advanced.
    for (const candidate of formProps["fields"] as Array<RecordedField>) {
      expect(candidate.collapsibleSection).toBeUndefined();
    }
  });

  test("closes without saving", () => {
    renderPage(INCIDENT_PAGE);

    act(() => {
      cardButtons()[0]!.onClick?.();
    });

    const modalCount: number = recordedModals.length;

    act(() => {
      (lastModal()!["onClose"] as () => void)();
    });

    expect(screen.queryByTestId("mapped-custom-field-modal")).toBeNull();
    expect(recordedModals).toHaveLength(modalCount);
  });

  test("closes once the field is created, and the table shows it", () => {
    renderPage(INCIDENT_PAGE);

    const refreshBefore: unknown = lastTable()["refreshToggle"];

    act(() => {
      cardButtons()[0]!.onClick?.();
    });

    act(() => {
      (lastModal()!["onSuccess"] as (item: BaseModel) => void)(
        new IncidentCustomField(),
      );
    });

    expect(screen.queryByTestId("mapped-custom-field-modal")).toBeNull();
    expect(lastTable()["refreshToggle"]).not.toBe(refreshBefore);
  });

  test("names the new field after the one it copies, until a name is typed", () => {
    renderPage(INCIDENT_PAGE);

    act(() => {
      cardButtons()[0]!.onClick?.();
    });

    const source: RecordedField = (
      (lastModal()!["formProps"] as Record<string, unknown>)[
        "fields"
      ] as Array<RecordedField>
    )[0]!;

    const setNewFormValues: MockFunction = getJestMockFunction();

    source.onChange!("Region", {}, setNewFormValues);

    expect(setNewFormValues).toHaveBeenCalledWith({ name: "Region" });

    setNewFormValues.mockReset();
    source.onChange!(
      "Customer Tier",
      { name: "Region", mapFromCustomFieldName: "Region" },
      setNewFormValues,
    );

    expect(setNewFormValues).toHaveBeenCalledWith({
      name: "Customer Tier",
      mapFromCustomFieldName: "Region",
    });

    setNewFormValues.mockReset();
    source.onChange!(
      "Customer Tier",
      { name: "Affected Region", mapFromCustomFieldName: "Region" },
      setNewFormValues,
    );

    expect(setNewFormValues).not.toHaveBeenCalled();
  });

  test("saves the new field with the copied field's type and options", async () => {
    getListMock.mockResolvedValue({
      data: [
        Object.assign(new MonitorCustomField(), {
          name: "Region",
          customFieldType: CustomFieldType.Dropdown,
          dropdownOptions: REGION_OPTIONS,
        }),
      ],
      count: 1,
      skip: 0,
      limit: 1,
    } as never);

    renderPage(INCIDENT_PAGE);

    act(() => {
      cardButtons()[0]!.onClick?.();
    });

    const item: IncidentCustomField = new IncidentCustomField();
    item.name = "Region";
    item.mapFromCustomFieldName = "Region";

    const saved: IncidentCustomField = await (
      lastModal()!["onBeforeCreate"] as (
        item: IncidentCustomField,
        miscDataProps: JSONObject,
        values: JSONObject,
      ) => Promise<IncidentCustomField>
    )(item, {}, {});

    expect(saved.name).toBe("Region");
    expect(saved.mapFromResourceType).toBe(
      CustomFieldMappingSourceResource.Monitor,
    );
    expect(saved.mapFromCustomFieldName).toBe("Region");
    expect(saved.customFieldType).toBe(CustomFieldType.Dropdown);
    expect(saved.dropdownOptions).toBe(REGION_OPTIONS);

    const request: Record<string, unknown> = getListMock.mock
      .calls[0]![0] as Record<string, unknown>;

    expect(request["modelType"]).toBe(MonitorCustomField);
    expect(request["query"]).toEqual({
      projectId: "11111111-1111-4111-8111-111111111111",
      name: "Region",
    });
  });

  test("refuses to save a copy of a field that is gone, saying which", async () => {
    getListMock.mockResolvedValue({
      data: [],
      count: 0,
      skip: 0,
      limit: 1,
    } as never);

    renderPage(INCIDENT_PAGE);

    act(() => {
      cardButtons()[0]!.onClick?.();
    });

    const item: IncidentCustomField = new IncidentCustomField();
    item.name = "Region";
    item.mapFromCustomFieldName = "Region";

    await expect(
      (
        lastModal()!["onBeforeCreate"] as (
          item: IncidentCustomField,
          miscDataProps: JSONObject,
          values: JSONObject,
        ) => Promise<IncidentCustomField>
      )(item, {}, {}),
    ).rejects.toThrow('Monitor does not have a custom field called "Region"');
  });

  test.each(
    MAPPABLE_PAGES.map((page: SettingsPage): [string, SettingsPage] => {
      return [page.name, page];
    }),
  )(
    "the %s dialog creates a field of that resource",
    (_name: string, page: SettingsPage) => {
      renderPage(page);

      act(() => {
        cardButtons()[0]!.onClick?.();
      });

      expect(lastModal()!["modelType"]).toBe(page.modelType);
    },
  );
});
