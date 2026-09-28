import AlertSeverity from "../../../Models/DatabaseModels/AlertSeverity";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Entities from "../../../Models/DatabaseModels/Index";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import TeamComplianceSetting from "../../../Models/DatabaseModels/TeamComplianceSetting";
import EnterpriseEdition from "../../../Server/Enterprise/EnterpriseEdition";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import AlertSeverityService from "../../../Server/Services/AlertSeverityService";
import IncidentSeverityService from "../../../Server/Services/IncidentSeverityService";
import TeamComplianceSettingService, {
  DeletedSeverity,
  DUPLICATE_COMPLIANCE_RULE_MESSAGE,
  SEVERITIES_DELETED_ENABLE_MESSAGE,
} from "../../../Server/Services/TeamComplianceSettingService";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import Permission, {
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import ComplianceNotificationChannel from "../../../Types/Team/ComplianceNotificationChannel";
import { ComplianceSeverityKind } from "../../../Types/Team/ComplianceRule";
import ComplianceRuleType from "../../../Types/Team/ComplianceRuleType";
import UserType from "../../../Types/UserType";
import { DataSource, Logger } from "typeorm";

/*
 * Team compliance rules scoped by severity and channel
 * (TeamComplianceSetting.notificationChannel / incidentSeverities /
 * alertSeverities) against a migrated Postgres.
 *
 * Opt in with RUN_POSTGRES_TEAM_COMPLIANCE_TESTS=true against a database the
 * registered migrations (1796000000000-AddTeamComplianceRuleScope included)
 * have been applied to, e.g. from packages/Common:
 *
 *   RUN_POSTGRES_TEAM_COMPLIANCE_TESTS=true \
 *   TEAM_COMPLIANCE_TEST_DATABASE_HOST=127.0.0.1 \
 *   TEAM_COMPLIANCE_TEST_DATABASE_PORT=5400 \
 *   DATABASE_PASSWORD=... node node_modules/.bin/jest --runInBand \
 *     Tests/Server/Services/TeamComplianceSettingPostgres.test.ts --forceExit
 *
 * Without the flag the suite is skipped, so the Common test job - whose
 * Postgres is not migrated - never runs it.
 *
 * Why a real Postgres: the unit tests of TeamComplianceSettingService mock
 * every read, so they cannot show that the two ManyToMany join tables the
 * migration created are the ones the model writes, that severity ids in each
 * shape a caller sends (id strings, `{_id}` JSON, models) land as join rows,
 * that the service's validation reads - an IN over uuid ids, a relation
 * select - are SQL Postgres accepts, that an update replaces (or clears) the
 * join rows, or that the ON DELETE CASCADE of both foreign keys holds.
 *
 * Two halves, as in IncidentStatusPageScopePostgres.test.ts:
 *
 * - the migrated public tables are inspected as they are: the new column, the
 *   foreign keys of the two join tables, and the dropped unique index;
 * - behaviour runs in a uniquely named schema holding structure-only clones
 *   (LIKE ... INCLUDING ALL) of the tables involved. The join tables' foreign
 *   keys are copied from the migrated tables' own definitions, so a cascade
 *   observed here is the cascade the migration declared. No row is ever
 *   written outside that schema, and the schema is dropped afterwards.
 *
 * The production TeamComplianceSettingService runs unchanged: its hooks, the
 * permission layer (as root, and as signed-in users), and the relation save -
 * and so do IncidentSeverityService and AlertSeverityService, whose deletes
 * pause a rule left with no severity instead of leaving it to widen to every
 * severity - and mark it, so it cannot be turned back on as it is or be
 * mistaken for a duplicate. Only realtime and workflow triggers are stubbed,
 * and - for the signed-in half - the enterprise licence check, which reads a
 * licence no test database has. Every statement Postgres rejects is recorded through the
 * DataSource's logger and fails the test, even when a caller catches it.
 */
const describePostgres: typeof describe =
  process.env["RUN_POSTGRES_TEAM_COMPLIANCE_TESTS"] === "true"
    ? describe
    : describe.skip;

const TABLES: Array<string> = [
  "Project",
  "Team",
  "IncidentSeverity",
  "AlertSeverity",
  "TeamComplianceSetting",
  "TeamComplianceSettingIncidentSeverity",
  "TeamComplianceSettingAlertSeverity",
];

const JOIN_TABLES: Array<string> = [
  "TeamComplianceSettingIncidentSeverity",
  "TeamComplianceSettingAlertSeverity",
];

const INCIDENT_JOIN_TABLE: string = "TeamComplianceSettingIncidentSeverity";
const ALERT_JOIN_TABLE: string = "TeamComplianceSettingAlertSeverity";

const FOREIGN_SEVERITY_MESSAGE: string =
  "One or more of the selected incident severities do not exist in this project.";
const FOREIGN_ALERT_SEVERITY_MESSAGE: string =
  "One or more of the selected alert severities do not exist in this project.";

// What a severity delete writes into the options of a rule it emptied.
const MARKED: JSONObject = { severitiesDeleted: true };

interface ForeignKeyRow {
  table: string;
  name: string;
  column: string;
  referencedTable: string;
  onDelete: string;
  definition: string;
}

type SqlRow = Record<string, unknown>;

// A severity list in any shape a caller sends it.
type SeverityList = Array<
  string | JSONObject | IncidentSeverity | AlertSeverity
>;

interface RuleInput {
  ruleType: ComplianceRuleType;
  notificationChannel?: ComplianceNotificationChannel | null | undefined;
  incidentSeverities?: SeverityList | undefined;
  alertSeverities?: SeverityList | undefined;
  enabled?: boolean | undefined;
  teamId?: ObjectID | undefined;
  projectId?: ObjectID | undefined;
}

// A rule row as Postgres stores it, with its join rows.
interface StoredRule {
  ruleType: string;
  notificationChannel: string | null;
  enabled: boolean;
  incidentSeverityIds: Array<string>;
  alertSeverityIds: Array<string>;
}

interface ReadSeverity {
  id: string;
  name: string | undefined;
  color: string | undefined;
  order: number | undefined;
}

/*
 * Records every statement Postgres rejected. PostgresQueryRunner hands each
 * failure to the logger before it throws, whatever the caller then does with
 * the error.
 */
class FailedQueryRecorder implements Logger {
  public failures: Array<string> = [];

  public logQuery(): void {
    return;
  }

  public logQueryError(error: string | Error, query: string): void {
    this.failures.push(
      `${error instanceof Error ? error.message : error} in: ${query}`,
    );
  }

  public logQuerySlow(): void {
    return;
  }

  public logSchemaBuild(): void {
    return;
  }

  public logMigration(): void {
    return;
  }

  public log(): void {
    return;
  }
}

const ROOT: DatabaseCommonInteractionProps = { isRoot: true };

describePostgres(
  "Team compliance rule scope (severities + channel) against a migrated Postgres",
  () => {
    const schema: string = `team_compliance_${ObjectID.generate()
      .toString()
      .replace(/-/g, "")}`;

    const failedQueries: FailedQueryRecorder = new FailedQueryRecorder();

    const projectId: ObjectID = ObjectID.generate();
    const otherProjectId: ObjectID = ObjectID.generate();
    const teamId: ObjectID = ObjectID.generate();
    const otherTeamId: ObjectID = ObjectID.generate();
    const otherProjectTeamId: ObjectID = ObjectID.generate();

    // Incident severities of the project, most severe first.
    const critical: ObjectID = ObjectID.generate();
    const major: ObjectID = ObjectID.generate();
    const minor: ObjectID = ObjectID.generate();

    const criticalAlert: ObjectID = ObjectID.generate();
    const warningAlert: ObjectID = ObjectID.generate();

    // Severities of ANOTHER project.
    const otherProjectCritical: ObjectID = ObjectID.generate();
    const otherProjectCriticalAlert: ObjectID = ObjectID.generate();

    let database: DataSource;
    let migratedForeignKeys: Array<ForeignKeyRow> = [];

    beforeAll(async () => {
      database = new DataSource({
        type: "postgres",
        host: process.env["TEAM_COMPLIANCE_TEST_DATABASE_HOST"] || "localhost",
        port: Number(
          process.env["TEAM_COMPLIANCE_TEST_DATABASE_PORT"] || "5400",
        ),
        username: process.env["DATABASE_USERNAME"] || "postgres",
        password: process.env["DATABASE_PASSWORD"] || "password",
        database:
          process.env["TEAM_COMPLIANCE_TEST_DATABASE_NAME"] ||
          process.env["DATABASE_NAME"] ||
          "oneuptimedb",
        entities: Entities,
        schema,
        synchronize: false,
        logging: ["error"],
        logger: failedQueries,
        extra: { options: `-c search_path=${schema},public` },
      });
      await database.initialize();

      /*
       * Read the migrated foreign keys before the clones exist, so their
       * definitions name the referenced tables without a schema.
       */
      migratedForeignKeys = await database.query(
        `SELECT t.relname AS "table",
              c.conname AS "name",
              a.attname AS "column",
              r.relname AS "referencedTable",
              c.confdeltype AS "onDelete",
              pg_get_constraintdef(c.oid) AS "definition"
         FROM pg_constraint c
         JOIN pg_class t ON t.oid = c.conrelid
         JOIN pg_namespace n ON n.oid = t.relnamespace
         JOIN pg_class r ON r.oid = c.confrelid
         JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
        WHERE n.nspname = 'public' AND t.relname = ANY($1) AND c.contype = 'f'
        ORDER BY t.relname, a.attname`,
        [JOIN_TABLES],
      );

      await database.query(`CREATE SCHEMA "${schema}"`);

      for (const table of TABLES) {
        await database.query(
          `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
        );
      }

      for (const foreignKey of migratedForeignKeys) {
        const definition: string = foreignKey.definition.replace(
          /REFERENCES public\./g,
          "REFERENCES ",
        );
        await database.query(
          `ALTER TABLE "${schema}"."${foreignKey.table}" ADD CONSTRAINT "${foreignKey.name}" ${definition}`,
        );
      }

      const currentSchema: Array<{ current_schema: string }> =
        await database.query("SELECT current_schema()");
      expect(currentSchema[0]?.current_schema).toBe(schema);

      jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
      jest
        .spyOn(PostgresAppInstance, "getDataSource")
        .mockReturnValue(database);

      /*
       * The only side effects of these paths that leave Postgres: realtime
       * events go to the socket server, workflow triggers to the workflow
       * service.
       */
      jest
        .spyOn(TeamComplianceSettingService, "onTriggerRealtime")
        .mockResolvedValue(undefined);
      jest
        .spyOn(TeamComplianceSettingService, "onTriggerWorkflow")
        .mockResolvedValue(undefined);

      for (const severityService of [
        IncidentSeverityService,
        AlertSeverityService,
      ]) {
        jest
          .spyOn(severityService, "onTriggerRealtime")
          .mockResolvedValue(undefined);
        jest
          .spyOn(severityService, "onTriggerWorkflow")
          .mockResolvedValue(undefined);
      }
    });

    beforeEach(async () => {
      failedQueries.failures = [];

      await database.query(
        TABLES.map((table: string): string => {
          return `DELETE FROM "${schema}"."${table}"`;
        })
          .reverse()
          .join("; "),
      );

      for (const [id, name] of [
        [projectId, "Compliance project"],
        [otherProjectId, "Another project"],
      ] as Array<[ObjectID, string]>) {
        await insert("Project", {
          _id: id.toString(),
          name: name,
          slug: `project-${id.toString()}`,
          version: 1,
        });
      }

      for (const [id, project, name] of [
        [teamId, projectId, "Platform on-call"],
        [otherTeamId, projectId, "Database on-call"],
        [otherProjectTeamId, otherProjectId, "Someone else's team"],
      ] as Array<[ObjectID, ObjectID, string]>) {
        await insert("Team", {
          _id: id.toString(),
          projectId: project.toString(),
          name: name,
          slug: `team-${id.toString()}`,
          version: 1,
        });
      }

      for (const [id, project, name, color, order] of [
        [critical, projectId, "Critical Incident", "#FF0000", 1],
        [major, projectId, "Major Incident", "#FFA500", 2],
        [minor, projectId, "Minor Incident", "#FFFF00", 3],
        [otherProjectCritical, otherProjectId, "Their Critical", "#000000", 1],
      ] as Array<[ObjectID, ObjectID, string, string, number]>) {
        await insertSeverity("IncidentSeverity", {
          id,
          project,
          name,
          color,
          order,
        });
      }

      for (const [id, project, name, color, order] of [
        [criticalAlert, projectId, "Critical Alert", "#DC2626", 1],
        [warningAlert, projectId, "Warning", "#F59E0B", 2],
        [
          otherProjectCriticalAlert,
          otherProjectId,
          "Their Alert",
          "#000000",
          1,
        ],
      ] as Array<[ObjectID, ObjectID, string, string, number]>) {
        await insertSeverity("AlertSeverity", {
          id,
          project,
          name,
          color,
          order,
        });
      }
    });

    afterEach(() => {
      // A failed statement fails the test, even if a caller swallowed it.
      expect(failedQueries.failures).toEqual([]);
    });

    afterAll(async () => {
      jest.restoreAllMocks();
      if (database?.isInitialized) {
        await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await database.destroy();
      }
    });

    async function insert(table: string, row: SqlRow): Promise<void> {
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
          return row[column];
        }),
      );
    }

    async function insertSeverity(
      table: "IncidentSeverity" | "AlertSeverity",
      data: {
        id: ObjectID;
        project: ObjectID;
        name: string;
        color: string;
        order: number;
      },
    ): Promise<void> {
      await insert(table, {
        _id: data.id.toString(),
        projectId: data.project.toString(),
        name: data.name,
        slug: `severity-${data.id.toString()}`,
        color: data.color,
        order: data.order,
        version: 1,
      });
    }

    function ids(list: Array<ObjectID>): Array<string> {
      return list
        .map((id: ObjectID): string => {
          return id.toString();
        })
        .sort();
    }

    function upper(id: ObjectID): string {
      return id.toString().toUpperCase();
    }

    // `{_id}` JSON, as BaseAPI.updateItem hands an EntityArray to the hooks.
    function asJson(list: Array<ObjectID>): Array<JSONObject> {
      return list.map((id: ObjectID): JSONObject => {
        return { _id: id.toString() };
      });
    }

    /*
     * Models built from `{_id}` JSON by BaseModel.fromJSON: what
     * BaseAPI.createItem hands the hooks for a ModelForm create.
     */
    function asIncidentModels(list: Array<ObjectID>): Array<IncidentSeverity> {
      return BaseModel.fromJSONArray<IncidentSeverity>(
        asJson(list),
        IncidentSeverity,
      );
    }

    function asStrings(list: Array<ObjectID>): Array<string> {
      return list.map((id: ObjectID): string => {
        return id.toString();
      });
    }

    function buildRule(input: RuleInput): TeamComplianceSetting {
      const setting: TeamComplianceSetting = new TeamComplianceSetting();
      setting.projectId = input.projectId || projectId;
      setting.teamId = input.teamId || teamId;
      setting.ruleType = input.ruleType;
      setting.enabled = input.enabled === undefined ? true : input.enabled;

      /*
       * The hooks see whatever shape the caller sends, so the severity lists
       * go on the model untyped, exactly as they arrive.
       */
      const raw: Record<string, unknown> = setting as unknown as Record<
        string,
        unknown
      >;

      if (input.notificationChannel !== undefined) {
        raw["notificationChannel"] = input.notificationChannel;
      }

      if (input.incidentSeverities !== undefined) {
        raw["incidentSeverities"] = input.incidentSeverities;
      }

      if (input.alertSeverities !== undefined) {
        raw["alertSeverities"] = input.alertSeverities;
      }

      return setting;
    }

    async function createRule(
      input: RuleInput,
      props: DatabaseCommonInteractionProps = ROOT,
    ): Promise<ObjectID> {
      const created: TeamComplianceSetting =
        await TeamComplianceSettingService.create({
          data: buildRule(input),
          props: props,
        });

      expect(created.id).toBeTruthy();

      return created.id!;
    }

    async function updateRule(
      id: ObjectID,
      data: JSONObject,
      props: DatabaseCommonInteractionProps = ROOT,
    ): Promise<void> {
      await TeamComplianceSettingService.updateOneById({
        id: id,
        data: data as unknown as UpdateBy<TeamComplianceSetting>["data"],
        props: props,
      });
    }

    async function joinRows(
      table: string,
      settingId: ObjectID,
    ): Promise<Array<string>> {
      const column: string =
        table === INCIDENT_JOIN_TABLE
          ? "incidentSeverityId"
          : "alertSeverityId";
      const rows: Array<SqlRow> = await database.query(
        `SELECT "${column}" AS "id" FROM "${schema}"."${table}" WHERE "teamComplianceSettingId" = $1 ORDER BY "${column}"`,
        [settingId.toString()],
      );
      return rows.map((row: SqlRow): string => {
        return String(row["id"]);
      });
    }

    async function stored(settingId: ObjectID): Promise<StoredRule | null> {
      const rows: Array<SqlRow> = await database.query(
        `SELECT "ruleType", "notificationChannel", "enabled" FROM "${schema}"."TeamComplianceSetting" WHERE "_id" = $1`,
        [settingId.toString()],
      );

      if (!rows[0]) {
        return null;
      }

      return {
        ruleType: String(rows[0]["ruleType"]),
        notificationChannel:
          rows[0]["notificationChannel"] === null
            ? null
            : String(rows[0]["notificationChannel"]),
        enabled: rows[0]["enabled"] === true,
        incidentSeverityIds: await joinRows(INCIDENT_JOIN_TABLE, settingId),
        alertSeverityIds: await joinRows(ALERT_JOIN_TABLE, settingId),
      };
    }

    // The rule's options column, as Postgres holds it.
    async function storedOptions(settingId: ObjectID): Promise<unknown> {
      const rows: Array<SqlRow> = await database.query(
        `SELECT "options" FROM "${schema}"."TeamComplianceSetting" WHERE "_id" = $1`,
        [settingId.toString()],
      );

      return rows[0]?.["options"];
    }

    /*
     * Runs `deletes` side by side, holding each one's rule lookup until every
     * one of them has looked: what two requests (or two App replicas)
     * deleting at the same moment do. Without the hold, Promise.all may run
     * one delete to completion before the other looks, which hides the race.
     */
    async function deleteSideBySide(
      deletes: Array<() => Promise<unknown>>,
    ): Promise<void> {
      const lookup: (typeof TeamComplianceSettingService)["getRulesScopedToAnyOf"] =
        TeamComplianceSettingService.getRulesScopedToAnyOf.bind(
          TeamComplianceSettingService,
        );

      let arrived: number = 0;
      let releaseAll: () => void = (): void => {
        return;
      };
      const everyoneHasLooked: Promise<void> = new Promise<void>(
        (resolve: () => void): void => {
          releaseAll = resolve;
        },
      );

      const spy: jest.SpyInstance = jest
        .spyOn(TeamComplianceSettingService, "getRulesScopedToAnyOf")
        .mockImplementation(
          async (data: {
            severityKind: ComplianceSeverityKind;
            severities: Array<DeletedSeverity>;
          }): Promise<Array<string>> => {
            const found: Array<string> = await lookup(data);

            arrived++;

            if (arrived === deletes.length) {
              releaseAll();
            }

            await everyoneHasLooked;

            return found;
          },
        );

      try {
        await Promise.all(
          deletes.map((run: () => Promise<unknown>): Promise<unknown> => {
            return run();
          }),
        );
      } finally {
        spy.mockRestore();
      }

      expect(arrived).toBe(deletes.length);
    }

    async function countRules(): Promise<number> {
      const rows: Array<{ count: string }> = await database.query(
        `SELECT COUNT(*)::text AS "count" FROM "${schema}"."TeamComplianceSetting"`,
      );
      return Number(rows[0]!.count);
    }

    async function countJoinRows(): Promise<number> {
      const rows: Array<{ count: string }> = await database.query(
        `SELECT ((SELECT COUNT(*) FROM "${schema}"."${INCIDENT_JOIN_TABLE}") + (SELECT COUNT(*) FROM "${schema}"."${ALERT_JOIN_TABLE}"))::text AS "count"`,
      );
      return Number(rows[0]!.count);
    }

    function toReadSeverities(
      list: Array<IncidentSeverity | AlertSeverity> | undefined,
    ): Array<ReadSeverity> {
      return (list || [])
        .map((severity: IncidentSeverity | AlertSeverity): ReadSeverity => {
          return {
            id: severity.id!.toString(),
            name: severity.name,
            color: severity.color ? severity.color.toString() : undefined,
            order: severity.order,
          };
        })
        .sort((a: ReadSeverity, b: ReadSeverity): number => {
          return (a.order || 0) - (b.order || 0);
        });
    }

    // The rule read back the way the compliance page and the edit form do.
    async function readRule(
      id: ObjectID,
      props: DatabaseCommonInteractionProps = ROOT,
    ): Promise<TeamComplianceSetting | null> {
      return await TeamComplianceSettingService.findOneById({
        id: id,
        select: {
          _id: true,
          ruleType: true,
          enabled: true,
          notificationChannel: true,
          incidentSeverities: {
            _id: true,
            name: true,
            color: true,
            order: true,
          },
          alertSeverities: {
            _id: true,
            name: true,
            color: true,
            order: true,
          },
        },
        props: props,
      });
    }

    // A signed-in user holding `permissions` in `project`, owning nothing.
    function memberProps(
      project: ObjectID,
      permissions: Array<Permission>,
    ): DatabaseCommonInteractionProps {
      const tenantPermission: UserTenantAccessPermission = {
        projectId: project,
        _type: "UserTenantAccessPermission",
        permissions: permissions.map((permission: Permission) => {
          return {
            _type: "UserPermission",
            permission: permission,
            labelIds: [],
            isBlockPermission: false,
          };
        }),
      };

      return {
        tenantId: project,
        userId: ObjectID.generate(),
        userType: UserType.User,
        userTenantAccessPermission: {
          [project.toString()]: tenantPermission,
        },
      };
    }

    describe("the migrated tables", () => {
      test("a severity join row goes with its rule or its severity", () => {
        expect(
          migratedForeignKeys.map((foreignKey: ForeignKeyRow) => {
            return [
              foreignKey.table,
              foreignKey.column,
              foreignKey.referencedTable,
              foreignKey.onDelete,
            ];
          }),
        ).toEqual([
          // confdeltype: c = CASCADE
          [
            "TeamComplianceSettingAlertSeverity",
            "alertSeverityId",
            "AlertSeverity",
            "c",
          ],
          [
            "TeamComplianceSettingAlertSeverity",
            "teamComplianceSettingId",
            "TeamComplianceSetting",
            "c",
          ],
          [
            "TeamComplianceSettingIncidentSeverity",
            "incidentSeverityId",
            "IncidentSeverity",
            "c",
          ],
          [
            "TeamComplianceSettingIncidentSeverity",
            "teamComplianceSettingId",
            "TeamComplianceSetting",
            "c",
          ],
        ]);
      });

      test("every existing rule reads as 'any channel', and one team may hold several rules of a type", async () => {
        const columns: Array<SqlRow> = await database.query(
          `SELECT data_type, is_nullable, column_default, character_maximum_length
             FROM information_schema.columns
            WHERE table_schema = 'public' AND table_name = 'TeamComplianceSetting' AND column_name = 'notificationChannel'`,
        );

        expect(columns).toEqual([
          {
            data_type: "character varying",
            is_nullable: "YES",
            column_default: null,
            character_maximum_length: 100,
          },
        ]);

        const uniqueIndexes: Array<SqlRow> = await database.query(
          `SELECT indexname FROM pg_indexes
            WHERE schemaname = 'public' AND tablename = 'TeamComplianceSetting'
              AND indexdef LIKE 'CREATE UNIQUE INDEX%' AND indexdef LIKE '%"ruleType"%'`,
        );

        expect(uniqueIndexes).toEqual([]);
      });
    });

    describe("creating a rule", () => {
      test("severity ids sent as strings land as join rows, and read back with their name, colour and order", async () => {
        const id: ObjectID = await createRule({
          ruleType: ComplianceRuleType.HasIncidentOnCallRules,
          notificationChannel: ComplianceNotificationChannel.Call,
          incidentSeverities: asStrings([major, critical]),
        });

        expect(await stored(id)).toEqual({
          ruleType: ComplianceRuleType.HasIncidentOnCallRules,
          notificationChannel: ComplianceNotificationChannel.Call,
          enabled: true,
          incidentSeverityIds: ids([critical, major]),
          alertSeverityIds: [],
        });

        const rule: TeamComplianceSetting | null = await readRule(id);

        expect(rule?.notificationChannel).toBe(
          ComplianceNotificationChannel.Call,
        );
        expect(toReadSeverities(rule?.incidentSeverities)).toEqual([
          {
            id: critical.toString(),
            name: "Critical Incident",
            color: "#FF0000",
            order: 1,
          },
          {
            id: major.toString(),
            name: "Major Incident",
            color: "#FFA500",
            order: 2,
          },
        ]);
        expect(rule?.alertSeverities || []).toEqual([]);
      });

      test("severity ids sent as {_id} JSON land as join rows", async () => {
        const id: ObjectID = await createRule({
          ruleType: ComplianceRuleType.HasAlertOnCallRules,
          notificationChannel: ComplianceNotificationChannel.Push,
          alertSeverities: asJson([criticalAlert]),
        });

        expect(await stored(id)).toEqual({
          ruleType: ComplianceRuleType.HasAlertOnCallRules,
          notificationChannel: ComplianceNotificationChannel.Push,
          enabled: true,
          incidentSeverityIds: [],
          alertSeverityIds: ids([criticalAlert]),
        });

        const rule: TeamComplianceSetting | null = await readRule(id);

        expect(toReadSeverities(rule?.alertSeverities)).toEqual([
          {
            id: criticalAlert.toString(),
            name: "Critical Alert",
            color: "#DC2626",
            order: 1,
          },
        ]);
      });

      test("severities as the models BaseAPI builds from a ModelForm create land as join rows", async () => {
        const setting: TeamComplianceSetting =
          BaseModel.fromJSON<TeamComplianceSetting>(
            {
              ruleType: ComplianceRuleType.HasIncidentEpisodeOnCallRules,
              notificationChannel: ComplianceNotificationChannel.SMS,
              enabled: true,
              incidentSeverities: asJson([critical, minor]),
            },
            TeamComplianceSetting,
          ) as TeamComplianceSetting;
        setting.projectId = projectId;
        setting.teamId = teamId;

        const created: TeamComplianceSetting =
          await TeamComplianceSettingService.create({
            data: setting,
            props: ROOT,
          });

        expect(await stored(created.id!)).toEqual({
          ruleType: ComplianceRuleType.HasIncidentEpisodeOnCallRules,
          notificationChannel: ComplianceNotificationChannel.SMS,
          enabled: true,
          incidentSeverityIds: ids([critical, minor]),
          alertSeverityIds: [],
        });
      });

      test("no severities and no channel stores an 'any channel, every severity' rule with no join rows", async () => {
        const id: ObjectID = await createRule({
          ruleType: ComplianceRuleType.HasIncidentOnCallRules,
        });

        expect(await stored(id)).toEqual({
          ruleType: ComplianceRuleType.HasIncidentOnCallRules,
          notificationChannel: null,
          enabled: true,
          incidentSeverityIds: [],
          alertSeverityIds: [],
        });

        const rule: TeamComplianceSetting | null = await readRule(id);

        expect(rule?.incidentSeverities || []).toEqual([]);
        expect(rule?.notificationChannel ?? null).toBeNull();
      });

      test("options the rule type does not use are not stored", async () => {
        const methodRule: ObjectID = await createRule({
          ruleType: ComplianceRuleType.HasNotificationCallMethod,
          notificationChannel: ComplianceNotificationChannel.Push,
          incidentSeverities: asStrings([critical]),
          alertSeverities: asJson([criticalAlert]),
        });

        expect(await stored(methodRule)).toEqual({
          ruleType: ComplianceRuleType.HasNotificationCallMethod,
          notificationChannel: null,
          enabled: true,
          incidentSeverityIds: [],
          alertSeverityIds: [],
        });

        const incidentRule: ObjectID = await createRule({
          ruleType: ComplianceRuleType.HasIncidentOnCallRules,
          notificationChannel: ComplianceNotificationChannel.Call,
          incidentSeverities: asStrings([critical]),
          alertSeverities: asJson([criticalAlert]),
        });

        expect(await stored(incidentRule)).toEqual({
          ruleType: ComplianceRuleType.HasIncidentOnCallRules,
          notificationChannel: ComplianceNotificationChannel.Call,
          enabled: true,
          incidentSeverityIds: ids([critical]),
          alertSeverityIds: [],
        });

        const alertRule: ObjectID = await createRule({
          ruleType: ComplianceRuleType.HasAlertEpisodeOnCallRules,
          incidentSeverities: asStrings([critical]),
          alertSeverities: asStrings([warningAlert]),
        });

        expect(await stored(alertRule)).toEqual({
          ruleType: ComplianceRuleType.HasAlertEpisodeOnCallRules,
          notificationChannel: null,
          enabled: true,
          incidentSeverityIds: [],
          alertSeverityIds: ids([warningAlert]),
        });
      });

      test("an exact duplicate is refused whatever the shape, order or case of its severity ids", async () => {
        await createRule({
          ruleType: ComplianceRuleType.HasIncidentOnCallRules,
          notificationChannel: ComplianceNotificationChannel.Call,
          incidentSeverities: asStrings([critical, major]),
        });

        const duplicates: Array<SeverityList> = [
          asStrings([critical, major]),
          asStrings([major, critical]),
          [upper(critical), upper(major)],
          [upper(major), critical.toString()],
          asJson([major, critical]),
          asIncidentModels([major, critical]),
          asStrings([critical, major, critical]),
        ];

        for (const incidentSeverities of duplicates) {
          await expect(
            createRule({
              ruleType: ComplianceRuleType.HasIncidentOnCallRules,
              notificationChannel: ComplianceNotificationChannel.Call,
              incidentSeverities: incidentSeverities,
            }),
          ).rejects.toThrow(DUPLICATE_COMPLIANCE_RULE_MESSAGE);
        }

        expect(await countRules()).toBe(1);
        expect(await countJoinRows()).toBe(2);
      });

      /*
       * The premise of getIds' lower-casing: Postgres parses a uuid without
       * regard to case and hands it back lower case.
       */
      test("an upper-case id is stored as the lower-case uuid, and the lower-case spelling is then a duplicate", async () => {
        const id: ObjectID = await createRule({
          ruleType: ComplianceRuleType.HasIncidentOnCallRules,
          notificationChannel: ComplianceNotificationChannel.WhatsApp,
          incidentSeverities: [upper(minor)],
        });

        expect(await joinRows(INCIDENT_JOIN_TABLE, id)).toEqual(ids([minor]));

        await expect(
          createRule({
            ruleType: ComplianceRuleType.HasIncidentOnCallRules,
            notificationChannel: ComplianceNotificationChannel.WhatsApp,
            incidentSeverities: asStrings([minor]),
          }),
        ).rejects.toThrow(DUPLICATE_COMPLIANCE_RULE_MESSAGE);
      });

      test("the legacy 'any channel, every severity' rule and a method rule are still one per team", async () => {
        await createRule({
          ruleType: ComplianceRuleType.HasIncidentOnCallRules,
        });

        await expect(
          createRule({
            ruleType: ComplianceRuleType.HasIncidentOnCallRules,
            notificationChannel: null,
            incidentSeverities: [],
          }),
        ).rejects.toThrow(DUPLICATE_COMPLIANCE_RULE_MESSAGE);

        await createRule({
          ruleType: ComplianceRuleType.HasNotificationCallMethod,
        });

        // The channel and severities a method rule does not use change nothing.
        await expect(
          createRule({
            ruleType: ComplianceRuleType.HasNotificationCallMethod,
            notificationChannel: ComplianceNotificationChannel.SMS,
            incidentSeverities: asStrings([critical]),
          }),
        ).rejects.toThrow(DUPLICATE_COMPLIANCE_RULE_MESSAGE);

        expect(await countRules()).toBe(2);
      });

      test("a different channel, severity set, rule type or team is a different rule", async () => {
        const scope: Array<ObjectID> = [critical, major];

        await createRule({
          ruleType: ComplianceRuleType.HasIncidentOnCallRules,
          notificationChannel: ComplianceNotificationChannel.Call,
          incidentSeverities: asStrings(scope),
        });

        const allowed: Array<RuleInput> = [
          // Push for the same severities.
          {
            ruleType: ComplianceRuleType.HasIncidentOnCallRules,
            notificationChannel: ComplianceNotificationChannel.Push,
            incidentSeverities: asStrings(scope),
          },
          // Any channel for the same severities.
          {
            ruleType: ComplianceRuleType.HasIncidentOnCallRules,
            incidentSeverities: asStrings(scope),
          },
          // Call for a subset.
          {
            ruleType: ComplianceRuleType.HasIncidentOnCallRules,
            notificationChannel: ComplianceNotificationChannel.Call,
            incidentSeverities: asStrings([critical]),
          },
          // Call for a superset.
          {
            ruleType: ComplianceRuleType.HasIncidentOnCallRules,
            notificationChannel: ComplianceNotificationChannel.Call,
            incidentSeverities: asStrings([critical, major, minor]),
          },
          // Call for every severity.
          {
            ruleType: ComplianceRuleType.HasIncidentOnCallRules,
            notificationChannel: ComplianceNotificationChannel.Call,
          },
          // The episode rule type.
          {
            ruleType: ComplianceRuleType.HasIncidentEpisodeOnCallRules,
            notificationChannel: ComplianceNotificationChannel.Call,
            incidentSeverities: asStrings(scope),
          },
          // The same rule on another team.
          {
            ruleType: ComplianceRuleType.HasIncidentOnCallRules,
            notificationChannel: ComplianceNotificationChannel.Call,
            incidentSeverities: asStrings(scope),
            teamId: otherTeamId,
          },
        ];

        for (const input of allowed) {
          await createRule(input);
        }

        expect(await countRules()).toBe(1 + allowed.length);
      });

      test("a severity of another project, of the other kind, or that does not exist is refused and nothing is written", async () => {
        const refused: Array<{ input: RuleInput; message: string }> = [
          {
            input: {
              ruleType: ComplianceRuleType.HasIncidentOnCallRules,
              notificationChannel: ComplianceNotificationChannel.Call,
              incidentSeverities: asStrings([otherProjectCritical]),
            },
            message: FOREIGN_SEVERITY_MESSAGE,
          },
          {
            input: {
              ruleType: ComplianceRuleType.HasIncidentOnCallRules,
              notificationChannel: ComplianceNotificationChannel.Call,
              incidentSeverities: asJson([critical, otherProjectCritical]),
            },
            message: FOREIGN_SEVERITY_MESSAGE,
          },
          {
            input: {
              ruleType: ComplianceRuleType.HasIncidentOnCallRules,
              incidentSeverities: asStrings([criticalAlert]),
            },
            message: FOREIGN_SEVERITY_MESSAGE,
          },
          {
            input: {
              ruleType: ComplianceRuleType.HasAlertOnCallRules,
              alertSeverities: asStrings([otherProjectCriticalAlert]),
            },
            message:
              "One or more of the selected alert severities do not exist in this project.",
          },
          {
            input: {
              ruleType: ComplianceRuleType.HasIncidentOnCallRules,
              incidentSeverities: asStrings([ObjectID.generate()]),
            },
            message: FOREIGN_SEVERITY_MESSAGE,
          },
          {
            input: {
              ruleType: ComplianceRuleType.HasIncidentOnCallRules,
              incidentSeverities: ["not-a-uuid"],
            },
            message: 'Invalid ID format: "not-a-uuid".',
          },
        ];

        for (const { input, message } of refused) {
          await expect(createRule(input)).rejects.toThrow(message);
        }

        expect(await countRules()).toBe(0);
        expect(await countJoinRows()).toBe(0);
      });

      /*
       * The relation save inserts one join row per list item, and the join
       * table's primary key refuses the same severity twice. The service
       * writes the list it checked - de-duplicated, lower-cased - so a
       * repeat, in any case and any shape, is one join row, on create and on
       * update (where a re-sent id in another case must also not be INSERTed
       * next to the stored one).
       */
      test("a repeated severity id (in any case, on create or update) is stored once", async () => {
        const id: ObjectID = await createRule({
          ruleType: ComplianceRuleType.HasIncidentOnCallRules,
          notificationChannel: ComplianceNotificationChannel.Call,
          incidentSeverities: [critical.toString(), upper(critical)],
        });

        expect(await joinRows(INCIDENT_JOIN_TABLE, id)).toEqual(
          ids([critical]),
        );

        await updateRule(id, {
          incidentSeverities: asJson([major, major]),
        });

        expect(await joinRows(INCIDENT_JOIN_TABLE, id)).toEqual(ids([major]));

        await updateRule(id, {
          incidentSeverities: [
            { _id: upper(major) },
            { id: critical.toString() },
          ],
        });

        expect(await joinRows(INCIDENT_JOIN_TABLE, id)).toEqual(
          ids([critical, major]),
        );

        const alertRule: ObjectID = await createRule({
          ruleType: ComplianceRuleType.HasAlertOnCallRules,
          alertSeverities: [
            ...asJson([warningAlert, warningAlert]),
            upper(warningAlert),
          ],
        });

        expect(await joinRows(ALERT_JOIN_TABLE, alertRule)).toEqual(
          ids([warningAlert]),
        );
      });

      test("a severity list item is checked by the id the save writes: one read by its `id` cannot smuggle in another project's severity", async () => {
        const id: ObjectID = await createRule({
          ruleType: ComplianceRuleType.HasIncidentOnCallRules,
          notificationChannel: ComplianceNotificationChannel.Call,
          incidentSeverities: asStrings([critical]),
        });

        /*
         * What BaseAPI.updateItem hands the hooks: the JSON body, deserialized
         * (an `{_type: "ObjectID"}` value becomes an ObjectID), not models.
         * The save reads an `_id` only when it is a string, and otherwise the
         * item's `id`.
         */
        for (const item of [
          { _id: 1, id: otherProjectCritical.toString() },
          { _id: true, id: otherProjectCritical.toString() },
          { _id: critical, id: otherProjectCritical.toString() },
        ]) {
          await expect(
            updateRule(id, { incidentSeverities: [item] as never }),
          ).rejects.toThrow(FOREIGN_SEVERITY_MESSAGE);

          await expect(
            createRule({
              ruleType: ComplianceRuleType.HasIncidentOnCallRules,
              notificationChannel: ComplianceNotificationChannel.Push,
              incidentSeverities: [item as unknown as JSONObject],
            }),
          ).rejects.toThrow(FOREIGN_SEVERITY_MESSAGE);
        }

        /*
         * An item the save would drop is refused: the rule would otherwise be
         * stored with no severity at all - a rule for every severity.
         */
        await expect(
          updateRule(id, { incidentSeverities: [{ _id: major }] as never }),
        ).rejects.toThrow(
          "Every incident severity of a compliance rule must be a severity id.",
        );

        expect(await stored(id)).toEqual({
          ruleType: ComplianceRuleType.HasIncidentOnCallRules,
          notificationChannel: ComplianceNotificationChannel.Call,
          enabled: true,
          incidentSeverityIds: ids([critical]),
          alertSeverityIds: [],
        });
        expect(await countRules()).toBe(1);
      });

      test("a refused create leaves no rule behind", async () => {
        /*
         * A severity that passes the service's check but not the join
         * table's foreign key - the check is told it exists - so the refusal
         * comes from Postgres, after the rule row was inserted in the same
         * save.
         */
        const severityCheck: jest.SpyInstance = jest
          .spyOn(IncidentSeverityService, "countBy")
          .mockResolvedValueOnce(new PositiveNumber(1));

        try {
          await expect(
            createRule({
              ruleType: ComplianceRuleType.HasIncidentOnCallRules,
              notificationChannel: ComplianceNotificationChannel.Call,
              incidentSeverities: asStrings([ObjectID.generate()]),
            }),
          ).rejects.toThrow();
        } finally {
          severityCheck.mockRestore();
          failedQueries.failures = [];
        }

        /*
         * The rule row and its join rows are one save: a rule that lost its
         * severities would read as "every severity" - a stricter rule than
         * the one asked for.
         */
        expect(await countRules()).toBe(0);
        expect(await countJoinRows()).toBe(0);
      });
    });

    describe("updating a rule", () => {
      async function callForCriticalAndMajor(): Promise<ObjectID> {
        return await createRule({
          ruleType: ComplianceRuleType.HasIncidentOnCallRules,
          notificationChannel: ComplianceNotificationChannel.Call,
          incidentSeverities: asStrings([critical, major]),
        });
      }

      test("toggling enabled leaves the scope alone; switching off reads nothing, switching on reads only the row", async () => {
        const id: ObjectID = await callForCriticalAndMajor();

        const findBy: jest.SpyInstance = jest.spyOn(
          TeamComplianceSettingService,
          "findBy",
        );
        const incidentCount: jest.SpyInstance = jest.spyOn(
          IncidentSeverityService,
          "countBy",
        );
        const alertCount: jest.SpyInstance = jest.spyOn(
          AlertSeverityService,
          "countBy",
        );

        try {
          await updateRule(id, { enabled: false });

          expect(await stored(id)).toEqual({
            ruleType: ComplianceRuleType.HasIncidentOnCallRules,
            notificationChannel: ComplianceNotificationChannel.Call,
            enabled: false,
            incidentSeverityIds: ids([critical, major]),
            alertSeverityIds: [],
          });

          expect(findBy).not.toHaveBeenCalled();

          await updateRule(id, { enabled: true });

          expect((await stored(id))?.enabled).toBe(true);
          expect(await joinRows(INCIDENT_JOIN_TABLE, id)).toEqual(
            ids([critical, major]),
          );

          // Whether a severity delete emptied it: one read of the row.
          expect(findBy).toHaveBeenCalledTimes(1);
          expect(incidentCount).not.toHaveBeenCalled();
          expect(alertCount).not.toHaveBeenCalled();
        } finally {
          findBy.mockRestore();
          incidentCount.mockRestore();
          alertCount.mockRestore();
        }
      });

      test("changing an incident rule into a method rule clears its channel and severities", async () => {
        const id: ObjectID = await callForCriticalAndMajor();

        await updateRule(id, {
          ruleType: ComplianceRuleType.HasNotificationCallMethod,
        });

        expect(await stored(id)).toEqual({
          ruleType: ComplianceRuleType.HasNotificationCallMethod,
          notificationChannel: null,
          enabled: true,
          incidentSeverityIds: [],
          alertSeverityIds: [],
        });

        const rule: TeamComplianceSetting | null = await readRule(id);

        expect(rule?.incidentSeverities || []).toEqual([]);
        expect(rule?.notificationChannel ?? null).toBeNull();
      });

      test("changing an incident rule into an alert rule drops the incident severities and keeps the channel", async () => {
        const id: ObjectID = await callForCriticalAndMajor();

        await updateRule(id, {
          ruleType: ComplianceRuleType.HasAlertOnCallRules,
          alertSeverities: asJson([criticalAlert]),
        });

        expect(await stored(id)).toEqual({
          ruleType: ComplianceRuleType.HasAlertOnCallRules,
          notificationChannel: ComplianceNotificationChannel.Call,
          enabled: true,
          incidentSeverityIds: [],
          alertSeverityIds: ids([criticalAlert]),
        });
      });

      test("sending severities replaces the join rows, and an empty list clears them", async () => {
        const id: ObjectID = await callForCriticalAndMajor();

        await updateRule(id, { incidentSeverities: asJson([minor]) });

        expect(await joinRows(INCIDENT_JOIN_TABLE, id)).toEqual(ids([minor]));

        await updateRule(id, {
          incidentSeverities: asStrings([major, critical]),
        });

        expect(await joinRows(INCIDENT_JOIN_TABLE, id)).toEqual(
          ids([critical, major]),
        );

        await updateRule(id, { incidentSeverities: [] });

        expect(await stored(id)).toEqual({
          ruleType: ComplianceRuleType.HasIncidentOnCallRules,
          notificationChannel: ComplianceNotificationChannel.Call,
          enabled: true,
          incidentSeverityIds: [],
          alertSeverityIds: [],
        });
      });

      test("changing only the channel leaves the severity join rows alone", async () => {
        const id: ObjectID = await callForCriticalAndMajor();

        await updateRule(id, {
          notificationChannel: ComplianceNotificationChannel.Push,
        });

        expect(await stored(id)).toEqual({
          ruleType: ComplianceRuleType.HasIncidentOnCallRules,
          notificationChannel: ComplianceNotificationChannel.Push,
          enabled: true,
          incidentSeverityIds: ids([critical, major]),
          alertSeverityIds: [],
        });

        await updateRule(id, { notificationChannel: null });

        expect((await stored(id))?.notificationChannel).toBeNull();
        expect(await joinRows(INCIDENT_JOIN_TABLE, id)).toEqual(
          ids([critical, major]),
        );
      });

      test("alert severities sent to an incident rule are dropped and its incident severities stay", async () => {
        const id: ObjectID = await callForCriticalAndMajor();

        await updateRule(id, { alertSeverities: asJson([criticalAlert]) });

        expect(await stored(id)).toEqual({
          ruleType: ComplianceRuleType.HasIncidentOnCallRules,
          notificationChannel: ComplianceNotificationChannel.Call,
          enabled: true,
          incidentSeverityIds: ids([critical, major]),
          alertSeverityIds: [],
        });
      });

      test("re-saving a rule's own scope is not a duplicate of itself", async () => {
        const id: ObjectID = await callForCriticalAndMajor();

        await updateRule(id, {
          notificationChannel: ComplianceNotificationChannel.Call,
          incidentSeverities: asJson([major, critical]),
        });

        expect(await joinRows(INCIDENT_JOIN_TABLE, id)).toEqual(
          ids([critical, major]),
        );
      });

      test("a change that makes the rule a duplicate of a sibling, or points it at a foreign severity, is refused and changes nothing", async () => {
        const id: ObjectID = await callForCriticalAndMajor();

        await createRule({
          ruleType: ComplianceRuleType.HasIncidentOnCallRules,
          notificationChannel: ComplianceNotificationChannel.Call,
          incidentSeverities: asStrings([critical]),
        });

        await expect(
          updateRule(id, { incidentSeverities: asJson([critical]) }),
        ).rejects.toThrow(DUPLICATE_COMPLIANCE_RULE_MESSAGE);

        await expect(
          updateRule(id, { incidentSeverities: [upper(critical)] }),
        ).rejects.toThrow(DUPLICATE_COMPLIANCE_RULE_MESSAGE);

        await expect(
          updateRule(id, {
            incidentSeverities: asJson([critical, otherProjectCritical]),
          }),
        ).rejects.toThrow(FOREIGN_SEVERITY_MESSAGE);

        expect(await stored(id)).toEqual({
          ruleType: ComplianceRuleType.HasIncidentOnCallRules,
          notificationChannel: ComplianceNotificationChannel.Call,
          enabled: true,
          incidentSeverityIds: ids([critical, major]),
          alertSeverityIds: [],
        });
      });
    });

    describe("deleting", () => {
      test("deleting a severity removes its join row and keeps the rule", async () => {
        const id: ObjectID = await createRule({
          ruleType: ComplianceRuleType.HasIncidentOnCallRules,
          notificationChannel: ComplianceNotificationChannel.Call,
          incidentSeverities: asStrings([critical, major]),
        });

        // What DatabaseService.deleteBy issues once a delete is permitted.
        await database.query(
          `DELETE FROM "${schema}"."IncidentSeverity" WHERE "_id" = $1`,
          [critical.toString()],
        );

        expect(await stored(id)).toEqual({
          ruleType: ComplianceRuleType.HasIncidentOnCallRules,
          notificationChannel: ComplianceNotificationChannel.Call,
          enabled: true,
          incidentSeverityIds: ids([major]),
          alertSeverityIds: [],
        });

        const rule: TeamComplianceSetting | null = await readRule(id);

        expect(toReadSeverities(rule?.incidentSeverities)).toEqual([
          {
            id: major.toString(),
            name: "Major Incident",
            color: "#FFA500",
            order: 2,
          },
        ]);
      });

      test("deleting an alert severity removes its join row too", async () => {
        const id: ObjectID = await createRule({
          ruleType: ComplianceRuleType.HasAlertOnCallRules,
          notificationChannel: ComplianceNotificationChannel.Push,
          alertSeverities: asStrings([criticalAlert, warningAlert]),
        });

        await database.query(
          `DELETE FROM "${schema}"."AlertSeverity" WHERE "_id" = $1`,
          [warningAlert.toString()],
        );

        expect(await joinRows(ALERT_JOIN_TABLE, id)).toEqual(
          ids([criticalAlert]),
        );
      });

      /*
       * The raw deletes above show the cascade itself. Through the severity
       * services - the only way the product deletes a severity - a rule the
       * cascade leaves with no severity is paused rather than left to read
       * as a rule for every severity.
       */
      test("deleting a rule's only severity through the service pauses the rule; a rule with another severity left keeps it", async () => {
        const onlyCritical: ObjectID = await createRule({
          ruleType: ComplianceRuleType.HasIncidentOnCallRules,
          notificationChannel: ComplianceNotificationChannel.Call,
          incidentSeverities: asStrings([critical]),
        });
        const episodeOnlyCritical: ObjectID = await createRule({
          ruleType: ComplianceRuleType.HasIncidentEpisodeOnCallRules,
          notificationChannel: ComplianceNotificationChannel.SMS,
          incidentSeverities: asStrings([critical]),
        });
        const criticalAndMajor: ObjectID = await createRule({
          ruleType: ComplianceRuleType.HasIncidentOnCallRules,
          notificationChannel: ComplianceNotificationChannel.Push,
          incidentSeverities: asStrings([critical, major]),
        });
        const everySeverity: ObjectID = await createRule({
          ruleType: ComplianceRuleType.HasIncidentOnCallRules,
          notificationChannel: ComplianceNotificationChannel.Email,
        });
        const alertRule: ObjectID = await createRule({
          ruleType: ComplianceRuleType.HasAlertOnCallRules,
          alertSeverities: asStrings([criticalAlert]),
        });

        await IncidentSeverityService.deleteOneById({
          id: critical,
          props: ROOT,
        });

        expect(await stored(onlyCritical)).toEqual({
          ruleType: ComplianceRuleType.HasIncidentOnCallRules,
          notificationChannel: ComplianceNotificationChannel.Call,
          enabled: false,
          incidentSeverityIds: [],
          alertSeverityIds: [],
        });
        expect(await storedOptions(onlyCritical)).toEqual(MARKED);
        expect((await stored(episodeOnlyCritical))?.enabled).toBe(false);
        expect(await storedOptions(episodeOnlyCritical)).toEqual(MARKED);
        expect(await storedOptions(criticalAndMajor)).toBeNull();
        expect(await storedOptions(everySeverity)).toBeNull();

        expect(await stored(criticalAndMajor)).toEqual({
          ruleType: ComplianceRuleType.HasIncidentOnCallRules,
          notificationChannel: ComplianceNotificationChannel.Push,
          enabled: true,
          incidentSeverityIds: ids([major]),
          alertSeverityIds: [],
        });
        expect((await stored(everySeverity))?.enabled).toBe(true);
        expect(await stored(alertRule)).toMatchObject({
          enabled: true,
          alertSeverityIds: ids([criticalAlert]),
        });
      });

      test("deleting an alert rule's only severity through the service pauses it too", async () => {
        const onlyWarning: ObjectID = await createRule({
          ruleType: ComplianceRuleType.HasAlertEpisodeOnCallRules,
          notificationChannel: ComplianceNotificationChannel.Push,
          alertSeverities: asStrings([warningAlert]),
        });
        const incidentRule: ObjectID = await createRule({
          ruleType: ComplianceRuleType.HasIncidentOnCallRules,
          incidentSeverities: asStrings([critical]),
        });

        await AlertSeverityService.deleteOneById({
          id: warningAlert,
          props: ROOT,
        });

        expect(await stored(onlyWarning)).toMatchObject({
          enabled: false,
          alertSeverityIds: [],
        });
        expect((await stored(incidentRule))?.enabled).toBe(true);
      });

      test.each([
        ["incident", false],
        ["alert", true],
      ])(
        "two %s severity deletes side by side - the two severities of one rule - pause and mark it",
        async (_label: string, isAlert: boolean) => {
          const both: ObjectID = isAlert
            ? await createRule({
                ruleType: ComplianceRuleType.HasAlertOnCallRules,
                notificationChannel: ComplianceNotificationChannel.Call,
                alertSeverities: asStrings([criticalAlert, warningAlert]),
              })
            : await createRule({
                ruleType: ComplianceRuleType.HasIncidentOnCallRules,
                notificationChannel: ComplianceNotificationChannel.Call,
                incidentSeverities: asStrings([critical, major]),
              });

          // A rule with a severity neither delete touches.
          const keepsMinor: ObjectID = await createRule({
            ruleType: ComplianceRuleType.HasIncidentOnCallRules,
            notificationChannel: ComplianceNotificationChannel.Push,
            incidentSeverities: asStrings([critical, minor]),
          });

          await deleteSideBySide(
            (isAlert ? [criticalAlert, warningAlert] : [critical, major]).map(
              (id: ObjectID): (() => Promise<unknown>) => {
                return (): Promise<unknown> => {
                  return isAlert
                    ? AlertSeverityService.deleteOneById({
                        id: id,
                        props: ROOT,
                      })
                    : IncidentSeverityService.deleteOneById({
                        id: id,
                        props: ROOT,
                      });
                };
              },
            ),
          );

          expect(await stored(both)).toMatchObject({
            enabled: false,
            incidentSeverityIds: [],
            alertSeverityIds: [],
          });
          expect(await storedOptions(both)).toEqual(MARKED);

          expect(await stored(keepsMinor)).toMatchObject({
            enabled: true,
            incidentSeverityIds: isAlert
              ? ids([critical, minor])
              : ids([minor]),
          });
          expect(await storedOptions(keepsMinor)).toBeNull();
        },
      );

      test("a rule an admin had paused is marked too, so switching it on later cannot widen it", async () => {
        const paused: ObjectID = await createRule({
          ruleType: ComplianceRuleType.HasIncidentOnCallRules,
          notificationChannel: ComplianceNotificationChannel.Call,
          incidentSeverities: asStrings([critical]),
          enabled: false,
        });

        await IncidentSeverityService.deleteOneById({
          id: critical,
          props: ROOT,
        });

        expect(await storedOptions(paused)).toEqual(MARKED);

        await expect(updateRule(paused, { enabled: true })).rejects.toThrow(
          SEVERITIES_DELETED_ENABLE_MESSAGE,
        );
        expect((await stored(paused))?.enabled).toBe(false);
      });

      /*
       * The rule a delete emptied is stored with no severities - exactly how
       * the team's real "every severity" rule of the same type and channel
       * is stored. It must neither block that rule's edit form as a
       * duplicate, nor be switched back on as a second copy of it.
       */
      test("a rule a delete emptied duplicates nothing, cannot be switched on as it is, and is re-scoped from its edit form", async () => {
        const everySeverity: ObjectID = await createRule({
          ruleType: ComplianceRuleType.HasIncidentOnCallRules,
          notificationChannel: ComplianceNotificationChannel.Call,
        });
        const onlyCritical: ObjectID = await createRule({
          ruleType: ComplianceRuleType.HasIncidentOnCallRules,
          notificationChannel: ComplianceNotificationChannel.Call,
          incidentSeverities: asStrings([critical]),
        });

        await IncidentSeverityService.deleteOneById({
          id: critical,
          props: ROOT,
        });

        // The every-severity rule's edit form sends its whole scope.
        await updateRule(everySeverity, {
          ruleType: ComplianceRuleType.HasIncidentOnCallRules,
          notificationChannel: ComplianceNotificationChannel.Call,
          incidentSeverities: [],
          alertSeverities: [],
          enabled: false,
        });

        expect((await stored(everySeverity))?.enabled).toBe(false);

        await expect(
          updateRule(onlyCritical, { enabled: true }),
        ).rejects.toThrow(SEVERITIES_DELETED_ENABLE_MESSAGE);

        expect((await stored(onlyCritical))?.enabled).toBe(false);
        expect(await storedOptions(onlyCritical)).toEqual(MARKED);

        // The emptied rule's edit form: new severities, switched back on.
        await updateRule(onlyCritical, {
          ruleType: ComplianceRuleType.HasIncidentOnCallRules,
          notificationChannel: ComplianceNotificationChannel.Call,
          incidentSeverities: asJson([major]),
          alertSeverities: [],
          enabled: true,
        });

        expect(await stored(onlyCritical)).toEqual({
          ruleType: ComplianceRuleType.HasIncidentOnCallRules,
          notificationChannel: ComplianceNotificationChannel.Call,
          enabled: true,
          incidentSeverityIds: ids([major]),
          alertSeverityIds: [],
        });
        expect(await storedOptions(onlyCritical)).toBeNull();

        // An ordinary rule again: it can now be switched off and on.
        await updateRule(onlyCritical, { enabled: false });
        await updateRule(onlyCritical, { enabled: true });
        expect((await stored(onlyCritical))?.enabled).toBe(true);
      });

      test("re-scoping an emptied rule keeps every other option it carries", async () => {
        const onlyCritical: ObjectID = await createRule({
          ruleType: ComplianceRuleType.HasIncidentOnCallRules,
          notificationChannel: ComplianceNotificationChannel.Call,
          incidentSeverities: asStrings([critical]),
        });

        await database.query(
          `UPDATE "${schema}"."TeamComplianceSetting" SET "options" = $1 WHERE "_id" = $2`,
          [JSON.stringify({ note: "keep me" }), onlyCritical.toString()],
        );

        await IncidentSeverityService.deleteOneById({
          id: critical,
          props: ROOT,
        });

        expect(await storedOptions(onlyCritical)).toEqual({
          note: "keep me",
          ...MARKED,
        });

        await updateRule(onlyCritical, {
          incidentSeverities: asJson([minor]),
        });

        expect(await storedOptions(onlyCritical)).toEqual({ note: "keep me" });
      });

      test("a delete the database refuses - the severity is still in use - pauses nothing", async () => {
        const onlyCritical: ObjectID = await createRule({
          ruleType: ComplianceRuleType.HasIncidentOnCallRules,
          notificationChannel: ComplianceNotificationChannel.Call,
          incidentSeverities: asStrings([critical]),
        });

        /*
         * Incidents reference their severity with ON DELETE NO ACTION, so a
         * severity any incident used cannot be deleted. A stand-in table
         * with the same kind of reference.
         */
        await database.query(
          `CREATE TABLE "${schema}"."SeverityInUse" ("incidentSeverityId" uuid NOT NULL REFERENCES "${schema}"."IncidentSeverity"("_id"))`,
        );

        try {
          await database.query(
            `INSERT INTO "${schema}"."SeverityInUse" ("incidentSeverityId") VALUES ($1)`,
            [critical.toString()],
          );

          await expect(
            IncidentSeverityService.deleteOneById({
              id: critical,
              props: ROOT,
            }),
          ).rejects.toThrow();
        } finally {
          await database.query(`DROP TABLE "${schema}"."SeverityInUse"`);
          failedQueries.failures = [];
        }

        expect(await stored(onlyCritical)).toEqual({
          ruleType: ComplianceRuleType.HasIncidentOnCallRules,
          notificationChannel: ComplianceNotificationChannel.Call,
          enabled: true,
          incidentSeverityIds: ids([critical]),
          alertSeverityIds: [],
        });
      });

      test("deleting a rule through the service removes its join rows and nobody else's", async () => {
        const id: ObjectID = await createRule({
          ruleType: ComplianceRuleType.HasIncidentOnCallRules,
          notificationChannel: ComplianceNotificationChannel.Call,
          incidentSeverities: asStrings([critical, major]),
        });

        const sibling: ObjectID = await createRule({
          ruleType: ComplianceRuleType.HasIncidentOnCallRules,
          notificationChannel: ComplianceNotificationChannel.Push,
          incidentSeverities: asStrings([critical]),
        });

        await TeamComplianceSettingService.deleteOneById({
          id: id,
          props: ROOT,
        });

        expect(await stored(id)).toBeNull();
        expect(await joinRows(INCIDENT_JOIN_TABLE, id)).toEqual([]);
        expect(await joinRows(INCIDENT_JOIN_TABLE, sibling)).toEqual(
          ids([critical]),
        );
      });
    });

    /*
     * The dashboard's path: a signed-in project admin, through the permission
     * layer, with the request's project as the tenant.
     */
    describe("as a signed-in project admin", () => {
      let licenceCheck: jest.SpyInstance;

      beforeAll(() => {
        licenceCheck = jest
          .spyOn(EnterpriseEdition, "assertFeatureAvailableSync")
          .mockReturnValue(undefined);
      });

      afterAll(() => {
        licenceCheck.mockRestore();
      });

      test("creates, reads back and rescopes a rule of their project", async () => {
        const admin: DatabaseCommonInteractionProps = memberProps(projectId, [
          Permission.ProjectAdmin,
        ]);

        const id: ObjectID = await createRule(
          {
            ruleType: ComplianceRuleType.HasIncidentOnCallRules,
            notificationChannel: ComplianceNotificationChannel.Call,
            incidentSeverities: asIncidentModels([critical]),
          },
          admin,
        );

        expect(await stored(id)).toEqual({
          ruleType: ComplianceRuleType.HasIncidentOnCallRules,
          notificationChannel: ComplianceNotificationChannel.Call,
          enabled: true,
          incidentSeverityIds: ids([critical]),
          alertSeverityIds: [],
        });

        const rule: TeamComplianceSetting | null = await readRule(id, admin);

        expect(toReadSeverities(rule?.incidentSeverities)).toEqual([
          {
            id: critical.toString(),
            name: "Critical Incident",
            color: "#FF0000",
            order: 1,
          },
        ]);

        await updateRule(
          id,
          { incidentSeverities: asJson([critical, major]) },
          admin,
        );

        expect(await joinRows(INCIDENT_JOIN_TABLE, id)).toEqual(
          ids([critical, major]),
        );

        await expect(
          createRule(
            {
              ruleType: ComplianceRuleType.HasIncidentOnCallRules,
              notificationChannel: ComplianceNotificationChannel.Call,
              incidentSeverities: asJson([major, critical]),
            },
            admin,
          ),
        ).rejects.toThrow(DUPLICATE_COMPLIANCE_RULE_MESSAGE);
      });

      test("a signed-in delete by a project admin pauses the rule too, and still re-ranks the severities that remain", async () => {
        const admin: DatabaseCommonInteractionProps = memberProps(projectId, [
          Permission.ProjectAdmin,
        ]);

        const onlyCritical: ObjectID = await createRule({
          ruleType: ComplianceRuleType.HasIncidentOnCallRules,
          notificationChannel: ComplianceNotificationChannel.Call,
          incidentSeverities: asStrings([critical]),
        });

        await IncidentSeverityService.deleteOneById({
          id: critical,
          props: admin,
        });

        expect((await stored(onlyCritical))?.enabled).toBe(false);

        const orders: Array<SqlRow> = await database.query(
          `SELECT "_id", "order" FROM "${schema}"."IncidentSeverity" WHERE "projectId" = $1 ORDER BY "order"`,
          [projectId.toString()],
        );

        expect(orders).toEqual([
          { _id: major.toString(), order: 1 },
          { _id: minor.toString(), order: 2 },
        ]);
      });

      /*
       * The hooks read as root in the project the request names, and
       * DatabaseService only checks the caller's permission after them. They
       * check it first, so a caller with no say over the project's rules is
       * refused before any of their answers - "not a severity of this
       * project", "this team already has that rule" - can describe it.
       */
      test("a caller who may not change the project's rules learns nothing about its severities or rules", async () => {
        await createRule({
          ruleType: ComplianceRuleType.HasIncidentOnCallRules,
          notificationChannel: ComplianceNotificationChannel.Call,
          incidentSeverities: asStrings([critical]),
        });

        const outsiders: Array<DatabaseCommonInteractionProps> = [
          // Signed in elsewhere, naming this project.
          {
            ...memberProps(otherProjectId, [Permission.ProjectAdmin]),
            tenantId: projectId,
          },
          // A member who may only read the project's teams.
          memberProps(projectId, [
            Permission.ProjectMember,
            Permission.ReadProjectTeam,
          ]),
        ];

        for (const props of outsiders) {
          // A foreign severity, and an exact duplicate: both refused alike.
          for (const severity of [otherProjectCritical, critical]) {
            await expect(
              createRule(
                {
                  ruleType: ComplianceRuleType.HasIncidentOnCallRules,
                  notificationChannel: ComplianceNotificationChannel.Call,
                  incidentSeverities: asStrings([severity]),
                },
                props,
              ),
            ).rejects.toThrow(NotAuthorizedException);
          }
        }

        expect(await countRules()).toBe(1);
      });

      test("a team editor creates and rescopes a rule; cleared options pass the permission check", async () => {
        const editor: DatabaseCommonInteractionProps = memberProps(projectId, [
          Permission.ReadProjectTeam,
          Permission.EditProjectTeam,
        ]);

        // A method rule sent with options it does not take: cleared, allowed.
        const method: ObjectID = await createRule(
          {
            ruleType: ComplianceRuleType.HasNotificationCallMethod,
            notificationChannel: ComplianceNotificationChannel.SMS,
            incidentSeverities: asStrings([critical]),
          },
          editor,
        );

        expect(await stored(method)).toEqual({
          ruleType: ComplianceRuleType.HasNotificationCallMethod,
          notificationChannel: null,
          enabled: true,
          incidentSeverityIds: [],
          alertSeverityIds: [],
        });

        const id: ObjectID = await createRule(
          {
            ruleType: ComplianceRuleType.HasIncidentOnCallRules,
            notificationChannel: ComplianceNotificationChannel.Call,
            incidentSeverities: asIncidentModels([critical]),
            alertSeverities: asStrings([criticalAlert]),
          },
          editor,
        );

        await updateRule(
          id,
          { incidentSeverities: [upper(major), { _id: critical.toString() }] },
          editor,
        );

        expect(await joinRows(INCIDENT_JOIN_TABLE, id)).toEqual(
          ids([critical, major]),
        );

        await updateRule(
          id,
          { ruleType: ComplianceRuleType.HasNotificationPushMethod },
          editor,
        );

        expect(await stored(id)).toEqual({
          ruleType: ComplianceRuleType.HasNotificationPushMethod,
          notificationChannel: null,
          enabled: true,
          incidentSeverityIds: [],
          alertSeverityIds: [],
        });

        // Edit Teams on its own creates, as it did before.
        await createRule(
          { ruleType: ComplianceRuleType.HasNotificationEmailMethod },
          memberProps(projectId, [Permission.EditProjectTeam]),
        );

        expect(await countRules()).toBe(3);
      });

      /*
       * A row whose stored rule type this build does not recognise - legacy
       * data, or written by a newer build before a rollback - still gets
       * whatever severity list an update sends written to it, so the list is
       * checked against the row's project by its own kind.
       */
      test("cannot link another project's severity to a rule of an unrecognised type", async () => {
        const admin: DatabaseCommonInteractionProps = memberProps(projectId, [
          Permission.ProjectAdmin,
        ]);

        const id: ObjectID = await createRule({
          ruleType: ComplianceRuleType.HasIncidentOnCallRules,
        });

        await database.query(
          `UPDATE "${schema}"."TeamComplianceSetting" SET "ruleType" = 'LegacyRule' WHERE "_id" = $1`,
          [id.toString()],
        );

        await expect(
          updateRule(
            id,
            { incidentSeverities: asJson([otherProjectCritical]) },
            admin,
          ),
        ).rejects.toThrow(FOREIGN_SEVERITY_MESSAGE);

        await expect(
          updateRule(
            id,
            { alertSeverities: asJson([otherProjectCriticalAlert]) },
            admin,
          ),
        ).rejects.toThrow(FOREIGN_ALERT_SEVERITY_MESSAGE);

        expect(await countJoinRows()).toBe(0);

        // This project's own severities are still accepted.
        await updateRule(id, { incidentSeverities: asJson([critical]) }, admin);

        expect(await joinRows(INCIDENT_JOIN_TABLE, id)).toEqual(
          ids([critical]),
        );
      });

      test("a project admin cannot switch a rule a delete emptied back on, but can re-scope it", async () => {
        const admin: DatabaseCommonInteractionProps = memberProps(projectId, [
          Permission.ProjectAdmin,
        ]);

        const onlyCritical: ObjectID = await createRule({
          ruleType: ComplianceRuleType.HasIncidentOnCallRules,
          notificationChannel: ComplianceNotificationChannel.Call,
          incidentSeverities: asStrings([critical]),
        });

        await IncidentSeverityService.deleteOneById({
          id: critical,
          props: admin,
        });

        await expect(
          updateRule(onlyCritical, { enabled: true }, admin),
        ).rejects.toThrow(SEVERITIES_DELETED_ENABLE_MESSAGE);

        // A caller with no say in the project is refused before any read.
        await expect(
          updateRule(
            onlyCritical,
            { enabled: true },
            {
              ...memberProps(otherProjectId, [Permission.ProjectAdmin]),
              tenantId: projectId,
            },
          ),
        ).rejects.toThrow(NotAuthorizedException);

        await updateRule(
          onlyCritical,
          { incidentSeverities: asJson([major]), enabled: true },
          admin,
        );

        expect(await stored(onlyCritical)).toMatchObject({
          enabled: true,
          incidentSeverityIds: ids([major]),
        });
        expect(await storedOptions(onlyCritical)).toBeNull();
      });

      test("cannot rescope another project's rule", async () => {
        const id: ObjectID = await createRule({
          ruleType: ComplianceRuleType.HasIncidentOnCallRules,
          notificationChannel: ComplianceNotificationChannel.Call,
          incidentSeverities: asStrings([critical]),
        });

        const otherAdmin: DatabaseCommonInteractionProps = memberProps(
          otherProjectId,
          [Permission.ProjectAdmin],
        );

        await updateRule(
          id,
          { incidentSeverities: asJson([otherProjectCritical]) },
          otherAdmin,
        );

        expect(await joinRows(INCIDENT_JOIN_TABLE, id)).toEqual(
          ids([critical]),
        );
      });

      /*
       * The request's project is stamped on the payload before the hooks run
       * (DatabaseService._onBeforeCreate), so the severity check is made
       * against the admin's own project whatever projectId the payload names.
       */
      test("cannot attach another project's severity by naming that project in the payload", async () => {
        const admin: DatabaseCommonInteractionProps = memberProps(projectId, [
          Permission.ProjectAdmin,
        ]);

        await expect(
          createRule(
            {
              ruleType: ComplianceRuleType.HasIncidentOnCallRules,
              notificationChannel: ComplianceNotificationChannel.Call,
              incidentSeverities: asIncidentModels([otherProjectCritical]),
              projectId: otherProjectId,
            },
            admin,
          ),
        ).rejects.toThrow(FOREIGN_SEVERITY_MESSAGE);

        expect(await countRules()).toBe(0);
        expect(await countJoinRows()).toBe(0);

        const id: ObjectID = await createRule(
          {
            ruleType: ComplianceRuleType.HasIncidentOnCallRules,
            notificationChannel: ComplianceNotificationChannel.Call,
            incidentSeverities: asIncidentModels([critical]),
            projectId: otherProjectId,
          },
          admin,
        );

        const rows: Array<SqlRow> = await database.query(
          `SELECT "projectId" FROM "${schema}"."TeamComplianceSetting" WHERE "_id" = $1`,
          [id.toString()],
        );

        expect(rows).toEqual([{ projectId: projectId.toString() }]);
      });
    });
  },
);
