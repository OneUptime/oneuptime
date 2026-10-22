import Entities from "../../../Models/DatabaseModels/Index";
import Incident from "../../../Models/DatabaseModels/Incident";
import PostgresAppInstance from "../../../Server/Infrastructure/PostgresDatabase";
import { AddIncidentPostmortemStatus1805900000000 } from "../../../Server/Infrastructure/Postgres/SchemaMigrations/1805900000000-AddIncidentPostmortemStatus";
import { AddIncidentPostmortemStatusIndexesAndKey1805910000000 } from "../../../Server/Infrastructure/Postgres/SchemaMigrations/1805910000000-AddIncidentPostmortemStatusIndexesAndKey";
import IncidentPostmortemStatusService, {
  getPostmortemStatusBackfillSql,
} from "../../../Server/Services/IncidentPostmortemStatusService";
import IncidentService from "../../../Server/Services/IncidentService";
import logger from "../../../Server/Utils/Logger";
import Includes from "../../../Types/BaseDatabase/Includes";
import PositiveNumber from "../../../Types/PositiveNumber";
import ObjectID from "../../../Types/ObjectID";
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
import { DataSource, QueryRunner } from "typeorm";

/*
 * Postmortem statuses (Incidents > Postmortems), EXECUTED against Postgres -
 * not string matched (AddIncidentPostmortemStatusMigration.test.ts reads the
 * migrations' text):
 *
 *   - the two migrations on a copy of the migrated incidents table that
 *     already holds incidents: the statuses table comes out as the drift
 *     checked database has it, the column is added without rewriting the
 *     table and every existing incident has none, the indexes and the key
 *     are built online and valid, safe to run twice, and the key refuses
 *     to delete a status incidents are in;
 *   - the backfill (IncidentPostmortemStatusService
 *     .backfillIncidentPostmortemStatuses, run by the data migration
 *     AddDefaultPostmortemStatusesToExistingProjects): every incident with no
 *     status is given the one its postmortem is in by its fields, a batch at
 *     a time, the project's first built-in status of each kind from the top,
 *     deleted statuses and projects with none left alone, idempotent;
 *   - the reads the Postmortems list makes - its status chip, its row pill
 *     and the count of each tile - through the real incident service.
 *
 * Opt in with RUN_POSTGRES_POSTMORTEM_STATUS_TESTS=true against a Postgres
 * migrated to the current head (the copies take public.<table>'s shape) -
 * the Postgres Schema Drift workflow's database right after its drift
 * check. Credentials from DATABASE_USERNAME / DATABASE_PASSWORD, database
 * from POSTMORTEM_STATUS_TEST_DATABASE_NAME or DATABASE_NAME, endpoint from
 * POSTMORTEM_STATUS_TEST_DATABASE_HOST / _PORT (default localhost:5400).
 * Every table and row lives in a schema of its own that is dropped
 * afterwards; search_path holds only that schema, so a statement naming a
 * table that was not copied fails loudly instead of touching real data.
 * The migrations' down() is left to the text test: it drops indexes by
 * their "public" names, which here would be the real ones.
 */
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_POSTMORTEM_STATUS_TESTS"] === "true"
    ? describe
    : describe.skip;

const STATUS_TABLE: string = "IncidentPostmortemStatus";

const uniqueSchema: (prefix: string) => string = (prefix: string): string => {
  return `${prefix}_${ObjectID.generate().toString().split("-").join("")}`;
};

const connect: (schema: string) => Promise<DataSource> = async (
  schema: string,
): Promise<DataSource> => {
  const database: DataSource = new DataSource({
    type: "postgres",
    host: process.env["POSTMORTEM_STATUS_TEST_DATABASE_HOST"] || "localhost",
    port: Number(process.env["POSTMORTEM_STATUS_TEST_DATABASE_PORT"] || "5400"),
    username: process.env["DATABASE_USERNAME"] || "postgres",
    password: process.env["DATABASE_PASSWORD"] || "password",
    database:
      process.env["POSTMORTEM_STATUS_TEST_DATABASE_NAME"] ||
      process.env["DATABASE_NAME"] ||
      "oneuptimedb",
    entities: Entities,
    schema,
    synchronize: false,
    extra: { options: `-c search_path=${schema}` },
  });

  await database.initialize();
  await database.query(`CREATE SCHEMA "${schema}"`);

  return database;
};

