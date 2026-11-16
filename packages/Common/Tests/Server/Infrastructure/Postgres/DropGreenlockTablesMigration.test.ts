import { DropGreenlockTables1809182470000 } from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/1809182470000-DropGreenlockTables";
import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import Models from "../../../../Models/DatabaseModels/Index";
import DatabaseBaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { QueryRunner } from "typeorm";

/*
 * DropGreenlockTables1809182470000 drops the two tables of the Greenlock
 * store ACME certificates replaced in April 2024 (#8990):
 * "GreenlockCertificate", whose blobs held the ACME account's and each
 * domain's private keys on every installation from before then, and
 * "GreenlockChallenge". Nothing read them but one data migration; keys
 * nobody uses are safest gone.
 *
 * Pinned here:
 *
 *   - it is registered once, after every migration before it;
 *   - up() drops exactly those two tables, if they exist, in one statement,
 *     inside the migration's transaction - so under SchemaMigrationRunner it
 *     waits at most the migration lock wait for its locks, rolls back and is
 *     tried again (the drop locks "User" for an instant: both tables' keys
 *     point at it);
 *   - down() makes the tables again as the last migrations that changed
 *     them left them: timestamps with their time zone, the key index, the
 *     token index, and both keys to "User" setting null on delete;
 *   - their models and services are gone from the entities the app and the
 *     schema drift check read, so nothing makes them again, and nothing
 *     reads them: the data migrations that did read nothing of them now.
 *
 * DropGreenlockTablesPostgres runs it against a real Postgres.
 */

const MIGRATION_DIRECTORY: string = path.join(
  __dirname,
  "../../../../Server/Infrastructure/Postgres/SchemaMigrations",
);

const MIGRATION_FILE: string = path.join(
  MIGRATION_DIRECTORY,
  "1809182470000-DropGreenlockTables.ts",
);

const WORKERS_DATA_MIGRATIONS: string = path.join(
  __dirname,
  "../../../../../App/FeatureSet/Workers/DataMigrations",
);

const TABLES: Array<string> = ["GreenlockCertificate", "GreenlockChallenge"];

// What a data migration that still read the tables would name.
const NAMES_A_GREENLOCK_SERVICE: RegExp =
  /GreenlockCertificateService|GreenlockChallengeService/;
const IMPORTS_A_GREENLOCK_MODEL: RegExp =
  /from "Common\/Models\/DatabaseModels\/Greenlock/;

// A query runner that records each statement, as a migration runs it.
function recordingRunner(): { runner: QueryRunner; statements: Array<string> } {
  const statements: Array<string> = [];

  const runner: QueryRunner = {
    query: async (statement: string): Promise<unknown> => {
      statements.push(statement);
      return [];
    },
  } as unknown as QueryRunner;

  return { runner, statements };
}

function tableNameOf(model: { new (): DatabaseBaseModel }): string {
  return new model().tableName || "";
}

