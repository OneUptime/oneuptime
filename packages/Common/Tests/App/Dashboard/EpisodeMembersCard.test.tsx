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
  waitFor,
  within,
} from "@testing-library/react";
import React, { ReactElement } from "react";
import { Location } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";

const getListMock: MockFunction = getJestMockFunction();

/*
 * The arrow wrapper is load bearing: jest.mock is hoisted above the compiled
 * requires, so the mock const is still unassigned when the factory runs.
 */
jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<any>) => {
        return getListMock(...args);
      },
    },
  };
});

import EpisodeMembersCard, {
  ComponentProps,
} from "../../../../App/FeatureSet/Dashboard/src/Components/EpisodeView/EpisodeMembersCard";
import {
  ALERT_EPISODE_MEMBER_SELECT,
  INCIDENT_EPISODE_MEMBER_SELECT,
  getAlertEpisodeMemberRow,
  getIncidentEpisodeMemberRow,
} from "../../../../App/FeatureSet/Dashboard/src/Components/EpisodeView/EpisodeMembers";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap, {
  RouteUtil,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import Alert from "../../../Models/DatabaseModels/Alert";
import AlertState from "../../../Models/DatabaseModels/AlertState";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import IncidentState from "../../../Models/DatabaseModels/IncidentState";
import Route from "../../../Types/API/Route";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import Color from "../../../Types/Color";
import OneUptimeDate from "../../../Types/Date";
import ObjectID from "../../../Types/ObjectID";
import Navigation from "../../../UI/Utils/Navigation";

/*
 * The card that previews an episode's members on the incident episode and
 * alert episode overviews. It is generic over the member model, so every
 * behaviour is checked against the real Incident and Alert configurations the
 * two pages pass, with the real RouteMap building the links.
 */

const PROJECT_ID: string = "22222222-2222-4222-8222-222222222222";
const EPISODE_ID: string = "11111111-1111-4111-8111-111111111111";
const OTHER_EPISODE_ID: string = "99999999-9999-4999-8999-999999999999";
const FIRST_INCIDENT_ID: string = "55555555-5555-4555-8555-555555555555";
const SECOND_INCIDENT_ID: string = "66666666-6666-4666-8666-666666666666";

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: Error) => void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve: (value: T) => void = (): void => {
    return undefined;
  };
  let reject: (error: Error) => void = (): void => {
    return undefined;
  };

  const promise: Promise<T> = new Promise<T>(
    (res: (value: T) => void, rej: (error: Error) => void) => {
      resolve = res;
      reject = rej;
    },
  );

  return { promise, resolve, reject };
}

type ListResultFunction = (
  data: Array<unknown>,
  count?: number,
) => { data: Array<unknown>; count: number; skip: number; limit: number };

const listResult: ListResultFunction = (
  data: Array<unknown>,
  count?: number,
) => {
  return {
    data,
    count: count === undefined ? data.length : count,
    skip: 0,
    limit: 8,
  };
};

type BuildIncidentFunction = (options: {
  id: string;
  title: string;
  number: number;
  prefix?: string | undefined;
  declaredAt: Date;
  stateName?: string | undefined;
  stateColor?: string | undefined;
  severityName?: string | undefined;
  severityColor?: string | undefined;
}) => Incident;

const buildIncident: BuildIncidentFunction = (options: {
  id: string;
  title: string;
  number: number;
  prefix?: string | undefined;
  declaredAt: Date;
  stateName?: string | undefined;
  stateColor?: string | undefined;
  severityName?: string | undefined;
  severityColor?: string | undefined;
}): Incident => {
  const incident: Incident = new Incident();
  incident.id = new ObjectID(options.id);
  incident.title = options.title;
  incident.incidentNumber = options.number;

  if (options.prefix) {
    incident.incidentNumberWithPrefix = options.prefix;
  }

  incident.declaredAt = options.declaredAt;

  if (options.stateName) {
    const state: IncidentState = new IncidentState();
    state.name = options.stateName;
    state.color = new Color(options.stateColor || "#000000");
    incident.currentIncidentState = state;
  }

  if (options.severityName) {
    const severity: IncidentSeverity = new IncidentSeverity();
    severity.name = options.severityName;
    severity.color = new Color(options.severityColor || "#000000");
    incident.incidentSeverity = severity;
  }

  return incident;
};

const MINUTE: number = 60 * 1000;

type IncidentCardPropsFunction = (
  overrides?: Partial<ComponentProps<Incident>>,
) => ComponentProps<Incident>;

