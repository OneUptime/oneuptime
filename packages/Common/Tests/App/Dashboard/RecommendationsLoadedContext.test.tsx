import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { PROJECT_ID, goTo } from "./SideMenuHarness";

/*
 * The Recommendations tab and its side-menu badge, rendered for real, for a
 * database whose collector heartbeat is fresh.
 *
 * The heartbeat (collectorLastSeenAt) is stamped by ANY batch attributed to
 * the database — its logs, an exporter, a MongoDB Atlas cluster's
 * `mongodbatlas` receiver, whose metrics are not the `mongodb.*` the MongoDB
 * monitors read. RecommendationResourceRegistry.loadContext finishes the
 * answer with a one-row probe for those metrics; these tests pin that the
 * page and the badge both render from THAT answer, not from the row alone:
 * no "Engine Metrics Stopped" offered to a database it would page about
 * forever, and a badge that agrees with the page behind it.
 */

const DATABASE_ID: string = "84858d6c-1111-4aaa-8bbb-000000000001";

const getItemMock: MockFunction = getJestMockFunction();
const getListMock: MockFunction = getJestMockFunction();
const getAnalyticsListMock: MockFunction = getJestMockFunction();

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
    },
  };
});

jest.mock("../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<unknown>) => {
        return getAnalyticsListMock(...args);
      },
    },
  };
});

jest.mock("../../../../App/FeatureSet/Dashboard/src/Utils/ProjectUser", () => {
  return {
    __esModule: true,
    default: {
      fetchProjectUsersAsDropdownOptions: () => {
        return Promise.resolve([]);
      },
    },
  };
});

// Only the badge number matters here, not how the menu entry draws it.
jest.mock("../../../UI/Components/SideMenu/SideMenuItem", () => {
  return {
    __esModule: true,
    default: (props: { badge?: number | undefined }) => {
      return (
        <span data-testid="recommendations-badge">
          {props.badge === undefined ? "no badge" : String(props.badge)}
        </span>
      );
    },
  };
});

import DatabaseServerRecommendations from "../../../../App/FeatureSet/Dashboard/src/Pages/Database/View/Recommendations";
import RecommendationsSideMenuItem from "../../../../App/FeatureSet/Dashboard/src/Components/Recommendations/RecommendationsSideMenuItem";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import AlertSeverity from "../../../Models/DatabaseModels/AlertSeverity";
import DatabaseServer from "../../../Models/DatabaseModels/DatabaseServer";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import Metric from "../../../Models/AnalyticsModels/Metric";
import Route from "../../../Types/API/Route";
import { getDatabaseAlertTemplates } from "../../../Types/Monitor/DatabaseAlertTemplates";
import { MonitorRecommendationResourceType } from "../../../Types/Monitor/Recommendation/MonitorRecommendationTypes";
import ObjectID from "../../../Types/ObjectID";

const PAGE_PROPS: PageComponentProps = {
  pageRoute: new Route(
    `/dashboard/${PROJECT_ID}/databases/${DATABASE_ID}/recommendations`,
  ),
  currentProject: null,
  hasPaymentMethod: true,
};

interface ProbeAnswer {
  data: Array<{ time: Date }>;
  count: number;
}

const METRICS_ARRIVED: ProbeAnswer = {
  data: [{ time: new Date() }],
  count: 1,
};

const NOTHING_ARRIVED: ProbeAnswer = { data: [], count: 0 };

// A database row with a fresh collector heartbeat, as the tab fetches it.
function databaseRow(dbSystem: string): DatabaseServer {
  const row: DatabaseServer = new DatabaseServer();
  row._id = DATABASE_ID;
  row.projectId = new ObjectID(PROJECT_ID);
  row.name = "orders";
  row.dbSystem = dbSystem;
  row.collectorLastSeenAt = new Date();
  return row;
}

// Everything MonitorRecommendations needs to build a monitor step.
function projectList(modelType: unknown): { data: Array<unknown> } {
  if (modelType === MonitorStatus) {
    const online: MonitorStatus = new MonitorStatus();
    online._id = ObjectID.generate().toString();
    online.isOperationalState = true;
    const offline: MonitorStatus = new MonitorStatus();
    offline._id = ObjectID.generate().toString();
    offline.isOfflineState = true;
    return { data: [online, offline] };
  }

  if (modelType === IncidentSeverity || modelType === AlertSeverity) {
    const severity: IncidentSeverity = new IncidentSeverity();
    severity._id = ObjectID.generate().toString();
    severity.name = "Critical";
    return { data: [severity] };
  }

  // No monitors yet, no dismissals, no policies / teams / labels.
  return { data: [] };
}

function probeCalls(): Array<{ modelType: unknown }> {
  return getAnalyticsListMock.mock.calls.map(
    (call: Array<unknown>): { modelType: unknown } => {
      return call[0] as { modelType: unknown };
    },
  );
}

function monitorListCalls(): number {
  return getListMock.mock.calls.filter((call: Array<unknown>): boolean => {
    return (call[0] as { modelType: unknown }).modelType === Monitor;
  }).length;
}

