import Entities from "../../../Models/DatabaseModels/Index";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Incident from "../../../Models/DatabaseModels/Incident";
import Alert from "../../../Models/DatabaseModels/Alert";
import BaseAPI from "../../../Server/API/BaseAPI";
import CommonAPI from "../../../Server/API/CommonAPI";
import GlobalCache from "../../../Server/Infrastructure/GlobalCache";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import AlertEpisodeService from "../../../Server/Services/AlertEpisodeService";
import AlertService from "../../../Server/Services/AlertService";
import AuditLogService from "../../../Server/Services/AuditLogService";
import DatabaseService from "../../../Server/Services/DatabaseService";
import IncidentEpisodeService from "../../../Server/Services/IncidentEpisodeService";
import IncidentService from "../../../Server/Services/IncidentService";
import MutableMetricService from "../../../Server/Services/MutableMetricService";
import PrivateRecordPermission, {
  ALSO_PART_OF,
  PRIVATE_RECORD_KINDS,
  PrivateRecordColumn,
  PrivateRecordKind,
} from "../../../Server/Types/Database/Permissions/PrivateRecordPermission";
import QueryHelper from "../../../Server/Types/Database/QueryHelper";
import { ExpressRequest, ExpressResponse } from "../../../Server/Utils/Express";
import MeasurementMetricWriter from "../../../Server/Utils/Measurement/MeasurementMetricWriter";
import ProjectUsageCache from "../../../Server/Utils/ProjectProducts/ProjectUsageCache";
import Response from "../../../Server/Utils/Response";
import StatusPageOverviewCache from "../../../Server/Utils/StatusPage/StatusPageOverviewCache";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import LIMIT_MAX from "../../../Types/Database/LimitMax";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import UserType from "../../../Types/UserType";
import { getJestSpyOn } from "../../Spy";
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
import { DataSource, Logger } from "typeorm";

/*
 * A DELETED PRIVATE RECORD LEAVES NOTHING ABOUT IT BEHIND, ON A MIGRATED
 * POSTGRES (#9103).
 *
 * What is done and sent about a private incident, alert or episode - its
 * on-call policy pages and their steps, its runbook runs, the fixes
 * OneUptime AI proposed for it, the logs of the email, SMS, calls, push,
 * WhatsApp, Telegram, Slack and Microsoft Teams messages, webhooks and AI
 * requests about it, an episode's member rows, an incident's link to an
 * alert (PrivateRecordParts.ALSO_PART_OF) - is read only by those who see
 * the record, which the read rule tells from the key naming it. A row whose
 * key names no record is read by everyone. So deleting the record must
 * delete them: a runbook run and a fix cleared their key and stayed, until
 * CascadeRunsAndFixesWithTheirRecord.
 *
 * Here every one of them, by every key that names a record of each kind, is
 * written about a private incident, alert or episode, and the record is
 * deleted each way it can be:
 *
 *   - one at a time, by its service as a Project Admin - what the
 *     dashboard, the API, Terraform and MCP send - and through the API's own
 *     delete route;
 *   - many at once (deleteBy), as a bulk Delete does;
 *   - by the retention purge of resolved records (hardDeleteBy as root, as
 *     ResolvedRecordRetention calls it);
 *   - with its project.
 *
 * Nothing that named it is left, a run's Runner jobs included, and the same
 * rows about another private record are. The deletes run through the
 * services' own delete paths and hooks; workflows, live updates, the audit
 * log, metrics (ClickHouse) and caches (Redis) are stubbed.
 *
 * Opt in with RUN_POSTGRES_PRIVATE_RECORD_DELETION_TESTS=true against a
 * database the registered migrations have been applied to, e.g.
 *
 *   RUN_POSTGRES_PRIVATE_RECORD_DELETION_TESTS=true \
 *   PRIVATE_RECORD_DELETION_TEST_DATABASE_HOST=127.0.0.1 \
 *   PRIVATE_RECORD_DELETION_TEST_DATABASE_PORT=5400 \
 *   DATABASE_PASSWORD=... npx jest Tests/Server/Services/PrivateRecordDeletionPostgres.test.ts
 *
 * CI runs it in .github/workflows/postgres-schema-drift.yaml. The tables it
 * writes are cloned from public into a uniquely named schema (LIKE ...
 * INCLUDING ALL, which copies no foreign key), and the migrated foreign keys
 * to a project, to the private records and to a runbook run are made again
 * between the copies, as public has them: Postgres, not this suite, decides
 * what goes. The connection's search path is that schema, then public: a
 * table a delete only reads is the migrated, empty one.
 */
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_PRIVATE_RECORD_DELETION_TESTS"] === "true"
    ? describe
    : describe.skip;

