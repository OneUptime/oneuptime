import Entities from "../../../Models/DatabaseModels/Index";
import Alert from "../../../Models/DatabaseModels/Alert";
import AlertState from "../../../Models/DatabaseModels/AlertState";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentState from "../../../Models/DatabaseModels/IncidentState";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import AIService from "../../../Server/Services/AIService";
import AlertStateService from "../../../Server/Services/AlertStateService";
import IncidentService from "../../../Server/Services/IncidentService";
import IncidentStateService from "../../../Server/Services/IncidentStateService";
import ProjectService from "../../../Server/Services/ProjectService";
import AIAlertInvestigationRunner from "../../../Server/Utils/AI/SRE/AlertInvestigationRunner";
import AIIncidentInvestigationRunner from "../../../Server/Utils/AI/SRE/IncidentInvestigationRunner";
import AIInvestigationEngine from "../../../Server/Utils/AI/SRE/AIInvestigationEngine";
import InvestigationEligibility from "../../../Server/Utils/AI/SRE/InvestigationEligibility";
import InvestigationLimitCatchUp from "../../../Server/Utils/AI/SRE/InvestigationLimitCatchUp";
import AIRunStatus from "../../../Types/AI/AIRunStatus";
import AIRunType from "../../../Types/AI/AIRunType";
import InvestigationNotStartedReason, {
  InvestigationNotStartedCode,
} from "../../../Types/AI/InvestigationNotStartedReason";
import { ProjectAiDailyLimit } from "../../../Types/AI/ProjectAiDailyLimits";
import OneUptimeDate from "../../../Types/Date";
import ObjectID from "../../../Types/ObjectID";
import { DataSource } from "typeorm";

/*
 * The daily AI limit's owner notice and the investigation catch-up, on a
 * migrated Postgres: the SQL the unit suites stand in for.
 *
 *   - ProjectService.markAiDailyLimitReached, the one conditional UPDATE that
 *     decides "the owners are told once a day for each limit" - even when
 *     servers race for it;
 *   - the owners' notice end to end, from a real usage sum over the AI Logs
 *     to one email;
 *   - the catch-up's read (open states, the recorded reason's code inside a
 *     jsonb document, the age, the project) and its compare-and-set of the
 *     whole jsonb reason, which is what makes "once each" hold across
 *     workers.
 *
 * Opt in with RUN_POSTGRES_AI_DAILY_LIMIT_TESTS=true and
 * AI_DAILY_LIMIT_TEST_DATABASE_HOST/PORT/NAME pointing at a database the
 * migrations ran on. Every write goes to a schema of its own, made of
 * structure-only copies of the migrated tables (no rows are read or written
 * outside it).
 */
const describePostgres: typeof describe =
  process.env["RUN_POSTGRES_AI_DAILY_LIMIT_TESTS"] === "true"
    ? describe
    : describe.skip;

const OPEN_INCIDENT_STATE: ObjectID = ObjectID.generate();
const RESOLVED_INCIDENT_STATE: ObjectID = ObjectID.generate();
const OPEN_ALERT_STATE: ObjectID = ObjectID.generate();

describe("the daily AI limit's notice and catch-up on Postgres", () => {
  test("opt-in: set RUN_POSTGRES_AI_DAILY_LIMIT_TESTS=true to run against a migrated database", () => {
    expect(typeof describePostgres).toBe("function");
  });
});

