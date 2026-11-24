import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentEpisode from "../../../Models/DatabaseModels/IncidentEpisode";
import IncidentEpisodeMember from "../../../Models/DatabaseModels/IncidentEpisodeMember";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import IncidentState from "../../../Models/DatabaseModels/IncidentState";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import StatusPageResource from "../../../Models/DatabaseModels/StatusPageResource";
import StatusPageAPI from "../../../Server/API/StatusPageAPI";
import IncidentEpisodeMemberService from "../../../Server/Services/IncidentEpisodeMemberService";
import IncidentEpisodePublicNoteService from "../../../Server/Services/IncidentEpisodePublicNoteService";
import IncidentEpisodeService from "../../../Server/Services/IncidentEpisodeService";
import IncidentEpisodeStateTimelineService from "../../../Server/Services/IncidentEpisodeStateTimelineService";
import IncidentPublicNoteService from "../../../Server/Services/IncidentPublicNoteService";
import IncidentService from "../../../Server/Services/IncidentService";
import IncidentStateService from "../../../Server/Services/IncidentStateService";
import IncidentStateTimelineService from "../../../Server/Services/IncidentStateTimelineService";
import MonitorGroupService from "../../../Server/Services/MonitorGroupService";
import MonitorStatusService from "../../../Server/Services/MonitorStatusService";
import StatusPageGroupService from "../../../Server/Services/StatusPageGroupService";
import StatusPageHistoryChartBarColorRuleService from "../../../Server/Services/StatusPageHistoryChartBarColorRuleService";
import StatusPageResourceService from "../../../Server/Services/StatusPageResourceService";
import StatusPageService from "../../../Server/Services/StatusPageService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import { INCIDENT_SCOPE_COLUMNS } from "../../../Server/Utils/StatusPage/IncidentStatusPageScope";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import Color from "../../../Types/Color";
import Dictionary from "../../../Types/Dictionary";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthenticatedException from "../../../Types/Exception/NotAuthenticatedException";
import NotFoundException from "../../../Types/Exception/NotFoundException";
import { JSONArray, JSONObject } from "../../../Types/JSON";
import UptimeBarTooltipIncident from "../../../Types/Monitor/UptimeBarTooltipIncident";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import StatusPageIncidentGrouping, {
  EPISODE_INCIDENTS_KEY,
  INCIDENT_LIST_MODE_RESPONSE_KEY,
  PART_OF_EPISODES_RESPONSE_KEY,
  StatusPageIncidentListCards,
  StatusPageIncidentListMode,
} from "../../../Utils/StatusPage/IncidentGrouping";
import StatusPageTimelineEpisodes, {
  TIMELINE_EPISODES_RESPONSE_KEY,
} from "../../../Utils/StatusPage/TimelineEpisodes";
import { mockRouter } from "./Helpers";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import { FindOperator } from "typeorm";

/*
 * SMART INCIDENT GROUPING, THROUGH THE PUBLIC STATUS PAGE API (#10767).
 *
 * The routes a status page and its readers load - the overview, the incident
 * list and an incident, the episode list and an episode - on pages in each
 * mode the page's switches put it in (StatusPageIncidentGrouping): grouped
 * by episode (a new page), incidents and episodes separately (a page made
 * before the switch existed keeps that), incidents only, episodes only, and
 * a private page.
 *
 * The services behind StatusPageAPI are replaced by a small in-memory
 * database that answers each query the way Postgres would - the page's
 * monitors (the IncidentMonitor join), the scope split, visibility, privacy,
 * project and ids - and returns only the columns a query selects, as the
 * IncidentStatusPageScope test's does. So what a grouped page shows here is
 * what it would read from a real database.
 *
 * The incidents of the project, on the page's three monitors (Storefront,
 * Public API, Orders database) and one it does not list (an internal one):
 *
 *   - one incident in no episode;
 *   - an episode of three, which also holds an incident only on the internal
 *     monitor and a private one;
 *   - an episode of one shown incident and one hidden from status pages;
 *   - an episode of two hidden incidents only;
 *   - an incident whose episode is itself hidden from status pages.
 */

// Avoid the unrelated PasswordHash TS5.9 Buffer/BinaryLike compile failure.
jest.mock("../../../Server/Utils/PasswordHash", () => {
  return {
    __esModule: true,
    default: class PasswordHashStub {},
  };
});

jest.mock("../../../Server/Utils/Express", () => {
  return {
    getRouter: () => {
      return mockRouter;
    },
  };
});

jest.mock("../../../Server/Utils/Response", () => {
  return {
    sendEntityArrayResponse: jest.fn(),
    sendJsonObjectResponse: jest.fn(),
    sendEmptySuccessResponse: jest.fn(),
    sendEntityResponse: jest.fn(),
    sendErrorResponse: jest.fn(),
    sendFileResponse: jest.fn(),
    setNoCacheHeaders: jest.fn(),
  };
});

const OVERVIEW_ROUTE: string = "/status-page/overview/:statusPageIdOrDomain";
const INCIDENTS_ROUTE: string = "/status-page/incidents/:statusPageIdOrDomain";
const INCIDENT_DETAIL_ROUTE: string = `${INCIDENTS_ROUTE}/:incidentId`;
const EPISODES_ROUTE: string = "/status-page/episodes/:statusPageIdOrDomain";
const EPISODE_DETAIL_ROUTE: string = `${EPISODES_ROUTE}/:episodeId`;

const PROJECT_ID: ObjectID = new ObjectID(
  "10000000-0000-4000-8000-000000000001",
);

const UNRESOLVED_STATE_ID: string = "20000000-0000-4000-8000-000000000001";

// The pages, one per mode.
const GROUPED_PAGE: string = "b0000000-0000-4000-8000-000000000001";
const SEPARATE_PAGE: string = "b0000000-0000-4000-8000-000000000002";
const INCIDENTS_ONLY_PAGE: string = "b0000000-0000-4000-8000-000000000003";
const EPISODES_ONLY_PAGE: string = "b0000000-0000-4000-8000-000000000004";
const PRIVATE_PAGE: string = "b0000000-0000-4000-8000-000000000005";

// The page's monitors, and one no page lists.
const STOREFRONT_MONITOR: string = "c0000000-0000-4000-8000-000000000001";
const API_MONITOR: string = "c0000000-0000-4000-8000-000000000002";
const DATABASE_MONITOR: string = "c0000000-0000-4000-8000-000000000003";
const INTERNAL_MONITOR: string = "c0000000-0000-4000-8000-0000000000ff";

const PAGE_MONITORS: Array<string> = [
  STOREFRONT_MONITOR,
  API_MONITOR,
  DATABASE_MONITOR,
];

// What the page calls each of its monitors: never the monitor's own name.
const DISPLAY_NAMES: Dictionary<string> = {
  [STOREFRONT_MONITOR]: "Storefront",
  [API_MONITOR]: "Public API",
  [DATABASE_MONITOR]: "Orders database",
};

// The incidents.
const LONE: string = "a0000000-0000-4000-8000-000000000001";
const OUTAGE_WEBSITE: string = "a0000000-0000-4000-8000-000000000002";
const OUTAGE_API: string = "a0000000-0000-4000-8000-000000000003";
const OUTAGE_DATABASE: string = "a0000000-0000-4000-8000-000000000004";
const OUTAGE_INTERNAL_ONLY: string = "a0000000-0000-4000-8000-000000000005";
const OUTAGE_PRIVATE: string = "a0000000-0000-4000-8000-000000000006";
const MIX_SHOWN: string = "a0000000-0000-4000-8000-000000000007";
const MIX_HIDDEN: string = "a0000000-0000-4000-8000-000000000008";
const QUIET_FIRST: string = "a0000000-0000-4000-8000-000000000009";
const QUIET_SECOND: string = "a0000000-0000-4000-8000-00000000000a";
const UNDER_HIDDEN_EPISODE: string = "a0000000-0000-4000-8000-00000000000b";

