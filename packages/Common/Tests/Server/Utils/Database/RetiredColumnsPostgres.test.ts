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
import Entities from "../../../../Models/DatabaseModels/Index";
import Label from "../../../../Models/DatabaseModels/Label";
import PostgresAppInstance from "../../../../Server/Infrastructure/PostgresDatabase";
import DatabaseService from "../../../../Server/Services/DatabaseService";
import QueryUtil from "../../../../Server/Types/Database/QueryUtil";
import RetiredColumns from "../../../../Server/Utils/Database/RetiredColumns";
import EndsWith from "../../../../Types/BaseDatabase/EndsWith";
import EqualTo from "../../../../Types/BaseDatabase/EqualTo";
import EqualToOrNull from "../../../../Types/BaseDatabase/EqualToOrNull";
import GreaterThan from "../../../../Types/BaseDatabase/GreaterThan";
import GreaterThanOrEqual from "../../../../Types/BaseDatabase/GreaterThanOrEqual";
import GreaterThanOrNull from "../../../../Types/BaseDatabase/GreaterThanOrNull";
import InBetween from "../../../../Types/BaseDatabase/InBetween";
import Includes from "../../../../Types/BaseDatabase/Includes";
import IncludesNone from "../../../../Types/BaseDatabase/IncludesNone";
import IncludesNoneOrNull from "../../../../Types/BaseDatabase/IncludesNoneOrNull";
import IsNull from "../../../../Types/BaseDatabase/IsNull";
import LessThan from "../../../../Types/BaseDatabase/LessThan";
import LessThanOrEqual from "../../../../Types/BaseDatabase/LessThanOrEqual";
import LessThanOrNull from "../../../../Types/BaseDatabase/LessThanOrNull";
import NotContains from "../../../../Types/BaseDatabase/NotContains";
import NotEqual from "../../../../Types/BaseDatabase/NotEqual";
import NotEqualOrNull from "../../../../Types/BaseDatabase/NotEqualOrNull";
import NotNull from "../../../../Types/BaseDatabase/NotNull";
import NotWildcard from "../../../../Types/BaseDatabase/NotWildcard";
import Search from "../../../../Types/BaseDatabase/Search";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import StartsWith from "../../../../Types/BaseDatabase/StartsWith";
import Wildcard from "../../../../Types/BaseDatabase/Wildcard";
import ObjectID from "../../../../Types/ObjectID";
import { DataSource, EntityMetadata } from "typeorm";
import { ColumnMetadata } from "typeorm/metadata/ColumnMetadata";

/*
 * A RETIRED COLUMN IS READ AS POSTGRES READS AN EMPTY ONE (#10469).
 *
 * deletedByUserId was empty on every record, and went. A query that still
 * names it is read as it always was (RetiredColumns): a condition that held
 * for an empty column is dropped, and any other means nothing matches. This
 * holds that rule to Postgres itself, operator by operator: each condition
 * is compiled by the real query compiler (QueryUtil.serializeQuery) on a
 * uuid column that is empty on every row - lastModifiedByUserId, as
 * deletedByUserId was - and asked of real rows. Then the service reads with
 * the retired names as an old client sends them.
 *
 * Needs only a bare Postgres: the model's table is made from its own column
 * metadata in a schema of its own, dropped afterwards. Opt in with
 * RUN_POSTGRES_RETIRED_COLUMNS_TESTS=true; RETIRED_COLUMNS_TEST_DATABASE_HOST
 * / _PORT / _NAME point it at a database other than the local one.
 */

const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_RETIRED_COLUMNS_TESTS"] === "true"
    ? describe
    : describe.skip;

const SCHEMA: string = `retired_columns_${process.pid}_${Date.now()}`;

const AN_ID: string = "0193c0de-aaaa-4aaa-8bbb-0000000000d1";

// The column that stands in for deletedByUserId: a uuid, empty on every row.
const EMPTY_COLUMN: string = "lastModifiedByUserId";

// Each condition a query may compare a uuid column with.
const CONDITIONS: Array<[string, unknown]> = [
  ["null", null],
  ["IsNull", new IsNull()],
  ["EqualToOrNull", new EqualToOrNull(AN_ID)],
  ["NotEqualOrNull", new NotEqualOrNull(AN_ID)],
  ["GreaterThanOrNull", new GreaterThanOrNull(AN_ID)],
  ["LessThanOrNull", new LessThanOrNull(AN_ID)],
  ["IncludesNoneOrNull", new IncludesNoneOrNull([AN_ID])],
  ["NotContains", new NotContains("d1")],
  ["NotWildcard", new NotWildcard("*d1")],
  ["an id as text", AN_ID],
  ["an ObjectID", new ObjectID(AN_ID)],
  ["EqualTo", new EqualTo(AN_ID)],
  ["NotEqual", new NotEqual(AN_ID)],
  ["NotNull", new NotNull()],
  ["Includes", new Includes([AN_ID])],
  ["IncludesNone", new IncludesNone([AN_ID])],
  ["Search", new Search("d1")],
  ["StartsWith", new StartsWith("0193")],
  ["EndsWith", new EndsWith("d1")],
  ["Wildcard", new Wildcard("*d1")],
  ["GreaterThan", new GreaterThan(AN_ID)],
  ["GreaterThanOrEqual", new GreaterThanOrEqual(AN_ID)],
  ["LessThan", new LessThan(AN_ID)],
  ["LessThanOrEqual", new LessThanOrEqual(AN_ID)],
  ["InBetween", new InBetween(AN_ID, AN_ID)],
];

