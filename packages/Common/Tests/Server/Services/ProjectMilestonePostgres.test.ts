import Entities from "../../../Models/DatabaseModels/Index";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import ProjectMilestoneService, {
  ReachedMilestone,
  Service as ProjectMilestoneServiceClass,
} from "../../../Server/Services/ProjectMilestoneService";
import TeamMemberService from "../../../Server/Services/TeamMemberService";
import ProjectMilestoneBackfill, {
  ProjectMilestoneBackfillResult,
} from "../../../Server/Utils/Activation/ProjectMilestoneBackfill";
import logger from "../../../Server/Utils/Logger";
import ProductAnalytics from "../../../Server/Utils/ProductAnalytics";
import ActivationMilestone from "../../../Types/Analytics/ActivationMilestone";
import ObjectID from "../../../Types/ObjectID";
import ProductType from "../../../Types/MeteredPlan/ProductType";
import { ON_CALL_POLICY_ARCHIVED_NOT_EXECUTED_MESSAGE } from "../../../Types/OnCallDutyPolicy/OnCallDutyPolicyArchive";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { DataSource } from "typeorm";
import { dropSchemaOneTableAtATime } from "../../Helpers/DropSchemaOneTableAtATime";

/*
 * ACTIVATION MILESTONES, HELD BY A REAL, MIGRATED POSTGRES (issue #6830).
 *
 * What only Postgres can show:
 *
 *  - a milestone is kept once: the unique (projectId, milestone) index and
 *    INSERT ... ON CONFLICT DO NOTHING keep exactly one row, and exactly one
 *    caller hears it kept it - however many servers race for it;
 *  - a project that does not exist keeps nothing, and a deleted project's
 *    milestones go with it;
 *  - the second-member count counts people, not memberships;
 *  - the backfill reads every source as the live hooks count - a person's
 *    acknowledgement, not a monitor's; a policy's run, not a direct page or
 *    an archived policy's log; a confirmed subscriber; the second person -
 *    marks its rows backfilled, and never overwrites a milestone kept live.
 *
 * Opt in with RUN_POSTGRES_PROJECT_MILESTONE_TESTS=true against a Postgres
 * migrated to the current head (the Postgres Schema Drift workflow's
 * database, right after its drift check). The tables it uses are cloned
 * into a unique schema, first on the search_path, and dropped afterwards;
 * ProjectMilestone gets its foreign key to Project there, as the migration
 * gives it. Credentials from DATABASE_USERNAME / DATABASE_PASSWORD, database
 * from PROJECT_MILESTONE_TEST_DATABASE_NAME or DATABASE_NAME, endpoint from
 * PROJECT_MILESTONE_TEST_DATABASE_HOST / _PORT (default localhost:5400).
 */
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_PROJECT_MILESTONE_TESTS"] === "true"
    ? describe
    : describe.skip;

const TABLES: Array<string> = [
  "Project",
  "ProjectMilestone",
  "Monitor",
  "MonitorProbe",
  "UserOnCallLogTimeline",
  "IncidentState",
  "IncidentStateTimeline",
  "AlertState",
  "AlertStateTimeline",
  "TeamMember",
  "StatusPageResource",
  "StatusPageSubscriber",
  "OnCallDutyPolicyExecutionLog",
  "TelemetryUsageBilling",
];

const SCHEMA_NAME_DASHES: RegExp = /-/g;

const at: (minutes: number) => Date = (minutes: number): Date => {
  return new Date(Date.UTC(2026, 9, 1, 9, 0, 0) + minutes * 60 * 1000);
};

