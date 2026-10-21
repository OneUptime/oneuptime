import { beforeEach, describe, expect, test } from "@jest/globals";
import TeamMemberService from "Common/Server/Services/TeamMemberService";
import logger from "Common/Server/Utils/Logger";
import AcceptPendingTeamInvitationsOfProjectMembers from "../../../FeatureSet/Workers/DataMigrations/AcceptPendingTeamInvitationsOfProjectMembers";
import fs from "fs";
import path from "path";

/*
 * Accepting a project invitation became per project, not per team. Members
 * of a project still have the per-team invitations they were sent before
 * that, for teams of the project they are already in. This data migration
 * accepts exactly those, through
 * TeamMemberService.acceptPendingInvitationsOfProjectMembers.
 *
 * Pinned here: it is registered after everything before it, runs the
 * service's backfill once, reports what it did, and lets a failure reach the
 * runner so it is not recorded as done. Which rows the backfill accepts is
 * pinned against a real database by TeamMemberInvitationAcceptancePostgres
 * in Common.
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

const MIGRATION_NAME: string = "AcceptPendingTeamInvitationsOfProjectMembers";

const DATA_MIGRATIONS_DIR: string = path.join(
  __dirname,
  "../../../FeatureSet/Workers/DataMigrations",
);

describe("AcceptPendingTeamInvitationsOfProjectMembers", () => {
  const migration: AcceptPendingTeamInvitationsOfProjectMembers =
    new AcceptPendingTeamInvitationsOfProjectMembers();

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

    test("is imported and instantiated once in DataMigrations/Index.ts", () => {
      expect(indexSource).toContain(
        `import ${MIGRATION_NAME} from "./${MIGRATION_NAME}";`,
      );
      expect(
        registeredMigrations().filter((name: string): boolean => {
          return name === MIGRATION_NAME;
        }),
      ).toHaveLength(1);
    });

    // The runner decides what to run by position: appended after the rest.
    test("was appended after the incident custom field backfill", () => {
      const instantiations: Array<string> = registeredMigrations();

      expect(instantiations.indexOf(MIGRATION_NAME)).toBe(
        instantiations.indexOf("BackfillIncidentCustomFieldVariableKeys") + 1,
      );
    });

    test("carries its own name, the key the migration runner records as executed", () => {
      expect(migration.name).toBe(MIGRATION_NAME);
    });
  });

  describe("migrate", () => {
    test("runs the service's backfill once and reports how many invitations it accepted", async () => {
      const backfill: jest.SpyInstance = jest
        .spyOn(TeamMemberService, "acceptPendingInvitationsOfProjectMembers")
        .mockResolvedValue(3);

      await migration.migrate();

      expect(backfill).toHaveBeenCalledTimes(1);

      const info: jest.Mock = logger.info as unknown as jest.Mock;
      expect(String(info.mock.calls[0]![0])).toContain("accepted 3 ");
    });

    test("a run with nothing left to accept still completes", async () => {
      jest
        .spyOn(TeamMemberService, "acceptPendingInvitationsOfProjectMembers")
        .mockResolvedValue(0);

      await expect(migration.migrate()).resolves.toBeUndefined();

      const info: jest.Mock = logger.info as unknown as jest.Mock;
      expect(String(info.mock.calls[0]![0])).toContain("accepted 0 ");
    });

    test("a failure reaches the runner, so it is not recorded as done", async () => {
      jest
        .spyOn(TeamMemberService, "acceptPendingInvitationsOfProjectMembers")
        .mockRejectedValue(new Error("canceling statement due to timeout"));

      await expect(migration.migrate()).rejects.toThrow(
        "canceling statement due to timeout",
      );
    });

    test("rollback has nothing to undo", async () => {
      await expect(migration.rollback()).resolves.toBeUndefined();
    });
  });
});