describe("DropGreenlockTables1809182470000", () => {
  test("has the name it is recorded under, the one its file and class give", () => {
    const migration: DropGreenlockTables1809182470000 =
      new DropGreenlockTables1809182470000();

    expect(migration.name).toBe("DropGreenlockTables1809182470000");
    expect(fs.existsSync(MIGRATION_FILE)).toBe(true);
  });

  test("is registered once, after every migration before it", () => {
    const names: Array<string> = SchemaMigrations.map(
      (migration: { name: string }): string => {
        return migration.name;
      },
    );

    expect(
      names.filter((name: string): boolean => {
        return name === "DropGreenlockTables1809182470000";
      }),
    ).toHaveLength(1);

    const index: number = names.indexOf("DropGreenlockTables1809182470000");
    const timestampOf: (name: string) => number = (name: string): number => {
      return Number(name.match(/(\d{13})$/)?.[1] || 0);
    };

    for (const earlier of names.slice(0, index)) {
      expect([earlier, timestampOf(earlier) < 1809182470000]).toEqual([
        earlier,
        true,
      ]);
    }
  });

  test("up() drops exactly the two Greenlock tables, if they exist, in one statement", async () => {
    const { runner, statements } = recordingRunner();

    await new DropGreenlockTables1809182470000().up(runner);

    expect(statements).toEqual([
      `DROP TABLE IF EXISTS "GreenlockChallenge", "GreenlockCertificate"`,
    ]);
  });

  test("up() names no table but the two, and drops nothing in cascade", async () => {
    const { runner, statements } = recordingRunner();

    await new DropGreenlockTables1809182470000().up(runner);

    const named: Array<string> = Array.from(
      statements.join(" ").matchAll(/"([A-Za-z]+)"/g),
    ).map((match: RegExpMatchArray): string => {
      return match[1]!;
    });

    expect(named.sort()).toEqual([...TABLES].sort());
    expect(statements.join(" ")).not.toMatch(/CASCADE/i);
  });

  test("runs in the migration's transaction, so a lock wait rolls it back to be tried again", () => {
    const source: string = fs.readFileSync(MIGRATION_FILE, "utf8");
    const migration: DropGreenlockTables1809182470000 & {
      transaction?: boolean;
    } = new DropGreenlockTables1809182470000();

    expect(migration.transaction).toBeUndefined();
    expect(source).not.toMatch(/transaction\s*(:\s*boolean\s*)?=\s*false/);
  });

  test("down() makes both tables again as the last migrations left them", async () => {
    const { runner, statements } = recordingRunner();

    await new DropGreenlockTables1809182470000().down(runner);

    const all: string = statements.join("\n");

    for (const table of TABLES) {
      expect(all).toContain(`CREATE TABLE IF NOT EXISTS "${table}"`);
    }

    // 1727193702212, 1727194211048 and 1727194579925 gave them time zones.
    expect(all).not.toMatch(/TIMESTAMP(?! WITH TIME ZONE)/);
    expect(all.match(/TIMESTAMP WITH TIME ZONE/g)).toHaveLength(6);

    // The InitialMigration's keys and indexes, by their names.
    for (const name of [
      "PK_f7a338910a034c62b3efa5aa701",
      "PK_e2685e2af35bad33efc615c365c",
      "IDX_d47fcf292f2ceae490da8404d8",
      "IDX_36dde33ab3f3fefb63cb164c7d",
      "IDX_8358adfc13448a58e30a799f6e",
      "FK_895b9b802ed002a3804136bacf1",
      "FK_7517f5a285255f031b0f6d9663c",
    ]) {
      expect([name, all.includes(name)]).toEqual([name, true]);
    }

    // 1727103023745 made both keys set null when their user is deleted.
    expect(all.match(/ON DELETE SET NULL/g)).toHaveLength(2);
    expect(all).not.toContain("ON DELETE CASCADE");
  });

  test("the keys down() writes are the ones the earlier migrations wrote last", () => {
    const history: string = fs.readFileSync(
      path.join(MIGRATION_DIRECTORY, "1727103023745-MigrationName.ts"),
      "utf8",
    );
    const up: string = history.slice(0, history.indexOf("public async down"));

    for (const key of [
      `ALTER TABLE "GreenlockCertificate" ADD CONSTRAINT "FK_895b9b802ed002a3804136bacf1" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
      `ALTER TABLE "GreenlockChallenge" ADD CONSTRAINT "FK_7517f5a285255f031b0f6d9663c" FOREIGN KEY ("deletedByUserId") REFERENCES "User"("_id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    ]) {
      expect(up).toContain(key);
      expect(fs.readFileSync(MIGRATION_FILE, "utf8")).toContain(key);
    }
  });

  test("no model or service names the tables any more, so nothing makes them again", () => {
    const tables: Array<string> = (
      Models as Array<{ new (): DatabaseBaseModel }>
    ).map(tableNameOf);

    for (const table of TABLES) {
      expect([table, tables.includes(table)]).toEqual([table, false]);
    }

    const services: string = fs.readFileSync(
      path.join(__dirname, "../../../../Server/Services/Index.ts"),
      "utf8",
    );

    expect(services).not.toMatch(/Greenlock(Certificate|Challenge)Service/);

    for (const file of [
      "../../../../Models/DatabaseModels/GreenlockCertificate.ts",
      "../../../../Models/DatabaseModels/GreenlockChallenge.ts",
      "../../../../Server/Services/GreenlockCertificateService.ts",
      "../../../../Server/Services/GreenlockChallengeService.ts",
    ]) {
      expect([file, fs.existsSync(path.join(__dirname, file))]).toEqual([
        file,
        false,
      ]);
    }
  });

  test("the data migrations read nothing of the tables: the schema migration drops them before any data migration runs", () => {
    for (const file of [
      "MoveGreenlockCertsToAcmeCerts.ts",
      "EncryptLetsEncryptKeys.ts",
    ]) {
      const source: string = fs.readFileSync(
        path.join(WORKERS_DATA_MIGRATIONS, file),
        "utf8",
      );

      expect([file, NAMES_A_GREENLOCK_SERVICE.test(source)]).toEqual([
        file,
        false,
      ]);
      expect([file, IMPORTS_A_GREENLOCK_MODEL.test(source)]).toEqual([
        file,
        false,
      ]);
    }
  });

  test("what MoveGreenlockCertsToAcmeCerts did is the certificate sweeps' job: a domain marked ordered with no certificate is ordered again", () => {
    const service: string = fs.readFileSync(
      path.join(
        __dirname,
        "../../../../Server/Services/StatusPageDomainService.ts",
      ),
      "utf8",
    );
    const checkOrderStatus: string = service.slice(
      service.indexOf("public async checkOrderStatus"),
    );

    expect(checkOrderStatus).toContain("isSslOrdered: true");
    expect(checkOrderStatus).toContain("orderCertIfMissing");

    const statusPageCerts: string = fs.readFileSync(
      path.join(
        __dirname,
        "../../../../../App/FeatureSet/Workers/Jobs/StatusPageCerts/StatusPageCerts.ts",
      ),
      "utf8",
    );

    expect(statusPageCerts).toContain(
      "StatusPageDomainService.checkOrderStatus()",
    );
  });
});
