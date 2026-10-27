import Entities from "../../../../Models/DatabaseModels/Index";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import QueryPropertyNames from "../../../../Server/Infrastructure/Postgres/QueryPropertyNames";
import { fastestRun, FastestRun } from "../../../Helpers/FastestRun";
import { afterAll, beforeAll, describe, expect, test } from "@jest/globals";
import {
  DataSource,
  EntitySchema,
  FindManyOptions,
  ObjectLiteral,
  QueryBuilder,
  SelectQueryBuilder,
} from "typeorm";
import { EntityMetadata } from "typeorm/metadata/EntityMetadata";

/*
 * QueryPropertyNames replaces TypeORM's replacePropertyNamesForTheWholeQuery,
 * which made every alias's dictionary of property names - every relation
 * and every column of its entity, three times over - and a regular
 * expression of the aliases, on every query TypeORM built. It makes each
 * entity's dictionary once, and each pattern once per set of aliases.
 *
 * Held here, on a data source built from every OneUptime model (no
 * database): every statement TypeORM writes - selects of every column, with
 * every relation of every entity joined and selected, filtered through
 * relations, ordered by a relation's column, paged (TypeORM's two-query
 * page, subquery and all), counts, updates, deletes, soft deletes and
 * inserts - is the same text with the patch as with TypeORM's own; a
 * statement with no alias of an entity is returned as it came; a prefix two
 * aliases share takes both dictionaries, the later winning; install() is
 * idempotent and uninstall() puts TypeORM's own back; and getQuery() is
 * faster with it.
 */

let dataSource: DataSource;

const ID: string = "7c8d9e0f-1a2b-4c3d-8e4f-5a6b7c8d9e0f";

beforeAll(async () => {
  QueryPropertyNames.uninstall();
  dataSource = new DataSource({ type: "postgres", entities: Entities });
  await (
    dataSource as unknown as { buildMetadatas: () => Promise<void> }
  ).buildMetadatas();
});

afterAll(() => {
  QueryPropertyNames.uninstall();
});

// Every statement of every kind this test has TypeORM write, for an entity.
function statementsOf(metadata: EntityMetadata): Array<string> {
  const repository: ReturnType<DataSource["getRepository"]> =
    dataSource.getRepository(metadata.target);
  const statements: Array<string> = [];
  const select: Record<string, unknown> = {};

  for (const column of metadata.columns) {
    if (!column.relationMetadata) {
      select[column.propertyName] = true;
    }
  }

  const find: (options: FindManyOptions<ObjectLiteral>) => string = (
    options: FindManyOptions<ObjectLiteral>,
  ): string => {
    const builder: SelectQueryBuilder<ObjectLiteral> = repository.manager
      .createQueryBuilder(metadata.target as never, metadata.name)
      .setFindOptions(options);

    return builder.getQuery();
  };

  statements.push(find({ select: select as never }));

  const primary: string | undefined = metadata.primaryColumns[0]?.propertyName;

  if (primary) {
    statements.push(
      find({
        where: { [primary]: ID } as never,
        order: { [primary]: "ASC" } as never,
        skip: 5,
        take: 10,
      }),
    );
  }

  for (const relation of metadata.relations) {
    const relatedPrimary: string | undefined =
      relation.inverseEntityMetadata.primaryColumns[0]?.propertyName;

    statements.push(
      find({
        relations: { [relation.propertyName]: true } as never,
        take: 10,
      }),
    );

    if (relatedPrimary) {
      statements.push(
        find({
          select: {
            ...(primary ? { [primary]: true } : {}),
            [relation.propertyName]: { [relatedPrimary]: true },
          } as never,
          relations: { [relation.propertyName]: true } as never,
          where: {
            [relation.propertyName]: { [relatedPrimary]: ID },
          } as never,
          order: {
            [relation.propertyName]: { [relatedPrimary]: "DESC" },
          } as never,
        }),
      );
    }

    // The query builder's own relation API: a property path in a where.
    if (relation.joinColumns.length > 0) {
      statements.push(
        repository
          .createQueryBuilder("record")
          .leftJoinAndSelect(`record.${relation.propertyPath}`, "joined")
          .where(`record.${relation.propertyPath} = :id`, { id: ID })
          .getQuery(),
      );
    }
  }

  statements.push(
    repository
      .createQueryBuilder("record")
      .select("COUNT(*)", "count")
      .where(primary ? `record.${primary} = :id` : "1 = 1", { id: ID })
      .getQuery(),
  );

  if (primary) {
    const firstColumn: string | undefined = metadata.columns.find(
      (column: EntityMetadata["columns"][number]) => {
        return !column.isPrimary && !column.relationMetadata;
      },
    )?.propertyName;

    if (firstColumn) {
      statements.push(
        dataSource
          .createQueryBuilder()
          .update(metadata.target)
          .set({ [firstColumn]: null } as never)
          .where(`${primary} = :id AND ${firstColumn} IS NOT NULL`, { id: ID })
          .getQuery(),
      );
    }

    statements.push(
      dataSource
        .createQueryBuilder()
        .delete()
        .from(metadata.target)
        .where(`${primary} = :id`, { id: ID })
        .getQuery(),
    );

    if (metadata.deleteDateColumn) {
      statements.push(
        dataSource
          .createQueryBuilder()
          .softDelete()
          .from(metadata.target)
          .where(`${primary} = :id`, { id: ID })
          .getQuery(),
      );
    }

    statements.push(
      dataSource
        .createQueryBuilder()
        .insert()
        .into(metadata.target)
        .values({ [primary]: ID } as never)
        .getQuery(),
    );
  }

  return statements;
}