/*
 * Copies public.<table> - columns, defaults and indexes, no keys - with
 * every column but the primary key nullable, so a row names only what the
 * statement under test reads.
 */
const copyTables: (
  database: DataSource,
  schema: string,
  tables: Array<string>,
) => Promise<void> = async (
  database: DataSource,
  schema: string,
  tables: Array<string>,
): Promise<void> => {
  for (const table of tables) {
    await database.query(
      `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
    );

    const columns: Array<{ column_name: string }> = await database.query(
      `SELECT c.column_name FROM information_schema.columns c
      WHERE c.table_schema = $1 AND c.table_name = $2 AND c.is_nullable = 'NO'
        AND c.column_name <> '_id'`,
      [schema, table],
    );

    for (const column of columns) {
      await database.query(
        `ALTER TABLE "${schema}"."${table}" ALTER COLUMN "${column.column_name}" DROP NOT NULL`,
      );
    }
  }
};

interface ColumnShape {
  column_name: string;
  data_type: string;
  is_nullable: string;
  column_default: string | null;
  character_maximum_length: number | null;
}

const columnsOf: (
  database: DataSource,
  schema: string,
  table: string,
) => Promise<Array<ColumnShape>> = async (
  database: DataSource,
  schema: string,
  table: string,
): Promise<Array<ColumnShape>> => {
  return await database.query(
    `SELECT column_name, data_type, is_nullable, column_default, character_maximum_length
      FROM information_schema.columns
      WHERE table_schema = $1 AND table_name = $2
      ORDER BY column_name`,
    [schema, table],
  );
};

describePostgres(
  "the postmortem status migrations on a copy of the migrated incidents table",
  () => {
    const schema: string = uniqueSchema("postmortem_status_migration");
    const projectId: string = ObjectID.generate().toString();
    const incidentIds: Array<string> = [
      ObjectID.generate().toString(),
      ObjectID.generate().toString(),
    ];
    let database: DataSource;
    let queryRunner: QueryRunner;

    const fileNodeOfIncident: () => Promise<string> =
      async (): Promise<string> => {
        const [row]: Array<{ relfilenode: string }> = await database.query(
          `SELECT relfilenode::text AS relfilenode FROM pg_class WHERE oid = format('%I.%I', $1::text, 'Incident')::regclass`,
          [schema],
        );

        return row!.relfilenode;
      };

    beforeAll(async () => {
      database = await connect(schema);
      await copyTables(database, schema, ["Project", "User", "Incident"]);

      /*
       * The generated CREATE TABLE's ids default to uuid-ossp's
       * uuid_generate_v4(), which lives in public: this schema's
       * search_path holds only itself, so it reaches it through one of
       * its own.
       */
      await database.query(
        `CREATE FUNCTION "${schema}".uuid_generate_v4() RETURNS uuid LANGUAGE sql AS 'SELECT public.uuid_generate_v4()'`,
      );

      // The incidents table as it was before the migration: no column.
      await database.query(
        `ALTER TABLE "${schema}"."Incident" DROP COLUMN "postmortemStatusId"`,
      );

      // A project, and incidents it already has.
      await database.query(
        `INSERT INTO "${schema}"."Project" ("_id", "name") VALUES ($1, 'Acme')`,
        [projectId],
      );

      for (const incidentId of incidentIds) {
        await database.query(
          `INSERT INTO "${schema}"."Incident" ("_id", "projectId", "title", "postmortemNote") VALUES ($1, $2, 'Checkout errors', 'What happened')`,
          [incidentId, projectId],
        );
      }

      queryRunner = database.createQueryRunner();
      await queryRunner.connect();
    });

    afterAll(async () => {
      await queryRunner?.release();

      if (database?.isInitialized) {
        await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await database.destroy();
      }
    });

    test("up() creates the statuses table as the drift checked database has it, and adds the column without rewriting the incidents table", async () => {
      const fileNodeBefore: string = await fileNodeOfIncident();

      // In a transaction, as the migration runner runs it.
      await queryRunner.startTransaction();

      try {
        await new AddIncidentPostmortemStatus1805900000000().up(queryRunner);
        await queryRunner.commitTransaction();
      } catch (error) {
        await queryRunner.rollbackTransaction();
        throw error;
      }

      /*
       * Column for column as the drift checked table, the id's default
       * named as each schema reaches uuid_generate_v4().
       */
      const unqualified: (columns: Array<ColumnShape>) => Array<ColumnShape> = (
        columns: Array<ColumnShape>,
      ): Array<ColumnShape> => {
        return columns.map((column: ColumnShape): ColumnShape => {
          return {
            ...column,
            column_default:
              column.column_default === "public.uuid_generate_v4()"
                ? "uuid_generate_v4()"
                : column.column_default,
          };
        });
      };

      expect(
        unqualified(await columnsOf(database, schema, STATUS_TABLE)),
      ).toEqual(unqualified(await columnsOf(database, "public", STATUS_TABLE)));

      // A nullable column with no default: the table is not rewritten.
      expect(await fileNodeOfIncident()).toBe(fileNodeBefore);

      const [column]: Array<ColumnShape> = (
        await columnsOf(database, schema, "Incident")
      ).filter((candidate: ColumnShape): boolean => {
        return candidate.column_name === "postmortemStatusId";
      });

      expect(column).toEqual({
        column_name: "postmortemStatusId",
        data_type: "uuid",
        is_nullable: "YES",
        column_default: null,
        character_maximum_length: null,
      });

      // Every incident from before has none, until the data migration runs.
      expect(
        await database.query(
          `SELECT "_id", "postmortemStatusId" FROM "${schema}"."Incident" ORDER BY "_id"`,
        ),
      ).toEqual(
        [...incidentIds].sort().map((id: string) => {
          return { _id: id, postmortemStatusId: null };
        }),
      );
    });

    test("the indexes and the key are built online: valid, under their names, the key NO ACTION", async () => {
      const keys: AddIncidentPostmortemStatusIndexesAndKey1805910000000 =
        new AddIncidentPostmortemStatusIndexesAndKey1805910000000();

      expect(keys.transaction).toBe(false);

      await keys.up(queryRunner);

      const indexes: Array<{ name: string; valid: boolean }> =
        await database.query(
          `SELECT c.relname AS name, i.indisvalid AS valid FROM pg_index i
          INNER JOIN pg_class c ON c.oid = i.indexrelid
          WHERE i.indrelid = format('%I.%I', $1::text, 'Incident')::regclass
            AND c.relname IN ('IDX_74ac107944041db672d4534195', 'IDX_28e61d365962e3ee04211484c6')
          ORDER BY c.relname`,
          [schema],
        );

      expect(indexes).toEqual([
        { name: "IDX_28e61d365962e3ee04211484c6", valid: true },
        { name: "IDX_74ac107944041db672d4534195", valid: true },
      ]);

      const foreignKeys: Array<{
        conname: string;
        convalidated: boolean;
        confdeltype: string;
      }> = await database.query(
        `SELECT conname, convalidated, confdeltype FROM pg_constraint
          WHERE conrelid = format('%I.%I', $1::text, 'Incident')::regclass AND contype = 'f'`,
        [schema],
      );

      // ON DELETE NO ACTION.
      expect(foreignKeys).toEqual([
        {
          conname: "FK_74ac107944041db672d4534195b",
          convalidated: true,
          confdeltype: "a",
        },
      ]);
    });

    test("the indexes and the key are safe to build again", async () => {
      await new AddIncidentPostmortemStatusIndexesAndKey1805910000000().up(
        queryRunner,
      );

      const [counted]: Array<{ indexes: number; keys: number }> =
        await database.query(
          `SELECT
            (SELECT COUNT(*)::int FROM pg_index i INNER JOIN pg_class c ON c.oid = i.indexrelid
              WHERE i.indrelid = format('%I.%I', $1::text, 'Incident')::regclass
                AND c.relname IN ('IDX_74ac107944041db672d4534195', 'IDX_28e61d365962e3ee04211484c6')) AS indexes,
            (SELECT COUNT(*)::int FROM pg_constraint
              WHERE conrelid = format('%I.%I', $1::text, 'Incident')::regclass AND contype = 'f') AS keys`,
          [schema],
        );

      expect(counted).toEqual({ indexes: 2, keys: 1 });
    });

    test("the database refuses to delete a status incidents are in, and lets it go once none is", async () => {
      const statusId: string = ObjectID.generate().toString();

      await database.query(
        `INSERT INTO "${schema}"."${STATUS_TABLE}" ("_id", "projectId", "name", "slug", "color", "order", "version", "isNotStartedStatus")
        VALUES ($1, $2, 'Not Started', 'not-started', '#6b7280', 1, 1, true)`,
        [statusId, projectId],
      );
      await database.query(
        `UPDATE "${schema}"."Incident" SET "postmortemStatusId" = $1 WHERE "_id" = $2`,
        [statusId, incidentIds[0]],
      );

      await expect(
        database.query(
          `DELETE FROM "${schema}"."${STATUS_TABLE}" WHERE "_id" = $1`,
          [statusId],
        ),
      ).rejects.toMatchObject({ code: "23503" });

      await database.query(
        `UPDATE "${schema}"."Incident" SET "postmortemStatusId" = NULL WHERE "_id" = $1`,
        [incidentIds[0]],
      );
      await database.query(
        `DELETE FROM "${schema}"."${STATUS_TABLE}" WHERE "_id" = $1`,
        [statusId],
      );

      expect(
        await database.query(
          `SELECT COUNT(*)::int AS count FROM "${schema}"."${STATUS_TABLE}"`,
        ),
      ).toEqual([{ count: 0 }]);
    });

    test("a project's statuses go with the project", async () => {
      await database.query(
        `INSERT INTO "${schema}"."${STATUS_TABLE}" ("_id", "projectId", "name", "slug", "color", "order", "version")
        VALUES ($1, $2, 'In Review', 'in-review', '#6b7280', 1, 1)`,
        [ObjectID.generate().toString(), projectId],
      );

      await database.query(
        `DELETE FROM "${schema}"."Project" WHERE "_id" = $1`,
        [projectId],
      );

      expect(
        await database.query(
          `SELECT COUNT(*)::int AS count FROM "${schema}"."${STATUS_TABLE}"`,
        ),
      ).toEqual([{ count: 0 }]);
    });
  },
);

interface StatusRow {
  id: string;
  projectId: string;
  name: string;
  order: number;
  flag?: "isNotStartedStatus" | "isDraftStatus" | "isCompletedStatus";
  deletedAt?: Date | null;
  createdAt?: Date;
}

interface IncidentRow {
  id: string;
  projectId: string;
  postmortemNote?: string | null;
  showPostmortemOnStatusPage?: boolean | null;
  postmortemStatusId?: string | null;
}

describePostgres(
  "postmortem statuses, backfilled and read on migrated Postgres",
  () => {
    const schema: string = uniqueSchema("postmortem_status_rows");
    let database: DataSource;

    const insertStatus: (row: StatusRow) => Promise<void> = async (
      row: StatusRow,
    ): Promise<void> => {
      await database.query(
        `INSERT INTO "${schema}"."${STATUS_TABLE}"
          ("_id", "projectId", "name", "slug", "color", "order", "version", "isNotStartedStatus", "isDraftStatus", "isCompletedStatus", "deletedAt", "createdAt")
        VALUES ($1, $2, $3, $4, '#6b7280', $5, 1, $6, $7, $8, $9, $10)`,
        [
          row.id,
          row.projectId,
          row.name,
          row.name.toLowerCase().split(" ").join("-"),
          row.order,
          row.flag === "isNotStartedStatus",
          row.flag === "isDraftStatus",
          row.flag === "isCompletedStatus",
          row.deletedAt || null,
          row.createdAt || new Date(),
        ],
      );
    };

    const insertIncident: (row: IncidentRow) => Promise<void> = async (
      row: IncidentRow,
    ): Promise<void> => {
      await database.query(
        `INSERT INTO "${schema}"."Incident"
          ("_id", "projectId", "title", "postmortemNote", "showPostmortemOnStatusPage", "postmortemStatusId")
        VALUES ($1, $2, 'Checkout errors', $3, $4, $5)`,
        [
          row.id,
          row.projectId,
          row.postmortemNote === undefined ? null : row.postmortemNote,
          row.showPostmortemOnStatusPage === undefined
            ? false
            : row.showPostmortemOnStatusPage,
          row.postmortemStatusId || null,
        ],
      );
    };

    const statusOf: (incidentId: string) => Promise<string | null> = async (
      incidentId: string,
    ): Promise<string | null> => {
      const [row]: Array<{ postmortemStatusId: string | null }> =
        await database.query(
          `SELECT "postmortemStatusId" FROM "${schema}"."Incident" WHERE "_id" = $1`,
          [incidentId],
        );

      return row ? row.postmortemStatusId : null;
    };

    // A project with the four a new project starts with.
    const addDefaults: (projectId: string) => Promise<{
      notStarted: string;
      draft: string;
      completed: string;
      notNeeded: string;
    }> = async (
      projectId: string,
    ): Promise<{
      notStarted: string;
      draft: string;
      completed: string;
      notNeeded: string;
    }> => {
      const ids: {
        notStarted: string;
        draft: string;
        completed: string;
        notNeeded: string;
      } = {
        notStarted: ObjectID.generate().toString(),
        draft: ObjectID.generate().toString(),
        completed: ObjectID.generate().toString(),
        notNeeded: ObjectID.generate().toString(),
      };

      await insertStatus({
        id: ids.notStarted,
        projectId,
        name: "Not Started",
        order: 1,
        flag: "isNotStartedStatus",
      });
      await insertStatus({
        id: ids.draft,
        projectId,
        name: "Draft",
        order: 2,
        flag: "isDraftStatus",
      });
      await insertStatus({
        id: ids.completed,
        projectId,
        name: "Completed",
        order: 3,
        flag: "isCompletedStatus",
      });
      await insertStatus({
        id: ids.notNeeded,
        projectId,
        name: "Not Needed",
        order: 4,
      });

      return ids;
    };

    beforeAll(async () => {
      database = await connect(schema);
      await copyTables(database, schema, [STATUS_TABLE, "Incident"]);
    });

    afterAll(async () => {
      if (database?.isInitialized) {
        await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await database.destroy();
      }
    });

    beforeEach(async () => {
      for (const level of ["debug", "info", "warn"] as const) {
        jest.spyOn(logger, level).mockImplementation(() => {
          return undefined as never;
        });
      }

      jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
      jest
        .spyOn(PostgresAppInstance, "getDataSource")
        .mockReturnValue(database);

      await database.query(
        `DELETE FROM "${schema}"."Incident"; DELETE FROM "${schema}"."${STATUS_TABLE}"`,
      );
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    test("each incident is given the status its postmortem is in by its fields", async () => {
      const projectId: string = ObjectID.generate().toString();
      const statuses: {
        notStarted: string;
        draft: string;
        completed: string;
        notNeeded: string;
      } = await addDefaults(projectId);

      const incidents: Record<string, IncidentRow> = {
        nothingWritten: { id: ObjectID.generate().toString(), projectId },
        onlyWhiteSpace: {
          id: ObjectID.generate().toString(),
          projectId,
          postmortemNote: " \n\t\r\n ",
        },
        written: {
          id: ObjectID.generate().toString(),
          projectId,
          postmortemNote: "## What happened\n\nA bad deploy.",
        },
        published: {
          id: ObjectID.generate().toString(),
          projectId,
          postmortemNote: "## What happened\n\nA bad deploy.",
          showPostmortemOnStatusPage: true,
        },
        // A status page shows nothing without a note: not published.
        switchedOnWithNoNote: {
          id: ObjectID.generate().toString(),
          projectId,
          postmortemNote: null,
          showPostmortemOnStatusPage: true,
        },
        switchedOnWithWhiteSpace: {
          id: ObjectID.generate().toString(),
          projectId,
          postmortemNote: "   ",
          showPostmortemOnStatusPage: true,
        },
        switchUnset: {
          id: ObjectID.generate().toString(),
          projectId,
          postmortemNote: "Root cause: a full disk.",
          showPostmortemOnStatusPage: null,
        },
      };

      for (const incident of Object.values(incidents)) {
        await insertIncident(incident);
      }

      const given: number =
        await IncidentPostmortemStatusService.backfillIncidentPostmortemStatuses();

      expect(given).toBe(Object.keys(incidents).length);

      expect(await statusOf(incidents["nothingWritten"]!.id)).toBe(
        statuses.notStarted,
      );
      expect(await statusOf(incidents["onlyWhiteSpace"]!.id)).toBe(
        statuses.notStarted,
      );
      expect(await statusOf(incidents["written"]!.id)).toBe(statuses.draft);
      expect(await statusOf(incidents["published"]!.id)).toBe(
        statuses.completed,
      );
      expect(await statusOf(incidents["switchedOnWithNoNote"]!.id)).toBe(
        statuses.notStarted,
      );
      expect(await statusOf(incidents["switchedOnWithWhiteSpace"]!.id)).toBe(
        statuses.notStarted,
      );
      expect(await statusOf(incidents["switchUnset"]!.id)).toBe(statuses.draft);

      // Nobody is given Not Needed: that is the team's to say.
      expect(
        await database.query(
          `SELECT COUNT(*)::int AS count FROM "${schema}"."Incident" WHERE "postmortemStatusId" = $1`,
          [statuses.notNeeded],
        ),
      ).toEqual([{ count: 0 }]);
    });

    test("an incident that has a status keeps it, and a second run gives nothing", async () => {
      const projectId: string = ObjectID.generate().toString();
      const statuses: {
        notStarted: string;
        draft: string;
        completed: string;
        notNeeded: string;
      } = await addDefaults(projectId);

      const picked: IncidentRow = {
        id: ObjectID.generate().toString(),
        projectId,
        postmortemNote: "Written, but nobody needs it.",
        showPostmortemOnStatusPage: true,
        postmortemStatusId: statuses.notNeeded,
      };
      const unset: IncidentRow = {
        id: ObjectID.generate().toString(),
        projectId,
      };

      await insertIncident(picked);
      await insertIncident(unset);

      expect(
        await IncidentPostmortemStatusService.backfillIncidentPostmortemStatuses(),
      ).toBe(1);
      expect(await statusOf(picked.id)).toBe(statuses.notNeeded);
      expect(await statusOf(unset.id)).toBe(statuses.notStarted);

      expect(
        await IncidentPostmortemStatusService.backfillIncidentPostmortemStatuses(),
      ).toBe(0);
    });

    test("a project with no statuses yet is left for a later run, and the run still ends", async () => {
      const withStatuses: string = ObjectID.generate().toString();
      const withNone: string = ObjectID.generate().toString();
      const statuses: {
        notStarted: string;
        draft: string;
        completed: string;
        notNeeded: string;
      } = await addDefaults(withStatuses);

      const waiting: IncidentRow = {
        id: ObjectID.generate().toString(),
        projectId: withNone,
        postmortemNote: "Written before statuses.",
      };
      const given: IncidentRow = {
        id: ObjectID.generate().toString(),
        projectId: withStatuses,
      };

      await insertIncident(waiting);
      await insertIncident(given);

      expect(
        await IncidentPostmortemStatusService.backfillIncidentPostmortemStatuses(),
      ).toBe(1);
      expect(await statusOf(waiting.id)).toBeNull();
      expect(await statusOf(given.id)).toBe(statuses.notStarted);

      // Once its project has statuses, a later run gives it its own.
      const later: {
        notStarted: string;
        draft: string;
        completed: string;
        notNeeded: string;
      } = await addDefaults(withNone);

      expect(
        await IncidentPostmortemStatusService.backfillIncidentPostmortemStatuses(),
      ).toBe(1);
      expect(await statusOf(waiting.id)).toBe(later.draft);
    });

    test("each built-in status is the project's first of its kind from the top, deleted ones left out, each project its own", async () => {
      const projectId: string = ObjectID.generate().toString();
      const otherProjectId: string = ObjectID.generate().toString();
      const deletedOnTop: string = ObjectID.generate().toString();
      const firstNotStarted: string = ObjectID.generate().toString();
      const secondNotStarted: string = ObjectID.generate().toString();
      const draft: string = ObjectID.generate().toString();
      const earlierCompleted: string = ObjectID.generate().toString();
      const laterCompleted: string = ObjectID.generate().toString();

      await insertStatus({
        id: deletedOnTop,
        projectId,
        name: "Old Not Started",
        order: 0,
        flag: "isNotStartedStatus",
        deletedAt: new Date(),
      });
      await insertStatus({
        id: secondNotStarted,
        projectId,
        name: "Not Started Again",
        order: 2,
        flag: "isNotStartedStatus",
      });
      await insertStatus({
        id: firstNotStarted,
        projectId,
        name: "Not Started",
        order: 1,
        flag: "isNotStartedStatus",
      });
      await insertStatus({
        id: draft,
        projectId,
        name: "Draft",
        order: 3,
        flag: "isDraftStatus",
      });
      // Two at one place: the one made first.
      await insertStatus({
        id: laterCompleted,
        projectId,
        name: "Done",
        order: 4,
        flag: "isCompletedStatus",
        createdAt: new Date("2026-10-02T00:00:00.000Z"),
      });
      await insertStatus({
        id: earlierCompleted,
        projectId,
        name: "Completed",
        order: 4,
        flag: "isCompletedStatus",
        createdAt: new Date("2026-10-01T00:00:00.000Z"),
      });

      const other: {
        notStarted: string;
        draft: string;
        completed: string;
        notNeeded: string;
      } = await addDefaults(otherProjectId);

      const notStartedIncident: IncidentRow = {
        id: ObjectID.generate().toString(),
        projectId,
      };
      const publishedIncident: IncidentRow = {
        id: ObjectID.generate().toString(),
        projectId,
        postmortemNote: "Published.",
        showPostmortemOnStatusPage: true,
      };
      const otherIncident: IncidentRow = {
        id: ObjectID.generate().toString(),
        projectId: otherProjectId,
        postmortemNote: "Published elsewhere.",
        showPostmortemOnStatusPage: true,
      };

      await insertIncident(notStartedIncident);
      await insertIncident(publishedIncident);
      await insertIncident(otherIncident);

      expect(
        await IncidentPostmortemStatusService.backfillIncidentPostmortemStatuses(),
      ).toBe(3);
      expect(await statusOf(notStartedIncident.id)).toBe(firstNotStarted);
      expect(await statusOf(publishedIncident.id)).toBe(earlierCompleted);
      expect(await statusOf(otherIncident.id)).toBe(other.completed);
    });

    test("a project with only a not started status gives every incident that one", async () => {
      const projectId: string = ObjectID.generate().toString();
      const notStarted: string = ObjectID.generate().toString();

      await insertStatus({
        id: notStarted,
        projectId,
        name: "Not Started",
        order: 1,
        flag: "isNotStartedStatus",
      });

      const written: IncidentRow = {
        id: ObjectID.generate().toString(),
        projectId,
        postmortemNote: "Written.",
      };
      const published: IncidentRow = {
        id: ObjectID.generate().toString(),
        projectId,
        postmortemNote: "Published.",
        showPostmortemOnStatusPage: true,
      };

      await insertIncident(written);
      await insertIncident(published);

      expect(
        await IncidentPostmortemStatusService.backfillIncidentPostmortemStatuses(),
      ).toBe(2);
      expect(await statusOf(written.id)).toBe(notStarted);
      expect(await statusOf(published.id)).toBe(notStarted);
    });

    test("one statement gives at most a batch of incidents a status, and the run goes on until none is left", async () => {
      const projectId: string = ObjectID.generate().toString();
      const statuses: {
        notStarted: string;
        draft: string;
        completed: string;
        notNeeded: string;
      } = await addDefaults(projectId);

      for (let index: number = 0; index < 7; index++) {
        await insertIncident({
          id: ObjectID.generate().toString(),
          projectId,
          postmortemNote: index % 2 === 0 ? "Written." : null,
        });
      }

      // One statement of a batch of 3.
      const result: unknown = await database.query(
        getPostmortemStatusBackfillSql(3),
      );

      expect((result as Array<unknown>)[1]).toBe(3);
      expect(
        await database.query(
          `SELECT COUNT(*)::int AS count FROM "${schema}"."Incident" WHERE "postmortemStatusId" IS NULL`,
        ),
      ).toEqual([{ count: 4 }]);

      // The run, a batch of 3 at a time: 3 + 1, then a batch that gives none.
      expect(
        await IncidentPostmortemStatusService.backfillIncidentPostmortemStatuses(
          3,
        ),
      ).toBe(4);

      expect(
        await database.query(
          `SELECT "postmortemStatusId", COUNT(*)::int AS count FROM "${schema}"."Incident" GROUP BY "postmortemStatusId" ORDER BY count DESC`,
        ),
      ).toEqual([
        { postmortemStatusId: statuses.draft, count: 4 },
        { postmortemStatusId: statuses.notStarted, count: 3 },
      ]);
    });

    test("the Postmortems list's reads: its status chip, the row's status and each tile's count, through the incident service", async () => {
      const projectId: string = ObjectID.generate().toString();
      const otherProjectId: string = ObjectID.generate().toString();
      const statuses: {
        notStarted: string;
        draft: string;
        completed: string;
        notNeeded: string;
      } = await addDefaults(projectId);
      const other: {
        notStarted: string;
        draft: string;
        completed: string;
        notNeeded: string;
      } = await addDefaults(otherProjectId);

      const draftIncident: string = ObjectID.generate().toString();
      const completedIncident: string = ObjectID.generate().toString();
      const notStartedIncident: string = ObjectID.generate().toString();

      await insertIncident({
        id: draftIncident,
        projectId,
        postmortemStatusId: statuses.draft,
      });
      await insertIncident({
        id: completedIncident,
        projectId,
        postmortemStatusId: statuses.completed,
      });
      await insertIncident({
        id: notStartedIncident,
        projectId,
        postmortemStatusId: statuses.notStarted,
      });
      // Another project's incident in its own Draft.
      await insertIncident({
        id: ObjectID.generate().toString(),
        projectId: otherProjectId,
        postmortemStatusId: other.draft,
      });

      // The chip: the postmortems still owed (Not Started or Draft).
      const owed: Array<Incident> = await IncidentService.findBy({
        query: {
          projectId: new ObjectID(projectId),
          postmortemStatus: new Includes([
            statuses.notStarted,
            statuses.draft,
          ]) as never,
        },
        select: {
          _id: true,
          postmortemStatusId: true,
          postmortemStatus: {
            _id: true,
            name: true,
            color: true,
          },
        },
        skip: 0,
        limit: 10,
        props: {
          isRoot: true,
        },
      });

      expect(
        owed
          .map((incident: Incident): [string, string] => {
            return [
              incident._id!.toString(),
              incident.postmortemStatus?.name || "",
            ];
          })
          .sort(),
      ).toEqual(
        [
          [draftIncident, "Draft"],
          [notStartedIncident, "Not Started"],
        ].sort(),
      );

      // Each tile's count, within the project.
      const counts: Array<number> = [];

      for (const statusId of [
        statuses.notStarted,
        statuses.draft,
        statuses.completed,
        statuses.notNeeded,
      ]) {
        const count: PositiveNumber = await IncidentService.countBy({
          query: {
            projectId: new ObjectID(projectId),
            postmortemStatusId: new ObjectID(statusId),
          },
          props: {
            isRoot: true,
          },
        });

        counts.push(count.toNumber());
      }

      expect(counts).toEqual([1, 1, 1, 0]);
    });
  },
);
