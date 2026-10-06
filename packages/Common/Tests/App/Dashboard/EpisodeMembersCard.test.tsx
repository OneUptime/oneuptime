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
  ALERT_EPISODE_MEMBERSHIP,
  ALERT_EPISODE_MEMBER_SELECT,
  INCIDENT_EPISODE_MEMBERSHIP,
  INCIDENT_EPISODE_MEMBER_SELECT,
  getAlertEpisodeMemberRow,
  getIncidentEpisodeMemberRow,
} from "../../../../App/FeatureSet/Dashboard/src/Components/EpisodeView/EpisodeMembers";
import { EPISODE_MEMBER_IDS_PER_REQUEST } from "../../../../App/FeatureSet/Dashboard/src/Components/EpisodeView/FetchEpisodeMembers";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap, {
  RouteUtil,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import Alert from "../../../Models/DatabaseModels/Alert";
import AlertEpisodeMember from "../../../Models/DatabaseModels/AlertEpisodeMember";
import AlertState from "../../../Models/DatabaseModels/AlertState";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentEpisodeMember from "../../../Models/DatabaseModels/IncidentEpisodeMember";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import IncidentState from "../../../Models/DatabaseModels/IncidentState";
import Route from "../../../Types/API/Route";
import Includes from "../../../Types/BaseDatabase/Includes";
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
 *
 * The members are the episode's membership rows (IncidentEpisodeMember /
 * AlertEpisodeMember), read first, then the incidents or alerts they name.
 * The fake server below answers both the way the API does - every query key
 * filters - so a card that asked for incidents by their incidentEpisodeId
 * would lose the ones whose latest episode is another one.
 */

const PROJECT_ID: string = "22222222-2222-4222-8222-222222222222";
const EPISODE_ID: string = "11111111-1111-4111-8111-111111111111";
const OTHER_EPISODE_ID: string = "99999999-9999-4999-8999-999999999999";
const FIRST_INCIDENT_ID: string = "55555555-5555-4555-8555-555555555555";
const SECOND_INCIDENT_ID: string = "66666666-6666-4666-8666-666666666666";
const THIRD_INCIDENT_ID: string = "77777777-7777-4777-8777-777777777777";

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

/*
 * The fake server's tables: the membership rows, and the incidents or alerts
 * the reader may see (a private one the reader may not see is simply not
 * here, as the API leaves it out).
 */
interface FakeTables {
  memberships: Array<BaseModel>;
  members: Array<BaseModel>;
}

const tables: FakeTables = { memberships: [], members: [] };

type MatchesFunction = (row: BaseModel, query: Record<string, any>) => boolean;

const matches: MatchesFunction = (
  row: BaseModel,
  query: Record<string, any>,
): boolean => {
  return Object.keys(query).every((key: string): boolean => {
    const actual: string = String((row as any)[key]?.toString());
    const condition: unknown = query[key];

    if (condition instanceof Includes) {
      return condition.values.map(String).includes(actual);
    }

    return actual === String(condition);
  });
};

type AnswerFunction = (request: Record<string, any>) => unknown;

/*
 * Answers a list request like the API: filter by every query key, sort by the
 * one sort column, then page.
 */
const answer: AnswerFunction = (request: Record<string, any>): unknown => {
  const isMembership: boolean =
    request["modelType"] === IncidentEpisodeMember ||
    request["modelType"] === AlertEpisodeMember;
  const rows: Array<BaseModel> = (
    isMembership ? tables.memberships : tables.members
  ).filter((row: BaseModel): boolean => {
    return (
      row instanceof request["modelType"] && matches(row, request["query"])
    );
  });

  const [sortField, sortOrder] = Object.entries(request["sort"] || {})[0] || [];

  if (sortField) {
    rows.sort((left: BaseModel, right: BaseModel): number => {
      const leftTime: number =
        ((left as any)[sortField] as Date | undefined)?.getTime() || 0;
      const rightTime: number =
        ((right as any)[sortField] as Date | undefined)?.getTime() || 0;

      return sortOrder === SortOrder.Descending
        ? rightTime - leftTime
        : leftTime - rightTime;
    });
  }

  return listResult(
    rows.slice(request["skip"], request["skip"] + request["limit"]),
    rows.length,
  );
};

type ServeFunction = (data: {
  memberships: Array<BaseModel>;
  members: Array<BaseModel>;
}) => void;

