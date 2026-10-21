import logger from "Common/Server/Utils/Logger";
import ProjectLeaveAccessCleanup from "Common/Server/Utils/TeamMember/ProjectLeaveAccessCleanup";
import RemoveProjectAccessOfFormerMembers from "../../../FeatureSet/Workers/DataMigrations/RemoveProjectAccessOfFormerMembers";
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
 * RemoveProjectAccessOfFormerMembers removes the MCP clients and the single
 * sign-on consent that people who left a project before leaving removed
 * them still hold there - exactly what leaving does today, for (project,
 * person) pairs with no accepted membership only. The walk itself is
 * ProjectLeaveAccessCleanup's, held by the Common suites and, on real rows,
 * by ProjectMembershipPostgres.
 *
 * Pinned here:
 *   1. it is registered in DataMigrations/Index.ts (as text - an unregistered
 *      migration never runs), once, after the notification settings walk and
 *      before the slot AddAuditLogMcpClientColumns keeps last;
 *   2. it runs the walk once and says what it removed;
 *   3. a failure to walk at all is not swallowed: the runner stops the chain
 *      and the migration runs again;
 *   4. rollback changes nothing.
 */

const MIGRATION_NAME: string = "RemoveProjectAccessOfFormerMembers";

const DATA_MIGRATIONS_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Workers/DataMigrations",
);

describe("RemoveProjectAccessOfFormerMembers", () => {
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
    // After the walk over notification settings, which shipped first.
    expect(registered.indexOf(MIGRATION_NAME)).toBeGreaterThan(
      registered.indexOf("RemoveNotificationSettingsOfFormerMembers"),
    );
  });

  test("has the name it is recorded under", () => {
    expect(new RemoveProjectAccessOfFormerMembers().name).toBe(MIGRATION_NAME);
  });

  test("walks the former members once and says what it removed", async () => {
    const walk: SpyInstance<
      typeof ProjectLeaveAccessCleanup.removeProjectAccessOfFormerMembers
    > = jest
      .spyOn(ProjectLeaveAccessCleanup, "removeProjectAccessOfFormerMembers")
      .mockResolvedValue({
        cleanedPairCount: 3,
        removedRowCount: 5,
        failedPairCount: 1,
      });

    await new RemoveProjectAccessOfFormerMembers().migrate();

    expect(walk).toHaveBeenCalledTimes(1);

    const log: string = infoLogs.join("\n");

    expect(log).toContain(
      "removed 5 connected MCP client and single sign-on consent row(s)",
    );
    expect(log).toContain("of 3 former project member(s)");
    expect(log).toContain("1 could not be fully removed");
  });

  test("nothing left behind: it says so and removes nothing", async () => {
    jest
      .spyOn(ProjectLeaveAccessCleanup, "removeProjectAccessOfFormerMembers")
      .mockResolvedValue({
        cleanedPairCount: 0,
        removedRowCount: 0,
        failedPairCount: 0,
      });

    await new RemoveProjectAccessOfFormerMembers().migrate();

    expect(infoLogs.join("\n")).toContain("removed 0 connected MCP client");
  });

  test("a failure to walk stops the chain rather than being swallowed", async () => {
    jest
      .spyOn(ProjectLeaveAccessCleanup, "removeProjectAccessOfFormerMembers")
      .mockRejectedValue(new Error("db down"));

    await expect(
      new RemoveProjectAccessOfFormerMembers().migrate(),
    ).rejects.toThrow("db down");
  });

  test("rollback changes nothing", async () => {
    const walk: SpyInstance<
      typeof ProjectLeaveAccessCleanup.removeProjectAccessOfFormerMembers
    > = jest.spyOn(
      ProjectLeaveAccessCleanup,
      "removeProjectAccessOfFormerMembers",
    );

    await new RemoveProjectAccessOfFormerMembers().rollback();

    expect(walk).not.toHaveBeenCalled();
  });
});