jest.setTimeout(10 * 60 * 1000);

type SqlRow = Record<string, unknown>;

interface RequiredColumn {
  name: string;
  type: string;
  maxLength: number | null;
}

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

function modelOfTable(tableName: string): { new (): BaseModel } {
  const found: { new (): BaseModel } | undefined = Entities.find(
    (modelType: { new (): BaseModel }): boolean => {
      return new modelType().tableName === tableName;
    },
  );

  if (!found) {
    throw new Error(`No model has the table ${tableName}.`);
  }

  return found;
}

// What is done and sent about a private record, by model.
const PARTS: Array<{ modelType: { new (): BaseModel }; table: string }> =
  Object.keys(ALSO_PART_OF).map((table: string) => {
    return { modelType: modelOfTable(table), table: table };
  });

// Each record kind's service, which deletes it.
const SERVICE_OF_KIND: Record<string, DatabaseService<BaseModel>> = {
  Incident: IncidentService as unknown as DatabaseService<BaseModel>,
  Alert: AlertService as unknown as DatabaseService<BaseModel>,
  IncidentEpisode:
    IncidentEpisodeService as unknown as DatabaseService<BaseModel>,
  AlertEpisode: AlertEpisodeService as unknown as DatabaseService<BaseModel>,
};

// The tables whose foreign keys to them are made again between the copies.
const KEYED_TABLES: Array<string> = [
  "Project",
  ...PRIVATE_RECORD_KINDS.map((kind: PrivateRecordKind): string => {
    return kind.tableName;
  }),
  "RunbookExecution",
];

const TABLES: Array<string> = Array.from(
  new Set<string>([
    "Project",
    "TeamMember",
    ...PRIVATE_RECORD_KINDS.flatMap((kind: PrivateRecordKind) => {
      return [kind.tableName, kind.ownerUserTable, kind.ownerTeamTable];
    }),
    ...PARTS.map((part: { table: string }): string => {
      return part.table;
    }),
    "RunnerJob",
  ]),
);

// How a record goes.
type Deletion =
  | "one delete, by its service"
  | "one delete, through the API's route"
  | "a bulk delete"
  | "the retention purge"
  | "its project's deletion";

const DELETIONS: Array<Deletion> = [
  "one delete, by its service",
  "one delete, through the API's route",
  "a bulk delete",
  "the retention purge",
  "its project's deletion",
];

