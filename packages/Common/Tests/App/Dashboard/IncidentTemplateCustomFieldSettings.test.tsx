import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import React, { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * An incident template's Custom Fields on Create (issue #4114): which of the
 * project's incident custom fields the Details step asks for, and requires,
 * when an incident is declared from the template.
 *
 *   - a new template sets them in a step of its own in the create wizard,
 *     one dropdown per field, packed into customFieldSettings - Default left
 *     out - and never sent as misc data. The step that sets the template's
 *     custom field VALUES stays exactly as it was;
 *   - a template's page shows them in IncidentCustomFieldSettingsCard, in
 *     template mode, right after the card with its custom field values.
 *
 * The tables and cards are stubbed and their props recorded (the card has
 * its own suite: IncidentCustomFieldSettingsCard.test.tsx).
 */

const recordedTables: Array<Record<string, unknown>> = [];
const recordedSettingsCards: Array<Record<string, unknown>> = [];

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: Record<string, unknown>): ReactElement => {
      recordedTables.push(props);
      return React.createElement("div", {
        "data-testid": `table-${String(props["name"])}`,
      });
    },
  };
});

jest.mock("../../../UI/Components/ModelDetail/CardModelDetail", () => {
  return {
    __esModule: true,
    default: (props: Record<string, unknown>): ReactElement => {
      return React.createElement("div", {
        "data-testid": `card-${String(props["name"])}`,
      });
    },
  };
});

jest.mock("../../../UI/Components/ModelDelete/ModelDelete", () => {
  return {
    __esModule: true,
    default: (): ReactElement => {
      return React.createElement("div", { "data-testid": "model-delete" });
    },
  };
});

jest.mock("../../../UI/Components/CustomFields/CustomFieldsDetail", () => {
  return {
    __esModule: true,
    default: (): ReactElement => {
      return React.createElement("div", {
        "data-testid": "custom-field-values-card",
      });
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Incident/IncidentCustomFieldSettingsCard",
  () => {
    return {
      __esModule: true,
      default: (props: Record<string, unknown>): ReactElement => {
        recordedSettingsCards.push(props);
        return React.createElement("div", {
          "data-testid": "custom-field-settings-card",
        });
      },
    };
  },
);

const getListMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      count: async (): Promise<number> => {
        return 3;
      },
      getList: (...args: Array<unknown>): unknown => {
        return getListMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: (): unknown => {
        const ObjectIDClass: any = jest.requireActual(
          "../../../Types/ObjectID",
        ) as any;
        return new ObjectIDClass.default(
          "11111111-1111-4111-8111-111111111111",
        );
      },
    },
  };
});

jest.mock("../../../UI/Utils/Translation", () => {
  return {
    __esModule: true,
    default: () => {
      return {
        translateString: (value: string | undefined): string | undefined => {
          return value;
        },
        translateValue: (value: unknown): unknown => {
          return value;
        },
      };
    },
  };
});

