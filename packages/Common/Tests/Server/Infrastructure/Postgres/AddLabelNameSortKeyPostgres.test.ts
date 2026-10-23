import { AddLabelNameSortKey1806200000000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1806200000000-AddLabelNameSortKey";
import ObjectID from "../../../../Types/ObjectID";
import { sortLabelNames } from "../../../../Utils/LabelOrder";
import { getNaturalSortKey } from "../../../../Utils/NaturalOrder";
import { afterAll, beforeAll, describe, expect, test } from "@jest/globals";
import { DataSource, QueryRunner } from "typeorm";

/*
 * The AddLabelNameSortKey migration against a real Postgres, on real rows:
 * labels are read in natural order by the sort key every create and rename
 * writes (Label.nameSortKey) - numbered labels first, by their numbers,
 * then the others alphabetically, case and accents aside (OneUptime issue
 * #5183).
 *
 * Opt in with RUN_POSTGRES_LABEL_ORDER_TESTS=true and the normal database
 * credentials; LABEL_ORDER_TEST_DATABASE_HOST / _PORT / _NAME point it at a
 * database other than the local development one. The database must already
 * be migrated: Label is cloned from public into a uniquely named schema (so
 * the source's rows are never read or modified) and put back as it was
 * before the migration - without the key - and the migration's up() then
 * runs there. The schema is dropped afterwards.
 *
 * What it pins:
 *   - the column is added empty, rewriting no row: a varchar(500) under the
 *     "C" collation, nullable, with no default;
 *   - ORDERED BY THE KEY, POSTGRES PUTS LABELS IN EXACTLY THE ORDER THE
 *     BROWSER SORTS THEM IN (Utils/LabelOrder.sortLabelNames): the "C"
 *     collation compares code points as compareCodePoints does - accents,
 *     case, emoji and characters past U+FFFF included - where ordering by
 *     the name, under the database's own collation, puts "10." before "2.";
 *   - descending is the same order the other way round, and a label whose
 *     key is not written yet comes after every label that has one;
 *   - down() drops the column again.
 */

// describe.skip's type is the one both branches share.
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_LABEL_ORDER_TESTS"] === "true"
    ? describe
    : describe.skip;

// As a project's labels arrive: in no order a person reads.
const NAMES: Array<string> = [
  "4.Business System=Customer Mobile App",
  "Claude",
  "10.Owner=Loyalty Platform Team",
  "2.SubCategory=Website",
  "production",
  "1.Category=Application",
  "Église",
  "eu east",
  "EU West",
  "3.Item=Connectivity",
  "#infra",
  "(legacy)",
  "Tier 10",
  "Tier 2",
  "v1.10",
  "v1.9",
  "Strasse 2",
  "Straße 1",
  "\u{FF11}\u{FF10}. Full-width ten",
  "9. Nine",
  "\u{1F525} Hot",
  "\u{E000} Private",
  "\u{4E2D}\u{6587}",
  "zeta",
  "Zeta 2",
];

describePostgres("AddLabelNameSortKey against Postgres", () => {
  const schema: string = `label_order_test_${ObjectID.generate()
    .toString()
    .replace(/-/g, "")}`;
  const projectId: string = ObjectID.generate().toString();
  let database: DataSource;

  async function runInSchema(
    step: (queryRunner: QueryRunner) => Promise<void>,
  ): Promise<void> {
    const queryRunner: QueryRunner = database.createQueryRunner();
    try {
      await queryRunner.query(`SET search_path TO "${schema}"`);
      await step(queryRunner);
    } finally {
      await queryRunner.release();
    }
  }

  async function insertLabel(name: string): Promise<string> {
    const id: string = ObjectID.generate().toString();

    await database.query(
      `INSERT INTO "${schema}"."Label" ("_id", "projectId", "name", "slug", "color", "version")
       VALUES ($1, $2, $3, $4, '#6366f1', 1)`,
      [id, projectId, name, `label-${id}`],
    );

    return id;
  }

  async function namesOrderedBy(orderBy: string): Promise<Array<string>> {
    const rows: Array<{ name: string }> = await database.query(
      `SELECT "name" FROM "${schema}"."Label" WHERE "projectId" = $1 ORDER BY ${orderBy}`,
      [projectId],
    );

    return rows.map((row: { name: string }): string => {
      return row.name;
    });
  }

  const ids: Map<string, string> = new Map();

  beforeAll(async () => {
    database = new DataSource({
      type: "postgres",
      host: process.env["LABEL_ORDER_TEST_DATABASE_HOST"] || "localhost",
      port: Number(process.env["LABEL_ORDER_TEST_DATABASE_PORT"] || "5400"),
      username: process.env["DATABASE_USERNAME"] || "postgres",
      password: process.env["DATABASE_PASSWORD"] || "password",
      database:
        process.env["LABEL_ORDER_TEST_DATABASE_NAME"] ||
        process.env["DATABASE_NAME"] ||
        "oneuptimedb",
      schema: schema,
      synchronize: false,
      extra: { options: `-c search_path=${schema},public` },
    });
    await database.initialize();
    await database.query(`CREATE SCHEMA "${schema}"`);
    await database.query(
      `CREATE TABLE "${schema}"."Label" (LIKE public."Label" INCLUDING ALL)`,
    );

    // The table as it was BEFORE the migration, whether or not the source has run it.
    await database.query(
      `ALTER TABLE "${schema}"."Label" DROP COLUMN IF EXISTS "nameSortKey"`,
    );

    for (const name of NAMES) {
      ids.set(name, await insertLabel(name));
    }

    await runInSchema(async (queryRunner: QueryRunner) => {
      await new AddLabelNameSortKey1806200000000().up(queryRunner);
    });
  });

  afterAll(async () => {
    if (database?.isInitialized) {
      await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await database.destroy();
    }
  });

  test("adds the key empty: a nullable varchar(500) under the C collation, with no default", async () => {
    const columns: Array<{
      data_type: string;
      character_maximum_length: number;
      collation_name: string | null;
      is_nullable: string;
      column_default: string | null;
    }> = await database.query(
      `SELECT data_type, character_maximum_length, collation_name, is_nullable, column_default
       FROM information_schema.columns
       WHERE table_schema = $1 AND table_name = 'Label' AND column_name = 'nameSortKey'`,
      [schema],
    );

    expect(columns).toHaveLength(1);
    expect(columns[0]).toEqual({
      data_type: "character varying",
      character_maximum_length: 500,
      collation_name: "C",
      is_nullable: "YES",
      column_default: null,
    });

    const written: Array<{ count: string }> = await database.query(
      `SELECT COUNT(*)::text AS count FROM "${schema}"."Label" WHERE "nameSortKey" IS NOT NULL`,
    );

    expect(written[0]!.count).toBe("0");
  });

  describe("with every label's key written", () => {
    beforeAll(async () => {
      for (const [name, id] of ids.entries()) {
        await database.query(
          `UPDATE "${schema}"."Label" SET "nameSortKey" = $1 WHERE "_id" = $2`,
          [getNaturalSortKey(name), id],
        );
      }
    });

    test("Postgres reads them in exactly the order the browser sorts them in", async () => {
      const ordered: Array<string> = await namesOrderedBy(
        `"nameSortKey" ASC, "_id" ASC`,
      );

      expect(ordered).toEqual(sortLabelNames(NAMES));
    });

    test("that order is the issue's: numbered labels first, by their numbers, then the rest", async () => {
      const ordered: Array<string> = await namesOrderedBy(`"nameSortKey" ASC`);

      expect(ordered.slice(0, 7)).toEqual([
        "1.Category=Application",
        "2.SubCategory=Website",
        "3.Item=Connectivity",
        "4.Business System=Customer Mobile App",
        "9. Nine",
        // Full-width digits are the digits; after "10." a space comes before "O".
        "\u{FF11}\u{FF10}. Full-width ten",
        "10.Owner=Loyalty Platform Team",
      ]);
      expect(ordered.indexOf("Tier 2")).toBeLessThan(
        ordered.indexOf("Tier 10"),
      );
      expect(ordered.indexOf("v1.9")).toBeLessThan(ordered.indexOf("v1.10"));
      expect(ordered.indexOf("Église")).toBeLessThan(
        ordered.indexOf("eu east"),
      );
      expect(ordered.indexOf("eu east")).toBeLessThan(
        ordered.indexOf("EU West"),
      );
      expect(ordered.indexOf("\u{E000} Private")).toBeLessThan(
        ordered.indexOf("\u{1F525} Hot"),
      );
    });

    test("ordered by the name instead, the database's own collation puts 10 before 2", async () => {
      const byName: Array<string> = await namesOrderedBy(`"name" ASC`);

      expect(byName.indexOf("10.Owner=Loyalty Platform Team")).toBeLessThan(
        byName.indexOf("2.SubCategory=Website"),
      );
    });

    test("descending is the same order the other way round", async () => {
      expect(await namesOrderedBy(`"nameSortKey" DESC`)).toEqual(
        [...sortLabelNames(NAMES)].reverse(),
      );
    });

    test("a label whose key is not written yet comes after every label that has one", async () => {
      await insertLabel("0. Before every other");

      const ordered: Array<string> = await namesOrderedBy(
        `"nameSortKey" ASC, "name" ASC`,
      );

      expect(ordered[ordered.length - 1]).toBe("0. Before every other");
    });
  });

  test("down() drops the column again", async () => {
    await runInSchema(async (queryRunner: QueryRunner) => {
      await new AddLabelNameSortKey1806200000000().down(queryRunner);
    });

    const columns: Array<unknown> = await database.query(
      `SELECT 1 FROM information_schema.columns
       WHERE table_schema = $1 AND table_name = 'Label' AND column_name = 'nameSortKey'`,
      [schema],
    );

    expect(columns).toHaveLength(0);
  });
});
