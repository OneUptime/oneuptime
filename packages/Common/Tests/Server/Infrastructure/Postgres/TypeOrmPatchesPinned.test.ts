import EntityMetadataLookup from "../../../../Server/Infrastructure/Postgres/EntityMetadataLookup";
import QueryPropertyNames from "../../../../Server/Infrastructure/Postgres/QueryPropertyNames";
import { describe, expect, test } from "@jest/globals";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { DataSource, SelectQueryBuilder } from "typeorm";

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
 * PagedFindPostgres), and then pin the new function's hash.
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
  ])(
    "%s is the code the patch was written against",
    (_label: string, read: () => unknown, pinned: string) => {
      const code: unknown = read();

      expect(typeof code).toBe("function");
      expect(hashOf(code)).toBe(pinned);
    },
  );
});
