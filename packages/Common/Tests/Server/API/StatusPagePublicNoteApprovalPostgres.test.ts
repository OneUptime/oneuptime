import Entities from "../../../Models/DatabaseModels/Index";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import StatusPageAPI from "../../../Server/API/StatusPageAPI";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import Dictionary from "../../../Types/Dictionary";
import { JSONArray, JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { PublicNoteApprovalStatus } from "../../../Types/StatusPage/PublicNoteApproval";
import { mockRouter } from "./Helpers";
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

/*
 * A PUBLIC NOTE IS ON STATUS PAGES ONLY ONCE IT IS PUBLISHED (issue #5720),
 * with the real SQL of every public status page read.
 *
 * Notes of an incident, an episode and a scheduled maintenance event, in
 * every state a note can be in: published before approval existed (the
 * column's default), approved, waiting for approval, rejected, and
 * published with an edit waiting. Every route a page reads them through -
 * the overview, the incident, episode and maintenance lists and each one
 * opened - shows the published ones, the edited one as it was approved,
 * and nothing of the rest: not the note, not the waiting edit, not a word
 * of where it stands in approval. PublicNotePublishedGateGuard holds the
 * source to this; this shows the database does what the source asks.
 *
 * Opt in with RUN_POSTGRES_PUBLIC_NOTE_APPROVAL_TESTS=true against a
 * database the registered migrations have been applied to, e.g.
 *
 *   RUN_POSTGRES_PUBLIC_NOTE_APPROVAL_TESTS=true \
 *   PUBLIC_NOTE_APPROVAL_TEST_DATABASE_HOST=127.0.0.1 \
 *   PUBLIC_NOTE_APPROVAL_TEST_DATABASE_PORT=5400 \
 *   DATABASE_PASSWORD=... npx jest Tests/Server/API/StatusPagePublicNoteApprovalPostgres.test.ts
 *
 * The tables it writes are cloned, structure only (LIKE ... INCLUDING ALL),
 * into a uniquely named schema that search_path puts first; no row is
 * written outside it, and it is dropped afterwards.
 */
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_PUBLIC_NOTE_APPROVAL_TESTS"] === "true"
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
  "Monitor",
  "MonitorStatus",
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
  "ScheduledMaintenanceStatusPage",
  "ScheduledMaintenanceMonitor",
  "ScheduledMaintenanceLabel",
  "ScheduledMaintenanceStateTimeline",
  "ScheduledMaintenancePublicNote",
  "ScheduledMaintenancePublicNoteFile",
];

const OVERVIEW_ROUTE: string = "/status-page/overview/:statusPageIdOrDomain";
const INCIDENTS_ROUTE: string = "/status-page/incidents/:statusPageIdOrDomain";
const INCIDENT_DETAIL_ROUTE: string = `${INCIDENTS_ROUTE}/:incidentId`;
const EPISODES_ROUTE: string = "/status-page/episodes/:statusPageIdOrDomain";
const EPISODE_DETAIL_ROUTE: string = `${EPISODES_ROUTE}/:episodeId`;
const MAINTENANCE_ROUTE: string =
  "/status-page/scheduled-maintenance-events/:statusPageIdOrDomain";
const MAINTENANCE_DETAIL_ROUTE: string = `${MAINTENANCE_ROUTE}/:scheduledMaintenanceId`;

// What each note says, by the state it is in.
const PUBLISHED_BEFORE_APPROVAL: string = "Published before approval existed.";
const APPROVED: string = "Approved and published.";
const WAITING: string = "Waiting for approval - not yet public.";
const REJECTED: string = "Rejected - never public.";
const EDITED_AS_APPROVED: string = "Published, as it was approved.";
const EDIT_WAITING: string = "An edit waiting for approval - not yet public.";

const SHOWN: Array<string> = [
  PUBLISHED_BEFORE_APPROVAL,
  APPROVED,
  EDITED_AS_APPROVED,
].sort();

const NEVER_SHOWN: Array<string> = [WAITING, REJECTED, EDIT_WAITING];

