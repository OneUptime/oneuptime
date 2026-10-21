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
 * An incident template's custom field values - IncidentTemplate.customFields,
 * which the Create page and the server now start an incident from:
 *
 *   - a new template sets them in a Custom Fields step of its create form,
 *     with every incident field (a template can fill in fields the Details
 *     step does not ask), none of them required, packed into customFields
 *     from what the form submitted;
 *   - a template's page edits them in the same Custom Fields card every
 *     incident has, pointed at the template.
 *
 * The tables and cards are stubbed and their props recorded.
 */

const recordedTables: Array<Record<string, unknown>> = [];
const recordedCustomFieldCards: Array<Record<string, unknown>> = [];

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: Record<string, unknown>): ReactElement => {
      recordedTables.push(props);
      return React.createElement("div");
    },
  };
});

jest.mock("../../../UI/Components/ModelDetail/CardModelDetail", () => {
  return {
    __esModule: true,
    default: (): ReactElement => {
      return React.createElement("div");
    },
  };
});

jest.mock("../../../UI/Components/ModelDelete/ModelDelete", () => {
  return {
    __esModule: true,
    default: (): ReactElement => {
      return React.createElement("div");
    },
  };
});

jest.mock("../../../UI/Components/CustomFields/CustomFieldsDetail", () => {
  return {
    __esModule: true,
    default: (props: Record<string, unknown>): ReactElement => {
      recordedCustomFieldCards.push(props);
      return React.createElement("div");
    },
  };
});

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
import IncidentCustomFieldsCopy from "../../../../App/FeatureSet/Dashboard/src/Components/Incident/IncidentCustomFieldsCopy";
import IncidentCustomField from "../../../Models/DatabaseModels/IncidentCustomField";
import IncidentTemplate from "../../../Models/DatabaseModels/IncidentTemplate";
import Route from "../../../Types/API/Route";
import CustomFieldType from "../../../Types/CustomField/CustomFieldType";
import ObjectID from "../../../Types/ObjectID";
import { getCustomFieldFormKey } from "../../../UI/Components/CustomFields/CustomFieldModelFormFields";
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

let definitions: Array<IncidentCustomField> | Error = [];

beforeEach(() => {
  definitions = [
    customField({
      name: "Impact",
      customFieldType: CustomFieldType.Dropdown,
      dropdownOptions: "Low\nMedium\nHigh",
      showOnCreate: true,
      isRequiredOnCreate: true,
      sortOrder: 2,
    }),
    // Not asked when declaring; a template can still fill it in.
    customField({
      name: "Category",
      sortOrder: 1,
    }),
    customField({
      name: "Acknowledgement",
      customFieldType: CustomFieldType.Boolean,
      showOnCreate: true,
      isRequiredOnCreate: true,
      sortOrder: 3,
    }),
  ];

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
  recordedCustomFieldCards.length = 0;
  jest.restoreAllMocks();
});

type TemplatesTableProps = {
  modelType: unknown;
  formSteps: Array<{ id: string; title: string }>;
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

function customFieldInputs(): Array<Record<string, unknown>> {
  return templatesTable().formFields.filter(
    (field: Record<string, unknown>) => {
      return field["stepId"] === INCIDENT_TEMPLATE_CUSTOM_FIELDS_STEP_ID;
    },
  );
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

describe("a new incident template: the Custom Fields step", () => {
  test("asks for every incident field, in their order, none required", async () => {
    await renderTemplatesPage();

    await waitFor(() => {
      expect(customFieldInputs().length).toBe(3);
    });

    expect(
      customFieldInputs().map((field: Record<string, unknown>) => {
        return field["title"];
      }),
    ).toEqual(["Category", "Impact", "Acknowledgement"]);

    for (const field of customFieldInputs()) {
      expect(field["required"]).toBe(false);
      expect(field["customValidation"]).toBeUndefined();
      expect(field["overrideField"]).toEqual({ customFields: true });
    }

    expect(
      templatesTable().formSteps.some((step: { id: string }) => {
        return step.id === INCIDENT_TEMPLATE_CUSTOM_FIELDS_STEP_ID;
      }),
    ).toBe(true);
  });

  test("packs the answers into customFields: 0 and false survive, and nothing travels as misc data", async () => {
    await renderTemplatesPage();

    await waitFor(() => {
      expect(customFieldInputs().length).toBe(3);
    });

    const item: IncidentTemplate = new IncidentTemplate();
    const miscDataProps: Record<string, unknown> = {
      [getCustomFieldFormKey("Impact")]: "High",
      ownerTeams: ["team-1"],
    };

    const result: IncidentTemplate = await templatesTable().onBeforeCreate(
      item,
      miscDataProps,
      {
        templateName: "Site outage",
        [getCustomFieldFormKey("Impact")]: "High",
        [getCustomFieldFormKey("Category")]: "",
        [getCustomFieldFormKey("Acknowledgement")]: false,
      },
    );

    expect(result.customFields).toEqual({
      Impact: "High",
      Acknowledgement: false,
    });
    expect(miscDataProps).toEqual({ ownerTeams: ["team-1"] });
  });

  test("a template given no values gets no customFields", async () => {
    await renderTemplatesPage();

    await waitFor(() => {
      expect(customFieldInputs().length).toBe(3);
    });

    const result: IncidentTemplate = await templatesTable().onBeforeCreate(
      new IncidentTemplate(),
      {},
      { templateName: "Site outage" },
    );

    expect(result.customFields).toBeUndefined();
  });

  test("no step when the project has no incident custom fields", async () => {
    definitions = [];

    await renderTemplatesPage();

    await waitFor(() => {
      expect(getListMock).toHaveBeenCalled();
    });

    expect(customFieldInputs()).toEqual([]);
    expect(
      templatesTable().formSteps.some((step: { id: string }) => {
        return step.id === INCIDENT_TEMPLATE_CUSTOM_FIELDS_STEP_ID;
      }),
    ).toBe(false);
  });

  test("no step, and the page still works, when the fields cannot be read", async () => {
    definitions = new Error("Custom fields are not on your plan.");

    await renderTemplatesPage();

    await waitFor(() => {
      expect(getListMock).toHaveBeenCalled();
    });

    expect(customFieldInputs()).toEqual([]);
    expect(templatesTable().formFields.length).toBeGreaterThan(0);
  });
});

describe("an incident template's page: the Custom Fields card", () => {
  test("edits the template's values with the incident custom fields", async () => {
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

    expect(recordedCustomFieldCards).not.toHaveLength(0);

    const card: Record<string, unknown> =
      recordedCustomFieldCards[recordedCustomFieldCards.length - 1]!;

    expect(card["modelType"]).toBe(IncidentTemplate);
    expect(card["customFieldType"]).toBe(IncidentCustomField);
    expect(String(card["modelId"])).toBe(TEMPLATE_ID);
    expect(String(card["projectId"])).toBe(
      "11111111-1111-4111-8111-111111111111",
    );
    // Nothing on a project with no incident custom fields.
    expect(card["hideIfEmpty"]).toBe(true);
    expect(card["title"]).toBe(
      IncidentCustomFieldsCopy.templateCustomFieldsCardTitle,
    );
    expect(card["description"]).toBe(
      IncidentCustomFieldsCopy.templateCustomFieldsCardDescription,
    );
  });
});