const serve: ServeFunction = (data: {
  memberships: Array<BaseModel>;
  members: Array<BaseModel>;
}): void => {
  tables.memberships = data.memberships;
  tables.members = data.members;

  getListMock.mockImplementation((...args: Array<any>) => {
    return Promise.resolve(answer(args[0]));
  });
};

type IncidentMembershipFunction = (
  episodeId: string,
  incidentId: string,
) => IncidentEpisodeMember;

const incidentMembership: IncidentMembershipFunction = (
  episodeId: string,
  incidentId: string,
): IncidentEpisodeMember => {
  const membership: IncidentEpisodeMember = new IncidentEpisodeMember();
  membership.incidentEpisodeId = new ObjectID(episodeId);
  membership.incidentId = new ObjectID(incidentId);
  return membership;
};

type AlertMembershipFunction = (
  episodeId: string,
  alertId: string,
) => AlertEpisodeMember;

const alertMembership: AlertMembershipFunction = (
  episodeId: string,
  alertId: string,
): AlertEpisodeMember => {
  const membership: AlertEpisodeMember = new AlertEpisodeMember();
  membership.alertEpisodeId = new ObjectID(episodeId);
  membership.alertId = new ObjectID(alertId);
  return membership;
};

type ServeIncidentsFunction = (
  incidents: Array<Incident>,
  episodeId?: string,
) => void;

// The incidents, every one a member of the episode.
const serveIncidents: ServeIncidentsFunction = (
  incidents: Array<Incident>,
  episodeId?: string,
): void => {
  serve({
    memberships: incidents.map((incident: Incident): IncidentEpisodeMember => {
      return incidentMembership(
        episodeId || EPISODE_ID,
        incident.id!.toString(),
      );
    }),
    members: incidents,
  });
};

type CallsForModelFunction = (modelType: unknown) => Array<Record<string, any>>;

