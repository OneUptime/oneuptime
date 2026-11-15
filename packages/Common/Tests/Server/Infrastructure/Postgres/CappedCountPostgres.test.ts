import Entities from "../../../../Models/DatabaseModels/Index";
import Incident from "../../../../Models/DatabaseModels/Incident";
import CappedCount from "../../../../Server/Infrastructure/Postgres/CappedCount";
import ObjectID from "../../../../Types/ObjectID";
import { afterAll, beforeAll, describe, expect, test } from "@jest/globals";
import { DataSource, FindManyOptions, In, Raw, Repository } from "typeorm";

/*
 * A capped count's answers against repository.count's, on Postgres.
 *
 * For every read - by project, through the labels a record carries several
 * of (a join that repeats the record), through a to-one relation, with a
 * raw condition, with deleted rows and without, alternatives - and every
 * cap from 1 up past the exact count, CappedCount answers what
 * repository.count does, or upTo + 1 when that is more: never a record
 * counted twice, never one the read would not find.
 *
 * Opt in with RUN_POSTGRES_CAPPED_COUNT_TESTS=true against a database the
 * registered migrations have run on (CAPPED_COUNT_TEST_DATABASE_HOST,
 * _PORT, _NAME): the table definitions are copied from public into a schema
 * of the test's own, every row is synthetic, and the schema is dropped
 * afterwards.
 */
const describePostgres: typeof describe.skip =
  process.env["RUN_POSTGRES_CAPPED_COUNT_TESTS"] === "true"
    ? describe
    : describe.skip;

type Row = Record<string, unknown>;