const incidentCardProps: IncidentCardPropsFunction = (
  overrides?: Partial<ComponentProps<Incident>>,
): ComponentProps<Incident> => {
  return {
    modelType: Incident,
    episodeId: new ObjectID(EPISODE_ID),
    episodeIdField: "incidentEpisodeId",
    select: INCIDENT_EPISODE_MEMBER_SELECT,
    sortField: "declaredAt",
    toRow: getIncidentEpisodeMemberRow,
    title: "Incidents in this episode",
    singularNoun: "incident",
    pluralNoun: "incidents",
    viewAllRoute: RouteUtil.populateRouteParams(
      RouteMap[PageMap.INCIDENT_EPISODE_VIEW_INCIDENTS] as Route,
      { modelId: new ObjectID(EPISODE_ID) },
    ),
    getMemberRoute: (memberId: ObjectID): Route => {
      return RouteUtil.populateRouteParams(
        RouteMap[PageMap.INCIDENT_VIEW] as Route,
        { modelId: memberId },
      );
    },
    ...(overrides || {}),
  };
};

type AlertCardPropsFunction = () => ComponentProps<Alert>;

const alertCardProps: AlertCardPropsFunction = (): ComponentProps<Alert> => {
  return {
    modelType: Alert,
    episodeId: new ObjectID(EPISODE_ID),
    episodeIdField: "alertEpisodeId",
    select: ALERT_EPISODE_MEMBER_SELECT,
    sortField: "createdAt",
    toRow: getAlertEpisodeMemberRow,
    title: "Alerts in this episode",
    singularNoun: "alert",
    pluralNoun: "alerts",
    viewAllRoute: RouteUtil.populateRouteParams(
      RouteMap[PageMap.ALERT_EPISODE_VIEW_ALERTS] as Route,
      { modelId: new ObjectID(EPISODE_ID) },
    ),
    getMemberRoute: (memberId: ObjectID): Route => {
      return RouteUtil.populateRouteParams(
        RouteMap[PageMap.ALERT_VIEW] as Route,
        { modelId: memberId },
      );
    },
  };
};

type RenderIncidentCardFunction = (
  overrides?: Partial<ComponentProps<Incident>>,
) => ReturnType<typeof render>;

const renderIncidentCard: RenderIncidentCardFunction = (
  overrides?: Partial<ComponentProps<Incident>>,
): ReturnType<typeof render> => {
  const element: ReactElement = (
    <EpisodeMembersCard<Incident> {...incidentCardProps(overrides)} />
  );

  return render(element);
};

beforeEach((): void => {
  getListMock.mockReset();

  const path: string = `/dashboard/${PROJECT_ID}/incidents/episodes/${EPISODE_ID}`;

  window.history.pushState({}, "", path);
  Navigation.setLocation({
    pathname: path,
    search: "",
    hash: "",
    state: null,
    key: "test",
  } as Location);
});

afterEach((): void => {
  cleanup();
  jest.restoreAllMocks();
});

describe("EpisodeMembersCard: queries", () => {
  test("asks for the newest eight incidents of this episode", async () => {
    getListMock.mockResolvedValue(listResult([]) as never);

    renderIncidentCard();

    await waitFor((): void => {
      expect(getListMock).toHaveBeenCalledTimes(1);
    });

    const request: Record<string, any> = getListMock.mock.calls[0]![0];

    expect(request["modelType"]).toBe(Incident);
    expect(Object.keys(request["query"])).toEqual(["incidentEpisodeId"]);
    expect(request["query"]["incidentEpisodeId"].toString()).toBe(EPISODE_ID);
    expect(request["limit"]).toBe(8);
    expect(request["skip"]).toBe(0);
    expect(request["sort"]).toEqual({ declaredAt: SortOrder.Descending });
    expect(request["select"]).toBe(INCIDENT_EPISODE_MEMBER_SELECT);
  });

  test("asks for the newest alerts of this alert episode by created time", async () => {
    getListMock.mockResolvedValue(listResult([]) as never);

    render(<EpisodeMembersCard<Alert> {...alertCardProps()} />);

    await waitFor((): void => {
      expect(getListMock).toHaveBeenCalledTimes(1);
    });

    const request: Record<string, any> = getListMock.mock.calls[0]![0];

    expect(request["modelType"]).toBe(Alert);
    expect(Object.keys(request["query"])).toEqual(["alertEpisodeId"]);
    expect(request["query"]["alertEpisodeId"].toString()).toBe(EPISODE_ID);
    expect(request["limit"]).toBe(8);
    expect(request["sort"]).toEqual({ createdAt: SortOrder.Descending });
    expect(request["select"]).toBe(ALERT_EPISODE_MEMBER_SELECT);
  });

  test("honours a custom preview limit", async () => {
    getListMock.mockResolvedValue(listResult([]) as never);

    renderIncidentCard({ limit: 3 });

    await waitFor((): void => {
      expect(getListMock).toHaveBeenCalledTimes(1);
    });

    expect(getListMock.mock.calls[0]![0].limit).toBe(3);
  });
});

