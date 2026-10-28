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
 *    createLimitOffsetExpression, where that gives the same page.
 *
 * Each is held to TypeORM's answers by its own suite. Those hold the TypeORM
 * that is installed; this holds TypeORM to the one they were written for. A
 * TypeORM upgrade that changes any of these functions fails here: read the
 * new function, change the piece that relies on it if it must, run its
 * suite (EntityMetadataLookup, QueryPropertyNames, PagedFindSql and
 * PagedFindPostgres), and then pin the new function's hash - and the new
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
 * through repository.find itself.
 */
describe("on any other TypeORM, the patches stand aside", () => {
  afterEach(() => {
    TypeOrmPatchVersion.setInstalledVersionForTests(undefined);
    jest.restoreAllMocks();
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