describe("QueryPropertyNames", () => {
  test("every statement TypeORM writes for every entity is the same text with the patch", () => {
    const metadatas: Array<EntityMetadata> = dataSource.entityMetadatas;

    QueryPropertyNames.uninstall();
    expect(QueryPropertyNames.isInstalled()).toBe(false);
    const typeOrm: Array<Array<string>> = metadatas.map(statementsOf);

    QueryPropertyNames.install();
    expect(QueryPropertyNames.isInstalled()).toBe(true);
    const patched: Array<Array<string>> = metadatas.map(statementsOf);

    let compared: number = 0;
    const differing: Array<string> = [];

    for (let index: number = 0; index < metadatas.length; index++) {
      for (let at: number = 0; at < typeOrm[index]!.length; at++) {
        compared++;

        if (patched[index]![at] !== typeOrm[index]![at]) {
          differing.push(
            `${metadatas[index]!.name} #${at}:\n${patched[index]![at]}\ninstead of\n${typeOrm[index]![at]}`,
          );
        }
      }
    }

    expect(differing.slice(0, 3)).toEqual([]);
    // Hundreds of entities, thousands of relations: tens of thousands.
    expect(compared).toBeGreaterThan(10000);
  });

  test("a statement of a paged joined read, subquery and all, is the same", () => {
    const build: () => string = (): string => {
      return dataSource
        .getRepository(Monitor)
        .createQueryBuilder("Monitor")
        .setFindOptions({
          where: { projectId: ID } as never,
          select: {
            _id: true,
            name: true,
            labels: { _id: true, name: true },
          } as never,
          relations: { labels: true } as never,
          order: { createdAt: "DESC", _id: "ASC" } as never,
          skip: 10,
          take: 10,
        })
        .getQuery();
    };

    QueryPropertyNames.uninstall();
    const typeOrm: string = build();
    QueryPropertyNames.install();

    expect(build()).toBe(typeOrm);
  });

  test("a statement with no alias of an entity is returned as it came", () => {
    QueryPropertyNames.install();

    const builder: SelectQueryBuilder<ObjectLiteral> = dataSource
      .createQueryBuilder()
      .select("1", "one")
      .from("(SELECT 1)", "sub");

    expect(
      (
        builder as unknown as {
          replacePropertyNamesForTheWholeQuery: (statement: string) => string;
        }
      ).replacePropertyNamesForTheWholeQuery("SELECT sub.anything FROM x"),
    ).toBe("SELECT sub.anything FROM x");
  });

  test("a prefix two aliases share takes both dictionaries, the later winning", () => {
    const monitor: EntityMetadata = dataSource.getMetadata("Monitor");
    const project: EntityMetadata = dataSource.getMetadata("Project");
    const escape: (name: string) => string = (name: string): string => {
      return `"${name}"`;
    };
    const statement: string =
      "SELECT x.projectId, x.name, x.monitorSteps, x.isBlocked FROM t";
    const sharing: {
      expressionMap: {
        aliases: Array<{
          name: string;
          hasMetadata: boolean;
          metadata: EntityMetadata;
        }>;
        aliasNamePrefixingEnabled: boolean;
      };
      escape: (name: string) => string;
    } = {
      expressionMap: {
        aliases: [
          { name: "x", hasMetadata: true, metadata: monitor },
          { name: "x", hasMetadata: true, metadata: project },
          { name: "unused", hasMetadata: false, metadata: monitor },
        ],
        aliasNamePrefixingEnabled: true,
      },
      escape: escape,
    };

    const typeOrm: string = QueryPropertyNames.getOriginal().call(
      sharing as never,
      statement,
    );

    expect(QueryPropertyNames.replace(sharing as never, statement)).toBe(
      typeOrm,
    );

    // Without alias prefixes, every alias shares the empty one.
    sharing.expressionMap.aliasNamePrefixingEnabled = false;

    const unprefixed: string = "UPDATE t SET projectId = 1, isBlocked = 2";

    expect(QueryPropertyNames.replace(sharing as never, unprefixed)).toBe(
      QueryPropertyNames.getOriginal().call(sharing as never, unprefixed),
    );
  });

  test("an embedded column's property path is replaced as TypeORM replaces it", async () => {
    // OneUptime's models embed nothing; TypeORM's function reads paths too.
    const withEmbedded: DataSource = new DataSource({
      type: "postgres",
      entities: [
        new EntitySchema<{
          id: string;
          address: { city: string; street: string };
        }>({
          name: "Place",
          columns: { id: { type: "uuid", primary: true } },
          embeddeds: {
            address: {
              schema: new EntitySchema({
                name: "Address",
                columns: {
                  city: { type: String },
                  street: { type: String, name: "street_name" },
                },
              }),
              prefix: "addr_",
            },
          },
        }),
      ],
    });

    await (
      withEmbedded as unknown as { buildMetadatas: () => Promise<void> }
    ).buildMetadatas();

    const build: () => string = (): string => {
      return withEmbedded
        .createQueryBuilder("Place", "place")
        .select("place.address.city")
        .where("place.address.street = :street", { street: "x" })
        .orderBy("place.address.city")
        .getQuery();
    };

    QueryPropertyNames.uninstall();
    const typeOrm: string = build();
    QueryPropertyNames.install();
    const patched: string = build();

    expect(patched).toBe(typeOrm);
    expect(patched).toContain('"addr_Street_name"');
  });

  test("an entity's dictionary is made once, and is TypeORM's for it", () => {
    const monitor: EntityMetadata = dataSource.getMetadata("Monitor");

    expect(QueryPropertyNames.dictionaryOf(monitor)).toBe(
      QueryPropertyNames.dictionaryOf(monitor),
    );
    expect(QueryPropertyNames.dictionaryOf(monitor)["projectId"]).toBe(
      "projectId",
    );
    expect(QueryPropertyNames.dictionaryOf(monitor)["project"]).toBe(
      "projectId",
    );
    expect(QueryPropertyNames.dictionaryOf(monitor)["project._id"]).toBe(
      "projectId",
    );
  });

  test("install() is idempotent and uninstall() puts TypeORM's own back", () => {
    const prototype: { replacePropertyNamesForTheWholeQuery: unknown } =
      QueryBuilder.prototype as unknown as {
        replacePropertyNamesForTheWholeQuery: unknown;
      };

    QueryPropertyNames.uninstall();
    const original: unknown = prototype.replacePropertyNamesForTheWholeQuery;

    QueryPropertyNames.install();
    const installed: unknown = prototype.replacePropertyNamesForTheWholeQuery;

    QueryPropertyNames.install();
    expect(prototype.replacePropertyNamesForTheWholeQuery).toBe(installed);
    expect(QueryPropertyNames.getOriginal()).toBe(original);

    QueryPropertyNames.uninstall();
    expect(prototype.replacePropertyNamesForTheWholeQuery).toBe(original);
  });

  test("getQuery() of a monitor's read with its relations is faster with it", () => {
    const builder: SelectQueryBuilder<Monitor> = dataSource
      .getRepository(Monitor)
      .createQueryBuilder("Monitor")
      .setFindOptions({
        where: { _id: ID } as never,
        select: {
          _id: true,
          name: true,
          monitorSteps: true,
          labels: { _id: true, name: true },
          dependsOnMonitors: { _id: true },
        } as never,
        relations: { labels: true, dependsOnMonitors: true } as never,
        order: { createdAt: "DESC", _id: "ASC" } as never,
      });
    const calls: number = 300;
    const write: () => number = (): number => {
      let length: number = 0;

      for (let index: number = 0; index < calls; index++) {
        length += builder.getQuery().length;
      }

      return length;
    };

    QueryPropertyNames.uninstall();
    const typeOrm: FastestRun<number> = fastestRun({
      run: write,
      limitInMs: 0,
    });

    QueryPropertyNames.install();
    const patched: FastestRun<number> = fastestRun({
      run: write,
      limitInMs: 0,
    });

    expect(patched.result).toBe(typeOrm.result);
    // Measured about 30 to 45% faster; any gain leaves room for a busy runner.
    expect(patched.inMs).toBeLessThan(typeOrm.inMs);
  });
});