describePostgres(
  "The status page shows published public notes only, against a migrated Postgres",
  () => {
    const schema: string = `public_note_approval_${ObjectID.generate()
      .toString()
      .replace(/-/g, "")}`;

    const projectId: ObjectID = ObjectID.generate();

    let database: DataSource;
    let statusPageId: ObjectID;
    let incidentId: ObjectID;
    let episodeId: ObjectID;
    let maintenanceId: ObjectID;

    beforeAll(async () => {
      database = new DataSource({
        type: "postgres",
        host:
          process.env["PUBLIC_NOTE_APPROVAL_TEST_DATABASE_HOST"] || "localhost",
        port: Number(
          process.env["PUBLIC_NOTE_APPROVAL_TEST_DATABASE_PORT"] || "5400",
        ),
        username: process.env["DATABASE_USERNAME"] || "postgres",
        password: process.env["DATABASE_PASSWORD"] || "password",
        database:
          process.env["PUBLIC_NOTE_APPROVAL_TEST_DATABASE_NAME"] ||
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
          `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
        );
      }

      const currentSchema: Array<{ current_schema: string }> =
        await database.query("SELECT current_schema()");
      expect(currentSchema[0]?.current_schema).toBe(schema);

      jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
      jest
        .spyOn(PostgresAppInstance, "getDataSource")
        .mockReturnValue(database);

      mockRouter.routes.length = 0;
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

    /*
     * One note of each state on a record. The first is written as every
     * note was before approval existed - no approval column at all - so the
     * column's default is what publishes it.
     */
    async function seedNotes(
      table: string,
      parentColumn: string,
      parentId: ObjectID,
    ): Promise<void> {
      const minutesAgo: (minutes: number) => Date = (
        minutes: number,
      ): Date => {
        return new Date(Date.now() - minutes * 60 * 1000);
      };

      const base: (note: string, minutes: number) => Dictionary<unknown> = (
        note: string,
        minutes: number,
      ): Dictionary<unknown> => {
        return {
          _id: ObjectID.generate(),
          projectId: projectId,
          [parentColumn]: parentId,
          note: note,
          postedAt: minutesAgo(minutes),
          version: 1,
        };
      };

      await insert(table, base(PUBLISHED_BEFORE_APPROVAL, 50));
      await insert(table, {
        ...base(APPROVED, 40),
        isPublished: true,
        approvalStatus: PublicNoteApprovalStatus.Approved,
        approval: JSON.stringify({
          submittedAt: minutesAgo(45).toISOString(),
          isEdit: false,
          approvals: [],
        }),
      });
      await insert(table, {
        ...base(WAITING, 30),
        isPublished: false,
        approvalStatus: PublicNoteApprovalStatus.WaitingForApproval,
        approval: JSON.stringify({
          submittedAt: minutesAgo(30).toISOString(),
          isEdit: false,
          approvals: [],
        }),
      });
      await insert(table, {
        ...base(REJECTED, 20),
        isPublished: false,
        approvalStatus: PublicNoteApprovalStatus.Rejected,
        approval: JSON.stringify({
          submittedAt: minutesAgo(25).toISOString(),
          isEdit: false,
          approvals: [],
          rejection: {
            userId: ObjectID.generate().toString(),
            at: minutesAgo(20).toISOString(),
            reason: "Do not name the vendor.",
          },
        }),
      });
      await insert(table, {
        ...base(EDITED_AS_APPROVED, 10),
        isPublished: true,
        approvalStatus: PublicNoteApprovalStatus.WaitingForApproval,
        pendingNote: EDIT_WAITING,
        approval: JSON.stringify({
          submittedAt: minutesAgo(5).toISOString(),
          isEdit: true,
          approvals: [],
        }),
      });
    }

    beforeEach(async () => {
      StatusPageAPI.clearOverviewResponseCache();

      await database.query(
        TABLES.map((table: string): string => {
          return `DELETE FROM "${schema}"."${table}"`;
        })
          .reverse()
          .join("; "),
      );

      await insert("Project", {
        _id: projectId,
        name: "Public note approval test",
        slug: `public-note-approval-${projectId.toString()}`,
        version: 1,
      });

      statusPageId = ObjectID.generate();
      await insert("StatusPage", {
        _id: statusPageId,
        projectId: projectId,
        name: "Status",
        slug: `page-${statusPageId.toString()}`,
        version: 1,
        isPublicStatusPage: true,
        showIncidentsOnStatusPage: true,
        showEpisodesOnStatusPage: true,
        showAnnouncementsOnStatusPage: false,
        showScheduledMaintenanceEventsOnStatusPage: true,
      });

      const monitorId: ObjectID = ObjectID.generate();
      await insert("Monitor", {
        _id: monitorId,
        projectId: projectId,
        name: "Checkout",
        slug: `monitor-${monitorId.toString()}`,
        monitorType: "Manual",
        currentMonitorStatusId: ObjectID.generate(),
        version: 1,
      });
      await insert("StatusPageResource", {
        _id: ObjectID.generate(),
        projectId: projectId,
        statusPageId: statusPageId,
        monitorId: monitorId,
        displayName: "Checkout",
        order: 1,
        version: 1,
        showStatusHistoryChart: false,
        showUptimePercent: false,
      });

      const investigating: ObjectID = ObjectID.generate();
      await insert("IncidentState", {
        _id: investigating,
        projectId: projectId,
        name: "Investigating",
        slug: `investigating-${investigating.toString()}`,
        color: "#000000",
        order: 1,
        isResolvedState: false,
        isCreatedState: true,
        version: 1,
      });

      incidentId = ObjectID.generate();
      await insert("Incident", {
        _id: incidentId,
        projectId: projectId,
        title: "Checkout is down",
        slug: `incident-${incidentId.toString()}`,
        currentIncidentStateId: investigating,
        incidentSeverityId: ObjectID.generate(),
        version: 1,
        createdAt: new Date(Date.now() - 60 * 60 * 1000),
        declaredAt: new Date(Date.now() - 60 * 60 * 1000),
        isVisibleOnStatusPage: true,
        isPrivate: false,
        isScopedToStatusPages: false,
        statusPagesNotifiedOnCreation: JSON.stringify([]),
      });
      await insert("IncidentMonitor", {
        incidentId: incidentId,
        monitorId: monitorId,
      });
      await seedNotes("IncidentPublicNote", "incidentId", incidentId);

      episodeId = ObjectID.generate();
      await insert("IncidentEpisode", {
        _id: episodeId,
        projectId: projectId,
        title: "Checkout episode",
        currentIncidentStateId: investigating,
        isVisibleOnStatusPage: true,
        isPrivate: false,
        declaredAt: new Date(),
        version: 1,
      });
      await insert("IncidentEpisodeMember", {
        _id: ObjectID.generate(),
        projectId: projectId,
        incidentEpisodeId: episodeId,
        incidentId: incidentId,
        version: 1,
      });
      await seedNotes(
        "IncidentEpisodePublicNote",
        "incidentEpisodeId",
        episodeId,
      );

      const ongoing: ObjectID = ObjectID.generate();
      await insert("ScheduledMaintenanceState", {
        _id: ongoing,
        projectId: projectId,
        name: "Ongoing",
        slug: `ongoing-${ongoing.toString()}`,
        color: "#000000",
        order: 2,
        isOngoingState: true,
        version: 1,
      });

      maintenanceId = ObjectID.generate();
      await insert("ScheduledMaintenance", {
        _id: maintenanceId,
        projectId: projectId,
        title: "Database upgrade",
        slug: `maintenance-${maintenanceId.toString()}`,
        currentScheduledMaintenanceStateId: ongoing,
        startsAt: new Date(Date.now() - 30 * 60 * 1000),
        endsAt: new Date(Date.now() + 30 * 60 * 1000),
        isVisibleOnStatusPage: true,
        version: 1,
      });
      await insert("ScheduledMaintenanceStatusPage", {
        scheduledMaintenanceId: maintenanceId,
        statusPageId: statusPageId,
      });
      await insert("ScheduledMaintenanceMonitor", {
        scheduledMaintenanceId: maintenanceId,
        monitorId: monitorId,
      });
      await seedNotes(
        "ScheduledMaintenancePublicNote",
        "scheduledMaintenanceId",
        maintenanceId,
      );

      (Response.sendJsonObjectResponse as unknown as jest.Mock).mockClear();
    });

    async function getJson(
      route: string,
      params: Dictionary<string>,
    ): Promise<JSONObject> {
      const req: ExpressRequest = {
        params,
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
        .match("post", route)
        .handlerFunction(req, res, next as unknown as NextFunction);
      await new Promise<void>((resolve: () => void) => {
        setTimeout(resolve, 0);
      });

      expect(next.mock.calls[0]?.[0]).toBeUndefined();

      const payload: JSONObject | undefined = responseMock.mock.calls[
        previousResponseCount
      ]?.[2] as JSONObject | undefined;

      expect(payload).toBeDefined();
      return payload!;
    }

    function notesOf(payload: JSONObject, key: string): Array<string> {
      return ((payload[key] as JSONArray) || [])
        .map((note: unknown): string => {
          return String((note as JSONObject)["note"]);
        })
        .sort();
    }

    // Nothing of a note's approval, and nothing a published note does not say.
    function expectNothingUnpublished(payload: JSONObject): void {
      const text: string = JSON.stringify(payload);

      for (const words of [...NEVER_SHOWN, "Do not name the vendor."]) {
        expect(text).not.toContain(words);
      }

      for (const column of [
        "pendingNote",
        "approvalStatus",
        "approval",
        "isPublished",
      ]) {
        expect(text).not.toContain(`"${column}":`);
      }
    }

    test("the overview shows each record's published notes, and the edited one as it was approved", async () => {
      const overview: JSONObject = await getJson(OVERVIEW_ROUTE, {
        statusPageIdOrDomain: statusPageId.toString(),
      });

      expect(notesOf(overview, "incidentPublicNotes")).toEqual(SHOWN);
      expect(notesOf(overview, "episodePublicNotes")).toEqual(SHOWN);
      expect(
        notesOf(overview, "scheduledMaintenanceEventsPublicNotes"),
      ).toEqual(SHOWN);
      expectNothingUnpublished(overview);
    });

    test("the incident list and the incident opened show only its published notes", async () => {
      for (const [route, params] of [
        [INCIDENTS_ROUTE, { statusPageIdOrDomain: statusPageId.toString() }],
        [
          INCIDENT_DETAIL_ROUTE,
          {
            statusPageIdOrDomain: statusPageId.toString(),
            incidentId: incidentId.toString(),
          },
        ],
      ] as Array<[string, Dictionary<string>]>) {
        const payload: JSONObject = await getJson(route, params);

        expect(notesOf(payload, "incidentPublicNotes")).toEqual(SHOWN);
        expectNothingUnpublished(payload);
      }
    });

    test("the episode list and the episode opened show only its published notes", async () => {
      for (const [route, params] of [
        [EPISODES_ROUTE, { statusPageIdOrDomain: statusPageId.toString() }],
        [
          EPISODE_DETAIL_ROUTE,
          {
            statusPageIdOrDomain: statusPageId.toString(),
            episodeId: episodeId.toString(),
          },
        ],
      ] as Array<[string, Dictionary<string>]>) {
        const payload: JSONObject = await getJson(route, params);

        expect(notesOf(payload, "episodePublicNotes")).toEqual(SHOWN);
        expectNothingUnpublished(payload);
      }
    });

    test("the maintenance list and the event opened show only its published notes", async () => {
      for (const [route, params] of [
        [MAINTENANCE_ROUTE, { statusPageIdOrDomain: statusPageId.toString() }],
        [
          MAINTENANCE_DETAIL_ROUTE,
          {
            statusPageIdOrDomain: statusPageId.toString(),
            scheduledMaintenanceId: maintenanceId.toString(),
          },
        ],
      ] as Array<[string, Dictionary<string>]>) {
        const payload: JSONObject = await getJson(route, params);

        expect(notesOf(payload, "scheduledMaintenanceEventsPublicNotes")).toEqual(
          SHOWN,
        );
        expectNothingUnpublished(payload);
      }
    });

    test("a note approved is shown from then on; one still waiting, never", async () => {
      await database.query(
        `UPDATE "${schema}"."IncidentPublicNote" SET "isPublished" = true, "approvalStatus" = $1 WHERE "note" = $2`,
        [PublicNoteApprovalStatus.Approved, WAITING],
      );
      StatusPageAPI.clearOverviewResponseCache();

      const payload: JSONObject = await getJson(INCIDENT_DETAIL_ROUTE, {
        statusPageIdOrDomain: statusPageId.toString(),
        incidentId: incidentId.toString(),
      });

      expect(notesOf(payload, "incidentPublicNotes")).toEqual(
        [...SHOWN, WAITING].sort(),
      );
      expect(JSON.stringify(payload)).not.toContain(REJECTED);
    });
  },
);
