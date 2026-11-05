import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { DataSource } from "typeorm";
import Entities from "../../../Models/DatabaseModels/Index";
import OpenStackProjectNotice from "../../../Models/DatabaseModels/OpenStackProjectNotice";
import OpenStackProjectNoticeDelivery from "../../../Models/DatabaseModels/OpenStackProjectNoticeDelivery";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import StatusPageAPI from "../../../Server/API/StatusPageAPI";
import MonitorStatusTimelineService from "../../../Server/Services/MonitorStatusTimelineService";
import OpenStackProjectNoticeDeliveryService from "../../../Server/Services/OpenStackProjectNoticeDeliveryService";
import OpenStackProjectNoticeService from "../../../Server/Services/OpenStackProjectNoticeService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import JSONWebToken from "../../../Server/Utils/JsonWebToken";
import OpenStackProjectPages from "../../../Server/Utils/OpenStack/OpenStackProjectPages";
import Response from "../../../Server/Utils/Response";
import Dictionary from "../../../Types/Dictionary";
import { JSONObject } from "../../../Types/JSON";
import JsonWebTokenPurpose from "../../../Types/JsonWebTokenPurpose";
import ObjectID from "../../../Types/ObjectID";
import {
  OpenStackProjectNoticeDeliveryStatus,
  OpenStackProjectNoticeEvent,
} from "../../../Types/OpenStack/OpenStackProjectNotice";
import { OpenStackResourceKind } from "../../../Types/OpenStack/OpenStackResourceKind";
import { OpenStackStatusPageService } from "../../../Types/OpenStack/OpenStackStatusPageService";
import {
  OpenStackProjectNoticeMessage,
  writeOpenStackProjectNotice,
} from "../../../Utils/OpenStack/OpenStackProjectNoticeText";
import { mockRouter } from "./Helpers";

/*
 * A PROJECT'S PRIVATE PAGE SHOWS ONLY THAT PROJECT'S, INCLUDING THROUGH ITS API.
 *
 * The real status page endpoints, the real sign-in check and the real SQL behind every read, on a migrated
 * Postgres, with two projects on one host and an incident that names both of them, as a real one does. What
 * each project can read of the other's page, and of the incident, is what this is here to say: nothing.
 *
 * Opt in as OpenStackResourcePostgres.test.ts does (RUN_POSTGRES_OPENSTACK_INVENTORY_TESTS=true and
 * OPENSTACK_INVENTORY_TEST_DATABASE_*). The tables are cloned, structure only, into a schema of their own.
 */
const describePostgres: typeof describe =
  process.env["RUN_POSTGRES_OPENSTACK_INVENTORY_TESTS"] === "true"
    ? describe
    : describe.skip;

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

const TABLES: Array<string> = [
  "Project",
  "ProjectSMTPConfig",
  "ProjectCallSMSConfig",
  "Label",
  "File",
  "StatusPage",
  "StatusPageLabel",
  "StatusPageDownMonitorStatus",
  "StatusPageGroup",
  "StatusPageResource",
  "StatusPageHistoryChartBarColorRule",
  "StatusPagePrivateUser",
  "StatusPagePrivateUserSession",
  "StatusPageAnnouncement",
  "AnnouncementStatusPage",
  "AnnouncementMonitor",
  "StatusPageAnnouncementFile",
  "StatusPageDomain",
  "StatusPageHeaderLink",
  "StatusPageFooterLink",
  "StatusPageSSO",
  "StatusPageOIDC",
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
  "ScheduledMaintenance",
  "ScheduledMaintenanceState",
  "ScheduledMaintenanceStateTimeline",
  "ScheduledMaintenanceStatusPage",
  "ScheduledMaintenanceMonitor",
  "ScheduledMaintenanceLabel",
  "ScheduledMaintenancePublicNote",
  "ScheduledMaintenancePublicNoteFile",
  "OpenStackCloud",
  "OpenStackProjectNotice",
  "OpenStackProjectNoticeDelivery",
];

const OVERVIEW_ROUTE: string = "/status-page/overview/:statusPageIdOrDomain";

// What nothing on project B's page may ever hold.
const WHAT_B_MUST_NEVER_READ: Array<string> = [
  "ou-payments",
  "compute-01",
  "Compute Service Down",
  "OpenStack project",
];

