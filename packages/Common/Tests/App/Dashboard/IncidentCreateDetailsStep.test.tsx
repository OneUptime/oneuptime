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
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The Details step of declaring an incident: the project's incident custom
 * fields marked "Show on Create", asked for on the Create page.
 *
 * ModelForm is stubbed to capture what it is handed - the fields, the steps,
 * the initial values and onBeforeCreate - which is then called the way the
 * real form calls it (ModelFormCustomFieldInputs.test.tsx covers the real
 * form handing those values over). What is pinned:
 *
 *   - the step appears, in the fields' order, only when there is a field to
 *     ask, and the form waits for the fields before it renders;
 *   - "Required on Create" makes a field required, and a required yes/no
 *     field must be ticked;
 *   - the answers are packed into customFields from the submitted values, so
 *     0 and false survive, and never travel as misc data;
 *   - declaring from a template starts the step from the template's values
 *     and carries the rest of them, merged - never overwritten - and drops
 *     template values that no longer fit their field;
 *   - a field mapped from a monitor field is not asked once there is a
 *     monitor to copy it from.
 */

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, opts?: { defaultValue?: string }): string => {
          return opts?.defaultValue ?? key;
        },
      };
    },
  };
});

type CapturedFormProps = {
  initialValues: Record<string, unknown>;
  fields: Array<Record<string, unknown>>;
  steps: Array<{
    id: string;
    title: string;
    showIf?: (values: Record<string, unknown>) => boolean;
  }>;
  onBeforeCreate: (
    item: unknown,
    miscDataProps: Record<string, unknown>,
    formValues: Record<string, unknown>,
  ) => Promise<unknown>;
};

let capturedForms: Array<CapturedFormProps> = [];

jest.mock("../../../UI/Components/Forms/ModelForm", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../UI/Components/Forms/ModelForm",
  ) as Record<string, unknown>;

  return {
    __esModule: true,
    ...actual,
    default: (props: CapturedFormProps): React.ReactElement => {
      capturedForms.push(props);
      return <div data-testid="model-form" />;
    },
  };
});

const getListMock: MockFunction = getJestMockFunction();
const getItemMock: MockFunction = getJestMockFunction();
const countMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<any>) => {
        return getListMock(...args);
      },
      getItem: (...args: Array<any>) => {
        return getItemMock(...args);
      },
      count: (...args: Array<any>) => {
        return countMock(...args);
      },
      getCommonHeaders: (): Record<string, string> => {
        return { tenantid: "project-1" };
      },
      create: async (): Promise<null> => {
        return null;
      },
    },
  };
});

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: async (): Promise<never> => {
        return new Promise<never>(() => {
          // The audience summary is not what these tests are about.
        });
      },
      getFriendlyMessage: (): string => {
        return "Something went wrong";
      },
    },
  };
});

import IncidentCreate from "../../../../App/FeatureSet/Dashboard/src/Pages/Incidents/Create";
import {
  INCIDENT_DETAILS_STEP_ID,
  INCIDENT_DETAILS_STEP_TITLE,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Incident/IncidentCustomFieldDefinitions";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentCustomField from "../../../Models/DatabaseModels/IncidentCustomField";
import IncidentTemplate from "../../../Models/DatabaseModels/IncidentTemplate";
import Route from "../../../Types/API/Route";
import CustomFieldMappingSourceResource from "../../../Types/CustomField/CustomFieldMappingSourceResource";
import CustomFieldType from "../../../Types/CustomField/CustomFieldType";
import { JSONObject } from "../../../Types/JSON";
import { getCustomFieldFormKey } from "../../../UI/Components/CustomFields/CustomFieldModelFormFields";
import Field from "../../../UI/Components/Forms/Types/Field";
import FormValues from "../../../UI/Components/Forms/Types/FormValues";
import Validation from "../../../UI/Components/Forms/Validation";
import Navigation from "../../../UI/Utils/Navigation";

const TEMPLATE_ID: string = "66666666-6666-4666-8666-000000000001";

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
  sortOrder: 1,
});
const DURATION: IncidentCustomField = customField({
  name: "Estimated Duration",
  customFieldType: CustomFieldType.Number,
  showOnCreate: true,
  sortOrder: 2,
});
const ACKNOWLEDGEMENT: IncidentCustomField = customField({
  name: "Acknowledgement",
  customFieldType: CustomFieldType.Boolean,
  showOnCreate: true,
  isRequiredOnCreate: true,
  sortOrder: 3,
});
// Not asked on Create; a template can still fill it in.
const CATEGORY: IncidentCustomField = customField({
  name: "Category",
  customFieldType: CustomFieldType.Dropdown,
  dropdownOptions: "Network\nPower",
});
// Copied from the monitor's own "Site" field.
const SITE: IncidentCustomField = customField({
  name: "Site",
  showOnCreate: true,
  sortOrder: 4,
  mapFromResourceType: CustomFieldMappingSourceResource.Monitor,
  mapFromCustomFieldName: "Site",
});

