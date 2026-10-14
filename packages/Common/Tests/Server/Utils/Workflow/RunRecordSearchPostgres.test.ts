import Entities from "../../../../Models/DatabaseModels/Index";
import PostgresAppInstance from "../../../../Server/Infrastructure/PostgresDatabase";
import AlertEpisodeService from "../../../../Server/Services/AlertEpisodeService";
import AlertService from "../../../../Server/Services/AlertService";
import DatabaseService from "../../../../Server/Services/DatabaseService";
import IncidentEpisodeService from "../../../../Server/Services/IncidentEpisodeService";
import IncidentService from "../../../../Server/Services/IncidentService";
import MonitorService from "../../../../Server/Services/MonitorService";
import ScheduledMaintenanceService from "../../../../Server/Services/ScheduledMaintenanceService";
import RunRecordSearch from "../../../../Server/Utils/Workflow/RunRecordSearch";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { PlanType } from "../../../../Types/Billing/SubscriptionPlan";
import PermissionScope from "../../../../Types/Database/AccessControl/PermissionScope";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../../Types/Permission";
import UserType from "../../../../Types/UserType";
import {
  RunRecordColumns,
  RunRecordMatch,
  RunRecordOption,
  getRunRecordColumns,
} from "../../../../Types/Workflow/RunRecord";
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
import { DataSource, EntityMetadata, Logger } from "typeorm";
import { RelationMetadata } from "typeorm/metadata/RelationMetadata";

/*
 * THE RECORD A WORKFLOW IS RUN WITH, LOOKED UP ON A MIGRATED POSTGRES.
 *
 * "Instead of UUID can I enter the user-facing incident ID, for convenience?
 * Can you please make this generic" - Run Workflow finds the record by its
 * number (INC-8, 8, #8), by the words of its title, or by its ID
 * (Server/Utils/Workflow/RunRecordSearch), for every model a workflow can
 * watch. The rules are unit tested against a service kept in memory. What
 * only Postgres and the real read path can say is checked here, with each
 * model's own service, for every model that numbers its records and one
 * that does not:
 *
 *   - the statements the search builds run: a number column compared with a
 *     number, every word of a name with ILIKE (a % or an _ typed being that
 *     character), an ID with a uuid - and a number too large for the column
 *     is never sent to it;
 *   - a read is the caller's own. Someone who may read only these records
 *     finds them; someone who may not is refused; someone held to a label
 *     finds the records that carry it; a private incident, alert or episode
 *     is found by the project's owners and by its own owners, and by no one
 *     else - whatever they type;
 *   - nothing outside the workflow's project is ever found, even by someone
 *     who owns both projects.
 *
 * Opt in with RUN_POSTGRES_RUN_RECORD_SEARCH_TESTS=true against a database
 * the registered migrations have been applied to, e.g.
 *
 *   RUN_POSTGRES_RUN_RECORD_SEARCH_TESTS=true \
 *   RUN_RECORD_SEARCH_TEST_DATABASE_HOST=127.0.0.1 \
 *   RUN_RECORD_SEARCH_TEST_DATABASE_PORT=5400 \
 *   DATABASE_PASSWORD=... npx jest Tests/Server/Utils/Workflow/RunRecordSearchPostgres.test.ts
 *
 * CI runs it in .github/workflows/postgres-schema-drift.yaml, right after
 * that job has applied every registered migration to an empty database.
 *
 * Everything runs in a uniquely named schema holding structure-only clones
 * (LIKE ... INCLUDING ALL) of the tables it writes: each model's own, its
 * label table and its owners' table, and the labels. The clones carry no
 * foreign keys, so a
 * seeded row needs only its NOT NULL columns, which are read from the
 * migrated schema and filled in by kind - a column added later needs nothing
 * here. The DataSource's search path is that schema, then public: a table
 * the read path only reads (TeamMember, a model's owning teams) is the
 * migrated, empty one. No row is written outside the schema, and the schema
 * is dropped afterwards. Every statement Postgres rejects is recorded and
 * fails the test, even one a caller would have caught.
 */
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_RUN_RECORD_SEARCH_TESTS"] === "true"
    ? describe
    : describe.skip;

interface Kind {
  name: string;
  service: DatabaseService<BaseModel>;
  // The permission that lets someone read these records and nothing else.
  reader: Permission;
  // The prefix a new project numbers these with; null for a model without.
  prefix: string | null;
  // Where the owners of a private one are kept; null when none is private.
  owners: { table: string; recordColumn: string } | null;
}

