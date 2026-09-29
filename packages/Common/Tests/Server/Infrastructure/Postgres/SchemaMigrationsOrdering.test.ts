import SchemaMigrations from "../../../../Server/Infrastructure/Postgres/SchemaMigrations/Index";
import { MigrationInterface } from "typeorm";
import fs from "fs";
import path from "path";
import { describe, expect, test } from "@jest/globals";

/*
 * The ordering guard for the migration registry.
 *
 * TypeORM runs migrations in the order this array lists them, and records each
 * one by class name. Two things can go wrong when a migration is added, and
 * neither one announces itself — the schema simply diverges on some
 * installations and not others:
 *
 *   1. the new migration runs BEFORE one that is already deployed. Existing
 *      installations have already recorded the older migration, so the new one
 *      still runs last for them, while a fresh install runs it in the listed
 *      position. The two databases end up different.
 *   2. two migrations share a timestamp, so the file a class belongs to is
 *      ambiguous and the pairing between name and file can silently swap.
 *
 * `generate-postgres-migration` stamps a WALL-CLOCK timestamp, while the
 * recent migrations here use hand-picked round numbers that already run ahead
 * of wall clock — so a freshly generated file lands BELOW several registered
 * migrations unless somebody renumbers it. That is case 1, and it is the
 * likely one.
 *
 * This guard is deliberately written against the registry as a whole rather
 * than against whichever migration happens to be newest, so that adding a
 * migration never requires editing (or hand-carrying) the guard itself.
 *
 * Note it does NOT assert the whole array is sorted. It is not: a handful of
 * historical entries were registered out of timestamp order years ago and have
 * long since run everywhere, so renumbering them now would re-run them. What
 * is asserted is the part that is still live — the newest entry must sort
 * above everything already registered.
 */

const MIGRATION_DIRECTORY: string = path.join(
  __dirname,
  "../../../../Server/Infrastructure/Postgres/SchemaMigrations",
);

/*
 * The very first migration predates the convention and carries no timestamp in
 * its class name. It is first in the array and can never be last, so it is
 * simply excluded rather than special-cased in every assertion below.
 */
const UNTIMESTAMPED_MIGRATION_NAME: string = "InitialMigration";

const INITIAL_MIGRATION_TIMESTAMP: number = 1717605043663;

/*
 * Timestamps that two migrations already share, and always will.
 *
 * `AddNetworkDeviceAutoImportRule1789100000000` and
 * `AddUserTwoFactorBackupCode1789100000000` were authored in parallel, both
 * picked the same round slot (the hazard the timestamps in this directory are
 * hand-picked rather than wall-clock), and both shipped before anyone noticed.
 *
 * Renaming either one now would re-run it. TypeORM records a migration by
 * name, so a renamed class reads as one that has never executed — and both of
 * these CREATE a table with no IF NOT EXISTS, so the re-run fails against
 * every database that already has it. The collision is therefore permanent
 * history, not a fixable defect, and the assertions below step around it while
 * still failing for a NEW one.
 *
 * The exception names the two classes, so it cannot quietly grow: a third
 * migration on the same stamp is not one of them and fails the duplicate
 * guard, and dropping either migration leaves the exception naming a class
 * that is no longer registered, which fails too.
 */
const SHIPPED_DUPLICATE_MIGRATIONS: ReadonlyArray<{
  timestamp: number;
  classNames: ReadonlyArray<string>;
}> = [
  {
    timestamp: 1789100000000,
    classNames: [
      "AddNetworkDeviceAutoImportRule1789100000000",
      "AddUserTwoFactorBackupCode1789100000000",
    ],
  },
  /*
   * And it happened again, the same way: these two were authored on separate
   * branches, both reached for the next round slot, and both merged to master
   * before either author saw the other. They are on master now, so the
   * paragraph above applies to them unchanged — renaming either re-runs it,
   * and AddTelemetryExceptionErrorClass adds NOT NULL columns whose re-run
   * fails against a database that already has them.
   *
   * The recurrence is the argument for picking the next slot by looking at
   * the directory immediately before committing, not when you start work.
   */
  {
    timestamp: 1790900000000,
    classNames: [
      "AddEnterpriseLicenseUsageProvenance1790900000000",
      "AddTelemetryExceptionErrorClass1790900000000",
    ],
  },
];