import IncidentTemplates from "../../../../App/FeatureSet/Dashboard/src/Pages/Incidents/Settings/IncidentTemplates";
import IncidentTemplatesView from "../../../../App/FeatureSet/Dashboard/src/Pages/Incidents/Settings/IncidentTemplatesView";
import { INCIDENT_TEMPLATE_CUSTOM_FIELDS_STEP_ID } from "../../../../App/FeatureSet/Dashboard/src/Components/Incident/IncidentCustomFieldDefinitions";
import IncidentCustomFieldCreateSettingsCopy, {
  INCIDENT_TEMPLATE_CUSTOM_FIELD_SETTINGS_STEP_ID,
  INCIDENT_TEMPLATE_CUSTOM_FIELD_SETTINGS_STEP_TITLE,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Incident/IncidentCustomFieldCreateSettingsCopy";
import { getCustomFieldSettingFormKey } from "../../../../App/FeatureSet/Dashboard/src/Components/Incident/IncidentCustomFieldCreateSettingsForm";
import IncidentCustomField from "../../../Models/DatabaseModels/IncidentCustomField";
import IncidentTemplate from "../../../Models/DatabaseModels/IncidentTemplate";
import Route from "../../../Types/API/Route";
import CustomFieldType from "../../../Types/CustomField/CustomFieldType";
import ObjectID from "../../../Types/ObjectID";
import { getCustomFieldFormKey } from "../../../UI/Components/CustomFields/CustomFieldModelFormFields";
import { DropdownOption } from "../../../UI/Components/Dropdown/Dropdown";
import FormFieldSchemaType from "../../../UI/Components/Forms/Types/FormFieldSchemaType";
import Navigation from "../../../UI/Utils/Navigation";

const TEMPLATE_ID: string = "a1b2c3d4-0000-4000-8000-0000000000aa";

function customField(
  overrides: Partial<IncidentCustomField> & { name: string },
): IncidentCustomField {
  const field: IncidentCustomField = new IncidentCustomField();
  field.customFieldType = CustomFieldType.Text;
  Object.assign(field, overrides);
  return field;
}

const IMPACT: IncidentCustomField = customField({
  name: "Impact",
  customFieldType: CustomFieldType.Dropdown,
  dropdownOptions: "Low\nMedium\nHigh",
  showOnCreate: true,
  isRequiredOnCreate: true,
  sortOrder: 2,
  variableKey: "impact",
});
// Not asked when declaring; a template can still fill it in.
const CATEGORY: IncidentCustomField = customField({
  name: "Category",
  sortOrder: 1,
  variableKey: "category",
});
const ACKNOWLEDGEMENT: IncidentCustomField = customField({
  name: "Acknowledgement",
  customFieldType: CustomFieldType.Boolean,
  showOnCreate: true,
  sortOrder: 3,
  variableKey: "acknowledgement",
});
// Older than template variable keys: no setting can be kept for it.
const LEGACY: IncidentCustomField = customField({
  name: "Legacy",
  showOnCreate: true,
  sortOrder: 4,
});

let definitions: Array<IncidentCustomField> | Error = [];

beforeEach(() => {
  definitions = [IMPACT, CATEGORY, ACKNOWLEDGEMENT, LEGACY];

  getListMock.mockReset();
  getListMock.mockImplementation(async (...args: Array<unknown>) => {
    const request: { modelType: unknown } = args[0] as { modelType: unknown };

    if (request.modelType === IncidentCustomField) {
      if (definitions instanceof Error) {
        throw definitions;
      }

      return {
        data: definitions,
        count: definitions.length,
        skip: 0,
        limit: 0,
      };
    }

    return { data: [], count: 0, skip: 0, limit: 0 };
  });

  jest
    .spyOn(Navigation, "getLastParamAsObjectID")
    .mockImplementation((): ObjectID => {
      return new ObjectID(TEMPLATE_ID);
    });
});

afterEach(() => {
  cleanup();
  recordedTables.length = 0;
  recordedSettingsCards.length = 0;
  jest.restoreAllMocks();
});

type FormStepProps = { id: string; title: string };

type TemplatesTableProps = {
  modelType: unknown;
  formSteps: Array<FormStepProps>;
  formFields: Array<Record<string, unknown>>;
  onBeforeCreate: (
    item: IncidentTemplate,
    miscDataProps: Record<string, unknown>,
    formValues: Record<string, unknown>,
  ) => Promise<IncidentTemplate>;
};

function templatesTable(): TemplatesTableProps {
  const tables: Array<Record<string, unknown>> = recordedTables.filter(
    (props: Record<string, unknown>) => {
      return props["modelType"] === IncidentTemplate;
    },
  );

  expect(tables.length).toBeGreaterThan(0);
  return tables[tables.length - 1] as unknown as TemplatesTableProps;
}

function inputsOnStep(stepId: string): Array<Record<string, unknown>> {
  return templatesTable().formFields.filter(
    (field: Record<string, unknown>) => {
      return field["stepId"] === stepId;
    },
  );
}

function settingInputs(): Array<Record<string, unknown>> {
  return inputsOnStep(INCIDENT_TEMPLATE_CUSTOM_FIELD_SETTINGS_STEP_ID);
}

function stepIds(): Array<string> {
  return templatesTable().formSteps.map((step: FormStepProps): string => {
    return step.id;
  });
}

async function renderTemplatesPage(): Promise<void> {
  await act(async (): Promise<void> => {
    render(
      <MemoryRouter>
        <IncidentTemplates
          pageRoute={new Route("/settings/incident-templates")}
          currentProject={null}
          hasPaymentMethod={false}
        />
      </MemoryRouter>,
    );
  });
}

async function renderTemplatesPageWithFields(): Promise<void> {
  await renderTemplatesPage();

  await waitFor(() => {
    expect(settingInputs().length).toBeGreaterThan(0);
  });
}

describe("a new incident template: the Custom Fields on Create step", () => {
  test("comes right after the step that sets the custom field values", async () => {
    await renderTemplatesPageWithFields();

    const ids: Array<string> = stepIds();

    expect(ids.indexOf(INCIDENT_TEMPLATE_CUSTOM_FIELD_SETTINGS_STEP_ID)).toBe(
      ids.indexOf(INCIDENT_TEMPLATE_CUSTOM_FIELDS_STEP_ID) + 1,
    );
    expect(ids.indexOf("on-call")).toBe(
      ids.indexOf(INCIDENT_TEMPLATE_CUSTOM_FIELD_SETTINGS_STEP_ID) + 1,
    );

    const step: FormStepProps | undefined = templatesTable().formSteps.find(
      (candidate: FormStepProps): boolean => {
        return candidate.id === INCIDENT_TEMPLATE_CUSTOM_FIELD_SETTINGS_STEP_ID;
      },
    );

    expect(step!.title).toBe(
      INCIDENT_TEMPLATE_CUSTOM_FIELD_SETTINGS_STEP_TITLE,
    );
    expect(INCIDENT_TEMPLATE_CUSTOM_FIELD_SETTINGS_STEP_TITLE).toBe(
      "Custom Fields on Create",
    );
    // A new step id: the values step keeps its own.
    expect(INCIDENT_TEMPLATE_CUSTOM_FIELD_SETTINGS_STEP_ID).not.toBe(
      INCIDENT_TEMPLATE_CUSTOM_FIELDS_STEP_ID,
    );
  });

  test("one dropdown per field with a template variable key, in the fields' order", async () => {
    await renderTemplatesPageWithFields();

    expect(
      settingInputs().map((field: Record<string, unknown>) => {
        return field["title"];
      }),
    ).toEqual(["Category", "Impact", "Acknowledgement"]);

    expect(
      settingInputs().map((field: Record<string, unknown>) => {
        return field["overrideFieldKey"];
      }),
    ).toEqual([
      getCustomFieldSettingFormKey("category"),
      getCustomFieldSettingFormKey("impact"),
      getCustomFieldSettingFormKey("acknowledgement"),
    ]);
  });

  test("each is checked against the template's customFieldSettings column, and is not a column itself", async () => {
    await renderTemplatesPageWithFields();

    for (const field of settingInputs()) {
      expect(field["field"]).toBeUndefined();
      expect(field["overrideField"]).toEqual({ customFieldSettings: true });
      expect(field["fieldType"]).toBe(FormFieldSchemaType.Dropdown);
      expect(field["required"]).toBe(false);
      expect(field["defaultValue"]).toBe("Default");
    }
  });

  test("Default says what each field does on its own", async () => {
    await renderTemplatesPageWithFields();

    const labelsFor: (title: string) => Array<string> = (
      title: string,
    ): Array<string> => {
      const field: Record<string, unknown> | undefined = settingInputs().find(
        (candidate: Record<string, unknown>): boolean => {
          return candidate["title"] === title;
        },
      );

      return (field!["dropdownOptions"] as Array<DropdownOption>).map(
        (option: DropdownOption): string => {
          return option.label;
        },
      );
    };

    expect(labelsFor("Impact")).toEqual([
      "Default (Required)",
      "Required",
      "Optional",
      "Hidden",
    ]);
    expect(labelsFor("Acknowledgement")).toEqual([
      "Default (Optional)",
      "Required",
      "Optional",
      "Hidden",
    ]);
    expect(labelsFor("Category")).toEqual([
      "Default (Not Shown)",
      "Required",
      "Optional",
      "Hidden",
    ]);
  });

  test("the step explains itself above its first dropdown", async () => {
    await renderTemplatesPageWithFields();

    const [first, ...rest]: Array<Record<string, unknown>> = settingInputs();

    expect(first!["sectionTitle"]).toBe("Custom Fields on Create");
    expect(first!["sectionDescription"]).toBe(
      IncidentCustomFieldCreateSettingsCopy.templateDescription,
    );

    for (const field of rest) {
      expect(field["sectionTitle"]).toBeUndefined();
    }
  });

  test("the step that sets the values is left exactly as it was", async () => {
    await renderTemplatesPageWithFields();

    const valueInputs: Array<Record<string, unknown>> = inputsOnStep(
      INCIDENT_TEMPLATE_CUSTOM_FIELDS_STEP_ID,
    );

    // Every incident field, the one without a key included.
    expect(
      valueInputs.map((field: Record<string, unknown>) => {
        return field["title"];
      }),
    ).toEqual(["Category", "Impact", "Acknowledgement", "Legacy"]);

    for (const field of valueInputs) {
      expect(field["overrideField"]).toEqual({ customFields: true });
      expect(String(field["overrideFieldKey"])).toMatch(/^customFields:/);
    }
  });

  test("packs the choices into customFieldSettings, leaving Default out", async () => {
    await renderTemplatesPageWithFields();

    const result: IncidentTemplate = await templatesTable().onBeforeCreate(
      new IncidentTemplate(),
      {},
      {
        templateName: "Data breach",
        [getCustomFieldSettingFormKey("category")]: "Required",
        [getCustomFieldSettingFormKey("impact")]: "Hidden",
        [getCustomFieldSettingFormKey("acknowledgement")]: "Default",
      },
    );

    expect(result.customFieldSettings).toEqual({
      category: "Required",
      impact: "Hidden",
    });
  });

  test("a template left on Default everywhere stores no settings", async () => {
    await renderTemplatesPageWithFields();

    const result: IncidentTemplate = await templatesTable().onBeforeCreate(
      new IncidentTemplate(),
      {},
      {
        templateName: "Site outage",
        [getCustomFieldSettingFormKey("category")]: "Default",
        [getCustomFieldSettingFormKey("impact")]: "Default",
        [getCustomFieldSettingFormKey("acknowledgement")]: "Default",
      },
    );

    expect(result.customFieldSettings).toBeUndefined();
  });

  test("a dropdown somebody cleared is Default too", async () => {
    await renderTemplatesPageWithFields();

    const result: IncidentTemplate = await templatesTable().onBeforeCreate(
      new IncidentTemplate(),
      {},
      {
        [getCustomFieldSettingFormKey("impact")]: null,
        [getCustomFieldSettingFormKey("category")]: "Optional",
      },
    );

    expect(result.customFieldSettings).toEqual({ category: "Optional" });
  });

  test("the choices never travel as misc data; the owners and the values still do what they did", async () => {
    await renderTemplatesPageWithFields();

    const miscDataProps: Record<string, unknown> = {
      [getCustomFieldSettingFormKey("impact")]: "Hidden",
      [getCustomFieldSettingFormKey("category")]: "Required",
      [getCustomFieldFormKey("Impact")]: "High",
      ownerTeams: ["team-1"],
      ownerUsers: ["user-1"],
    };

    const result: IncidentTemplate = await templatesTable().onBeforeCreate(
      new IncidentTemplate(),
      miscDataProps,
      {
        [getCustomFieldSettingFormKey("impact")]: "Hidden",
        [getCustomFieldSettingFormKey("category")]: "Required",
        [getCustomFieldFormKey("Impact")]: "High",
        [getCustomFieldFormKey("Acknowledgement")]: false,
      },
    );

    expect(miscDataProps).toEqual({
      ownerTeams: ["team-1"],
      ownerUsers: ["user-1"],
    });
    expect(result.customFields).toEqual({
      Impact: "High",
      Acknowledgement: false,
    });
    expect(result.customFieldSettings).toEqual({
      impact: "Hidden",
      category: "Required",
    });
  });

  test("no step when no field has a template variable key; the values step stays", async () => {
    definitions = [LEGACY];

    await renderTemplatesPage();

    await waitFor(() => {
      expect(inputsOnStep(INCIDENT_TEMPLATE_CUSTOM_FIELDS_STEP_ID).length).toBe(
        1,
      );
    });

    expect(settingInputs()).toEqual([]);
    expect(stepIds()).toContain(INCIDENT_TEMPLATE_CUSTOM_FIELDS_STEP_ID);
    expect(stepIds()).not.toContain(
      INCIDENT_TEMPLATE_CUSTOM_FIELD_SETTINGS_STEP_ID,
    );

    const result: IncidentTemplate = await templatesTable().onBeforeCreate(
      new IncidentTemplate(),
      {},
      { templateName: "Site outage" },
    );

    expect(result.customFieldSettings).toBeUndefined();
  });

  test("no step when the project has no incident custom fields", async () => {
    definitions = [];

    await renderTemplatesPage();

    await waitFor(() => {
      expect(getListMock).toHaveBeenCalled();
    });

    expect(settingInputs()).toEqual([]);
    expect(stepIds()).not.toContain(
      INCIDENT_TEMPLATE_CUSTOM_FIELD_SETTINGS_STEP_ID,
    );
  });

  test("no step, and the wizard still works, when the fields cannot be read", async () => {
    definitions = new Error("Custom fields are not on your plan.");

    await renderTemplatesPage();

    await waitFor(() => {
      expect(getListMock).toHaveBeenCalled();
    });

    expect(settingInputs()).toEqual([]);
    expect(stepIds()).not.toContain(
      INCIDENT_TEMPLATE_CUSTOM_FIELD_SETTINGS_STEP_ID,
    );
    expect(templatesTable().formFields.length).toBeGreaterThan(0);
  });
});

describe("an incident template's page: the Custom Fields on Create card", () => {
  async function renderViewPage(): Promise<void> {
    await act(async (): Promise<void> => {
      render(
        <MemoryRouter>
          <IncidentTemplatesView
            pageRoute={new Route("/settings/incident-templates/1")}
            currentProject={null}
            hasPaymentMethod={false}
          />
        </MemoryRouter>,
      );
    });
  }

  test("is the settings card, for this template", async () => {
    await renderViewPage();

    expect(recordedSettingsCards).not.toHaveLength(0);

    const card: Record<string, unknown> =
      recordedSettingsCards[recordedSettingsCards.length - 1]!;

    /*
     * Templates are the card's only use now that incident forms became
     * Forms: there is no mode or model to hand it.
     */
    expect(card["mode"]).toBeUndefined();
    expect(card["modelType"]).toBeUndefined();
    expect(String(card["modelId"])).toBe(TEMPLATE_ID);
    // Its own title and description: "Custom Fields on Create".
    expect(card["title"]).toBeUndefined();
    expect(card["description"]).toBeUndefined();
  });

  test("sits right after the card with the template's custom field values", async () => {
    await renderViewPage();

    const order: Array<string> = Array.from(
      document.querySelectorAll<HTMLElement>("[data-testid]"),
    ).map((element: HTMLElement): string => {
      return element.getAttribute("data-testid") || "";
    });

    const valuesIndex: number = order.indexOf("custom-field-values-card");

    expect(valuesIndex).toBeGreaterThan(-1);
    expect(order[valuesIndex + 1]).toBe("custom-field-settings-card");
    expect(order[valuesIndex + 2]).toBe("table-Incident Template > Owner Team");
  });
});
