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
 * Declaring an incident from a template that has Custom Fields on Create
 * (IncidentTemplate.customFieldSettings, issue #4114): the template decides,
 * field by field, what the Details step asks for.
 *
 *   - Required asks for a field and requires it, whatever the project says;
 *   - Optional asks for it and lets it be left empty;
 *   - Hidden leaves it out - and the template's own value for it still
 *     reaches the incident, like any field the step does not ask;
 *   - Default, or nothing stored, leaves the field's own Show on Create and
 *     Required on Create in charge.
 *
 * The settings come in the one template request the page already makes, and
 * everything the Details step feeds - its inputs, their starting values,
 * what is packed on declare and in the subscriber preview - follows them.
 * ModelForm is stubbed to capture what it is handed, as in
 * IncidentCreateDetailsStep.test.tsx.
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

type PreviewRequestGetter = () => {
  incident: { customFields: Record<string, unknown> };
} | null;

let previewRequestGetters: Array<PreviewRequestGetter> = [];

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Incident/SubscriberNotificationPreviewButton",
  () => {
    return {
      __esModule: true,
      default: (props: {
        getRequest: PreviewRequestGetter;
      }): React.ReactElement => {
        previewRequestGetters.push(props.getRequest);
        return <div data-testid="preview-button" />;
      },
    };
  },
);

