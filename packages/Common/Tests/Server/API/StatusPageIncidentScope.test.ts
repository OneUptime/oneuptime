import File from "../../../Models/DatabaseModels/File";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentEpisode from "../../../Models/DatabaseModels/IncidentEpisode";
import IncidentEpisodeMember from "../../../Models/DatabaseModels/IncidentEpisodeMember";
import IncidentEpisodePublicNote from "../../../Models/DatabaseModels/IncidentEpisodePublicNote";
import IncidentPublicNote from "../../../Models/DatabaseModels/IncidentPublicNote";
import IncidentState from "../../../Models/DatabaseModels/IncidentState";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import StatusPageResource from "../../../Models/DatabaseModels/StatusPageResource";
import StatusPageAPI from "../../../Server/API/StatusPageAPI";
import FileService from "../../../Server/Services/FileService";
import { FileOwners } from "../../../Server/Utils/File/FileOwnership";
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
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import Dictionary from "../../../Types/Dictionary";
import NotFoundException from "../../../Types/Exception/NotFoundException";
import { JSONArray, JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
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

/*
 * What a public status page shows of an incident limited to some status pages
 * (Incident.statusPages), and of the incidents a page that only shows those
 * (StatusPage.onlyShowScopedIncidents) leaves out - through every endpoint:
 * the overview (active incidents, the uptime bar's timeline incidents and
 * active episodes), the incident list and detail, the episode list and
 * detail, and the attachment downloads.
 *
 * The services behind StatusPageAPI are replaced by a small in-memory
 * database that answers each incident query the way Postgres would: the
 * page's monitors (the IncidentMonitor join), the scope split
 * (isScopedToStatusPages, and the IncidentStatusPage join for the scoped
 * half), visibility, project and ids - and returns only the columns a query
 * selects, as a real read does. So a code path that forgets to route through
 * IncidentStatusPageScope, or to select the page's onlyShowScopedIncidents,
 * shows up here as the wrong incidents on a page.
 *
 * The pages: Site A and Site B list the shared and the second monitor; Site
 * C lists the shared monitor and only shows incidents limited to it; Site D
 * lists nothing.
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
const POSTMORTEM_ATTACHMENT_ROUTE: string =
  "/status-page/incident/postmortem/attachment/:statusPageId/:incidentId/:fileId";
const INCIDENT_NOTE_ATTACHMENT_ROUTE: string =
  "/status-page/incident-public-note/attachment/:statusPageId/:incidentId/:noteId/:fileId";
const EPISODE_NOTE_ATTACHMENT_ROUTE: string =
  "/status-page/incident-episode-public-note/attachment/:statusPageId/:episodeId/:noteId/:fileId";

const PROJECT_ID: ObjectID = new ObjectID(
  "10000000-0000-4000-8000-000000000001",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "10000000-0000-4000-8000-000000000002",
);

const UNRESOLVED_STATE_ID: string = "20000000-0000-4000-8000-000000000001";

// The pages, by what they are.
const SITE_A: string = "b0000000-0000-4000-8000-00000000000a";
const SITE_B: string = "b0000000-0000-4000-8000-00000000000b";
// Only shows incidents limited to it.
const SITE_C: string = "b0000000-0000-4000-8000-00000000000c";
// Lists no monitor.
const SITE_D: string = "b0000000-0000-4000-8000-00000000000d";
// A status page that was deleted; an incident limited to it keeps the flag.
const DELETED_SITE: string = "b0000000-0000-4000-8000-0000000000ff";

const ALL_SITES: Array<string> = [SITE_A, SITE_B, SITE_C, SITE_D];

const SHARED_MONITOR: string = "c0000000-0000-4000-8000-000000000001";
const SECOND_MONITOR: string = "c0000000-0000-4000-8000-000000000002";

// The incidents, by where they are limited to.
const UNSCOPED: string = "a0000000-0000-4000-8000-000000000001";
const SCOPED_TO_A: string = "a0000000-0000-4000-8000-000000000002";
const SCOPED_TO_A_AND_C: string = "a0000000-0000-4000-8000-000000000003";
const SCOPED_TO_DELETED_PAGE: string = "a0000000-0000-4000-8000-000000000004";
const HIDDEN_SCOPED_TO_B: string = "a0000000-0000-4000-8000-000000000005";
// On the second monitor, limited to Site A: a member of a mixed episode.
const SECOND_SCOPED_TO_A: string = "a0000000-0000-4000-8000-000000000006";
const OTHER_PROJECT_INCIDENT: string = "a0000000-0000-4000-8000-000000000007";

const ALL_INCIDENTS: Array<string> = [
  UNSCOPED,
  SCOPED_TO_A,
  SCOPED_TO_A_AND_C,
  SCOPED_TO_DELETED_PAGE,
  HIDDEN_SCOPED_TO_B,
  SECOND_SCOPED_TO_A,
  OTHER_PROJECT_INCIDENT,
];

// The episodes, by their member incidents.
const EPISODE_SCOPED_TO_A: string = "e0000000-0000-4000-8000-000000000001";
const EPISODE_MIXED: string = "e0000000-0000-4000-8000-000000000002";
const EPISODE_SCOPED_TO_A_AND_C: string =
  "e0000000-0000-4000-8000-000000000003";
const EPISODE_NOWHERE: string = "e0000000-0000-4000-8000-000000000004";

const ALL_EPISODES: Array<string> = [
  EPISODE_SCOPED_TO_A,
  EPISODE_MIXED,
  EPISODE_SCOPED_TO_A_AND_C,
  EPISODE_NOWHERE,
];

/*
 * What each page shows. The same on every incident view (overview, list,
 * detail, timeline): every incident here is unresolved and recent.
 */
const INCIDENTS_SHOWN: Dictionary<Array<string>> = {
  [SITE_A]: [UNSCOPED, SCOPED_TO_A, SCOPED_TO_A_AND_C, SECOND_SCOPED_TO_A],
  [SITE_B]: [UNSCOPED],
  [SITE_C]: [SCOPED_TO_A_AND_C],
  [SITE_D]: [],
};

const EPISODES_SHOWN: Dictionary<Array<string>> = {
  [SITE_A]: [EPISODE_SCOPED_TO_A, EPISODE_MIXED, EPISODE_SCOPED_TO_A_AND_C],
  [SITE_B]: [EPISODE_MIXED],
  [SITE_C]: [EPISODE_SCOPED_TO_A_AND_C],
  [SITE_D]: [],
};

interface PageFixture {
  id: string;
  name: string;
  onlyShowScopedIncidents: boolean;
  monitorIds: Array<string>;
}

interface IncidentFixture {
  id: string;
  title: string;
  projectId: ObjectID;
  monitorIds: Array<string>;
  // null: not limited to any status page.
  scopedTo: Array<string> | null;
  isVisibleOnStatusPage: boolean;
  createdAt: Date;
}

interface EpisodeFixture {
  id: string;
  title: string;
  memberIncidentIds: Array<string>;
}

const PAGES: Array<PageFixture> = [
  {
    id: SITE_A,
    name: "Site A",
    onlyShowScopedIncidents: false,
    monitorIds: [SHARED_MONITOR, SECOND_MONITOR],
  },
  {
    id: SITE_B,
    name: "Site B",
    onlyShowScopedIncidents: false,
    monitorIds: [SHARED_MONITOR, SECOND_MONITOR],
  },
  {
    id: SITE_C,
    name: "Site C",
    onlyShowScopedIncidents: true,
    monitorIds: [SHARED_MONITOR],
  },
  {
    id: SITE_D,
    name: "Site D",
    onlyShowScopedIncidents: false,
    monitorIds: [],
  },
];

function hoursAgo(hours: number): Date {
  return new Date(Date.now() - hours * 60 * 60 * 1000);
}

const INCIDENTS: Array<IncidentFixture> = [
  {
    id: UNSCOPED,
    title: "Checkout is down everywhere",
    projectId: PROJECT_ID,
    monitorIds: [SHARED_MONITOR],
    scopedTo: null,
    isVisibleOnStatusPage: true,
    createdAt: hoursAgo(7),
  },
  {
    id: SCOPED_TO_A,
    title: "Checkout is down at Site A",
    projectId: PROJECT_ID,
    monitorIds: [SHARED_MONITOR],
    scopedTo: [SITE_A],
    isVisibleOnStatusPage: true,
    createdAt: hoursAgo(6),
  },
  {
    id: SCOPED_TO_A_AND_C,
    title: "Checkout is down at Sites A and C",
    projectId: PROJECT_ID,
    monitorIds: [SHARED_MONITOR],
    scopedTo: [SITE_A, SITE_C],
    isVisibleOnStatusPage: true,
    createdAt: hoursAgo(5),
  },
  {
    // Its only page was deleted; the join row went with it.
    id: SCOPED_TO_DELETED_PAGE,
    title: "Checkout is down at a closed site",
    projectId: PROJECT_ID,
    monitorIds: [SHARED_MONITOR],
    scopedTo: [],
    isVisibleOnStatusPage: true,
    createdAt: hoursAgo(4),
  },
  {
    id: HIDDEN_SCOPED_TO_B,
    title: "Checkout is down at Site B, not published",
    projectId: PROJECT_ID,
    monitorIds: [SHARED_MONITOR],
    scopedTo: [SITE_B],
    isVisibleOnStatusPage: false,
    createdAt: hoursAgo(3),
  },
  {
    id: SECOND_SCOPED_TO_A,
    title: "Payments are slow at Site A",
    projectId: PROJECT_ID,
    monitorIds: [SECOND_MONITOR],
    scopedTo: [SITE_A],
    isVisibleOnStatusPage: true,
    createdAt: hoursAgo(2),
  },
  {
    id: OTHER_PROJECT_INCIDENT,
    title: "Another project's outage",
    projectId: OTHER_PROJECT_ID,
    monitorIds: [SHARED_MONITOR],
    scopedTo: null,
    isVisibleOnStatusPage: true,
    createdAt: hoursAgo(1),
  },
];

const EPISODES: Array<EpisodeFixture> = [
  {
    id: EPISODE_SCOPED_TO_A,
    title: "Site A checkout episode",
    memberIncidentIds: [SCOPED_TO_A],
  },
  {
    id: EPISODE_MIXED,
    title: "Checkout and payments episode",
    memberIncidentIds: [UNSCOPED, SECOND_SCOPED_TO_A],
  },
  {
    id: EPISODE_SCOPED_TO_A_AND_C,
    title: "Sites A and C checkout episode",
    memberIncidentIds: [SCOPED_TO_A_AND_C],
  },
  {
    id: EPISODE_NOWHERE,
    title: "Closed site episode",
    memberIncidentIds: [SCOPED_TO_DELETED_PAGE],
  },
];

/*
 * Every incident and episode carries one public note with one attachment,
 * and every incident one postmortem attachment. Their ids are the owner's id
 * with one digit changed, so each is distinct and easy to trace back.
 */
function noteIdFor(id: string): string {
  return `${id.slice(0, 9)}9${id.slice(10)}`;
}

function fileIdFor(id: string): string {
  return `${id.slice(0, 10)}8${id.slice(11)}`;
}

function titleOf(incidentId: string): string {
  return INCIDENTS.find((incident: IncidentFixture) => {
    return incident.id === incidentId;
  })!.title;
}

function pageName(pageId: string): string {
  return (
    PAGES.find((page: PageFixture) => {
      return page.id === pageId;
    })?.name || "A deleted site"
  );
}

function episodeTitleOf(episodeId: string): string {
  return EPISODES.find((episode: EpisodeFixture) => {
    return episode.id === episodeId;
  })!.title;
}

// Test-table rows with a readable label first, for the tests' names.
function labelled<T extends Array<unknown>>(
  rows: Array<T>,
  label: (...row: T) => string,
): Array<[string, ...T]> {
  return rows.map((row: T): [string, ...T] => {
    return [label(...row), ...row];
  });
}

function pageCases(pageIds: Array<string>): Array<[string, string]> {
  return labelled(
    pageIds.map((pageId: string): [string] => {
      return [pageId];
    }),
    pageName,
  );
}

function shownLabel(shown: boolean): string {
  return shown ? "shown" : "not shown";
}

/*
 * The in-memory database's answers to a query: the few operators the status
 * page code uses (QueryHelper.any / inBetween build Raw operators whose
 * parameters are what they compare with).
 */
function operatorParameters(operator: unknown): Array<unknown> | null {
  const raw: { objectLiteralParameters?: Dictionary<unknown> } = operator as {
    objectLiteralParameters?: Dictionary<unknown>;
  };

  if (!raw || typeof raw !== "object" || !("objectLiteralParameters" in raw)) {
    return null;
  }

  return Object.values(raw.objectLiteralParameters || {});
}

function matchesValue(actual: unknown, expected: unknown): boolean {
  const parameters: Array<unknown> | null = operatorParameters(expected);

  if (parameters) {
    // QueryHelper.any([]) is TRUE = FALSE.
    if (parameters.length === 0) {
      return false;
    }

    // QueryHelper.any: IN (...).
    if (parameters.length === 1 && Array.isArray(parameters[0])) {
      return (parameters[0] as Array<unknown>)
        .map((value: unknown): string => {
          return String(value).toLowerCase();
        })
        .includes(String(actual).toLowerCase());
    }

    // QueryHelper.inBetween: two dates.
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
          return matchesValue(incident.projectId.toString(), expected);
        case "isVisibleOnStatusPage":
          return matchesValue(incident.isVisibleOnStatusPage, expected);
        case "showPostmortemOnStatusPage":
          return matchesValue(true, expected);
        case "isScopedToStatusPages":
          return matchesValue(incident.scopedTo !== null, expected);
        case "currentIncidentStateId":
          return matchesValue(UNRESOLVED_STATE_ID, expected);
        case "createdAt":
        case "declaredAt":
          return matchesValue(incident.createdAt, expected);
        case "monitors": {
          // The IncidentMonitor join.
          const monitorIds: Array<string> = toIdList(expected);
          return incident.monitorIds.some((id: string): boolean => {
            return monitorIds.includes(id);
          });
        }
        case "statusPages": {
          // The IncidentStatusPage join.
          const statusPageIds: Array<string> = toIdList(expected);
          return (incident.scopedTo || []).some((id: string): boolean => {
            return statusPageIds.includes(id);
          });
        }
        default:
          throw new Error(`Unexpected incident query key in a test: ${key}`);
      }
    },
  );
}