/*
 * The exception is written as the exact pair of classes that share the stamp,
 * not as the bare number, so it excuses those two and nothing else. Excusing
 * the number would have excused a THIRD migration landing on it — a brand new
 * collision, waved through by the exception made for the old one.
 */
const SHIPPED_DUPLICATE_TIMESTAMPS: ReadonlyArray<number> =
  SHIPPED_DUPLICATE_MIGRATIONS.map(
    (duplicate: { timestamp: number }): number => {
      return duplicate.timestamp;
    },
  );

const TIMESTAMPED_FILE: RegExp = new RegExp("^\\d+-");

type MigrationClass = new () => MigrationInterface;

type TimestampOfFunction = (migrationClass: MigrationClass) => number | null;

const timestampOf: TimestampOfFunction = (
  migrationClass: MigrationClass,
): number | null => {
  const match: RegExpMatchArray | null = migrationClass.name.match(/(\d+)$/);
  return match ? Number(match[1]) : null;
};

const registered: Array<MigrationClass> =
  SchemaMigrations as Array<MigrationClass>;

describe("the migration registry", () => {
  /*
   * Math.max() of an empty list is -Infinity and every assertion below would
   * pass vacuously against one. Prove the import actually produced a registry
   * before leaning on anything derived from it.
   */
  test("is actually populated, so nothing below passes vacuously", () => {
    expect(registered.length).toBeGreaterThan(100);
  });

  test("names every migration after its timestamp, bar the first one", () => {
    const untimestamped: Array<string> = registered
      .filter((migrationClass: MigrationClass): boolean => {
        return timestampOf(migrationClass) === null;
      })
      .map((migrationClass: MigrationClass): string => {
        return migrationClass.name;
      });

    expect(untimestamped).toEqual([UNTIMESTAMPED_MIGRATION_NAME]);
  });

  describe("ordering", () => {
    /*
     * The guard that used to be hand-carried from one migration's test to the
     * next. Whoever adds a migration adds it to the end of the array, and this
     * is what says the timestamp has to match that position.
     */
    test("gives the last-registered migration the highest timestamp", () => {
      const last: MigrationClass = registered[registered.length - 1]!;
      const lastTimestamp: number | null = timestampOf(last);

      expect(lastTimestamp).not.toBeNull();

      const earlierTimestamps: Array<number> = registered
        .slice(0, -1)
        .map(timestampOf)
        .filter((timestamp: number | null): timestamp is number => {
          return timestamp !== null;
        });

      expect(earlierTimestamps.length).toBe(registered.length - 2);

      /*
       * If this fails, the migration at the end of SchemaMigrations/Index.ts
       * carries a timestamp that sorts below one already registered — rename
       * the new migration's file and class to a timestamp above the current
       * maximum, rather than moving it up the array.
       */
      expect(lastTimestamp).toBeGreaterThan(Math.max(...earlierTimestamps));
    });

    test("never registers the same timestamp twice", () => {
      const timestamps: Array<number> = registered
        .map(timestampOf)
        .filter((timestamp: number | null): timestamp is number => {
          return timestamp !== null;
        });

      const duplicates: Array<number> = timestamps
        .filter((timestamp: number, index: number): boolean => {
          return timestamps.indexOf(timestamp) !== index;
        })
        /*
         * A collision that has already shipped cannot be undone — see
         * SHIPPED_DUPLICATE_TIMESTAMPS. A new one still fails here, which is
         * the only case this assertion can actually do anything about.
         */
        .filter((timestamp: number): boolean => {
          return !SHIPPED_DUPLICATE_TIMESTAMPS.includes(timestamp);
        });

      expect(duplicates).toEqual([]);
    });

    /*
     * Keeps the exception list honest. Every entry has to name a collision
     * that is really there, so the day one of those migrations is deleted its
     * entry goes with it — and nobody can quietly widen the list to wave a new
     * collision through, because a wrong entry fails right here.
     */
    test("grandfathers exactly the collisions that exist, and no more", () => {
      const names: Array<string> = registered.map(
        (migrationClass: MigrationClass): string => {
          return migrationClass.name;
        },
      );

      for (const duplicate of SHIPPED_DUPLICATE_MIGRATIONS) {
        const onThisTimestamp: Array<string> = registered
          .filter((migrationClass: MigrationClass): boolean => {
            return timestampOf(migrationClass) === duplicate.timestamp;
          })
          .map((migrationClass: MigrationClass): string => {
            return migrationClass.name;
          })
          .sort();

        /*
         * Both halves matter. Naming a class that is no longer registered
         * means the exception has outlived the collision and must go; finding
         * a class the exception does not name means a NEW migration has
         * landed on the shipped stamp, which is the very thing the duplicate
         * guard exists to catch.
         */
        expect(onThisTimestamp).toEqual([...duplicate.classNames].sort());

        for (const className of duplicate.classNames) {
          expect(names).toContain(className);
        }
      }
    });

    test("never registers the same migration class twice", () => {
      const names: Array<string> = registered.map(
        (migrationClass: MigrationClass): string => {
          return migrationClass.name;
        },
      );

      const duplicates: Array<string> = names.filter(
        (name: string, index: number): boolean => {
          return names.indexOf(name) !== index;
        },
      );

      expect(duplicates).toEqual([]);
    });
  });

  /*
   * ...and the timestamps in the class names are the ones on disk. A class
   * renamed without renaming its file — or two files landing on the same
   * timestamp — leaves the ordering above asserting something that is not what
   * actually runs.
   */
  test("backs every registered migration with exactly one file on disk", () => {
    const files: Array<string> = fs.readdirSync(MIGRATION_DIRECTORY);

    const unbacked: Array<string> = registered
      .filter((migrationClass: MigrationClass): boolean => {
        const timestamp: number | null = timestampOf(migrationClass);

        if (timestamp === null) {
          return false;
        }

        /*
         * One file per registered class, which for every timestamp but the
         * grandfathered collision means exactly one file. For that one it
         * means two — both classes are real, both have a file, and neither can
         * be renamed. See SHIPPED_DUPLICATE_TIMESTAMPS.
         */
        const grandfathered:
          | { timestamp: number; classNames: ReadonlyArray<string> }
          | undefined = SHIPPED_DUPLICATE_MIGRATIONS.find(
          (duplicate: { timestamp: number }): boolean => {
            return duplicate.timestamp === timestamp;
          },
        );

        /*
         * One file per registered class, which for every timestamp but the
         * grandfathered collision means exactly one file. For that one it
         * means exactly as many files as the exception names — a fixed
         * number, never the live count, so an unexpected third file on that
         * stamp fails here rather than being counted and excused.
         */
        const expectedFileCount: number = grandfathered
          ? grandfathered.classNames.length
          : 1;

        return (
          files.filter((file: string): boolean => {
            return file.startsWith(`${timestamp}-`);
          }).length !== expectedFileCount
        );
      })
      .map((migrationClass: MigrationClass): string => {
        return migrationClass.name;
      });

    expect(unbacked).toEqual([]);
  });

  /*
   * The other direction: a migration file that nobody registered never runs at
   * all. That is the failure mode with no symptom until a query hits a column
   * that was never created.
   *
   * The registered side is read out of the exported array rather than out of
   * Index.ts, so a file that is imported but never added to the array — which
   * is exactly as inert as one that is not imported at all — still fails here.
   */
  test("registers every migration file that exists on disk", () => {
    const registeredTimestamps: Set<number> = new Set(
      registered
        .map(timestampOf)
        .filter((timestamp: number | null): timestamp is number => {
          return timestamp !== null;
        }),
    );

    /*
     * The one file whose class name carries no timestamp, so it cannot be
     * matched by the timestamps above.
     */
    registeredTimestamps.add(INITIAL_MIGRATION_TIMESTAMP);

    const timestampsOnDisk: Array<string> = fs
      .readdirSync(MIGRATION_DIRECTORY)
      .filter((file: string): boolean => {
        return file.endsWith(".ts") && TIMESTAMPED_FILE.test(file);
      })
      .map((file: string): string => {
        return file.split("-")[0]!;
      });

    expect(timestampsOnDisk.length).toBeGreaterThan(100);

    const unregistered: Array<string> = timestampsOnDisk.filter(
      (timestamp: string): boolean => {
        return !registeredTimestamps.has(Number(timestamp));
      },
    );

    expect(unregistered).toEqual([]);
  });
});
