import DetectionRuleLibraryUpgradeCopies from "Common/Server/Utils/SecurityEvent/DetectionRuleLibraryUpgradeCopies";
import logger from "Common/Server/Utils/Logger";
import UpgradeLibraryRuleCopies from "../../../FeatureSet/Workers/DataMigrations/UpgradeLibraryRuleCopies";
import fs from "fs";
import path from "path";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * UpgradeLibraryRuleCopies (#10427): a project's copy of a fixed Rule
 * Library rule, still word for word as it was added, gets the library's
 * fix - Burst of access-denied API calls leaves OneUptime's own reads out.
 * What it upgrades, and what it leaves, is DetectionRuleLibraryUpgradeCopies'
 * (its own Common suite); here:
 *
 *   1. it is registered once, before the two slots kept last;
 *   2. it upgrades every copy, and says how many;
 *   3. a failure fails the run, so the runner tries it again on the next
 *      boot; rollback changes nothing.
 */

const DATA_MIGRATIONS_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Workers/DataMigrations",
);

const MIGRATION_NAME: string = "UpgradeLibraryRuleCopies";

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

describe("UpgradeLibraryRuleCopies", () => {
  test("is registered once, before the two slots kept last", () => {
    const registered: Array<string> = registeredMigrations();

    expect(
      registered.filter((name: string): boolean => {
        return name === MIGRATION_NAME;
      }),
    ).toHaveLength(1);
    expect(registered.slice(-2)).toEqual([
      "BackfillIncidentCallTranscriptSignInAccount",
      "AddAuditLogMcpClientColumns",
    ]);
    expect(new UpgradeLibraryRuleCopies().name).toBe(MIGRATION_NAME);
  });

  test("upgrades every copy of a fixed library rule, and says how many", async () => {
    const upgradeAll: SpyInstance<
      typeof DetectionRuleLibraryUpgradeCopies.upgradeAll
    > = jest
      .spyOn(DetectionRuleLibraryUpgradeCopies, "upgradeAll")
      .mockResolvedValue(7);
    const info: SpyInstance<typeof logger.info> = jest
      .spyOn(logger, "info")
      .mockImplementation((): void => {
        return undefined;
      });

    await new UpgradeLibraryRuleCopies().migrate();

    expect(upgradeAll).toHaveBeenCalledTimes(1);
    expect(String(info.mock.calls[0]?.[0])).toBe(
      "UpgradeLibraryRuleCopies: 7 copies of Rule Library rules were given the library's fix.",
    );
  });

  test("a failure fails the run, so it is run again on the next boot", async () => {
    jest
      .spyOn(DetectionRuleLibraryUpgradeCopies, "upgradeAll")
      .mockRejectedValue(new Error("Postgres is not reachable"));

    await expect(new UpgradeLibraryRuleCopies().migrate()).rejects.toThrow(
      "Postgres is not reachable",
    );
  });

  test("rollback changes nothing", async () => {
    const upgradeAll: SpyInstance<
      typeof DetectionRuleLibraryUpgradeCopies.upgradeAll
    > = jest.spyOn(DetectionRuleLibraryUpgradeCopies, "upgradeAll");

    await new UpgradeLibraryRuleCopies().rollback();

    expect(upgradeAll).not.toHaveBeenCalled();
  });
});
