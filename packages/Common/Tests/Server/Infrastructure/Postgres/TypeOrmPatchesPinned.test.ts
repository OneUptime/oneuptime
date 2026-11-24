import Entities from "../../../../Models/DatabaseModels/Index";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import EntityMetadataLookup from "../../../../Server/Infrastructure/Postgres/EntityMetadataLookup";
import PagedFind from "../../../../Server/Infrastructure/Postgres/PagedFind";
import QueryPropertyNames from "../../../../Server/Infrastructure/Postgres/QueryPropertyNames";
import TypeOrmPatchVersion, {
  PATCHED_TYPEORM_VERSION,
} from "../../../../Server/Infrastructure/Postgres/TypeOrmPatchVersion";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import {
  DataSource,
  EntityManager,
  Repository,
  SelectQueryBuilder,
} from "typeorm";
import { JoinAttribute } from "typeorm/query-builder/JoinAttribute";

/*
 * THE TYPEORM CODE ONEUPTIME'S QUERY PATCHES WERE WRITTEN AGAINST.
 *
 * Three pieces of OneUptime stand in for, or lean on, TypeORM's own code:
 *
 *  - EntityMetadataLookup answers DataSource.findMetadata for a string from
 *    an index, as the function's walk answers it;
 *  - QueryPropertyNames does what QueryBuilder's
 *    replacePropertyNamesForTheWholeQuery does, with each entity's names
 *    read once;
 *  - PagedFind turns the two-query page of SelectQueryBuilder's
 *    executeEntitiesAndRawResults (taken when find options set skip or take
 *    and the read joins: applyFindOptions) into the one query of
 *    createLimitOffsetExpression, where that gives the same page; and, for
 *    a read whose to-many joins are only selected, reads the page's ids
 *    from the table itself and then runs TypeORM's own second query - the
 *    read with the ids appended as extraAppendedAndWhereCondition, which
 *    createWhereExpression appends;
 *  - CappedCount counts what TypeORM's count counts (computeCountExpression,
 *    executeCountQuery, on the builder EntityManager.count builds), in a
 *    subquery with a LIMIT;
 *  - PendingInviteeProfiles.orderAsTheReaderSees (#9895) replaces an order
 *    through a relation by a person's profile - which buildOrder writes as
 *    "<join alias>.<column>" - with a value it selects under an alias of
 *    its own, which createOrderByExpression and, in the two-query page,
 *    createOrderByCombinedWithSelectExpression order by. It is a privacy
 *    rule, not a shortcut, so on any other TypeORM it still applies, to the
 *    builder EntityManager.find builds (PendingInviteeOrderPostgres holds
 *    both).
 *
 * Each is held to TypeORM's answers by its own suite. Those hold the TypeORM
 * that is installed; this holds TypeORM to the one they were written for. A
 * TypeORM upgrade that changes any of these functions fails here: read the
 * new function, change the piece that relies on it if it must, run its
 * suite (EntityMetadataLookup, QueryPropertyNames, PagedFindSql,
 * PagedFindPostgres, CappedCountSql, CappedCountPostgres,
 * PendingInviteeOrder and PendingInviteeOrderPostgres), and then pin
 * the new function's hash - and the new
 * version both here and in TypeOrmPatchVersion, which the patches check in
 * production too: on any other TypeORM they stand aside (held below).
 */

function hashOf(code: unknown): string {
  return crypto.createHash("sha256").update(String(code)).digest("hex");
}

type Prototype = Record<string, unknown>;

const dataSourcePrototype: Prototype =
  DataSource.prototype as unknown as Prototype;
const selectPrototype: Prototype =
  SelectQueryBuilder.prototype as unknown as Prototype;