/*
 * The incident as a row of the database, with every column; a read returns
 * only what it selects of it.
 */
function incidentRow(fixture: IncidentFixture): Dictionary<unknown> {
  const postmortemAttachment: File = new File();
  postmortemAttachment._id = fileIdFor(fixture.id);
  postmortemAttachment.name = `postmortem-${fixture.id}.pdf`;
  postmortemAttachment.file = Buffer.from("postmortem");

  const monitors: Array<Monitor> = fixture.monitorIds.map(
    (monitorId: string): Monitor => {
      const monitor: Monitor = new Monitor();
      monitor._id = monitorId;
      return monitor;
    },
  );

  const statusPages: Array<StatusPage> = (fixture.scopedTo || []).map(
    (statusPageId: string): StatusPage => {
      const statusPage: StatusPage = new StatusPage();
      statusPage._id = statusPageId;
      statusPage.name = pageName(statusPageId);
      return statusPage;
    },
  );

  return {
    _id: fixture.id,
    projectId: fixture.projectId,
    title: fixture.title,
    description: `${fixture.title}, in detail`,
    createdAt: fixture.createdAt,
    declaredAt: fixture.createdAt,
    updatedAt: fixture.createdAt,
    isVisibleOnStatusPage: fixture.isVisibleOnStatusPage,
    showPostmortemOnStatusPage: true,
    postmortemNote: `${fixture.title}: what happened`,
    postmortemPostedAt: fixture.createdAt,
    postmortemAttachments: [postmortemAttachment],
    currentIncidentStateId: new ObjectID(UNRESOLVED_STATE_ID),
    currentIncidentState: makeState(),
    monitors: monitors,
    isScopedToStatusPages: fixture.scopedTo !== null,
    statusPages: statusPages,
    // The pages told about it when it was created: its scope.
    statusPagesNotifiedOnCreation: fixture.scopedTo || [],
  };
}