// The episodes.
const EPISODE_OUTAGE: string = "e0000000-0000-4000-8000-000000000001";
const EPISODE_MIXED: string = "e0000000-0000-4000-8000-000000000002";
const EPISODE_HIDDEN_ONLY: string = "e0000000-0000-4000-8000-000000000003";
const HIDDEN_EPISODE: string = "e0000000-0000-4000-8000-000000000004";

// Every incident a public page shows on its own: visible, not private, listed.
const SHOWN_INCIDENTS: Array<string> = [
  LONE,
  OUTAGE_WEBSITE,
  OUTAGE_API,
  OUTAGE_DATABASE,
  MIX_SHOWN,
  UNDER_HIDDEN_EPISODE,
];

// What no public page may name, by id or by title.
const NEVER_SHOWN_INCIDENTS: Array<string> = [
  OUTAGE_INTERNAL_ONLY,
  OUTAGE_PRIVATE,
  MIX_HIDDEN,
  QUIET_FIRST,
  QUIET_SECOND,
];

interface PageFixture {
  id: string;
  name: string;
  isPublicStatusPage: boolean;
  showIncidentsOnStatusPage: boolean;
  showEpisodesOnStatusPage: boolean;
  groupIncidentsByEpisode: boolean;
}

interface IncidentFixture {
  id: string;
  title: string;
  monitorIds: Array<string>;
  isVisibleOnStatusPage: boolean;
  isPrivate?: boolean | undefined;
  createdAt: Date;
}

interface EpisodeFixture {
  id: string;
  title: string;
  memberIncidentIds: Array<string>;
  isVisibleOnStatusPage: boolean;
}

const PAGES: Array<PageFixture> = [
  {
    id: GROUPED_PAGE,
    name: "Grouped page",
    isPublicStatusPage: true,
    showIncidentsOnStatusPage: true,
    showEpisodesOnStatusPage: true,
    groupIncidentsByEpisode: true,
  },
  {
    id: SEPARATE_PAGE,
    name: "Separate page",
    isPublicStatusPage: true,
    showIncidentsOnStatusPage: true,
    showEpisodesOnStatusPage: true,
    groupIncidentsByEpisode: false,
  },
  {
    id: INCIDENTS_ONLY_PAGE,
    name: "Incidents only page",
    isPublicStatusPage: true,
    showIncidentsOnStatusPage: true,
    showEpisodesOnStatusPage: false,
    groupIncidentsByEpisode: true,
  },
  {
    id: EPISODES_ONLY_PAGE,
    name: "Episodes only page",
    isPublicStatusPage: true,
    showIncidentsOnStatusPage: false,
    showEpisodesOnStatusPage: true,
    groupIncidentsByEpisode: true,
  },
  {
    id: PRIVATE_PAGE,
    name: "Private page",
    isPublicStatusPage: false,
    showIncidentsOnStatusPage: true,
    showEpisodesOnStatusPage: true,
    groupIncidentsByEpisode: true,
  },
];

function hoursAgo(hours: number): Date {
  return new Date(Date.now() - hours * 60 * 60 * 1000);
}

const INCIDENTS: Array<IncidentFixture> = [
  {
    id: LONE,
    title: "Search is slow",
    monitorIds: [STOREFRONT_MONITOR],
    isVisibleOnStatusPage: true,
    createdAt: hoursAgo(9),
  },
  {
    id: OUTAGE_WEBSITE,
    title: "Website Monitor Outage",
    monitorIds: [STOREFRONT_MONITOR],
    isVisibleOnStatusPage: true,
    createdAt: hoursAgo(8),
  },
  {
    id: OUTAGE_API,
    title: "API Monitor Outage",
    monitorIds: [API_MONITOR],
    isVisibleOnStatusPage: true,
    createdAt: hoursAgo(7.9),
  },
  {
    id: OUTAGE_DATABASE,
    title: "Database Monitor Outage",
    monitorIds: [DATABASE_MONITOR, INTERNAL_MONITOR],
    isVisibleOnStatusPage: true,
    createdAt: hoursAgo(7.8),
  },
  {
    id: OUTAGE_INTERNAL_ONLY,
    title: "Internal queue backlog",
    monitorIds: [INTERNAL_MONITOR],
    isVisibleOnStatusPage: true,
    createdAt: hoursAgo(7.7),
  },
  {
    id: OUTAGE_PRIVATE,
    title: "Private: the root cause",
    monitorIds: [API_MONITOR],
    isVisibleOnStatusPage: true,
    isPrivate: true,
    createdAt: hoursAgo(7.6),
  },
  {
    id: MIX_SHOWN,
    title: "Orders are delayed",
    monitorIds: [DATABASE_MONITOR],
    isVisibleOnStatusPage: true,
    createdAt: hoursAgo(5),
  },
  {
    id: MIX_HIDDEN,
    title: "Hidden: payment provider throttling",
    monitorIds: [API_MONITOR],
    isVisibleOnStatusPage: false,
    createdAt: hoursAgo(4.9),
  },
  {
    id: QUIET_FIRST,
    title: "Hidden: cache warm-up",
    monitorIds: [STOREFRONT_MONITOR],
    isVisibleOnStatusPage: false,
    createdAt: hoursAgo(3),
  },
  {
    id: QUIET_SECOND,
    title: "Hidden: cache eviction",
    monitorIds: [STOREFRONT_MONITOR],
    isVisibleOnStatusPage: false,
    createdAt: hoursAgo(2.9),
  },
  {
    id: UNDER_HIDDEN_EPISODE,
    title: "Login errors",
    monitorIds: [STOREFRONT_MONITOR],
    isVisibleOnStatusPage: true,
    createdAt: hoursAgo(1),
  },
];

const EPISODES: Array<EpisodeFixture> = [
  {
    id: EPISODE_OUTAGE,
    title: "Infrastructure Outage",
    memberIncidentIds: [
      OUTAGE_WEBSITE,
      OUTAGE_API,
      OUTAGE_DATABASE,
      OUTAGE_INTERNAL_ONLY,
      OUTAGE_PRIVATE,
    ],
    isVisibleOnStatusPage: true,
  },
  {
    id: EPISODE_MIXED,
    title: "Order processing slowdown",
    memberIncidentIds: [MIX_SHOWN, MIX_HIDDEN],
    isVisibleOnStatusPage: true,
  },
  {
    id: EPISODE_HIDDEN_ONLY,
    title: "Cache follow-up",
    memberIncidentIds: [QUIET_FIRST, QUIET_SECOND],
    isVisibleOnStatusPage: true,
  },
  {
    id: HIDDEN_EPISODE,
    title: "Login investigation",
    memberIncidentIds: [UNDER_HIDDEN_EPISODE],
    isVisibleOnStatusPage: false,
  },
];

function titleOf(incidentId: string): string {
  return INCIDENTS.find((incident: IncidentFixture) => {
    return incident.id === incidentId;
  })!.title;
}

function episodeTitleOf(episodeId: string): string {
  return EPISODES.find((episode: EpisodeFixture) => {
    return episode.id === episodeId;
  })!.title;
}

