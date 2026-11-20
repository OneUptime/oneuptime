import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * PublicNoteReachBuilder: whether a public note posted now on an incident,
 * an episode or a maintenance event is on a status page, and whether it
 * notifies anyone - or why not (#9735). The note composer says it: "Visible
 * on your status page" and "Subscribers will be notified" only while they
 * are true, and why not otherwise.
 *
 * It runs for real down to the services - the audience builder, the scope
 * helper (IncidentStatusPageScope), the notification preview's reason
 * (#9684) - over a small project held in memory: incidents, episodes,
 * maintenance events and status pages, and which of them the caller may
 * read. What is pinned, for each kind of event:
 *
 *   - shown and notifies; shown, every page that shows it switched off; not
 *     shown (no page lists it, the scope leaves it out, the pages hide that
 *     kind of event, no page picked); no monitors; hidden; not published yet;
 *   - every page the event reaches counts, one the caller cannot read
 *     included, and the answer names none;
 *   - another project's page never counts, nor an archived one;
 *   - the event is read with the caller's own permissions first: another
 *     project's, and one the caller may not read, are not found;
 *   - an incident's answer is its notification preview's for a note, so the
 *     composer and the preview never disagree;
 *   - who may ask is decided for the event, as posting a note on it or
 *     editing one of its notes is: never by the table's permissions alone
 *     (Tests/Server/Utils/Permission/TableHalfWriteGuard).
 */

jest.mock("../../../../Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
  };
});

import Incident from "../../../../Models/DatabaseModels/Incident";
import IncidentEpisode from "../../../../Models/DatabaseModels/IncidentEpisode";
import IncidentEpisodeMember from "../../../../Models/DatabaseModels/IncidentEpisodeMember";
import IncidentEpisodePublicNote from "../../../../Models/DatabaseModels/IncidentEpisodePublicNote";
import IncidentPublicNote from "../../../../Models/DatabaseModels/IncidentPublicNote";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import ScheduledMaintenance from "../../../../Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenancePublicNote from "../../../../Models/DatabaseModels/ScheduledMaintenancePublicNote";
import StatusPage from "../../../../Models/DatabaseModels/StatusPage";
import StatusPageResource from "../../../../Models/DatabaseModels/StatusPageResource";
import IncidentEpisodeMemberService from "../../../../Server/Services/IncidentEpisodeMemberService";
import IncidentEpisodePublicNoteService from "../../../../Server/Services/IncidentEpisodePublicNoteService";
import IncidentEpisodeService from "../../../../Server/Services/IncidentEpisodeService";
import IncidentPublicNoteService from "../../../../Server/Services/IncidentPublicNoteService";
import IncidentService from "../../../../Server/Services/IncidentService";
import ScheduledMaintenancePublicNoteService from "../../../../Server/Services/ScheduledMaintenancePublicNoteService";
import ScheduledMaintenanceService from "../../../../Server/Services/ScheduledMaintenanceService";
import StatusPageResourceService from "../../../../Server/Services/StatusPageResourceService";
import StatusPageService from "../../../../Server/Services/StatusPageService";
import StatusPageSubscriberService from "../../../../Server/Services/StatusPageSubscriberService";
import CreateScopeException from "../../../../Server/Types/Database/Permissions/CreateScopeException";
import ModelPermission from "../../../../Server/Types/Database/Permissions/Index";
import { UnreadableParentException } from "../../../../Server/Utils/Database/ProjectScopedReferenceRefusal";
import PublicNoteReachBuilder from "../../../../Server/Utils/StatusPage/PublicNoteReachBuilder";
import SubscriberNotificationPreviewBuilder from "../../../../Server/Utils/StatusPage/SubscriberNotificationPreviewBuilder";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Dictionary from "../../../../Types/Dictionary";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import NotFoundException from "../../../../Types/Exception/NotFoundException";
import PaymentRequiredException from "../../../../Types/Exception/PaymentRequiredException";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../../Types/Permission";
import { IncidentSubscriberAudienceCounts } from "../../../../Types/StatusPage/IncidentSubscriberAudience";
import PublicNoteReach, {
  PublicNoteNothingSentReason,
  PublicNoteReachEvent,
  PublicNoteReachResult,
} from "../../../../Types/StatusPage/PublicNoteReach";
import {
  SubscriberNotificationPreviewEvent,
  SubscriberNotificationPreviewNothingSentReason,
} from "../../../../Types/StatusPage/SubscriberNotificationPreview";

const PROJECT_ID: ObjectID = new ObjectID(
  "10000000-0000-4000-8000-000000000001",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "10000000-0000-4000-8000-000000000002",
);
const USER_ID: ObjectID = new ObjectID("20000000-0000-4000-8000-000000000001");

const INCIDENT: string = "a0000000-0000-4000-8000-000000000001";
const SECOND_INCIDENT: string = "a0000000-0000-4000-8000-000000000002";
const EPISODE: string = "e0000000-0000-4000-8000-000000000001";
const MAINTENANCE: string = "f0000000-0000-4000-8000-000000000001";

const MONITOR_A: string = "c0000000-0000-4000-8000-00000000000a";
const MONITOR_B: string = "c0000000-0000-4000-8000-00000000000b";

const SITE_1: string = "b0000000-0000-4000-8000-000000000001";
const SITE_2: string = "b0000000-0000-4000-8000-000000000002";
const SITE_3: string = "b0000000-0000-4000-8000-000000000003";

interface PageRow {
  id: string;
  name: string;
  projectId: ObjectID;
  // The monitors it lists.
  monitors: Array<string>;
  showIncidents: boolean;
  showEpisodes: boolean;
  showMaintenance: boolean;
  sendNotifications: boolean;
  onlyShowScopedIncidents: boolean;
  isArchived: boolean;
}

interface IncidentRow {
  id: string;
  projectId: ObjectID;
  monitors: Array<string>;
  isVisibleOnStatusPage: boolean;
  isPrivate: boolean;
  // The pages it is limited to; null is unscoped.
  scope: Array<string> | null;
}

interface EpisodeRow {
  id: string;
  projectId: ObjectID;
  isVisibleOnStatusPage: boolean;
  isPrivate: boolean;
  incidentIds: Array<string>;
}

interface MaintenanceRow {
  id: string;
  projectId: ObjectID;
  isVisibleOnStatusPage: boolean;
  publishOnStatusPageAt: Date | null;
  statusPageIds: Array<string>;
}