const getListMock: MockFunction = getJestMockFunction();
const getItemMock: MockFunction = getJestMockFunction();

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
      count: async (): Promise<number> => {
        return 0;
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
import { INCIDENT_DETAILS_STEP_ID } from "../../../../App/FeatureSet/Dashboard/src/Components/Incident/IncidentCustomFieldDefinitions";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentCustomField from "../../../Models/DatabaseModels/IncidentCustomField";
import IncidentTemplate from "../../../Models/DatabaseModels/IncidentTemplate";
import Route from "../../../Types/API/Route";
import CustomFieldMappingSourceResource from "../../../Types/CustomField/CustomFieldMappingSourceResource";
import CustomFieldType from "../../../Types/CustomField/CustomFieldType";
import { INCIDENT_CREATE_ALERT_IDS_QUERY_PARAM } from "../../../Types/Incident/IncidentAlertLink";
import { JSONObject } from "../../../Types/JSON";
import { getCustomFieldFormKey } from "../../../UI/Components/CustomFields/CustomFieldModelFormFields";
import Field from "../../../UI/Components/Forms/Types/Field";
import FormValues from "../../../UI/Components/Forms/Types/FormValues";
import Validation from "../../../UI/Components/Forms/Validation";
import Navigation from "../../../UI/Utils/Navigation";

const TEMPLATE_ID: string = "66666666-6666-4666-8666-000000000001";
const ALERT_ONE_ID: string = "22222222-2222-4222-8222-000000000001";

function customField(
  overrides: Partial<IncidentCustomField> & { name: string },
): IncidentCustomField {
  const field: IncidentCustomField = new IncidentCustomField();
  field.customFieldType = CustomFieldType.Text;
  Object.assign(field, overrides);
  return field;
}

// Shown and required by the project.
const IMPACT: IncidentCustomField = customField({
  name: "Impact",
  customFieldType: CustomFieldType.Dropdown,
  dropdownOptions: "Low\nMedium\nHigh",
  showOnCreate: true,
  isRequiredOnCreate: true,
  sortOrder: 1,
  variableKey: "impact",
});
// Shown, optional.
const DURATION: IncidentCustomField = customField({
  name: "Estimated Duration",
  customFieldType: CustomFieldType.Number,
  showOnCreate: true,
  sortOrder: 2,
  variableKey: "estimated_duration",
});
// Not shown by the project.
const CATEGORY: IncidentCustomField = customField({
  name: "Category",
  customFieldType: CustomFieldType.Dropdown,
  dropdownOptions: "Network\nPower",
  sortOrder: 3,
  variableKey: "category",
});
// Not shown, and a yes/no.
const CUSTOMER_NOTIFIED: IncidentCustomField = customField({
  name: "Customer Notified",
  customFieldType: CustomFieldType.Boolean,
  sortOrder: 4,
  variableKey: "customer_notified",
});
// Required by the project but not shown: it is not asked.
const ROOT_CAUSE: IncidentCustomField = customField({
  name: "Root Cause",
  isRequiredOnCreate: true,
  sortOrder: 5,
  variableKey: "root_cause",
});

const ALL_KEYED: Array<IncidentCustomField> = [
  IMPACT,
  DURATION,
  CATEGORY,
  CUSTOMER_NOTIFIED,
  ROOT_CAUSE,
];

let definitions: Array<IncidentCustomField> = [];
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

// The Details step as a list of [field, required?], in its order.
function detailsStepAsked(): Array<[string, boolean]> {
  return detailsFields().map(
    (field: Record<string, unknown>): [string, boolean] => {
      return [String(field["title"]), field["required"] === true];
    },
  );
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

function hasDetailsStep(): boolean {
  return lastForm().steps.some((step: { id: string }) => {
    return step.id === INCIDENT_DETAILS_STEP_ID;
  });
}

async function declare(
  formValues: Record<string, unknown>,
): Promise<{ item: Incident; miscDataProps: Record<string, unknown> }> {
  const item: Incident = new Incident();
  item.title = "Customer data exposed";
  const miscDataProps: Record<string, unknown> = {};

  const result: Incident = (await lastForm().onBeforeCreate(
    item,
    miscDataProps,
    formValues,
  )) as Incident;

  return { item: result, miscDataProps: miscDataProps };
}

function template(data: {
  customFieldSettings?: unknown;
  customFields?: JSONObject;
}): IncidentTemplate {
  const incidentTemplate: IncidentTemplate = new IncidentTemplate();
  incidentTemplate._id = TEMPLATE_ID;
  incidentTemplate.title = "Customer data exposure";

  if (data.customFieldSettings !== undefined) {
    incidentTemplate.customFieldSettings =
      data.customFieldSettings as JSONObject;
  }

  if (data.customFields) {
    incidentTemplate.customFields = data.customFields;
  }

  return incidentTemplate;
}

async function declareFromTemplate(data: {
  customFieldSettings?: unknown;
  customFields?: JSONObject;
}): Promise<void> {
  queryString = { incidentTemplateId: TEMPLATE_ID };
  getItemMock.mockResolvedValue(template(data) as never);

  await renderCreate();
}

beforeEach(() => {
  capturedForms = [];
  previewRequestGetters = [];
  queryString = {};
  definitions = [...ALL_KEYED];

  jest
    .spyOn(Navigation, "getQueryStringByName")
    .mockImplementation((name: string): string | null => {
      return queryString[name] || null;
    });

  getListMock.mockReset();
  getListMock.mockImplementation(async (...args: Array<unknown>) => {
    const request: { modelType: unknown } = args[0] as { modelType: unknown };

    if (request.modelType === IncidentCustomField) {
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
  getItemMock.mockResolvedValue(null as never);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("reading a template's Custom Fields on Create", () => {
  test("in the one template request the page already makes", async () => {
    await declareFromTemplate({
      customFieldSettings: { category: "Required" },
    });

    expect(getItemMock).toHaveBeenCalledTimes(1);

    const request: { modelType: unknown; select: JSONObject } = getItemMock.mock
      .calls[0]![0] as { modelType: unknown; select: JSONObject };

    expect(request.modelType).toBe(IncidentTemplate);
    expect(request.select["customFieldSettings"]).toBe(true);
    // With the values the Details step starts from.
    expect(request.select["customFields"]).toBe(true);
  });

  test("the settings only shape the step: they are not carried as a form value", async () => {
    await declareFromTemplate({
      customFieldSettings: { category: "Required" },
      customFields: { Category: "Power" },
    });

    expect(lastForm().initialValues).not.toHaveProperty([
      "customFieldSettings",
    ]);
    expect(lastForm().initialValues).not.toHaveProperty(["customFields"]);

    const { item } = await declare({
      [getCustomFieldFormKey("Category")]: "Power",
    });

    expect(
      (item as unknown as Record<string, unknown>)["customFieldSettings"],
    ).toBeUndefined();
  });
});

describe("the Details step, declared from a template", () => {
  test("without a template, every field follows its own settings", async () => {
    await renderCreate();

    expect(getItemMock).not.toHaveBeenCalled();
    expect(detailsStepAsked()).toEqual([
      ["Impact", true],
      ["Estimated Duration", false],
    ]);
  });

  test("a template without settings changes nothing", async () => {
    await declareFromTemplate({});

    expect(detailsStepAsked()).toEqual([
      ["Impact", true],
      ["Estimated Duration", false],
    ]);
  });

  test("Required asks for a field the project does not show, and requires it", async () => {
    await declareFromTemplate({
      customFieldSettings: { category: "Required" },
    });

    expect(detailsStepAsked()).toEqual([
      ["Impact", true],
      ["Estimated Duration", false],
      ["Category", true],
    ]);
  });

  test("Required makes an optional field required", async () => {
    await declareFromTemplate({
      customFieldSettings: { estimated_duration: "Required" },
    });

    expect(detailsField("Estimated Duration")["required"]).toBe(true);
  });

  test("Required asks for a field the project requires but does not show", async () => {
    await declareFromTemplate({
      customFieldSettings: { root_cause: "Required" },
    });

    expect(detailsField("Root Cause")["required"]).toBe(true);
  });

  test("Optional asks for a field and lets it be empty - even one the project requires", async () => {
    await declareFromTemplate({
      customFieldSettings: { impact: "Optional", category: "Optional" },
    });

    expect(detailsStepAsked()).toEqual([
      ["Impact", false],
      ["Estimated Duration", false],
      ["Category", false],
    ]);
  });

  test("Hidden leaves out a field the project shows, or requires", async () => {
    await declareFromTemplate({
      customFieldSettings: { impact: "Hidden" },
    });

    expect(detailsStepAsked()).toEqual([["Estimated Duration", false]]);
  });

  test("Default leaves the field as the project has it", async () => {
    await declareFromTemplate({
      customFieldSettings: { impact: "Default", category: "Default" },
    });

    expect(detailsStepAsked()).toEqual([
      ["Impact", true],
      ["Estimated Duration", false],
    ]);
  });

  test("the step is exactly what the settings make it, in the fields' order", async () => {
    await declareFromTemplate({
      customFieldSettings: {
        root_cause: "Optional",
        impact: "Optional",
        estimated_duration: "Hidden",
        customer_notified: "Required",
        category: "Default",
      },
    });

    expect(detailsStepAsked()).toEqual([
      ["Impact", false],
      ["Customer Notified", true],
      ["Root Cause", false],
    ]);
  });

  test("a yes/no field the template requires must be ticked", async () => {
    await declareFromTemplate({
      customFieldSettings: { customer_notified: "Required" },
    });

    const formKey: string = getCustomFieldFormKey("Customer Notified");
    const field: Field<JSONObject> = {
      ...(detailsField("Customer Notified") as unknown as Field<JSONObject>),
      name: formKey,
    };

    const errorFor: (value: unknown) => string | undefined = (
      value: unknown,
    ): string | undefined => {
      return Validation.validate<JSONObject>({
        formFields: [field],
        values: { [formKey]: value } as FormValues<JSONObject>,
        onValidate: undefined,
      })[formKey];
    };

    expect(errorFor(false)).toBe("Customer Notified must be checked.");
    expect(errorFor(true)).toBeUndefined();
  });

  test("with every field hidden there is no Details step at all", async () => {
    await declareFromTemplate({
      customFieldSettings: { impact: "Hidden", estimated_duration: "Hidden" },
    });

    expect(detailsFields()).toEqual([]);
    expect(hasDetailsStep()).toBe(false);
  });

  test("entries the dashboard cannot read leave their fields on Default", async () => {
    await declareFromTemplate({
      customFieldSettings: {
        impact: "hidden",
        category: "Sometimes",
        "Not A Key": "Required",
        estimated_duration: 7,
      },
    });

    expect(detailsStepAsked()).toEqual([
      ["Impact", true],
      ["Estimated Duration", false],
    ]);
  });

  test("a settings value that is not an object changes nothing", async () => {
    await declareFromTemplate({ customFieldSettings: ["impact"] });

    expect(detailsStepAsked()).toEqual([
      ["Impact", true],
      ["Estimated Duration", false],
    ]);
  });

  test("a field without a template variable key follows its own settings", async () => {
    definitions = [
      ...ALL_KEYED,
      customField({ name: "Legacy", showOnCreate: true, sortOrder: 6 }),
    ];

    await declareFromTemplate({
      customFieldSettings: { impact: "Hidden", estimated_duration: "Hidden" },
    });

    expect(detailsStepAsked()).toEqual([["Legacy", false]]);
  });
});

describe("the template's values under its settings", () => {
  test("a field the template requires starts from the template's value", async () => {
    await declareFromTemplate({
      customFieldSettings: { category: "Required" },
      customFields: { Category: "Power" },
    });

    expect(lastForm().initialValues[getCustomFieldFormKey("Category")]).toBe(
      "Power",
    );
  });

  test("a hidden field has no input, and keeps the template's value", async () => {
    await declareFromTemplate({
      customFieldSettings: { impact: "Hidden" },
      customFields: { Impact: "High", "Estimated Duration": 30 },
    });

    expect(lastForm().initialValues).not.toHaveProperty([
      getCustomFieldFormKey("Impact"),
    ]);
    expect(
      lastForm().initialValues[getCustomFieldFormKey("Estimated Duration")],
    ).toBe(30);

    const { item } = await declare({
      [getCustomFieldFormKey("Estimated Duration")]: 45,
    });

    expect(item.customFields).toEqual({
      Impact: "High",
      "Estimated Duration": 45,
    });
  });

  test("a hidden field keeps the template's value even if a stale input says otherwise", async () => {
    await declareFromTemplate({
      customFieldSettings: { impact: "Hidden" },
      customFields: { Impact: "High" },
    });

    const { item } = await declare({
      [getCustomFieldFormKey("Impact")]: "Low",
    });

    expect(item.customFields).toEqual({ Impact: "High" });
  });

  test("with every field hidden, the template's values still reach the incident", async () => {
    await declareFromTemplate({
      customFieldSettings: {
        impact: "Hidden",
        estimated_duration: "Hidden",
        category: "Hidden",
      },
      customFields: { Impact: "High", Category: "Network" },
    });

    expect(hasDetailsStep()).toBe(false);

    const { item } = await declare({});

    expect(item.customFields).toEqual({ Impact: "High", Category: "Network" });
  });

  test("an answer to a field the template asks for is packed like any other", async () => {
    await declareFromTemplate({
      customFieldSettings: { customer_notified: "Optional" },
    });

    const { item } = await declare({
      [getCustomFieldFormKey("Impact")]: "Medium",
      [getCustomFieldFormKey("Customer Notified")]: false,
    });

    expect(item.customFields).toEqual({
      Impact: "Medium",
      "Customer Notified": false,
    });
  });

  test("the subscriber preview packs the same fields as the declare", async () => {
    await declareFromTemplate({
      customFieldSettings: { impact: "Hidden", category: "Optional" },
      customFields: { Impact: "High" },
    });

    const values: Record<string, unknown> = {
      title: "Customer data exposed",
      [getCustomFieldFormKey("Impact")]: "Low",
      [getCustomFieldFormKey("Category")]: "Network",
      [getCustomFieldFormKey("Estimated Duration")]: 0,
    };

    const notifyField: Record<string, unknown> | undefined =
      lastForm().fields.find((field: Record<string, unknown>): boolean => {
        return Boolean(
          (field["field"] as Record<string, unknown> | undefined)?.[
            "shouldStatusPageSubscribersBeNotifiedOnIncidentCreated"
          ],
        );
      });

    const summary: React.ReactElement = (
      notifyField!["getSummaryElement"] as (
        values: Record<string, unknown>,
      ) => React.ReactElement
    )(values);

    render(<MemoryRouter>{summary}</MemoryRouter>);

    expect(previewRequestGetters).not.toHaveLength(0);

    const preview: ReturnType<PreviewRequestGetter> =
      previewRequestGetters[previewRequestGetters.length - 1]!();

    const { item } = await declare(values);

    expect(preview!.incident.customFields).toEqual({
      Impact: "High",
      Category: "Network",
      "Estimated Duration": 0,
    });
    expect(preview!.incident.customFields).toEqual(item.customFields);
  });
});

describe("a template's settings and a field copied from a monitor", () => {
  test("a field the template requires is still not asked once there is a monitor", async () => {
    definitions = [
      ...ALL_KEYED,
      customField({
        name: "Site",
        sortOrder: 6,
        variableKey: "site",
        mapFromResourceType: CustomFieldMappingSourceResource.Monitor,
        mapFromCustomFieldName: "Site",
      }),
    ];

    await declareFromTemplate({ customFieldSettings: { site: "Required" } });

    const site: Record<string, unknown> = detailsField("Site");
    const showIf: (values: Record<string, unknown>) => boolean = site[
      "showIf"
    ] as (values: Record<string, unknown>) => boolean;

    expect(site["required"]).toBe(true);
    expect(showIf({ monitors: [] })).toBe(true);
    expect(showIf({ monitors: ["m1"] })).toBe(false);
  });
});

describe("declaring from alerts with a template", () => {
  test("applies the template's settings through the same request", async () => {
    queryString = {
      incidentTemplateId: TEMPLATE_ID,
      [INCIDENT_CREATE_ALERT_IDS_QUERY_PARAM]: ALERT_ONE_ID,
    };
    getItemMock.mockResolvedValue(
      template({
        customFieldSettings: { impact: "Hidden", category: "Required" },
        customFields: { Impact: "High" },
      }) as never,
    );

    await renderCreate();

    expect(getItemMock).toHaveBeenCalledTimes(1);
    expect(detailsStepAsked()).toEqual([
      ["Estimated Duration", false],
      ["Category", true],
    ]);

    const { item } = await declare({
      [getCustomFieldFormKey("Category")]: "Power",
    });

    expect(item.customFields).toEqual({ Impact: "High", Category: "Power" });
  });
});
