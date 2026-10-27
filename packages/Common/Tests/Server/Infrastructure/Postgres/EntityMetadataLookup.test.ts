import Entities from "../../../../Models/DatabaseModels/Index";
import EntityMetadataLookup, {
  EntityMetadataStringIndex,
} from "../../../../Server/Infrastructure/Postgres/EntityMetadataLookup";
import { fastestRun, FastestRun } from "../../../Helpers/FastestRun";
import { afterAll, beforeAll, describe, expect, test } from "@jest/globals";
import { DataSource, EntitySchema } from "typeorm";
import { EntityMetadata } from "typeorm/metadata/EntityMetadata";

/*
 * EntityMetadataLookup indexes TypeORM's DataSource.findMetadata, which
 * answered a string - an entity name, a table name, a table path - by
 * walking all of OneUptime's ~520 entities on every query.
 *
 * What these hold, on data sources built from every OneUptime model (no
 * database: the metadata is built, nothing connects):
 *
 *  - for every entity and every way TypeORM is asked for it - its class,
 *    name, target name, table name and table path, with and without a
 *    schema - the indexed lookup answers exactly what TypeORM's own walk
 *    answers, and so for strings that name no entity (the subqueries a
 *    paged joined read wraps itself in, misspellings, case variants, empty
 *    text), entity schemas and plain objects with a name;
 *  - when two entities share a name or a table name, the first in the
 *    data source's order wins, as in the walk;
 *  - a data source whose metadata is built again is indexed again;
 *  - install() is idempotent, uninstall() puts TypeORM's own back, and
 *    neither changes an answer;
 *  - a lookup by text is many times faster than the walk.
 */

type FindMetadataFunction = (
  this: DataSource,
  target: unknown,
) => EntityMetadata | undefined;

const prototype: { findMetadata: FindMetadataFunction } =
  DataSource.prototype as unknown as { findMetadata: FindMetadataFunction };

async function buildDataSource(schema?: string): Promise<DataSource> {
  const dataSource: DataSource = new DataSource({
    type: "postgres",
    entities: Entities,
    ...(schema ? { schema: schema } : {}),
  });

  await (
    dataSource as unknown as { buildMetadatas: () => Promise<void> }
  ).buildMetadatas();

  return dataSource;
}

// What a paged joined read looks itself up by (SelectQueryBuilder.from).
function subqueryText(table: string): string {
  return `(SELECT "${table}"."_id" AS "${table}__id", "${table}"."createdAt" AS "${table}_createdAt" FROM "${table}" "${table}" LEFT JOIN "Project" "${table}__${table}_project" ON "${table}__${table}_project"."_id"="${table}"."projectId" WHERE ( (("${table}"."_id" = $1)) ) AND ( "${table}"."deletedAt" IS NULL ))`;
}

