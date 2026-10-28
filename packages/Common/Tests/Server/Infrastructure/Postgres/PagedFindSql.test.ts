import Entities from "../../../../Models/DatabaseModels/Index";
import Incident from "../../../../Models/DatabaseModels/Incident";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import MonitorProbe from "../../../../Models/DatabaseModels/MonitorProbe";
import PagedFind from "../../../../Server/Infrastructure/Postgres/PagedFind";
import { afterAll, beforeAll, describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  DataSource,
  EntitySchema,
  FindManyOptions,
  In,
  ObjectLiteral,
  Repository,
  SelectQueryBuilder,
} from "typeorm";
import { EntityMetadata } from "typeorm/metadata/EntityMetadata";
import { RelationMetadata } from "typeorm/metadata/RelationMetadata";
import { JoinAttribute } from "typeorm/query-builder/JoinAttribute";

/*
 * PagedFind takes a page of a joined read in one query wherever one query
 * gives the same page: when every join returns at most one row for a
 * record, and when the read names one record by its primary key. Every
 * other read keeps TypeORM's two queries (the ids of the page, then their
 * rows). PagedFindPostgres.test.ts holds the pages to TypeORM's own on a
 * real database; these hold the plans, on a data source built from every
 * OneUptime model with no database:
 *
 *  - every relation of every model is a join that keeps one row per record
 *    exactly when it is a many-to-one, or the owning side of a one-to-one,
 *    on the related table's primary key - and every many-to-one OneUptime
 *    has joins on the primary key;
 *  - a read without joins, or with a to-many join, is left exactly as
 *    TypeORM builds it, SQL and all;
 *  - a read whose joins are all to-one pages in its own SQL, with LIMIT and
 *    OFFSET, and is otherwise TypeORM's SQL;
 *  - a read of a record by its primary key, at the first page, has no
 *    LIMIT and no second query, whatever it joins;
 *  - and none of that for a list of alternatives, a primary key matched by
 *    an operator, a later page, a take of 0 or a limit set by hand;
 *  - a repository that is not TypeORM's reads itself, with the options as
 *    given;
 *  - DatabaseService reads its pages through PagedFind.
 */

let dataSource: DataSource;

function repositoryOf<T extends ObjectLiteral>(target: {
  new (): T;
}): Repository<T> {
  return dataSource.getRepository<T>(target);
}

// The builder repository.find makes, as TypeORM itself makes it.
function typeOrmBuilder<T extends ObjectLiteral>(
  repository: Repository<T>,
  options: FindManyOptions<T>,
): SelectQueryBuilder<T> {
  return repository.manager
    .createQueryBuilder<T>(
      repository.metadata.target as never,
      repository.metadata.name,
    )
    .setFindOptions(options);
}

interface Plan {
  take: number | undefined;
  skip: number | undefined;
  limit: number | undefined;
  offset: number | undefined;
  sql: string;
}

function planOf<T extends ObjectLiteral>(builder: SelectQueryBuilder<T>): Plan {
  return {
    take: builder.expressionMap.take,
    skip: builder.expressionMap.skip,
    limit: builder.expressionMap.limit,
    offset: builder.expressionMap.offset,
    sql: builder.getQuery(),
  };
}

const MONITOR_ID: string = "7c8d9e0f-1a2b-4c3d-8e4f-5a6b7c8d9e0f";

beforeAll(async () => {
  dataSource = new DataSource({ type: "postgres", entities: Entities });
  await (
    dataSource as unknown as { buildMetadatas: () => Promise<void> }
  ).buildMetadatas();
});

afterAll(() => {
  // Nothing connected; nothing to close.
});