describe("EpisodeMembersCard: rows", () => {
  test("renders each member with number, linked title, state, severity and time", async () => {
    const declaredAt: Date = new Date(Date.now() - 5 * MINUTE);

    getListMock.mockResolvedValue(
      listResult([
        buildIncident({
          id: FIRST_INCIDENT_ID,
          title: "Checkout API returning 500s",
          number: 42,
          prefix: "INC-42",
          declaredAt: declaredAt,
          stateName: "Investigating",
          stateColor: "#f59e0b",
          severityName: "Critical",
          severityColor: "#ef4444",
        }),
        buildIncident({
          id: SECOND_INCIDENT_ID,
          title: "Payments queue backing up",
          number: 41,
          declaredAt: new Date(Date.now() - 60 * MINUTE),
        }),
      ]) as never,
    );

    renderIncidentCard();

    await waitFor((): void => {
      expect(screen.getAllByTestId("episode-member-row")).toHaveLength(2);
    });

    const rows: Array<HTMLElement> =
      screen.getAllByTestId("episode-member-row");
    const firstRow: HTMLElement = rows[0]!;
    const secondRow: HTMLElement = rows[1]!;

    expect(
      within(firstRow).getByTestId("episode-member-number"),
    ).toHaveTextContent("INC-42");
    // Without a prefix the number still reads as a reference.
    expect(
      within(secondRow).getByTestId("episode-member-number"),
    ).toHaveTextContent("#41");

    const link: HTMLElement = within(firstRow).getByRole("link", {
      name: "Checkout API returning 500s",
    });

    expect(link).toHaveAttribute(
      "href",
      RouteUtil.populateRouteParams(RouteMap[PageMap.INCIDENT_VIEW] as Route, {
        modelId: new ObjectID(FIRST_INCIDENT_ID),
      }).toString(),
    );
    expect(link.getAttribute("href")).toBe(
      `/dashboard/${PROJECT_ID}/incidents/${FIRST_INCIDENT_ID}`,
    );
    expect(link).toHaveClass("truncate", "min-w-0");

    const state: HTMLElement = within(firstRow).getByTestId(
      "episode-member-state",
    );

    expect(state).toHaveTextContent("Investigating");
    expect(state).toHaveAttribute("title", "State: Investigating");
    expect(
      (state.querySelector('[aria-hidden="true"]') as HTMLElement).style
        .backgroundColor,
    ).toBe("rgb(245, 158, 11)");

    const severity: HTMLElement = within(firstRow).getByTestId(
      "episode-member-severity",
    );

    expect(severity).toHaveTextContent("Critical");
    expect(
      (severity.querySelector('[aria-hidden="true"]') as HTMLElement).style
        .backgroundColor,
    ).toBe("rgb(239, 68, 68)");

    const time: HTMLElement = firstRow.querySelector("time") as HTMLElement;

    expect(time).toHaveAttribute("dateTime", declaredAt.toISOString());
    expect(time).toHaveTextContent(OneUptimeDate.fromNow(declaredAt));
    expect(time).toHaveAttribute(
      "title",
      OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(declaredAt),
    );

    // A member without state or severity simply shows neither pill.
    expect(within(secondRow).queryByTestId("episode-member-state")).toBeNull();
    expect(
      within(secondRow).queryByTestId("episode-member-severity"),
    ).toBeNull();
  });

  test("alert rows link to the alert page", async () => {
    const alert: Alert = new Alert();
    alert.id = new ObjectID(FIRST_INCIDENT_ID);
    alert.title = "Disk almost full";
    alert.alertNumber = 3;
    alert.createdAt = new Date(Date.now() - 2 * MINUTE);

    const state: AlertState = new AlertState();
    state.name = "Acknowledged";
    state.color = new Color("#10b981");
    alert.currentAlertState = state;

    getListMock.mockResolvedValue(listResult([alert]) as never);

    render(<EpisodeMembersCard<Alert> {...alertCardProps()} />);

    const link: HTMLElement = await screen.findByRole("link", {
      name: "Disk almost full",
    });

    expect(link.getAttribute("href")).toBe(
      `/dashboard/${PROJECT_ID}/alerts/${FIRST_INCIDENT_ID}`,
    );
    expect(screen.getByTestId("episode-member-state")).toHaveTextContent(
      "Acknowledged",
    );
    expect(screen.getByTestId("episode-members-count")).toHaveTextContent(
      "1 alert",
    );
  });

  test("rows stack on small screens and sit in one line from sm up", async () => {
    getListMock.mockResolvedValue(
      listResult([
        buildIncident({
          id: FIRST_INCIDENT_ID,
          title: "A very long incident title that has to truncate on phones",
          number: 1,
          declaredAt: new Date(),
          stateName: "Created",
        }),
      ]) as never,
    );

    renderIncidentCard();

    const row: HTMLElement = await screen.findByTestId("episode-member-row");

    expect(row).toHaveClass("flex", "flex-col", "sm:flex-row");
    expect(row.children[0]).toHaveClass("min-w-0", "flex-1");
    expect(row.children[1]).toHaveClass("flex-wrap");
  });
});