async function flushEffects(): Promise<void> {
  for (let i: number = 0; i < 10; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

beforeEach(() => {
  getItemMock.mockReset();
  getListMock.mockReset();
  getAnalyticsListMock.mockReset();

  goTo(`/dashboard/${PROJECT_ID}/databases/${DATABASE_ID}/recommendations`);

  getListMock.mockImplementation((args: unknown) => {
    return Promise.resolve(
      projectList((args as { modelType: unknown }).modelType),
    );
  });
});

afterEach(() => {
  cleanup();
});

describe("the database Recommendations tab renders from the loaded context", () => {
  function renderPage(): void {
    render(
      <MemoryRouter>
        <DatabaseServerRecommendations {...PAGE_PROPS} />
      </MemoryRouter>,
    );
  }

  test("a MongoDB Atlas database (heartbeat, but no mongodb.* metric) is offered nothing, and the tab says why", async () => {
    getItemMock.mockResolvedValue(databaseRow("mongodb"));
    getAnalyticsListMock.mockResolvedValue(NOTHING_ARRIVED);

    renderPage();

    expect(
      await screen.findByText(/No recommendations for this database yet/),
    ).toBeInTheDocument();
    expect(screen.getByText(/does not count/)).toBeInTheDocument();
    expect(screen.getByText(/mongodb receiver/)).toBeInTheDocument();

    expect(screen.queryByText("Engine Metrics Stopped")).toBeNull();

    // The probe the tab asked: one row of the Metric table.
    expect(probeCalls()).toHaveLength(1);
    expect(probeCalls()[0]!.modelType).toBe(Metric);
  });

  test("a PostgreSQL database whose engine metrics arrive is offered its engine's library", async () => {
    getItemMock.mockResolvedValue(databaseRow("postgresql"));
    getAnalyticsListMock.mockResolvedValue(METRICS_ARRIVED);

    renderPage();

    expect(
      await screen.findByText("Engine Metrics Stopped"),
    ).toBeInTheDocument();
    expect(screen.queryByText(/does not count/)).toBeNull();
    expect(
      screen.getByText(/Recommended for PostgreSQL, from the metrics/),
    ).toBeInTheDocument();
  });

  test("the list waits for the probe: nothing is offered from the heartbeat alone first", async () => {
    getItemMock.mockResolvedValue(databaseRow("mongodb"));

    let answerProbe: (answer: ProbeAnswer) => void = (): void => {};
    getAnalyticsListMock.mockReturnValue(
      new Promise<ProbeAnswer>((resolve: (answer: ProbeAnswer) => void) => {
        answerProbe = resolve;
      }),
    );

    renderPage();

    await waitFor(() => {
      expect(getAnalyticsListMock).toHaveBeenCalledTimes(1);
    });
    await flushEffects();

    // The row alone says "metrics reported": it must not reach the list.
    expect(screen.queryByText("Engine Metrics Stopped")).toBeNull();
    expect(screen.queryByText("Recommended Monitors")).toBeNull();
    // Nor did the list start fetching what it needs to create monitors.
    expect(monitorListCalls()).toBe(0);

    await act(async () => {
      answerProbe(NOTHING_ARRIVED);
    });

    expect(
      await screen.findByText(/No recommendations for this database yet/),
    ).toBeInTheDocument();
    expect(screen.queryByText("Engine Metrics Stopped")).toBeNull();
  });

  test("a failed probe keeps the heartbeat's answer rather than failing the tab", async () => {
    getItemMock.mockResolvedValue(databaseRow("postgresql"));
    /*
     * Rejected on a later tick, once the probe is awaiting it: a promise
     * rejected before its handler attaches is reported by zone.js as
     * unhandled, which is test noise, not the behaviour under test.
     */
    getAnalyticsListMock.mockImplementation((): Promise<ProbeAnswer> => {
      return new Promise<ProbeAnswer>(
        (
          _resolve: (answer: ProbeAnswer) => void,
          reject: (error: Error) => void,
        ) => {
          setTimeout(() => {
            reject(new Error("ClickHouse is down"));
          }, 0);
        },
      );
    });

    renderPage();

    expect(
      await screen.findByText("Engine Metrics Stopped"),
    ).toBeInTheDocument();
  });
});

describe("the Recommendations side-menu badge counts from the same loaded context", () => {
  function renderBadge(): void {
    render(
      <RecommendationsSideMenuItem
        link={{
          title: "Recommendations",
          to: new Route(
            `/dashboard/${PROJECT_ID}/databases/${DATABASE_ID}/recommendations`,
          ),
        }}
        resourceType={MonitorRecommendationResourceType.DatabaseServer}
        resourceId={new ObjectID(DATABASE_ID)}
      />,
    );
  }

  test("no badge for a MongoDB Atlas database: the page behind it offers nothing", async () => {
    getItemMock.mockResolvedValue(databaseRow("mongodb"));
    getAnalyticsListMock.mockResolvedValue(NOTHING_ARRIVED);

    renderBadge();

    await waitFor(() => {
      expect(getAnalyticsListMock).toHaveBeenCalledTimes(1);
    });
    await flushEffects();

    expect(screen.getByTestId("recommendations-badge")).toHaveTextContent(
      "no badge",
    );
    // Nothing to count, so nothing else was fetched.
    expect(monitorListCalls()).toBe(0);
  });

  test("the badge counts the engine's library once its metrics arrive", async () => {
    getItemMock.mockResolvedValue(databaseRow("postgresql"));
    getAnalyticsListMock.mockResolvedValue(METRICS_ARRIVED);

    renderBadge();

    const expected: number = getDatabaseAlertTemplates("postgresql").length;
    expect(expected).toBeGreaterThan(0);

    await waitFor(() => {
      expect(screen.getByTestId("recommendations-badge")).toHaveTextContent(
        String(expected),
      );
    });
    expect(probeCalls()[0]!.modelType).toBe(Metric);
  });
});
