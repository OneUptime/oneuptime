import { beforeEach, describe, expect, test } from "@jest/globals";
import WorkspaceNotificationSummaryService from "Common/Server/Services/WorkspaceNotificationSummaryService";
import logger from "Common/Server/Utils/Logger";
import SetWorkspaceSummaryTimezones from "../../../FeatureSet/Workers/DataMigrations/SetWorkspaceSummaryTimezones";
import fs from "fs";
import path from "path";

/*
 * Workspace summaries have a time zone now (schema migration
 * 1798900000000-AddWorkspaceSummaryTimezone), and their schedule is read on
 * its clock, so a summary set for 09:00 goes out at 09:00 after the clocks
 * change. This data migration gives every summary made before that its
 * creator's time zone - the clock the dashboard showed its creator - and UTC
 * to one with no creator with a time zone, which is what it has been read
 * in all along. It writes only the time zone, never a next send
 * (WorkspaceNotificationSummaryService.fillTimezonesFromCreators, whose
 * behaviour has its own suite in Common).
 *
 * Pinned here: it is registered once, before the slot
 * AddAuditLogMcpClientColumns keeps last; it runs the backfill and reports
 * what it did; a failure reaches the runner (which then stops the chain and
 * retries on the next deploy) instead of being recorded as done.
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

const MIGRATION_NAME: string = "SetWorkspaceSummaryTimezones";

const DATA_MIGRATIONS_DIR: string = path.join(
  __dirname,
  "../../../FeatureSet/Workers/DataMigrations",
);

describe("SetWorkspaceSummaryTimezones", () => {
  const migration: SetWorkspaceSummaryTimezones =
    new SetWorkspaceSummaryTimezones();

  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  describe("registration", () => {
    function registeredMigrations(): Array<string> {
      const index: string = fs
        .readFileSync(path.join(DATA_MIGRATIONS_DIR, "Index.ts"), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, " ")
        .replace(/(^|[^:])\/\/[^\n]*/g, "$1");

      return Array.from(index.matchAll(/new ([A-Za-z0-9]+)\(\)/g)).map(
        (match: RegExpMatchArray): string => {
          return match[1]!;
        },
      );
    }

    test("is imported in DataMigrations/Index.ts", () => {
      expect(
        fs.readFileSync(path.join(DATA_MIGRATIONS_DIR, "Index.ts"), "utf8"),
      ).toContain(`import ${MIGRATION_NAME} from "./${MIGRATION_NAME}";`);
    });

    test("is registered once, before the slot AddAuditLogMcpClientColumns keeps last", () => {
      const registered: Array<string> = registeredMigrations();

      expect(
        registered.filter((name: string): boolean => {
          return name === MIGRATION_NAME;
        }),
      ).toHaveLength(1);
      expect(registered[registered.length - 1]).toBe(
        "AddAuditLogMcpClientColumns",
      );
      expect(registered.indexOf(MIGRATION_NAME)).toBeGreaterThanOrEqual(0);
      expect(registered.indexOf(MIGRATION_NAME)).toBeLessThan(
        registered.length - 1,
      );
    });

    test("carries its own name, the key the migration runner records as executed", () => {
      expect(migration.name).toBe(MIGRATION_NAME);
    });

    test("runs on every deployment: it is Postgres-only", () => {
      expect(migration.runsInClusterMode()).toBe(true);
    });
  });

  describe("migrate", () => {
    test("runs the backfill once and reports what it gave", async () => {
      const backfill: jest.SpyInstance = jest
        .spyOn(WorkspaceNotificationSummaryService, "fillTimezonesFromCreators")
        .mockResolvedValue({ fromCreator: 12, utc: 3 });

      await migration.migrate();

      expect(backfill).toHaveBeenCalledTimes(1);

      const info: jest.Mock = logger.info as unknown as jest.Mock;
      const message: string = String(info.mock.calls[0]![0]);
      expect(message).toContain("12");
      expect(message).toContain("3");
      expect(message).toContain("creator's time zone");
      expect(message).toContain("UTC");
    });

    test("a failure reaches the runner, so it is not recorded as done", async () => {
      jest
        .spyOn(WorkspaceNotificationSummaryService, "fillTimezonesFromCreators")
        .mockRejectedValue(new Error("connection terminated"));

      await expect(migration.migrate()).rejects.toThrow(
        "connection terminated",
      );
    });

    test("rollback leaves the time zones alone", async () => {
      const backfill: jest.SpyInstance = jest.spyOn(
        WorkspaceNotificationSummaryService,
        "fillTimezonesFromCreators",
      );

      await expect(migration.rollback()).resolves.toBeUndefined();
      expect(backfill).not.toHaveBeenCalled();
    });
  });
});