type AsServiceFunction = (service: unknown) => DatabaseService<BaseModel>;

const asService: AsServiceFunction = (
  service: unknown,
): DatabaseService<BaseModel> => {
  return service as DatabaseService<BaseModel>;
};

const INCIDENT: Kind = {
  name: "Incident",
  service: asService(IncidentService),
  reader: Permission.ReadProjectIncident,
  prefix: "INC-",
  owners: { table: "IncidentOwnerUser", recordColumn: "incidentId" },
};

const MONITOR: Kind = {
  name: "Monitor",
  service: asService(MonitorService),
  reader: Permission.ReadProjectMonitor,
  prefix: null,
  owners: null,
};

// Every model that numbers its records, and one that only names them.
const KINDS: Array<Kind> = [
  INCIDENT,
  {
    name: "Alert",
    service: asService(AlertService),
    reader: Permission.ReadAlert,
    prefix: "ALT-",
    owners: { table: "AlertOwnerUser", recordColumn: "alertId" },
  },
  {
    name: "ScheduledMaintenance",
    service: asService(ScheduledMaintenanceService),
    reader: Permission.ReadProjectScheduledMaintenance,
    prefix: "SM-",
    owners: null,
  },
  {
    name: "IncidentEpisode",
    service: asService(IncidentEpisodeService),
    reader: Permission.ReadIncidentEpisode,
    prefix: "IE-",
    owners: {
      table: "IncidentEpisodeOwnerUser",
      recordColumn: "incidentEpisodeId",
    },
  },
  {
    name: "AlertEpisode",
    service: asService(AlertEpisodeService),
    reader: Permission.ReadAlertEpisode,
    prefix: "AE-",
    owners: { table: "AlertEpisodeOwnerUser", recordColumn: "alertEpisodeId" },
  },
  MONITOR,
];

const NUMBERED: Array<Kind> = KINDS.filter((kind: Kind): boolean => {
  return kind.prefix !== null;
});

const WITH_PRIVATE_RECORDS: Array<Kind> = KINDS.filter(
  (kind: Kind): boolean => {
    return kind.owners !== null;
  },
);

const LABEL_TABLE: string = "Label";

type SqlRow = Record<string, unknown>;

interface RequiredColumn {
  name: string;
  type: string;
  // The most characters a text column holds, when it says.
  maxLength: number | null;
}

