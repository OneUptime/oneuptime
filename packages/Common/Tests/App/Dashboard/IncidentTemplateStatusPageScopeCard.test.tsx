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

/*
 * An incident template's 'Status Page Scope' card. A template keeps being
 * limited to status pages after every page it listed was deleted (the join
 * rows cascade away, IncidentTemplate.isScopedToStatusPages stays): an
 * incident declared from it through the API is then hidden from every status
 * page, and the Declare Incident form starts with no page picked. The card
 * says so, instead of reading "Not limited" - which is what it looks like
 * without the flag, and what the incidents from it used to become.
 *
 * The cards and tables on the page are stubbed and their props recorded; the
 * test renders what the scope card shows for a template.
 */

const recordedCards: Array<Record<string, unknown>> = [];

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

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      count: async (): Promise<number> => {
        return 3;
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

import IncidentTemplatesView from "../../../../App/FeatureSet/Dashboard/src/Pages/Incidents/Settings/IncidentTemplatesView";
import IncidentStatusPageScopeCopy from "../../../../App/FeatureSet/Dashboard/src/Components/Incident/IncidentStatusPageScopeCopy";
import IncidentTemplate from "../../../Models/DatabaseModels/IncidentTemplate";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import Route from "../../../Types/API/Route";
import ObjectID from "../../../Types/ObjectID";
import Navigation from "../../../UI/Utils/Navigation";

const TEMPLATE_ID: string = "a1b2c3d4-0000-4000-8000-0000000000aa";

interface ScopeCardProps {
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
