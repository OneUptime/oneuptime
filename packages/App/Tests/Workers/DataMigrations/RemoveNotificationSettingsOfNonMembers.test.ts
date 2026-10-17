import logger from "Common/Server/Utils/Logger";
import ProjectLeaveNotificationCleanup from "Common/Server/Utils/TeamMember/ProjectLeaveNotificationCleanup";
import RemoveNotificationSettingsOfNonMembers from "../../../FeatureSet/Workers/DataMigrations/RemoveNotificationSettingsOfNonMembers";
import fs from "fs";
import path from "path";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * RemoveNotificationSettingsOfNonMembers removes the notification settings
 * people who are not members of a project hold there - added before a
 * person's own notification method, rule or setting had to be added by a
 * member of the project (CreatePermission.checkCreateInMemberProject). It
 * is the removal leaving a project makes, run for (project, person) pairs
 * with no accepted membership only: the walk of
 * ProjectLeaveNotificationCleanup, held by the Common suites and, on real
 * rows, by ProjectMembershipPostgres (members untouched, a person's other
 * project untouched, sent mail and the on-call history kept, a second run
 * finds nothing).
 *
 * Pinned here:
 *   1. it is registered in DataMigrations/Index.ts (as text - an unregistered
 *      migration never runs), once, after the walk's first run
 *      (RemoveNotificationSettingsOfFormerMembers), before the slot
 *      AddAuditLogMcpClientColumns keeps last;
 *   2. it runs the walk once and says what it removed;
 *   3. a failure to walk at all is not swallowed: the runner stops the chain
 *      and the migration runs again;
 *   4. rollback changes nothing.
 */

const MIGRATION_NAME: string = "RemoveNotificationSettingsOfNonMembers";

const REGISTERED_MIGRATION: RegExp = /new ([A-Za-z0-9]+)\(\)/g;

const DATA_MIGRATIONS_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Workers/DataMigrations",
);

describe("RemoveNotificationSettingsOfNonMembers", () => {
  let infoLogs: Array<string>;

  beforeEach(() => {
    infoLogs = [];

    jest.spyOn(logger, "info").mockImplementation((message: unknown): void => {
      infoLogs.push(String(message));
      return undefined;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("is registered once, after the walk's first run and before the last slot", () => {
    const index: string = fs.readFileSync(
      path.join(DATA_MIGRATIONS_DIR, "Index.ts"),
      "utf8",
    );

    expect(index).toContain(
      `import ${MIGRATION_NAME} from "./${MIGRATION_NAME}";`,
    );

    const registered: Array<string> = Array.from(
      index.matchAll(REGISTERED_MIGRATION),
    ).map((match: RegExpMatchArray): string => {
      return match[1]!;
    });

    expect(
      registered.filter((name: string): boolean => {
        return name === MIGRATION_NAME;
      }),
    ).toHaveLength(1);
    expect(registered[registered.length - 1]).toBe(
      "AddAuditLogMcpClientColumns",
    );
    expect(registered.indexOf(MIGRATION_NAME)).toBeLessThan(
      registered.length - 1,
    );
    expect(registered.indexOf(MIGRATION_NAME)).toBeGreaterThan(
      registered.indexOf("RemoveNotificationSettingsOfFormerMembers"),
    );
  });

  test("has the name it is recorded under, apart from the first run's", () => {
    expect(new RemoveNotificationSettingsOfNonMembers().name).toBe(
      MIGRATION_NAME,
    );
    expect(MIGRATION_NAME).not.toBe("RemoveNotificationSettingsOfFormerMembers");
  });

  test("walks the people who are not members once and says what it removed", async () => {
    const walk: SpyInstance<
      typeof ProjectLeaveNotificationCleanup.removePersonalNotificationSettingsOfFormerMembers
    > = jest
      .spyOn(
        ProjectLeaveNotificationCleanup,
        "removePersonalNotificationSettingsOfFormerMembers",
      )
      .mockResolvedValue({
        cleanedPairCount: 2,
        removedRowCount: 9,
        failedPairCount: 1,
      });

    await new RemoveNotificationSettingsOfNonMembers().migrate();

    expect(walk).toHaveBeenCalledTimes(1);

    const log: string = infoLogs.join("\n");

    expect(log).toContain("removed 9 notification setting row(s)");
    expect(log).toContain("of 2 person(s) who are not members");
    expect(log).toContain("1 could not be fully removed");
  });

  test("a failure to walk stops the chain rather than being swallowed", async () => {
    jest
      .spyOn(
        ProjectLeaveNotificationCleanup,
        "removePersonalNotificationSettingsOfFormerMembers",
      )
      .mockRejectedValue(new Error("db down"));

    await expect(
      new RemoveNotificationSettingsOfNonMembers().migrate(),
    ).rejects.toThrow("db down");
  });

  test("rollback changes nothing", async () => {
    const walk: SpyInstance<
      typeof ProjectLeaveNotificationCleanup.removePersonalNotificationSettingsOfFormerMembers
    > = jest.spyOn(
      ProjectLeaveNotificationCleanup,
      "removePersonalNotificationSettingsOfFormerMembers",
    );

    await new RemoveNotificationSettingsOfNonMembers().rollback();

    expect(walk).not.toHaveBeenCalled();
  });
});