describe("EpisodeMembersCard: header", () => {
  test("shows the total count and a link to every member", async () => {
    getListMock.mockResolvedValue(
      listResult(
        [
          buildIncident({
            id: FIRST_INCIDENT_ID,
            title: "First",
            number: 2,
            declaredAt: new Date(),
          }),
          buildIncident({
            id: SECOND_INCIDENT_ID,
            title: "Second",
            number: 1,
            declaredAt: new Date(),
          }),
        ],
        12,
      ) as never,
    );

    renderIncidentCard();

    await waitFor((): void => {
      expect(screen.getByTestId("episode-members-count")).toHaveTextContent(
        "12 incidents",
      );
    });

    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(
      "Incidents in this episode",
    );

    const viewAll: HTMLElement = screen.getByRole("link", {
      name: /View all incidents/,
    });

    expect(viewAll.getAttribute("href")).toBe(
      `/dashboard/${PROJECT_ID}/incidents/episodes/${EPISODE_ID}/incidents`,
    );
    expect(
      screen.getByText("Showing the newest 2 of 12 incidents."),
    ).toBeInTheDocument();
  });

  test("uses the singular noun for one member and hides the 'showing' note", async () => {
    getListMock.mockResolvedValue(
      listResult([
        buildIncident({
          id: FIRST_INCIDENT_ID,
          title: "Only one",
          number: 1,
          declaredAt: new Date(),
        }),
      ]) as never,
    );

    renderIncidentCard();

    await waitFor((): void => {
      expect(screen.getByTestId("episode-members-count")).toHaveTextContent(
        "1 incident",
      );
    });

    expect(screen.queryByText(/Showing the newest/)).toBeNull();
  });

  test("the alert card links to the member alerts page", async () => {
    getListMock.mockResolvedValue(listResult([]) as never);

    render(<EpisodeMembersCard<Alert> {...alertCardProps()} />);

    const viewAll: HTMLElement = await screen.findByRole("link", {
      name: /View all alerts/,
    });

    expect(viewAll.getAttribute("href")).toBe(
      `/dashboard/${PROJECT_ID}/alerts/episodes/${EPISODE_ID}/alerts`,
    );
  });
});

