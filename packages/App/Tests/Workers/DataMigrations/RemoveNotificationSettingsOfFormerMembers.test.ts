import logger from "Common/Server/Utils/Logger";
import ProjectLeaveNotificationCleanup from "Common/Server/Utils/TeamMember/ProjectLeaveNotificationCleanup";
import RemoveNotificationSettingsOfFormerMembers from "../../../FeatureSet/Workers/DataMigrations/RemoveNotificationSettingsOfFormerMembers";
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
 * RemoveNotificationSettingsOfFormerMembers removes the notification
 * settings people who left a project before leaving removed them still
 * hold there - exactly what leaving does today, for (project, person) pairs
 * with no accepted membership only. The walk itself is
 * ProjectLeaveNotificationCleanup's, held by the Common suites and, on real
 * rows, by ProjectMembershipPostgres.
 *
 * Pinned here:
 *   1. it is registered in DataMigrations/Index.ts (as text - an unregistered
 *      migration never runs), once, before the slot AddAuditLogMcpClientColumns
 *      keeps last;
 *   2. it runs the walk once and says what it removed;
 *   3. a failure to walk at all is not swallowed: the runner stops the chain
 *      and the migration runs again;
 *   4. rollback changes nothing.
 */

const MIGRATION_NAME: string = "RemoveNotificationSettingsOfFormerMembers";

const DATA_MIGRATIONS_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Workers/DataMigrations",
);

describe("RemoveNotificationSettingsOfFormerMembers", () => {
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

  test("is registered once, before the last slot", () => {
    const index: string = fs.readFileSync(
      path.join(DATA_MIGRATIONS_DIR, "Index.ts"),
      "utf8",
    );

    expect(index).toContain(
      `import ${MIGRATION_NAME} from "./${MIGRATION_NAME}";`,
    );

    const registered: Array<string> = Array.from(
      index.matchAll(/new ([A-Za-z0-9]+)\(\)/g),
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
  });

  test("has the name it is recorded under", () => {
    expect(new RemoveNotificationSettingsOfFormerMembers().name).toBe(
      MIGRATION_NAME,
    );
  });

  test("walks the former members once and says what it removed", async () => {
    const walk: SpyInstance<
      typeof ProjectLeaveNotificationCleanup.removePersonalNotificationSettingsOfFormerMembers
    > = jest
      .spyOn(
        ProjectLeaveNotificationCleanup,
        "removePersonalNotificationSettingsOfFormerMembers",
      )
      .mockResolvedValue({
        cleanedPairCount: 4,
        removedRowCount: 37,
        failedPairCount: 1,
      });

    await new RemoveNotificationSettingsOfFormerMembers().migrate();

    expect(walk).toHaveBeenCalledTimes(1);

    const log: string = infoLogs.join("\n");

    expect(log).toContain("removed 37 notification setting row(s)");
    expect(log).toContain("of 4 former project member(s)");
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
      new RemoveNotificationSettingsOfFormerMembers().migrate(),
    ).rejects.toThrow("db down");
  });

  test("rollback changes nothing", async () => {
    const walk: SpyInstance<
      typeof ProjectLeaveNotificationCleanup.removePersonalNotificationSettingsOfFormerMembers
    > = jest.spyOn(
      ProjectLeaveNotificationCleanup,
      "removePersonalNotificationSettingsOfFormerMembers",
    );

    await new RemoveNotificationSettingsOfFormerMembers().rollback();

    expect(walk).not.toHaveBeenCalled();
  });
});