const requestsFor: CallsForModelFunction = (
  modelType: unknown,
): Array<Record<string, any>> => {
  return getListMock.mock.calls
    .map((call: Array<any>): Record<string, any> => {
      return call[0];
    })
    .filter((request: Record<string, any>): boolean => {
      return request["modelType"] === modelType;
    });
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

type IncidentCardProps = ComponentProps<Incident, IncidentEpisodeMember>;

type IncidentCardPropsFunction = (
  overrides?: Partial<IncidentCardProps>,
) => IncidentCardProps;

const incidentCardProps: IncidentCardPropsFunction = (
  overrides?: Partial<IncidentCardProps>,
): IncidentCardProps => {
  return {
    modelType: Incident,
    episodeId: new ObjectID(EPISODE_ID),
    membership: INCIDENT_EPISODE_MEMBERSHIP,
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

type AlertCardProps = ComponentProps<Alert, AlertEpisodeMember>;

type AlertCardPropsFunction = () => AlertCardProps;

const alertCardProps: AlertCardPropsFunction = (): AlertCardProps => {
  return {
    modelType: Alert,
    episodeId: new ObjectID(EPISODE_ID),
    membership: ALERT_EPISODE_MEMBERSHIP,
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
  overrides?: Partial<IncidentCardProps>,
) => ReturnType<typeof render>;

const renderIncidentCard: RenderIncidentCardFunction = (
  overrides?: Partial<IncidentCardProps>,
): ReturnType<typeof render> => {
  const element: ReactElement = (
    <EpisodeMembersCard<Incident, IncidentEpisodeMember>
      {...incidentCardProps(overrides)}
    />
  );

  return render(element);
};

beforeEach((): void => {
  getListMock.mockReset();
  serve({ memberships: [], members: [] });

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
  test("reads the episode's membership, then its newest eight incidents by id", async () => {
    serveIncidents([
      buildIncident({
        id: FIRST_INCIDENT_ID,
        title: "First",
        number: 1,
        declaredAt: new Date(Date.now() - 2 * MINUTE),
      }),
      buildIncident({
        id: SECOND_INCIDENT_ID,
        title: "Second",
        number: 2,
        declaredAt: new Date(Date.now() - MINUTE),
      }),
    ]);

    renderIncidentCard();

    await waitFor((): void => {
      expect(getListMock).toHaveBeenCalledTimes(2);
    });

    const [membershipRequest, memberRequest] = getListMock.mock.calls.map(
      (call: Array<any>): Record<string, any> => {
        return call[0];
      },
    ) as [Record<string, any>, Record<string, any>];

    expect(membershipRequest["modelType"]).toBe(IncidentEpisodeMember);
    expect(Object.keys(membershipRequest["query"])).toEqual([
      "incidentEpisodeId",
    ]);
    expect(membershipRequest["query"]["incidentEpisodeId"].toString()).toBe(
      EPISODE_ID,
    );
    expect(membershipRequest["select"]).toEqual({ incidentId: true });
    expect(membershipRequest["skip"]).toBe(0);
    expect(membershipRequest["limit"]).toBe(EPISODE_MEMBER_IDS_PER_REQUEST);

    expect(memberRequest["modelType"]).toBe(Incident);
    expect(Object.keys(memberRequest["query"])).toEqual(["_id"]);
    expect(memberRequest["query"]["_id"]).toBeInstanceOf(Includes);
    expect(memberRequest["query"]["_id"].values).toEqual([
      FIRST_INCIDENT_ID,
      SECOND_INCIDENT_ID,
    ]);
    expect(memberRequest["limit"]).toBe(8);
    expect(memberRequest["skip"]).toBe(0);
    expect(memberRequest["sort"]).toEqual({ declaredAt: SortOrder.Descending });
    expect(memberRequest["select"]).toEqual(INCIDENT_EPISODE_MEMBER_SELECT);

    // Newest declared first.
    await waitFor((): void => {
      expect(screen.getAllByTestId("episode-member-row")).toHaveLength(2);
    });
    expect(
      screen.getAllByRole("link", { name: /^(First|Second)$/ }),
    ).toHaveLength(2);
    expect(screen.getAllByTestId("episode-member-row")[0]).toHaveTextContent(
      "Second",
    );
  });

  test("reads an alert episode's membership, then its alerts newest created first", async () => {
    const alert: Alert = new Alert();
    alert.id = new ObjectID(FIRST_INCIDENT_ID);
    alert.title = "Disk almost full";
    alert.createdAt = new Date(Date.now() - MINUTE);

    serve({
      memberships: [alertMembership(EPISODE_ID, FIRST_INCIDENT_ID)],
      members: [alert],
    });

    render(
      <EpisodeMembersCard<Alert, AlertEpisodeMember> {...alertCardProps()} />,
    );

    await waitFor((): void => {
      expect(getListMock).toHaveBeenCalledTimes(2);
    });

    const membershipRequest: Record<string, any> =
      requestsFor(AlertEpisodeMember)[0]!;

    expect(Object.keys(membershipRequest["query"])).toEqual(["alertEpisodeId"]);
    expect(membershipRequest["query"]["alertEpisodeId"].toString()).toBe(
      EPISODE_ID,
    );
    expect(membershipRequest["select"]).toEqual({ alertId: true });

    const memberRequest: Record<string, any> = requestsFor(Alert)[0]!;

    expect(memberRequest["query"]["_id"].values).toEqual([FIRST_INCIDENT_ID]);
    expect(memberRequest["limit"]).toBe(8);
    expect(memberRequest["sort"]).toEqual({ createdAt: SortOrder.Descending });
    expect(memberRequest["select"]).toEqual(ALERT_EPISODE_MEMBER_SELECT);
  });

  test("honours a custom preview limit", async () => {
    serveIncidents([
      buildIncident({
        id: FIRST_INCIDENT_ID,
        title: "First",
        number: 1,
        declaredAt: new Date(),
      }),
    ]);

    renderIncidentCard({ limit: 3 });

    await waitFor((): void => {
      expect(requestsFor(Incident)).toHaveLength(1);
    });

    expect(requestsFor(Incident)[0]!["limit"]).toBe(3);
  });

  test("an episode without members asks for no incidents", async () => {
    renderIncidentCard();

    await screen.findByTestId("episode-members-empty");

    expect(requestsFor(IncidentEpisodeMember)).toHaveLength(1);
    expect(requestsFor(Incident)).toHaveLength(0);
    expect(screen.getByTestId("episode-members-count")).toHaveTextContent(
      "0 incidents",
    );
  });
});

describe("EpisodeMembersCard: membership", () => {
  test("lists an incident whose latest episode is a later one", async () => {
    /*
     * The first incident joined this episode, then another one: its own
     * incidentEpisodeId names the other episode, as the member service keeps
     * it. It is still a member of this one.
     */
    const movedOn: Incident = buildIncident({
      id: FIRST_INCIDENT_ID,
      title: "Also in a later episode",
      number: 7,
      declaredAt: new Date(Date.now() - 30 * MINUTE),
    });
    movedOn.incidentEpisodeId = new ObjectID(OTHER_EPISODE_ID);

    const stayed: Incident = buildIncident({
      id: SECOND_INCIDENT_ID,
      title: "Only in this episode",
      number: 8,
      declaredAt: new Date(Date.now() - 10 * MINUTE),
    });
    stayed.incidentEpisodeId = new ObjectID(EPISODE_ID);

    serve({
      memberships: [
        incidentMembership(EPISODE_ID, FIRST_INCIDENT_ID),
        incidentMembership(OTHER_EPISODE_ID, FIRST_INCIDENT_ID),
        incidentMembership(EPISODE_ID, SECOND_INCIDENT_ID),
      ],
      members: [movedOn, stayed],
    });

    renderIncidentCard();

    await screen.findByRole("link", { name: "Also in a later episode" });

    expect(
      screen.getByRole("link", { name: "Only in this episode" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("episode-members-count")).toHaveTextContent(
      "2 incidents",
    );
  });

  test("leaves out an incident that left this episode for another", async () => {
    // Its membership here was removed; one in another episode remains.
    const left: Incident = buildIncident({
      id: FIRST_INCIDENT_ID,
      title: "Moved to another episode",
      number: 3,
      declaredAt: new Date(),
    });

    serve({
      memberships: [incidentMembership(OTHER_EPISODE_ID, FIRST_INCIDENT_ID)],
      members: [left],
    });

    renderIncidentCard();

    await screen.findByTestId("episode-members-empty");

    expect(
      screen.queryByRole("link", { name: "Moved to another episode" }),
    ).toBeNull();
  });

  test("counts the members the reader may see", async () => {
    // Three members; the third is private and the incident read leaves it out.
    serve({
      memberships: [
        incidentMembership(EPISODE_ID, FIRST_INCIDENT_ID),
        incidentMembership(EPISODE_ID, SECOND_INCIDENT_ID),
        incidentMembership(EPISODE_ID, THIRD_INCIDENT_ID),
      ],
      members: [
        buildIncident({
          id: FIRST_INCIDENT_ID,
          title: "Visible one",
          number: 1,
          declaredAt: new Date(),
        }),
        buildIncident({
          id: SECOND_INCIDENT_ID,
          title: "Visible two",
          number: 2,
          declaredAt: new Date(),
        }),
      ],
    });

    renderIncidentCard();

    await waitFor((): void => {
      expect(screen.getAllByTestId("episode-member-row")).toHaveLength(2);
    });

    expect(screen.getByTestId("episode-members-count")).toHaveTextContent(
      "2 incidents",
    );
    expect(screen.queryByText(/Showing the newest/)).toBeNull();
    // The private one is still asked for: the server decides who sees it.
    expect(requestsFor(Incident)[0]!["query"]["_id"].values).toContain(
      THIRD_INCIDENT_ID,
    );
  });

  test("a membership read the reader may not make shows its error", async () => {
    getListMock.mockImplementation((...args: Array<any>) => {
      if (args[0]["modelType"] === IncidentEpisodeMember) {
        return Promise.reject(
          new Error(
            "You do not have permissions to read Incident Episode Member.",
          ),
        );
      }

      return Promise.resolve(answer(args[0]));
    });

    renderIncidentCard();

    await waitFor((): void => {
      expect(
        screen.getByText(
          "You do not have permissions to read Incident Episode Member.",
        ),
      ).toBeInTheDocument();
    });

    expect(requestsFor(Incident)).toHaveLength(0);
  });
});

describe("EpisodeMembersCard: rows", () => {
  test("renders each member with number, linked title, state, severity and time", async () => {
    const declaredAt: Date = new Date(Date.now() - 5 * MINUTE);

    serveIncidents([
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
    ]);

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

    serve({
      memberships: [alertMembership(EPISODE_ID, FIRST_INCIDENT_ID)],
      members: [alert],
    });

    render(
      <EpisodeMembersCard<Alert, AlertEpisodeMember> {...alertCardProps()} />,
    );

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
    serveIncidents([
      buildIncident({
        id: FIRST_INCIDENT_ID,
        title: "A very long incident title that has to truncate on phones",
        number: 1,
        declaredAt: new Date(),
        stateName: "Created",
      }),
    ]);

    renderIncidentCard();

    const row: HTMLElement = await screen.findByTestId("episode-member-row");

    expect(row).toHaveClass("flex", "flex-col", "sm:flex-row");
    expect(row.children[0]).toHaveClass("min-w-0", "flex-1");
    expect(row.children[1]).toHaveClass("flex-wrap");
  });
});

describe("EpisodeMembersCard: header", () => {
  test("shows the total count and a link to every member", async () => {
    // Twelve members: the card shows the newest eight.
    const incidents: Array<Incident> = Array.from(
      { length: 12 },
      (_value: unknown, index: number): Incident => {
        return buildIncident({
          id: `55555555-5555-4555-8555-${String(index).padStart(12, "0")}`,
          title: `Incident ${index + 1}`,
          number: index + 1,
          declaredAt: new Date(Date.now() - (12 - index) * MINUTE),
        });
      },
    );

    serveIncidents(incidents);

    renderIncidentCard();

    await waitFor((): void => {
      expect(screen.getByTestId("episode-members-count")).toHaveTextContent(
        "12 incidents",
      );
    });

    expect(screen.getAllByTestId("episode-member-row")).toHaveLength(8);
    expect(screen.getAllByTestId("episode-member-row")[0]).toHaveTextContent(
      "Incident 12",
    );
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
      screen.getByText("Showing the newest 8 of 12 incidents."),
    ).toBeInTheDocument();
  });

  test("uses the singular noun for one member and hides the 'showing' note", async () => {
    serveIncidents([
      buildIncident({
        id: FIRST_INCIDENT_ID,
        title: "Only one",
        number: 1,
        declaredAt: new Date(),
      }),
    ]);

    renderIncidentCard();

    await waitFor((): void => {
      expect(screen.getByTestId("episode-members-count")).toHaveTextContent(
        "1 incident",
      );
    });

    expect(screen.queryByText(/Showing the newest/)).toBeNull();
  });

  test("the alert card links to the member alerts page", async () => {
    render(
      <EpisodeMembersCard<Alert, AlertEpisodeMember> {...alertCardProps()} />,
    );

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

  test("keeps the skeleton until the members themselves are read", async () => {
    serveIncidents([
      buildIncident({
        id: FIRST_INCIDENT_ID,
        title: "Slow to read",
        number: 1,
        declaredAt: new Date(),
      }),
    ]);

    const members: Deferred<unknown> = createDeferred<unknown>();

    getListMock.mockImplementation((...args: Array<any>) => {
      if (args[0]["modelType"] === Incident) {
        return members.promise;
      }

      return Promise.resolve(answer(args[0]));
    });

    renderIncidentCard();

    await waitFor((): void => {
      expect(requestsFor(Incident)).toHaveLength(1);
    });

    expect(screen.getByTestId("episode-members-skeleton")).toBeInTheDocument();
    expect(screen.queryByTestId("episode-members-count")).toBeNull();

    await act(async () => {
      members.resolve(answer(requestsFor(Incident)[0]!));
    });

    expect(
      screen.getByRole("link", { name: "Slow to read" }),
    ).toBeInTheDocument();
  });

  test("says so when the episode has no members yet", async () => {
    render(
      <EpisodeMembersCard<Alert, AlertEpisodeMember> {...alertCardProps()} />,
    );

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
    serveIncidents([
      buildIncident({
        id: FIRST_INCIDENT_ID,
        title: "Recovered row",
        number: 9,
        declaredAt: new Date(),
      }),
    ]);
    getListMock.mockRejectedValueOnce(new Error("Incidents are unavailable"));

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

    // The failed membership read, then the retry's membership and incidents.
    expect(getListMock).toHaveBeenCalledTimes(3);
    expect(screen.queryByText("Incidents are unavailable")).toBeNull();
  });

  test("a failed incident read after the membership read shows its error", async () => {
    serveIncidents([
      buildIncident({
        id: FIRST_INCIDENT_ID,
        title: "Never shown",
        number: 9,
        declaredAt: new Date(),
      }),
    ]);

    getListMock.mockImplementation((...args: Array<any>) => {
      if (args[0]["modelType"] === Incident) {
        return Promise.reject(new Error("Incident reads are failing"));
      }

      return Promise.resolve(answer(args[0]));
    });

    renderIncidentCard();

    await waitFor((): void => {
      expect(
        screen.getByText("Incident reads are failing"),
      ).toBeInTheDocument();
    });

    expect(screen.queryByRole("link", { name: "Never shown" })).toBeNull();
  });
});

describe("EpisodeMembersCard: refreshing", () => {
  test("a new refreshToken reloads in place without the skeleton", async () => {
    serveIncidents([
      buildIncident({
        id: FIRST_INCIDENT_ID,
        title: "Before refresh",
        number: 1,
        stateName: "Created",
        declaredAt: new Date(),
      }),
    ]);

    const view: ReturnType<typeof render> = renderIncidentCard({
      refreshToken: 0,
    });

    await screen.findByRole("link", { name: "Before refresh" });

    const refreshed: Deferred<unknown> = createDeferred<unknown>();
    getListMock.mockReturnValueOnce(refreshed.promise as never);

    view.rerender(
      <EpisodeMembersCard<Incident, IncidentEpisodeMember>
        {...incidentCardProps({ refreshToken: 1 })}
      />,
    );

    // The refresh's membership read is in flight.
    expect(getListMock).toHaveBeenCalledTimes(3);
    // The old rows stay while the reload is in flight.
    expect(
      screen.getByRole("link", { name: "Before refresh" }),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("episode-members-skeleton")).toBeNull();

    tables.members = [
      buildIncident({
        id: FIRST_INCIDENT_ID,
        title: "After refresh",
        number: 1,
        stateName: "Resolved",
        declaredAt: new Date(),
      }),
    ];

    await act(async () => {
      refreshed.resolve(answer(getListMock.mock.calls[2]![0]));
    });

    await waitFor((): void => {
      expect(
        screen.getByRole("link", { name: "After refresh" }),
      ).toBeInTheDocument();
    });
    expect(screen.getByTestId("episode-member-state")).toHaveTextContent(
      "Resolved",
    );
  });

  test("re-rendering with the same refreshToken does not refetch", async () => {
    const view: ReturnType<typeof render> = renderIncidentCard({
      refreshToken: 4,
    });

    await screen.findByTestId("episode-members-empty");

    view.rerender(
      <EpisodeMembersCard<Incident, IncidentEpisodeMember>
        {...incidentCardProps({ refreshToken: 4 })}
      />,
    );

    expect(getListMock).toHaveBeenCalledTimes(1);
  });

  test("a failed refresh keeps the rows and reports inline", async () => {
    serveIncidents([
      buildIncident({
        id: FIRST_INCIDENT_ID,
        title: "Still here",
        number: 1,
        declaredAt: new Date(),
      }),
    ]);

    const view: ReturnType<typeof render> = renderIncidentCard({
      refreshToken: 0,
    });

    await screen.findByRole("link", { name: "Still here" });

    getListMock.mockRejectedValueOnce(new Error("Timed out"));

    view.rerender(
      <EpisodeMembersCard<Incident, IncidentEpisodeMember>
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
    serve({
      memberships: [
        incidentMembership(EPISODE_ID, FIRST_INCIDENT_ID),
        incidentMembership(OTHER_EPISODE_ID, SECOND_INCIDENT_ID),
      ],
      members: [
        buildIncident({
          id: FIRST_INCIDENT_ID,
          title: "Stale incident",
          number: 1,
          declaredAt: new Date(),
        }),
        buildIncident({
          id: SECOND_INCIDENT_ID,
          title: "Other episode incident",
          number: 5,
          declaredAt: new Date(),
        }),
      ],
    });

    const slowFirstEpisode: Deferred<unknown> = createDeferred<unknown>();

    getListMock.mockReturnValueOnce(slowFirstEpisode.promise as never);

    const view: ReturnType<typeof render> = renderIncidentCard();

    view.rerender(
      <EpisodeMembersCard<Incident, IncidentEpisodeMember>
        {...incidentCardProps({ episodeId: new ObjectID(OTHER_EPISODE_ID) })}
      />,
    );

    await screen.findByRole("link", { name: "Other episode incident" });

    expect(
      getListMock.mock.calls[1]![0].query.incidentEpisodeId.toString(),
    ).toBe(OTHER_EPISODE_ID);

    await act(async () => {
      slowFirstEpisode.resolve(answer(getListMock.mock.calls[0]![0]));
    });

    expect(screen.queryByRole("link", { name: "Stale incident" })).toBeNull();
    expect(
      screen.getByRole("link", { name: "Other episode incident" }),
    ).toBeInTheDocument();
  });
});
