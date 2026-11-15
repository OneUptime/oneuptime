import Entities from "../../../../Models/DatabaseModels/Index";
import Alert from "../../../../Models/DatabaseModels/Alert";
import Incident from "../../../../Models/DatabaseModels/Incident";
import CappedCount from "../../../../Server/Infrastructure/Postgres/CappedCount";
import TypeOrmPatchVersion from "../../../../Server/Infrastructure/Postgres/TypeOrmPatchVersion";
import {
  afterEach,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  DataSource,
  FindManyOptions,
  In,
  ObjectLiteral,
  Raw,
  Repository,
  SelectQueryBuilder,
} from "typeorm";

/*
 * A CAPPED COUNT COUNTS THE READ'S OWN RECORDS, NO FURTHER THAN IT NEEDS.
 *
 * CappedCount wraps TypeORM's own count query - the same filter, joins and
 * deleted rows (SelectQueryBuilder.executeCountQuery) - in a subquery with
 * LIMIT upTo + 1, and counts its rows: a record each when the read joins
 * nothing (TypeORM's COUNT(1)), each record's primary key once when it
 * joins (TypeORM's COUNT(DISTINCT pk)). These hold the SQL, on a data
 * source built from every OneUptime model with no database;
 * CappedCountPostgres.test.ts holds the answers to repository.count's on a
 * real Postgres.
 */

let dataSource: DataSource;

const PROJECT_ID: string = "2b3c4d5e-6f7a-4b8c-9d0e-1f2a3b4c5d6e";

function repositoryOf<T extends ObjectLiteral>(target: {
  new (): T;
}): Repository<T> {
  return dataSource.getRepository<T>(target);
}

beforeAll(async () => {
  dataSource = new DataSource({ type: "postgres", entities: Entities });
  await (
    dataSource as unknown as { buildMetadatas: () => Promise<void> }
  ).buildMetadatas();
});

afterEach(() => {
  TypeOrmPatchVersion.setInstalledVersionForTests(undefined);
  jest.restoreAllMocks();
});

describe("the capped count's query", () => {
  test("a read that joins nothing: its records, no further than upTo + 1, counted", () => {
    const builder: SelectQueryBuilder<ObjectLiteral> =
      CappedCount.createQueryBuilder(
        repositoryOf(Alert),
        { where: { projectId: PROJECT_ID } as never },
        10000,
      );

    const [sql, parameters] = builder.getQueryAndParameters();

    expect(sql).toBe(
      `SELECT COUNT(*) AS "cnt" FROM (SELECT 1 AS "counted" FROM "Alert" "Alert" WHERE ( (("Alert"."projectId" = $1)) ) AND ( "Alert"."deletedAt" IS NULL ) LIMIT 10001) "counted_records"`,
    );
    expect(parameters).toEqual([PROJECT_ID]);
  });

  test("a read that joins to many: each record's primary key once", () => {
    const sql: string = CappedCount.createQueryBuilder(
      repositoryOf(Incident),
      {
        where: {
          projectId: PROJECT_ID,
          labels: { _id: In(["00000000-0000-4000-8000-000000000001"]) },
        } as never,
      },
      500,
    ).getQuery();

    expect(sql).toContain(
      'SELECT COUNT(*) AS "cnt" FROM (SELECT DISTINCT "Incident"."_id" AS "counted" FROM "Incident" "Incident" LEFT JOIN "IncidentLabel"',
    );
    expect(sql).toContain('LIMIT 501) "counted_records"');
  });

  test("counts what TypeORM's own count counts: COUNT(1) with no join, COUNT(DISTINCT pk) with one", () => {
    for (const [options, typeOrmCounts, cappedSelects] of [
      [{ where: { projectId: PROJECT_ID } }, "COUNT(1)", "1"],
      [
        { where: { projectId: PROJECT_ID, labels: { name: "Production" } } },
        'COUNT(DISTINCT("Incident"."_id"))',
        'DISTINCT "Incident"."_id"',
      ],
      [
        {
          where: {
            projectId: PROJECT_ID,
            currentIncidentState: { isResolvedState: false },
          },
        },
        'COUNT(DISTINCT("Incident"."_id"))',
        'DISTINCT "Incident"."_id"',
      ],
    ] as Array<[FindManyOptions<Incident>, string, string]>) {
      const repository: Repository<Incident> = repositoryOf(Incident);
      const readBuilder: SelectQueryBuilder<Incident> = repository.manager
        .createQueryBuilder<Incident>(Incident, "Incident")
        .setFindOptions(options);

      expect(
        (
          readBuilder as unknown as { computeCountExpression: () => string }
        ).computeCountExpression(),
      ).toBe(typeOrmCounts);
      expect(CappedCount.getCountedSelection(readBuilder)).toBe(cappedSelects);
    }
  });

  test("keeps the read's own filter, deleted rows and raw conditions, and drops its order and page", () => {
    const sql: string = CappedCount.createQueryBuilder(
      repositoryOf(Alert),
      {
        where: {
          projectId: PROJECT_ID,
          isPrivate: Raw((alias: string): string => {
            return `(${alias} IS NULL OR ${alias} = FALSE)`;
          }),
        } as never,
        withDeleted: true,
        order: { createdAt: "DESC" } as never,
        skip: 40,
        take: 20,
      },
      1,
    ).getQuery();

    expect(sql).toContain(
      '("Alert"."isPrivate" IS NULL OR "Alert"."isPrivate" = FALSE)',
    );
    expect(sql).not.toContain("deletedAt");
    expect(sql).not.toContain("ORDER BY");
    expect(sql).not.toContain("OFFSET");
    expect(sql).toContain("LIMIT 2)");
  });

  test.each([[0], [-1], [1.5], [Number.NaN], [Infinity]])(
    "refuses to count up to %p",
    (upTo: number) => {
      expect(() => {
        CappedCount.createQueryBuilder(
          repositoryOf(Alert),
          { where: { projectId: PROJECT_ID } as never },
          upTo,
        );
      }).toThrow(/whole number of records of at least 1/);
    },
  );
});