let definitions: Array<IncidentCustomField> | Error = [];
let queryString: Record<string, string> = {};

async function renderCreate(): Promise<void> {
  await act(async () => {
    render(
      <MemoryRouter>
        <IncidentCreate
          pageRoute={new Route("/incidents/create")}
          currentProject={null}
          hasPaymentMethod={false}
        />
      </MemoryRouter>,
    );
  });

  await waitFor(() => {
    expect(capturedForms.length).toBeGreaterThan(0);
  });
}

function lastForm(): CapturedFormProps {
  return capturedForms[capturedForms.length - 1]!;
}

function detailsFields(): Array<Record<string, unknown>> {
  return lastForm().fields.filter((field: Record<string, unknown>) => {
    return field["stepId"] === INCIDENT_DETAILS_STEP_ID;
  });
}

function detailsField(name: string): Record<string, unknown> {
  const field: Record<string, unknown> | undefined = detailsFields().find(
    (candidate: Record<string, unknown>) => {
      return candidate["overrideFieldKey"] === getCustomFieldFormKey(name);
    },
  );

  expect(field).toBeDefined();
  return field!;
}

function detailsStep():
  | {
      id: string;
      title: string;
      showIf?: (values: Record<string, unknown>) => boolean;
    }
  | undefined {
  return lastForm().steps.find((step: { id: string }) => {
    return step.id === INCIDENT_DETAILS_STEP_ID;
  });
}

async function declare(
  formValues: Record<string, unknown>,
  miscDataProps: Record<string, unknown> = {},
): Promise<{ item: Incident; miscDataProps: Record<string, unknown> }> {
  const item: Incident = new Incident();
  item.title = "Payments are failing";

  const result: Incident = (await lastForm().onBeforeCreate(
    item,
    miscDataProps,
    formValues,
  )) as Incident;

  return { item: result, miscDataProps: miscDataProps };
}

function templateWith(customFields: JSONObject | undefined): IncidentTemplate {
  const template: IncidentTemplate = new IncidentTemplate();
  template._id = TEMPLATE_ID;
  template.title = "Site outage";

  if (customFields) {
    template.customFields = customFields;
  }

  return template;
}