function pageFixture(pageId: string): PageFixture | undefined {
  return PAGES.find((page: PageFixture) => {
    return page.id === pageId.toString().toLowerCase();
  });
}

function pageName(pageId: string): string {
  return pageFixture(pageId)?.name || "an unknown page";
}

// Test-table rows with a readable label first, for the tests' names.
function pageCases(pageIds: Array<string>): Array<[string, string]> {
  return pageIds.map((pageId: string): [string, string] => {
    return [pageName(pageId), pageId];
  });
}

function operatorParameters(operator: unknown): Array<unknown> | null {
  const raw: { objectLiteralParameters?: Dictionary<unknown> } = operator as {
    objectLiteralParameters?: Dictionary<unknown>;
  };

  if (!raw || typeof raw !== "object" || !("objectLiteralParameters" in raw)) {
    return null;
  }

  return Object.values(raw.objectLiteralParameters || {});
}

// The privacy clause every status page read adds (StatusPageVisibilityQuery).
function matchesPrivacy(isPrivate: boolean, expected: unknown): boolean {
  const operator: FindOperator<unknown> = expected as FindOperator<unknown>;

  if (!(operator instanceof FindOperator) || !operator.getSql) {
    throw new Error(
      `Unexpected isPrivate condition in a test query: ${String(expected)}`,
    );
  }

  const sql: string = operator.getSql("private_column");

  if (sql !== "(private_column IS NULL OR private_column = FALSE)") {
    throw new Error(`Unexpected isPrivate clause in a test query: ${sql}`);
  }

  return !isPrivate;
}

function matchesValue(actual: unknown, expected: unknown): boolean {
  const parameters: Array<unknown> | null = operatorParameters(expected);

  if (parameters) {
    if (parameters.length === 0) {
      return false;
    }

    if (parameters.length === 1 && Array.isArray(parameters[0])) {
      return (parameters[0] as Array<unknown>)
        .map((value: unknown): string => {
          return String(value).toLowerCase();
        })
        .includes(String(actual).toLowerCase());
    }

    if (
      parameters.length === 2 &&
      parameters[0] instanceof Date &&
      parameters[1] instanceof Date
    ) {
      const time: number = (actual as Date).getTime();
      return parameters[0].getTime() <= time && time <= parameters[1].getTime();
    }

    throw new Error(`Unexpected operator in a test query: ${String(expected)}`);
  }

  if (typeof expected === "boolean") {
    return actual === expected;
  }

  return String(actual).toLowerCase() === String(expected).toLowerCase();
}

function toIdList(value: unknown): Array<string> {
  return (value as Array<ObjectID | string | { _id?: string }>).map(
    (item: ObjectID | string | { _id?: string }): string => {
      if (item instanceof ObjectID || typeof item === "string") {
        return item.toString().toLowerCase();
      }

      return String(item._id).toLowerCase();
    },
  );
}

function incidentMatches(
  incident: IncidentFixture,
  query: Dictionary<unknown>,
): boolean {
  return Object.entries(query).every(
    ([key, expected]: [string, unknown]): boolean => {
      switch (key) {
        case "_id":
          return matchesValue(incident.id, expected);
        case "projectId":
          return matchesValue(PROJECT_ID.toString(), expected);
        case "isVisibleOnStatusPage":
          return matchesValue(incident.isVisibleOnStatusPage, expected);
        case "isPrivate":
          return matchesPrivacy(incident.isPrivate === true, expected);
        case "isScopedToStatusPages":
          // Every incident here is unscoped.
          return matchesValue(false, expected);
        case "statusPages":
          return false;
        case "currentIncidentStateId":
          return matchesValue(UNRESOLVED_STATE_ID, expected);
        case "createdAt":
        case "declaredAt":
          return matchesValue(incident.createdAt, expected);
        case "monitors": {
          const monitorIds: Array<string> = toIdList(expected);
          return incident.monitorIds.some((id: string): boolean => {
            return monitorIds.includes(id);
          });
        }
        default:
          throw new Error(`Unexpected incident query key in a test: ${key}`);
      }
    },
  );
}

function makeState(): IncidentState {
  const state: IncidentState = new IncidentState();
  state._id = UNRESOLVED_STATE_ID;
  state.name = "Investigating";
  state.color = new Color("#f59e0b");
  return state;
}

function makeSeverity(): IncidentSeverity {
  const severity: IncidentSeverity = new IncidentSeverity();
  severity.name = "Major Incident";
  severity.color = new Color("#ef4444");
  return severity;
}

// The incident as a database row; a read returns only what it selects.
function incidentRow(fixture: IncidentFixture): Dictionary<unknown> {
  return {
    _id: fixture.id,
    projectId: PROJECT_ID,
    title: fixture.title,
    description: `${fixture.title}, in detail`,
    createdAt: fixture.createdAt,
    declaredAt: fixture.createdAt,
    updatedAt: fixture.createdAt,
    isVisibleOnStatusPage: fixture.isVisibleOnStatusPage,
    isPrivate: fixture.isPrivate === true,
    showPostmortemOnStatusPage: false,
    postmortemNote: `${fixture.title}: what happened`,
    currentIncidentStateId: new ObjectID(UNRESOLVED_STATE_ID),
    currentIncidentState: makeState(),
    incidentSeverity: makeSeverity(),
    monitors: fixture.monitorIds.map((monitorId: string): Monitor => {
      const monitor: Monitor = new Monitor();
      monitor._id = monitorId;
      monitor.name = `Monitor named ${monitorId.slice(-4)}`;
      return monitor;
    }),
    isScopedToStatusPages: false,
    statusPages: [],
    statusPagesNotifiedOnCreation: [],
  };
}

function readIncident(
  fixture: IncidentFixture,
  select: Dictionary<unknown>,
): Incident {
  const row: Dictionary<unknown> = incidentRow(fixture);
  const incident: Incident = new Incident();
  const target: Dictionary<unknown> =
    incident as unknown as Dictionary<unknown>;

  for (const key of Object.keys(select)) {
    if (select[key] && key in row) {
      target[key] = row[key];
    }
  }

  target["_id"] = row["_id"];

  return incident;
}

function sortIncidents(
  incidents: Array<IncidentFixture>,
  sort: Dictionary<SortOrder> | undefined,
): Array<IncidentFixture> {
  const entries: Array<[string, SortOrder]> = Object.entries(sort || {});

  return [...incidents].sort(
    (a: IncidentFixture, b: IncidentFixture): number => {
      for (const [key, order] of entries) {
        if (key !== "createdAt" && key !== "declaredAt") {
          throw new Error(`Unexpected incident sort key in a test: ${key}`);
        }

        const compared: number = a.createdAt.getTime() - b.createdAt.getTime();

        if (compared !== 0) {
          return order === SortOrder.Descending ? -compared : compared;
        }
      }

      return 0;
    },
  );
}

function readPage(
  pageId: string,
  select: Dictionary<unknown> | undefined,
): StatusPage | null {
  const fixture: PageFixture | undefined = pageFixture(pageId);

  if (!fixture) {
    return null;
  }

  const row: Dictionary<unknown> = {
    _id: fixture.id,
    projectId: PROJECT_ID,
    name: fixture.name,
    isPublicStatusPage: fixture.isPublicStatusPage,
    showIncidentsOnStatusPage: fixture.showIncidentsOnStatusPage,
    showEpisodesOnStatusPage: fixture.showEpisodesOnStatusPage,
    groupIncidentsByEpisode: fixture.groupIncidentsByEpisode,
    showIncidentHistoryInDays: 14,
    showEpisodeHistoryInDays: 14,
    showUptimeHistoryInDays: 14,
    onlyShowScopedIncidents: false,
  };

  const page: StatusPage = new StatusPage();
  const target: Dictionary<unknown> = page as unknown as Dictionary<unknown>;

  for (const key of Object.keys(select || {})) {
    if ((select || {})[key] && key in row) {
      target[key] = row[key];
    }
  }

  target["_id"] = row["_id"];

  return page;
}