describePostgres("the daily AI limit's notice and catch-up on Postgres", () => {
  const schema: string = `ai_daily_limit_test_${ObjectID.generate()
    .toString()
    .replace(/-/g, "")}`;
  let database: DataSource;
  let now: Date = new Date();

  beforeAll(async () => {
    database = new DataSource({
      type: "postgres",
      host: process.env["AI_DAILY_LIMIT_TEST_DATABASE_HOST"] || "localhost",
      port: Number(process.env["AI_DAILY_LIMIT_TEST_DATABASE_PORT"] || "5400"),
      username: process.env["DATABASE_USERNAME"] || "postgres",
      password: process.env["DATABASE_PASSWORD"] || "password",
      database:
        process.env["AI_DAILY_LIMIT_TEST_DATABASE_NAME"] ||
        process.env["DATABASE_NAME"] ||
        "oneuptimedb",
      entities: Entities,
      schema,
      synchronize: false,
      extra: { options: `-c search_path=${schema},public` },
    });
    await database.initialize();
    await database.query(`CREATE SCHEMA "${schema}"`);

    for (const table of ["Project", "Incident", "Alert", "AIRun", "LlmLog"]) {
      await database.query(
        `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
      );
    }

    const currentSchema: Array<{ current_schema: string }> =
      await database.query("SELECT current_schema()");
    expect(currentSchema[0]?.current_schema).toBe(schema);

    jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
    jest.spyOn(PostgresAppInstance, "getDataSource").mockReturnValue(database);
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    if (database?.isInitialized) {
      await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await database.destroy();
    }
  });

  beforeEach(() => {
    now = new Date();
    jest.spyOn(OneUptimeDate, "getCurrentDate").mockImplementation(() => {
      return new Date(now.getTime());
    });
  });

  afterEach(() => {
    // Keep the data source mocks of beforeAll; drop the per-test spies.
    for (const spy of [
      OneUptimeDate.getCurrentDate,
      ProjectService.sendEmailToProjectOwners,
      AIService.getReachedProjectDailyLimit,
      AIService.getAutonomousDailyBudgetStatus,
      AIInvestigationEngine.getDisabledReason,
      IncidentStateService.getUnresolvedIncidentStates,
      AlertStateService.getUnresolvedAlertStates,
      AIIncidentInvestigationRunner.investigateNewIncident,
      AIAlertInvestigationRunner.investigateNewAlert,
      IncidentService.compareAndSetColumnsByIdWithoutHooks,
    ]) {
      const mock: { mockRestore?: () => void } = spy as unknown as {
        mockRestore?: () => void;
      };
      mock.mockRestore?.();
    }
  });

  async function seedProject(
    values: { tokenLimit?: number; deleted?: boolean } = {},
  ): Promise<ObjectID> {
    const id: ObjectID = ObjectID.generate();

    await database.query(
      `INSERT INTO "${schema}"."Project" ("_id", "name", "slug", "version", "aiDailyTokenLimit", "deletedAt") VALUES ($1, $2, $3, 1, $4, $5)`,
      [
        id.toString(),
        "Acme Production",
        `acme-${id.toString()}`,
        values.tokenLimit ?? null,
        values.deleted ? new Date() : null,
      ],
    );

    return id;
  }

  async function reachedAt(
    projectId: ObjectID,
    column: "aiDailyTokenLimitReachedAt" | "aiDailySpendLimitReachedAt",
  ): Promise<Date | null> {
    const rows: Array<Record<string, Date | null>> = await database.query(
      `SELECT "${column}" FROM "${schema}"."Project" WHERE "_id" = $1`,
      [projectId.toString()],
    );

    return rows[0]?.[column] || null;
  }

  describe("ProjectService.markAiDailyLimitReached: once a day for each limit", () => {
    test("the day's first call writes the moment and wins; every later call that day loses and writes nothing", async () => {
      const projectId: ObjectID = await seedProject();
      const morning: Date = new Date("2026-10-07T08:00:00.000Z");
      const evening: Date = new Date("2026-10-07T21:30:00.000Z");

      expect(
        await ProjectService.markAiDailyLimitReached({
          projectId,
          limit: ProjectAiDailyLimit.Tokens,
          now: morning,
        }),
      ).toBe(true);
      expect(await reachedAt(projectId, "aiDailyTokenLimitReachedAt")).toEqual(
        morning,
      );

      expect(
        await ProjectService.markAiDailyLimitReached({
          projectId,
          limit: ProjectAiDailyLimit.Tokens,
          now: evening,
        }),
      ).toBe(false);
      expect(await reachedAt(projectId, "aiDailyTokenLimitReachedAt")).toEqual(
        morning,
      );
    });

    test("the next UTC day wins again", async () => {
      const projectId: ObjectID = await seedProject();

      await ProjectService.markAiDailyLimitReached({
        projectId,
        limit: ProjectAiDailyLimit.Tokens,
        now: new Date("2026-10-07T23:59:59.000Z"),
      });

      const nextDay: Date = new Date("2026-10-08T00:00:01.000Z");
      expect(
        await ProjectService.markAiDailyLimitReached({
          projectId,
          limit: ProjectAiDailyLimit.Tokens,
          now: nextDay,
        }),
      ).toBe(true);
      expect(await reachedAt(projectId, "aiDailyTokenLimitReachedAt")).toEqual(
        nextDay,
      );
    });

    test("each limit has its own column", async () => {
      const projectId: ObjectID = await seedProject();
      const at: Date = new Date("2026-10-07T10:00:00.000Z");

      await ProjectService.markAiDailyLimitReached({
        projectId,
        limit: ProjectAiDailyLimit.Tokens,
        now: at,
      });

      expect(
        await reachedAt(projectId, "aiDailySpendLimitReachedAt"),
      ).toBeNull();
      expect(
        await ProjectService.markAiDailyLimitReached({
          projectId,
          limit: ProjectAiDailyLimit.Spend,
          now: at,
        }),
      ).toBe(true);
    });

    test("servers racing for the same day: exactly one wins", async () => {
      const projectId: ObjectID = await seedProject();
      const at: Date = new Date("2026-10-07T12:00:00.000Z");

      const results: Array<boolean> = await Promise.all(
        Array.from({ length: 8 }, () => {
          return ProjectService.markAiDailyLimitReached({
            projectId,
            limit: ProjectAiDailyLimit.Tokens,
            now: at,
          });
        }),
      );

      expect(
        results.filter((won: boolean) => {
          return won;
        }),
      ).toHaveLength(1);
    });

    test("a deleted project is never told", async () => {
      const projectId: ObjectID = await seedProject({ deleted: true });

      expect(
        await ProjectService.markAiDailyLimitReached({
          projectId,
          limit: ProjectAiDailyLimit.Tokens,
          now: new Date(),
        }),
      ).toBe(false);
    });

    test("a passive write: no version or updatedAt change", async () => {
      const projectId: ObjectID = await seedProject();
      const query: string = `SELECT "version", "updatedAt" FROM "${schema}"."Project" WHERE "_id" = $1`;
      const before: unknown = await database.query(query, [
        projectId.toString(),
      ]);

      await ProjectService.markAiDailyLimitReached({
        projectId,
        limit: ProjectAiDailyLimit.Tokens,
        now: new Date(),
      });

      expect(await database.query(query, [projectId.toString()])).toEqual(
        before,
      );
    });
  });

  describe("the owners' notice, from the AI Logs to one email", () => {
    test("a project at its token limit: every pre-check that day finds it reached, and the owners are emailed once", async () => {
      const projectId: ObjectID = await seedProject({ tokenLimit: 5000 });
      const ownerEmails: jest.SpyInstance = jest
        .spyOn(ProjectService, "sendEmailToProjectOwners")
        .mockResolvedValue(undefined);

      await database.query(
        `INSERT INTO "${schema}"."LlmLog" ("_id", "projectId", "status", "version", "totalTokens", "createdAt") VALUES ($1, $2, 'Success', 1, 5000, $3)`,
        [ObjectID.generate().toString(), projectId.toString(), new Date()],
      );

      for (let check: number = 0; check < 4; check++) {
        expect(
          await AIService.getReachedProjectDailyLimit({ projectId }),
        ).toEqual(
          expect.objectContaining({
            reachedLimit: ProjectAiDailyLimit.Tokens,
            usage: { usedTokensToday: 5000, spentTodayInUSDCents: 0 },
          }),
        );
      }

      expect(ownerEmails).toHaveBeenCalledTimes(1);
      expect(ownerEmails.mock.calls[0]![1]).toBe(
        "Daily AI token limit reached for Acme Production",
      );
      expect(
        await reachedAt(projectId, "aiDailyTokenLimitReachedAt"),
      ).not.toBeNull();
    });
  });

  describe("the catch-up's read and its compare-and-set", () => {
    let projectId: ObjectID;

    async function seedIncident(values: {
      stateId?: ObjectID;
      code?: InvestigationNotStartedCode | null;
      createdAt?: Date;
      project?: ObjectID;
    }): Promise<ObjectID> {
      const id: ObjectID = ObjectID.generate();
      const owner: ObjectID = values.project || projectId;

      await database.query(
        `INSERT INTO "${schema}"."Incident" ("_id", "projectId", "title", "slug", "currentIncidentStateId", "incidentSeverityId", "version", "createdAt") VALUES ($1, $2, $3, $4, $5, $6, 1, $7)`,
        [
          id.toString(),
          owner.toString(),
          "Checkout is down",
          `incident-${id.toString()}`,
          (values.stateId || OPEN_INCIDENT_STATE).toString(),
          ObjectID.generate().toString(),
          values.createdAt || new Date(),
        ],
      );

      if (values.code !== null) {
        // The production writer, as the create hook records a skip.
        await InvestigationEligibility.recordSkipped(
          { projectId: owner, incidentId: id },
          values.code || "project_daily_limit_reached",
        );
      }

      return id;
    }

    async function seedAlert(): Promise<ObjectID> {
      const id: ObjectID = ObjectID.generate();

      await database.query(
        `INSERT INTO "${schema}"."Alert" ("_id", "projectId", "title", "currentAlertStateId", "alertSeverityId", "version") VALUES ($1, $2, $3, $4, $5, 1)`,
        [
          id.toString(),
          projectId.toString(),
          "Error rate high",
          OPEN_ALERT_STATE.toString(),
          ObjectID.generate().toString(),
        ],
      );
      await InvestigationEligibility.recordSkipped(
        { projectId, alertId: id },
        "project_daily_limit_reached",
      );

      return id;
    }

    async function seedRun(values: {
      incidentId?: ObjectID;
      alertId?: ObjectID;
      status: AIRunStatus;
    }): Promise<void> {
      await database.query(
        `INSERT INTO "${schema}"."AIRun" ("_id", "projectId", "runType", "status", "version", "triggeredByIncidentId", "triggeredByAlertId") VALUES ($1, $2, $3, $4, 1, $5, $6)`,
        [
          ObjectID.generate().toString(),
          projectId.toString(),
          AIRunType.Investigation,
          values.status,
          values.incidentId?.toString() || null,
          values.alertId?.toString() || null,
        ],
      );
    }

    async function decisionOf(
      table: "Incident" | "Alert",
      id: ObjectID,
    ): Promise<InvestigationNotStartedReason | null> {
      const rows: Array<{
        aiInvestigationDecision: InvestigationNotStartedReason | null;
      }> = await database.query(
        `SELECT "aiInvestigationDecision" FROM "${schema}"."${table}" WHERE "_id" = $1`,
        [id.toString()],
      );

      return rows[0]?.aiInvestigationDecision ?? null;
    }

    let investigatedIncidents: Array<string> = [];

    beforeEach(async () => {
      projectId = await seedProject({ tokenLimit: 5000 });
      investigatedIncidents = [];

      // Nothing stops OneUptime AI for the project or its lanes now.
      jest
        .spyOn(AIService, "getReachedProjectDailyLimit")
        .mockResolvedValue(null);
      jest
        .spyOn(AIInvestigationEngine, "getDisabledReason")
        .mockResolvedValue(null);
      jest
        .spyOn(AIService, "getAutonomousDailyBudgetStatus")
        .mockResolvedValue({
          exhausted: false,
          limitInTokens: null,
          usedTokensToday: 0,
        });
      jest
        .spyOn(IncidentStateService, "getUnresolvedIncidentStates")
        .mockResolvedValue([
          { id: OPEN_INCIDENT_STATE } as unknown as IncidentState,
        ]);
      jest
        .spyOn(AlertStateService, "getUnresolvedAlertStates")
        .mockResolvedValue([{ id: OPEN_ALERT_STATE } as unknown as AlertState]);

      // The investigation path, as far as the database sees it: a queued run.
      jest
        .spyOn(AIIncidentInvestigationRunner, "investigateNewIncident")
        .mockImplementation(async (data: { incidentId: ObjectID }) => {
          investigatedIncidents.push(data.incidentId.toString());
          await seedRun({
            incidentId: data.incidentId,
            status: AIRunStatus.Completed,
          });
          return true;
        });
      jest
        .spyOn(AIAlertInvestigationRunner, "investigateNewAlert")
        .mockImplementation(async (data: { alertId: ObjectID }) => {
          await seedRun({
            alertId: data.alertId,
            status: AIRunStatus.Completed,
          });
          return true;
        });
    });

    test("the read finds exactly the open records of this project the limit skipped, less than a day old, newest first", async () => {
      const newest: ObjectID = await seedIncident({
        createdAt: OneUptimeDate.addRemoveHours(now, -1),
      });
      const older: ObjectID = await seedIncident({
        createdAt: OneUptimeDate.addRemoveHours(now, -20),
      });
      await seedIncident({ stateId: RESOLVED_INCIDENT_STATE });
      await seedIncident({ code: "monitor_cooldown" });
      await seedIncident({ code: "daily_budget_exhausted" });
      await seedIncident({ code: null });
      await seedIncident({
        createdAt: OneUptimeDate.addRemoveHours(now, -25),
      });
      await seedIncident({ project: await seedProject() });

      const waiting: Array<Incident | Alert> =
        await InvestigationLimitCatchUp.getWaitingRecords({
          projectId,
          lane: "Incident",
        });

      expect(
        waiting.map((record: Incident | Alert) => {
          return record.id?.toString();
        }),
      ).toEqual([newest.toString(), older.toString()]);
      expect(waiting[0]!.aiInvestigationDecision?.code).toBe(
        "project_daily_limit_reached",
      );
    });

    test("a record is investigated once, and leaves the waiting list in the database", async () => {
      const incident: ObjectID = await seedIncident({});
      const alert: ObjectID = await seedAlert();

      await InvestigationLimitCatchUp.catchUpProject(projectId);
      await InvestigationLimitCatchUp.catchUpProject(projectId);

      expect(investigatedIncidents).toEqual([incident.toString()]);
      expect(await decisionOf("Incident", incident)).toBeNull();
      expect(await decisionOf("Alert", alert)).toBeNull();
      expect(
        AIAlertInvestigationRunner.investigateNewAlert,
      ).toHaveBeenCalledTimes(1);
    });

    test("workers racing over the same records investigate each once", async () => {
      const incidents: Array<ObjectID> = [];

      for (let index: number = 0; index < 5; index++) {
        incidents.push(
          await seedIncident({
            createdAt: OneUptimeDate.addRemoveHours(now, -(index + 1)),
          }),
        );
      }

      await Promise.all([
        InvestigationLimitCatchUp.catchUpProject(projectId),
        InvestigationLimitCatchUp.catchUpProject(projectId),
        InvestigationLimitCatchUp.catchUpProject(projectId),
        InvestigationLimitCatchUp.catchUpProject(projectId),
      ]);

      expect([...investigatedIncidents].sort()).toEqual(
        incidents
          .map((id: ObjectID) => {
            return id.toString();
          })
          .sort(),
      );
    });

    test("the compare-and-set takes the whole jsonb reason as it was read, and nothing else", async () => {
      const incident: ObjectID = await seedIncident({});
      const [record] = await InvestigationLimitCatchUp.getWaitingRecords({
        projectId,
        lane: "Incident",
      });

      // Re-recorded meanwhile (the limit stopped it again): a new reason.
      const reRecorded: InvestigationNotStartedReason = {
        ...record!.aiInvestigationDecision!,
        evaluatedAt: new Date(now.getTime() + 1000).toISOString(),
      };
      await IncidentService.updateColumnsByIdWithoutHooks({
        id: incident,
        data: { aiInvestigationDecision: reRecorded },
        skipUpdateDateColumn: true,
      });

      expect(
        await IncidentService.compareAndSetColumnsByIdWithoutHooks({
          id: incident,
          data: { aiInvestigationDecision: null },
          expectedData: {
            aiInvestigationDecision: record!.aiInvestigationDecision!,
          },
          skipUpdateDateColumn: true,
        }),
      ).toBe(false);
      expect((await decisionOf("Incident", incident))?.evaluatedAt).toBe(
        reRecorded.evaluatedAt,
      );

      // The reason as it is now, read back from jsonb: taken.
      const keysReordered: InvestigationNotStartedReason = JSON.parse(
        JSON.stringify(
          Object.fromEntries(Object.entries(reRecorded).reverse()),
        ),
      );
      expect(
        await IncidentService.compareAndSetColumnsByIdWithoutHooks({
          id: incident,
          data: { aiInvestigationDecision: null },
          expectedData: { aiInvestigationDecision: keysReordered },
          skipUpdateDateColumn: true,
        }),
      ).toBe(true);
      expect(await decisionOf("Incident", incident)).toBeNull();
    });

    test("a record investigated since it was skipped gets no second run, and leaves the list", async () => {
      const incident: ObjectID = await seedIncident({});
      await seedRun({ incidentId: incident, status: AIRunStatus.Error });

      await InvestigationLimitCatchUp.catchUpProject(projectId);

      expect(investigatedIncidents).toEqual([]);
      expect(await decisionOf("Incident", incident)).toBeNull();
    });

    test("work queued in a lane goes first: the catch-up adds nothing to it then", async () => {
      const incident: ObjectID = await seedIncident({});
      const alert: ObjectID = await seedAlert();
      // Another incident's run is waiting for a concurrency slot.
      await seedRun({
        incidentId: ObjectID.generate(),
        status: AIRunStatus.Queued,
      });

      await InvestigationLimitCatchUp.catchUpProject(projectId);

      expect(investigatedIncidents).toEqual([]);
      expect((await decisionOf("Incident", incident))?.code).toBe(
        "project_daily_limit_reached",
      );
      // The alert lane is its own lane.
      expect(await decisionOf("Alert", alert)).toBeNull();
    });
  });
});
