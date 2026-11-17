import Entities from "../../../Models/DatabaseModels/Index";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import StatusPageAPI from "../../../Server/API/StatusPageAPI";
import ProjectService from "../../../Server/Services/ProjectService";
import API from "../../../Utils/API";
import StatusPageService from "../../../Server/Services/StatusPageService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Dictionary from "../../../Types/Dictionary";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { mockRouter } from "./Helpers";
import FakeGlobalCacheStrings from "../TestingUtils/Redis/FakeGlobalCacheStrings";
import StatusPageOverviewCache, {
  STATUS_PAGE_OVERVIEW_CACHE_NAMESPACE,
} from "../../../Server/Utils/StatusPage/StatusPageOverviewCache";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { DataSource, Logger } from "typeorm";

/*
 * HOW MANY POSTGRES STATEMENTS ONE ANONYMOUS VIEW OF A STATUS PAGE COSTS.
 *
 * Public status pages take anonymous traffic, and a large install once ran
 * out of Postgres connections (#7918, #7975). This counts every statement the
 * real endpoints send to a migrated Postgres - through TypeORM's own query
 * log, so a join, a count and a raw aggregate are each one - for:
 *
 *   - one view of a public page on its custom domain, as a browser makes it:
 *     the page's HTML (/seo, asked by the server that renders it), the app
 *     finding its page (/domain), the page's settings (/master-page), its
 *     overview and its favicon;
 *   - each image a page serves: favicon, logo, dark theme logo, cover image;
 *   - each list a page's tabs read: incidents, episodes, scheduled
 *     maintenance, announcements.
 *
 * Each is counted the first time - a page nobody has viewed in this process -
 * and the second, the way every other visitor finds it. The second is what
 * caching is for, and what these numbers guard: a change that makes a warm
 * view read Postgres again fails here, and so does one that makes a first
 * view read more than it did when this was written (the budgets below).
 * Then a view of the same page in another process of the install (another
 * pod: its own memory, the same Redis), which finds the page's overview and
 * lists already built.
 *
 * Measured on 2026-11-16, before the page's reads were kept (#7975), and
 * after:
 *
 *                                      before          after
 *   a view, first / again             47 / 9          46 / 0
 *   a view in another pod             47              11
 *   favicon, logo, dark logo, cover   1 each, always  first only; 0 after
 *   incidents, first / again          17 / 15         17 / 0
 *   episodes                          9 / 9           8 / 0
 *   scheduled maintenance             14 / 14         13 / 0
 *   announcements                     6 / 6           5 / 0
 *   an incident opened by its id      11 every time   13 / 0
 *
 * Opt in with RUN_POSTGRES_STATUS_PAGE_VIEW_STATEMENT_TESTS=true against a
 * database the registered migrations have been applied to, e.g.
 *
 *   RUN_POSTGRES_STATUS_PAGE_VIEW_STATEMENT_TESTS=true \
 *   STATUS_PAGE_VIEW_STATEMENT_TEST_DATABASE_HOST=127.0.0.1 \
 *   STATUS_PAGE_VIEW_STATEMENT_TEST_DATABASE_PORT=5400 \
 *   DATABASE_PASSWORD=... npx jest Tests/Server/API/StatusPagePublicViewStatementsPostgres.test.ts
 *
 * The tables the endpoints read are cloned, structure only, into a uniquely
 * named schema that search_path puts first; no row is written outside it,
 * and it is dropped afterwards. Redis is a map every request shares.
 */
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_STATUS_PAGE_VIEW_STATEMENT_TESTS"] === "true"
    ? describe
    : describe.skip;

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

jest.mock("../../../Server/Utils/Logger");

const TABLES: Array<string> = [
  "Project",
  "Label",
  "File",
  "Domain",
  "StatusPage",
  "StatusPageLabel",
  "StatusPageDomain",
  "StatusPageDownMonitorStatus",
  "StatusPageGroup",
  "StatusPageResource",
  "StatusPageHistoryChartBarColorRule",
  "StatusPageHeaderLink",
  "StatusPageFooterLink",
  "StatusPageSSO",
  "StatusPageOIDC",
  "StatusPagePrivateUser",
  "StatusPagePrivateUserSession",
  "Monitor",
  "MonitorStatus",
  "MonitorStatusTimeline",
  "MonitorGroup",
  "MonitorGroupResource",
  "IncidentSeverity",
  "IncidentState",
  "Incident",
  "IncidentMonitor",
  "IncidentStatusPage",
  "IncidentLabel",
  "IncidentPostmortemAttachmentFile",
  "IncidentStateTimeline",
  "IncidentPublicNote",
  "IncidentPublicNoteFile",
  "IncidentEpisode",
  "IncidentEpisodeLabel",
  "IncidentEpisodeMember",
  "IncidentEpisodeStateTimeline",
  "IncidentEpisodePublicNote",
  "IncidentEpisodePublicNoteFile",
  "ScheduledMaintenanceState",
  "ScheduledMaintenance",
  "ScheduledMaintenanceMonitor",
  "ScheduledMaintenanceStatusPage",
  "ScheduledMaintenanceLabel",
  "ScheduledMaintenanceStateTimeline",
  "ScheduledMaintenancePublicNote",
  "ScheduledMaintenancePublicNoteFile",
  "StatusPageAnnouncement",
  "AnnouncementStatusPage",
  "AnnouncementMonitor",
  "StatusPageAnnouncementFile",
];