describePostgres("activation milestones, on a migrated Postgres", () => {
  const schema: string = `project_milestone_${ObjectID.generate()
    .toString()
    .replace(SCHEMA_NAME_DASHES, "")}`;

  let database: DataSource;

  const insertProject: (createdAt?: Date) => Promise<string> = async (
    createdAt?: Date,
  ): Promise<string> => {
    const id: string = ObjectID.generate().toString();

    await database.query(
      `INSERT INTO "Project" ("_id", "version", "name", "slug", "createdAt", "planName", "createdOwnerEmail") VALUES ($1, 1, $2, $2, $3, 'Growth', 'owner@example.com')`,
      [id, `project-${id}`, createdAt || at(0)],
    );

    return id;
  };

  const milestonesOf: (
    projectId: string,
  ) => Promise<
    Array<{ milestone: string; reachedAt: Date; wasBackfilled: boolean }>
  > = async (
    projectId: string,
  ): Promise<
    Array<{ milestone: string; reachedAt: Date; wasBackfilled: boolean }>
  > => {
    return await database.query(
      `SELECT "milestone", "reachedAt", "wasBackfilled" FROM "ProjectMilestone" WHERE "projectId" = $1 ORDER BY "milestone"`,
      [projectId],
    );
  };

  beforeAll(async () => {
    database = new DataSource({
      type: "postgres",
      host: process.env["PROJECT_MILESTONE_TEST_DATABASE_HOST"] || "localhost",
      port: Number(
        process.env["PROJECT_MILESTONE_TEST_DATABASE_PORT"] || "5400",
      ),
      username: process.env["DATABASE_USERNAME"] || "postgres",
      password: process.env["DATABASE_PASSWORD"] || "password",
      database:
        process.env["PROJECT_MILESTONE_TEST_DATABASE_NAME"] ||
        process.env["DATABASE_NAME"] ||
        "oneuptimedb",
      entities: Entities,
      schema,
      synchronize: false,
      extra: {
        options: `-c search_path=${schema},public`,
        max: 20,
      },
    });
    await database.initialize();
    await database.query(`CREATE SCHEMA "${schema}"`);

    for (const table of TABLES) {
      await database.query(
        `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
      );
    }

    // The migration's foreign key, which LIKE does not copy.
    await database.query(
      `ALTER TABLE "${schema}"."ProjectMilestone" ADD CONSTRAINT "FK_project_milestone_project" FOREIGN KEY ("projectId") REFERENCES "${schema}"."Project"("_id") ON DELETE CASCADE`,
    );

    expect(
      (await database.query("SELECT current_schema()"))[0].current_schema,
    ).toBe(schema);
  }, 300000);

  afterAll(async () => {
    if (database?.isInitialized) {
      await dropSchemaOneTableAtATime(database, schema);
      await database.destroy();
    }
  });

  beforeEach(() => {
    jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
    jest.spyOn(PostgresAppInstance, "getDataSource").mockReturnValue(database);
    jest.spyOn(ProductAnalytics, "isConfigured").mockReturnValue(true);
    jest.spyOn(ProductAnalytics, "capture").mockImplementation((): void => {
      return undefined;
    });
    jest.spyOn(logger, "error").mockImplementation((() => {
      return undefined;
    }) as never);
    ProjectMilestoneService.forgetKnownMilestones();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("reach", () => {
    test("keeps a milestone once: one row, live, and true only for the call that wrote it", async () => {
      const projectId: string = await insertProject(at(0));

      expect(
        await ProjectMilestoneService.reach({
          projectId,
          milestone: ActivationMilestone.FirstMonitorCreated,
          reachedAt: at(7),
        }),
      ).toBe(true);

      // Another server, which does not know: the row is found there.
      expect(
        await new ProjectMilestoneServiceClass().reach({
          projectId,
          milestone: ActivationMilestone.FirstMonitorCreated,
          reachedAt: at(9),
        }),
      ).toBe(false);

      expect(await milestonesOf(projectId)).toEqual([
        {
          milestone: "first_monitor_created",
          reachedAt: at(7),
          wasBackfilled: false,
        },
      ]);
    });

    test("twelve servers racing for the same milestone keep one row, and one of them hears it kept it", async () => {
      const projectId: string = await insertProject();

      const results: Array<boolean> = await Promise.all(
        new Array(12).fill(0).map(() => {
          return new ProjectMilestoneServiceClass().reach({
            projectId,
            milestone: ActivationMilestone.FirstLogsReceived,
          });
        }),
      );

      expect(
        results.filter((kept: boolean): boolean => {
          return kept;
        }),
      ).toHaveLength(1);
      expect(await milestonesOf(projectId)).toHaveLength(1);
      expect(ProductAnalytics.capture).toHaveBeenCalledTimes(1);
    });

    test("the event of the call that kept it says how long after the project's creation, from the project's own row", async () => {
      const projectId: string = await insertProject(at(0));

      await ProjectMilestoneService.reach({
        projectId,
        milestone: ActivationMilestone.FirstCheckResultReceived,
        reachedAt: at(90),
      });

      expect(ProductAnalytics.capture).toHaveBeenCalledWith(
        expect.objectContaining({
          event: "activation/first_check_result_received",
          distinctId: "owner@example.com",
          properties: {
            project_id: projectId,
            plan: "Growth",
            edition: ProjectMilestoneServiceClass.getEdition(),
            milestone: "first_check_result_received",
            seconds_since_project_created: 90 * 60,
          },
        }),
      );
    });

    test("a project that does not exist keeps nothing and throws nothing; a deleted project's milestones go with it", async () => {
      const missing: string = ObjectID.generate().toString();

      expect(
        await ProjectMilestoneService.reach({
          projectId: missing,
          milestone: ActivationMilestone.FirstMonitorCreated,
        }),
      ).toBe(false);
      expect(await milestonesOf(missing)).toEqual([]);
      expect(ProductAnalytics.capture).not.toHaveBeenCalled();

      const projectId: string = await insertProject();

      await ProjectMilestoneService.reach({
        projectId,
        milestone: ActivationMilestone.SecondMemberJoined,
      });
      expect(await milestonesOf(projectId)).toHaveLength(1);

      await database.query(`DELETE FROM "Project" WHERE "_id" = $1`, [
        projectId,
      ]);

      expect(await milestonesOf(projectId)).toEqual([]);
    });

    test("getReachedMilestones reads a project's milestones, oldest first", async () => {
      const projectId: string = await insertProject();

      await ProjectMilestoneService.reach({
        projectId,
        milestone: ActivationMilestone.FirstCheckResultReceived,
        reachedAt: at(30),
      });
      await ProjectMilestoneService.reach({
        projectId,
        milestone: ActivationMilestone.FirstMonitorCreated,
        reachedAt: at(10),
      });

      const reached: Array<ReachedMilestone> =
        await ProjectMilestoneService.getReachedMilestones(
          new ObjectID(projectId),
        );

      expect(reached).toEqual([
        {
          milestone: ActivationMilestone.FirstMonitorCreated,
          reachedAt: at(10),
          wasBackfilled: false,
        },
        {
          milestone: ActivationMilestone.FirstCheckResultReceived,
          reachedAt: at(30),
          wasBackfilled: false,
        },
      ]);
    });
  });

  test("hasTwoAcceptedMembers counts people, not memberships, and only people who accepted", async () => {
    const projectId: string = await insertProject();
    const first: string = ObjectID.generate().toString();
    const second: string = ObjectID.generate().toString();

    const addMember: (
      userId: string,
      accepted: boolean,
    ) => Promise<void> = async (
      userId: string,
      accepted: boolean,
    ): Promise<void> => {
      await database.query(
        `INSERT INTO "TeamMember" ("version", "projectId", "userId", "teamId", "hasAcceptedInvitation") VALUES (1, $1, $2, $3, $4)`,
        [projectId, userId, ObjectID.generate().toString(), accepted],
      );
    };

    await addMember(first, true);
    await addMember(first, true);
    await addMember(second, false);

    expect(
      await TeamMemberService.hasTwoAcceptedMembers(new ObjectID(projectId)),
    ).toBe(false);

    await addMember(second, true);

    expect(
      await TeamMemberService.hasTwoAcceptedMembers(new ObjectID(projectId)),
    ).toBe(true);
  });

  describe("the backfill", () => {
    let seeded: string;
    let empty: string;
    let liveAlready: string;

    beforeAll(async () => {
      seeded = await insertProject(at(0));
      empty = await insertProject(at(0));
      liveAlready = await insertProject(at(0));

      const user: string = ObjectID.generate().toString();
      const otherUser: string = ObjectID.generate().toString();
      const thirdUser: string = ObjectID.generate().toString();
      const status: string = ObjectID.generate().toString();

      // Monitors: the first one counts.
      for (const minutes of [20, 10]) {
        await database.query(
          `INSERT INTO "Monitor" ("version", "projectId", "name", "slug", "monitorType", "currentMonitorStatusId", "createdAt") VALUES (1, $1, $2, $2, 'Website', $3, $4)`,
          [seeded, `monitor-${minutes}`, status, at(minutes)],
        );
      }

      // A monitor a probe has checked counts; one handed to no probe yet does not.
      await database.query(
        `INSERT INTO "MonitorProbe" ("version", "projectId", "probeId", "monitorId", "createdAt", "lastPingAt") VALUES (1, $1, $2, $3, $4, NULL), (1, $1, $2, $3, $5, $6)`,
        [
          seeded,
          ObjectID.generate().toString(),
          ObjectID.generate().toString(),
          at(11),
          at(12),
          at(13),
        ],
      );

      // An on-call page: one still sending does not count, one sent does.
      for (const [statusText, minutes] of [
        ["Sending", 30],
        ["Sent", 31],
      ] as Array<[string, number]>) {
        await database.query(
          `INSERT INTO "UserOnCallLogTimeline" ("version", "userId", "projectId", "userNotificationLogId", "onCallDutyPolicyExecutionLogId", "onCallDutyPolicyExecutionLogTimelineId", "userNotificationEventType", "statusMessage", "status", "createdAt") VALUES (1, $1, $2, $3, $3, $3, 'Incident Created', '', $4, $5)`,
          [
            user,
            seeded,
            ObjectID.generate().toString(),
            statusText,
            at(minutes),
          ],
        );
      }

      // Incident states: a person's acknowledgement counts, a monitor's and a created state do not.
      const created: string = ObjectID.generate().toString();
      const acknowledged: string = ObjectID.generate().toString();

      await database.query(
        `INSERT INTO "IncidentState" ("_id", "version", "projectId", "name", "slug", "color", "order", "isCreatedState", "isAcknowledgedState") VALUES ($1, 1, $3, 'Identified', 'identified', '#ff0000', 1, true, false), ($2, 1, $3, 'Acknowledged', 'acknowledged', '#ffff00', 2, false, true)`,
        [created, acknowledged, seeded],
      );

      const incident: string = ObjectID.generate().toString();

      await database.query(
        `INSERT INTO "IncidentStateTimeline" ("version", "projectId", "incidentId", "incidentStateId", "createdByUserId", "createdAt") VALUES (1, $1, $2, $3, NULL, $5), (1, $1, $2, $4, $6, $7), (1, $1, $2, $3, $6, $8)`,
        [seeded, incident, acknowledged, created, at(40), user, at(41), at(45)],
      );

      // An alert a person resolved, later than the incident's acknowledgement.
      const resolved: string = ObjectID.generate().toString();

      await database.query(
        `INSERT INTO "AlertState" ("_id", "version", "projectId", "name", "color", "order", "isResolvedState") VALUES ($1, 1, $2, 'Resolved', '#00ff00', 3, true)`,
        [resolved, seeded],
      );
      await database.query(
        `INSERT INTO "AlertStateTimeline" ("version", "projectId", "alertId", "alertStateId", "createdByUserId", "createdAt") VALUES (1, $1, $2, $3, $4, $5)`,
        [seeded, ObjectID.generate().toString(), resolved, user, at(50)],
      );

      // Members: one person in two teams, a second who accepted later, a third still invited.
      await database.query(
        `INSERT INTO "TeamMember" ("version", "projectId", "userId", "teamId", "hasAcceptedInvitation", "createdAt", "invitationAcceptedAt") VALUES (1, $1, $2, $5, true, $6, NULL), (1, $1, $2, $9, true, $7, NULL), (1, $1, $3, $5, true, $6, $8), (1, $1, $4, $5, false, $6, NULL)`,
        [
          seeded,
          user,
          otherUser,
          thirdUser,
          ObjectID.generate().toString(),
          at(1),
          at(2),
          at(60),
          ObjectID.generate().toString(),
        ],
      );

      // Status page resources: one showing a monitor counts.
      await database.query(
        `INSERT INTO "StatusPageResource" ("version", "projectId", "statusPageId", "displayName", "order", "monitorId", "createdAt") VALUES (1, $1, $2, 'Text', 1, NULL, $3), (1, $1, $2, 'Website', 2, $4, $5)`,
        [
          seeded,
          ObjectID.generate().toString(),
          at(69),
          ObjectID.generate().toString(),
          at(70),
        ],
      );

      // Subscribers: an unconfirmed one does not count, a confirmed one does.
      await database.query(
        `INSERT INTO "StatusPageSubscriber" ("version", "projectId", "statusPageId", "isSubscriptionConfirmed", "createdAt") VALUES (1, $1, $2, false, $3), (1, $1, $2, true, $4)`,
        [seeded, ObjectID.generate().toString(), at(79), at(80)],
      );

      // On-call runs: a direct page and an archived policy's log do not count.
      const policy: string = ObjectID.generate().toString();

      await database.query(
        `INSERT INTO "OnCallDutyPolicyExecutionLog" ("version", "projectId", "onCallDutyPolicyId", "status", "statusMessage", "userNotificationEventType", "createdAt") VALUES (1, $1, NULL, 'Executing', 'Paging', 'Incident Created', $3), (1, $1, $2, 'Error', $4, 'Incident Created', $5), (1, $1, $2, 'Executing', 'Running', 'Incident Created', $6)`,
        [
          seeded,
          policy,
          at(85),
          ON_CALL_POLICY_ARCHIVED_NOT_EXECUTED_MESSAGE,
          at(86),
          at(90),
        ],
      );

      // Telemetry as metered: logs, traces with exceptions in them.
      await database.query(
        `INSERT INTO "TelemetryUsageBilling" ("version", "projectId", "day", "productType", "dataIngestedInGB", "totalCostInUSD", "primaryEntityId", "exceptionDataIngestedInGB", "createdAt") VALUES (1, $1, '2026-10-01', $2, 1, 0, $4, 0, $5), (1, $1, '2026-10-01', $3, 1, 0, $4, 0.5, $6)`,
        [
          seeded,
          ProductType.Logs,
          ProductType.Traces,
          ObjectID.generate().toString(),
          at(100),
          at(110),
        ],
      );

      // A project whose first monitor was kept live since the upgrade.
      await database.query(
        `INSERT INTO "Monitor" ("version", "projectId", "name", "slug", "monitorType", "currentMonitorStatusId", "createdAt") VALUES (1, $1, 'm', 'm', 'Website', $2, $3)`,
        [liveAlready, status, at(5)],
      );
      await database.query(
        `INSERT INTO "ProjectMilestone" ("version", "projectId", "milestone", "reachedAt", "wasBackfilled") VALUES (1, $1, 'first_monitor_created', $2, false)`,
        [liveAlready, at(500)],
      );
    });

    const runBackfill: () => Promise<ProjectMilestoneBackfillResult> =
      async (): Promise<ProjectMilestoneBackfillResult> => {
        return await ProjectMilestoneBackfill.backfill({
          batchSize: 2,
          query: async (
            sql: string,
            parameters: Array<unknown>,
          ): Promise<unknown> => {
            return await database.query(sql, parameters);
          },
        });
      };

    test("fills every milestone the data shows, at the time the data says, marked backfilled - and sends nothing", async () => {
      await runBackfill();

      expect(await milestonesOf(seeded)).toEqual(
        [
          ["first_monitor_created", at(10)],
          ["first_check_result_received", at(12)],
          ["first_notification_delivered", at(31)],
          ["first_incident_or_alert_acknowledged", at(45)],
          ["second_member_joined", at(60)],
          ["first_status_page_monitor_added", at(70)],
          ["first_status_page_subscriber_added", at(80)],
          ["first_on_call_policy_executed", at(90)],
          ["first_logs_received", at(100)],
          ["first_traces_received", at(110)],
          ["first_exceptions_received", at(110)],
        ]
          .map(([milestone, reachedAt]: Array<string | Date>) => {
            return {
              milestone: milestone as string,
              reachedAt: reachedAt as Date,
              wasBackfilled: true,
            };
          })
          .sort(
            (a: { milestone: string }, b: { milestone: string }): number => {
              return a.milestone.localeCompare(b.milestone);
            },
          ),
      );

      expect(ProductAnalytics.capture).not.toHaveBeenCalled();
    });

    test("a project with no data gets nothing, and a milestone kept live is kept as it was", async () => {
      await runBackfill();

      expect(await milestonesOf(empty)).toEqual([]);
      expect(await milestonesOf(liveAlready)).toEqual([
        {
          milestone: "first_monitor_created",
          reachedAt: at(500),
          wasBackfilled: false,
        },
      ]);
    });

    test("running it again keeps nothing more", async () => {
      await runBackfill();

      const again: ProjectMilestoneBackfillResult = await runBackfill();

      expect(
        Object.values(again.keptByMilestone).reduce(
          (sum: number, kept: number | undefined): number => {
            return sum + (kept || 0);
          },
          0,
        ),
      ).toBe(0);
      expect(again.projects).toBeGreaterThanOrEqual(3);
    });
  });
});