// Where a model's labels are kept: its join table and the two columns.
interface LabelTable {
  table: string;
  recordColumn: string;
  labelColumn: string;
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

type IdsFunction = (found: Array<RunRecordOption>) => Array<string>;

const ids: IdsFunction = (found: Array<RunRecordOption>): Array<string> => {
  return found.map((option: RunRecordOption): string => {
    return option.id;
  });
};

describePostgres(
  "the record a workflow is run with, looked up on a migrated Postgres",
  () => {
    const schema: string = `run_record_search_${ObjectID.generate()
      .toString()
      .replace(/-/g, "")}`;

    const projectId: ObjectID = ObjectID.generate();
    const otherProjectId: ObjectID = ObjectID.generate();
    const userId: ObjectID = ObjectID.generate();
    const someoneElseId: ObjectID = ObjectID.generate();

    const failedQueries: FailedQueryRecorder = new FailedQueryRecorder();
    let database: DataSource;

    // Per cloned table, its NOT NULL columns that have no default.
    const required: Record<string, Array<RequiredColumn>> = {};
    const labelTables: Record<string, LabelTable> = {};
    let tables: Array<string> = [];

    // Each seeded record is a minute newer than the one before it.
    let clock: number = Date.UTC(2026, 9, 1);

    beforeAll(async () => {
      database = new DataSource({
        type: "postgres",
        host:
          process.env["RUN_RECORD_SEARCH_TEST_DATABASE_HOST"] || "localhost",
        port: Number(
          process.env["RUN_RECORD_SEARCH_TEST_DATABASE_PORT"] || "5400",
        ),
        username: process.env["DATABASE_USERNAME"] || "postgres",
        password: process.env["DATABASE_PASSWORD"] || "password",
        database:
          process.env["RUN_RECORD_SEARCH_TEST_DATABASE_NAME"] ||
          process.env["DATABASE_NAME"] ||
          "oneuptimedb",
        entities: Entities,
        schema,
        synchronize: false,
        logger: failedQueries,
        extra: { options: `-c search_path=${schema},public` },
      });
      await database.initialize();

      // Each model's label table, as its entity declares it.
      for (const kind of KINDS) {
        const metadata: EntityMetadata = database.getMetadata(
          kind.service.getModel().constructor,
        );
        const labels: RelationMetadata | undefined =
          metadata.manyToManyRelations.find(
            (relation: RelationMetadata): boolean => {
              return relation.propertyName === "labels";
            },
          );

        expect({
          kind: kind.name,
          hasLabels: Boolean(labels?.junctionEntityMetadata),
        }).toEqual({ kind: kind.name, hasLabels: true });

        labelTables[kind.name] = {
          table: labels!.junctionEntityMetadata!.tableName,
          recordColumn: labels!.joinColumns[0]!.databaseName,
          labelColumn: labels!.inverseJoinColumns[0]!.databaseName,
        };
      }

      tables = Array.from(
        new Set<string>([
          // A read held to a label joins the labels themselves.
          LABEL_TABLE,
          ...KINDS.flatMap((kind: Kind): Array<string> => {
            return [
              kind.service.getModel().tableName as string,
              labelTables[kind.name]!.table,
              ...(kind.owners ? [kind.owners.table] : []),
            ];
          }),
        ]),
      );

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
              AND column_default IS NULL
            ORDER BY table_name, ordinal_position`,
        [tables],
      );

      for (const column of notNull) {
        (required[column.table] = required[column.table] || []).push({
          name: column.name,
          type: column.type,
          maxLength:
            column.maxLength === null ? null : Number(column.maxLength),
        });
      }

      await database.query(`CREATE SCHEMA "${schema}"`);

      for (const table of tables) {
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
    });

    beforeEach(async () => {
      failedQueries.failures = [];
      clock = Date.UTC(2026, 9, 1);

      await database.query(
        tables
          .map((table: string): string => {
            return `DELETE FROM "${schema}"."${table}"`;
          })
          .join("; "),
      );
    });

    afterEach(() => {
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

    // A value for a NOT NULL column the test has nothing to say about.
    function fillerFor(table: string, column: RequiredColumn): unknown {
      switch (column.type) {
        case "uuid":
          return ObjectID.generate().toString();
        case "character varying":
        case "text": {
          // Unlike any other row's, and no longer than the column holds.
          const text: string = ObjectID.generate().toString().replace(/-/g, "");

          return column.maxLength === null
            ? text
            : text.slice(0, column.maxLength);
        }
        case "integer":
        case "smallint":
        case "bigint":
        case "numeric":
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

    async function insert(table: string, values: SqlRow): Promise<void> {
      const row: SqlRow = {};

      for (const column of required[table] || []) {
        row[column.name] =
          column.name in values
            ? values[column.name]
            : fillerFor(table, column);
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
    }

    interface RecordSeed {
      name: string;
      number?: number;
      // The prefix it was numbered with, when not the one new projects get.
      prefix?: string;
      project?: ObjectID;
      isPrivate?: boolean;
    }

    // A stored record, a minute newer than the last. Returns its ID.
    async function seedRecord(kind: Kind, data: RecordSeed): Promise<string> {
      const model: BaseModel = kind.service.getModel();
      const columns: RunRecordColumns = getRunRecordColumns(model);
      const id: string = ObjectID.generate().toString();

      clock += 60 * 1000;

      const values: SqlRow = {
        _id: id,
        projectId: (data.project || projectId).toString(),
        createdAt: new Date(clock),
        [columns.nameColumn as string]: data.name,
      };

      if (columns.number && data.number !== undefined) {
        values[columns.number.numberColumn] = data.number;
        values[columns.number.numberWithPrefixColumn] =
          `${data.prefix === undefined ? kind.prefix : data.prefix}${data.number}`;
      }

      if (data.isPrivate !== undefined) {
        values["isPrivate"] = data.isPrivate;
      }

      await insert(model.tableName as string, values);

      return id;
    }

    // A new label of the project, put on the record. Returns the label's ID.
    async function label(kind: Kind, recordId: string): Promise<ObjectID> {
      const labelId: ObjectID = ObjectID.generate();
      const where: LabelTable = labelTables[kind.name] as LabelTable;

      await insert(LABEL_TABLE, {
        _id: labelId.toString(),
        projectId: projectId.toString(),
      });
      await insert(where.table, {
        [where.recordColumn]: recordId,
        [where.labelColumn]: labelId.toString(),
      });

      return labelId;
    }

    function grant(
      permission: Permission,
      data: Partial<UserPermission> = {},
    ): UserPermission {
      return {
        _type: "UserPermission",
        permission,
        labelIds: [],
        isBlockPermission: false,
        ...data,
      };
    }

    // Someone signed in to a project, holding these permissions in it.
    function propsOf(
      permissions: Array<UserPermission>,
      who: ObjectID = userId,
      tenantId: ObjectID = projectId,
    ): DatabaseCommonInteractionProps {
      return {
        userId: who,
        tenantId,
        currentPlan: PlanType.Scale,
        userType: UserType.User,
        userGlobalAccessPermission: {
          _type: "UserGlobalAccessPermission",
          projectIds: [tenantId],
          globalPermissions: [Permission.User, Permission.CurrentUser],
        },
        userTenantAccessPermission: {
          [tenantId.toString()]: {
            _type: "UserTenantAccessPermission",
            projectId: tenantId,
            permissions,
          },
        },
      };
    }

    function projectOwner(): DatabaseCommonInteractionProps {
      return propsOf([grant(Permission.ProjectOwner)]);
    }

    async function search(
      kind: Kind,
      typed: string,
      props: DatabaseCommonInteractionProps = projectOwner(),
    ): Promise<Array<RunRecordOption>> {
      return RunRecordSearch.search({
        service: kind.service,
        projectId: projectId,
        props: props,
        search: typed,
      });
    }

    describe.each(NUMBERED)("$name, by its number", (kind: Kind) => {
      test("with its prefix, without one and with #, however it is typed", async () => {
        const eight: string = await seedRecord(kind, {
          number: 8,
          name: "Database is down",
        });
        await seedRecord(kind, { number: 80, name: "Disk is full" });
        await seedRecord(kind, { number: 18, name: "Queue is stuck" });

        const prefix: string = kind.prefix as string;

        for (const typed of [
          `${prefix}8`,
          `${prefix.toLowerCase()}8`,
          ` ${prefix.replace("-", " - ")} 8 `,
          "8",
          "#8",
          "＃８",
        ]) {
          const found: Array<RunRecordOption> = await search(kind, typed);

          expect({ typed, found }).toEqual({
            typed,
            found: [
              {
                id: eight,
                number: `${prefix}8`,
                name: "Database is down",
                createdAt: expect.any(String),
                matchedBy: RunRecordMatch.Number,
              },
            ],
          });
        }

        expect(
          await RunRecordSearch.resolve({
            service: kind.service,
            projectId: projectId,
            props: projectOwner(),
            search: `${prefix}8`,
          }),
        ).toMatchObject({ id: eight, matchedBy: RunRecordMatch.Number });
      });

      test("another prefix names nothing, and one numbered under an old prefix answers to it", async () => {
        const seven: string = await seedRecord(kind, {
          number: 7,
          name: "Numbered before the prefix changed",
          prefix: "OLD-",
        });
        await seedRecord(kind, { number: 8, name: "Database is down" });

        expect(await search(kind, "ZZZ-8")).toEqual([]);
        expect(await search(kind, "OLD-8")).toEqual([]);
        expect(ids(await search(kind, "old-7"))).toEqual([seven]);
        expect(ids(await search(kind, `${kind.prefix}7`))).toEqual([]);
        // The bare number names it whatever its prefix.
        expect(ids(await search(kind, "7"))).toEqual([seven]);
      });

      test("a number no record has finds nothing, and one too large for the column is never sent to it", async () => {
        await seedRecord(kind, { number: 8, name: "Database is down" });

        expect(await search(kind, "9")).toEqual([]);
        expect(await search(kind, `${kind.prefix}2147483647`)).toEqual([]);
        // Past what the column holds: read as words of a name, not a number.
        expect(await search(kind, "2147483648")).toEqual([]);
        expect(await search(kind, "99999999999999999999")).toEqual([]);
        expect(
          await RunRecordSearch.resolve({
            service: kind.service,
            projectId: projectId,
            props: projectOwner(),
            search: "2147483648",
          }),
        ).toBeNull();
      });

      test("a number that is in a title too: the record with that number first, then the titles", async () => {
        const titled: string = await seedRecord(kind, {
          number: 12,
          name: "Another 500 from checkout",
        });
        const fiveHundred: string = await seedRecord(kind, {
          number: 500,
          name: "Error 500 on sign-in",
        });

        expect(
          (await search(kind, "500")).map(
            (option: RunRecordOption): [string, RunRecordMatch] => {
              return [option.id, option.matchedBy];
            },
          ),
        ).toEqual([
          [fiveHundred, RunRecordMatch.Number],
          [titled, RunRecordMatch.Name],
        ]);
      });
    });

    describe.each(KINDS)("$name, by its name and its ID", (kind: Kind) => {
      test("every word typed, in any order and any case, newest first", async () => {
        const older: string = await seedRecord(kind, {
          number: 1,
          name: "Database is down",
        });
        await seedRecord(kind, { number: 2, name: "API is down" });
        const newer: string = await seedRecord(kind, {
          number: 3,
          name: "The database went DOWN again",
        });

        expect(ids(await search(kind, "database down"))).toEqual([
          newer,
          older,
        ]);
        expect(ids(await search(kind, "DOWN   Database"))).toEqual([
          newer,
          older,
        ]);
        expect(ids(await search(kind, "data again"))).toEqual([newer]);
        expect(await search(kind, "database checkout")).toEqual([]);

        for (const option of await search(kind, "database")) {
          expect(option.matchedBy).toBe(RunRecordMatch.Name);
        }

        // Words name no record outright: there is nothing to run with yet.
        expect(
          await RunRecordSearch.resolve({
            service: kind.service,
            projectId: projectId,
            props: projectOwner(),
            search: "database down",
          }),
        ).toBeNull();
      });

      test("a %, an _ or a backslash typed is that character", async () => {
        const literal: string = await seedRecord(kind, {
          number: 1,
          name: "CPU at 100% on db_1 in C:\\temp",
        });
        await seedRecord(kind, { number: 2, name: "CPU at 1000 on db-1" });

        expect(ids(await search(kind, "100%"))).toEqual([literal]);
        expect(ids(await search(kind, "db_1"))).toEqual([literal]);
        expect(ids(await search(kind, "%"))).toEqual([literal]);
        expect(ids(await search(kind, "_"))).toEqual([literal]);
        expect(ids(await search(kind, "c:\\temp"))).toEqual([literal]);
        // A quote typed is a quote, and no statement fails on it.
        expect(await search(kind, 'it\'s "down"; --')).toEqual([]);
      });

      test("its ID finds it, in either case, and an ID nothing has finds nothing", async () => {
        const record: string = await seedRecord(kind, {
          number: 4,
          name: "Disk is full",
        });
        await seedRecord(kind, { number: 5, name: "Disk is slow" });

        for (const typed of [record, record.toUpperCase(), ` ${record} `]) {
          expect(await search(kind, typed)).toEqual([
            expect.objectContaining({
              id: record,
              name: "Disk is full",
              matchedBy: RunRecordMatch.Id,
            }),
          ]);
        }

        expect(await search(kind, ObjectID.generate().toString())).toEqual([]);
        expect(
          await RunRecordSearch.resolve({
            service: kind.service,
            projectId: projectId,
            props: projectOwner(),
            search: record,
          }),
        ).toMatchObject({ id: record, matchedBy: RunRecordMatch.Id });
      });

      test("nothing typed lists the newest ten, newest first", async () => {
        const seeded: Array<string> = [];

        for (let number: number = 1; number <= 12; number++) {
          seeded.push(
            await seedRecord(kind, { number, name: `Record ${number}` }),
          );
        }

        const found: Array<RunRecordOption> = await search(kind, "");

        expect(ids(found)).toEqual(seeded.slice(2).reverse());
        expect(found[0]).toEqual({
          id: seeded[11],
          ...(kind.prefix ? { number: `${kind.prefix}12` } : {}),
          name: "Record 12",
          createdAt: new Date(
            Date.UTC(2026, 9, 1) + 12 * 60 * 1000,
          ).toISOString(),
          matchedBy: RunRecordMatch.Recent,
        });
      });

      test("another project's record is never found - by number, by name or by ID - even by someone who owns both", async () => {
        const mine: string = await seedRecord(kind, {
          number: 8,
          name: "Database is down",
        });
        const theirs: string = await seedRecord(kind, {
          number: 8,
          name: "Database is down",
          project: otherProjectId,
        });

        // An owner of both projects, signed in to the other one.
        const ownerOfBoth: DatabaseCommonInteractionProps = propsOf(
          [grant(Permission.ProjectOwner)],
          userId,
          otherProjectId,
        );
        ownerOfBoth.userGlobalAccessPermission!.projectIds = [
          projectId,
          otherProjectId,
        ];
        ownerOfBoth.userTenantAccessPermission![projectId.toString()] = {
          _type: "UserTenantAccessPermission",
          projectId: projectId,
          permissions: [grant(Permission.ProjectOwner)],
        };

        for (const typed of ["8", "database", theirs, ""]) {
          expect({
            typed,
            found: ids(await search(kind, typed, ownerOfBoth)).filter(
              (id: string): boolean => {
                return id !== mine;
              },
            ),
          }).toEqual({ typed, found: [] });
        }

        expect(ids(await search(kind, "database", ownerOfBoth))).toEqual([
          mine,
        ]);
      });
    });

    describe.each(KINDS)("$name, read as the person asking", (kind: Kind) => {
      test("someone who may read only these finds them", async () => {
        const record: string = await seedRecord(kind, {
          number: 8,
          name: "Database is down",
        });
        const reader: DatabaseCommonInteractionProps = propsOf([
          grant(kind.reader),
        ]);

        expect(ids(await search(kind, "database", reader))).toEqual([record]);
        expect(ids(await search(kind, record, reader))).toEqual([record]);
        expect(ids(await search(kind, "", reader))).toEqual([record]);

        if (kind.prefix) {
          expect(ids(await search(kind, `${kind.prefix}8`, reader))).toEqual([
            record,
          ]);
        }
      });

      test("someone who may read only something else is refused, whatever they type", async () => {
        const record: string = await seedRecord(kind, {
          number: 8,
          name: "Database is down",
        });
        const other: Kind = kind === MONITOR ? INCIDENT : MONITOR;
        const stranger: DatabaseCommonInteractionProps = propsOf([
          grant(other.reader),
        ]);

        for (const typed of ["8", "database", record, ""]) {
          await expect(search(kind, typed, stranger)).rejects.toBeInstanceOf(
            NotAuthorizedException,
          );
        }

        await expect(
          RunRecordSearch.resolve({
            service: kind.service,
            projectId: projectId,
            props: stranger,
            search: record,
          }),
        ).rejects.toBeInstanceOf(NotAuthorizedException);
      });

      test("someone held to a label finds the records that carry it, and no others", async () => {
        const labelled: string = await seedRecord(kind, {
          number: 8,
          name: "Database is down",
        });
        const other: string = await seedRecord(kind, {
          number: 9,
          name: "Database is slow",
        });
        const labelId: ObjectID = await label(kind, labelled);
        await label(kind, other);

        const held: DatabaseCommonInteractionProps = propsOf([
          grant(kind.reader, {
            labelIds: [labelId],
            scope: PermissionScope.Labels,
          }),
        ]);

        expect(ids(await search(kind, "database", held))).toEqual([labelled]);
        expect(ids(await search(kind, "", held))).toEqual([labelled]);
        expect(await search(kind, other, held)).toEqual([]);

        if (kind.prefix) {
          expect(ids(await search(kind, "8", held))).toEqual([labelled]);
          expect(await search(kind, `${kind.prefix}9`, held)).toEqual([]);
        }
      });
    });

    describe.each(WITH_PRIVATE_RECORDS)("a private $name", (kind: Kind) => {
      test("is found by the project's owners and by its own owners, and by no one else", async () => {
        const open: string = await seedRecord(kind, {
          number: 7,
          name: "Payroll export is late",
          isPrivate: false,
        });
        const secret: string = await seedRecord(kind, {
          number: 8,
          name: "Payroll export copied to a public bucket",
          isPrivate: true,
        });

        const reader: Array<UserPermission> = [grant(kind.reader)];
        const everything: Array<string> = [
          "8",
          `${kind.prefix}8`,
          "payroll bucket",
          secret,
        ];

        // A project owner sees every private record.
        for (const typed of everything) {
          expect({ typed, found: ids(await search(kind, typed)) }).toEqual({
            typed,
            found: [secret],
          });
        }

        // Someone who may read these, and owns neither, never finds it.
        for (const typed of everything) {
          expect({
            typed,
            found: await search(kind, typed, propsOf(reader)),
          }).toEqual({ typed, found: [] });
        }

        expect(ids(await search(kind, "payroll", propsOf(reader)))).toEqual([
          open,
        ]);
        expect(ids(await search(kind, "", propsOf(reader)))).toEqual([open]);

        // Made one of its owners, the same person finds it.
        await insert(kind.owners!.table, {
          projectId: projectId.toString(),
          userId: userId.toString(),
          [kind.owners!.recordColumn]: secret,
        });

        for (const typed of everything) {
          expect({
            typed,
            found: ids(await search(kind, typed, propsOf(reader))),
          }).toEqual({ typed, found: [secret] });
        }

        // And still nobody else does.
        expect(await search(kind, "8", propsOf(reader, someoneElseId))).toEqual(
          [],
        );
      });
    });
  },
);
