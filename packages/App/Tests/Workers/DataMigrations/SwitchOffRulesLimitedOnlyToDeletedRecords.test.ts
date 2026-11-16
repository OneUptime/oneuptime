import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { SpyInstance } from "jest-mock";
import RuleEmptiedLimits from "Common/Server/Utils/Rules/RuleEmptiedLimits";
import SwitchOffRulesLimitedOnlyToDeletedRecords from "../../../FeatureSet/Workers/DataMigrations/SwitchOffRulesLimitedOnlyToDeletedRecords";
import fs from "fs";
import path from "path";

/*
 * SwitchOffRulesLimitedOnlyToDeletedRecords (#9066): on an existing install,
 * the rules whose lists hold only soft-deleted records - which they read as
 * empty, matching every record - are switched off, as a delete now does.
 * What it finds and writes is RuleEmptiedLimits', run against a real
 * Postgres in RuleEmptiedLimitsPostgres (the repair: only those rules, never
 * one saved empty on purpose, and nothing on a second run). Pinned here: it
 * runs that repair, says how many it switched off, undoes nothing, and is
 * registered once, before the slot AddAuditLogMcpClientColumns keeps last.
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

const MIGRATION_NAME: string = "SwitchOffRulesLimitedOnlyToDeletedRecords";

const DATA_MIGRATIONS_DIR: string = path.join(
  __dirname,
  "../../../FeatureSet/Workers/DataMigrations",
);

function registeredMigrations(): Array<string> {
  const index: string = fs.readFileSync(
    path.join(DATA_MIGRATIONS_DIR, "Index.ts"),
    "utf8",
  );

  expect(index).toContain(
    `import ${MIGRATION_NAME} from "./${MIGRATION_NAME}";`,
  );

  return Array.from(
    index.replace(/\/\*[\s\S]*?\*\//g, " ").matchAll(/new ([A-Za-z0-9]+)\(\)/g),
  ).map((match: RegExpMatchArray): string => {
    return match[1]!;
  });
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("SwitchOffRulesLimitedOnlyToDeletedRecords", () => {
  test("is named for itself and runs on every install", () => {
    const migration: SwitchOffRulesLimitedOnlyToDeletedRecords =
      new SwitchOffRulesLimitedOnlyToDeletedRecords();

    expect(migration.name).toBe(MIGRATION_NAME);
    // Postgres only: nothing in it is ClickHouse's.
    expect(migration.runsInClusterMode()).toBe(true);
  });

  test("is registered once, before the slot AddAuditLogMcpClientColumns keeps last", () => {
    const names: Array<string> = registeredMigrations();

    expect(
      names.filter((name: string): boolean => {
        return name === MIGRATION_NAME;
      }),
    ).toHaveLength(1);
    expect(names[names.length - 1]).toBe("AddAuditLogMcpClientColumns");
    expect(names.indexOf(MIGRATION_NAME)).toBe(names.length - 2);
  });

  test("runs the repair once, and says how many rules it switched off", async () => {
    const repair: SpyInstance<
      typeof RuleEmptiedLimits.switchOffRulesLimitedOnlyToDeletedRecords
    > = jest
      .spyOn(RuleEmptiedLimits, "switchOffRulesLimitedOnlyToDeletedRecords")
      .mockResolvedValue(3);

    await new SwitchOffRulesLimitedOnlyToDeletedRecords().migrate();

    expect(repair).toHaveBeenCalledTimes(1);
  });

  test("a repair that fails fails the migration, so it is tried again on the next boot", async () => {
    jest
      .spyOn(RuleEmptiedLimits, "switchOffRulesLimitedOnlyToDeletedRecords")
      .mockRejectedValue(new Error("connection lost"));

    await expect(
      new SwitchOffRulesLimitedOnlyToDeletedRecords().migrate(),
    ).rejects.toThrow("connection lost");
  });

  test("its rollback switches nothing back on", async () => {
    const repair: SpyInstance<
      typeof RuleEmptiedLimits.switchOffRulesLimitedOnlyToDeletedRecords
    > = jest.spyOn(
      RuleEmptiedLimits,
      "switchOffRulesLimitedOnlyToDeletedRecords",
    );

    await expect(
      new SwitchOffRulesLimitedOnlyToDeletedRecords().rollback(),
    ).resolves.toBeUndefined();
    expect(repair).not.toHaveBeenCalled();
  });
});