let pages: Dictionary<PageRow> = {};
let incidents: Dictionary<IncidentRow> = {};
let episodes: Dictionary<EpisodeRow> = {};
let maintenanceEvents: Dictionary<MaintenanceRow> = {};
// What the caller may read with their own permissions; null pages: all.
let readablePageIds: Array<string> | null = null;
let readableEventIds: Array<string> = [];

function page(id: string, overrides: Partial<PageRow> = {}): PageRow {
  return {
    id: id,
    name: `Site ${id.slice(-2)}`,
    projectId: PROJECT_ID,
    monitors: [MONITOR_A],
    showIncidents: true,
    showEpisodes: true,
    showMaintenance: true,
    sendNotifications: true,
    onlyShowScopedIncidents: false,
    isArchived: false,
    ...overrides,
  };
}

function setPages(...rows: Array<PageRow>): void {
  pages = {};

  for (const row of rows) {
    pages[row.id] = row;
  }
}

function setIncident(overrides: Partial<IncidentRow> = {}): void {
  incidents[overrides.id || INCIDENT] = {
    id: INCIDENT,
    projectId: PROJECT_ID,
    monitors: [MONITOR_A],
    isVisibleOnStatusPage: true,
    isPrivate: false,
    scope: null,
    ...overrides,
  };
}

function setEpisode(overrides: Partial<EpisodeRow> = {}): void {
  episodes[EPISODE] = {
    id: EPISODE,
    projectId: PROJECT_ID,
    isVisibleOnStatusPage: true,
    isPrivate: false,
    incidentIds: [INCIDENT],
    ...overrides,
  };
}

function setMaintenance(overrides: Partial<MaintenanceRow> = {}): void {
  maintenanceEvents[MAINTENANCE] = {
    id: MAINTENANCE,
    projectId: PROJECT_ID,
    isVisibleOnStatusPage: true,
    publishOnStatusPageAt: null,
    statusPageIds: [SITE_1],
    ...overrides,
  };
}

function props(
  grants: Array<Permission> = [Permission.ProjectMember],
): DatabaseCommonInteractionProps {
  const tenantPermission: UserTenantAccessPermission = {
    _type: "UserTenantAccessPermission",
    projectId: PROJECT_ID,
    permissions: grants.map((permission: Permission): UserPermission => {
      return {
        _type: "UserPermission",
        permission: permission,
        labelIds: [],
        isBlockPermission: false,
      } as UserPermission;
    }),
  } as UserTenantAccessPermission;

  return {
    userId: USER_ID,
    tenantId: PROJECT_ID,
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: tenantPermission,
    },
  };
}

function sameId(a: unknown, b: unknown): boolean {
  return (
    String(a?.toString() || "").toLowerCase() ===
    String(b?.toString() || "").toLowerCase()
  );
}

// The ids QueryHelper.any was given (it builds a Raw IN operator).
function idsIn(operator: unknown): Array<string> {
  if (typeof operator === "string" || operator instanceof ObjectID) {
    return [operator.toString().toLowerCase()];
  }

  const raw: { objectLiteralParameters?: Dictionary<unknown> } = operator as {
    objectLiteralParameters?: Dictionary<unknown>;
  };

  return (
    Object.values(raw.objectLiteralParameters || {}) as Array<
      Array<string | ObjectID>
    >
  )
    .flat()
    .map((id: string | ObjectID): string => {
      return id.toString().toLowerCase();
    });
}

function toPage(row: PageRow): StatusPage {
  const statusPage: StatusPage = new StatusPage();
  statusPage._id = row.id;
  statusPage.name = row.name;
  statusPage.projectId = row.projectId;
  statusPage.showIncidentsOnStatusPage = row.showIncidents;
  statusPage.showEpisodesOnStatusPage = row.showEpisodes;
  statusPage.showScheduledMaintenanceEventsOnStatusPage = row.showMaintenance;
  statusPage.sendSubscriberNotifications = row.sendNotifications;
  statusPage.onlyShowScopedIncidents = row.onlyShowScopedIncidents;
  return statusPage;
}

function toMonitors(ids: Array<string>): Array<Monitor> {
  return ids.map((id: string): Monitor => {
    const monitor: Monitor = new Monitor();
    monitor._id = id;
    return monitor;
  });
}

function toPageRefs(ids: Array<string>): Array<StatusPage> {
  return ids.map((id: string): StatusPage => {
    const statusPage: StatusPage = new StatusPage();
    statusPage._id = id;
    return statusPage;
  });
}