beforeEach(() => {
  capturedForms = [];
  queryString = {};
  definitions = [IMPACT, DURATION, ACKNOWLEDGEMENT, CATEGORY];

  jest
    .spyOn(Navigation, "getQueryStringByName")
    .mockImplementation((name: string): string | null => {
      return queryString[name] || null;
    });

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
  getItemMock.mockReset();
  getItemMock.mockResolvedValue(null);
  countMock.mockReset();
  countMock.mockResolvedValue(4);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("the Details step on the Create page", () => {
  test("asks for the Show on Create fields, in their order, after Resources Affected", async () => {
    await renderCreate();

    expect(
      detailsFields().map((field: Record<string, unknown>) => {
        return field["title"];
      }),
    ).toEqual(["Impact", "Estimated Duration", "Acknowledgement"]);

    const stepIds: Array<string> = lastForm().steps.map(
      (step: { id: string }) => {
        return step.id;
      },
    );

    expect(stepIds.indexOf(INCIDENT_DETAILS_STEP_ID)).toBe(
      stepIds.indexOf("resources-affected") + 1,
    );
    expect(detailsStep()!.title).toBe(INCIDENT_DETAILS_STEP_TITLE);
    expect(INCIDENT_DETAILS_STEP_TITLE).toBe("Details");
  });

  test("reads the project's incident fields with every setting it needs", async () => {
    await renderCreate();

    const request: { select: JSONObject; sort: JSONObject } =
      getListMock.mock.calls.find((call: Array<unknown>) => {
        return (
          (call[0] as { modelType: unknown }).modelType === IncidentCustomField
        );
      })![0] as { select: JSONObject; sort: JSONObject };

    expect(request.select).toMatchObject({
      name: true,
      customFieldType: true,
      dropdownOptions: true,
      sortOrder: true,
      showOnCreate: true,
      isRequiredOnCreate: true,
      mapFromResourceType: true,
      mapFromCustomFieldName: true,
    });
    expect(Object.keys(request.sort)).toEqual(["sortOrder"]);
  });

  test("is hidden when no field is marked Show on Create", async () => {
    definitions = [CATEGORY];

    await renderCreate();

    expect(detailsStep()).toBeUndefined();
    expect(detailsFields()).toEqual([]);
  });

  test("is hidden when the project has no incident custom fields", async () => {
    definitions = [];

    await renderCreate();

    expect(detailsStep()).toBeUndefined();
  });

  test("is hidden, and the form still renders, when the fields cannot be read", async () => {
    definitions = new Error("Custom fields are not on your plan.");

    await renderCreate();

    expect(detailsStep()).toBeUndefined();
    expect(lastForm().fields.length).toBeGreaterThan(0);
  });

  test("the form waits for the fields: its first render already has the step", async () => {
    await renderCreate();

    expect(
      capturedForms[0]!.steps.some((step: { id: string }) => {
        return step.id === INCIDENT_DETAILS_STEP_ID;
      }),
    ).toBe(true);
  });

  test("each input is held apart from the incident's columns and checked against customFields", async () => {
    await renderCreate();

    for (const field of detailsFields()) {
      expect(field["field"]).toBeUndefined();
      expect(field["overrideField"]).toEqual({ customFields: true });
      expect(String(field["overrideFieldKey"])).toMatch(/^customFields:/);
    }
  });

  test("Required on Create makes a field required; the others stay optional", async () => {
    await renderCreate();

    expect(detailsField("Impact")["required"]).toBe(true);
    expect(detailsField("Estimated Duration")["required"]).toBe(false);
  });

  test("a required acknowledgement must be checked", async () => {
    await renderCreate();

    const acknowledgementField: Field<JSONObject> = {
      ...(detailsField("Acknowledgement") as unknown as Field<JSONObject>),
      name: getCustomFieldFormKey("Acknowledgement"),
    };

    const errorFor: (value: unknown) => string | undefined = (
      value: unknown,
    ): string | undefined => {
      return Validation.validate<JSONObject>({
        formFields: [acknowledgementField],
        values: {
          [getCustomFieldFormKey("Acknowledgement")]: value,
        } as FormValues<JSONObject>,
        onValidate: undefined,
      })[getCustomFieldFormKey("Acknowledgement")];
    };

    expect(errorFor(false)).toBe("Acknowledgement must be checked.");
    expect(errorFor(true)).toBeUndefined();
  });
});

describe("declaring: the Details step's answers", () => {
  test("0 and false survive", async () => {
    await renderCreate();

    const { item } = await declare({
      title: "Payments are failing",
      [getCustomFieldFormKey("Impact")]: "High",
      [getCustomFieldFormKey("Estimated Duration")]: 0,
      [getCustomFieldFormKey("Acknowledgement")]: false,
    });

    expect(item.customFields).toEqual({
      Impact: "High",
      "Estimated Duration": 0,
      Acknowledgement: false,
    });
  });

  test("travel in customFields only, never as misc data", async () => {
    await renderCreate();

    const { miscDataProps } = await declare(
      { [getCustomFieldFormKey("Impact")]: "High" },
      {
        [getCustomFieldFormKey("Impact")]: "High",
        incidentRoles: ["role-1"],
      },
    );

    expect(miscDataProps).toEqual({ incidentRoles: ["role-1"] });
  });

  test("no answers and no template: customFields is left unset", async () => {
    await renderCreate();

    const { item } = await declare({ title: "Payments are failing" });

    expect(item.customFields).toBeUndefined();
  });
});

describe("declaring from a template", () => {
  beforeEach(() => {
    queryString = { incidentTemplateId: TEMPLATE_ID };
  });

  test("reads the template's custom field values", async () => {
    getItemMock.mockResolvedValue(templateWith({ Impact: "High" }));

    await renderCreate();

    const request: { modelType: unknown; select: JSONObject } =
      getItemMock.mock.calls.find((call: Array<unknown>) => {
        return (
          (call[0] as { modelType: unknown }).modelType === IncidentTemplate
        );
      })![0] as { modelType: unknown; select: JSONObject };

    expect(request.select["customFields"]).toBe(true);
  });

  test("starts the Details step from the template's values", async () => {
    getItemMock.mockResolvedValue(
      templateWith({
        Impact: "High",
        "Estimated Duration": 0,
        Acknowledgement: false,
        Category: "Network",
      }),
    );

    await renderCreate();

    expect(lastForm().initialValues).toMatchObject({
      title: "Site outage",
      [getCustomFieldFormKey("Impact")]: "High",
      [getCustomFieldFormKey("Estimated Duration")]: 0,
      [getCustomFieldFormKey("Acknowledgement")]: false,
    });
    // Only the fields the step asks for have inputs.
    expect(lastForm().initialValues).not.toHaveProperty([
      getCustomFieldFormKey("Category"),
    ]);
    // And the bag itself is not carried along unseen as a form value.
    expect(lastForm().initialValues).not.toHaveProperty(["customFields"]);
  });

  test("the answers merge over the template's values, which fill in the rest", async () => {
    getItemMock.mockResolvedValue(
      templateWith({
        Impact: "High",
        Category: "Network",
        "Deleted Field": "kept as it was",
      }),
    );

    await renderCreate();

    const { item } = await declare({
      [getCustomFieldFormKey("Impact")]: "Low",
      [getCustomFieldFormKey("Estimated Duration")]: 0,
      [getCustomFieldFormKey("Acknowledgement")]: true,
    });

    expect(item.customFields).toEqual({
      Impact: "Low",
      "Estimated Duration": 0,
      Acknowledgement: true,
      Category: "Network",
      "Deleted Field": "kept as it was",
    });
  });

  test("a template value the person clears stays cleared", async () => {
    getItemMock.mockResolvedValue(
      templateWith({ Impact: "High", Category: "Network" }),
    );

    await renderCreate();

    const { item } = await declare({
      [getCustomFieldFormKey("Impact")]: "",
    });

    expect(item.customFields).toEqual({ Category: "Network" });
  });

  test("a template value that no longer fits its field is dropped, not sent", async () => {
    getItemMock.mockResolvedValue(
      templateWith({
        // Removed from both dropdowns since the template was saved.
        Impact: "Critical",
        Category: "Weather",
        "Estimated Duration": 30,
      }),
    );

    await renderCreate();

    expect(lastForm().initialValues).not.toHaveProperty([
      getCustomFieldFormKey("Impact"),
    ]);
    expect(
      lastForm().initialValues[getCustomFieldFormKey("Estimated Duration")],
    ).toBe(30);

    const { item } = await declare({
      [getCustomFieldFormKey("Estimated Duration")]: 30,
    });

    expect(item.customFields).toEqual({ "Estimated Duration": 30 });
  });

  test("a template with no custom field values adds none", async () => {
    getItemMock.mockResolvedValue(templateWith(undefined));

    await renderCreate();

    const { item } = await declare({});

    expect(item.customFields).toBeUndefined();
  });
});

describe("a field copied from the incident's monitor", () => {
  beforeEach(() => {
    definitions = [IMPACT, SITE];
  });

  test("is asked while the incident has no monitor", async () => {
    await renderCreate();

    const site: Record<string, unknown> = detailsField("Site");
    const showIf: (values: Record<string, unknown>) => boolean = site[
      "showIf"
    ] as (values: Record<string, unknown>) => boolean;

    expect(showIf({ monitors: [] })).toBe(true);
    expect(showIf({ monitors: ["m1"] })).toBe(false);
  });

  test("is not packed once there is a monitor to copy it from", async () => {
    await renderCreate();

    const { item } = await declare({
      monitors: ["m1"],
      [getCustomFieldFormKey("Impact")]: "High",
      [getCustomFieldFormKey("Site")]: "Typed by hand",
    });

    expect(item.customFields).toEqual({ Impact: "High" });
  });

  test("the step stays while any field on it is asked", async () => {
    await renderCreate();

    expect(detailsStep()!.showIf!({ monitors: ["m1"] })).toBe(true);
  });

  test("the step goes when every field on it is copied from the monitor", async () => {
    definitions = [SITE];

    await renderCreate();

    expect(detailsStep()!.showIf!({ monitors: ["m1"] })).toBe(false);
    expect(detailsStep()!.showIf!({ monitors: [] })).toBe(true);
  });
});