describe("the TypeORM functions OneUptime's query patches rely on", () => {
  test("TypeORM is the version the patches were written against", () => {
    const typeormPackage: { version: string } = JSON.parse(
      fs.readFileSync(
        path.join(path.dirname(require.resolve("typeorm")), "package.json"),
        "utf8",
      ),
    );

    expect(typeormPackage.version).toBe("0.3.31");
    // The version the patches check for themselves, moved with this pin.
    expect(PATCHED_TYPEORM_VERSION).toBe("0.3.31");
    expect(TypeOrmPatchVersion.getInstalledVersion()).toBe("0.3.31");
    expect(TypeOrmPatchVersion.isPatchedVersion()).toBe(true);
  });

  test.each([
    [
      "DataSource.findMetadata (EntityMetadataLookup)",
      (): unknown => {
        const installed: boolean = EntityMetadataLookup.isInstalled();
        EntityMetadataLookup.uninstall();
        const code: unknown = dataSourcePrototype["findMetadata"];

        if (installed) {
          EntityMetadataLookup.install();
        }

        return code;
      },
      "af3855923cc05bd5efcced5aca543db13b1bc523e12c8b04a3d6829736d718d0",
    ],
    [
      "QueryBuilder.replacePropertyNamesForTheWholeQuery (QueryPropertyNames)",
      (): unknown => {
        return QueryPropertyNames.getOriginal();
      },
      "0d9a0b42ac65d30052ad0260cf7f8377b776ecaa909719080bc4c8e6f4598721",
    ],
    [
      "SelectQueryBuilder.executeEntitiesAndRawResults (PagedFind)",
      (): unknown => {
        return selectPrototype["executeEntitiesAndRawResults"];
      },
      "dfaf9267eefba4b10553f24c03544ac16902b18e60cc8d9ed111e05dcdcaa70c",
    ],
    [
      "SelectQueryBuilder.applyFindOptions (PagedFind)",
      (): unknown => {
        return selectPrototype["applyFindOptions"];
      },
      "a797f647c7a4e7de2b1c83c602f38dafab41f9bbf7d563f37d5a1a0ba36eed41",
    ],
    [
      "SelectQueryBuilder.createLimitOffsetExpression (PagedFind)",
      (): unknown => {
        return selectPrototype["createLimitOffsetExpression"];
      },
      "0d8fe9b80758c31d8020854eff5c166fc32c97ecabb52d9905c483a8f10e7143",
    ],
    [
      "SelectQueryBuilder.createWhereExpression (PagedFind's ids condition)",
      (): unknown => {
        return selectPrototype["createWhereExpression"];
      },
      "741c59584ea497c1b3baece11458499fd28465217ad519ef479df16d2874020c",
    ],
    [
      "SelectQueryBuilder.computeCountExpression (CappedCount)",
      (): unknown => {
        return selectPrototype["computeCountExpression"];
      },
      "8be1fb73eaa4a62669a9e1df583983848862caf853417ad31922565ef774d29a",
    ],
    [
      "SelectQueryBuilder.executeCountQuery (CappedCount)",
      (): unknown => {
        return selectPrototype["executeCountQuery"];
      },
      "5200b114b965557726c1e80afeac4ad27bd291e448ce5c68458d992344286f36",
    ],
    [
      "EntityManager.count (CappedCount builds the query builder it builds)",
      (): unknown => {
        return (EntityManager.prototype as unknown as Prototype)["count"];
      },
      "a78aad98ce08c959018c39e1fa26c7f95b6e0756e0d7f90392c067f94cd8927b",
    ],
    [
      "EntityManager.find (PagedFind builds the query builder it builds)",
      (): unknown => {
        return (EntityManager.prototype as unknown as Prototype)["find"];
      },
      "7097de1646b7b9f7bd38981426d745bfc15ea4ff311e153198b7d1507b98556a",
    ],
    [
      "Repository.find (PagedFind stands in for it)",
      (): unknown => {
        return (Repository.prototype as unknown as Prototype)["find"];
      },
      "57ddad917dfdf9f2dd98bb6ea52d721c23fb32a0d7fd60a23d4d10ce908d4c83",
    ],
    [
      "JoinAttribute.relation (PagedFind reads each join's relation)",
      (): unknown => {
        return Object.getOwnPropertyDescriptor(
          JoinAttribute.prototype,
          "relation",
        )?.get;
      },
      "485bab8d8bffdecd10fb652538ab1b87059fc1f0046c73dd0a12002cfc563959",
    ],
    [
      "SelectQueryBuilder.buildOrder (PendingInviteeProfiles reads an order through a relation as '<join alias>.<column>')",
      (): unknown => {
        return selectPrototype["buildOrder"];
      },
      "521dee16316a119c00772fdeb660ed4e794e49f7b470a996900d757dd523a02a",
    ],
    [
      "SelectQueryBuilder.createOrderByExpression (PendingInviteeProfiles orders by a value it selects, by its alias)",
      (): unknown => {
        return selectPrototype["createOrderByExpression"];
      },
      "a7d93d44034eb176d2400b36f4e9e3c7bf21ae0c1f07d3fa4fbe5895c0f692e9",
    ],
    [
      "SelectQueryBuilder.createOrderByCombinedWithSelectExpression (the same, in TypeORM's two-query page)",
      (): unknown => {
        return selectPrototype["createOrderByCombinedWithSelectExpression"];
      },
      "da47af0873a6fbf5ff2273c8802459cc01b040540fc84cfdff9942b56a16b7d1",
    ],
  ])(
    "%s is the code the patch was written against",
    (_label: string, read: () => unknown, pinned: string) => {
      const code: unknown = read();

      expect(typeof code).toBe("function");
      expect(hashOf(code)).toBe(pinned);
    },
  );
});