/*
 * When set, every incident read also returns the scope columns, whatever it
 * selected: the case the serializers' second line of defence is for.
 */
let leakScopeColumns: boolean = false;

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

  if (leakScopeColumns) {
    for (const column of INCIDENT_SCOPE_COLUMNS) {
      target[column] = row[column];
    }
  }

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

function makeState(): IncidentState {
  const state: IncidentState = new IncidentState();
  state._id = UNRESOLVED_STATE_ID;
  state.name = "Investigating";
  return state;
}

function pageFixture(pageId: string): PageFixture | undefined {
  return PAGES.find((page: PageFixture) => {
    return page.id === pageId.toString().toLowerCase();
  });
}

// A status page row, with only what the read selects.
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
    isPublicStatusPage: true,
    showIncidentsOnStatusPage: true,
    showEpisodesOnStatusPage: true,
    showIncidentHistoryInDays: 14,
    showEpisodeHistoryInDays: 14,
    showUptimeHistoryInDays: 14,
    onlyShowScopedIncidents: fixture.onlyShowScopedIncidents,
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
  return (pageFixture(pageId)?.monitorIds || []).map(
    (monitorId: string, index: number): StatusPageResource => {
      const resource: StatusPageResource = new StatusPageResource();
      resource._id = `${pageId.slice(0, -4)}${(1000 + index).toString()}`;
      resource.statusPageId = new ObjectID(pageId);
      resource.monitorId = new ObjectID(monitorId);
      resource.displayName = `Checkout ${index}`;
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
  episode.createdAt = hoursAgo(1);
  episode.declaredAt = hoursAgo(1);
  episode.currentIncidentState = makeState();
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
          return matchesValue(true, expected);
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
  limit: number;
};

let incidentReads: Array<IncidentRead> = [];

/*
 * Who each attachment belongs to: every file here was uploaded in the
 * project of the page that serves it, unless a test says otherwise.
 */
function mockFileOwners(projectId: ObjectID = PROJECT_ID): void {
  jest.spyOn(FileService, "getFileOwners").mockImplementation((async (
    fileIds: Array<ObjectID>,
  ): Promise<Map<string, FileOwners>> => {
    return new Map(
      fileIds.map((fileId: ObjectID): [string, FileOwners] => {
        return [
          fileId.toString().toLowerCase(),
          { projectId: projectId, createdByUserId: null },
        ];
      }),
    );
  }) as never);
}

function mockDatabase(): void {
  mockFileOwners();

  // The per-request read access check: every page here is public.
  (
    jest.spyOn(StatusPageService, "findOneById") as unknown as jest.SpyInstance
  ).mockImplementation((args: unknown) => {
    const { id } = args as { id: ObjectID };
    const page: StatusPage | null = readPage(id.toString(), {
      isPublicStatusPage: true,
    });
    return Promise.resolve(page);
  });

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
      monitorsOnStatusPage: (
        pageFixture(statusPageId.toString())?.monitorIds || []
      ).map((id: string): ObjectID => {
        return new ObjectID(id);
      }),
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

    incidentReads.push({ query, select, limit });

    const rows: Array<IncidentFixture> = sortIncidents(
      INCIDENTS.filter((incident: IncidentFixture) => {
        return incidentMatches(incident, query);
      }),
      sort,
    ).slice(skip || 0, (skip || 0) + limit);

    return Promise.resolve(
      rows.map((row: IncidentFixture): Incident => {
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
      IncidentPublicNoteService,
      "findBy",
    ) as unknown as jest.SpyInstance
  ).mockImplementation((args: unknown) => {
    const { query } = args as { query: Dictionary<unknown> };

    return Promise.resolve(
      INCIDENTS.filter((incident: IncidentFixture) => {
        return matchesValue(incident.id, query["incidentId"]);
      }).map((incident: IncidentFixture): IncidentPublicNote => {
        const note: IncidentPublicNote = new IncidentPublicNote();
        note._id = noteIdFor(incident.id);
        note.incidentId = new ObjectID(incident.id);
        note.note = `Update on ${incident.title}`;
        note.postedAt = incident.createdAt;
        return note;
      }),
    );
  });

  (
    jest.spyOn(
      IncidentPublicNoteService,
      "findOneBy",
    ) as unknown as jest.SpyInstance
  ).mockImplementation((args: unknown) => {
    const { query } = args as { query: Dictionary<unknown> };
    const incidentId: string = String(query["incidentId"]).toLowerCase();

    if (String(query["_id"]).toLowerCase() !== noteIdFor(incidentId)) {
      return Promise.resolve(null);
    }

    const attachment: File = new File();
    attachment._id = fileIdFor(noteIdFor(incidentId));
    attachment.name = "note.pdf";
    attachment.file = Buffer.from("note");

    const note: IncidentPublicNote = new IncidentPublicNote();
    note._id = noteIdFor(incidentId);
    note.attachments = [attachment];
    return Promise.resolve(note);
  });

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

  (
    jest.spyOn(
      IncidentEpisodeService,
      "findOneBy",
    ) as unknown as jest.SpyInstance
  ).mockImplementation((args: unknown) => {
    const { query } = args as { query: Dictionary<unknown> };
    const episode: EpisodeFixture | undefined = EPISODES.find(
      (fixture: EpisodeFixture) => {
        return episodeMatches(fixture, query);
      },
    );
    return Promise.resolve(episode ? makeEpisode(episode) : null);
  });

  (
    jest.spyOn(
      IncidentEpisodePublicNoteService,
      "findOneBy",
    ) as unknown as jest.SpyInstance
  ).mockImplementation((args: unknown) => {
    const { query } = args as { query: Dictionary<unknown> };
    const episodeId: string = String(query["incidentEpisodeId"]).toLowerCase();

    if (String(query["_id"]).toLowerCase() !== noteIdFor(episodeId)) {
      return Promise.resolve(null);
    }

    const attachment: File = new File();
    attachment._id = fileIdFor(noteIdFor(episodeId));
    attachment.name = "episode-note.pdf";
    attachment.file = Buffer.from("episode note");

    const note: IncidentEpisodePublicNote = new IncidentEpisodePublicNote();
    note._id = noteIdFor(episodeId);
    note.attachments = [attachment];
    return Promise.resolve(note);
  });
}

type RouteResult = {
  payload: JSONObject | null;
  error: unknown;
};

async function invokeRoute(data: {
  method: "get" | "post";
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
    .match(data.method, data.route)
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
  method?: "get" | "post";
  route: string;
  params: Dictionary<string>;
}): Promise<JSONObject> {
  const result: RouteResult = await invokeRoute({
    method: data.method || "post",
    route: data.route,
    params: data.params,
  });

  expect(result.error).toBeUndefined();
  expect(result.payload).not.toBeNull();
  return result.payload!;
}

function idsOf(items: unknown): Array<string> {
  return ((items as JSONArray) || [])
    .map((item: unknown): string => {
      return String((item as JSONObject)["_id"]).toLowerCase();
    })
    .sort();
}

function sorted(ids: Array<string>): Array<string> {
  return [...ids].sort();
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

// The monitors an episode is shown against, as the page's JSON has them.
function episodeMonitors(
  payload: JSONObject,
  key: string,
  id: string,
): Array<string> {
  const episode: JSONObject | undefined = (payload[key] as JSONArray).find(
    (item: unknown) => {
      return (item as JSONObject)["_id"] === id;
    },
  ) as JSONObject | undefined;

  return idsOf(episode?.["monitors"]);
}

describe("StatusPageAPI shows an incident only on the status pages in its scope", () => {
  let api: StatusPageAPI;

  beforeAll(() => {
    mockRouter.routes.length = 0;
    api = new StatusPageAPI();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    StatusPageAPI.clearOverviewResponseCache();
    leakScopeColumns = false;
    incidentReads = [];
    mockDatabase();
  });

  afterEach(() => {
    jest.restoreAllMocks();
    StatusPageAPI.clearOverviewResponseCache();
  });

  describe("the overview", () => {
    it.each(pageCases(ALL_SITES))(
      "shows %s only the active incidents in its scope",
      async (_page: string, pageId: string) => {
        const payload: JSONObject = await getJson({
          route: OVERVIEW_ROUTE,
          params: { statusPageIdOrDomain: pageId },
        });

        expect(idsOf(payload["activeIncidents"])).toEqual(
          sorted(INCIDENTS_SHOWN[pageId]!),
        );
      },
    );

    it.each(pageCases(ALL_SITES))(
      "names on %s's uptime bars only the incidents in its scope",
      async (_page: string, pageId: string) => {
        const payload: JSONObject = await getJson({
          route: OVERVIEW_ROUTE,
          params: { statusPageIdOrDomain: pageId },
        });

        expect(idsOf(payload["timelineIncidents"])).toEqual(
          sorted(INCIDENTS_SHOWN[pageId]!),
        );
      },
    );

    it.each(pageCases([SITE_A, SITE_B, SITE_C]))(
      "sends %s the public notes of only the incidents it shows",
      async (_page: string, pageId: string) => {
        const payload: JSONObject = await getJson({
          route: OVERVIEW_ROUTE,
          params: { statusPageIdOrDomain: pageId },
        });

        const notes: JSONArray = payload["incidentPublicNotes"] as JSONArray;
        expect(
          notes
            .map((note: unknown): string => {
              return String(
                ((note as JSONObject)["incidentId"] as JSONObject)?.["value"] ||
                  (note as JSONObject)["incidentId"],
              ).toLowerCase();
            })
            .sort(),
        ).toEqual(sorted(INCIDENTS_SHOWN[pageId]!));

        const text: string = JSON.stringify(payload);
        for (const incidentId of ALL_INCIDENTS) {
          if (!INCIDENTS_SHOWN[pageId]!.includes(incidentId)) {
            expect(text).not.toContain(titleOf(incidentId));
          }
        }
      },
    );

    it.each(pageCases(ALL_SITES))(
      "shows %s only the active episodes of incidents in its scope",
      async (_page: string, pageId: string) => {
        const payload: JSONObject = await getJson({
          route: OVERVIEW_ROUTE,
          params: { statusPageIdOrDomain: pageId },
        });

        expect(idsOf(payload["activeEpisodes"])).toEqual(
          sorted(EPISODES_SHOWN[pageId]!),
        );
      },
    );

    it("shows an episode against the monitors of only its members in the page's scope", async () => {
      const siteA: JSONObject = await getJson({
        route: OVERVIEW_ROUTE,
        params: { statusPageIdOrDomain: SITE_A },
      });
      expect(episodeMonitors(siteA, "activeEpisodes", EPISODE_MIXED)).toEqual(
        sorted([SHARED_MONITOR, SECOND_MONITOR]),
      );

      /*
       * Site B lists the second monitor too, but the incident on it is
       * limited to Site A: the episode is not shown against it on Site B.
       */
      const siteB: JSONObject = await getJson({
        route: OVERVIEW_ROUTE,
        params: { statusPageIdOrDomain: SITE_B },
      });
      expect(episodeMonitors(siteB, "activeEpisodes", EPISODE_MIXED)).toEqual([
        SHARED_MONITOR,
      ]);
    });

    it("does not send the page's onlyShowScopedIncidents, which it reads only to filter", async () => {
      const payload: JSONObject = await getJson({
        route: OVERVIEW_ROUTE,
        params: { statusPageIdOrDomain: SITE_C },
      });

      const statusPage: JSONObject = payload["statusPage"] as JSONObject;
      expect(statusPage["_id"]).toBe(SITE_C);
      expect(statusPage).not.toHaveProperty("onlyShowScopedIncidents");
      expect(statusPage).not.toHaveProperty("projectId");
    });

    it("keeps the scoped overview in its cache per page", async () => {
      const first: JSONObject = await getJson({
        method: "get",
        route: OVERVIEW_ROUTE,
        params: { statusPageIdOrDomain: SITE_B },
      });
      const second: JSONObject = await getJson({
        method: "post",
        route: OVERVIEW_ROUTE,
        params: { statusPageIdOrDomain: SITE_A },
      });
      const cachedB: JSONObject = await getJson({
        method: "post",
        route: OVERVIEW_ROUTE,
        params: { statusPageIdOrDomain: SITE_B },
      });

      expect(cachedB).toBe(first);
      expect(idsOf(cachedB["activeIncidents"])).toEqual([UNSCOPED]);
      expect(idsOf(second["activeIncidents"])).toEqual(
        sorted(INCIDENTS_SHOWN[SITE_A]!),
      );
    });
  });

  describe("the incident list and detail", () => {
    it.each(pageCases(ALL_SITES))(
      "lists on %s only the incidents in its scope",
      async (_page: string, pageId: string) => {
        const payload: JSONObject = await getJson({
          route: INCIDENTS_ROUTE,
          params: { statusPageIdOrDomain: pageId },
        });

        expect(idsOf(payload["incidents"])).toEqual(
          sorted(INCIDENTS_SHOWN[pageId]!),
        );
      },
    );

    it("lists incidents newest first across the unscoped and scoped halves", async () => {
      const payload: JSONObject = await getJson({
        route: INCIDENTS_ROUTE,
        params: { statusPageIdOrDomain: SITE_A },
      });

      expect(
        (payload["incidents"] as JSONArray).map((incident: unknown) => {
          return (incident as JSONObject)["_id"];
        }),
      ).toEqual([SECOND_SCOPED_TO_A, SCOPED_TO_A_AND_C, SCOPED_TO_A, UNSCOPED]);
    });

    const detailCases: Array<[string, string, boolean]> = ALL_SITES.flatMap(
      (pageId: string): Array<[string, string, boolean]> => {
        return ALL_INCIDENTS.map((incidentId: string) => {
          return [
            incidentId,
            pageId,
            INCIDENTS_SHOWN[pageId]!.includes(incidentId),
          ];
        });
      },
    );

    it.each(
      labelled(
        detailCases,
        (incidentId: string, pageId: string, shown: boolean): string => {
          return `"${titleOf(incidentId)}" on ${pageName(pageId)}: ${shownLabel(shown)}`;
        },
      ),
    )(
      "opens an incident only on the pages in its scope: %s",
      async (
        _label: string,
        incidentId: string,
        pageId: string,
        shown: boolean,
      ) => {
        const title: string = titleOf(incidentId);

        const payload: JSONObject = await getJson({
          route: INCIDENT_DETAIL_ROUTE,
          params: { statusPageIdOrDomain: pageId, incidentId: incidentId },
        });

        expect(idsOf(payload["incidents"])).toEqual(shown ? [incidentId] : []);

        if (!shown) {
          // Nothing of it: no note, no title.
          expect(payload["incidentPublicNotes"]).toEqual([]);
          expect(JSON.stringify(payload)).not.toContain(title);
        }
      },
    );
  });

  describe("the episode list and detail", () => {
    it.each(pageCases(ALL_SITES))(
      "lists on %s only the episodes of incidents in its scope",
      async (_page: string, pageId: string) => {
        const payload: JSONObject = await getJson({
          route: EPISODES_ROUTE,
          params: { statusPageIdOrDomain: pageId },
        });

        expect(idsOf(payload["episodes"])).toEqual(
          sorted(EPISODES_SHOWN[pageId]!),
        );
      },
    );

    const episodeCases: Array<[string, string, boolean]> = ALL_SITES.flatMap(
      (pageId: string): Array<[string, string, boolean]> => {
        return ALL_EPISODES.map((episodeId: string) => {
          return [
            episodeId,
            pageId,
            EPISODES_SHOWN[pageId]!.includes(episodeId),
          ];
        });
      },
    );

    it.each(
      labelled(
        episodeCases,
        (episodeId: string, pageId: string, shown: boolean): string => {
          return `"${episodeTitleOf(episodeId)}" on ${pageName(pageId)}: ${shown ? "shown" : "404"}`;
        },
      ),
    )(
      "opens an episode by id only on a page one of its incidents is in the scope of: %s",
      async (
        _label: string,
        episodeId: string,
        pageId: string,
        shown: boolean,
      ) => {
        const result: RouteResult = await invokeRoute({
          method: "post",
          route: EPISODE_DETAIL_ROUTE,
          params: { statusPageIdOrDomain: pageId, episodeId: episodeId },
        });

        if (shown) {
          expect(result.error).toBeUndefined();
          expect(idsOf(result.payload!["episodes"])).toEqual([episodeId]);
          return;
        }

        expect(result.error).toBeInstanceOf(NotFoundException);
        expect((result.error as NotFoundException).message).toBe(
          "Episode not found",
        );
        expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
      },
    );

    it("returns 404 for an episode that does not exist", async () => {
      const result: RouteResult = await invokeRoute({
        method: "post",
        route: EPISODE_DETAIL_ROUTE,
        params: {
          statusPageIdOrDomain: SITE_A,
          episodeId: "e0000000-0000-4000-8000-0000000000ee",
        },
      });

      expect(result.error).toBeInstanceOf(NotFoundException);
    });

    it("shows an episode opened by id against the monitors of only its members in the page's scope", async () => {
      const siteA: JSONObject = await getJson({
        route: EPISODE_DETAIL_ROUTE,
        params: { statusPageIdOrDomain: SITE_A, episodeId: EPISODE_MIXED },
      });
      expect(episodeMonitors(siteA, "episodes", EPISODE_MIXED)).toEqual(
        sorted([SHARED_MONITOR, SECOND_MONITOR]),
      );

      const siteB: JSONObject = await getJson({
        route: EPISODE_DETAIL_ROUTE,
        params: { statusPageIdOrDomain: SITE_B, episodeId: EPISODE_MIXED },
      });
      expect(episodeMonitors(siteB, "episodes", EPISODE_MIXED)).toEqual([
        SHARED_MONITOR,
      ]);
    });

    it("checks an episode opened by id against the page's monitors and scope, with no history window", async () => {
      await getJson({
        route: EPISODE_DETAIL_ROUTE,
        params: { statusPageIdOrDomain: SITE_B, episodeId: EPISODE_MIXED },
      });

      const check: Array<IncidentRead> = incidentReads.filter(
        (read: IncidentRead) => {
          return (
            read.limit === 1 &&
            "monitors" in read.query &&
            !("createdAt" in read.query)
          );
        },
      );

      // Both halves: unscoped, and limited to Site B.
      expect(
        check.map((read: IncidentRead) => {
          return read.query["isScopedToStatusPages"];
        }),
      ).toEqual([false, true]);
      expect(check[1]!.query["statusPages"]).toEqual([SITE_B]);
      expect(toIdList(check[0]!.query["monitors"]).sort()).toEqual(
        sorted([SHARED_MONITOR, SECOND_MONITOR]),
      );
    });
  });

  describe("attachments", () => {
    async function download(data: {
      route: string;
      params: Dictionary<string>;
    }): Promise<RouteResult> {
      return await invokeRoute({
        method: "get",
        route: data.route,
        params: data.params,
      });
    }

    function expectServed(result: RouteResult, fileId: string): void {
      expect(result.error).toBeUndefined();
      const sendFile: jest.Mock =
        Response.sendFileResponse as unknown as jest.Mock;
      expect(sendFile).toHaveBeenCalledTimes(1);
      expect((sendFile.mock.calls[0]![2] as File)._id).toBe(fileId);
    }

    function expectNotFound(result: RouteResult): void {
      expect(result.error).toBeInstanceOf(NotFoundException);
      expect(Response.sendFileResponse).not.toHaveBeenCalled();
    }

    const postmortemCases: Array<[string, string, boolean]> = [
      [SCOPED_TO_A, SITE_A, true],
      [SCOPED_TO_A, SITE_B, false],
      [SCOPED_TO_A, SITE_C, false],
      [SCOPED_TO_A_AND_C, SITE_C, true],
      [UNSCOPED, SITE_B, true],
      [UNSCOPED, SITE_C, false],
      [SCOPED_TO_DELETED_PAGE, SITE_A, false],
    ];

    function incidentAttachmentLabel(
      incidentId: string,
      pageId: string,
      served: boolean,
    ): string {
      return `"${titleOf(incidentId)}" on ${pageName(pageId)}: ${served ? "served" : "404"}`;
    }

    it.each(labelled(postmortemCases, incidentAttachmentLabel))(
      "serves an incident's postmortem attachment only on the pages in its scope: %s",
      async (
        _label: string,
        incidentId: string,
        pageId: string,
        served: boolean,
      ) => {
        const result: RouteResult = await download({
          route: POSTMORTEM_ATTACHMENT_ROUTE,
          params: {
            statusPageId: pageId,
            incidentId: incidentId,
            fileId: fileIdFor(incidentId),
          },
        });

        if (served) {
          expectServed(result, fileIdFor(incidentId));
        } else {
          expectNotFound(result);
        }
      },
    );

    it.each(labelled(postmortemCases, incidentAttachmentLabel))(
      "serves an incident's public note attachment only on the pages in its scope: %s",
      async (
        _label: string,
        incidentId: string,
        pageId: string,
        served: boolean,
      ) => {
        const result: RouteResult = await download({
          route: INCIDENT_NOTE_ATTACHMENT_ROUTE,
          params: {
            statusPageId: pageId,
            incidentId: incidentId,
            noteId: noteIdFor(incidentId),
            fileId: fileIdFor(noteIdFor(incidentId)),
          },
        });

        if (served) {
          expectServed(result, fileIdFor(noteIdFor(incidentId)));
        } else {
          expectNotFound(result);
        }
      },
    );

    const episodeNoteCases: Array<[string, string, boolean]> = [
      [EPISODE_SCOPED_TO_A, SITE_A, true],
      [EPISODE_SCOPED_TO_A, SITE_B, false],
      [EPISODE_MIXED, SITE_B, true],
      [EPISODE_MIXED, SITE_C, false],
      [EPISODE_SCOPED_TO_A_AND_C, SITE_C, true],
      [EPISODE_NOWHERE, SITE_A, false],
    ];

    it.each(
      labelled(
        episodeNoteCases,
        (episodeId: string, pageId: string, served: boolean): string => {
          return `"${episodeTitleOf(episodeId)}" on ${pageName(pageId)}: ${served ? "served" : "404"}`;
        },
      ),
    )(
      "serves an episode's public note attachment only on a page one of its incidents is in the scope of: %s",
      async (
        _label: string,
        episodeId: string,
        pageId: string,
        served: boolean,
      ) => {
        const result: RouteResult = await download({
          route: EPISODE_NOTE_ATTACHMENT_ROUTE,
          params: {
            statusPageId: pageId,
            episodeId: episodeId,
            noteId: noteIdFor(episodeId),
            fileId: fileIdFor(noteIdFor(episodeId)),
          },
        });

        if (served) {
          expectServed(result, fileIdFor(noteIdFor(episodeId)));
        } else {
          expectNotFound(result);
        }
      },
    );

    /*
     * A page serves only files of its own project, whatever wrote the
     * record that points at them - answered exactly as an attachment that
     * is not there.
     */
    it("never serves an attachment that is a file of another project", async () => {
      mockFileOwners(OTHER_PROJECT_ID);

      const postmortem: RouteResult = await download({
        route: POSTMORTEM_ATTACHMENT_ROUTE,
        params: {
          statusPageId: SITE_A,
          incidentId: SCOPED_TO_A,
          fileId: fileIdFor(SCOPED_TO_A),
        },
      });

      expectNotFound(postmortem);

      const note: RouteResult = await download({
        route: INCIDENT_NOTE_ATTACHMENT_ROUTE,
        params: {
          statusPageId: SITE_A,
          incidentId: SCOPED_TO_A,
          noteId: noteIdFor(SCOPED_TO_A),
          fileId: fileIdFor(noteIdFor(SCOPED_TO_A)),
        },
      });

      expectNotFound(note);

      const episodeNote: RouteResult = await download({
        route: EPISODE_NOTE_ATTACHMENT_ROUTE,
        params: {
          statusPageId: SITE_A,
          episodeId: EPISODE_SCOPED_TO_A,
          noteId: noteIdFor(EPISODE_SCOPED_TO_A),
          fileId: fileIdFor(noteIdFor(EPISODE_SCOPED_TO_A)),
        },
      });

      expectNotFound(episodeNote);
    });
  });

  describe("the public JSON never names an incident's scope", () => {
    type View = {
      name: string;
      route: string;
      params: (pageId: string) => Dictionary<string>;
      // An id the view shows on Sites A and C.
      shows: string;
    };

    const views: Array<View> = [
      {
        name: "overview",
        route: OVERVIEW_ROUTE,
        params: (pageId: string) => {
          return { statusPageIdOrDomain: pageId };
        },
        shows: SCOPED_TO_A_AND_C,
      },
      {
        name: "incident list",
        route: INCIDENTS_ROUTE,
        params: (pageId: string) => {
          return { statusPageIdOrDomain: pageId };
        },
        shows: SCOPED_TO_A_AND_C,
      },
      {
        name: "incident detail",
        route: INCIDENT_DETAIL_ROUTE,
        params: (pageId: string) => {
          return {
            statusPageIdOrDomain: pageId,
            incidentId: SCOPED_TO_A_AND_C,
          };
        },
        shows: SCOPED_TO_A_AND_C,
      },
      {
        name: "episode list",
        route: EPISODES_ROUTE,
        params: (pageId: string) => {
          return { statusPageIdOrDomain: pageId };
        },
        shows: EPISODE_SCOPED_TO_A_AND_C,
      },
      {
        name: "episode detail",
        route: EPISODE_DETAIL_ROUTE,
        params: (pageId: string) => {
          return {
            statusPageIdOrDomain: pageId,
            episodeId: EPISODE_SCOPED_TO_A_AND_C,
          };
        },
        shows: EPISODE_SCOPED_TO_A_AND_C,
      },
    ];

    const cases: Array<[string, string, boolean]> = views.flatMap(
      (view: View): Array<[string, string, boolean]> => {
        return [SITE_A, SITE_C].flatMap(
          (pageId: string): Array<[string, string, boolean]> => {
            return [
              [view.name, pageId, false],
              [view.name, pageId, true],
            ];
          },
        );
      },
    );

    it.each(
      labelled(
        cases,
        (viewName: string, pageId: string, leak: boolean): string => {
          return `the ${viewName} of ${pageName(pageId)}${leak ? ", even when every read returns the scope columns" : ""}`;
        },
      ),
    )(
      "has no scope column: %s",
      async (
        _label: string,
        viewName: string,
        pageId: string,
        leak: boolean,
      ) => {
        leakScopeColumns = leak;

        const view: View = views.find((item: View) => {
          return item.name === viewName;
        })!;

        const payload: JSONObject = await getJson({
          route: view.route,
          params: view.params(pageId),
        });

        const keys: Set<string> = allKeys(payload);

        for (const column of INCIDENT_SCOPE_COLUMNS) {
          expect(keys.has(column)).toBe(false);
        }

        // Nor the other pages an incident on this page is limited to.
        const text: string = JSON.stringify(payload);

        for (const otherPage of [...ALL_SITES, DELETED_SITE]) {
          if (otherPage !== pageId) {
            expect(text).not.toContain(otherPage);
            expect(text).not.toContain(`"${pageName(otherPage)}"`);
          }
        }

        // The page still shows what it should.
        expect(text).toContain(view.shows);
      },
    );

    it("no status page read selects an incident's scope columns except the episode members it filters", async () => {
      for (const pageId of ALL_SITES) {
        for (const view of views) {
          await invokeRoute({
            method: "post",
            route: view.route,
            params: view.params(pageId),
          });
        }
      }

      const readsWithScope: Array<IncidentRead> = incidentReads.filter(
        (read: IncidentRead) => {
          return INCIDENT_SCOPE_COLUMNS.some((column: string) => {
            return Boolean(read.select[column]);
          });
        },
      );

      expect(readsWithScope.length).toBeGreaterThan(0);

      for (const read of readsWithScope) {
        // An episode's members, read by id to map it to the page's monitors.
        expect(Object.keys(read.query).sort()).toEqual(
          expect.arrayContaining(["_id", "projectId"]),
        );
        expect(read.query).not.toHaveProperty("monitors");
        expect(read.select).toHaveProperty("monitors");
        expect(read.select).not.toHaveProperty("title");
        expect(read.select).not.toHaveProperty("statusPagesNotifiedOnCreation");
      }
    });
  });

  describe("the scope is applied in SQL, before the cap", () => {
    it("every incident read by a page's monitors is split on isScopedToStatusPages, each half up to LIMIT_PER_PROJECT", async () => {
      for (const pageId of [SITE_A, SITE_C]) {
        await getJson({
          route: OVERVIEW_ROUTE,
          params: { statusPageIdOrDomain: pageId },
        });
        await getJson({
          route: INCIDENTS_ROUTE,
          params: { statusPageIdOrDomain: pageId },
        });
        await getJson({
          route: EPISODES_ROUTE,
          params: { statusPageIdOrDomain: pageId },
        });
      }

      const byMonitors: Array<IncidentRead> = incidentReads.filter(
        (read: IncidentRead) => {
          return "monitors" in read.query;
        },
      );

      expect(byMonitors.length).toBeGreaterThan(0);

      for (const read of byMonitors) {
        expect(typeof read.query["isScopedToStatusPages"]).toBe("boolean");
        expect(read.limit).toBe(LIMIT_PER_PROJECT);

        if (read.query["isScopedToStatusPages"] === true) {
          expect(read.query["statusPages"]).toHaveLength(1);
        } else {
          expect(read.query).not.toHaveProperty("statusPages");
        }
      }

      // Site C only shows scoped incidents: it never asks for unscoped ones.
      const unscopedOnSiteC: Array<IncidentRead> = byMonitors.filter(
        (read: IncidentRead) => {
          return (
            read.query["isScopedToStatusPages"] === false &&
            toIdList(read.query["monitors"]).length === 1
          );
        },
      );
      expect(unscopedOnSiteC).toEqual([]);
    });
  });

  describe("the episode member filter", () => {
    type MemberFilter = (data: {
      incidents: Array<Incident>;
      statusPage: StatusPage;
    }) => Array<Incident>;

    function filterMembers(
      pageId: string,
      select: Dictionary<unknown>,
    ): Array<Incident> {
      const filter: MemberFilter = (
        api as unknown as { keepMemberIncidentsInScope: MemberFilter }
      ).keepMemberIncidentsInScope.bind(api);

      return filter({
        incidents: INCIDENTS.map((fixture: IncidentFixture): Incident => {
          return readIncident(fixture, {
            _id: true,
            monitors: true,
            isScopedToStatusPages: true,
            statusPages: true,
            statusPagesNotifiedOnCreation: true,
          });
        }),
        statusPage: readPage(pageId, select)!,
      });
    }

    it.each(
      labelled<[string, Array<string>]>(
        [
          [
            SITE_A,
            [
              UNSCOPED,
              SCOPED_TO_A,
              SCOPED_TO_A_AND_C,
              SECOND_SCOPED_TO_A,
              OTHER_PROJECT_INCIDENT,
            ],
          ],
          // Visibility and project are the member query's to filter, not scope.
          [SITE_B, [UNSCOPED, HIDDEN_SCOPED_TO_B, OTHER_PROJECT_INCIDENT]],
          [SITE_C, [SCOPED_TO_A_AND_C]],
        ] as Array<[string, Array<string>]>,
        (pageId: string): string => {
          return pageName(pageId);
        },
      ),
    )(
      "keeps the members %s shows as far as scope goes",
      (_page: string, pageId: string, expected: Array<string>) => {
        expect(
          filterMembers(pageId, { onlyShowScopedIncidents: true }).map(
            (incident: Incident): string => {
              return incident._id!;
            },
          ),
        ).toEqual(expected);
      },
    );

    it("keeps no unscoped member for a page whose onlyShowScopedIncidents was not loaded", () => {
      expect(
        filterMembers(SITE_B, {}).map((incident: Incident): string => {
          return incident._id!;
        }),
      ).toEqual([HIDDEN_SCOPED_TO_B]);
    });

    it("removes the scope columns from what it keeps, and leaves the monitors", () => {
      const kept: Array<Incident> = filterMembers(SITE_A, {
        onlyShowScopedIncidents: true,
      });

      expect(kept.length).toBeGreaterThan(0);

      for (const incident of kept) {
        for (const column of INCIDENT_SCOPE_COLUMNS) {
          expect(incident).not.toHaveProperty(column);
        }

        expect(incident.monitors!.length).toBeGreaterThan(0);
      }
    });
  });
});
