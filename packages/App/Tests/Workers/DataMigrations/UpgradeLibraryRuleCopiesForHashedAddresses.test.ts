import DetectionRuleLibraryUpgradeCopies from "Common/Server/Utils/SecurityEvent/DetectionRuleLibraryUpgradeCopies";
import logger from "Common/Server/Utils/Logger";
import {
  DETECTION_RULE_LIBRARY_UPGRADES,
  DetectionRuleLibraryUpgrade,
} from "Common/Types/SecurityEvent/DetectionRuleLibraryUpgrades";
import UpgradeLibraryRuleCopiesForHashedAddresses from "../../../FeatureSet/Workers/DataMigrations/UpgradeLibraryRuleCopiesForHashedAddresses";
import fs from "fs";
import path from "path";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * UpgradeLibraryRuleCopiesForHashedAddresses (#10773): a project's copy of
 * OpenStack failed logins burst, or of OpenStack admin credential used from
 * a new address, still as the library gave it, counts per principalIp - so
 * a sign-in whose address a Hash scrub rule hid is counted toward its real
 * address. What it upgrades, and what it leaves, is
 * DetectionRuleLibraryUpgradeCopies' (its own Common suite); here:
 *
 *   1. it is registered once, after the first upgrade of the library's
 *      copies, before the two slots kept last;
 *   2. the library's upgrades it gives include both OpenStack rules;
 *   3. it upgrades every copy and says how many; a failure fails the run,
 *      so the runner tries it again on the next boot; rollback changes
 *      nothing.
 */

const DATA_MIGRATIONS_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Workers/DataMigrations",
);

const MIGRATION_NAME: string = "UpgradeLibraryRuleCopiesForHashedAddresses";

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

afterEach(() => {
  jest.restoreAllMocks();
});

describe("UpgradeLibraryRuleCopiesForHashedAddresses", () => {
  test("is registered once, after the first upgrade of the library's copies, before the two slots kept last", () => {
    const registered: Array<string> = registeredMigrations();

    expect(
      registered.filter((name: string): boolean => {
        return name === MIGRATION_NAME;
      }),
    ).toHaveLength(1);
    expect(registered.indexOf(MIGRATION_NAME)).toBeGreaterThan(
      registered.indexOf("UpgradeLibraryRuleCopies"),
    );
    expect(registered.indexOf("UpgradeLibraryRuleCopies")).toBeGreaterThan(-1);
    expect(registered.slice(-2)).toEqual([
      "BackfillIncidentCallTranscriptSignInAccount",
      "AddAuditLogMcpClientColumns",
    ]);
    expect(new UpgradeLibraryRuleCopiesForHashedAddresses().name).toBe(
      MIGRATION_NAME,
    );
  });

  test("the upgrades it gives include both OpenStack rules that count per address", () => {
    const ids: Array<string> = DETECTION_RULE_LIBRARY_UPGRADES.map(
      (upgrade: DetectionRuleLibraryUpgrade): string => {
        return upgrade.id;
      },
    );

    // OpenStack failed logins burst, and admin credential used from a new address.
    expect(ids).toContain("6e7a4f92-2d3b-4b31-9a55-1f0c8e7d4a10");
    expect(ids).toContain("c94e1b77-8a26-4d57-b2f1-0ea3f6d81c22");
  });

  test("upgrades every copy, and says how many", async () => {
    const upgradeAll: SpyInstance<
      typeof DetectionRuleLibraryUpgradeCopies.upgradeAll
    > = jest
      .spyOn(DetectionRuleLibraryUpgradeCopies, "upgradeAll")
      .mockResolvedValue(3);
    const info: SpyInstance<typeof logger.info> = jest
      .spyOn(logger, "info")
      .mockImplementation((): void => {
        return undefined;
      });

    await new UpgradeLibraryRuleCopiesForHashedAddresses().migrate();

    expect(upgradeAll).toHaveBeenCalledTimes(1);
    expect(String(info.mock.calls[0]?.[0])).toBe(
      "UpgradeLibraryRuleCopiesForHashedAddresses: 3 copies of Rule Library rules were given the library's fix.",
    );
  });

  test("a failure fails the run, so it is run again on the next boot", async () => {
    jest
      .spyOn(DetectionRuleLibraryUpgradeCopies, "upgradeAll")
      .mockRejectedValue(new Error("Postgres is not reachable"));

    await expect(
      new UpgradeLibraryRuleCopiesForHashedAddresses().migrate(),
    ).rejects.toThrow("Postgres is not reachable");
  });

  test("rollback changes nothing", async () => {
    const upgradeAll: SpyInstance<
      typeof DetectionRuleLibraryUpgradeCopies.upgradeAll
    > = jest.spyOn(DetectionRuleLibraryUpgradeCopies, "upgradeAll");

    await new UpgradeLibraryRuleCopiesForHashedAddresses().rollback();

    expect(upgradeAll).not.toHaveBeenCalled();
  });
});
