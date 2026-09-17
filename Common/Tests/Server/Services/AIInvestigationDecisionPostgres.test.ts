import Alert from "../../../Models/DatabaseModels/Alert";
import Incident from "../../../Models/DatabaseModels/Incident";
import Entities from "../../../Models/DatabaseModels/Index";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import AlertService from "../../../Server/Services/AlertService";
import IncidentService from "../../../Server/Services/IncidentService";
import InvestigationEligibility, {
  InvestigationSubject,
} from "../../../Server/Utils/AI/SRE/InvestigationEligibility";
import InvestigationNotStartedReason from "../../../Types/AI/InvestigationNotStartedReason";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import { DataSource } from "typeorm";

/*
 * Opt in with RUN_POSTGRES_AI_INVESTIGATION_TESTS=true and config.env.
 * Every write uses a uniquely named schema. The source tables must already
 * be migrated; only their structure is cloned, never production rows.
 */
const describePostgres: typeof describe =
  process.env["RUN_POSTGRES_AI_INVESTIGATION_TESTS"] === "true"
    ? describe
    : describe.skip;

const PROJECT_ID: ObjectID = ObjectID.generate();
const OTHER_PROJECT_ID: ObjectID = ObjectID.generate();

function ownerProps(): DatabaseCommonInteractionProps {
  const permission: UserTenantAccessPermission = {
    projectId: PROJECT_ID,
    _type: "UserTenantAccessPermission",
    permissions: [
      {
        _type: "UserPermission",
        permission: Permission.ProjectOwner,
        labelIds: [],
        isBlockPermission: false,
      },
    ],
  };
  return {
    userId: ObjectID.generate(),
    tenantId: PROJECT_ID,
    userTenantAccessPermission: { [PROJECT_ID.toString()]: permission },
  };
}

describe("AI investigation decision column access", () => {
  test.each([
    ["Alert", new Alert()],
    ["Incident", new Incident()],
  ] as const)(
    "%s keeps decision provenance outside generic create, read and update access",
    (_kind: "Alert" | "Incident", model: Alert | Incident) => {
      expect(
        model.getColumnAccessControlFor("aiInvestigationDecision"),
      ).toEqual({
        create: [],
        read: [],
        update: [],
      });
    },
  );
});