describePostgres(
  "a retired column, read as Postgres reads an empty one",
  () => {
    let database: DataSource;
    let service: DatabaseService<Label>;
    const projectId: ObjectID = ObjectID.generate();

    const table: () => string = (): string => {
      return `"${SCHEMA}"."${database.getMetadata(Label).tableName}"`;
    };

    beforeAll(async () => {
      database = new DataSource({
        type: "postgres",
        host: process.env["RETIRED_COLUMNS_TEST_DATABASE_HOST"] || "localhost",
        port: Number(
          process.env["RETIRED_COLUMNS_TEST_DATABASE_PORT"] || "5400",
        ),
        username: process.env["DATABASE_USERNAME"] || "postgres",
        password: process.env["DATABASE_PASSWORD"] || "password",
        database:
          process.env["RETIRED_COLUMNS_TEST_DATABASE_NAME"] ||
          process.env["DATABASE_NAME"] ||
          "oneuptimedb",
        entities: Entities,
        schema: SCHEMA,
        synchronize: false,
        extra: { options: `-c search_path=${SCHEMA}` },
      });
      await database.initialize();
      await database.query(`CREATE SCHEMA "${SCHEMA}"`);

      // The model's own columns, as TypeORM types them, with no keys.
      const metadata: EntityMetadata = database.getMetadata(Label);
      const columns: Map<string, string> = new Map<string, string>();

      for (const column of metadata.columns as Array<ColumnMetadata>) {
        if (columns.has(column.databaseName)) {
          continue;
        }

        let definition: string = database.driver.normalizeType(column);

        if (column.isPrimary) {
          definition += " PRIMARY KEY";
        } else if (column.isCreateDate || column.isUpdateDate) {
          definition += " NOT NULL DEFAULT now()";
        } else if (column.isVersion) {
          definition += " NOT NULL DEFAULT 1";
        }

        columns.set(column.databaseName, definition);
      }

      await database.query(
        `CREATE TABLE ${table()} (${Array.from(columns.entries())
          .map(([name, definition]: [string, string]): string => {
            return `"${name}" ${definition}`;
          })
          .join(", ")})`,
      );

      for (const name of ["API", "Web"]) {
        await database.query(
          `INSERT INTO ${table()} ("_id", "projectId", "name") VALUES ($1, $2, $3)`,
          [ObjectID.generate().toString(), projectId.toString(), name],
        );
      }
    }, 120_000);

    afterAll(async () => {
      if (database?.isInitialized) {
        await database.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
        await database.destroy();
      }
    });

    beforeEach(() => {
      jest.spyOn(PostgresAppInstance, "isConnected").mockReturnValue(true);
      jest
        .spyOn(PostgresAppInstance, "getDataSource")
        .mockReturnValue(database);

      service = new DatabaseService<Label>(Label);
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    // How many of the two rows a condition on the empty column matches.
    async function matched(condition: unknown): Promise<number> {
      return await database.getRepository(Label).count({
        where: QueryUtil.serializeQuery(Label, {
          [EMPTY_COLUMN]: condition,
        } as never) as never,
      });
    }

    test("the premise: the column is a uuid, and empty on both rows", async () => {
      const rows: Array<{ type: string; empty: number }> = await database.query(
        `SELECT (SELECT data_type FROM information_schema.columns WHERE table_schema = $1 AND table_name = $2 AND column_name = $3) AS "type", (SELECT COUNT(*)::int FROM ${table()} WHERE "${EMPTY_COLUMN}" IS NULL) AS "empty"`,
        [SCHEMA, database.getMetadata(Label).tableName, EMPTY_COLUMN],
      );

      expect(rows[0]).toEqual({ type: "uuid", empty: 2 });
    });

    test.each(CONDITIONS)(
      "%s: the rule says what Postgres says of an empty column",
      async (_name: string, condition: unknown) => {
        const count: number = await matched(condition);

        // Every row or none: the column is the same on each.
        expect([0, 2]).toContain(count);
        expect(RetiredColumns.holdsForEmpty(condition)).toBe(count === 2);
      },
    );

    test("a read that names who deleted a record, as an old client sends it, reads as it did", async () => {
      const props: { isRoot: true } = { isRoot: true };

      const all: Array<Label> = await service.findBy({
        query: { projectId: projectId, deletedByUserId: new IsNull() } as never,
        select: { name: true, deletedByUserId: true } as never,
        sort: {
          deletedByUserId: SortOrder.Ascending,
          name: SortOrder.Ascending,
        } as never,
        skip: 0,
        limit: 10,
        props: props,
      });

      expect(
        all.map((label: Label): string => {
          return label.name || "";
        }),
      ).toEqual(["API", "Web"]);

      const none: Array<Label> = await service.findBy({
        query: { projectId: projectId, deletedByUserId: AN_ID } as never,
        select: { name: true } as never,
        skip: 0,
        limit: 10,
        props: props,
      });

      expect(none).toEqual([]);

      expect(
        (
          await service.countBy({
            query: { projectId: projectId, deletedByUserId: null } as never,
            props: props,
          })
        ).toNumber(),
      ).toBe(2);
      expect(
        (
          await service.countBy({
            query: { deletedByUser: { name: "Alex" } } as never,
            props: props,
          })
        ).toNumber(),
      ).toBe(0);
    });
  },
);