describePostgres("CappedCount against repository.count, on Postgres", () => {
  const schema: string = `capped_count_${ObjectID.generate().toString().split("-").join("")}`;
  let database: DataSource;
  let sequence: number = 0;

  const projectId: string = ObjectID.generate().toString();
  const otherProjectId: string = ObjectID.generate().toString();
  const labelIds: Array<string> = [];
  const stateIds: Array<string> = [];

  function nextId(): string {
    sequence++;
    return `00000000-0000-4000-8000-${sequence.toString(16).padStart(12, "0")}`;
  }

  async function requiredFillers(table: string): Promise<Row> {
    const columns: Array<{
      column_name: string;
      data_type: string;
      udt_name: string;
      character_maximum_length: number | null;
    }> = await database.query(
      `SELECT column_name, data_type, udt_name, character_maximum_length
       FROM information_schema.columns
       WHERE table_schema = $1 AND table_name = $2
       AND is_nullable = 'NO' AND column_default IS NULL`,
      [schema, table],
    );
    const fillers: Row = {};

    for (const column of columns) {
      if (column.data_type === "uuid") {
        fillers[column.column_name] = ObjectID.generate().toString();
      } else if (
        column.data_type === "character varying" ||
        column.data_type === "text"
      ) {
        sequence++;
        fillers[column.column_name] = `v${sequence}`.slice(
          0,
          column.character_maximum_length || 100,
        );
      } else if (
        [
          "integer",
          "bigint",
          "numeric",
          "smallint",
          "double precision",
        ].includes(column.data_type)
      ) {
        fillers[column.column_name] = 0;
      } else if (column.data_type === "boolean") {
        fillers[column.column_name] = false;
      } else if (column.data_type.startsWith("timestamp")) {
        fillers[column.column_name] = new Date();
      } else if (column.data_type === "jsonb" || column.data_type === "json") {
        fillers[column.column_name] = {};
      } else if (column.data_type === "USER-DEFINED") {
        const values: Array<{ value: string }> = await database.query(
          `SELECT unnest(enum_range(NULL::"${schema}"."${column.udt_name}"))::text AS value`,
        );
        fillers[column.column_name] = values[0]?.value;
      }
    }

    return fillers;
  }

  const fillersByTable: Map<string, Row> = new Map();

  async function insert(table: string, row: Row): Promise<string> {
    if (!fillersByTable.has(table)) {
      fillersByTable.set(table, await requiredFillers(table));
    }

    const id: string = (row["_id"] as string) || nextId();
    const values: Row = {
      ...fillersByTable.get(table),
      _id: id,
      version: 1,
      ...row,
    };
    const columns: Array<string> = Object.keys(values);

    await database.query(
      `INSERT INTO "${schema}"."${table}" (${columns
        .map((column: string) => {
          return `"${column}"`;
        })
        .join(", ")}) VALUES (${columns
        .map((_column: string, index: number) => {
          return `$${index + 1}`;
        })
        .join(", ")})`,
      columns.map((column: string) => {
        const value: unknown = values[column];
        return value && typeof value === "object" && !(value instanceof Date)
          ? JSON.stringify(value)
          : value;
      }),
    );

    return id;
  }

  beforeAll(async () => {
    database = new DataSource({
      type: "postgres",
      host: process.env["CAPPED_COUNT_TEST_DATABASE_HOST"] || "localhost",
      port: Number(process.env["CAPPED_COUNT_TEST_DATABASE_PORT"] || "5400"),
      username: process.env["DATABASE_USERNAME"] || "postgres",
      password: process.env["DATABASE_PASSWORD"] || "password",
      database:
        process.env["CAPPED_COUNT_TEST_DATABASE_NAME"] ||
        process.env["DATABASE_NAME"] ||
        "oneuptimedb",
      entities: Entities,
      schema,
      synchronize: false,
      extra: { options: `-c search_path=${schema},public` },
    });
    await database.initialize();
    await database.query(`CREATE SCHEMA "${schema}"`);

    for (const table of [
      "Project",
      "Label",
      "IncidentState",
      "IncidentSeverity",
      "Incident",
      "IncidentLabel",
    ]) {
      await database.query(
        `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
      );
    }

    for (const id of [projectId, otherProjectId]) {
      await insert("Project", {
        _id: id,
        name: `Project ${id.slice(0, 4)}`,
        slug: id,
      });
    }

    for (let index: number = 0; index < 4; index++) {
      labelIds.push(
        await insert("Label", {
          projectId: projectId,
          name: `Label ${index}`,
          slug: `label-${index}`,
          color: "#000000",
          ...(index === 3 ? { deletedAt: new Date() } : {}),
        }),
      );
    }

    for (let index: number = 0; index < 3; index++) {
      stateIds.push(
        await insert("IncidentState", {
          projectId: projectId,
          name: `State ${index}`,
          slug: `state-${index}`,
          color: "#000000",
          order: index + 1,
        }),
      );
    }

    const severity: string = await insert("IncidentSeverity", {
      projectId: projectId,
      name: "Severity",
      slug: "severity",
      color: "#000000",
      order: 1,
    });

    // 41 incidents: 3 in the other project, 5 deleted, up to 3 labels each.
    for (let index: number = 0; index < 41; index++) {
      const id: string = await insert("Incident", {
        projectId: index % 13 === 12 ? otherProjectId : projectId,
        title: `Incident ${index % 5}`,
        slug: `incident-${index}`,
        currentIncidentStateId: stateIds[index % 3],
        incidentSeverityId: severity,
        incidentNumber: index + 1,
        ...(index % 8 === 7 ? { deletedAt: new Date() } : {}),
      });

      for (let label: number = 0; label < index % 4; label++) {
        await database.query(
          `INSERT INTO "${schema}"."IncidentLabel" ("incidentId", "labelId") VALUES ($1, $2)`,
          [id, labelIds[(index + label) % labelIds.length]],
        );
      }
    }
  }, 120000);

  afterAll(async () => {
    if (database?.isInitialized) {
      await database.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await database.destroy();
    }
  });

  const READS: Array<[string, () => FindManyOptions<Incident>]> = [
    [
      "by project",
      () => {
        return { where: { projectId: projectId } as never };
      },
    ],
    [
      "by project, with deleted rows",
      () => {
        return { where: { projectId: projectId } as never, withDeleted: true };
      },
    ],
    [
      "through labels a record carries several of",
      () => {
        return {
          where: {
            projectId: projectId,
            labels: { _id: In(labelIds) },
          } as never,
        };
      },
    ],
    [
      "through a label's name, deleted labels left out",
      () => {
        return {
          where: {
            labels: { name: In(["Label 0", "Label 3"]) },
          } as never,
        };
      },
    ],
    [
      "through a to-one relation",
      () => {
        return {
          where: {
            projectId: projectId,
            currentIncidentState: { name: In(["State 0", "State 1"]) },
          } as never,
        };
      },
    ],
    [
      "with a raw condition",
      () => {
        return {
          where: {
            projectId: projectId,
            title: Raw((alias: string): string => {
              return `${alias} <> 'Incident 2'`;
            }),
          } as never,
        };
      },
    ],
    [
      "alternatives",
      () => {
        return {
          where: [
            { projectId: otherProjectId },
            { title: "Incident 1", labels: { _id: In(labelIds.slice(0, 2)) } },
          ] as never,
        };
      },
    ],
    [
      "matching nothing",
      () => {
        return { where: { title: "No such incident" } as never };
      },
    ],
  ];

  test.each(READS)(
    "%s: the exact count, or upTo + 1 when more match",
    async (_label: string, read: () => FindManyOptions<Incident>) => {
      const repository: Repository<Incident> = database.getRepository(Incident);
      const exact: number = await repository.count(read());

      for (const upTo of [1, 2, 3, 5, exact - 1, exact, exact + 1, 1000]) {
        if (upTo < 1) {
          continue;
        }

        expect(await CappedCount.count(repository, read(), upTo)).toBe(
          Math.min(exact, upTo + 1),
        );
      }
    },
  );

  test("the reads count what they should: the seed is what the cases above assume", async () => {
    const repository: Repository<Incident> = database.getRepository(Incident);

    // 38 in the project, 5 of all 41 deleted.
    expect(
      await repository.count({ where: { projectId: projectId } as never }),
    ).toBeGreaterThan(20);
    // Several labels on one incident: the join repeats it, the counts do not.
    expect(
      await CappedCount.count(
        repository,
        {
          where: {
            projectId: projectId,
            labels: { _id: In(labelIds) },
          } as never,
        },
        1000,
      ),
    ).toBe(
      await repository.count({
        where: {
          projectId: projectId,
          labels: { _id: In(labelIds) },
        } as never,
      }),
    );
  });
});
