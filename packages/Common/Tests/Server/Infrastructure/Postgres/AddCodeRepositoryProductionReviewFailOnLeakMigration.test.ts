import { AddCodeRepositoryProductionReviewFailOnLeak1809187440200 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809187440200-AddCodeRepositoryProductionReviewFailOnLeak";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import CodeRepository from "../../../../Models/DatabaseModels/CodeRepository";
import TableColumnType from "../../../../Types/Database/TableColumnType";
import { MigrationInterface, QueryRunner } from "typeorm";
import fs from "fs";
import path from "path";
import { describe, expect, test } from "@jest/globals";

/*
 * The migration behind a repository's Fail the Check on a Leak switch
 * (CodeRepository.isProductionReviewFailOnLeakEnabled, #10376): one
 * nullable boolean, with nothing to backfill - empty is off, and every
 * production review's check stays neutral, as it always was, until a
 * repository turns it on. Statements are recorded against a fake
 * QueryRunner.
 */

const TRAILING_TIMESTAMP: RegExp = /(\d{13})$/;

type MigrationClass = new () => MigrationInterface;

async function record(
  migration: MigrationInterface,
  direction: "up" | "down",
): Promise<Array<string>> {
  const steps: Array<string> = [];
  const runner: QueryRunner = {
    isTransactionActive: false,
    query: async (sql: string): Promise<void> => {
      steps.push(sql);
    },
  } as unknown as QueryRunner;

  if (direction === "up") {
    await migration.up(runner);
  } else {
    await migration.down(runner);
  }

  return steps;
}

function timestampOf(migration: MigrationClass): number {
  const match: RegExpMatchArray | null =
    migration.name.match(TRAILING_TIMESTAMP);

  return match ? parseInt(match[1]!, 10) : 0;
}

describe("the Fail the Check on a Leak migration", () => {
  test("names itself after its timestamp", () => {
    expect(
      new AddCodeRepositoryProductionReviewFailOnLeak1809187440200().name,
    ).toBe("AddCodeRepositoryProductionReviewFailOnLeak1809187440200");
  });

  test("is registered once, after every migration before it", () => {
    const registered: Array<MigrationClass> =
      SchemaMigrations as Array<MigrationClass>;
    const at: number = registered.indexOf(
      AddCodeRepositoryProductionReviewFailOnLeak1809187440200,
    );

    expect(at).toBeGreaterThan(0);
    expect(
      registered.filter((candidate: MigrationClass): boolean => {
        return (
          candidate === AddCodeRepositoryProductionReviewFailOnLeak1809187440200
        );
      }),
    ).toHaveLength(1);

    for (let before: number = 0; before < at; before++) {
      expect(timestampOf(registered[before]!)).toBeLessThan(
        timestampOf(AddCodeRepositoryProductionReviewFailOnLeak1809187440200),
      );
    }
  });

  test("is backed by exactly one file", () => {
    const files: Array<string> = fs.readdirSync(
      path.join(
        __dirname,
        "../../../../Server/Infrastructure/Postgres/SchemaMigrations",
      ),
    );

    expect(
      files.filter((file: string): boolean => {
        return file.startsWith(
          `${timestampOf(AddCodeRepositoryProductionReviewFailOnLeak1809187440200)}-`,
        );
      }),
    ).toHaveLength(1);
  });

  test("adds the switch, nullable, with nothing to backfill - and down takes it away", async () => {
    expect(
      await record(
        new AddCodeRepositoryProductionReviewFailOnLeak1809187440200(),
        "up",
      ),
    ).toEqual([
      `ALTER TABLE "CodeRepository" ADD "isProductionReviewFailOnLeakEnabled" boolean`,
    ]);
    expect(
      await record(
        new AddCodeRepositoryProductionReviewFailOnLeak1809187440200(),
        "down",
      ),
    ).toEqual([
      `ALTER TABLE "CodeRepository" DROP COLUMN "isProductionReviewFailOnLeakEnabled"`,
    ]);
  });
});

describe("the repository's Fail the Check on a Leak switch", () => {
  const repository: CodeRepository = new CodeRepository();

  test("is a boolean nobody has to set, read and written as the repository's other review switch is", () => {
    const column: ReturnType<CodeRepository["getTableColumnMetadata"]> =
      repository.getTableColumnMetadata("isProductionReviewFailOnLeakEnabled");
    const reviewSwitch: ReturnType<CodeRepository["getTableColumnMetadata"]> =
      repository.getTableColumnMetadata("isProductionReviewEnabled");

    expect(column.type).toBe(TableColumnType.Boolean);
    expect(column.required).toBeFalsy();
    expect(column.title).toBe("Fail the Check on a Leak");
    expect(
      repository.getColumnAccessControlFor(
        "isProductionReviewFailOnLeakEnabled",
      ),
    ).toEqual(
      repository.getColumnAccessControlFor("isProductionReviewEnabled"),
    );
    expect(reviewSwitch.type).toBe(TableColumnType.Boolean);
  });
});