function resourcesOn(pageId: string): Array<StatusPageResource> {
  if (!pageFixture(pageId)) {
    return [];
  }

  return PAGE_MONITORS.map(
    (monitorId: string, index: number): StatusPageResource => {
      const resource: StatusPageResource = new StatusPageResource();
      resource._id = `${pageId.slice(0, -4)}${(1000 + index).toString()}`;
      resource.statusPageId = new ObjectID(pageId);
      resource.monitorId = new ObjectID(monitorId);
      resource.displayName = DISPLAY_NAMES[monitorId]!;
      return resource;
    },
  );
}

function members(): Array<IncidentEpisodeMember> {
  return EPISODES.flatMap((episode: EpisodeFixture) => {
    return episode.memberIncidentIds.map(
      (incidentId: string): IncidentEpisodeMember => {
        const member: IncidentEpisodeMember = new IncidentEpisodeMember();
        member._id = `${episode.id.slice(0, -4)}${incidentId.slice(-4)}`;
        member.incidentEpisodeId = new ObjectID(episode.id);
        member.incidentId = new ObjectID(incidentId);
        return member;
      },
    );
  });
}

function makeEpisode(fixture: EpisodeFixture): IncidentEpisode {
  const episode: IncidentEpisode = new IncidentEpisode();
  episode._id = fixture.id;
  episode.title = fixture.title;
  episode.description = `${fixture.title}: what we know`;
  episode.createdAt = hoursAgo(8.5);
  episode.declaredAt = hoursAgo(8.5);
  episode.currentIncidentState = makeState();
  episode.incidentSeverity = makeSeverity();
  return episode;
}

function episodeMatches(
  fixture: EpisodeFixture,
  query: Dictionary<unknown>,
): boolean {
  return Object.entries(query).every(
    ([key, expected]: [string, unknown]): boolean => {
      switch (key) {
        case "_id":
          return matchesValue(fixture.id, expected);
        case "projectId":
          return matchesValue(PROJECT_ID.toString(), expected);
        case "isVisibleOnStatusPage":
          return matchesValue(fixture.isVisibleOnStatusPage, expected);
        case "isPrivate":
          return matchesPrivacy(false, expected);
        case "currentIncidentStateId":
          return matchesValue(UNRESOLVED_STATE_ID, expected);
        default:
          throw new Error(`Unexpected episode query key in a test: ${key}`);
      }
    },
  );
}

type IncidentRead = {
  query: Dictionary<unknown>;
  select: Dictionary<unknown>;
};

let incidentReads: Array<IncidentRead> = [];

function mockDatabase(): void {
  // The per-request read access check: each page as its fixture says.
  (
    jest.spyOn(StatusPageService, "findOneById") as unknown as jest.SpyInstance
  ).mockImplementation((args: unknown) => {
    const { id } = args as { id: ObjectID };
    return Promise.resolve(
      readPage(id.toString(), {
        isPublicStatusPage: true,
      }),
    );
  });

  // Nobody here is signed in to a private page.
  (
    jest.spyOn(
      StatusPageService,
      "findSignedInSession" as never,
    ) as unknown as jest.SpyInstance
  ).mockResolvedValue(null as never);

  (
    jest.spyOn(StatusPageService, "findOneBy") as unknown as jest.SpyInstance
  ).mockImplementation((args: unknown) => {
    const { query, select } = args as {
      query: Dictionary<unknown>;
      select: Dictionary<unknown>;
    };
    return Promise.resolve(readPage(String(query["_id"]), select));
  });

  (
    jest.spyOn(
      StatusPageService,
      "getStatusPageResources",
    ) as unknown as jest.SpyInstance
  ).mockImplementation((args: unknown) => {
    const { statusPageId } = args as { statusPageId: ObjectID };
    return Promise.resolve(resourcesOn(statusPageId.toString()));
  });

  (
    jest.spyOn(
      StatusPageService,
      "getMonitorIdsOnStatusPage",
    ) as unknown as jest.SpyInstance
  ).mockImplementation((args: unknown) => {
    const { statusPageId } = args as { statusPageId: ObjectID };
    return Promise.resolve({
      monitorsOnStatusPage: pageFixture(statusPageId.toString())
        ? PAGE_MONITORS.map((id: string): ObjectID => {
            return new ObjectID(id);
          })
        : [],
      monitorsInGroup: {},
    });
  });

  (
    jest.spyOn(
      StatusPageResourceService,
      "findBy",
    ) as unknown as jest.SpyInstance
  ).mockImplementation((args: unknown) => {
    const { query } = args as { query: Dictionary<unknown> };
    return Promise.resolve(resourcesOn(String(query["statusPageId"])));
  });

  for (const [service, method, value] of [
    [MonitorStatusService, "findBy", []],
    [StatusPageGroupService, "findBy", []],
    [MonitorGroupService, "getMonitorGroupResourcesByGroupIds", {}],
    [MonitorGroupService, "getCurrentStatusesForMonitorGroups", {}],
    [StatusPageService, "getMonitorStatusTimelineForStatusPage", []],
    [StatusPageHistoryChartBarColorRuleService, "findBy", []],
    [IncidentStateService, "findBy", []],
    [IncidentStateTimelineService, "findBy", []],
    [IncidentPublicNoteService, "findBy", []],
    [IncidentEpisodePublicNoteService, "findBy", []],
    [IncidentEpisodeStateTimelineService, "findBy", []],
  ] as Array<[unknown, string, unknown]>) {
    (
      jest.spyOn(
        service as never,
        method as never,
      ) as unknown as jest.SpyInstance
    ).mockResolvedValue(value as never);
  }

  (
    jest.spyOn(
      IncidentStateService,
      "getUnresolvedIncidentStates",
    ) as unknown as jest.SpyInstance
  ).mockResolvedValue([makeState()] as never);

  (
    jest.spyOn(IncidentService, "findBy") as unknown as jest.SpyInstance
  ).mockImplementation((args: unknown) => {
    const { query, select, sort, limit, skip } = args as {
      query: Dictionary<unknown>;
      select: Dictionary<unknown>;
      sort?: Dictionary<SortOrder>;
      limit: number;
      skip: number;
    };

    incidentReads.push({ query, select });

    return Promise.resolve(
      sortIncidents(
        INCIDENTS.filter((incident: IncidentFixture) => {
          return incidentMatches(incident, query);
        }),
        sort,
      )
        .slice(skip || 0, (skip || 0) + limit)
        .map((row: IncidentFixture): Incident => {
          return readIncident(row, select);
        }),
    );
  });

  // Nothing on a status page may read incidents without the scope helper.
  for (const method of ["findOneBy", "findAllBy", "countBy"]) {
    (
      jest.spyOn(
        IncidentService,
        method as never,
      ) as unknown as jest.SpyInstance
    ).mockImplementation(() => {
      throw new Error(`IncidentService.${method} is not expected here`);
    });
  }

  (
    jest.spyOn(
      IncidentEpisodeMemberService,
      "findBy",
    ) as unknown as jest.SpyInstance
  ).mockImplementation((args: unknown) => {
    const { query } = args as { query: Dictionary<unknown> };

    return Promise.resolve(
      members().filter((member: IncidentEpisodeMember): boolean => {
        if (query["incidentId"] !== undefined) {
          return matchesValue(
            member.incidentId!.toString(),
            query["incidentId"],
          );
        }

        return matchesValue(
          member.incidentEpisodeId!.toString(),
          query["incidentEpisodeId"],
        );
      }),
    );
  });

  (
    jest.spyOn(IncidentEpisodeService, "countBy") as unknown as jest.SpyInstance
  ).mockImplementation((args: unknown) => {
    const { query } = args as { query: Dictionary<unknown> };
    return Promise.resolve(
      new PositiveNumber(
        EPISODES.filter((episode: EpisodeFixture) => {
          return episodeMatches(episode, query);
        }).length,
      ),
    );
  });

  (
    jest.spyOn(IncidentEpisodeService, "findBy") as unknown as jest.SpyInstance
  ).mockImplementation((args: unknown) => {
    const { query } = args as { query: Dictionary<unknown> };
    return Promise.resolve(
      EPISODES.filter((episode: EpisodeFixture) => {
        return episodeMatches(episode, query);
      }).map(makeEpisode),
    );
  });
}

