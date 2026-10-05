import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The "AI agent" card at the bottom of a database's Overview, inside the
 * real page: the last thing on it, reading THIS database's status from the
 * route its AI agent page reads — once when the page opens, again on
 * Refresh now — showing the agent's connection, the investigation switch
 * and the fixes mode, and linking to the database's AI agent page. A
 * refused status never fails the Overview.
 *
 * The page's sections and charts are replaced by markers, as the database
 * Overview's header suite (DatabaseOverviewHeader) replaces them.
 */

const PROJECT_ID_STRING: string = "21075038-d9f1-4d3a-b878-f64ae861f7be";
const DATABASE_ID: string = "42b6aaae-7558-42fe-999b-395bbfc79d63";
const NOW: Date = new Date("2026-09-30T12:00:00.000Z");

const getItemMock: MockFunction = getJestMockFunction();
const getListMock: MockFunction = getJestMockFunction();
const aggregateMock: MockFunction = getJestMockFunction();
const apiPostMock: MockFunction = getJestMockFunction();

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

// The arrow wrappers are load bearing: jest.mock is hoisted above the mocks.
jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<unknown>) => {
        return getItemMock(...args);
      },
      getList: (...args: Array<unknown>) => {
        return getListMock(...args);
      },
      getCommonHeaders: (): Record<string, string> => {
        return { tenantid: "21075038-d9f1-4d3a-b878-f64ae861f7be" };
      },
    },
  };
});

jest.mock("../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI", () => {
  return {
    __esModule: true,
    default: {
      aggregate: (...args: Array<unknown>) => {
        return aggregateMock(...args);
      },
      getList: () => {
        return Promise.resolve({ data: [], count: 0 });
      },
    },
  };
});

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: (...args: Array<unknown>) => {
        return apiPostMock(...args);
      },
      getFriendlyMessage: (error: unknown) => {
        return (
          ((error as { message?: unknown } | null)?.message as string) ||
          "Could not load"
        );
      },
    },
  };
});

jest.mock("../../../UI/Utils/Navigation", () => {
  return {
    __esModule: true,
    default: {
      getLastParamAsObjectID: () => {
        const { default: ObjectIDType } = jest.requireActual(
          "../../../Types/ObjectID",
        ) as { default: new (id: string) => unknown };
        return new ObjectIDType("42b6aaae-7558-42fe-999b-395bbfc79d63");
      },
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: () => {
        const { default: ObjectIDType } = jest.requireActual(
          "../../../Types/ObjectID",
        ) as { default: new (id: string) => unknown };
        return new ObjectIDType("21075038-d9f1-4d3a-b878-f64ae861f7be");
      },
    },
  };
});

jest.mock("../../../UI/Components/Loader/PageLoader", () => {
  return {
    __esModule: true,
    default: () => {
      return <div data-testid="page-loader" />;
    },
  };
});

jest.mock("../../../UI/Components/ErrorMessage/ErrorMessage", () => {
  return {
    __esModule: true,
    default: (props: { message: string }) => {
      return <div data-testid="error-message">{props.message}</div>;
    },
  };
});