describePostgres(
  "a deleted private record leaves nothing about it behind, on a migrated Postgres",
  () => {
    const schema: string = `private_record_deletion_${ObjectID.generate()
      .toString()
      .replace(/-/g, "")}`;

    const failedQueries: FailedQueryRecorder = new FailedQueryRecorder();
    let database: DataSource;

    const required: Record<string, Array<RequiredColumn>> = {};

    beforeAll(async () => {
      database = new DataSource({
        type: "postgres",
        host:
          process.env["PRIVATE_RECORD_DELETION_TEST_DATABASE_HOST"] ||
          "localhost",
        port: Number(
          process.env["PRIVATE_RECORD_DELETION_TEST_DATABASE_PORT"] || "5400",
        ),
        username: process.env["DATABASE_USERNAME"] || "postgres",
        password: process.env["DATABASE_PASSWORD"] || "password",
        database:
          process.env["PRIVATE_RECORD_DELETION_TEST_DATABASE_NAME"] ||
          process.env["DATABASE_NAME"] ||
          "oneuptimedb",
        entities: Entities,
        synchronize: false,
        logger: failedQueries,
        extra: { options: `-c search_path=${schema},public` },
      });
      await database.initialize();

      const notNull: Array<{
        table: string;
        name: string;
        type: string;
        maxLength: number | null;
      }> = await database.query(
        `SELECT table_name AS "table", column_name AS "name", data_type AS "type",
                character_maximum_length AS "maxLength"
           FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = ANY($1)
            AND is_nullable = 'NO'
            AND column_default IS NULL`,
        [TABLES],
      );

      for (const column of notNull) {
        (required[column.table] = required[column.table] || []).push({
          name: column.name,
          type: column.type,
          maxLength:
            column.maxLength === null ? null : Number(column.maxLength),
        });
      }

      // The migrated foreign keys between the tables copied.
      const keys: Array<{ table: string; name: string; definition: string }> =
        await database.query(
          `SELECT source.relname AS "table", constraint_row.conname AS "name",
                  pg_get_constraintdef(constraint_row.oid) AS "definition"
             FROM pg_constraint constraint_row
             JOIN pg_class source ON source.oid = constraint_row.conrelid
             JOIN pg_namespace source_schema ON source_schema.oid = source.relnamespace
             JOIN pg_class target ON target.oid = constraint_row.confrelid
            WHERE constraint_row.contype = 'f'
              AND source_schema.nspname = 'public'
              AND source.relname = ANY($1)
              AND target.relname = ANY($2)`,
          [TABLES, KEYED_TABLES],
        );

      await database.query(`CREATE SCHEMA "${schema}"`);

      for (const table of TABLES) {
        await database.query(
          `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
        );
      }

      const current: Array<{ current_schema: string }> = await database.query(
        "SELECT current_schema()",
      );
      expect(current[0]?.current_schema).toBe(schema);

      // As public has them, pointing at the copies.
      for (const key of keys) {
        await database.query(
          `ALTER TABLE "${schema}"."${key.table}" ADD CONSTRAINT "${key.name}" ${key.definition.replace(
            /REFERENCES (public\.)?/,
            `REFERENCES "${schema}".`,
          )}`,
        );
      }

      // Every key naming a private record, in every part, is one of them.
      expect(keys.length).toBeGreaterThan(PARTS.length);

      getJestSpyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
      getJestSpyOn(PostgresAppInstance, "getDataSource").mockReturnValue(
        database,
      );
    });

    // What each test stubs, restored after it: the data source stays.
    let stubs: Array<ReturnType<typeof getJestSpyOn>> = [];

    function stub(
      object: unknown,
      method: string,
      value: unknown,
    ): ReturnType<typeof getJestSpyOn> {
      const spy: ReturnType<typeof getJestSpyOn> = getJestSpyOn(
        object,
        method,
      ).mockResolvedValue(value as never);

      stubs.push(spy);

      return spy;
    }

    beforeEach(() => {
      failedQueries.failures = [];
      stubs = [];

      // Workflows, live updates, the audit log, ClickHouse and Redis run elsewhere.
      stub(DatabaseService.prototype, "onTriggerWorkflow", undefined);
      stub(DatabaseService.prototype, "onTriggerRealtime", undefined);

      for (const service of Object.values(SERVICE_OF_KIND)) {
        stub(service, "onTriggerWorkflow", undefined);
        stub(service, "onTriggerRealtime", undefined);
      }

      stub(AuditLogService, "recordDelete", undefined);
      stub(MutableMetricService, "tombstoneEntityMetrics", undefined);
      stub(MeasurementMetricWriter, "tombstoneAll", undefined);
      stub(StatusPageOverviewCache, "forgetProjects", undefined);
      stub(ProjectUsageCache, "afterDelete", undefined);
      stub(GlobalCache, "getJSONObject", null);
      stub(GlobalCache, "setJSON", undefined);
      stub(GlobalCache, "deleteKey", undefined);
    });

    afterEach(() => {
      for (const spy of stubs) {
        spy.mockRestore();
      }

      // A statement Postgres rejected fails the test, caught or not.
      expect(failedQueries.failures).toEqual([]);
    });

    afterAll(async () => {
      jest.restoreAllMocks();

      if (database?.isInitialized) {
        await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await database.destroy();
      }
    });

    function fillerFor(table: string, column: RequiredColumn): unknown {
      switch (column.type) {
        case "uuid":
          return ObjectID.generate().toString();
        case "character varying":
        case "text": {
          const text: string = ObjectID.generate().toString().replace(/-/g, "");

          return column.maxLength === null
            ? text
            : text.slice(0, column.maxLength);
        }
        case "integer":
        case "smallint":
        case "bigint":
        case "numeric":
        case "double precision":
        case "real":
          return 1;
        case "boolean":
          return false;
        case "timestamp with time zone":
        case "timestamp without time zone":
        case "date":
          return new Date();
        case "jsonb":
        case "json":
          return "{}";
        default:
          throw new Error(
            `${table}.${column.name} must be given a value: this suite has no filler for a ${column.type}.`,
          );
      }
    }

    async function insert(table: string, values: SqlRow): Promise<string> {
      const row: SqlRow = { _id: ObjectID.generate().toString() };

      for (const column of required[table] || []) {
        if (!(column.name in values)) {
          row[column.name] = fillerFor(table, column);
        }
      }

      Object.assign(row, values);

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

      return row["_id"] as string;
    }

    async function remaining(
      table: string,
      ids: Array<string>,
    ): Promise<number> {
      const rows: Array<{ count: string }> = await database.query(
        `SELECT COUNT(*) AS "count" FROM "${schema}"."${table}" WHERE "_id" = ANY($1)`,
        [ids],
      );

      return Number(rows[0]?.count || 0);
    }

    // A private record of `kind` in `projectId`, owned by a team. Returns its ID.
    async function seedRecord(
      kind: PrivateRecordKind,
      projectId: string,
      values: SqlRow = {},
    ): Promise<string> {
      const id: string = await insert(kind.tableName, {
        projectId: projectId,
        isPrivate: true,
        ...values,
      });

      await insert(kind.ownerTeamTable, {
        projectId: projectId,
        teamId: ObjectID.generate().toString(),
        [kind.ownerKey]: id,
      });

      return id;
    }

    /*
     * About `recordId` (of `kind`): a row of every part, by every key of its
     * that names a record of the kind. The part's other keys that must name
     * a record name a public one of their own. Returns the rows' IDs, by
     * table, and a Runner job of each run.
     */
    async function seedParts(
      kind: PrivateRecordKind,
      recordId: string,
      projectId: string,
    ): Promise<Record<string, Array<string>>> {
      const seeded: Record<string, Array<string>> = {};

      for (const part of PARTS) {
        const columns: Array<PrivateRecordColumn> =
          PrivateRecordPermission.getPrivateRecordColumns(part.modelType);

        for (const column of columns) {
          if (column.kind.tableName !== kind.tableName) {
            continue;
          }

          const values: SqlRow = {
            projectId: projectId,
            [column.column]: recordId,
          };

          for (const other of columns) {
            if (other.column === column.column) {
              continue;
            }

            const isRequired: boolean = (required[part.table] || []).some(
              (each: RequiredColumn): boolean => {
                return each.name === other.column;
              },
            );

            values[other.column] = isRequired
              ? await insert(other.kind.tableName, {
                  projectId: projectId,
                  isPrivate: false,
                })
              : null;
          }

          const id: string = await insert(part.table, values);

          (seeded[part.table] = seeded[part.table] || []).push(id);

          if (part.table === "RunbookExecution") {
            (seeded["RunnerJob"] = seeded["RunnerJob"] || []).push(
              await insert("RunnerJob", {
                projectId: projectId,
                runbookExecutionId: id,
              }),
            );
          }
        }
      }

      return seeded;
    }

    function projectAdmin(projectId: string): DatabaseCommonInteractionProps {
      const project: ObjectID = new ObjectID(projectId);

      return {
        userId: ObjectID.generate(),
        tenantId: project,
        currentPlan: PlanType.Scale,
        userType: UserType.User,
        userGlobalAccessPermission: {
          _type: "UserGlobalAccessPermission",
          projectIds: [project],
          globalPermissions: [Permission.User, Permission.CurrentUser],
        },
        userTenantAccessPermission: {
          [projectId]: {
            _type: "UserTenantAccessPermission",
            projectId: project,
            permissions: [
              {
                _type: "UserPermission",
                permission: Permission.ProjectAdmin,
                labelIds: [],
                isBlockPermission: false,
              },
            ],
          },
        },
      };
    }

    async function deleteRecords(data: {
      deletion: Deletion;
      kind: PrivateRecordKind;
      ids: Array<string>;
      projectId: string;
      resolvedStateId: string;
    }): Promise<void> {
      const service: DatabaseService<BaseModel> =
        SERVICE_OF_KIND[data.kind.tableName]!;

      switch (data.deletion) {
        case "one delete, by its service":
          for (const id of data.ids) {
            expect(
              await service.deleteOneById({
                id: new ObjectID(id),
                props: projectAdmin(data.projectId),
              }),
            ).toBe(1);
          }
          return;
        case "one delete, through the API's route": {
          const api: BaseAPI<
            BaseModel,
            DatabaseService<BaseModel>
          > = new BaseAPI(service.modelType as { new (): BaseModel }, service);

          const props: ReturnType<typeof getJestSpyOn> = getJestSpyOn(
            CommonAPI,
            "getDatabaseCommonInteractionProps",
          ).mockResolvedValue(projectAdmin(data.projectId) as never);
          const product: ReturnType<typeof getJestSpyOn> = getJestSpyOn(
            api,
            "assertProductIsOn",
          ).mockResolvedValue(undefined as never);
          const sent: ReturnType<typeof getJestSpyOn> = getJestSpyOn(
            Response,
            "sendEmptySuccessResponse",
          ).mockImplementation((() => {
            return undefined;
          }) as never);

          try {
            for (const id of data.ids) {
              await api.deleteItem(
                {
                  method: "DELETE",
                  params: { id: id },
                  query: {},
                  headers: {},
                  body: {},
                } as unknown as ExpressRequest,
                {} as ExpressResponse,
              );
            }

            expect(sent).toHaveBeenCalledTimes(data.ids.length);
          } finally {
            props.mockRestore();
            product.mockRestore();
            sent.mockRestore();
          }
          return;
        }
        case "a bulk delete":
          expect(
            await service.deleteBy({
              query: { _id: QueryHelper.any(data.ids) } as never,
              limit: LIMIT_MAX,
              skip: 0,
              props: projectAdmin(data.projectId),
            }),
          ).toBe(data.ids.length);
          return;
        case "the retention purge": {
          // As ResolvedRecordRetention purges resolved records.
          const stateColumn: string =
            data.kind.tableName === "Alert" ||
            data.kind.tableName === "AlertEpisode"
              ? "currentAlertStateId"
              : "currentIncidentStateId";

          expect(
            await service.hardDeleteBy({
              query: {
                projectId: data.projectId,
                _id: QueryHelper.any(data.ids),
                [stateColumn]: QueryHelper.any([data.resolvedStateId]),
              } as never,
              limit: data.ids.length,
              skip: 0,
              props: { isRoot: true },
            }),
          ).toBe(data.ids.length);
          return;
        }
        case "its project's deletion":
          await database.query(
            `DELETE FROM "${schema}"."Project" WHERE "_id" = $1`,
            [data.projectId],
          );
          return;
      }
    }

    test("every part of a private record is written by a key of each kind it names", () => {
      const keysByKind: Record<string, number> = {};

      for (const part of PARTS) {
        for (const column of PrivateRecordPermission.getPrivateRecordColumns(
          part.modelType,
        )) {
          keysByKind[column.kind.tableName] =
            (keysByKind[column.kind.tableName] || 0) + 1;
        }
      }

      // Pages, steps, runs, fixes, nine logs, members and links: every kind is named.
      for (const kind of PRIVATE_RECORD_KINDS) {
        expect({
          kind: kind.tableName,
          named: keysByKind[kind.tableName] || 0,
        }).not.toEqual({ kind: kind.tableName, named: 0 });
      }

      expect(
        PARTS.map((part: { table: string }) => {
          return part.table;
        }),
      ).toEqual(
        expect.arrayContaining([
          "RunbookExecution",
          "AutoRemediationSuggestion",
        ]),
      );
    });

    describe.each(PRIVATE_RECORD_KINDS)(
      "a private $tableName",
      (kind: PrivateRecordKind) => {
        test.each(DELETIONS)(
          "deleted by %s takes everything done and sent about it with it",
          async (deletion: Deletion) => {
            if (
              deletion === "one delete, through the API's route" &&
              (kind.tableName === "IncidentEpisode" ||
                kind.tableName === "AlertEpisode")
            ) {
              // Their routes are the same BaseAPI route; the service path covers them.
              return;
            }

            const projectId: string = await insert("Project", {});
            const resolvedStateId: string = ObjectID.generate().toString();
            const stateColumn: string =
              kind.tableName === "Alert" || kind.tableName === "AlertEpisode"
                ? "currentAlertStateId"
                : "currentIncidentStateId";

            const deleted: Array<string> = [
              await seedRecord(kind, projectId, {
                [stateColumn]: resolvedStateId,
              }),
              await seedRecord(kind, projectId, {
                [stateColumn]: resolvedStateId,
              }),
            ];

            // Another private record of the project, which stays.
            const kept: string = await seedRecord(kind, projectId);

            const aboutDeleted: Array<Record<string, Array<string>>> = [];

            for (const id of deleted) {
              aboutDeleted.push(await seedParts(kind, id, projectId));
            }

            const aboutKept: Record<string, Array<string>> = await seedParts(
              kind,
              kept,
              projectId,
            );

            // Every part naming the kind was written about each record.
            expect(Object.keys(aboutDeleted[0]!).length).toBeGreaterThan(0);

            await deleteRecords({
              deletion: deletion,
              kind: kind,
              ids:
                deletion === "one delete, by its service" ||
                deletion === "one delete, through the API's route"
                  ? deleted.slice(0, 1)
                  : deleted,
              projectId: projectId,
              resolvedStateId: resolvedStateId,
            });

            const goneRecords: Array<string> =
              deletion === "one delete, by its service" ||
              deletion === "one delete, through the API's route"
                ? deleted.slice(0, 1)
                : deleted;

            expect(await remaining(kind.tableName, goneRecords)).toBe(0);

            for (const [index, id] of deleted.entries()) {
              const isGone: boolean = goneRecords.includes(id);

              for (const [table, ids] of Object.entries(aboutDeleted[index]!)) {
                expect({
                  table,
                  left: await remaining(table, ids),
                }).toEqual({ table, left: isGone ? 0 : ids.length });
              }
            }

            // About the record that stays: all of it, unless its project went.
            for (const [table, ids] of Object.entries(aboutKept)) {
              expect({ table, left: await remaining(table, ids) }).toEqual({
                table,
                left: deletion === "its project's deletion" ? 0 : ids.length,
              });
            }
          },
        );
      },
    );

    test("a public incident's and alert's runs and fixes go with it too", async () => {
      const projectId: string = await insert("Project", {});

      for (const [modelType, service] of [
        [Incident, IncidentService],
        [Alert, AlertService],
      ] as Array<[{ new (): BaseModel }, DatabaseService<BaseModel>]>) {
        const table: string = new modelType().tableName as string;
        const key: string = table === "Incident" ? "incidentId" : "alertId";
        const record: string = await insert(table, {
          projectId: projectId,
          isPrivate: false,
        });
        const run: string = await insert("RunbookExecution", {
          projectId: projectId,
          [key]: record,
        });
        const fix: string = await insert("AutoRemediationSuggestion", {
          projectId: projectId,
          [key]: record,
        });

        expect(
          await service.deleteOneById({
            id: new ObjectID(record),
            props: projectAdmin(projectId),
          }),
        ).toBe(1);

        expect(await remaining("RunbookExecution", [run])).toBe(0);
        expect(await remaining("AutoRemediationSuggestion", [fix])).toBe(0);
      }
    });
  },
);