describe("what a capped count answers", () => {
  test("the number the count query gives, as a number", async () => {
    const repository: Repository<Alert> = repositoryOf(Alert);

    for (const [cnt, expected] of [
      ["10001", 10001],
      ["0", 0],
      [7, 7],
      [undefined, 0],
    ] as Array<[unknown, number]>) {
      jest.restoreAllMocks();
      jest
        .spyOn(SelectQueryBuilder.prototype, "getRawOne")
        .mockResolvedValue(
          cnt === undefined ? (undefined as never) : ({ cnt: cnt } as never),
        );

      expect(
        await CappedCount.count(
          repository,
          { where: { projectId: PROJECT_ID } as never },
          10000,
        ),
      ).toBe(expected);
    }
  });

  test("on any other TypeORM, or a repository that is not TypeORM's: the exact count", async () => {
    const standIn: Repository<Alert> = {
      count: async (): Promise<number> => {
        return 123456;
      },
    } as unknown as Repository<Alert>;

    expect(await CappedCount.count(standIn, {}, 10)).toBe(123456);

    TypeOrmPatchVersion.setInstalledVersionForTests("0.4.0");

    const repository: Repository<Alert> = repositoryOf(Alert);
    const count: ReturnType<typeof jest.spyOn> = jest
      .spyOn(repository, "count")
      .mockResolvedValue(98765 as never);

    expect(await CappedCount.count(repository, { where: {} }, 10)).toBe(98765);
    expect(count).toHaveBeenCalledTimes(1);
  });
});

describe("DatabaseService counts through it when asked for a cap", () => {
  test("countBy's upTo reads CappedCount; without it, repository.count as before", () => {
    // Read with its whitespace folded: prettier may break the call anywhere.
    const source: string = fs
      .readFileSync(
        path.join(__dirname, "../../../../Server/Services/DatabaseService.ts"),
        "utf8",
      )
      .split(/\s+/)
      .join("");

    expect(source).toContain("}elseif(upTo!==undefined){");
    expect(source).toContain(
      "count=awaitCappedCount.count(this.getRepository(),{where:findBy.queryasany},upTo,);}else{count=awaitthis.getRepository().count({",
    );
  });
});