describe("which joins keep one row per record", () => {
  test("every relation of every model: to-one on the primary key, or not", () => {
    let toOne: number = 0;
    let toMany: number = 0;
    const misjudged: Array<string> = [];

    for (const metadata of dataSource.entityMetadatas) {
      for (const relation of metadata.relations) {
        const expected: boolean =
          relation.relationType === "many-to-one" ||
          (relation.relationType === "one-to-one" && relation.isOwning);

        const builder: SelectQueryBuilder<ObjectLiteral> =
          PagedFind.createQueryBuilder(
            dataSource.getRepository(metadata.target),
            {
              relations: { [relation.propertyName]: true },
              take: 10,
            } as FindManyOptions<ObjectLiteral>,
          );

        const isOneQuery: boolean =
          builder.expressionMap.take === undefined &&
          builder.expressionMap.limit === 10;

        if (isOneQuery !== expected) {
          misjudged.push(
            `${metadata.name}.${relation.propertyName} (${relation.relationType})`,
          );
        }

        if (expected) {
          toOne++;
        } else {
          toMany++;
        }
      }
    }

    expect(misjudged).toEqual([]);
    // OneUptime has thousands of each.
    expect(toOne).toBeGreaterThan(500);
    expect(toMany).toBeGreaterThan(100);
  });

  /*
   * OneUptime's models have many-to-one and many-to-many relations only, so
   * the kinds they lack are held on entities of this test's own: a
   * one-to-many, both sides of a one-to-one, and a many-to-one joined on a
   * unique column that is not the primary key (one row a record in fact,
   * but PagedFind only trusts the primary key).
   */
  test("relations of the kinds OneUptime's models do not use: to-one on the primary key, or not", async () => {
    const kinds: DataSource = new DataSource({
      type: "postgres",
      entities: [
        new EntitySchema<Record<string, unknown>>({
          name: "PagedParent",
          columns: {
            id: { type: "uuid", primary: true },
            code: { type: String, unique: true },
          },
          relations: {
            children: {
              type: "one-to-many",
              target: "PagedChild",
              inverseSide: "parent",
            },
          },
        }),
        new EntitySchema<Record<string, unknown>>({
          name: "PagedChild",
          columns: {
            id: { type: "uuid", primary: true },
          },
          relations: {
            parent: {
              type: "many-to-one",
              target: "PagedParent",
              joinColumn: { name: "parentId" },
            },
            parentByCode: {
              type: "many-to-one",
              target: "PagedParent",
              joinColumn: { name: "parentCode", referencedColumnName: "code" },
            },
          },
        }),
        new EntitySchema<Record<string, unknown>>({
          name: "PagedPerson",
          columns: { id: { type: "uuid", primary: true } },
          relations: {
            passport: {
              type: "one-to-one",
              target: "PagedPassport",
              joinColumn: { name: "passportId" },
              inverseSide: "person",
            },
          },
        }),
        new EntitySchema<Record<string, unknown>>({
          name: "PagedPassport",
          columns: { id: { type: "uuid", primary: true } },
          relations: {
            person: {
              type: "one-to-one",
              target: "PagedPerson",
              inverseSide: "passport",
            },
          },
        }),
      ],
    });

    await (
      kinds as unknown as { buildMetadatas: () => Promise<void> }
    ).buildMetadatas();

    const judged: Array<string> = [];

    for (const [entity, relation] of [
      ["PagedChild", "parent"],
      ["PagedChild", "parentByCode"],
      ["PagedParent", "children"],
      ["PagedPerson", "passport"],
      ["PagedPassport", "person"],
    ] as Array<[string, string]>) {
      const builder: SelectQueryBuilder<ObjectLiteral> =
        PagedFind.createQueryBuilder(kinds.getRepository(entity), {
          relations: { [relation]: true },
          take: 10,
        } as FindManyOptions<ObjectLiteral>);

      const join: JoinAttribute = builder.expressionMap.joinAttributes[0]!;
      const oneQuery: boolean =
        builder.expressionMap.take === undefined &&
        builder.expressionMap.limit === 10;

      expect(PagedFind.isOneRowPerRecordJoin(join)).toBe(oneQuery);
      judged.push(`${entity}.${relation}: ${oneQuery ? "one" : "two"}`);
    }

    expect(judged).toEqual([
      "PagedChild.parent: one",
      "PagedChild.parentByCode: two",
      "PagedParent.children: two",
      "PagedPerson.passport: one",
      "PagedPassport.person: two",
    ]);
  });

  test("every many-to-one OneUptime has joins on the related table's primary key", () => {
    const notOnPrimaryKey: Array<string> = [];

    for (const metadata of dataSource.entityMetadatas) {
      for (const relation of metadata.relations) {
        if (!relation.isManyToOne) {
          continue;
        }

        const onPrimaryKey: boolean =
          relation.joinColumns.length ===
            relation.inverseEntityMetadata.primaryColumns.length &&
          relation.joinColumns.every(
            (column: RelationMetadata["joinColumns"][number]): boolean => {
              return Boolean(column.referencedColumn?.isPrimary);
            },
          );

        if (!onPrimaryKey) {
          notOnPrimaryKey.push(`${metadata.name}.${relation.propertyName}`);
        }
      }
    }

    expect(notOnPrimaryKey).toEqual([]);
  });
});