// Every statement TypeORM sends, in order.
class StatementLog implements Logger {
  public statements: Array<string> = [];

  public logQuery(query: string): void {
    this.statements.push(query);
  }

  public logQueryError(): void {}
  public logQuerySlow(): void {}
  public logSchemaBuild(): void {}
  public logMigration(): void {}
  public log(): void {}
}

const API_PATH: string = "/status-page";

const ROUTES: {
  seo: string;
  domain: string;
  masterPage: string;
  overview: string;
  favicon: string;
  logo: string;
  darkThemeLogo: string;
  coverImage: string;
  incidents: string;
  incident: string;
  episodes: string;
  scheduledMaintenance: string;
  announcements: string;
} = {
  seo: `${API_PATH}/seo/:statusPageIdOrDomain`,
  domain: `${API_PATH}/domain`,
  masterPage: `${API_PATH}/master-page/:statusPageId`,
  overview: `${API_PATH}/overview/:statusPageIdOrDomain`,
  favicon: `${API_PATH}/favicon/:statusPageIdOrDomain`,
  logo: `${API_PATH}/logo/:statusPageIdOrDomain`,
  darkThemeLogo: `${API_PATH}/dark-theme-logo/:statusPageIdOrDomain`,
  coverImage: `${API_PATH}/cover-image/:statusPageIdOrDomain`,
  incidents: `${API_PATH}/incidents/:statusPageIdOrDomain`,
  incident: `${API_PATH}/incidents/:statusPageIdOrDomain/:incidentId`,
  episodes: `${API_PATH}/episodes/:statusPageIdOrDomain`,
  scheduledMaintenance: `${API_PATH}/scheduled-maintenance-events/:statusPageIdOrDomain`,
  announcements: `${API_PATH}/announcements/:statusPageIdOrDomain`,
};

// What a request answered, as a browser would see it.
interface Answer {
  status: number;
  headers: Dictionary<string>;
  body: unknown;
  error: unknown;
}