describe("EpisodeMembersCard: loading, empty and error states", () => {
  test("shows a skeleton while the first page loads", () => {
    getListMock.mockReturnValue(createDeferred<unknown>().promise as never);

    renderIncidentCard();

    expect(screen.getByRole("status")).toHaveTextContent("Loading incidents");
    expect(screen.getByTestId("episode-members-skeleton")).toHaveClass(
      "motion-safe:animate-pulse",
    );
    expect(screen.queryByTestId("episode-members-count")).toBeNull();
  });

  test("says so when the episode has no members yet", async () => {
    getListMock.mockResolvedValue(listResult([]) as never);

    render(<EpisodeMembersCard<Alert> {...alertCardProps()} />);

    const empty: HTMLElement = await screen.findByTestId(
      "episode-members-empty",
    );

    expect(empty).toHaveTextContent("No alerts in this episode yet");
    expect(screen.getByTestId("episode-members-count")).toHaveTextContent(
      "0 alerts",
    );
    expect(screen.queryByRole("status")).toBeNull();
  });

  test("shows the error with a retry that reloads", async () => {
    getListMock.mockRejectedValueOnce(new Error("Incidents are unavailable"));
    getListMock.mockResolvedValueOnce(
      listResult([
        buildIncident({
          id: FIRST_INCIDENT_ID,
          title: "Recovered row",
          number: 9,
          declaredAt: new Date(),
        }),
      ]) as never,
    );

    renderIncidentCard();

    await waitFor((): void => {
      expect(screen.getByText("Incidents are unavailable")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId("refresh-button"));

    await waitFor((): void => {
      expect(
        screen.getByRole("link", { name: "Recovered row" }),
      ).toBeInTheDocument();
    });

    expect(getListMock).toHaveBeenCalledTimes(2);
    expect(screen.queryByText("Incidents are unavailable")).toBeNull();
  });
});

describe("EpisodeMembersCard: refreshing", () => {
  test("a new refreshToken reloads in place without the skeleton", async () => {
    getListMock.mockResolvedValueOnce(
      listResult([
        buildIncident({
          id: FIRST_INCIDENT_ID,
          title: "Before refresh",
          number: 1,
          stateName: "Created",
          declaredAt: new Date(),
        }),
      ]) as never,
    );

    const view: ReturnType<typeof render> = renderIncidentCard({
      refreshToken: 0,
    });

    await screen.findByRole("link", { name: "Before refresh" });

    const refreshed: Deferred<unknown> = createDeferred<unknown>();
    getListMock.mockReturnValueOnce(refreshed.promise as never);

    view.rerender(
      <EpisodeMembersCard<Incident>
        {...incidentCardProps({ refreshToken: 1 })}
      />,
    );

    expect(getListMock).toHaveBeenCalledTimes(2);
    // The old rows stay while the reload is in flight.
    expect(
      screen.getByRole("link", { name: "Before refresh" }),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("episode-members-skeleton")).toBeNull();

    await act(async () => {
      refreshed.resolve(
        listResult([
          buildIncident({
            id: FIRST_INCIDENT_ID,
            title: "After refresh",
            number: 1,
            stateName: "Resolved",
            declaredAt: new Date(),
          }),
        ]),
      );
    });

    expect(
      screen.getByRole("link", { name: "After refresh" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("episode-member-state")).toHaveTextContent(
      "Resolved",
    );
  });

  test("re-rendering with the same refreshToken does not refetch", async () => {
    getListMock.mockResolvedValue(listResult([]) as never);

    const view: ReturnType<typeof render> = renderIncidentCard({
      refreshToken: 4,
    });

    await screen.findByTestId("episode-members-empty");

    view.rerender(
      <EpisodeMembersCard<Incident>
        {...incidentCardProps({ refreshToken: 4 })}
      />,
    );

    expect(getListMock).toHaveBeenCalledTimes(1);
  });

  test("a failed refresh keeps the rows and reports inline", async () => {
    getListMock.mockResolvedValueOnce(
      listResult([
        buildIncident({
          id: FIRST_INCIDENT_ID,
          title: "Still here",
          number: 1,
          declaredAt: new Date(),
        }),
      ]) as never,
    );

    const view: ReturnType<typeof render> = renderIncidentCard({
      refreshToken: 0,
    });

    await screen.findByRole("link", { name: "Still here" });

    getListMock.mockRejectedValueOnce(new Error("Timed out"));

    view.rerender(
      <EpisodeMembersCard<Incident>
        {...incidentCardProps({ refreshToken: 1 })}
      />,
    );

    await waitFor((): void => {
      expect(screen.getByRole("alert")).toHaveTextContent(
        "Couldn't refresh incidents: Timed out",
      );
    });

    expect(
      screen.getByRole("link", { name: "Still here" }),
    ).toBeInTheDocument();
  });

  test("ignores a slow response for an episode the page moved away from", async () => {
    const slowFirstEpisode: Deferred<unknown> = createDeferred<unknown>();

    getListMock.mockReturnValueOnce(slowFirstEpisode.promise as never);
    getListMock.mockResolvedValueOnce(
      listResult([
        buildIncident({
          id: SECOND_INCIDENT_ID,
          title: "Other episode incident",
          number: 5,
          declaredAt: new Date(),
        }),
      ]) as never,
    );

    const view: ReturnType<typeof render> = renderIncidentCard();

    view.rerender(
      <EpisodeMembersCard<Incident>
        {...incidentCardProps({ episodeId: new ObjectID(OTHER_EPISODE_ID) })}
      />,
    );

    await screen.findByRole("link", { name: "Other episode incident" });

    expect(
      getListMock.mock.calls[1]![0].query.incidentEpisodeId.toString(),
    ).toBe(OTHER_EPISODE_ID);

    await act(async () => {
      slowFirstEpisode.resolve(
        listResult([
          buildIncident({
            id: FIRST_INCIDENT_ID,
            title: "Stale incident",
            number: 1,
            declaredAt: new Date(),
          }),
        ]),
      );
    });

    expect(screen.queryByRole("link", { name: "Stale incident" })).toBeNull();
    expect(
      screen.getByRole("link", { name: "Other episode incident" }),
    ).toBeInTheDocument();
  });
});