beforeEach(() => {
  setPages(page(SITE_1), page(SITE_2), page(SITE_3));
  incidents = {};
  episodes = {};
  maintenanceEvents = {};
  readablePageIds = null;
  readableEventIds = [INCIDENT, SECOND_INCIDENT, EPISODE, MAINTENANCE];

  // The resources of every page that lists one of the monitors.
  jest
    .spyOn(StatusPageResourceService, "findByMonitors")
    .mockImplementation((async (data: {
      monitorIds: Array<ObjectID>;
    }): Promise<Array<StatusPageResource>> => {
      const monitorIds: Array<string> = data.monitorIds.map(
        (id: ObjectID): string => {
          return id.toString().toLowerCase();
        },
      );
      const resources: Array<StatusPageResource> = [];

      for (const row of Object.values(pages)) {
        for (const monitorId of row.monitors) {
          if (!monitorIds.includes(monitorId)) {
            continue;
          }

          const resource: StatusPageResource = new StatusPageResource();
          resource._id = `9${row.id.slice(1, 24)}${monitorId.slice(-12)}`;
          resource.statusPageId = new ObjectID(row.id);
          resource.displayName = `${monitorId} on ${row.name}`;
          resources.push(resource);
        }
      }

      return resources;
    }) as never);

  // As the jobs load pages: archived ones are left out.
  jest
    .spyOn(StatusPageSubscriberService, "getStatusPagesToSendNotification")
    .mockImplementation((async (
      ids: Array<ObjectID>,
    ): Promise<Array<StatusPage>> => {
      return Object.values(pages)
        .filter((row: PageRow): boolean => {
          return (
            !row.isArchived &&
            ids.some((id: ObjectID): boolean => {
              return sameId(id, row.id);
            })
          );
        })
        .map(toPage);
    }) as never);

  // The caller's read of names: only the pages they may read.
  jest.spyOn(StatusPageService, "findBy").mockImplementation((async (findBy: {
    query: JSONObject;
    props: DatabaseCommonInteractionProps;
  }): Promise<Array<StatusPage>> => {
    const wanted: Array<string> = idsIn(findBy.query["_id"]);

    return Object.values(pages)
      .filter((row: PageRow): boolean => {
        return (
          wanted.includes(row.id) &&
          sameId(row.projectId, findBy.query["projectId"]) &&
          (findBy.props.isRoot ||
            readablePageIds === null ||
            readablePageIds.includes(row.id))
        );
      })
      .map(toPage);
  }) as never);

  jest
    .spyOn(StatusPageSubscriberService, "countActiveSubscribersByChannel")
    .mockImplementation((async (): Promise<
      Dictionary<IncidentSubscriberAudienceCounts>
    > => {
      return {};
    }) as never);

  // The stored scopes, as IncidentStatusPageScope reads them.
  jest.spyOn(IncidentService, "findBy").mockImplementation((async (findBy: {
    query: JSONObject;
  }): Promise<Array<Incident>> => {
    const leavesPrivateOut: boolean = Object.prototype.hasOwnProperty.call(
      findBy.query,
      "isPrivate",
    );

    return idsIn(findBy.query["_id"])
      .map((id: string): IncidentRow | undefined => {
        return incidents[id];
      })
      .filter((row: IncidentRow | undefined): boolean => {
        return Boolean(row) && !(leavesPrivateOut && row!.isPrivate);
      })
      .map((row: IncidentRow | undefined): Incident => {
        const incident: Incident = new Incident();
        incident._id = row!.id;
        incident.isScopedToStatusPages = row!.scope !== null;
        incident.statusPages = toPageRefs(row!.scope || []);
        return incident;
      });
  }) as never);

  // An incident: the caller's read applies their access; a root read does not.
  jest
    .spyOn(IncidentService, "findOneBy")
    .mockImplementation((async (findOneBy: {
      query: JSONObject;
      props: DatabaseCommonInteractionProps;
    }): Promise<Incident | null> => {
      const row: IncidentRow | undefined = Object.values(incidents).find(
        (candidate: IncidentRow): boolean => {
          return (
            sameId(candidate.id, findOneBy.query["_id"]) &&
            sameId(candidate.projectId, findOneBy.query["projectId"])
          );
        },
      );

      if (!row) {
        return null;
      }

      if (!findOneBy.props.isRoot && !readableEventIds.includes(row.id)) {
        return null;
      }

      const incident: Incident = new Incident();
      incident._id = row.id;
      incident.projectId = row.projectId;
      incident.isVisibleOnStatusPage = row.isVisibleOnStatusPage;
      incident.isPrivate = row.isPrivate;
      incident.monitors = toMonitors(row.monitors);
      incident.isScopedToStatusPages = row.scope !== null;
      incident.statusPages = toPageRefs(row.scope || []);
      return incident;
    }) as never);

  jest
    .spyOn(IncidentEpisodeService, "findOneBy")
    .mockImplementation((async (findOneBy: {
      query: JSONObject;
      props: DatabaseCommonInteractionProps;
    }): Promise<IncidentEpisode | null> => {
      const row: EpisodeRow | undefined = Object.values(episodes).find(
        (candidate: EpisodeRow): boolean => {
          return (
            sameId(candidate.id, findOneBy.query["_id"]) &&
            sameId(candidate.projectId, findOneBy.query["projectId"])
          );
        },
      );

      if (
        !row ||
        (!findOneBy.props.isRoot && !readableEventIds.includes(row.id))
      ) {
        return null;
      }

      const episode: IncidentEpisode = new IncidentEpisode();
      episode._id = row.id;
      episode.isVisibleOnStatusPage = row.isVisibleOnStatusPage;
      episode.isPrivate = row.isPrivate;
      return episode;
    }) as never);

  // An episode's incidents, with their monitors, read as root.
  jest
    .spyOn(IncidentEpisodeMemberService, "findBy")
    .mockImplementation((async (findBy: {
      query: JSONObject;
    }): Promise<Array<IncidentEpisodeMember>> => {
      const row: EpisodeRow | undefined =
        episodes[String(findBy.query["incidentEpisodeId"]).toLowerCase()];

      return (row?.incidentIds || []).map(
        (incidentId: string): IncidentEpisodeMember => {
          const member: IncidentEpisodeMember = new IncidentEpisodeMember();
          member.incidentId = new ObjectID(incidentId);
          const incident: Incident = new Incident();
          incident._id = incidentId;
          incident.monitors = toMonitors(incidents[incidentId]?.monitors || []);
          member.incident = incident;
          return member;
        },
      );
    }) as never);

  jest
    .spyOn(ScheduledMaintenanceService, "findOneBy")
    .mockImplementation((async (findOneBy: {
      query: JSONObject;
      props: DatabaseCommonInteractionProps;
    }): Promise<ScheduledMaintenance | null> => {
      const row: MaintenanceRow | undefined = Object.values(
        maintenanceEvents,
      ).find((candidate: MaintenanceRow): boolean => {
        return (
          sameId(candidate.id, findOneBy.query["_id"]) &&
          sameId(candidate.projectId, findOneBy.query["projectId"])
        );
      });

      if (
        !row ||
        (!findOneBy.props.isRoot && !readableEventIds.includes(row.id))
      ) {
        return null;
      }

      const event: ScheduledMaintenance = new ScheduledMaintenance();
      event._id = row.id;
      event.isVisibleOnStatusPage = row.isVisibleOnStatusPage;
      (event as unknown as JSONObject)["publishOnStatusPageAt"] =
        row.publishOnStatusPageAt as never;
      event.statusPages = toPageRefs(row.statusPageIds);
      return event;
    }) as never);

  /*
   * The caller may post a note on the event, as a create of one on it
   * decides (DatabaseService.checkCallerMayCreate, which reads the event's
   * own row). "Who may ask" below refuses it.
   */
  jest
    .spyOn(IncidentPublicNoteService, "checkCallerMayCreate")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(IncidentEpisodePublicNoteService, "checkCallerMayCreate")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(ScheduledMaintenancePublicNoteService, "checkCallerMayCreate")
    .mockResolvedValue(undefined as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function reach(
  event: PublicNoteReachEvent,
  eventId: string,
  callerProps: DatabaseCommonInteractionProps = props(),
): Promise<PublicNoteNothingSentReason | null> {
  const result: PublicNoteReachResult = await PublicNoteReachBuilder.build({
    projectId: PROJECT_ID,
    props: callerProps,
    event: event,
    eventId: new ObjectID(eventId),
  });

  // Nothing but the reason ever travels.
  expect(Object.keys(PublicNoteReach.toJSON(result))).toEqual([
    "nothingSentReason",
  ]);

  return result.nothingSentReason;
}

function incidentReach(): Promise<PublicNoteNothingSentReason | null> {
  return reach(PublicNoteReachEvent.Incident, INCIDENT);
}

function episodeReach(): Promise<PublicNoteNothingSentReason | null> {
  return reach(PublicNoteReachEvent.IncidentEpisode, EPISODE);
}

function maintenanceReach(): Promise<PublicNoteNothingSentReason | null> {
  return reach(PublicNoteReachEvent.ScheduledMaintenance, MAINTENANCE);
}

describe("an incident's public note", () => {
  test("shown and notifies: a page lists its monitor, shows incidents and sends notifications", async () => {
    setIncident();

    expect(await incidentReach()).toBeNull();
  });

  test("shown, and every page that shows it is switched off: NotificationsOff", async () => {
    setPages(
      page(SITE_1, { sendNotifications: false }),
      page(SITE_2, { sendNotifications: false }),
    );
    setIncident();

    expect(await incidentReach()).toBe(
      PublicNoteNothingSentReason.NotificationsOff,
    );
  });

  test("one page that shows it and notifies is enough, beside pages switched off", async () => {
    setPages(
      page(SITE_1, { sendNotifications: false }),
      page(SITE_2),
      page(SITE_3, { showIncidents: false }),
    );
    setIncident();

    expect(await incidentReach()).toBeNull();
  });

  test("not shown: no page lists its monitors", async () => {
    setIncident({ monitors: [MONITOR_B] });

    expect(await incidentReach()).toBe(
      PublicNoteNothingSentReason.NoStatusPages,
    );
  });

  test("not shown: the pages that list its monitors hide incidents, and send nothing either", async () => {
    setPages(
      page(SITE_1, { showIncidents: false }),
      page(SITE_2, { showIncidents: false, sendNotifications: false }),
    );
    setIncident();

    expect(await incidentReach()).toBe(
      PublicNoteNothingSentReason.NoStatusPages,
    );
  });

  test("not shown: it is limited to a page that lists none of its monitors", async () => {
    setPages(page(SITE_1), page(SITE_2), page(SITE_3, { monitors: [] }));
    setIncident({ scope: [SITE_3] });

    expect(await incidentReach()).toBe(
      PublicNoteNothingSentReason.NoStatusPages,
    );
  });

  test("not shown: it is not limited, and every page that lists it only shows incidents limited to it", async () => {
    setPages(
      page(SITE_1, { onlyShowScopedIncidents: true }),
      page(SITE_2, { onlyShowScopedIncidents: true }),
    );
    setIncident();

    expect(await incidentReach()).toBe(
      PublicNoteNothingSentReason.NoStatusPages,
    );
  });

  test("its scope picks the page that shows it: a page left out does not make it notify", async () => {
    setPages(page(SITE_1, { sendNotifications: false }), page(SITE_2));
    setIncident({ scope: [SITE_1] });

    expect(await incidentReach()).toBe(
      PublicNoteNothingSentReason.NotificationsOff,
    );
  });

  test("no monitors", async () => {
    setIncident({ monitors: [] });

    expect(await incidentReach()).toBe(PublicNoteNothingSentReason.NoMonitors);
  });

  test("no monitors, though it is limited to pages: the monitors come first", async () => {
    setIncident({ monitors: [], scope: [SITE_1] });

    expect(await incidentReach()).toBe(PublicNoteNothingSentReason.NoMonitors);
  });

  test("hidden from status pages", async () => {
    setIncident({ isVisibleOnStatusPage: false });

    expect(await incidentReach()).toBe(
      PublicNoteNothingSentReason.HiddenFromStatusPages,
    );
  });

  test("private, and readable by the caller: hidden", async () => {
    setIncident({ isPrivate: true, isVisibleOnStatusPage: false });

    expect(await incidentReach()).toBe(
      PublicNoteNothingSentReason.HiddenFromStatusPages,
    );
  });

  /*
   * A page the caller cannot read counts as any other: a note on an
   * incident only it shows is on it, and its subscribers are told. Nothing
   * names it.
   */
  test("hidden pages: a page the caller cannot read that shows it and notifies makes it notify", async () => {
    setPages(page(SITE_1), page(SITE_2, { monitors: [] }));
    readablePageIds = [SITE_2];
    setIncident();

    expect(await incidentReach()).toBeNull();
  });

  test("hidden pages: a page the caller cannot read that shows it, switched off, is NotificationsOff, not NoStatusPages", async () => {
    setPages(page(SITE_1, { sendNotifications: false }));
    readablePageIds = [];
    setIncident();

    expect(await incidentReach()).toBe(
      PublicNoteNothingSentReason.NotificationsOff,
    );
  });

  test("another project's page never counts", async () => {
    setPages(page(SITE_1, { projectId: OTHER_PROJECT_ID }));
    setIncident();

    expect(await incidentReach()).toBe(
      PublicNoteNothingSentReason.NoStatusPages,
    );
  });

  test("an archived page never counts", async () => {
    setPages(page(SITE_1, { isArchived: true }));
    setIncident();

    expect(await incidentReach()).toBe(
      PublicNoteNothingSentReason.NoStatusPages,
    );
  });

  test("an incident the caller may not read is not found, and nothing about it is read as root", async () => {
    setIncident();
    readableEventIds = [];

    await expect(incidentReach()).rejects.toBeInstanceOf(NotFoundException);

    const rootReads: Array<unknown> = (
      IncidentService.findOneBy as unknown as jest.Mock
    ).mock.calls.filter((call: Array<unknown>): boolean => {
      return (
        (call[0] as { props: DatabaseCommonInteractionProps }).props.isRoot ===
        true
      );
    });

    expect(rootReads).toEqual([]);
  });

  test("another project's incident is not found", async () => {
    setIncident({ projectId: OTHER_PROJECT_ID });

    await expect(incidentReach()).rejects.toBeInstanceOf(NotFoundException);
  });

  /*
   * One rule decides the composer's words and the notification preview's
   * (#9684): for every case above, the reach is the preview's reason for a
   * public note, by name.
   */
  test.each([
    ["shown and notifies", {}, {}],
    ["switched off", { sendNotifications: false }, {}],
    ["hides incidents", { showIncidents: false }, {}],
    ["no monitors", {}, { monitors: [] }],
    ["hidden", {}, { isVisibleOnStatusPage: false }],
    ["on another monitor", {}, { monitors: [MONITOR_B] }],
  ] as Array<[string, Partial<PageRow>, Partial<IncidentRow>]>)(
    "%s: the same reason as the notification preview's for a note",
    async (
      _name: string,
      pageOverrides: Partial<PageRow>,
      incidentOverrides: Partial<IncidentRow>,
    ) => {
      setPages(page(SITE_1, pageOverrides));
      setIncident(incidentOverrides);

      const reached: PublicNoteNothingSentReason | null = await incidentReach();

      const preview: SubscriberNotificationPreviewNothingSentReason | null = (
        await SubscriberNotificationPreviewBuilder.build({
          projectId: PROJECT_ID,
          props: props(),
          request: {
            event: SubscriberNotificationPreviewEvent.IncidentPublicNoteCreated,
            incidentId: INCIDENT,
            note: "Rolling back.",
            postedAt: null,
          },
          // Nothing is built for a page: only the reason is compared.
          onlyStatusPageId: "b0000000-0000-4000-8000-0000000000ff",
        })
      ).nothingSentReason;

      expect(reached).toBe(
        PublicNoteReach.fromPreviewReason(preview).nothingSentReason,
      );
      expect(reached === null ? null : String(reached)).toBe(
        preview === null ? null : String(preview),
      );
    },
  );
});

describe("an episode's public note", () => {
  beforeEach(() => {
    setIncident();
    setEpisode();
  });

  test("shown and notifies: a page lists its incident's monitor, shows episodes and sends notifications", async () => {
    expect(await episodeReach()).toBeNull();
  });

  test("shown, and every page that shows it is switched off: NotificationsOff", async () => {
    setPages(page(SITE_1, { sendNotifications: false }));

    expect(await episodeReach()).toBe(
      PublicNoteNothingSentReason.NotificationsOff,
    );
  });

  test("not shown: the pages that list its incidents' monitors hide episodes", async () => {
    setPages(
      page(SITE_1, { showEpisodes: false }),
      page(SITE_2, { showEpisodes: false }),
    );

    expect(await episodeReach()).toBe(
      PublicNoteNothingSentReason.NoStatusPages,
    );
  });

  test("not shown: a page that shows incidents but hides episodes does not count", async () => {
    setPages(page(SITE_1, { showEpisodes: false, showIncidents: true }));

    expect(await episodeReach()).toBe(
      PublicNoteNothingSentReason.NoStatusPages,
    );
  });

  test("not shown: no page lists its incidents' monitors", async () => {
    setIncident({ monitors: [MONITOR_B] });

    expect(await episodeReach()).toBe(
      PublicNoteNothingSentReason.NoStatusPages,
    );
  });

  test("not shown: its incident is limited to a page that lists none of its monitors", async () => {
    setPages(page(SITE_1), page(SITE_3, { monitors: [] }));
    setIncident({ scope: [SITE_3] });

    expect(await episodeReach()).toBe(
      PublicNoteNothingSentReason.NoStatusPages,
    );
  });

  test("a private incident in it takes it to no page; another of its incidents still does", async () => {
    setPages(page(SITE_1), page(SITE_2, { monitors: [MONITOR_B] }));
    setIncident({ isPrivate: true });
    setIncident({ id: SECOND_INCIDENT, monitors: [MONITOR_B] });
    setEpisode({ incidentIds: [INCIDENT, SECOND_INCIDENT] });

    expect(await episodeReach()).toBeNull();

    setEpisode({ incidentIds: [INCIDENT] });

    expect(await episodeReach()).toBe(
      PublicNoteNothingSentReason.NoStatusPages,
    );
  });

  test("no monitors: none of its incidents is on one", async () => {
    setIncident({ monitors: [] });

    expect(await episodeReach()).toBe(PublicNoteNothingSentReason.NoMonitors);
  });

  test("no monitors: it has no incidents", async () => {
    setEpisode({ incidentIds: [] });

    expect(await episodeReach()).toBe(PublicNoteNothingSentReason.NoMonitors);
  });

  test("hidden from status pages, though its incidents are shown", async () => {
    setEpisode({ isVisibleOnStatusPage: false });

    expect(await episodeReach()).toBe(
      PublicNoteNothingSentReason.HiddenFromStatusPages,
    );
  });

  test("private: hidden", async () => {
    setEpisode({ isPrivate: true });

    expect(await episodeReach()).toBe(
      PublicNoteNothingSentReason.HiddenFromStatusPages,
    );
  });

  test("hidden pages: a page the caller cannot read counts, and is named nowhere", async () => {
    setPages(page(SITE_1, { sendNotifications: false }));
    readablePageIds = [];

    expect(await episodeReach()).toBe(
      PublicNoteNothingSentReason.NotificationsOff,
    );

    setPages(page(SITE_1));

    expect(await episodeReach()).toBeNull();
  });

  test("another project's page never counts", async () => {
    setPages(page(SITE_1, { projectId: OTHER_PROJECT_ID }));

    expect(await episodeReach()).toBe(
      PublicNoteNothingSentReason.NoStatusPages,
    );
  });

  test("an episode the caller may not read is not found", async () => {
    readableEventIds = [INCIDENT];

    await expect(episodeReach()).rejects.toBeInstanceOf(NotFoundException);
    expect(IncidentEpisodeMemberService.findBy).not.toHaveBeenCalled();
  });

  test("another project's episode is not found", async () => {
    setEpisode({ projectId: OTHER_PROJECT_ID });

    await expect(episodeReach()).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe("a maintenance event's public note", () => {
  const NOW: Date = new Date();
  const LATER: Date = new Date(NOW.getTime() + 24 * 60 * 60 * 1000);
  const EARLIER: Date = new Date(NOW.getTime() - 24 * 60 * 60 * 1000);

  beforeEach(() => {
    setMaintenance();
  });

  test("shown and notifies: a page picked on it shows maintenance events and sends notifications", async () => {
    expect(await maintenanceReach()).toBeNull();
  });

  test("shown and notifies once its publish time has come", async () => {
    setMaintenance({ publishOnStatusPageAt: EARLIER });

    expect(await maintenanceReach()).toBeNull();
  });

  /*
   * Its pages are the ones picked on it, never those that list its
   * monitors: on no monitor, or on one no page lists, it is still on them.
   */
  test("no monitors is no reason: it is on the pages picked", async () => {
    setPages(page(SITE_1, { monitors: [] }));

    expect(await maintenanceReach()).toBeNull();
  });

  test("shown, and every page picked that shows it is switched off: NotificationsOff", async () => {
    setPages(
      page(SITE_1, { sendNotifications: false }),
      page(SITE_2, { sendNotifications: false }),
    );
    setMaintenance({ statusPageIds: [SITE_1, SITE_2] });

    expect(await maintenanceReach()).toBe(
      PublicNoteNothingSentReason.NotificationsOff,
    );
  });

  test("not shown: no page is picked", async () => {
    setMaintenance({ statusPageIds: [] });

    expect(await maintenanceReach()).toBe(
      PublicNoteNothingSentReason.NoStatusPages,
    );
  });

  test("not shown: the pages picked hide maintenance events, and send nothing either", async () => {
    setPages(
      page(SITE_1, { showMaintenance: false }),
      page(SITE_2, { showMaintenance: false, sendNotifications: false }),
    );
    setMaintenance({ statusPageIds: [SITE_1, SITE_2] });

    expect(await maintenanceReach()).toBe(
      PublicNoteNothingSentReason.NoStatusPages,
    );
  });

  test("a page that lists its monitors but is not picked does not count", async () => {
    setPages(page(SITE_1, { showMaintenance: false }), page(SITE_2));
    setMaintenance({ statusPageIds: [SITE_1] });

    expect(await maintenanceReach()).toBe(
      PublicNoteNothingSentReason.NoStatusPages,
    );
  });

  test("hidden from status pages", async () => {
    setMaintenance({ isVisibleOnStatusPage: false });

    expect(await maintenanceReach()).toBe(
      PublicNoteNothingSentReason.HiddenFromStatusPages,
    );
  });

  test("hidden comes before no page picked, as its note job finds it", async () => {
    setMaintenance({ isVisibleOnStatusPage: false, statusPageIds: [] });

    expect(await maintenanceReach()).toBe(
      PublicNoteNothingSentReason.HiddenFromStatusPages,
    );
  });

  test("not published yet: its publish time is still to come", async () => {
    setMaintenance({ publishOnStatusPageAt: LATER });

    expect(await maintenanceReach()).toBe(
      PublicNoteNothingSentReason.NotPublishedYet,
    );
  });

  test("hidden pages: a page picked that the caller cannot read counts", async () => {
    readablePageIds = [];

    expect(await maintenanceReach()).toBeNull();

    setPages(page(SITE_1, { sendNotifications: false }));

    expect(await maintenanceReach()).toBe(
      PublicNoteNothingSentReason.NotificationsOff,
    );
  });

  test("another project's page, and an archived one, never count", async () => {
    setPages(
      page(SITE_1, { projectId: OTHER_PROJECT_ID }),
      page(SITE_2, { isArchived: true }),
    );
    setMaintenance({ statusPageIds: [SITE_1, SITE_2] });

    expect(await maintenanceReach()).toBe(
      PublicNoteNothingSentReason.NoStatusPages,
    );
  });

  test("an event the caller may not read is not found, and nothing about it is read as root", async () => {
    readableEventIds = [];

    await expect(maintenanceReach()).rejects.toBeInstanceOf(NotFoundException);

    const rootReads: Array<unknown> = (
      ScheduledMaintenanceService.findOneBy as unknown as jest.Mock
    ).mock.calls.filter((call: Array<unknown>): boolean => {
      return (
        (call[0] as { props: DatabaseCommonInteractionProps }).props.isRoot ===
        true
      );
    });

    expect(rootReads).toEqual([]);
    expect(
      StatusPageSubscriberService.getStatusPagesToSendNotification,
    ).not.toHaveBeenCalled();
  });

  test("another project's event is not found", async () => {
    setMaintenance({ projectId: OTHER_PROJECT_ID });

    await expect(maintenanceReach()).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe("the pages' part of the answer", () => {
  const showsAll: (statusPage: StatusPage) => boolean = (): boolean => {
    return true;
  };

  test("no page: NoStatusPages", () => {
    expect(
      PublicNoteReachBuilder.getStatusPagesReason({
        projectId: PROJECT_ID,
        statusPages: [],
        showsEvent: showsAll,
      }),
    ).toBe(PublicNoteNothingSentReason.NoStatusPages);
  });

  test("a page whose switch was not read keeps notifying, as every sender reads it", () => {
    const statusPage: StatusPage = toPage(page(SITE_1));
    delete (statusPage as unknown as JSONObject)["sendSubscriberNotifications"];

    expect(
      PublicNoteReachBuilder.getStatusPagesReason({
        projectId: PROJECT_ID,
        statusPages: [statusPage],
        showsEvent: showsAll,
      }),
    ).toBeNull();
  });

  test("a page of no project read counts as the project's", () => {
    const statusPage: StatusPage = toPage(page(SITE_1));
    delete (statusPage as unknown as JSONObject)["projectId"];

    expect(
      PublicNoteReachBuilder.getStatusPagesReason({
        projectId: PROJECT_ID,
        statusPages: [statusPage],
        showsEvent: showsAll,
      }),
    ).toBeNull();
  });

  test("only the pages that show the event decide whether it notifies", () => {
    expect(
      PublicNoteReachBuilder.getStatusPagesReason({
        projectId: PROJECT_ID,
        statusPages: [
          toPage(page(SITE_1, { showEpisodes: false })),
          toPage(page(SITE_2, { sendNotifications: false })),
        ],
        showsEvent: (statusPage: StatusPage): boolean => {
          return Boolean(statusPage.showEpisodesOnStatusPage);
        },
      }),
    ).toBe(PublicNoteNothingSentReason.NotificationsOff);
  });
});

describe("the answer for an incident is the audience's, and only that", () => {
  test("the audience it is worked out from counts subscribers and names pages, and the answer carries none of it", async () => {
    setIncident();
    readablePageIds = [SITE_1];

    const result: PublicNoteReachResult = await PublicNoteReachBuilder.build({
      projectId: PROJECT_ID,
      props: props(),
      event: PublicNoteReachEvent.Incident,
      eventId: new ObjectID(INCIDENT),
    });

    expect(result).toEqual({ nothingSentReason: null });
    expect(JSON.stringify(PublicNoteReach.toJSON(result))).not.toContain(
      "Site",
    );
    expect(JSON.stringify(PublicNoteReach.toJSON(result))).not.toContain(
      SITE_1,
    );
  });
});

/*
 * WHO MAY ASK IS DECIDED FOR THE EVENT (TableHalfWriteGuard).
 *
 * Whoever may write the event's public notes - post one on it, or edit one
 * of its own - and that is the event's to decide: a permission to post
 * notes limited to the "staging" label does not reach an incident labelled
 * "production", nor one limited to what the caller's teams own an incident
 * nobody on them owns. Posting one is asked as the create of a note on the
 * event is (DatabaseService.checkCallerMayCreate); editing one, when that
 * is refused, as a note of the event the caller's update permission
 * reaches (ModelPermission.getUpdatableQuery, found as root). The table's
 * permissions alone decide nothing.
 */
describe("who may ask, decided for the event", () => {
  interface NoteEvent {
    event: PublicNoteReachEvent;
    eventId: string;
    // The note's column that names its event.
    eventColumn: string;
    checkCallerMayCreate: () => jest.Mock;
    findNote: () => jest.Mock;
    setUp: () => void;
  }

  const NOTE_EVENTS: Array<NoteEvent> = [
    {
      event: PublicNoteReachEvent.Incident,
      eventId: INCIDENT,
      eventColumn: "incidentId",
      checkCallerMayCreate: (): jest.Mock => {
        return IncidentPublicNoteService.checkCallerMayCreate as unknown as jest.Mock;
      },
      findNote: (): jest.Mock => {
        return jest.spyOn(
          IncidentPublicNoteService,
          "findOneBy",
        ) as unknown as jest.Mock;
      },
      setUp: (): void => {
        setIncident();
      },
    },
    {
      event: PublicNoteReachEvent.IncidentEpisode,
      eventId: EPISODE,
      eventColumn: "incidentEpisodeId",
      checkCallerMayCreate: (): jest.Mock => {
        return IncidentEpisodePublicNoteService.checkCallerMayCreate as unknown as jest.Mock;
      },
      findNote: (): jest.Mock => {
        return jest.spyOn(
          IncidentEpisodePublicNoteService,
          "findOneBy",
        ) as unknown as jest.Mock;
      },
      setUp: (): void => {
        setIncident();
        setEpisode();
      },
    },
    {
      event: PublicNoteReachEvent.ScheduledMaintenance,
      eventId: MAINTENANCE,
      eventColumn: "scheduledMaintenanceId",
      checkCallerMayCreate: (): jest.Mock => {
        return ScheduledMaintenancePublicNoteService.checkCallerMayCreate as unknown as jest.Mock;
      },
      findNote: (): jest.Mock => {
        return jest.spyOn(
          ScheduledMaintenancePublicNoteService,
          "findOneBy",
        ) as unknown as jest.Mock;
      },
      setUp: (): void => {
        setMaintenance();
      },
    },
  ];

  // How many reads of the events were made as root.
  function rootReads(): number {
    const reads: Array<jest.Mock> = [
      IncidentService.findOneBy as unknown as jest.Mock,
      IncidentEpisodeService.findOneBy as unknown as jest.Mock,
      ScheduledMaintenanceService.findOneBy as unknown as jest.Mock,
    ];

    return reads
      .map((read: jest.Mock): number => {
        return read.mock.calls.filter((call: Array<unknown>): boolean => {
          return (
            (call[0] as { props: DatabaseCommonInteractionProps }).props
              .isRoot === true
          );
        }).length;
      })
      .reduce((sum: number, count: number): number => {
        return sum + count;
      }, 0);
  }

  // The event's notes the caller may update: its query, marked as narrowed.
  function updatableNotesAre(): jest.Mock {
    return jest
      .spyOn(ModelPermission, "getUpdatableQuery")
      .mockImplementation((async (
        _modelType: unknown,
        query: JSONObject,
      ): Promise<JSONObject> => {
        return { ...query, ownedByTheCallersTeams: true };
      }) as never) as unknown as jest.Mock;
  }

  describe.each(NOTE_EVENTS)(
    "a public note of the event kind $event",
    (noteEvent: NoteEvent) => {
      beforeEach(() => {
        noteEvent.setUp();
      });

      test("posting one is asked as the create of a note on this event, in the project, as the caller", async () => {
        const caller: DatabaseCommonInteractionProps = props();

        await reach(noteEvent.event, noteEvent.eventId, caller);

        const create: jest.Mock = noteEvent.checkCallerMayCreate();

        expect(create).toHaveBeenCalledTimes(1);

        const asked: { data: JSONObject; props: unknown } = create.mock
          .calls[0]![0] as { data: JSONObject; props: unknown };

        expect(String(asked.data[noteEvent.eventColumn])).toBe(
          noteEvent.eventId,
        );
        expect(String(asked.data["projectId"])).toBe(PROJECT_ID.toString());
        expect(asked.props).toBe(caller);
      });

      test("one who may post one is answered, and asked nothing about editing", async () => {
        const updatable: jest.Mock = updatableNotesAre();

        await reach(noteEvent.event, noteEvent.eventId);

        expect(updatable).not.toHaveBeenCalled();
      });

      test("refused the post, one who may edit a note of this event is answered", async () => {
        noteEvent
          .checkCallerMayCreate()
          .mockRejectedValue(
            new CreateScopeException(
              'This permission only lets you create public notes on records labelled "staging".',
            ) as never,
          );
        const updatable: jest.Mock = updatableNotesAre();
        const findNote: jest.Mock = noteEvent
          .findNote()
          .mockResolvedValue(new IncidentPublicNote() as never);

        await reach(noteEvent.event, noteEvent.eventId);

        // The notes of this event, narrowed to what the caller may update...
        expect(updatable).toHaveBeenCalledTimes(1);

        const notesOfEvent: JSONObject = updatable.mock
          .calls[0]![1] as JSONObject;

        expect(String(notesOfEvent[noteEvent.eventColumn])).toBe(
          noteEvent.eventId,
        );
        expect(String(notesOfEvent["projectId"])).toBe(PROJECT_ID.toString());

        // ...and one of them found, as root, by that query.
        const found: {
          query: JSONObject;
          props: DatabaseCommonInteractionProps;
        } = findNote.mock.calls[0]![0] as {
          query: JSONObject;
          props: DatabaseCommonInteractionProps;
        };

        expect(found.query["ownedByTheCallersTeams"]).toBe(true);
        expect(found.props.isRoot).toBe(true);
      });

      test("refused the post, with no note of this event to edit, is refused - and nothing about the event is read as root", async () => {
        noteEvent
          .checkCallerMayCreate()
          .mockRejectedValue(new NotAuthorizedException("No.") as never);
        updatableNotesAre();
        noteEvent.findNote().mockResolvedValue(null as never);

        await expect(
          reach(noteEvent.event, noteEvent.eventId),
        ).rejects.toBeInstanceOf(NotAuthorizedException);

        expect(rootReads()).toBe(0);
        expect(
          StatusPageSubscriberService.getStatusPagesToSendNotification,
        ).not.toHaveBeenCalled();
      });

      test("refused the post, and allowed to edit no note at all, is refused", async () => {
        noteEvent
          .checkCallerMayCreate()
          .mockRejectedValue(new NotAuthorizedException("No.") as never);
        jest
          .spyOn(ModelPermission, "getUpdatableQuery")
          .mockRejectedValue(new NotAuthorizedException("No.") as never);
        const findNote: jest.Mock = noteEvent.findNote();

        await expect(reach(noteEvent.event, noteEvent.eventId)).rejects.toThrow(
          "public notes are shown. You need a permission that lets you post or edit them.",
        );
        expect(findNote).not.toHaveBeenCalled();
      });

      test("the event is read as the caller first: one they may not read is not found, and nobody asks whether they may write its notes", async () => {
        readableEventIds = [];

        await expect(
          reach(noteEvent.event, noteEvent.eventId),
        ).rejects.toBeInstanceOf(NotFoundException);
        expect(noteEvent.checkCallerMayCreate()).not.toHaveBeenCalled();
      });

      test("a master admin is not asked", async () => {
        const masterAdmin: DatabaseCommonInteractionProps = {
          ...props([]),
          isMasterAdmin: true,
        };

        await reach(noteEvent.event, noteEvent.eventId, masterAdmin);

        expect(noteEvent.checkCallerMayCreate()).not.toHaveBeenCalled();
      });
    },
  );

  /*
   * What the create check refuses with: a permission that does not reach
   * the event's labels or owners, an event the caller may not read, a plan
   * that does not sell the write. Each is a "no", and editing is asked
   * next.
   */
  test.each([
    [
      "a permission limited to labels the incident does not carry",
      new CreateScopeException("Not on these labels."),
    ],
    ["no permission to post notes", new NotAuthorizedException("No.")],
    [
      "an incident the caller may not read",
      new UnreadableParentException("Not readable."),
    ],
    [
      "a plan that does not sell it",
      new PaymentRequiredException("Upgrade your plan."),
    ],
  ] as Array<[string, Error]>)(
    "%s is a refusal, not a failure",
    async (_name: string, refusal: Error) => {
      setIncident();
      (
        IncidentPublicNoteService.checkCallerMayCreate as unknown as jest.Mock
      ).mockRejectedValue(refusal as never);
      updatableNotesAre();
      jest
        .spyOn(IncidentPublicNoteService, "findOneBy")
        .mockResolvedValue(null as never);

      await expect(incidentReach()).rejects.toBeInstanceOf(
        NotAuthorizedException,
      );
    },
  );

  test("a failure that is no refusal is thrown as it came", async () => {
    setIncident();

    const failure: Error = new Error("The database did not answer.");

    (
      IncidentPublicNoteService.checkCallerMayCreate as unknown as jest.Mock
    ).mockRejectedValue(failure as never);

    await expect(incidentReach()).rejects.toBe(failure);
  });

  test("an episode's and a maintenance event's notes are asked of their own services", async () => {
    setIncident();
    setEpisode();
    setMaintenance();

    await episodeReach();
    await maintenanceReach();

    const episodeCreate: jest.Mock =
      IncidentEpisodePublicNoteService.checkCallerMayCreate as unknown as jest.Mock;
    const maintenanceCreate: jest.Mock =
      ScheduledMaintenancePublicNoteService.checkCallerMayCreate as unknown as jest.Mock;

    expect(episodeCreate).toHaveBeenCalledTimes(1);
    expect(maintenanceCreate).toHaveBeenCalledTimes(1);
    expect(
      IncidentPublicNoteService.checkCallerMayCreate,
    ).not.toHaveBeenCalled();
    expect(
      (episodeCreate.mock.calls[0]![0] as { data: unknown }).data,
    ).toBeInstanceOf(IncidentEpisodePublicNote);
    expect(
      (maintenanceCreate.mock.calls[0]![0] as { data: unknown }).data,
    ).toBeInstanceOf(ScheduledMaintenancePublicNote);
  });
});

/*
 * The route's first refusal, before it reads the body: a caller who may
 * write that kind of note nowhere in the project. It lets nobody through on
 * its own - build decides for the event.
 */
describe("the route's first refusal", () => {
  test("lets through a caller whose permission to post notes is limited to some labels: the event decides", () => {
    const limited: DatabaseCommonInteractionProps = props([]);

    limited.userTenantAccessPermission![PROJECT_ID.toString()]!.permissions = [
      {
        _type: "UserPermission",
        permission: Permission.CreateIncidentPublicNote,
        labelIds: [new ObjectID("70000000-0000-4000-8000-000000000001")],
        isBlockPermission: false,
      } as UserPermission,
    ];

    expect(() => {
      PublicNoteReachBuilder.assertCallerMayAsk({
        props: limited,
        event: PublicNoteReachEvent.Incident,
      });
    }).not.toThrow();
  });

  test("refuses a credential that may only read, whatever it holds", () => {
    expect(() => {
      PublicNoteReachBuilder.assertCallerMayAsk({
        props: { ...props(), isReadOnlyCredential: true },
        event: PublicNoteReachEvent.Incident,
      });
    }).toThrow(NotAuthorizedException);
  });

  test("refuses a caller who may only read the notes", () => {
    expect(() => {
      PublicNoteReachBuilder.assertCallerMayAsk({
        props: props([Permission.ReadIncidentPublicNote]),
        event: PublicNoteReachEvent.Incident,
      });
    }).toThrow(
      "You do not have permission to see where this incident's public notes are shown. You need a permission that lets you post or edit them.",
    );
  });
});