type RouteResult = {
  payload: JSONObject | null;
  error: unknown;
};

async function invokeRoute(data: {
  method?: "get" | "post";
  route: string;
  params: Dictionary<string>;
}): Promise<RouteResult> {
  const req: ExpressRequest = {
    params: data.params,
    body: {},
    query: {},
    cookies: {},
    headers: {},
    socket: {},
    ips: [],
  } as unknown as ExpressRequest;
  const res: ExpressResponse = {
    send: jest.fn(),
    json: jest.fn(),
    setHeader: jest.fn(),
    status: jest.fn().mockReturnThis(),
  } as unknown as ExpressResponse;
  const next: jest.Mock = jest.fn() as unknown as jest.Mock;
  const responseMock: jest.Mock =
    Response.sendJsonObjectResponse as unknown as jest.Mock;
  const previousResponseCount: number = responseMock.mock.calls.length;

  await mockRouter
    .match(data.method || "post", data.route)
    .handlerFunction(req, res, next as unknown as NextFunction);
  // Let the overview's detached cache-population chain settle.
  await new Promise<void>((resolve: () => void) => {
    setTimeout(resolve, 0);
  });

  if (next.mock.calls.length > 0) {
    return { payload: null, error: next.mock.calls[0]![0] };
  }

  const sent: Array<unknown> | undefined =
    responseMock.mock.calls[previousResponseCount];

  return {
    payload: sent ? (sent[2] as JSONObject) : null,
    error: undefined,
  };
}

async function getJson(data: {
  route: string;
  params: Dictionary<string>;
}): Promise<JSONObject> {
  const result: RouteResult = await invokeRoute(data);

  expect(result.error).toBeUndefined();
  expect(result.payload).not.toBeNull();
  return result.payload!;
}

function idOf(item: unknown): string {
  return String((item as JSONObject)["_id"]).toLowerCase();
}

function idsOf(items: unknown): Array<string> {
  return ((items as JSONArray) || []).map(idOf);
}

function sorted(ids: Array<string>): Array<string> {
  return [...ids].sort();
}

function find(items: unknown, id: string): JSONObject | undefined {
  return ((items as JSONArray) || []).find((item: unknown) => {
    return idOf(item) === id;
  }) as JSONObject | undefined;
}

// The incidents an episode of an answer lists, by id, in its order.
function listedIncidentIds(episode: JSONObject | undefined): Array<string> {
  return idsOf(episode?.[EPISODE_INCIDENTS_KEY]);
}

// Every key anywhere in a JSON value.
function allKeys(value: unknown, keys: Set<string> = new Set()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) {
      allKeys(item, keys);
    }
  } else if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(
      value as Record<string, unknown>,
    )) {
      keys.add(key);
      allKeys(child, keys);
    }
  }

  return keys;
}

function pageParams(pageId: string): Dictionary<string> {
  return { statusPageIdOrDomain: pageId };
}