describePostgres("AI investigation decisions against Postgres", () => {
  const schema: string = `ai_decision_test_${ObjectID.generate().toString().replace(/-/g, "")}`;
  let database: DataSource;

  beforeAll(async () => {
    database = new DataSource({
      type: "postgres",
      host: process.env["AI_INVESTIGATION_TEST_DATABASE_HOST"] || "localhost",
      port: Number(
        process.env["AI_INVESTIGATION_TEST_DATABASE_PORT"] || "5400",
      ),
      username: process.env["DATABASE_USERNAME"] || "postgres",
      password: process.env["DATABASE_PASSWORD"] || "password",
      database:
        process.env["AI_INVESTIGATION_TEST_DATABASE_NAME"] ||
        process.env["DATABASE_NAME"] ||
        "oneuptimedb",
      entities: Entities,
      schema,
      synchronize: false,
      extra: { options: `-c search_path=${schema},public` },
    });
    await database.initialize();
    await database.query(`CREATE SCHEMA "${schema}"`);
    await database.query(
      `CREATE TABLE "${schema}"."DecisionWrite" ("subjectId" uuid NOT NULL)`,
    );
    await database.query(`CREATE FUNCTION "${schema}"."observe_decision_write"() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        INSERT INTO "${schema}"."DecisionWrite" ("subjectId") VALUES (NEW."_id");
        RETURN NEW;
      END;
    $$`);
    for (const table of ["Alert", "Incident"]) {
      await database.query(
        `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
      );
      await database.query(`CREATE TRIGGER observe_decision_write AFTER UPDATE OF "aiInvestigationDecision" ON "${schema}"."${table}"
        FOR EACH ROW WHEN (OLD."aiInvestigationDecision" IS DISTINCT FROM NEW."aiInvestigationDecision")
        EXECUTE FUNCTION "${schema}"."observe_decision_write"()`);
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

  describe.each(["Alert", "Incident"] as const)(
    "%s decisions",
    (kind: "Alert" | "Incident") => {
      function subject(
        id: ObjectID,
        projectId: ObjectID = PROJECT_ID,
      ): InvestigationSubject {
        return kind === "Alert"
          ? { alertId: id, projectId }
          : { incidentId: id, projectId };
      }

      async function seed(): Promise<ObjectID> {
        const id: ObjectID = ObjectID.generate();
        const severityColumn: string =
          kind === "Alert" ? "alertSeverityId" : "incidentSeverityId";
        await database.query(
          `INSERT INTO "${schema}"."${kind}" ("_id", "projectId", "title", "current${kind}StateId", "${severityColumn}", "version"${kind === "Incident" ? ', "slug"' : ""})
         VALUES ($1, $2, $3, $4, $5, 1${kind === "Incident" ? ", $6" : ""})`,
          [
            id.toString(),
            PROJECT_ID.toString(),
            "Synthetic investigation test",
            ObjectID.generate().toString(),
            ObjectID.generate().toString(),
            ...(kind === "Incident" ? [`synthetic-${id.toString()}`] : []),
          ],
        );
        return id;
      }

      async function stored(
        id: ObjectID,
      ): Promise<InvestigationNotStartedReason | null> {
        const rows: Array<{
          aiInvestigationDecision: InvestigationNotStartedReason | null;
        }> = await database.query(
          `SELECT "aiInvestigationDecision" FROM "${schema}"."${kind}" WHERE "_id" = $1`,
          [id.toString()],
        );
        expect(rows).toHaveLength(1);
        return rows[0]!.aiInvestigationDecision;
      }

      test("uses a nullable JSONB column without an invented historical default", async () => {
        const columns: Array<{
          data_type: string;
          is_nullable: string;
          column_default: string | null;
        }> = await database.query(
          `SELECT data_type, is_nullable, column_default FROM information_schema.columns
         WHERE table_schema = $1 AND table_name = $2 AND column_name = 'aiInvestigationDecision'`,
          [schema, kind],
        );
        expect(columns).toEqual([
          { data_type: "jsonb", is_nullable: "YES", column_default: null },
        ]);
        expect(await stored(await seed())).toBeNull();
      });

      test("persists a creation decision through the production writer and reader", async () => {
        const id: ObjectID = await seed();
        const startedAt: number = Date.now();
        await InvestigationEligibility.recordSkipped(
          subject(id),
          "monitor_cooldown",
        );
        const decision: InvestigationNotStartedReason | null = await stored(id);
        expect(decision).toEqual(
          expect.objectContaining({
            code: "monitor_cooldown",
            source: "recorded",
          }),
        );
        expect(
          new Date(decision!.evaluatedAt).getTime(),
        ).toBeGreaterThanOrEqual(startedAt);
        expect(
          await InvestigationEligibility.getNotStartedReason(subject(id)),
        ).toEqual(decision);
      });

      test("keeps the original reason when a later check has a different outcome", async () => {
        const id: ObjectID = await seed();
        await InvestigationEligibility.recordSkipped(
          subject(id),
          "provider_missing",
        );
        const original: InvestigationNotStartedReason | null = await stored(id);
        await InvestigationEligibility.recordSkipped(
          subject(id),
          "daily_budget_exhausted",
        );
        expect(await stored(id)).toEqual(original);
      });

      test("concurrent decisions cannot replace an already recorded outcome", async () => {
        const id: ObjectID = await seed();
        await InvestigationEligibility.recordSkipped(
          subject(id),
          "severity_below_threshold",
        );
        const original: InvestigationNotStartedReason | null = await stored(id);
        await Promise.all([
          InvestigationEligibility.recordSkipped(
            subject(id),
            "provider_missing",
          ),
          InvestigationEligibility.recordSkipped(
            subject(id),
            "monitor_cooldown",
          ),
          InvestigationEligibility.recordSkipped(
            subject(id),
            "daily_budget_exhausted",
          ),
        ]);
        expect(await stored(id)).toEqual(original);
      });

      test("concurrent initial decisions produce only one durable write", async () => {
        const id: ObjectID = await seed();
        await Promise.all([
          InvestigationEligibility.recordSkipped(
            subject(id),
            "provider_missing",
          ),
          InvestigationEligibility.recordSkipped(
            subject(id),
            "monitor_cooldown",
          ),
          InvestigationEligibility.recordSkipped(
            subject(id),
            "daily_budget_exhausted",
          ),
        ]);
        const writes: Array<{ count: string }> = await database.query(
          `SELECT COUNT(*) AS count FROM "${schema}"."DecisionWrite" WHERE "subjectId" = $1`,
          [id.toString()],
        );
        expect(Number(writes[0]!.count)).toBe(1);
        expect(await stored(id)).not.toBeNull();
      });

      test("recording diagnostic metadata does not report a user edit", async () => {
        const id: ObjectID = await seed();
        const editMetadataQuery: string = `SELECT "version", "updatedAt" FROM "${schema}"."${kind}" WHERE "_id" = $1`;
        const before: unknown = await database.query(editMetadataQuery, [
          id.toString(),
        ]);
        await InvestigationEligibility.recordSkipped(
          subject(id),
          "provider_missing",
        );
        expect(
          await database.query(editMetadataQuery, [id.toString()]),
        ).toEqual(before);
      });

      test("refuses to record a decision using another project's id", async () => {
        const id: ObjectID = await seed();
        await InvestigationEligibility.recordSkipped(
          subject(id, OTHER_PROJECT_ID),
          "provider_missing",
        );
        expect(await stored(id)).toBeNull();
      });

      test("an unrelated edit leaves the recorded reason intact", async () => {
        const id: ObjectID = await seed();
        await InvestigationEligibility.recordSkipped(
          subject(id),
          "automatic_investigation_disabled",
        );
        const original: InvestigationNotStartedReason | null = await stored(id);
        const service: typeof AlertService | typeof IncidentService =
          kind === "Alert" ? AlertService : IncidentService;
        await service.updateColumnsByIdWithoutHooks({
          id,
          data: { title: "Updated synthetic title" },
        });
        expect(await stored(id)).toEqual(original);
      });

      test("a project owner cannot forge the internal decision through generic updates", async () => {
        const id: ObjectID = await seed();
        const service: typeof AlertService | typeof IncidentService =
          kind === "Alert" ? AlertService : IncidentService;
        await expect(
          service.updateOneById({
            id,
            data: {
              aiInvestigationDecision: InvestigationEligibility.reason(
                "provider_missing",
                subject(id),
              ),
            },
            props: ownerProps(),
          }),
        ).rejects.toThrow();
        expect(await stored(id)).toBeNull();
      });

      test("a project owner cannot read the internal column through generic reads", async () => {
        const id: ObjectID = await seed();
        await InvestigationEligibility.recordSkipped(
          subject(id),
          "provider_missing",
        );
        const service: typeof AlertService | typeof IncidentService =
          kind === "Alert" ? AlertService : IncidentService;
        await expect(
          service.findOneById({
            id,
            select: { aiInvestigationDecision: true },
            props: ownerProps(),
          }),
        ).rejects.toThrow();
      });
    },
  );
});