describePostgres(
  "Postgres statements per anonymous status page view, on a migrated Postgres",
  () => {
    const schema: string = `status_page_view_statements_${ObjectID.generate()
      .toString()
      .replace(/-/g, "")}`;

    const log: StatementLog = new StatementLog();
    let database: DataSource;
    const redis: FakeGlobalCacheStrings = new FakeGlobalCacheStrings();

    beforeAll(async () => {
      database = new DataSource({
        type: "postgres",
        host:
          process.env["STATUS_PAGE_VIEW_STATEMENT_TEST_DATABASE_HOST"] ||
          "localhost",
        port: Number(
          process.env["STATUS_PAGE_VIEW_STATEMENT_TEST_DATABASE_PORT"] ||
            "5400",
        ),
        username: process.env["DATABASE_USERNAME"] || "postgres",
        password: process.env["DATABASE_PASSWORD"] || "password",
        database:
          process.env["STATUS_PAGE_VIEW_STATEMENT_TEST_DATABASE_NAME"] ||
          process.env["DATABASE_NAME"] ||
          "oneuptimedb",
        entities: Entities,
        schema,
        synchronize: false,
        logging: ["query"],
        logger: log,
        extra: { options: `-c search_path=${schema},public` },
      });
      await database.initialize();

      await database.query(`CREATE SCHEMA "${schema}"`);

      for (const table of TABLES) {
        await database.query(
          `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
        );
      }

      jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
      jest
        .spyOn(PostgresAppInstance, "getDataSource")
        .mockReturnValue(database);

      // Redis, as every process of the install sees it.
      redis.install();

      mockRouter.routes.length = 0;
      mockRouter.params.length = 0;
      new StatusPageAPI();
    });

    afterAll(async () => {
      jest.restoreAllMocks();
      StatusPageAPI.clearOverviewResponseCache();
      if (database?.isInitialized) {
        await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await database.destroy();
      }
    });

    async function insert(
      table: string,
      row: Dictionary<unknown>,
    ): Promise<void> {
      const columns: Array<string> = Object.keys(row);

      await database.query(
        `INSERT INTO "${schema}"."${table}" (${columns
          .map((column: string): string => {
            return `"${column}"`;
          })
          .join(", ")}) VALUES (${columns
          .map((_column: string, index: number): string => {
            return `$${index + 1}`;
          })
          .join(", ")})`,
        columns.map((column: string): unknown => {
          const value: unknown = row[column];
          return value instanceof ObjectID ? value.toString() : value;
        }),
      );
    }

    function hoursAgo(hours: number): Date {
      return new Date(Date.now() - hours * 60 * 60 * 1000);
    }

    function hoursFromNow(hours: number): Date {
      return new Date(Date.now() + hours * 60 * 60 * 1000);
    }

    // A page as a customer sets one up: everything a visitor is shown.
    interface SeededPage {
      projectId: ObjectID;
      statusPageId: ObjectID;
      domain: string;
      // The incident under way, as a subscriber's email links to it.
      activeIncidentId: ObjectID;
    }

    async function seedFile(
      projectId: ObjectID,
      name: string,
    ): Promise<ObjectID> {
      const id: ObjectID = ObjectID.generate();
      await insert("File", {
        _id: id,
        projectId: projectId,
        name: name,
        fileType: "image/png",
        slug: `file-${id.toString()}`,
        file: Buffer.from(`${name} image bytes ${id.toString()}`),
        isPublic: true,
        version: 1,
      });
      return id;
    }

    async function seedPage(): Promise<SeededPage> {
      // A project of its own: nothing kept for another page counts here.
      const projectId: ObjectID = ObjectID.generate();
      const statusPageId: ObjectID = ObjectID.generate();
      const domain: string = `status-${statusPageId
        .toString()
        .slice(0, 8)}.example.test`;

      await insert("Project", {
        _id: projectId,
        name: "Statement count test",
        slug: `statement-count-${projectId.toString()}`,
        version: 1,
      });

      const operational: ObjectID = ObjectID.generate();
      const degraded: ObjectID = ObjectID.generate();
      const offline: ObjectID = ObjectID.generate();

      for (const status of [
        { id: operational, name: "Operational", priority: 1, ok: true },
        { id: degraded, name: "Degraded", priority: 2, ok: false },
        { id: offline, name: "Offline", priority: 3, ok: false },
      ]) {
        await insert("MonitorStatus", {
          _id: status.id,
          projectId: projectId,
          name: status.name,
          slug: `${status.name.toLowerCase()}-${status.id.toString()}`,
          color: "#00ff00",
          priority: status.priority,
          isOperationalState: status.ok,
          isOfflineState: status.name === "Offline",
          version: 1,
        });
      }

      const monitors: Array<ObjectID> = [];

      for (const name of ["API", "Website", "Database", "Cache"]) {
        const id: ObjectID = ObjectID.generate();
        monitors.push(id);

        await insert("Monitor", {
          _id: id,
          projectId: projectId,
          name: name,
          slug: `monitor-${id.toString()}`,
          monitorType: "Manual",
          currentMonitorStatusId: name === "Website" ? degraded : operational,
          firstMeasuredAt: hoursAgo(24 * 30),
          version: 1,
        });

        await insert("MonitorStatusTimeline", {
          _id: ObjectID.generate(),
          projectId: projectId,
          monitorId: id,
          monitorStatusId: operational,
          startsAt: hoursAgo(24 * 30),
          endsAt: name === "Website" ? hoursAgo(1) : null,
          version: 1,
        });

        if (name === "Website") {
          await insert("MonitorStatusTimeline", {
            _id: ObjectID.generate(),
            projectId: projectId,
            monitorId: id,
            monitorStatusId: degraded,
            startsAt: hoursAgo(1),
            version: 1,
          });
        }
      }

      const monitorGroupId: ObjectID = ObjectID.generate();
      await insert("MonitorGroup", {
        _id: monitorGroupId,
        projectId: projectId,
        name: "Storage",
        slug: `group-${monitorGroupId.toString()}`,
        version: 1,
      });

      for (const monitorId of [monitors[2]!, monitors[3]!]) {
        await insert("MonitorGroupResource", {
          _id: ObjectID.generate(),
          projectId: projectId,
          monitorGroupId: monitorGroupId,
          monitorId: monitorId,
          version: 1,
        });
      }

      await insert("StatusPage", {
        _id: statusPageId,
        projectId: projectId,
        name: "Acme status",
        pageTitle: "Acme status",
        pageDescription: "How Acme is doing",
        slug: `page-${statusPageId.toString()}`,
        version: 1,
        isPublicStatusPage: true,
        showIncidentsOnStatusPage: true,
        showEpisodesOnStatusPage: true,
        showAnnouncementsOnStatusPage: true,
        showScheduledMaintenanceEventsOnStatusPage: true,
        showSubscriberPageOnStatusPage: true,
        faviconFileId: await seedFile(projectId, "favicon"),
        logoFileId: await seedFile(projectId, "logo"),
        darkThemeLogoFileId: await seedFile(projectId, "dark-logo"),
        coverImageFileId: await seedFile(projectId, "cover"),
      });

      await insert("StatusPageDownMonitorStatus", {
        statusPageId: statusPageId,
        monitorStatusId: offline,
      });

      const coreGroupId: ObjectID = ObjectID.generate();
      await insert("StatusPageGroup", {
        _id: coreGroupId,
        projectId: projectId,
        statusPageId: statusPageId,
        name: "Core",
        slug: `core-${coreGroupId.toString()}`,
        order: 1,
        version: 1,
      });

      let order: number = 0;

      for (const monitorId of [monitors[0]!, monitors[1]!]) {
        await insert("StatusPageResource", {
          _id: ObjectID.generate(),
          projectId: projectId,
          statusPageId: statusPageId,
          statusPageGroupId: coreGroupId,
          monitorId: monitorId,
          displayName: `Resource ${++order}`,
          order: order,
          showStatusHistoryChart: true,
          showUptimePercent: true,
          showCurrentStatus: true,
          version: 1,
        });
      }

      await insert("StatusPageResource", {
        _id: ObjectID.generate(),
        projectId: projectId,
        statusPageId: statusPageId,
        monitorGroupId: monitorGroupId,
        displayName: "Storage",
        order: ++order,
        showStatusHistoryChart: true,
        showUptimePercent: true,
        showCurrentStatus: true,
        version: 1,
      });

      for (const table of ["StatusPageHeaderLink", "StatusPageFooterLink"]) {
        await insert(table, {
          _id: ObjectID.generate(),
          projectId: projectId,
          statusPageId: statusPageId,
          title: "Home",
          link: "https://example.test",
          order: 1,
          version: 1,
        });
      }

      const domainId: ObjectID = ObjectID.generate();
      await insert("Domain", {
        _id: domainId,
        projectId: projectId,
        domain: domain.split(".").slice(1).join("."),
        slug: `domain-${domainId.toString()}`,
        domainVerificationText: `verify-${domainId.toString()}`,
        isVerified: true,
        version: 1,
      });

      await insert("StatusPageDomain", {
        _id: ObjectID.generate(),
        projectId: projectId,
        domainId: domainId,
        statusPageId: statusPageId,
        subdomain: domain.split(".")[0]!,
        fullDomain: domain,
        cnameVerificationToken: `token-${domainId.toString()}`,
        isCnameVerified: true,
        version: 1,
      });

      // An incident under way on Website, one resolved on API.
      const severityId: ObjectID = ObjectID.generate();
      await insert("IncidentSeverity", {
        _id: severityId,
        projectId: projectId,
        name: "Major",
        slug: `major-${severityId.toString()}`,
        color: "#ff0000",
        order: 1,
        version: 1,
      });

      const incidentStates: Dictionary<ObjectID> = {};

      for (const state of [
        { name: "Identified", order: 1, created: true, resolved: false },
        { name: "Acknowledged", order: 2, created: false, resolved: false },
        { name: "Resolved", order: 3, created: false, resolved: true },
      ]) {
        const id: ObjectID = ObjectID.generate();
        incidentStates[state.name] = id;

        await insert("IncidentState", {
          _id: id,
          projectId: projectId,
          name: state.name,
          slug: `${state.name.toLowerCase()}-${id.toString()}`,
          color: "#000000",
          order: state.order,
          isCreatedState: state.created,
          isAcknowledgedState: state.name === "Acknowledged",
          isResolvedState: state.resolved,
          version: 1,
        });
      }

      let activeIncidentId: ObjectID = ObjectID.generate();

      for (const incident of [
        {
          title: "Website is slow",
          monitorId: monitors[1]!,
          state: "Identified",
          at: hoursAgo(1),
        },
        {
          title: "API was down",
          monitorId: monitors[0]!,
          state: "Resolved",
          at: hoursAgo(48),
        },
      ]) {
        const id: ObjectID = ObjectID.generate();

        if (incident.state !== "Resolved") {
          activeIncidentId = id;
        }

        await insert("Incident", {
          _id: id,
          projectId: projectId,
          title: incident.title,
          slug: `incident-${id.toString()}`,
          currentIncidentStateId: incidentStates[incident.state]!,
          incidentSeverityId: severityId,
          createdAt: incident.at,
          declaredAt: incident.at,
          isVisibleOnStatusPage: true,
          isPrivate: false,
          version: 1,
        });

        await insert("IncidentMonitor", {
          incidentId: id,
          monitorId: incident.monitorId,
        });

        await insert("IncidentStateTimeline", {
          _id: ObjectID.generate(),
          projectId: projectId,
          incidentId: id,
          incidentStateId: incidentStates[incident.state]!,
          startsAt: incident.at,
          version: 1,
        });

        await insert("IncidentPublicNote", {
          _id: ObjectID.generate(),
          projectId: projectId,
          incidentId: id,
          note: "We are looking into it.",
          postedAt: incident.at,
          isPublished: true,
          version: 1,
        });
      }

      // One event in progress on API, one to come on Website.
      const maintenanceStates: Dictionary<ObjectID> = {};

      for (const state of [
        { name: "Scheduled", order: 1 },
        { name: "Ongoing", order: 2 },
        { name: "Ended", order: 3 },
        { name: "Completed", order: 4 },
      ]) {
        const id: ObjectID = ObjectID.generate();
        maintenanceStates[state.name] = id;

        await insert("ScheduledMaintenanceState", {
          _id: id,
          projectId: projectId,
          name: state.name,
          slug: `${state.name.toLowerCase()}-${id.toString()}`,
          color: "#0000ff",
          order: state.order,
          isScheduledState: state.name === "Scheduled",
          isOngoingState: state.name === "Ongoing",
          isEndedState: state.name === "Ended",
          isResolvedState: state.name === "Completed",
          version: 1,
        });
      }

      for (const event of [
        {
          title: "Database upgrade",
          monitorId: monitors[0]!,
          state: "Ongoing",
          startsAt: hoursAgo(1),
          endsAt: hoursFromNow(1),
        },
        {
          title: "Network work",
          monitorId: monitors[1]!,
          state: "Scheduled",
          startsAt: hoursFromNow(24),
          endsAt: hoursFromNow(26),
        },
      ]) {
        const id: ObjectID = ObjectID.generate();

        await insert("ScheduledMaintenance", {
          _id: id,
          projectId: projectId,
          title: event.title,
          slug: `event-${id.toString()}`,
          currentScheduledMaintenanceStateId: maintenanceStates[event.state]!,
          startsAt: event.startsAt,
          endsAt: event.endsAt,
          isVisibleOnStatusPage: true,
          version: 1,
        });

        await insert("ScheduledMaintenanceMonitor", {
          scheduledMaintenanceId: id,
          monitorId: event.monitorId,
        });

        await insert("ScheduledMaintenanceStatusPage", {
          scheduledMaintenanceId: id,
          statusPageId: statusPageId,
        });

        await insert("ScheduledMaintenanceStateTimeline", {
          _id: ObjectID.generate(),
          projectId: projectId,
          scheduledMaintenanceId: id,
          scheduledMaintenanceStateId: maintenanceStates[event.state]!,
          startsAt: event.startsAt,
          version: 1,
        });

        await insert("ScheduledMaintenancePublicNote", {
          _id: ObjectID.generate(),
          projectId: projectId,
          scheduledMaintenanceId: id,
          note: "Work goes as planned.",
          postedAt: event.startsAt,
          isPublished: true,
          version: 1,
        });
      }

      const announcementId: ObjectID = ObjectID.generate();
      await insert("StatusPageAnnouncement", {
        _id: announcementId,
        projectId: projectId,
        title: "New region",
        description: "We opened a new region.",
        showAnnouncementAt: hoursAgo(2),
        endAnnouncementAt: hoursFromNow(48),
        version: 1,
      });
      await insert("AnnouncementStatusPage", {
        announcementId: announcementId,
        statusPageId: statusPageId,
      });

      return { projectId, statusPageId, domain, activeIncidentId };
    }

    /*
     * Another process of the install: nothing in this one's memory - its
     * caches, the domains and projects it resolved - and the same Redis.
     */
    function becomeAnotherProcess(page: SeededPage): void {
      StatusPageAPI.clearOverviewResponseCache();
      StatusPageService.clearStatusPageDomainToIdCache();
      StatusPageService.clearProjectIdOfStatusPageCache();
      ProjectService.forgetBlockedStatus(page.projectId);
    }

    beforeEach(() => {
      StatusPageAPI.clearOverviewResponseCache();
      StatusPageService.clearStatusPageDomainToIdCache();
      StatusPageService.clearProjectIdOfStatusPageCache();
      redis.clear();
    });

    function makeRequest(data: {
      params: Dictionary<string>;
      body?: JSONObject | undefined;
      host: string;
      headers?: Dictionary<string> | undefined;
    }): ExpressRequest {
      const headers: Dictionary<string> = {
        host: data.host,
        ...(data.headers || {}),
      };

      return {
        params: data.params,
        body: data.body || {},
        query: {},
        cookies: {},
        headers: headers,
        hostname: data.host,
        socket: {},
        ips: [],
        method: "GET",
        get: (name: string): string | undefined => {
          return headers[name.toLowerCase()];
        },
        header: (name: string): string | undefined => {
          return headers[name.toLowerCase()];
        },
      } as unknown as ExpressRequest;
    }

    function makeResponse(answer: Answer): ExpressResponse {
      const response: Record<string, unknown> = {
        headersSent: false,
        locals: {},
        set: (key: string, value: string): unknown => {
          answer.headers[key.toLowerCase()] = String(value);
          return response;
        },
        setHeader: (key: string, value: string): unknown => {
          answer.headers[key.toLowerCase()] = String(value);
          return response;
        },
        getHeader: (key: string): string | undefined => {
          return answer.headers[key.toLowerCase()];
        },
        removeHeader: (key: string): void => {
          delete answer.headers[key.toLowerCase()];
        },
        vary: (): unknown => {
          return response;
        },
        status: (code: number): unknown => {
          answer.status = code;
          return response;
        },
        send: (body: unknown): unknown => {
          answer.body = body;
          return response;
        },
        json: (body: unknown): unknown => {
          answer.body = body;
          return response;
        },
        end: (body?: unknown): unknown => {
          answer.body = body;
          return response;
        },
        writeHead: (code: number, headers?: Dictionary<string>): unknown => {
          answer.status = code;
          for (const key of Object.keys(headers || {})) {
            answer.headers[key.toLowerCase()] = String(headers![key]);
          }
          return response;
        },
        sendFile: (_path: string): void => {
          answer.body = "default favicon";
        },
      };

      return response as unknown as ExpressResponse;
    }

    // Runs a route as Express would: the page's gate first, then the route.
    async function call(data: {
      method: "get" | "post";
      route: string;
      params: Dictionary<string>;
      body?: JSONObject | undefined;
      host: string;
      headers?: Dictionary<string> | undefined;
    }): Promise<Answer> {
      const answer: Answer = {
        status: 200,
        headers: {},
        body: undefined,
        error: undefined,
      };
      const req: ExpressRequest = makeRequest(data);
      const res: ExpressResponse = makeResponse(answer);

      for (const param of mockRouter.params) {
        const value: string | undefined = data.params[param.name];

        if (value === undefined) {
          continue;
        }

        let isLetThrough: boolean = false;

        await new Promise<void>((resolve: () => void) => {
          void param.handler(
            req,
            res,
            ((err?: unknown) => {
              if (err) {
                answer.error = err;
              } else {
                isLetThrough = true;
              }
              resolve();
            }) as NextFunction,
            value,
            param.name,
          );

          // A gate that answers itself never calls next.
          setTimeout(resolve, 50);
        });

        if (!isLetThrough) {
          return answer;
        }
      }

      await mockRouter
        .match(data.method, data.route)
        .handlerFunction(req, res, ((err?: unknown) => {
          answer.error = err;
        }) as NextFunction);

      // Anything a handler left running settles before the count is read.
      await new Promise<void>((resolve: () => void) => {
        setTimeout(resolve, 20);
      });

      return answer;
    }

    // The statements `work` sends, and what it answered.
    async function count<T>(
      work: () => Promise<T>,
    ): Promise<{ statements: Array<string>; result: T }> {
      const before: number = log.statements.length;
      const result: T = await work();
      return { statements: log.statements.slice(before), result: result };
    }

    // A request of a view, and the statements it sent.
    interface CountedAnswer {
      answer: Answer;
      statements: Array<string>;
    }

    // One view of the page on its custom domain, as a browser makes it.
    async function viewOnCustomDomain(
      page: SeededPage,
    ): Promise<Dictionary<CountedAnswer>> {
      const host: string = page.domain;
      const id: string = page.statusPageId.toString();

      const steps: Array<{
        name: string;
        request: () => Promise<Answer>;
      }> = [
        {
          name: "seo",
          request: () => {
            return call({
              method: "get",
              route: ROUTES.seo,
              params: { statusPageIdOrDomain: host },
              host: "localhost",
            });
          },
        },
        {
          name: "domain",
          request: () => {
            return call({
              method: "post",
              route: ROUTES.domain,
              params: {},
              body: { domain: host },
              host: host,
            });
          },
        },
        {
          name: "masterPage",
          request: () => {
            return call({
              method: "post",
              route: ROUTES.masterPage,
              params: { statusPageId: id },
              host: host,
            });
          },
        },
        {
          name: "overview",
          request: () => {
            return call({
              method: "post",
              route: ROUTES.overview,
              params: { statusPageIdOrDomain: id },
              body: { timezone: "Europe/Berlin" },
              host: host,
            });
          },
        },
        {
          name: "favicon",
          request: () => {
            return call({
              method: "get",
              route: ROUTES.favicon,
              params: { statusPageIdOrDomain: host },
              host: host,
            });
          },
        },
      ];

      const counted: Dictionary<CountedAnswer> = {};

      for (const step of steps) {
        const result: { statements: Array<string>; result: Answer } =
          await count(step.request);

        counted[step.name] = {
          answer: result.result,
          statements: result.statements,
        };
      }

      return counted;
    }

    function totals(view: Dictionary<CountedAnswer>): Dictionary<number> {
      const counts: Dictionary<number> = {};
      let total: number = 0;

      for (const [name, step] of Object.entries(view)) {
        counts[name] = step.statements.length;
        total += step.statements.length;
      }

      counts["total"] = total;

      return counts;
    }

    // The counts, in the log, to compare a run with the table at the top.
    function report(title: string, counts: Dictionary<number>): void {
      process.stdout.write(
        `\n[statement counts] ${title}: ${JSON.stringify(counts)}\n`,
      );
    }

    function expectAnswered(view: Dictionary<CountedAnswer>): void {
      for (const [name, step] of Object.entries(view)) {
        expect({ name, error: step.answer.error }).toEqual({
          name,
          error: undefined,
        });
        expect({ name, status: step.answer.status }).toEqual({
          name,
          status: 200,
        });
      }
    }

    /*
     * What a first view may read, request by request, at most: what it read
     * when this was written. The overview is built once per TTL_MS per
     * install (34 statements, 2 of them its uptime history in the visitor's
     * zone); the rest read the page's settings, images and rules once.
     */
    const FIRST_VIEW_BUDGET: Dictionary<number> = {
      // The page's gate (its domain, project, whether that is blocked) and its row.
      seo: 4,
      // Resolved by the /seo request just before.
      domain: 0,
      // Its custom domain, single sign-on, the page with its images, two link lists.
      masterPage: 5,
      // The page's rules of who may read it, and the overview's build.
      overview: 36,
      // The favicon (the rules were read by the overview).
      favicon: 1,
    };

    test("one anonymous view of a public page on its custom domain reads Postgres the first time only", async () => {
      const page: SeededPage = await seedPage();

      const first: Dictionary<CountedAnswer> = await viewOnCustomDomain(page);
      expectAnswered(first);

      // The page as a visitor sees it, read from the database.
      const overview: JSONObject = first["overview"]!.answer.body as JSONObject;
      expect(
        (overview["activeIncidents"] as Array<JSONObject>).map(
          (incident: JSONObject) => {
            return incident["title"];
          },
        ),
      ).toEqual(["Website is slow"]);
      expect(
        (overview["activeAnnouncements"] as Array<JSONObject>).length,
      ).toBe(1);

      const second: Dictionary<CountedAnswer> = await viewOnCustomDomain(page);
      expectAnswered(second);

      report("a view, first", totals(first));
      report("a view, again", totals(second));

      for (const [name, budget] of Object.entries(FIRST_VIEW_BUDGET)) {
        expect({
          name,
          withinBudget: first[name]!.statements.length <= budget,
        }).toEqual({ name, withinBudget: true });
      }

      // Every visitor after the first reads nothing.
      expect(totals(second)).toEqual({
        seo: 0,
        domain: 0,
        masterPage: 0,
        overview: 0,
        favicon: 0,
        total: 0,
      });

      // And is shown the same page.
      expect(second["overview"]!.answer.body).toEqual(
        first["overview"]!.answer.body,
      );
      expect(second["masterPage"]!.answer.body).toEqual(
        first["masterPage"]!.answer.body,
      );
      expect(second["seo"]!.answer.body).toEqual(first["seo"]!.answer.body);
    });

    test("a view in another pod finds the overview built: it reads the page's own settings, never the overview again", async () => {
      const page: SeededPage = await seedPage();

      const first: Dictionary<CountedAnswer> = await viewOnCustomDomain(page);
      expectAnswered(first);

      becomeAnotherProcess(page);

      const elsewhere: Dictionary<CountedAnswer> =
        await viewOnCustomDomain(page);
      expectAnswered(elsewhere);

      report("a view in another pod", totals(elsewhere));

      // The rules of who may read the page; the overview and its history come from Redis.
      expect(elsewhere["overview"]!.statements.length).toBe(1);
      expect(elsewhere["overview"]!.answer.body).toEqual(
        first["overview"]!.answer.body,
      );
      expect(totals(elsewhere)["total"]).toBeLessThanOrEqual(11);
    });

    test("each image a page serves reads Postgres the first time only, and answers 304 to a browser that has it", async () => {
      const page: SeededPage = await seedPage();
      const counts: Dictionary<number> = {};

      for (const [name, route] of Object.entries({
        favicon: ROUTES.favicon,
        logo: ROUTES.logo,
        darkThemeLogo: ROUTES.darkThemeLogo,
        coverImage: ROUTES.coverImage,
      })) {
        let etag: string = "";

        for (const pass of ["first", "again", "has it"]) {
          const headers: Dictionary<string> | undefined =
            pass === "has it" ? { "if-none-match": etag } : undefined;

          const counted: { statements: Array<string>; result: Answer } =
            await count(() => {
              return call({
                method: "get",
                route: route,
                params: { statusPageIdOrDomain: page.domain },
                host: page.domain,
                headers: headers,
              });
            });

          expect(counted.result.error).toBeUndefined();
          expect(counted.result.status).toBe(pass === "has it" ? 304 : 200);
          expect(counted.result.headers["cache-control"]).toBe(
            "public, max-age=300",
          );
          expect(counted.result.headers["etag"]).toMatch(/^"[0-9a-f]{32}"$/);

          etag = counted.result.headers["etag"]!;
          counts[`${name}, ${pass}`] = counted.statements.length;
        }
      }

      report("images", counts);

      // The favicon is asked first: the page's gate, its rules and the image.
      expect(counts["favicon, first"]).toBeLessThanOrEqual(5);

      for (const name of ["logo", "darkThemeLogo", "coverImage"]) {
        expect(counts[`${name}, first`]).toBe(1);
      }

      for (const name of ["favicon", "logo", "darkThemeLogo", "coverImage"]) {
        expect(counts[`${name}, again`]).toBe(0);
        expect(counts[`${name}, has it`]).toBe(0);
      }
    });

    // What a first open of each tab may read, at most.
    const FIRST_LIST_BUDGET: Dictionary<number> = {
      incidents: 17,
      episodes: 8,
      scheduledMaintenance: 13,
      announcements: 5,
    };

    const LISTS: Dictionary<string> = {
      incidents: ROUTES.incidents,
      episodes: ROUTES.episodes,
      scheduledMaintenance: ROUTES.scheduledMaintenance,
      announcements: ROUTES.announcements,
    };

    async function openList(
      page: SeededPage,
      route: string,
    ): Promise<{ statements: Array<string>; result: Answer }> {
      return await count(() => {
        return call({
          method: "post",
          route: route,
          params: { statusPageIdOrDomain: page.statusPageId.toString() },
          host: page.domain,
        });
      });
    }

    test("each list a page's tabs read reads Postgres the first time only, in every pod", async () => {
      const page: SeededPage = await seedPage();
      const counts: Dictionary<number> = {};
      const bodies: Dictionary<unknown> = {};

      for (const [name, route] of Object.entries(LISTS)) {
        for (const pass of ["first", "again"]) {
          const counted: { statements: Array<string>; result: Answer } =
            await openList(page, route);

          expect(counted.result.error).toBeUndefined();
          expect(counted.result.status).toBe(200);
          // Never kept by a cache in front of OneUptime.
          expect(counted.result.headers["cache-control"]).toBe(
            "no-store, no-cache, must-revalidate",
          );

          counts[`${name}, ${pass}`] = counted.statements.length;
          bodies[`${name}, ${pass}`] = counted.result.body;
        }
      }

      becomeAnotherProcess(page);

      for (const [name, route] of Object.entries(LISTS)) {
        const counted: { statements: Array<string>; result: Answer } =
          await openList(page, route);

        expect(counted.result.error).toBeUndefined();
        counts[`${name}, another pod`] = counted.statements.length;
        bodies[`${name}, another pod`] = counted.result.body;
      }

      report("lists", counts);

      for (const [name, budget] of Object.entries(FIRST_LIST_BUDGET)) {
        expect(counts[`${name}, first`]).toBeLessThanOrEqual(budget);
        expect(counts[`${name}, again`]).toBe(0);
        expect(bodies[`${name}, again`]).toEqual(bodies[`${name}, first`]);
        expect(bodies[`${name}, another pod`]).toEqual(
          bodies[`${name}, first`],
        );
      }

      // Another pod reads the page's rules of who may read it once, and no list.
      expect(
        counts["incidents, another pod"]! +
          counts["episodes, another pod"]! +
          counts["scheduledMaintenance, another pod"]! +
          counts["announcements, another pod"]!,
      ).toBeLessThanOrEqual(1 + 3);
    });

    test("an incident opened from a subscriber's email link reads Postgres the first time only; one the page does not show, every time", async () => {
      const page: SeededPage = await seedPage();
      const counts: Dictionary<number> = {};

      const open: (
        incidentId: ObjectID,
      ) => Promise<{ statements: Array<string>; result: Answer }> = async (
        incidentId: ObjectID,
      ): Promise<{ statements: Array<string>; result: Answer }> => {
        return await count(() => {
          return call({
            method: "post",
            route: ROUTES.incident,
            params: {
              statusPageIdOrDomain: page.statusPageId.toString(),
              incidentId: incidentId.toString(),
            },
            host: page.domain,
          });
        });
      };

      const first: { statements: Array<string>; result: Answer } = await open(
        page.activeIncidentId,
      );
      const again: { statements: Array<string>; result: Answer } = await open(
        page.activeIncidentId,
      );

      expect(first.result.error).toBeUndefined();
      expect(
        ((first.result.body as JSONObject)["incidents"] as Array<JSONObject>)
          .length,
      ).toBe(1);
      expect(again.result.body).toEqual(first.result.body);

      const nobodys: ObjectID = ObjectID.generate();
      const unknownFirst: { statements: Array<string>; result: Answer } =
        await open(nobodys);
      const unknownAgain: { statements: Array<string>; result: Answer } =
        await open(nobodys);

      counts["incident, first"] = first.statements.length;
      counts["incident, again"] = again.statements.length;
      counts["an id nobody has, first"] = unknownFirst.statements.length;
      counts["an id nobody has, again"] = unknownAgain.statements.length;

      report("an incident by its id", counts);

      expect(counts["incident, first"]).toBeLessThanOrEqual(16);
      expect(counts["incident, again"]).toBe(0);
      // Never kept: read every time, as before.
      expect(counts["an id nobody has, again"]).toBeGreaterThan(0);
    });

    test("a page made private while its overview and lists are kept is never served from them to a visitor it does not let in", async () => {
      const page: SeededPage = await seedPage();

      // Kept: a view, and the incident list.
      expectAnswered(await viewOnCustomDomain(page));
      expect((await openList(page, ROUTES.incidents)).result.status).toBe(200);

      // The workflow service the update tells is not running here.
      jest.spyOn(API, "post").mockResolvedValue(undefined as never);

      // Made private through the service, as the dashboard does.
      await StatusPageService.updateOneById({
        id: page.statusPageId,
        data: {
          isPublicStatusPage: false,
        },
        props: {
          isRoot: true,
        },
      });

      const view: Dictionary<CountedAnswer> = await viewOnCustomDomain(page);

      // The overview is refused: the visitor is not signed in.
      expect(view["overview"]!.answer.error).toBeDefined();
      expect((view["overview"]!.answer.error as Error).constructor.name).toBe(
        "NotAuthenticatedException",
      );
      expect(view["overview"]!.answer.body).toBeUndefined();

      // So is every list.
      for (const route of Object.values(LISTS)) {
        const counted: { statements: Array<string>; result: Answer } =
          await openList(page, route);

        expect(counted.result.error).toBeDefined();
        expect(counted.result.body).toBeUndefined();
      }

      /*
       * The sign-in page still shows the page's settings and favicon - but
       * no cache in front of OneUptime may keep them any more.
       */
      expect(view["masterPage"]!.answer.status).toBe(200);
      expect(
        (
          (view["masterPage"]!.answer.body as JSONObject)[
            "statusPage"
          ] as JSONObject
        )["isPublicStatusPage"],
      ).toBe(false);
      expect(view["favicon"]!.answer.status).toBe(200);
      expect(view["favicon"]!.answer.headers["cache-control"]).toBe(
        "private, max-age=300",
      );
    });

    test("a page made private in another pod is refused here within SHARED_GENERATION_READ_TTL_MS, while this pod's copies have not run out", async () => {
      const page: SeededPage = await seedPage();

      expectAnswered(await viewOnCustomDomain(page));

      // Another pod makes the page private: the row, and its project's new generation in Redis.
      await database.query(
        `UPDATE "${schema}"."StatusPage" SET "isPublicStatusPage" = false WHERE "_id" = $1`,
        [page.statusPageId.toString()],
      );
      redis.setRaw(
        `${STATUS_PAGE_OVERVIEW_CACHE_NAMESPACE}-generation-${page.projectId
          .toString()
          .toLowerCase()}`,
        "changed-in-another-pod",
      );

      // A second on: every copy this pod keeps is within its life, the generation it read is not.
      const later: number =
        Date.now() + StatusPageOverviewCache.SHARED_GENERATION_READ_TTL_MS + 1;
      const clock: ReturnType<typeof jest.spyOn> = jest
        .spyOn(Date, "now")
        .mockReturnValue(later);

      try {
        const view: Dictionary<CountedAnswer> = await viewOnCustomDomain(page);

        expect((view["overview"]!.answer.error as Error).constructor.name).toBe(
          "NotAuthenticatedException",
        );
        expect(view["overview"]!.answer.body).toBeUndefined();
        expect(view["favicon"]!.answer.headers["cache-control"]).toBe(
          "private, max-age=300",
        );
      } finally {
        clock.mockRestore();
      }
    });
  },
);
