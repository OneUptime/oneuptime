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
import React, { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * An incident template's 'Status Page Scope' card. A template keeps being
 * limited to status pages after every page it listed was deleted (the join
 * rows cascade away, IncidentTemplate.isScopedToStatusPages stays): an
 * incident declared from it through the API is then hidden from every status
 * page, and the Declare Incident form starts with no page picked. The card
 * says so, instead of reading "Not limited" - which is what it looks like
 * without the flag, and what the incidents from it used to become.
 *
 * The status page picker - on the card's edit form, and on a new template's
 * Resources Affected step - has no banner under it: the one that explained
 * an empty list ("No status pages to pick from ... Ask a project admin.")
 * was removed at the maintainer's request, and with it the request that
 * counted the status pages the person can read.
 *
 * The cards and tables on the page are stubbed and their props recorded; the
 * test renders what the scope card shows for a template.
 */

const recordedCards: Array<Record<string, unknown>> = [];
const recordedTables: Array<Record<string, unknown>> = [];
const countMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Components/ModelDetail/CardModelDetail", () => {
  return {
    __esModule: true,
    default: (props: Record<string, unknown>): ReactElement => {
      recordedCards.push(props);
      return React.createElement("div");
    },
  };
});

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: Record<string, unknown>): ReactElement => {
      recordedTables.push(props);
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

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      count: (...args: Array<unknown>): unknown => {
        return countMock(...args);
      },
      getList: async (): Promise<unknown> => {
        return { data: [], count: 0, skip: 0, limit: 0 };
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
import IncidentStatusPageScopeCopy from "../../../../App/FeatureSet/Dashboard/src/Components/Incident/IncidentStatusPageScopeCopy";
import IncidentTemplate from "../../../Models/DatabaseModels/IncidentTemplate";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import Route from "../../../Types/API/Route";
import ObjectID from "../../../Types/ObjectID";
import FormFieldSchemaType from "../../../UI/Components/Forms/Types/FormFieldSchemaType";
import Navigation from "../../../UI/Utils/Navigation";

const TEMPLATE_ID: string = "a1b2c3d4-0000-4000-8000-0000000000aa";

interface ScopeCardProps {
  formFields: Array<Record<string, unknown>>;
  modelDetailProps: {
    fields: Array<{ getElement: (item: IncidentTemplate) => ReactElement }>;
    selectMoreFields?: Record<string, unknown>;
  };
}

function scopeCard(): ScopeCardProps {
  const card: Record<string, unknown> | undefined = recordedCards.find(
    (props: Record<string, unknown>): boolean => {
      return props["name"] === "Incident Template > Status Page Scope";
    },
  );

  expect(card).toBeDefined();
  return card as unknown as ScopeCardProps;
}

function template(data: {
  isScoped: boolean;
  statusPages: Array<{ id: string; name: string }>;
}): IncidentTemplate {
  const incidentTemplate: IncidentTemplate = new IncidentTemplate();
  incidentTemplate._id = TEMPLATE_ID;
  incidentTemplate.isScopedToStatusPages = data.isScoped;
  incidentTemplate.statusPages = data.statusPages.map(
    (page: { id: string; name: string }): StatusPage => {
      const statusPage: StatusPage = new StatusPage();
      statusPage._id = page.id;
      statusPage.name = page.name;
      return statusPage;
    },
  );
  return incidentTemplate;
}

// The status page picker among a form's fields.
function statusPagePicker(
  fields: Array<Record<string, unknown>>,
): Record<string, unknown> {
  const pickers: Array<Record<string, unknown>> = fields.filter(
    (field: Record<string, unknown>): boolean => {
      const key: Record<string, unknown> | undefined = field["field"] as
        | Record<string, unknown>
        | undefined;
      return Boolean(key && "statusPages" in key);
    },
  );

  expect(pickers).toHaveLength(1);
  return pickers[0]!;
}

// The page's requests to count status pages.
function statusPageCountRequests(): Array<unknown> {
  return countMock.mock.calls.filter((call: Array<unknown>): boolean => {
    return (call[0] as { modelType?: unknown }).modelType === StatusPage;
  });
}

async function renderScope(item: IncidentTemplate): Promise<void> {
  await act(async (): Promise<void> => {
    render(
      <MemoryRouter>
        {scopeCard().modelDetailProps.fields[0]!.getElement(item)}
      </MemoryRouter>,
    );
  });
}

beforeEach(async () => {
  countMock.mockReset();
  countMock.mockResolvedValue(3);

  jest
    .spyOn(Navigation, "getLastParamAsObjectID")
    .mockImplementation((): ObjectID => {
      return new ObjectID(TEMPLATE_ID);
    });

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
});

afterEach(() => {
  cleanup();
  recordedCards.length = 0;
  recordedTables.length = 0;
  jest.restoreAllMocks();
});

describe("an incident template's Status Page Scope card", () => {
  test("reads whether the template is limited at all", () => {
    expect(scopeCard().modelDetailProps.selectMoreFields).toEqual({
      isScopedToStatusPages: true,
    });
  });

  test("a template whose pages were all deleted says what that means for its incidents", async () => {
    await renderScope(template({ isScoped: true, statusPages: [] }));

    expect(
      screen.getByTestId("incident-template-scoped-to-deleted-pages"),
    ).toHaveTextContent(
      IncidentStatusPageScopeCopy.templateScopedToDeletedPagesWarning,
    );
    expect(
      screen.queryByText(IncidentStatusPageScopeCopy.noScopeSummary),
    ).toBeNull();
  });

  test("a template that was never limited reads as not limited", async () => {
    await renderScope(template({ isScoped: false, statusPages: [] }));

    expect(
      screen.getByText(IncidentStatusPageScopeCopy.noScopeSummary),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("incident-template-scoped-to-deleted-pages"),
    ).toBeNull();
  });

  test("a template with pages lists them", async () => {
    await renderScope(
      template({
        isScoped: true,
        statusPages: [
          { id: "b0000000-0000-4000-8000-000000000003", name: "Site 03" },
        ],
      }),
    );

    expect(screen.getByText("Site 03")).toBeInTheDocument();
    expect(
      screen.queryByTestId("incident-template-scoped-to-deleted-pages"),
    ).toBeNull();
  });
});

describe("an incident template's status page picker", () => {
  test("on the Status Page Scope card: an optional status page multi-select", () => {
    const picker: Record<string, unknown> = statusPagePicker(
      scopeCard().formFields,
    );

    expect(picker["fieldType"]).toBe(FormFieldSchemaType.MultiSelectDropdown);
    expect(picker["dropdownModal"]).toEqual({
      type: StatusPage,
      labelField: "name",
      valueField: "_id",
    });
    expect(picker["title"]).toBe(IncidentStatusPageScopeCopy.pickerTitle);
    expect(picker["description"]).toBe(
      IncidentStatusPageScopeCopy.templatePickerDescription,
    );
    expect(picker["placeholder"]).toBe(
      IncidentStatusPageScopeCopy.pickerPlaceholder,
    );
    expect(picker["required"]).toBe(false);
  });

  test("on the Status Page Scope card: no banner under it", () => {
    const picker: Record<string, unknown> = statusPagePicker(
      scopeCard().formFields,
    );

    expect(picker["footerElement"]).toBeUndefined();
    expect(picker["getFooterElement"]).toBeUndefined();
  });

  test("the template's page never asks how many status pages the person can read", () => {
    expect(statusPageCountRequests()).toEqual([]);
  });

  describe("on a new template's Resources Affected step", () => {
    async function newTemplatePicker(): Promise<Record<string, unknown>> {
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

      const tables: Array<Record<string, unknown>> = recordedTables.filter(
        (props: Record<string, unknown>): boolean => {
          return props["modelType"] === IncidentTemplate;
        },
      );

      expect(tables.length).toBeGreaterThan(0);

      return statusPagePicker(
        tables[tables.length - 1]!["formFields"] as Array<
          Record<string, unknown>
        >,
      );
    }

    test("the same optional picker, worded for a template", async () => {
      const picker: Record<string, unknown> = await newTemplatePicker();

      expect(picker["stepId"]).toBe("resources-affected");
      expect(picker["fieldType"]).toBe(FormFieldSchemaType.MultiSelectDropdown);
      expect(picker["title"]).toBe(IncidentStatusPageScopeCopy.pickerTitle);
      expect(picker["description"]).toBe(
        IncidentStatusPageScopeCopy.templatePickerDescription,
      );
      expect(picker["required"]).toBe(false);
    });

    test("no banner under it", async () => {
      const picker: Record<string, unknown> = await newTemplatePicker();

      expect(picker["footerElement"]).toBeUndefined();
      expect(picker["getFooterElement"]).toBeUndefined();
    });

    test("the list page never asks how many status pages the person can read", async () => {
      await newTemplatePicker();

      expect(statusPageCountRequests()).toEqual([]);
    });
  });
});
