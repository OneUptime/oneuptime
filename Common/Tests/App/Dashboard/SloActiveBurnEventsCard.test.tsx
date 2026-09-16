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
  cleanup,
  render,
  RenderResult,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The SLO overview's "open alerts & incidents" card, RENDERED.
 *
 * The request is what matters most: it must find alerts and incidents
 * through the SLO affected-resource relation plus the project's unresolved
 * states — the same query the SLO's Alerts and Incidents pages and the side
 * menu counts use — and never through the old seriesFingerprint prefix, or
 * the card's numbers stop matching the pages it links to.
 */

const getListMock: MockFunction = getJestMockFunction();
const getUnresolvedAlertStatesMock: MockFunction = getJestMockFunction();
const getUnresolvedIncidentStatesMock: MockFunction = getJestMockFunction();

// Lazy wrappers: jest.mock is hoisted above the mocks' own declarations.
jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<unknown>): unknown => {
        return getListMock(...args);
      },
    },
  };
});

jest.mock("../../../../App/FeatureSet/Dashboard/src/Utils/AlertState", () => {
  return {
    __esModule: true,
    default: {
      getUnresolvedAlertStates: (...args: Array<unknown>): unknown => {
        return getUnresolvedAlertStatesMock(...args);
      },
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Utils/IncidentState",
  () => {
    return {
      __esModule: true,
      default: {
        getUnresolvedIncidentStates: (...args: Array<unknown>): unknown => {
          return getUnresolvedIncidentStatesMock(...args);
        },
      },
    };
  },
);

import SloActiveBurnEventsCard, {
  SLO_OVERVIEW_MAX_OPEN_EVENT_ROWS,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Slo/SloActiveBurnEventsCard";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap, {
  RouteUtil,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import Alert from "../../../Models/DatabaseModels/Alert";
import AlertSeverity from "../../../Models/DatabaseModels/AlertSeverity";
import AlertState from "../../../Models/DatabaseModels/AlertState";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import IncidentState from "../../../Models/DatabaseModels/IncidentState";
import Route from "../../../Types/API/Route";
import Includes from "../../../Types/BaseDatabase/Includes";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { Red, Yellow } from "../../../Types/BrandColors";
import ObjectID from "../../../Types/ObjectID";

// A real UUID: ProjectUtil ignores a URL project id that is not one.
const PROJECT_ID: ObjectID = new ObjectID(
  "7d3f1a2b-4c5d-4e6f-8a9b-0c1d2e3f4a5b",
);
const SLO_ID: ObjectID = new ObjectID("5f8b7c1e2d3a4b5c6d7e8f90");

const INCIDENT_STATE_IDS: Array<string> = [
  "5f8b7c1e2d3a4b5c6d7e2001",
  "5f8b7c1e2d3a4b5c6d7e2002",
];
const ALERT_STATE_IDS: Array<string> = [
  "5f8b7c1e2d3a4b5c6d7e3001",
  "5f8b7c1e2d3a4b5c6d7e3002",
];

interface ListRequest {
  modelType: unknown;
  query: Record<string, unknown>;
  select: Record<string, unknown>;
  limit: number;
  skip: number;
  sort: Record<string, unknown>;
}

type IdStringsFunction = (includes: unknown) => Array<string>;

const idStrings: IdStringsFunction = (includes: unknown): Array<string> => {
  expect(includes).toBeInstanceOf(Includes);

  return ((includes as Includes).values as Array<ObjectID>).map(
    (value: ObjectID) => {
      return value.toString();
    },
  );
};

type BuildStatesFunction<T> = (ids: Array<string>) => Array<T>;

const buildIncidentStates: BuildStatesFunction<IncidentState> = (
  ids: Array<string>,
): Array<IncidentState> => {
  return ids.map((id: string) => {
    const state: IncidentState = new IncidentState();
    state._id = id;
    return state;
  });
};

const buildAlertStates: BuildStatesFunction<AlertState> = (
  ids: Array<string>,
): Array<AlertState> => {
  return ids.map((id: string) => {
    const state: AlertState = new AlertState();
    state._id = id;
    return state;
  });
};

type BuildIncidentFunction = (data: {
  id: string;
  title: string;
  declaredAt: Date;
}) => Incident;

const buildIncident: BuildIncidentFunction = (data: {
  id: string;
  title: string;
  declaredAt: Date;
}): Incident => {
  const severity: IncidentSeverity = new IncidentSeverity();
  severity.name = "SEV1";
  severity.color = Red;

  const state: IncidentState = new IncidentState();
  state.name = "Investigating";

  const incident: Incident = new Incident();
  incident._id = data.id;
  incident.title = data.title;
  incident.declaredAt = data.declaredAt;
  incident.incidentSeverity = severity;
  incident.currentIncidentState = state;
  return incident;
};

type BuildAlertFunction = (data: {
  id: string;
  title: string;
  createdAt: Date;
}) => Alert;

const buildAlert: BuildAlertFunction = (data: {
  id: string;
  title: string;
  createdAt: Date;
}): Alert => {
  const severity: AlertSeverity = new AlertSeverity();
  severity.name = "Warning";
  severity.color = Yellow;

  const state: AlertState = new AlertState();
  state.name = "Acknowledged";

  const alert: Alert = new Alert();
  alert._id = data.id;
  alert.title = data.title;
  alert.createdAt = data.createdAt;
  alert.alertSeverity = severity;
  alert.currentAlertState = state;
  return alert;
};

type ResolveListsFunction = (data: {
  incidents: Array<Incident>;
  incidentCount: number;
  alerts: Array<Alert>;
  alertCount: number;
}) => void;

const resolveLists: ResolveListsFunction = (data: {
  incidents: Array<Incident>;
  incidentCount: number;
  alerts: Array<Alert>;
  alertCount: number;
}): void => {
  getListMock.mockImplementation((...args: Array<unknown>): unknown => {
    const request: ListRequest = args[0] as ListRequest;

    if (request.modelType === Incident) {
      return Promise.resolve({
        data: data.incidents,
        count: data.incidentCount,
        skip: 0,
        limit: request.limit,
      });
    }

    return Promise.resolve({
      data: data.alerts,
      count: data.alertCount,
      skip: 0,
      limit: request.limit,
    });
  });
};

type RequestForFunction = (modelType: unknown) => ListRequest;

const requestFor: RequestForFunction = (modelType: unknown): ListRequest => {
  const call: Array<unknown> | undefined = getListMock.mock.calls.find(
    (args: Array<unknown>) => {
      return (args[0] as ListRequest).modelType === modelType;
    },
  );

  if (!call) {
    throw new Error("No list request for that model.");
  }

  return call[0] as ListRequest;
};

type HrefFunction = (pageKey: PageMap, modelId: ObjectID | string) => string;

const hrefFor: HrefFunction = (
  pageKey: PageMap,
  modelId: ObjectID | string,
): string => {
  return RouteUtil.populateRouteParams(RouteMap[pageKey] as Route, {
    modelId: modelId,
  }).toString();
};

type CardElementFunction = (refreshToken: number) => React.ReactElement;

const cardElement: CardElementFunction = (
  refreshToken: number,
): React.ReactElement => {
  return (
    <MemoryRouter>
      <SloActiveBurnEventsCard sloId={SLO_ID} refreshToken={refreshToken} />
    </MemoryRouter>
  );
};

beforeEach(() => {
  window.history.pushState(
    {},
    "",
    `/dashboard/${PROJECT_ID.toString()}/slos/${SLO_ID.toString()}`,
  );
  getListMock.mockReset();
  getUnresolvedAlertStatesMock.mockReset();
  getUnresolvedIncidentStatesMock.mockReset();
  getUnresolvedIncidentStatesMock.mockResolvedValue(
    buildIncidentStates(INCIDENT_STATE_IDS),
  );
  getUnresolvedAlertStatesMock.mockResolvedValue(
    buildAlertStates(ALERT_STATE_IDS),
  );
});

afterEach(() => {
  cleanup();
});

describe("SloActiveBurnEventsCard", () => {
  test("finds open incidents and alerts through the SLO relation and the unresolved states", async () => {
    resolveLists({
      incidents: [],
      incidentCount: 0,
      alerts: [],
      alertCount: 0,
    });

    render(cardElement(1));

    await waitFor(() => {
      expect(getListMock).toHaveBeenCalledTimes(2);
    });

    expect(getUnresolvedIncidentStatesMock.mock.calls[0]![0]!.toString()).toBe(
      PROJECT_ID.toString(),
    );

    const incidentRequest: ListRequest = requestFor(Incident);
    expect((incidentRequest.query["projectId"] as ObjectID).toString()).toBe(
      PROJECT_ID.toString(),
    );
    expect(idStrings(incidentRequest.query["serviceLevelObjectives"])).toEqual([
      SLO_ID.toString(),
    ]);
    expect(idStrings(incidentRequest.query["currentIncidentStateId"])).toEqual(
      INCIDENT_STATE_IDS,
    );
    expect(incidentRequest.query).not.toHaveProperty("seriesFingerprint");
    expect(incidentRequest.sort).toEqual({ createdAt: SortOrder.Descending });
    expect(incidentRequest.limit).toBe(SLO_OVERVIEW_MAX_OPEN_EVENT_ROWS);

    const alertRequest: ListRequest = requestFor(Alert);
    expect(idStrings(alertRequest.query["serviceLevelObjectives"])).toEqual([
      SLO_ID.toString(),
    ]);
    expect(idStrings(alertRequest.query["currentAlertStateId"])).toEqual(
      ALERT_STATE_IDS,
    );
    expect(alertRequest.query).not.toHaveProperty("seriesFingerprint");
  });

  test("shows the total counts, coloured when anything is open, linking to the SLO's pages", async () => {
    resolveLists({
      incidents: [
        buildIncident({
          id: "5f8b7c1e2d3a4b5c6d7e4001",
          title: "Checkout is burning its budget",
          declaredAt: new Date("2026-09-15T11:00:00.000Z"),
        }),
      ],
      incidentCount: 2,
      alerts: [],
      alertCount: 3,
    });

    render(cardElement(1));

    const incidentCount: HTMLElement = await screen.findByTestId(
      "slo-open-incident-count",
    );

    await waitFor(() => {
      expect(incidentCount).toHaveTextContent("2");
    });
    expect(incidentCount).toHaveClass("text-red-700");

    const alertCount: HTMLElement = screen.getByTestId("slo-open-alert-count");
    expect(alertCount).toHaveTextContent("3");
    expect(alertCount).toHaveClass("text-amber-700");

    expect(incidentCount.closest("a")).toHaveAttribute(
      "href",
      hrefFor(PageMap.SLO_VIEW_INCIDENTS, SLO_ID),
    );
    expect(alertCount.closest("a")).toHaveAttribute(
      "href",
      hrefFor(PageMap.SLO_VIEW_ALERTS, SLO_ID),
    );
  });

  test("lists the latest open records newest first, across both kinds", async () => {
    resolveLists({
      incidents: [
        buildIncident({
          id: "5f8b7c1e2d3a4b5c6d7e4001",
          title: "Checkout is burning its budget",
          declaredAt: new Date("2026-09-15T09:00:00.000Z"),
        }),
      ],
      incidentCount: 1,
      alerts: [
        buildAlert({
          id: "5f8b7c1e2d3a4b5c6d7e5001",
          title: "Fast burn on checkout",
          createdAt: new Date("2026-09-15T11:30:00.000Z"),
        }),
        buildAlert({
          id: "5f8b7c1e2d3a4b5c6d7e5002",
          title: "Slow burn on checkout",
          createdAt: new Date("2026-09-14T08:00:00.000Z"),
        }),
      ],
      alertCount: 2,
    });

    render(cardElement(1));

    await waitFor(() => {
      expect(screen.getAllByTestId("slo-open-event-row")).toHaveLength(3);
    });

    const rows: Array<HTMLElement> =
      screen.getAllByTestId("slo-open-event-row");

    expect(
      rows.map((row: HTMLElement) => {
        return within(row).getByRole("link").textContent;
      }),
    ).toEqual([
      "Fast burn on checkout",
      "Checkout is burning its budget",
      "Slow burn on checkout",
    ]);

    expect(rows[0]!).toHaveTextContent("Alert");
    expect(rows[0]!).toHaveTextContent("Warning");
    expect(rows[0]!).toHaveTextContent("Acknowledged");
    expect(within(rows[0]!).getByRole("link")).toHaveAttribute(
      "href",
      hrefFor(PageMap.ALERT_VIEW, "5f8b7c1e2d3a4b5c6d7e5001"),
    );

    expect(rows[1]!).toHaveTextContent("Incident");
    expect(rows[1]!).toHaveTextContent("SEV1");
    expect(rows[1]!).toHaveTextContent("Investigating");
    expect(within(rows[1]!).getByRole("link")).toHaveAttribute(
      "href",
      hrefFor(PageMap.INCIDENT_VIEW, "5f8b7c1e2d3a4b5c6d7e4001"),
    );

    expect(rows[1]!.querySelector("time")).toHaveAttribute(
      "dateTime",
      "2026-09-15T09:00:00.000Z",
    );
  });

  test("an SLO with nothing open says so, in gray", async () => {
    resolveLists({
      incidents: [],
      incidentCount: 0,
      alerts: [],
      alertCount: 0,
    });

    render(cardElement(1));

    expect(
      await screen.findByTestId("slo-open-events-empty"),
    ).toHaveTextContent("Nothing open");
    expect(screen.getByTestId("slo-open-incident-count")).toHaveTextContent(
      "0",
    );
    expect(screen.getByTestId("slo-open-incident-count")).toHaveClass(
      "text-gray-900",
    );
  });

  test("a project with no unresolved states sends no query at all", async () => {
    getUnresolvedIncidentStatesMock.mockResolvedValue([]);
    getUnresolvedAlertStatesMock.mockResolvedValue([]);

    render(cardElement(1));

    expect(
      await screen.findByTestId("slo-open-events-empty"),
    ).toBeInTheDocument();
    expect(getListMock).not.toHaveBeenCalled();
  });

  test("shows placeholders while loading, not zeroes", () => {
    getListMock.mockReturnValue(new Promise<never>(() => {}));

    render(cardElement(1));

    expect(screen.getByTestId("slo-open-incident-count")).toHaveTextContent(
      "—",
    );
    expect(
      screen.getByRole("status", { name: "Loading open alerts and incidents" }),
    ).toBeInTheDocument();
  });

  test("a failed first load says why", async () => {
    getListMock.mockRejectedValue(new Error("Could not reach the server."));

    render(cardElement(1));

    expect(
      await screen.findByText("Could not reach the server."),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("slo-open-events-empty")).toBeNull();
  });

  test("outside a project it says so instead of loading forever", async () => {
    window.history.pushState({}, "", "/dashboard");

    render(cardElement(1));

    expect(
      await screen.findByText(
        "Select a project to see open alerts and incidents.",
      ),
    ).toBeInTheDocument();
    expect(getListMock).not.toHaveBeenCalled();
  });

  test("re-reads on every poll token", async () => {
    resolveLists({
      incidents: [],
      incidentCount: 0,
      alerts: [],
      alertCount: 0,
    });

    const { rerender }: RenderResult = render(cardElement(1));

    await waitFor(() => {
      expect(getListMock).toHaveBeenCalledTimes(2);
    });

    rerender(cardElement(1));
    expect(getListMock).toHaveBeenCalledTimes(2);

    rerender(cardElement(2));
    await waitFor(() => {
      expect(getListMock).toHaveBeenCalledTimes(4);
    });
  });
});