describe("EntityMetadataLookup", () => {
  let original: FindMetadataFunction;
  let dataSource: DataSource;
  let schemaDataSource: DataSource;

  beforeAll(async () => {
    EntityMetadataLookup.uninstall();
    original = prototype.findMetadata;
    dataSource = await buildDataSource();
    schemaDataSource = await buildDataSource("oneuptime_test_schema");
  });

  afterAll(() => {
    EntityMetadataLookup.uninstall();
  });

  function targetsOf(source: DataSource): Array<unknown> {
    const targets: Array<unknown> = [];

    for (const metadata of source.entityMetadatas) {
      targets.push(
        metadata.target,
        metadata.name,
        metadata.targetName,
        metadata.tableName,
        metadata.tablePath,
        metadata.tableName.toLowerCase(),
        metadata.tableName.toUpperCase(),
        `public.${metadata.tableName}`,
        `${metadata.tableName}.`,
        `"${metadata.tableName}"`,
        subqueryText(metadata.tableName),
      );
    }

    targets.push(
      "",
      " ",
      ".",
      "..",
      "(",
      "()",
      "NoSuchEntity",
      "no.such.table",
      "Monitor ",
      " Monitor",
      new EntitySchema({ name: "Monitor", columns: {} }),
      new EntitySchema({ name: "NoSuchEntity", columns: {} }),
      { name: "Incident" },
      { name: "public.Incident" },
      { name: "NoSuchEntity" },
      class Monitor {},
      (): void => {},
      42,
      null,
      undefined,
      Symbol("Monitor"),
    );

    return targets;
  }

  function describeTarget(target: unknown): string {
    if (typeof target === "string") {
      return JSON.stringify(target.slice(0, 80));
    }

    if (typeof target === "function") {
      return `function ${(target as { name: string }).name}`;
    }

    if (typeof target === "symbol") {
      return target.toString();
    }

    return JSON.stringify(target) || String(target);
  }

  function answersOf(
    source: DataSource,
    targets: Array<unknown>,
  ): Array<string> {
    return targets.map((target: unknown): string => {
      const metadata: EntityMetadata | undefined = prototype.findMetadata.call(
        source,
        target,
      );

      return `${describeTarget(target)} -> ${metadata ? metadata.name + "@" + metadata.tablePath : "none"}`;
    });
  }

  test("the models build about 520 entities, without a database", () => {
    expect(dataSource.entityMetadatas.length).toBeGreaterThan(400);
    expect(dataSource.isInitialized).toBe(false);
  });

  test.each([
    [
      "without a schema",
      (): DataSource => {
        return dataSource;
      },
    ],
    [
      "with a schema",
      (): DataSource => {
        return schemaDataSource;
      },
    ],
  ])(
    "every target is answered as TypeORM's walk answers it, %s",
    (_label: string, source: () => DataSource) => {
      const targets: Array<unknown> = targetsOf(source());

      EntityMetadataLookup.uninstall();
      expect(prototype.findMetadata).toBe(original);
      const walked: Array<string> = answersOf(source(), targets);

      EntityMetadataLookup.install();
      expect(prototype.findMetadata).not.toBe(original);
      const indexed: Array<string> = answersOf(source(), targets);

      expect(indexed).toEqual(walked);

      // Every entity is found by its name, table name and table path.
      for (const metadata of source().entityMetadatas) {
        for (const text of [
          metadata.name,
          metadata.tableName,
          metadata.tablePath,
        ]) {
          expect(prototype.findMetadata.call(source(), text)).toBe(metadata);
        }
      }
    },
  );

  test("a table path is looked up only by a target with a dot in it", () => {
    EntityMetadataLookup.install();

    const monitor: EntityMetadata = schemaDataSource.getMetadata("Monitor");

    expect(monitor.tablePath).toBe("oneuptime_test_schema.Monitor");
    expect(schemaDataSource.hasMetadata("oneuptime_test_schema.Monitor")).toBe(
      true,
    );
    expect(dataSource.hasMetadata("oneuptime_test_schema.Monitor")).toBe(false);
    expect(dataSource.hasMetadata(subqueryText("Monitor"))).toBe(false);
  });

  test("the first entity in the data source's order wins a shared name, as in the walk", async () => {
    const shared: DataSource = new DataSource({
      type: "postgres",
      entities: [
        new EntitySchema({
          name: "First",
          tableName: "shared_table",
          columns: { id: { type: "uuid", primary: true } },
        }),
        new EntitySchema({
          name: "Second",
          tableName: "shared_table",
          columns: { id: { type: "uuid", primary: true } },
        }),
        new EntitySchema({
          name: "Third",
          tableName: "First",
          columns: { id: { type: "uuid", primary: true } },
        }),
        new EntitySchema({
          name: "Fourth",
          tableName: "third_table",
          columns: { id: { type: "uuid", primary: true } },
        }),
      ],
    });

    await (
      shared as unknown as { buildMetadatas: () => Promise<void> }
    ).buildMetadatas();

    const targets: Array<unknown> = [
      "First",
      "Second",
      "Third",
      "Fourth",
      "shared_table",
      "third_table",
      "public.shared_table",
      "nothing",
    ];

    EntityMetadataLookup.uninstall();
    const walked: Array<string> = answersOf(shared, targets);

    EntityMetadataLookup.install();
    const indexed: Array<string> = answersOf(shared, targets);

    expect(indexed).toEqual(walked);
    // Two tables of one name: the first entity in order.
    expect(prototype.findMetadata.call(shared, "shared_table")?.name).toBe(
      "First",
    );
    /*
     * A schema's name is its target, which the map answers before any
     * table name: "First" is the First entity, not Third's table.
     */
    expect(prototype.findMetadata.call(shared, "First")?.name).toBe("First");
    expect(prototype.findMetadata.call(shared, "third_table")?.name).toBe(
      "Fourth",
    );
  });

  test("a data source whose metadata is built again is indexed again", async () => {
    EntityMetadataLookup.install();

    const rebuilt: DataSource = await buildDataSource();
    const before: EntityMetadata | undefined = prototype.findMetadata.call(
      rebuilt,
      "Monitor",
    );

    await (
      rebuilt as unknown as { buildMetadatas: () => Promise<void> }
    ).buildMetadatas();

    const after: EntityMetadata | undefined = prototype.findMetadata.call(
      rebuilt,
      "Monitor",
    );

    expect(before).toBeDefined();
    expect(after).toBeDefined();
    // A new metadata object, from the new map - not the stale one.
    expect(after).not.toBe(before);
    expect(after).toBe(rebuilt.entityMetadatasMap.get(after!.target));
  });

  test("the index of a map names each entity by its first key, in the map's order", () => {
    const index: EntityMetadataStringIndex = EntityMetadataLookup.buildIndex(
      dataSource.entityMetadatasMap as Map<unknown, EntityMetadata>,
    );

    expect(index.size).toBe(dataSource.entityMetadatasMap.size);
    expect(index.byNameOrTableName.get("Monitor")?.name).toBe("Monitor");
    expect(index.byTablePath.get("Monitor")?.name).toBe("Monitor");
    expect(index.byNameOrTableName.get(subqueryText("Monitor"))).toBe(
      undefined,
    );
  });

  test("install() is idempotent and uninstall() puts TypeORM's own back", () => {
    EntityMetadataLookup.uninstall();
    expect(EntityMetadataLookup.isInstalled()).toBe(false);
    expect(prototype.findMetadata).toBe(original);

    EntityMetadataLookup.install();
    const installed: FindMetadataFunction = prototype.findMetadata;

    EntityMetadataLookup.install();
    expect(prototype.findMetadata).toBe(installed);
    expect(EntityMetadataLookup.isInstalled()).toBe(true);

    EntityMetadataLookup.uninstall();
    expect(prototype.findMetadata).toBe(original);
    EntityMetadataLookup.uninstall();
    expect(prototype.findMetadata).toBe(original);
  });

  test("a lookup by text is many times faster than TypeORM's walk", () => {
    const targets: Array<string> = [
      subqueryText("Monitor"),
      "Monitor",
      "IncidentStateTimeline",
      subqueryText("Incident"),
    ];
    const lookups: number = 5000;

    function lookUp(): number {
      let found: number = 0;

      for (let index: number = 0; index < lookups; index++) {
        if (
          prototype.findMetadata.call(
            dataSource,
            targets[index % targets.length],
          )
        ) {
          found++;
        }
      }

      return found;
    }

    EntityMetadataLookup.uninstall();
    const walked: FastestRun<number> = fastestRun({
      run: lookUp,
      limitInMs: 0,
    });

    EntityMetadataLookup.install();
    const indexed: FastestRun<number> = fastestRun({
      run: lookUp,
      limitInMs: 0,
    });

    expect(indexed.result).toBe(walked.result);
    // Measured about 40 times faster; five leaves room for a busy runner.
    expect(indexed.inMs * 5).toBeLessThan(walked.inMs);
  });
});