jest.mock(
  "../../../UI/Components/TelemetryViewer/components/TelemetryTimeRangePicker",
  () => {
    return {
      __esModule: true,
      default: () => {
        return <div data-testid="time-range-picker" />;
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryResource/ChartCard",
  () => {
    return {
      __esModule: true,
      default: (props: { title: string }) => {
        return <div data-testid="chart-card">{props.title}</div>;
      },
    };
  },
);

// The page's own "Refresh now", without the interval menu around it.
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryResource/AutoRefreshControl",
  () => {
    return {
      __esModule: true,
      default: (props: { onManualRefresh: () => void }) => {
        return (
          <button
            type="button"
            data-testid="auto-refresh"
            onClick={props.onManualRefresh}
          >
            Refresh now
          </button>
        );
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/ResourceActivity/ResourceActivityCards",
  () => {
    return {
      __esModule: true,
      default: () => {
        return <div data-testid="activity-cards" />;
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/DatabaseServer/DatabaseRuntimeSection",
  () => {
    return {
      __esModule: true,
      default: () => {
        return <div data-testid="runtime-section" />;
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/DatabaseServer/DatabaseEngineMetricsSection",
  () => {
    return {
      __esModule: true,
      default: () => {
        return <div data-testid="engine-section" />;
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/DatabaseServer/DatabaseCallingServicesCard",
  () => {
    return {
      __esModule: true,
      default: () => {
        return <div data-testid="calling-services" />;
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/DatabaseServer/DatabaseServerUnscopedBanner",
  () => {
    return {
      __esModule: true,
      default: () => {
        return <div data-testid="database-unscoped-banner" />;
      },
    };
  },
);

import DatabaseServerOverview from "../../../../App/FeatureSet/Dashboard/src/Pages/Database/View/Overview";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap, {
  RouteUtil,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import { AI_AGENT_STATUS_SUMMARY_TEST_ID } from "../../../../App/FeatureSet/Dashboard/src/Components/AiAccess/AiAgentStatusSummaryCard";
import { getResourceAiAgentDescriptor } from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceAiAgent/ResourceAiAgentDescriptors";
import DatabaseServer from "../../../Models/DatabaseModels/DatabaseServer";
import Route from "../../../Types/API/Route";
import { RESOURCE_AI_ACCESS_STATUS_PATH } from "../../../Types/AI/ResourceAiAccessApi";
import ObjectID from "../../../Types/ObjectID";
import AiResourceType from "../../../Types/ResourceAiAgent/AiResourceType";

const PAGE_PROPS: PageComponentProps = {
  pageRoute: new Route("/dashboard/test/databases/test"),
  currentProject: null,
  hasPaymentMethod: true,
};

const NOUN: string = getResourceAiAgentDescriptor(
  AiResourceType.DatabaseServer,
).noun;

function ordersDb(): DatabaseServer {
  const row: DatabaseServer = new DatabaseServer();
  row.id = new ObjectID(DATABASE_ID);
  row.projectId = new ObjectID(PROJECT_ID_STRING);
  row.name = "PostgreSQL orders-db.example.com:5432";
  row.dbSystem = "postgresql";
  row.serverAddress = "orders-db.example.com";
  row.serverPort = 5432;
  row.discoverySource = "client-spans";
  row.lastSeenAt = new Date(NOW.getTime() - 2 * 60 * 1000);
  return row;
}

// No database AI agent yet: investigation on (the default), fixes off.
function notInstalledStatus(): Record<string, unknown> {
  return {
    resourceType: AiResourceType.DatabaseServer,
    resourceId: DATABASE_ID,
    resourceName: "PostgreSQL orders-db.example.com:5432",
    isAiInvestigationEnabled: true,
    aiRemediationMode: "Disabled",
    aiCommandAllowlist: [],
    agent: null,
    gaps: [
      {
        code: "ai_agent_not_connected",
        title: "No agent",
        nextStep: "Install it",
        blocksInvestigation: true,
        blocksRemediation: true,
      },
    ],
    isInvestigationReady: false,
    isRemediationReady: false,
  };
}

function connectedStatus(): Record<string, unknown> {
  return {
    ...notInstalledStatus(),
    aiRemediationMode: "RequireApproval",
    agent: {
      agentId: "99999999-0000-4000-8000-000000000009",
      connectionStatus: "connected",
      isOnline: true,
      lastAliveAt: NOW.toISOString(),
    },
    gaps: [],
    isInvestigationReady: true,
    isRemediationReady: true,
  };
}

let mockStatus: () => Promise<unknown> = (): Promise<unknown> => {
  return Promise.resolve({ data: notInstalledStatus() });
};

function isStatusRead(call: Array<unknown>): boolean {
  return String((call[0] as { url: unknown }).url).endsWith(
    RESOURCE_AI_ACCESS_STATUS_PATH,
  );
}

function statusReads(): Array<Array<unknown>> {
  return apiPostMock.mock.calls.filter(isStatusRead);
}

async function settle(): Promise<void> {
  for (let i: number = 0; i < 12; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function renderOverview(): Promise<void> {
  render(
    <MemoryRouter>
      <DatabaseServerOverview {...PAGE_PROPS} />
    </MemoryRouter>,
  );
  await screen.findByText(/Engine metrics: /, undefined, { timeout: 3000 });
  await settle();
}

function aiAgentCard(): HTMLElement {
  return screen.getByTestId(AI_AGENT_STATUS_SUMMARY_TEST_ID);
}

function badge(row: "connection" | "investigation" | "fixes"): HTMLElement {
  return within(aiAgentCard()).getByTestId(
    `${AI_AGENT_STATUS_SUMMARY_TEST_ID}-${row}-badge`,
  );
}

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ["setTimeout", "setInterval"] });
  jest.setSystemTime(NOW);
  getItemMock.mockReset();
  getListMock.mockReset();
  aggregateMock.mockReset();
  apiPostMock.mockReset();

  getItemMock.mockResolvedValue(ordersDb());
  getListMock.mockResolvedValue({ data: [], count: 0 });
  aggregateMock.mockResolvedValue({ data: [] });
  mockStatus = (): Promise<unknown> => {
    return Promise.resolve({ data: notInstalledStatus() });
  };
  apiPostMock.mockImplementation((request: unknown): Promise<unknown> => {
    if (
      String((request as { url: unknown }).url).endsWith(
        RESOURCE_AI_ACCESS_STATUS_PATH,
      )
    ) {
      return mockStatus();
    }
    return Promise.resolve({ data: {} });
  });
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

describe("the database Overview's AI agent card", () => {
  test("is the last thing on the page", async () => {
    await renderOverview();

    const card: HTMLElement = aiAgentCard();
    const others: Array<Element> = Array.from(
      document.querySelectorAll("[data-testid], h1, h2"),
    ).filter((element: Element): boolean => {
      return !card.contains(element) && element !== card;
    });

    // The page drew its sections before the card.
    expect(screen.getByTestId("engine-section")).toBeInTheDocument();
    expect(others.length).toBeGreaterThan(0);

    for (const element of others) {
      expect({
        element: element.getAttribute("data-testid") || element.tagName,
        beforeTheCard: Boolean(
          element.compareDocumentPosition(card) &
            Node.DOCUMENT_POSITION_FOLLOWING,
        ),
      }).toEqual({
        element: element.getAttribute("data-testid") || element.tagName,
        beforeTheCard: true,
      });
    }
  });

  test("reads this database's status once when the page opens, from its AI agent page's route", async () => {
    await renderOverview();

    expect(statusReads()).toHaveLength(1);
    expect(statusReads()[0]![0]).toMatchObject({
      data: {
        resourceType: AiResourceType.DatabaseServer,
        resourceId: DATABASE_ID,
      },
      headers: { tenantid: PROJECT_ID_STRING },
    });
  });

  test("no agent yet: Not installed, investigation on, fixes off, and what needs attention", async () => {
    await renderOverview();

    expect(badge("connection")).toHaveTextContent("Not installed");
    expect(badge("investigation")).toHaveTextContent("On");
    expect(badge("fixes")).toHaveTextContent("Off");
    expect(
      within(aiAgentCard()).getByTestId(
        `${AI_AGENT_STATUS_SUMMARY_TEST_ID}-connection-value`,
      ),
    ).toHaveTextContent("The Database AI agent is not installed yet.");
    expect(
      within(aiAgentCard()).getByTestId(
        `${AI_AGENT_STATUS_SUMMARY_TEST_ID}-attention-title`,
      ),
    ).toHaveTextContent(`OneUptime AI can't investigate this ${NOUN}`);
  });

  test("links to this database's AI agent page", async () => {
    await renderOverview();

    expect(
      within(aiAgentCard()).getByRole("link", {
        name: "Open the AI agent page",
      }),
    ).toHaveAttribute(
      "href",
      RouteUtil.populateRouteParams(
        RouteMap[PageMap.DATABASE_SERVER_VIEW_AI_AGENT] as Route,
        { modelId: new ObjectID(DATABASE_ID) },
      ).toString(),
    );
  });

  test("Refresh now reads the status again, and the card shows the new one", async () => {
    await renderOverview();
    expect(badge("connection")).toHaveTextContent("Not installed");

    // The agent was installed since; a minute later, Refresh now.
    mockStatus = (): Promise<unknown> => {
      return Promise.resolve({ data: connectedStatus() });
    };
    jest.setSystemTime(new Date(NOW.getTime() + 60 * 1000));
    fireEvent.click(screen.getByTestId("auto-refresh"));
    await settle();

    expect(statusReads()).toHaveLength(2);
    expect(badge("connection")).toHaveTextContent("Connected");
    expect(badge("fixes")).toHaveTextContent("Ask for approval");
  });

  test("a refused status leaves the Overview whole, and the card says it could not load it", async () => {
    mockStatus = (): Promise<unknown> => {
      return Promise.reject(new Error("Not authorized"));
    };

    await renderOverview();

    expect(screen.getByTestId("engine-section")).toBeInTheDocument();
    expect(screen.queryByTestId("error-message")).not.toBeInTheDocument();
    expect(
      within(aiAgentCard()).getByTestId(
        `${AI_AGENT_STATUS_SUMMARY_TEST_ID}-unavailable`,
      ),
    ).toHaveTextContent("The AI agent's status could not be loaded.");
  });
});
