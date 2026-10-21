import { beforeEach, describe, expect, test } from "@jest/globals";
import StatusPageSubscriberService from "Common/Server/Services/StatusPageSubscriberService";
import logger from "Common/Server/Utils/Logger";
import BackfillStatusPageSubscriberUnsubscribeColumns from "../../../FeatureSet/Workers/DataMigrations/BackfillStatusPageSubscriberUnsubscribeColumns";
import fs from "fs";
import path from "path";

/*
 * Existing status page subscribers get their unsubscribe token (and, when a
 * teammate added them, Is Added By Team) from this data migration, not from
 * the schema migrations that added the columns: there an UPDATE of every row
 * would hold ADD COLUMN's exclusive lock on the table for as long as it took,
 * and fail the deploy on a large table at the connection's statement timeout.
 *
 * Pinned here: it is registered, it runs the batched backfill, and a failure
 * reaches the runner (which then stops the chain and retries on the next
 * deploy) instead of being recorded as done. The backfill's SQL is exercised
 * against Postgres by Common's StatusPageSubscriberUnsubscribePostgres suite.
 */
jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
  };
});

const MIGRATION_NAME: string = "BackfillStatusPageSubscriberUnsubscribeColumns";

const DATA_MIGRATIONS_DIR: string = path.join(
  __dirname,
  "../../../FeatureSet/Workers/DataMigrations",
);

describe("BackfillStatusPageSubscriberUnsubscribeColumns", () => {
  const migration: BackfillStatusPageSubscriberUnsubscribeColumns =
    new BackfillStatusPageSubscriberUnsubscribeColumns();

  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  describe("registration", () => {
    const indexSource: string = fs.readFileSync(
      path.join(DATA_MIGRATIONS_DIR, "Index.ts"),
      "utf8",
    );

    function registeredMigrations(): Array<string> {
      return Array.from(indexSource.matchAll(/new\s+(\w+)\(\)/g)).map(
        (match: RegExpMatchArray) => {
          return match[1]!;
        },
      );
    }

    test("is imported and instantiated in DataMigrations/Index.ts", () => {
      expect(indexSource).toContain(
        `import ${MIGRATION_NAME} from "./${MIGRATION_NAME}";`,
      );
      expect(indexSource).toContain(`new ${MIGRATION_NAME}()`);
    });

    /*
     * The runner decides what to run by position. Pinned is the index this
     * migration was appended at; appending later migrations leaves it alone,
     * inserting one above it does not.
     */
    const REGISTERED_POSITION: number = 117;

    test("was appended at the end of the list, and keeps that position", () => {
      const instantiations: Array<string> = registeredMigrations();

      expect(instantiations.indexOf(MIGRATION_NAME)).toBe(REGISTERED_POSITION);
      expect(instantiations.length).toBeGreaterThan(REGISTERED_POSITION);
    });

    test("is registered exactly once", () => {
      expect(
        registeredMigrations().filter((name: string): boolean => {
          return name === MIGRATION_NAME;
        }).length,
      ).toBe(1);
    });

    test("carries its own name, the key the migration runner records as executed", () => {
      expect(migration.name).toBe(MIGRATION_NAME);
    });

    test("runs on every deployment: it is Postgres-only", () => {
      expect(migration.runsInClusterMode()).toBe(true);
    });
  });

  describe("migrate", () => {
    test("runs the batched backfill and reports what it filled", async () => {
      const backfill: jest.SpyInstance = jest
        .spyOn(StatusPageSubscriberService, "backfillUnsubscribeColumns")
        .mockResolvedValue({ tokensGiven: 1200, markedAddedByTeam: 35 });

      await migration.migrate();

      expect(backfill).toHaveBeenCalledTimes(1);
      // The service's default batch: no statement touches more than a batch of rows.
      expect(backfill).toHaveBeenCalledWith();

      const info: jest.Mock = logger.info as unknown as jest.Mock;
      expect(String(info.mock.calls[0]![0])).toContain("1200");
      expect(String(info.mock.calls[0]![0])).toContain("35");
    });

    test("a failure reaches the runner, so it is not recorded as done", async () => {
      jest
        .spyOn(StatusPageSubscriberService, "backfillUnsubscribeColumns")
        .mockRejectedValue(
          new Error("canceling statement due to lock timeout"),
        );

      await expect(migration.migrate()).rejects.toThrow(
        "canceling statement due to lock timeout",
      );
    });

    test("rollback leaves the filled columns alone", async () => {
      const backfill: jest.SpyInstance = jest.spyOn(
        StatusPageSubscriberService,
        "backfillUnsubscribeColumns",
      );

      await expect(migration.rollback()).resolves.toBeUndefined();
      expect(backfill).not.toHaveBeenCalled();
    });
  });
});