describe("StatusPageAPI groups incidents by episode on the pages that ask for it", () => {
  beforeAll(() => {
    mockRouter.routes.length = 0;
    // Registers the routes on the mocked router.
    new StatusPageAPI();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    StatusPageAPI.clearOverviewResponseCache();
    incidentReads = [];
    mockDatabase();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    StatusPageAPI.clearOverviewResponseCache();
  });

  describe("each answer names the page's mode", () => {
    it.each([
      [GROUPED_PAGE, StatusPageIncidentListMode.GroupedByEpisode],
      [SEPARATE_PAGE, StatusPageIncidentListMode.Separate],
      [INCIDENTS_ONLY_PAGE, StatusPageIncidentListMode.IncidentsOnly],
      [EPISODES_ONLY_PAGE, StatusPageIncidentListMode.EpisodesOnly],
    ])(
      "the overview of %s says %s",
      async (pageId: string, mode: StatusPageIncidentListMode) => {
        const overview: JSONObject = await getJson({
          route: OVERVIEW_ROUTE,
          params: pageParams(pageId),
        });

        expect(overview[INCIDENT_LIST_MODE_RESPONSE_KEY]).toBe(mode);
      },
    );

    it.each(pageCases([GROUPED_PAGE, SEPARATE_PAGE, INCIDENTS_ONLY_PAGE]))(
      "the incident list of %s says the mode the overview does",
      async (_label: string, pageId: string) => {
        const overview: JSONObject = await getJson({
          route: OVERVIEW_ROUTE,
          params: pageParams(pageId),
        });
        const list: JSONObject = await getJson({
          route: INCIDENTS_ROUTE,
          params: pageParams(pageId),
        });

        expect(list[INCIDENT_LIST_MODE_RESPONSE_KEY]).toBe(
          overview[INCIDENT_LIST_MODE_RESPONSE_KEY],
        );
      },
    );

    it.each(pageCases([GROUPED_PAGE, SEPARATE_PAGE, EPISODES_ONLY_PAGE]))(
      "the episode list of %s says the mode the overview does",
      async (_label: string, pageId: string) => {
        const overview: JSONObject = await getJson({
          route: OVERVIEW_ROUTE,
          params: pageParams(pageId),
        });
        const list: JSONObject = await getJson({
          route: EPISODES_ROUTE,
          params: pageParams(pageId),
        });

        expect(list[INCIDENT_LIST_MODE_RESPONSE_KEY]).toBe(
          overview[INCIDENT_LIST_MODE_RESPONSE_KEY],
        );
      },
    );

    it("the overview's page carries its switch, for a reader that works the mode out itself", async () => {
      const grouped: JSONObject = await getJson({
        route: OVERVIEW_ROUTE,
        params: pageParams(GROUPED_PAGE),
      });
      const separate: JSONObject = await getJson({
        route: OVERVIEW_ROUTE,
        params: pageParams(SEPARATE_PAGE),
      });

      expect(
        (grouped["statusPage"] as JSONObject)["groupIncidentsByEpisode"],
      ).toBe(true);
      expect(
        (separate["statusPage"] as JSONObject)["groupIncidentsByEpisode"],
      ).toBe(false);
      expect(
        StatusPageIncidentGrouping.getMode(grouped["statusPage"] as JSONObject),
      ).toBe(StatusPageIncidentListMode.GroupedByEpisode);
    });
  });

  describe("the incident list keeps every incident the page shows", () => {
    it.each(pageCases([GROUPED_PAGE, SEPARATE_PAGE, INCIDENTS_ONLY_PAGE]))(
      "%s lists each incident it shows, in an episode or not",
      async (_label: string, pageId: string) => {
        const list: JSONObject = await getJson({
          route: INCIDENTS_ROUTE,
          params: pageParams(pageId),
        });

        expect(sorted(idsOf(list["incidents"]))).toEqual(
          sorted(SHOWN_INCIDENTS),
        );
      },
    );

    it.each(pageCases([GROUPED_PAGE, SEPARATE_PAGE, INCIDENTS_ONLY_PAGE]))(
      "%s names an incident's monitors only among its own: an internal monitor's id never leaves the server",
      async (_label: string, pageId: string) => {
        const list: JSONObject = await getJson({
          route: INCIDENTS_ROUTE,
          params: pageParams(pageId),
        });
        const overview: JSONObject = await getJson({
          route: OVERVIEW_ROUTE,
          params: pageParams(pageId),
        });

        for (const incidents of [
          list["incidents"],
          overview["activeIncidents"],
          overview["timelineIncidents"],
        ]) {
          expect(idsOf(find(incidents, OUTAGE_DATABASE)!["monitors"])).toEqual([
            DATABASE_MONITOR,
          ]);
        }

        expect(JSON.stringify(list)).not.toContain(INTERNAL_MONITOR);
        expect(JSON.stringify(overview)).not.toContain(INTERNAL_MONITOR);
      },
    );

    it("a page that shows episodes only refuses it, as it always did", async () => {
      const result: RouteResult = await invokeRoute({
        route: INCIDENTS_ROUTE,
        params: pageParams(EPISODES_ONLY_PAGE),
      });

      expect(result.error).toBeInstanceOf(BadDataException);
    });
  });

  describe("grouped by episode: the episode list", () => {
    it("lists an episode only when it holds an incident the page shows", async () => {
      const list: JSONObject = await getJson({
        route: EPISODES_ROUTE,
        params: pageParams(GROUPED_PAGE),
      });

      // Not the episode of hidden incidents only, nor a hidden episode.
      expect(sorted(idsOf(list["episodes"]))).toEqual(
        sorted([EPISODE_OUTAGE, EPISODE_MIXED]),
      );
    });

    it("an episode of three lists its three incidents, newest first", async () => {
      const list: JSONObject = await getJson({
        route: EPISODES_ROUTE,
        params: pageParams(GROUPED_PAGE),
      });

      expect(listedIncidentIds(find(list["episodes"], EPISODE_OUTAGE))).toEqual(
        [OUTAGE_DATABASE, OUTAGE_API, OUTAGE_WEBSITE],
      );
    });

    it("an episode lists none of its incidents the page does not show: private, on no monitor of the page, hidden", async () => {
      const list: JSONObject = await getJson({
        route: EPISODES_ROUTE,
        params: pageParams(GROUPED_PAGE),
      });

      const outage: Array<string> = listedIncidentIds(
        find(list["episodes"], EPISODE_OUTAGE),
      );

      expect(outage).not.toContain(OUTAGE_PRIVATE);
      expect(outage).not.toContain(OUTAGE_INTERNAL_ONLY);
      expect(listedIncidentIds(find(list["episodes"], EPISODE_MIXED))).toEqual([
        MIX_SHOWN,
      ]);
    });

    it("lists each incident with what its card shows, and nothing more", async () => {
      const list: JSONObject = await getJson({
        route: EPISODES_ROUTE,
        params: pageParams(GROUPED_PAGE),
      });

      const listed: JSONArray = find(list["episodes"], EPISODE_OUTAGE)![
        EPISODE_INCIDENTS_KEY
      ] as JSONArray;

      for (const item of listed) {
        const incident: JSONObject = item as JSONObject;

        expect(Object.keys(incident).sort()).toEqual(
          expect.arrayContaining([
            "_id",
            "title",
            "declaredAt",
            "incidentSeverity",
            "currentIncidentState",
            "monitors",
          ]),
        );
        expect(incident).not.toHaveProperty("description");
        expect(incident).not.toHaveProperty("postmortemNote");

        for (const column of INCIDENT_SCOPE_COLUMNS) {
          expect(incident).not.toHaveProperty(column);
        }
      }

      expect(
        listed.map((item: unknown): string => {
          return String((item as JSONObject)["title"]);
        }),
      ).toEqual([
        titleOf(OUTAGE_DATABASE),
        titleOf(OUTAGE_API),
        titleOf(OUTAGE_WEBSITE),
      ]);
    });

    it("names only the page's monitors: an incident's monitor no page lists never leaves the server", async () => {
      const list: JSONObject = await getJson({
        route: EPISODES_ROUTE,
        params: pageParams(GROUPED_PAGE),
      });

      const outage: JSONObject = find(list["episodes"], EPISODE_OUTAGE)!;

      expect(sorted(idsOf(outage["monitors"]))).toEqual(sorted(PAGE_MONITORS));

      const database: JSONObject = find(
        outage[EPISODE_INCIDENTS_KEY],
        OUTAGE_DATABASE,
      )!;

      expect(idsOf(database["monitors"])).toEqual([DATABASE_MONITOR]);
      expect(JSON.stringify(list)).not.toContain(INTERNAL_MONITOR);
    });

    it("an incident hidden from status pages names no resource on its episode's card", async () => {
      const list: JSONObject = await getJson({
        route: EPISODES_ROUTE,
        params: pageParams(GROUPED_PAGE),
      });

      // The hidden incident is on the API monitor; the shown one on the database.
      expect(idsOf(find(list["episodes"], EPISODE_MIXED)!["monitors"])).toEqual(
        [DATABASE_MONITOR],
      );
    });

    it("the cards: one incident on its own, an episode of three as one card, an incident whose episode is hidden on its own", async () => {
      const incidents: JSONObject = await getJson({
        route: INCIDENTS_ROUTE,
        params: pageParams(GROUPED_PAGE),
      });
      const episodes: JSONObject = await getJson({
        route: EPISODES_ROUTE,
        params: pageParams(GROUPED_PAGE),
      });

      const cards: StatusPageIncidentListCards<JSONObject, JSONObject> =
        StatusPageIncidentGrouping.getCards<JSONObject, JSONObject>({
          mode: StatusPageIncidentGrouping.readMode(
            episodes[INCIDENT_LIST_MODE_RESPONSE_KEY],
            StatusPageIncidentListMode.Separate,
          ),
          incidents: incidents["incidents"] as Array<JSONObject>,
          episodes: episodes["episodes"] as Array<JSONObject>,
          getIncidentId: idOf,
          getEpisodeIncidentIds: (episode: JSONObject): Array<string> => {
            return StatusPageIncidentGrouping.getEpisodeIncidentIdsFromJson(
              episode,
            );
          },
        });

      expect(sorted(idsOf(cards.incidents))).toEqual(
        sorted([LONE, UNDER_HIDDEN_EPISODE]),
      );
      expect(sorted(idsOf(cards.episodes))).toEqual(
        sorted([EPISODE_OUTAGE, EPISODE_MIXED]),
      );
    });
  });

  describe("pages that do not group keep what they show", () => {
    it.each(pageCases([SEPARATE_PAGE, EPISODES_ONLY_PAGE]))(
      "%s lists its episodes as it always did, without their incidents",
      async (_label: string, pageId: string) => {
        const list: JSONObject = await getJson({
          route: EPISODES_ROUTE,
          params: pageParams(pageId),
        });

        /*
         * An episode reaches the page through its incidents, hidden ones
         * too: its own switches decide whether it is shown.
         */
        expect(sorted(idsOf(list["episodes"]))).toEqual(
          sorted([EPISODE_OUTAGE, EPISODE_MIXED, EPISODE_HIDDEN_ONLY]),
        );

        for (const episode of list["episodes"] as JSONArray) {
          expect(episode as JSONObject).not.toHaveProperty(
            EPISODE_INCIDENTS_KEY,
          );
        }
      },
    );

    it.each(pageCases([SEPARATE_PAGE, EPISODES_ONLY_PAGE]))(
      "%s names an episode's resources from the incidents of it the page shows, as its overview always did",
      async (_label: string, pageId: string) => {
        const list: JSONObject = await getJson({
          route: EPISODES_ROUTE,
          params: pageParams(pageId),
        });

        expect(
          idsOf(find(list["episodes"], EPISODE_MIXED)!["monitors"]),
        ).toEqual([DATABASE_MONITOR]);
        expect(
          idsOf(find(list["episodes"], EPISODE_HIDDEN_ONLY)!["monitors"]),
        ).toEqual([]);
        expect(JSON.stringify(list)).not.toContain(INTERNAL_MONITOR);
      },
    );

    it("a page that shows incidents only refuses the episode list, as it always did", async () => {
      const result: RouteResult = await invokeRoute({
        route: EPISODES_ROUTE,
        params: pageParams(INCIDENTS_ONLY_PAGE),
      });

      expect(result.error).toBeInstanceOf(BadDataException);
    });
  });

  describe("the overview", () => {
    it("grouped, its active episodes list their incidents and leave out one of hidden incidents only", async () => {
      const overview: JSONObject = await getJson({
        route: OVERVIEW_ROUTE,
        params: pageParams(GROUPED_PAGE),
      });

      expect(sorted(idsOf(overview["activeEpisodes"]))).toEqual(
        sorted([EPISODE_OUTAGE, EPISODE_MIXED]),
      );
      expect(
        listedIncidentIds(find(overview["activeEpisodes"], EPISODE_OUTAGE)),
      ).toEqual([OUTAGE_DATABASE, OUTAGE_API, OUTAGE_WEBSITE]);
      expect(
        listedIncidentIds(find(overview["activeEpisodes"], EPISODE_MIXED)),
      ).toEqual([MIX_SHOWN]);
    });

    it("grouped, its active incidents are still every active incident the page shows", async () => {
      const overview: JSONObject = await getJson({
        route: OVERVIEW_ROUTE,
        params: pageParams(GROUPED_PAGE),
      });

      expect(sorted(idsOf(overview["activeIncidents"]))).toEqual(
        sorted(SHOWN_INCIDENTS),
      );
    });

    it("separate, its active episodes carry no incidents, as before", async () => {
      const overview: JSONObject = await getJson({
        route: OVERVIEW_ROUTE,
        params: pageParams(SEPARATE_PAGE),
      });

      expect(sorted(idsOf(overview["activeEpisodes"]))).toEqual(
        sorted([EPISODE_OUTAGE, EPISODE_MIXED]),
      );

      for (const episode of overview["activeEpisodes"] as JSONArray) {
        expect(episode as JSONObject).not.toHaveProperty(EPISODE_INCIDENTS_KEY);
      }
    });
  });

  describe("the uptime history's day details, in every mode", () => {
    it.each(pageCases([GROUPED_PAGE, SEPARATE_PAGE, INCIDENTS_ONLY_PAGE]))(
      "%s lists every incident it shows, whether or not it is in an episode",
      async (_label: string, pageId: string) => {
        const overview: JSONObject = await getJson({
          route: OVERVIEW_ROUTE,
          params: pageParams(pageId),
        });

        expect(sorted(idsOf(overview["timelineIncidents"]))).toEqual(
          sorted(SHOWN_INCIDENTS),
        );
        expect(overview[TIMELINE_EPISODES_RESPONSE_KEY]).toEqual([]);
      },
    );

    it('a page that shows episodes only lists, for each incident of a day, its episode: no more "No incidents"', async () => {
      const overview: JSONObject = await getJson({
        route: OVERVIEW_ROUTE,
        params: pageParams(EPISODES_ONLY_PAGE),
      });

      expect(overview["timelineIncidents"]).toEqual([]);

      const timelineEpisodes: JSONArray = overview[
        TIMELINE_EPISODES_RESPONSE_KEY
      ] as JSONArray;

      expect(sorted(idsOf(timelineEpisodes))).toEqual(
        sorted([EPISODE_OUTAGE, EPISODE_MIXED]),
      );

      const items: Array<UptimeBarTooltipIncident> =
        StatusPageTimelineEpisodes.toTooltipIncidents({
          timelineEpisodes: timelineEpisodes,
          translateSeverityName: (name: string): string => {
            return name;
          },
          translateStateName: (name: string): string => {
            return name;
          },
        });

      // One per shown incident of each episode, named and opened as the episode.
      expect(
        items
          .map((item: UptimeBarTooltipIncident): string => {
            return `${item.title} @ ${item.monitorIds
              .map((id: ObjectID): string => {
                return DISPLAY_NAMES[id.toString()] || id.toString();
              })
              .join(", ")}`;
          })
          .sort(),
      ).toEqual(
        [
          "Infrastructure Outage @ Storefront",
          "Infrastructure Outage @ Public API",
          "Infrastructure Outage @ Orders database",
          "Order processing slowdown @ Orders database",
        ].sort(),
      );

      for (const item of items) {
        expect([EPISODE_OUTAGE, EPISODE_MIXED]).toContain(item.id);
        expect(item.currentIncidentState?.name).toBe("Investigating");
        expect(item.incidentSeverity?.name).toBe("Major Incident");
      }

      // When each incident began: its own declaration.
      const outageTimes: Array<number> = items
        .filter((item: UptimeBarTooltipIncident): boolean => {
          return item.id === EPISODE_OUTAGE;
        })
        .map((item: UptimeBarTooltipIncident): number => {
          return new Date(item.declaredAt).getTime();
        })
        .sort();

      expect(outageTimes).toEqual(
        [OUTAGE_WEBSITE, OUTAGE_API, OUTAGE_DATABASE]
          .map((id: string): number => {
            return INCIDENTS.find((incident: IncidentFixture) => {
              return incident.id === id;
            })!.createdAt.getTime();
          })
          .sort(),
      );
    });

    it("an episodes-only page's day details name no incident: no id, no title, no hidden or private one", async () => {
      const overview: JSONObject = await getJson({
        route: OVERVIEW_ROUTE,
        params: pageParams(EPISODES_ONLY_PAGE),
      });

      const text: string = JSON.stringify(
        overview[TIMELINE_EPISODES_RESPONSE_KEY],
      );

      for (const incident of INCIDENTS) {
        expect(text).not.toContain(incident.id);
        expect(text).not.toContain(incident.title);
      }

      expect(text).not.toContain(INTERNAL_MONITOR);
      expect(text).not.toContain(episodeTitleOf(EPISODE_HIDDEN_ONLY));
      expect(text).not.toContain(episodeTitleOf(HIDDEN_EPISODE));
    });
  });

  describe("an incident's own page and an episode's", () => {
    it.each([
      [OUTAGE_WEBSITE, [EPISODE_OUTAGE]],
      [MIX_SHOWN, [EPISODE_MIXED]],
      [LONE, []],
      [UNDER_HIDDEN_EPISODE, []],
    ])(
      "grouped, incident %s names the episodes it is part of: %j",
      async (incidentId: string, episodeIds: Array<string>) => {
        const detail: JSONObject = await getJson({
          route: INCIDENT_DETAIL_ROUTE,
          params: {
            statusPageIdOrDomain: GROUPED_PAGE,
            incidentId: incidentId,
          },
        });

        expect(idsOf(detail[PART_OF_EPISODES_RESPONSE_KEY])).toEqual(
          episodeIds,
        );

        for (const episode of detail[
          PART_OF_EPISODES_RESPONSE_KEY
        ] as JSONArray) {
          expect((episode as JSONObject)["title"]).toBe(
            episodeTitleOf(idOf(episode)),
          );
        }
      },
    );

    it.each(pageCases([SEPARATE_PAGE, INCIDENTS_ONLY_PAGE]))(
      "%s names no episode on an incident's page, as it did before",
      async (_label: string, pageId: string) => {
        const detail: JSONObject = await getJson({
          route: INCIDENT_DETAIL_ROUTE,
          params: { statusPageIdOrDomain: pageId, incidentId: OUTAGE_WEBSITE },
        });

        expect(detail[PART_OF_EPISODES_RESPONSE_KEY]).toEqual([]);
      },
    );

    it("grouped, an episode opened by its link lists its incidents", async () => {
      const detail: JSONObject = await getJson({
        route: EPISODE_DETAIL_ROUTE,
        params: {
          statusPageIdOrDomain: GROUPED_PAGE,
          episodeId: EPISODE_OUTAGE,
        },
      });

      expect(idsOf(detail["episodes"])).toEqual([EPISODE_OUTAGE]);
      expect(
        listedIncidentIds(find(detail["episodes"], EPISODE_OUTAGE)),
      ).toEqual([OUTAGE_DATABASE, OUTAGE_API, OUTAGE_WEBSITE]);
    });

    it("grouped, an episode of hidden incidents only still opens by its link, listing nothing", async () => {
      // A subscriber told of it may follow the link in their message.
      const detail: JSONObject = await getJson({
        route: EPISODE_DETAIL_ROUTE,
        params: {
          statusPageIdOrDomain: GROUPED_PAGE,
          episodeId: EPISODE_HIDDEN_ONLY,
        },
      });

      const episode: JSONObject = find(
        detail["episodes"],
        EPISODE_HIDDEN_ONLY,
      )!;

      expect(listedIncidentIds(episode)).toEqual([]);
      expect(idsOf(episode["monitors"])).toEqual([]);
      expect(JSON.stringify(detail)).not.toContain(titleOf(QUIET_FIRST));
    });

    it("an episode hidden from status pages is not served by its link", async () => {
      const detail: JSONObject = await getJson({
        route: EPISODE_DETAIL_ROUTE,
        params: {
          statusPageIdOrDomain: GROUPED_PAGE,
          episodeId: HIDDEN_EPISODE,
        },
      });

      expect(detail["episodes"]).toEqual([]);
      expect(JSON.stringify(detail)).not.toContain(
        episodeTitleOf(HIDDEN_EPISODE),
      );
    });

    it("an episode none of whose incidents reaches the page is not found by its link", async () => {
      // An episode of the project's another page shows: none of its incidents is on this page.
      const result: RouteResult = await invokeRoute({
        route: EPISODE_DETAIL_ROUTE,
        params: {
          statusPageIdOrDomain: GROUPED_PAGE,
          episodeId: "e0000000-0000-4000-8000-0000000000ee",
        },
      });

      expect(result.error).toBeInstanceOf(NotFoundException);
    });
  });

  describe("a grouped page shows nothing it did not show before", () => {
    const views: Array<{
      name: string;
      route: string;
      params: Dictionary<string>;
    }> = [
      {
        name: "overview",
        route: OVERVIEW_ROUTE,
        params: pageParams(GROUPED_PAGE),
      },
      {
        name: "incident list",
        route: INCIDENTS_ROUTE,
        params: pageParams(GROUPED_PAGE),
      },
      {
        name: "episode list",
        route: EPISODES_ROUTE,
        params: pageParams(GROUPED_PAGE),
      },
      {
        name: "episode",
        route: EPISODE_DETAIL_ROUTE,
        params: {
          statusPageIdOrDomain: GROUPED_PAGE,
          episodeId: EPISODE_OUTAGE,
        },
      },
      {
        name: "incident",
        route: INCIDENT_DETAIL_ROUTE,
        params: {
          statusPageIdOrDomain: GROUPED_PAGE,
          incidentId: OUTAGE_API,
        },
      },
    ];

    it.each(
      views.map((view: { name: string }): [string] => {
        return [view.name];
      }),
    )(
      "the %s names no hidden, private or unlisted incident, no unlisted monitor and no scope",
      async (name: string) => {
        const view: { route: string; params: Dictionary<string> } = views.find(
          (item: { name: string }) => {
            return item.name === name;
          },
        )!;

        const payload: JSONObject = await getJson(view);
        const text: string = JSON.stringify(payload);

        for (const incidentId of NEVER_SHOWN_INCIDENTS) {
          expect(text).not.toContain(incidentId);
          expect(text).not.toContain(titleOf(incidentId));
        }

        expect(text).not.toContain(INTERNAL_MONITOR);
        expect(text).not.toContain(episodeTitleOf(HIDDEN_EPISODE));

        const keys: Set<string> = allKeys(payload);

        for (const column of INCIDENT_SCOPE_COLUMNS) {
          expect(keys.has(column)).toBe(false);
        }
      },
    );

    it("reads every incident of an episode through the page's visibility, privacy and monitors, in SQL", async () => {
      await getJson({
        route: EPISODES_ROUTE,
        params: pageParams(GROUPED_PAGE),
      });

      const memberReads: Array<IncidentRead> = incidentReads.filter(
        (read: IncidentRead) => {
          return "_id" in read.query;
        },
      );

      expect(memberReads.length).toBeGreaterThan(0);

      for (const read of memberReads) {
        expect(read.query["isVisibleOnStatusPage"]).toBe(true);
        expect(read.query).toHaveProperty("isPrivate");
        expect(sorted(toIdList(read.query["monitors"]))).toEqual(
          sorted(PAGE_MONITORS),
        );
      }
    });
  });

  describe("a private page keeps its own rules", () => {
    it.each([
      ["overview", OVERVIEW_ROUTE, pageParams(PRIVATE_PAGE)],
      ["incident list", INCIDENTS_ROUTE, pageParams(PRIVATE_PAGE)],
      ["episode list", EPISODES_ROUTE, pageParams(PRIVATE_PAGE)],
      [
        "episode",
        EPISODE_DETAIL_ROUTE,
        { statusPageIdOrDomain: PRIVATE_PAGE, episodeId: EPISODE_OUTAGE },
      ],
      [
        "incident",
        INCIDENT_DETAIL_ROUTE,
        { statusPageIdOrDomain: PRIVATE_PAGE, incidentId: OUTAGE_API },
      ],
    ])(
      "its %s is refused to a visitor who has not signed in, before any incident is read",
      async (_name: string, route: string, params: Dictionary<string>) => {
        const result: RouteResult = await invokeRoute({
          route: route,
          params: params,
        });

        expect(result.error).toBeInstanceOf(NotAuthenticatedException);
        expect(result.payload).toBeNull();
        expect(incidentReads).toEqual([]);
      },
    );
  });
});