describePostgres(
  "a project's private status page, through its API, on a migrated Postgres",
  () => {
    const schema: string = `openstack_page_${ObjectID.generate().toString().replace(/-/g, "")}`;
    const projectId: ObjectID = ObjectID.generate();
    const cloudId: ObjectID = ObjectID.generate();
    let database: DataSource;

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

    let onlineStatus: ObjectID;
    let offlineStatus: ObjectID;

    interface ProjectPage {
      pageId: ObjectID;
      monitorId: ObjectID;
      userId: ObjectID;
      sessionId: ObjectID;
      notice: OpenStackProjectNotice;
    }

    let pageA: ProjectPage;
    let pageB: ProjectPage;
    let realMonitor: ObjectID;
    let incidentId: ObjectID;

    async function seedPage(data: {
      name: string;
      openStackProjectId: string;
    }): Promise<ProjectPage> {
      const pageId: ObjectID = ObjectID.generate();
      const groupId: ObjectID = ObjectID.generate();
      const monitorId: ObjectID = ObjectID.generate();
      const userId: ObjectID = ObjectID.generate();
      const sessionId: ObjectID = ObjectID.generate();

      await insert("StatusPage", {
        _id: pageId,
        projectId,
        name: data.name,
        slug: `page-${pageId.toString()}`,
        version: 1,
        isPublicStatusPage: false,
        onlyShowScopedIncidents: true,
        showIncidentsOnStatusPage: true,
        showEpisodesOnStatusPage: true,
        showAnnouncementsOnStatusPage: true,
        showScheduledMaintenanceEventsOnStatusPage: true,
      });
      await insert("StatusPageGroup", {
        _id: groupId,
        projectId,
        statusPageId: pageId,
        name: "RegionOne",
        slug: `group-${groupId.toString()}`,
        order: 1,
        version: 1,
      });
      await insert("Monitor", {
        _id: monitorId,
        projectId,
        name: `${data.name} - Compute (RegionOne)`,
        slug: `monitor-${monitorId.toString()}`,
        monitorType: "Manual",
        currentMonitorStatusId: onlineStatus,
        version: 1,
      });
      await insert("StatusPageResource", {
        _id: ObjectID.generate(),
        projectId,
        statusPageId: pageId,
        statusPageGroupId: groupId,
        monitorId,
        displayName: "Compute",
        order: 1,
        showCurrentStatus: true,
        version: 1,
      });
      await insert("StatusPagePrivateUser", {
        _id: userId,
        projectId,
        statusPageId: pageId,
        email: `reader-of-${pageId.toString()}@example.com`,
        version: 1,
      });
      await insert("StatusPagePrivateUserSession", {
        _id: sessionId,
        projectId,
        statusPageId: pageId,
        statusPagePrivateUserId: userId,
        refreshToken: `token-${sessionId.toString()}`,
        refreshTokenExpiresAt: new Date(Date.now() + 60 * 60 * 1000),
        lastActiveAt: new Date(),
        isRevoked: false,
        version: 1,
      });

      const notice: OpenStackProjectNotice = new OpenStackProjectNotice();
      notice.projectId = projectId;
      notice.openStackCloudId = cloudId;
      notice.openStackProjectId = data.openStackProjectId;
      notice.statusPageId = pageId;
      notice.statusPageRows = [
        {
          regionName: "RegionOne",
          service: OpenStackStatusPageService.Compute,
          monitorId: monitorId.toString(),
        },
      ];

      const created: OpenStackProjectNotice =
        await OpenStackProjectNoticeService.create({
          data: notice,
          props: { isRoot: true },
        });
      created._id = created.id!.toString();

      return { pageId, monitorId, userId, sessionId, notice: created };
    }

    function cookieOf(page: ProjectPage, forPage: ObjectID): Dictionary<string> {
      return {
        [`user-token-${forPage.toString()}`]: JSONWebToken.sign({
          data: {
            userId: page.userId,
            email: "reader@example.com",
            statusPageId: page.pageId,
            sessionId: page.sessionId,
          } as never,
          expiresInSeconds: 3600,
          purpose: JsonWebTokenPurpose.StatusPageSession,
        }),
      };
    }

    async function overview(data: {
      pageId: ObjectID;
      cookies: Dictionary<string>;
    }): Promise<{ payload: JSONObject | null; error: unknown }> {
      const req: ExpressRequest = {
        params: { statusPageIdOrDomain: data.pageId.toString() },
        body: {},
        query: {},
        cookies: data.cookies,
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
      const before: number = responseMock.mock.calls.length;

      await mockRouter
        .match("post", OVERVIEW_ROUTE)
        .handlerFunction(req, res, next as unknown as NextFunction);
      await new Promise<void>((resolve: () => void) => {
        setTimeout(resolve, 0);
      });

      if (next.mock.calls.length > 0) {
        return { payload: null, error: next.mock.calls[0]![0] };
      }

      return {
        payload: (responseMock.mock.calls[before]?.[2] as JSONObject) || null,
        error: undefined,
      };
    }

    async function tellPageA(): Promise<void> {
      const facts: JSONObject = {
        event: OpenStackProjectNoticeEvent.IncidentOpened,
        projectId: "payments",
        projectName: "ou-payments",
        partKind: OpenStackResourceKind.Hypervisor,
        partWords: "A compute host",
        service: OpenStackStatusPageService.Compute,
        regionName: "RegionOne",
        holdings: { instanceCount: 3 },
        occurredAt: new Date().toISOString(),
      };
      const row: OpenStackProjectNoticeDelivery =
        new OpenStackProjectNoticeDelivery();
      row._id = ObjectID.generate().toString();
      row.projectId = projectId;
      row.openStackProjectNoticeId = pageA.notice.id!;
      row.event = OpenStackProjectNoticeEvent.IncidentOpened;
      row.dedupeKey = `incident:${incidentId.toString()}:opened`;
      row.partKey = "host:RegionOne/compute-01";
      row.facts = facts;
      row.status = OpenStackProjectNoticeDeliveryStatus.Sending;

      jest
        .spyOn(OpenStackProjectNoticeDeliveryService, "updateOneById")
        .mockResolvedValue(undefined as never);

      const message: OpenStackProjectNoticeMessage =
        writeOpenStackProjectNotice(facts as never);

      await OpenStackProjectPages.tell({
        row,
        notice: pageA.notice,
        message,
      });
    }

    beforeAll(async () => {
      database = new DataSource({
        type: "postgres",
        host:
          process.env["OPENSTACK_INVENTORY_TEST_DATABASE_HOST"] || "localhost",
        port: Number(
          process.env["OPENSTACK_INVENTORY_TEST_DATABASE_PORT"] || "5400",
        ),
        username: process.env["DATABASE_USERNAME"] || "postgres",
        password: process.env["DATABASE_PASSWORD"] || "password",
        database:
          process.env["OPENSTACK_INVENTORY_TEST_DATABASE_NAME"] ||
          process.env["DATABASE_NAME"] ||
          "oneuptimedb",
        entities: Entities,
        schema,
        synchronize: false,
        extra: { options: `-c search_path=${schema},public` },
      });
      await database.initialize();
      await database.query(`CREATE SCHEMA "${schema}"`);

      for (const table of TABLES) {
        await database.query(
          `CREATE TABLE IF NOT EXISTS "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
        );
      }

      jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
      jest
        .spyOn(PostgresAppInstance, "getDataSource")
        .mockReturnValue(database);

      mockRouter.routes.length = 0;
      new StatusPageAPI();

      await insert("Project", {
        _id: projectId,
        name: "Page test",
        slug: `page-${projectId.toString()}`,
        version: 1,
      });
      await insert("OpenStackCloud", {
        _id: cloudId,
        projectId,
        name: "devstack",
        slug: `cloud-${cloudId.toString()}`,
        version: 1,
      });
      onlineStatus = ObjectID.generate();
      offlineStatus = ObjectID.generate();
      await insert("MonitorStatus", {
        _id: onlineStatus,
        projectId,
        name: "Operational",
        slug: "operational",
        color: "#00ff00",
        priority: 1,
        isOperationalState: true,
        isOfflineState: false,
        version: 1,
      });
      await insert("MonitorStatus", {
        _id: offlineStatus,
        projectId,
        name: "Offline",
        slug: "offline",
        color: "#ff0000",
        priority: 2,
        isOperationalState: false,
        isOfflineState: true,
        version: 1,
      });

      const stateId: ObjectID = ObjectID.generate();
      await insert("IncidentState", {
        _id: stateId,
        projectId,
        name: "Created",
        slug: "created",
        color: "#000000",
        order: 1,
        isCreatedState: true,
        isResolvedState: false,
        version: 1,
      });
      const severityId: ObjectID = ObjectID.generate();
      await insert("IncidentSeverity", {
        _id: severityId,
        projectId,
        name: "Critical",
        slug: "critical",
        color: "#ff0000",
        order: 1,
        version: 1,
      });

      pageA = await seedPage({
        name: "ou-payments",
        openStackProjectId: "payments",
      });
      pageB = await seedPage({
        name: "ou-research",
        openStackProjectId: "research",
      });

      // The real monitor and the real incident, on the host both projects are on.
      realMonitor = ObjectID.generate();
      await insert("Monitor", {
        _id: realMonitor,
        projectId,
        name: "devstack - Compute Service Down",
        slug: `monitor-${realMonitor.toString()}`,
        monitorType: "OpenStack",
        currentMonitorStatusId: offlineStatus,
        version: 1,
      });
      incidentId = ObjectID.generate();
      await insert("Incident", {
        _id: incidentId,
        projectId,
        title: "[OpenStack] Compute Service Down - Host: compute-01",
        description:
          "**What this affects:** 4 instances in 2 projects.\n\n- ou-payments: 3 instances (OpenStack project `payments`)\n- ou-research: 1 instance (OpenStack project `research`)",
        slug: incidentId.toString(),
        currentIncidentStateId: stateId,
        incidentSeverityId: severityId,
        isVisibleOnStatusPage: true,
        isPrivate: false,
        isScopedToStatusPages: false,
        version: 1,
      });
      await insert("IncidentMonitor", {
        incidentId,
        monitorId: realMonitor,
      });

      // Turning a row is MonitorStatusTimelineService's own: here, what it comes to.
      jest
        .spyOn(MonitorStatusTimelineService, "create")
        .mockImplementation((async (args: {
          data: { monitorId: ObjectID; monitorStatusId: ObjectID };
        }) => {
          await database.query(
            `UPDATE "${schema}"."Monitor" SET "currentMonitorStatusId" = $2 WHERE "_id" = $1`,
            [
              args.data.monitorId.toString(),
              args.data.monitorStatusId.toString(),
            ],
          );
        }) as never);
    });

    afterAll(async () => {
      jest.restoreAllMocks();
      StatusPageAPI.clearOverviewResponseCache();
      if (database?.isInitialized) {
        await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await database.destroy();
      }
    });

    beforeEach(() => {
      StatusPageAPI.clearOverviewResponseCache();
    });

    test("nobody signed in reads either page", async () => {
      for (const page of [pageA, pageB]) {
        const read: { payload: JSONObject | null; error: unknown } =
          await overview({ pageId: page.pageId, cookies: {} });

        expect(read.payload).toBeNull();
        expect(read.error).toBeDefined();
      }
    });

    test("a reader of one project's page can't read the other's, even holding their own session under its name", async () => {
      const read: { payload: JSONObject | null; error: unknown } =
        await overview({
          pageId: pageA.pageId,
          // B's session, in the cookie A's page reads.
          cookies: cookieOf(pageB, pageA.pageId),
        });

      expect(read.payload).toBeNull();
      expect(read.error).toBeDefined();
    });

    test("told of a failure that reaches A, A's page reads it, and only in A's words", async () => {
      await tellPageA();
      StatusPageAPI.clearOverviewResponseCache();

      const read: { payload: JSONObject | null; error: unknown } =
        await overview({
          pageId: pageA.pageId,
          cookies: cookieOf(pageA, pageA.pageId),
        });

      expect(read.error).toBeUndefined();
      const text: string = JSON.stringify(read.payload);

      expect(text).toContain("3 instances");
      expect(text).toContain("A compute host");
      // Its row is red.
      const monitors: Array<{ currentMonitorStatusId: string }> =
        await database.query(
          `SELECT "currentMonitorStatusId" FROM "${schema}"."Monitor" WHERE "_id" = $1`,
          [pageA.monitorId.toString()],
        );
      expect(monitors[0]!.currentMonitorStatusId).toBe(offlineStatus.toString());

      // And nothing of the other project, or of the incident that names both, or of the host.
      for (const word of [
        "ou-research",
        "compute-01",
        "Compute Service Down",
        "OpenStack project",
      ]) {
        expect(text).not.toContain(word);
      }
    });

    test("B's page, read by B, holds nothing of A's and nothing of the incident", async () => {
      const read: { payload: JSONObject | null; error: unknown } =
        await overview({
          pageId: pageB.pageId,
          cookies: cookieOf(pageB, pageB.pageId),
        });

      expect(read.error).toBeUndefined();
      const text: string = JSON.stringify(read.payload);

      // Its own row, which is all it has.
      expect(text).toContain('"displayName":"Compute"');
      for (const word of WHAT_B_MUST_NEVER_READ) {
        expect(text).not.toContain(word);
      }
      expect(text).not.toContain(incidentId.toString());
      expect(text).not.toContain(realMonitor.toString());
      expect(text).not.toContain(pageA.monitorId.toString());
      expect(text).not.toContain("3 instances");

      // Its own row is untouched.
      const monitors: Array<{ currentMonitorStatusId: string }> =
        await database.query(
          `SELECT "currentMonitorStatusId" FROM "${schema}"."Monitor" WHERE "_id" = $1`,
          [pageB.monitorId.toString()],
        );
      expect(monitors[0]!.currentMonitorStatusId).toBe(onlineStatus.toString());
    });
  },
);