describe("the plans PagedFind makes", () => {
  test("a read without joins is TypeORM's own, LIMIT and all", () => {
    const options: FindManyOptions<Monitor> = {
      where: { projectId: MONITOR_ID } as never,
      select: { _id: true, name: true } as never,
      order: { createdAt: "DESC", _id: "ASC" } as never,
      skip: 20,
      take: 10,
    };

    const typeOrm: Plan = planOf(
      typeOrmBuilder(repositoryOf(Monitor), options),
    );
    const paged: Plan = planOf(
      PagedFind.createQueryBuilder(repositoryOf(Monitor), options),
    );

    expect(paged).toEqual(typeOrm);
    expect(paged.sql).toContain("LIMIT 10 OFFSET 20");
  });

  test("a read whose joins are all to-one pages in its own SQL", () => {
    const options: FindManyOptions<MonitorProbe> = {
      where: { monitorId: MONITOR_ID } as never,
      select: {
        _id: true,
        probeId: true,
        probe: { name: true, connectionStatus: true },
      } as never,
      relations: { probe: true } as never,
      order: { createdAt: "DESC", _id: "ASC" } as never,
      skip: 20,
      take: 10,
    };

    const typeOrm: Plan = planOf(
      typeOrmBuilder(repositoryOf(MonitorProbe), options),
    );
    const paged: Plan = planOf(
      PagedFind.createQueryBuilder(repositoryOf(MonitorProbe), options),
    );

    // TypeORM pages it in two queries: take and skip, no LIMIT in its SQL.
    expect(typeOrm.take).toBe(10);
    expect(typeOrm.skip).toBe(20);
    expect(typeOrm.sql).not.toContain("LIMIT");

    // One query: the same SQL, paged by LIMIT and OFFSET.
    expect(paged.take).toBe(undefined);
    expect(paged.skip).toBe(undefined);
    expect(paged.limit).toBe(10);
    expect(paged.offset).toBe(20);
    expect(paged.sql).toBe(`${typeOrm.sql} LIMIT 10 OFFSET 20`);
  });

  test("a filter through a to-one relation keeps one row per record", () => {
    const options: FindManyOptions<Monitor> = {
      where: { project: { isBlocked: false } } as never,
      select: { _id: true } as never,
      take: 100,
      skip: 0,
    };

    const paged: Plan = planOf(
      PagedFind.createQueryBuilder(repositoryOf(Monitor), options),
    );

    expect(paged.take).toBe(undefined);
    expect(paged.limit).toBe(100);
    expect(paged.sql).toContain('LEFT JOIN "Project"');
    expect(paged.sql).toContain("LIMIT 100");
  });

  test("a read of a record by its primary key, joining what it likes, has no LIMIT", () => {
    const options: FindManyOptions<Monitor> = {
      where: { _id: MONITOR_ID } as never,
      select: {
        _id: true,
        name: true,
        labels: { _id: true, name: true },
        dependsOnMonitors: { _id: true },
      } as never,
      relations: { labels: true, dependsOnMonitors: true } as never,
      order: { createdAt: "DESC", _id: "ASC" } as never,
      skip: 0,
      take: 1,
    };

    const typeOrm: Plan = planOf(
      typeOrmBuilder(repositoryOf(Monitor), options),
    );
    const paged: Plan = planOf(
      PagedFind.createQueryBuilder(repositoryOf(Monitor), options),
    );

    expect(typeOrm.take).toBe(1);
    expect(paged.take).toBe(undefined);
    expect(paged.skip).toBe(undefined);
    expect(paged.limit).toBe(undefined);
    expect(paged.offset).toBe(undefined);
    // The rows of that one record: TypeORM's own SQL, and no page of it.
    expect(paged.sql).toBe(typeOrm.sql);
    expect(paged.sql).not.toContain("LIMIT");
  });

  test.each([
    [
      "a to-many join on a list",
      {
        where: { projectId: MONITOR_ID },
        relations: { labels: true },
        take: 10,
        skip: 0,
      },
    ],
    [
      "a filter through a to-many relation",
      {
        where: { monitors: { _id: MONITOR_ID } },
        take: 10,
        skip: 0,
      },
    ],
    [
      "to-one and to-many joins together",
      {
        where: { projectId: MONITOR_ID },
        relations: { currentIncidentState: true, labels: true },
        take: 10,
        skip: 0,
      },
    ],
    [
      "a primary key matched by an operator",
      {
        where: { _id: In([MONITOR_ID]) },
        relations: { labels: true },
        take: 1,
        skip: 0,
      },
    ],
    [
      "alternatives, one of them a primary key",
      {
        where: [{ _id: MONITOR_ID }, { projectId: MONITOR_ID }],
        relations: { labels: true },
        take: 1,
        skip: 0,
      },
    ],
    [
      "a later page of a record by its primary key",
      {
        where: { _id: MONITOR_ID },
        relations: { labels: true },
        take: 1,
        skip: 1,
      },
    ],
  ])(
    "%s is left as TypeORM builds it",
    (_label: string, options: Record<string, unknown>) => {
      const repository: Repository<Incident> = repositoryOf(Incident);

      const typeOrm: Plan = planOf(
        typeOrmBuilder(repository, options as FindManyOptions<Incident>),
      );
      const paged: Plan = planOf(
        PagedFind.createQueryBuilder(
          repository,
          options as FindManyOptions<Incident>,
        ),
      );

      expect(paged).toEqual(typeOrm);
      expect(paged.take).toBe(options["take"]);
    },
  );

  test("a take of 0 is left alone", () => {
    const options: FindManyOptions<MonitorProbe> = {
      relations: { probe: true } as never,
      take: 0,
      skip: 0,
    };

    expect(
      planOf(PagedFind.createQueryBuilder(repositoryOf(MonitorProbe), options)),
    ).toEqual(planOf(typeOrmBuilder(repositoryOf(MonitorProbe), options)));
  });

  test("a limit set by hand is left alone", () => {
    const builder: SelectQueryBuilder<MonitorProbe> = typeOrmBuilder(
      repositoryOf(MonitorProbe),
      { relations: { probe: true } as never, take: 10 },
    ).limit(5);

    PagedFind.takePageInOneQueryWherePossible(builder, {
      relations: { probe: true } as never,
      take: 10,
    });

    expect(builder.expressionMap.take).toBe(10);
    expect(builder.expressionMap.limit).toBe(5);
  });

  test("the primary key is named one way only", () => {
    const metadata: EntityMetadata = repositoryOf(Monitor).metadata;

    expect(
      PagedFind.namesOneRecordByPrimaryKey(metadata, {
        where: { _id: MONITOR_ID } as never,
      }),
    ).toBe(true);

    for (const where of [
      { _id: "" },
      { _id: In([MONITOR_ID]) },
      { _id: undefined },
      { projectId: MONITOR_ID },
      [{ _id: MONITOR_ID }],
      undefined,
    ]) {
      expect(
        PagedFind.namesOneRecordByPrimaryKey(metadata, {
          where: where as never,
        }),
      ).toBe(false);
    }

    expect(
      PagedFind.namesOneRecordByPrimaryKey(undefined, {
        where: { _id: MONITOR_ID } as never,
      }),
    ).toBe(false);
  });
});

describe("what reads through PagedFind", () => {
  test("a repository that is not TypeORM's reads itself, with the options as given", async () => {
    const asked: Array<unknown> = [];
    const standIn: Repository<Monitor> = {
      find: async (options: unknown): Promise<Array<Monitor>> => {
        asked.push(options);
        return [new Monitor()];
      },
    } as unknown as Repository<Monitor>;
    const options: FindManyOptions<Monitor> = {
      where: { _id: MONITOR_ID } as never,
      take: 1,
      skip: 0,
    };

    const found: Array<Monitor> = await PagedFind.find(standIn, options);

    expect(found).toHaveLength(1);
    expect(asked).toEqual([options]);
  });

  test("DatabaseService reads its pages through PagedFind, not repository.find", () => {
    // Read with its whitespace folded: prettier may break the call anywhere.
    const source: string = fs
      .readFileSync(
        path.join(__dirname, "../../../../Server/Services/DatabaseService.ts"),
        "utf8",
      )
      .split(/\s+/)
      .join("");

    expect(source).toContain("awaitPagedFind.find(this.getRepository(),{");
    expect(source).not.toContain("this.getRepository().find(");
  });
});