/*
 * On a TypeORM other than the one they were written for, the patches stand
 * aside: neither install() replaces TypeORM's function, and PagedFind reads
 * through repository.find itself - or, for a read that hands an adjuster
 * (the order a reader may see, #9895), through the builder repository.find
 * builds, adjusted.
 */
describe("on any other TypeORM, the patches stand aside", () => {
  afterEach(() => {
    TypeOrmPatchVersion.setInstalledVersionForTests(undefined);
    jest.restoreAllMocks();
  });

  test("a read with an adjuster: the builder repository.find builds, adjusted, and none of PagedFind's own", async () => {
    TypeOrmPatchVersion.setInstalledVersionForTests("0.3.32");

    const dataSource: DataSource = new DataSource({
      type: "postgres",
      entities: Entities,
    });

    await (
      dataSource as unknown as { buildMetadatas: () => Promise<void> }
    ).buildMetadatas();

    const repository: Repository<Monitor> = dataSource.getRepository(Monitor);
    const find: ReturnType<typeof jest.spyOn> = jest.spyOn(repository, "find");
    const built: ReturnType<typeof jest.spyOn> = jest.spyOn(
      PagedFind,
      "createQueryBuilder",
    );
    const adjusted: Array<SelectQueryBuilder<Monitor>> = [];

    jest
      .spyOn(SelectQueryBuilder.prototype, "getMany")
      .mockResolvedValue([] as never);

    expect(
      await PagedFind.find(
        repository,
        { relations: { currentMonitorStatus: true }, take: 10 } as never,
        (queryBuilder: SelectQueryBuilder<any>): void => {
          adjusted.push(queryBuilder);
        },
      ),
    ).toEqual([]);

    expect(find).not.toHaveBeenCalled();
    expect(built).not.toHaveBeenCalled();
    expect(adjusted).toHaveLength(1);
    // As EntityManager.find builds it: its page left to TypeORM's two queries.
    expect(adjusted[0]!.expressionMap.take).toBe(10);
    expect(adjusted[0]!.expressionMap.limit).toBeUndefined();
  });

  test.each([["0.3.32"], ["0.4.0"], [null]])(
    "TypeORM %s: TypeORM's own functions, and repository.find",
    async (version: string | null) => {
      const lookupInstalled: boolean = EntityMetadataLookup.isInstalled();
      const namesInstalled: boolean = QueryPropertyNames.isInstalled();
      const findMetadata: unknown = dataSourcePrototype["findMetadata"];

      EntityMetadataLookup.uninstall();
      QueryPropertyNames.uninstall();
      const typeOrmFindMetadata: unknown = dataSourcePrototype["findMetadata"];
      const typeOrmReplace: unknown = QueryPropertyNames.getOriginal();

      try {
        TypeOrmPatchVersion.setInstalledVersionForTests(version);
        expect(TypeOrmPatchVersion.isPatchedVersion()).toBe(false);

        EntityMetadataLookup.install();
        QueryPropertyNames.install();

        expect(EntityMetadataLookup.isInstalled()).toBe(false);
        expect(QueryPropertyNames.isInstalled()).toBe(false);
        expect(dataSourcePrototype["findMetadata"]).toBe(typeOrmFindMetadata);
        expect(
          (SelectQueryBuilder.prototype as unknown as Prototype)[
            "replacePropertyNamesForTheWholeQuery"
          ],
        ).toBe(typeOrmReplace);

        const dataSource: DataSource = new DataSource({
          type: "postgres",
          entities: Entities,
        });

        await (
          dataSource as unknown as { buildMetadatas: () => Promise<void> }
        ).buildMetadatas();

        const repository: Repository<Monitor> =
          dataSource.getRepository(Monitor);
        const find: ReturnType<typeof jest.spyOn> = jest
          .spyOn(repository, "find")
          .mockResolvedValue([] as never);
        const built: ReturnType<typeof jest.spyOn> = jest.spyOn(
          PagedFind,
          "createQueryBuilder",
        );
        const options: Record<string, unknown> = {
          relations: { currentMonitorStatus: true },
          take: 10,
        };

        expect(await PagedFind.find(repository, options as never)).toEqual([]);
        expect(find).toHaveBeenCalledWith(options);
        expect(built).not.toHaveBeenCalled();
      } finally {
        TypeOrmPatchVersion.setInstalledVersionForTests(undefined);
        EntityMetadataLookup.uninstall();
        QueryPropertyNames.uninstall();

        if (lookupInstalled) {
          EntityMetadataLookup.install();
        }

        if (namesInstalled) {
          QueryPropertyNames.install();
        }
      }

      expect(dataSourcePrototype["findMetadata"]).toBe(
        lookupInstalled ? findMetadata : typeOrmFindMetadata,
      );
    },
  );

  test("on the TypeORM they were written for, they install, and PagedFind builds its own query", async () => {
    const lookupInstalled: boolean = EntityMetadataLookup.isInstalled();
    const namesInstalled: boolean = QueryPropertyNames.isInstalled();

    try {
      EntityMetadataLookup.uninstall();
      QueryPropertyNames.uninstall();
      EntityMetadataLookup.install();
      QueryPropertyNames.install();

      expect(EntityMetadataLookup.isInstalled()).toBe(true);
      expect(QueryPropertyNames.isInstalled()).toBe(true);

      const dataSource: DataSource = new DataSource({
        type: "postgres",
        entities: Entities,
      });

      await (
        dataSource as unknown as { buildMetadatas: () => Promise<void> }
      ).buildMetadatas();

      const repository: Repository<Monitor> = dataSource.getRepository(Monitor);
      const find: ReturnType<typeof jest.spyOn> = jest.spyOn(
        repository,
        "find",
      );
      const getMany: ReturnType<typeof jest.fn> = jest
        .fn()
        .mockResolvedValue([] as never);

      jest
        .spyOn(PagedFind, "createQueryBuilder")
        .mockReturnValue({ getMany: getMany } as never);

      expect(await PagedFind.find(repository, { take: 10 } as never)).toEqual(
        [],
      );
      expect(getMany).toHaveBeenCalledTimes(1);
      expect(find).not.toHaveBeenCalled();
    } finally {
      EntityMetadataLookup.uninstall();
      QueryPropertyNames.uninstall();

      if (lookupInstalled) {
        EntityMetadataLookup.install();
      }

      if (namesInstalled) {
        QueryPropertyNames.install();
      }
    }
  });
});
