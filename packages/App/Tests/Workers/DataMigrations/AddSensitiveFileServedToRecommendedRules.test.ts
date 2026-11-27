import logger from "Common/Server/Utils/Logger";
import NewRecommendedRuleRollout, {
  NewRecommendedRuleOutcome,
  NewRecommendedRuleRolloutSummary,
} from "Common/Server/Utils/SecurityEvent/NewRecommendedRuleRollout";
import {
  SENSITIVE_FILE_SERVED_RULE_ID,
  getDetectionRuleLibraryEntry,
  isRecommendedDetectionRule,
} from "Common/Types/SecurityEvent/DetectionRuleLibrary";
import AddSensitiveFileServedToRecommendedRules, {
  SENSITIVE_FILE_SERVED_ROLLOUT_NAME,
} from "../../../FeatureSet/Workers/DataMigrations/AddSensitiveFileServedToRecommendedRules";
import fs from "fs";
import path from "path";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * AddSensitiveFileServedToRecommendedRules (#11037): Sensitive file served
 * for every project that runs every other recommended rule and has no rule
 * of it. What it decides and how it adds the rule are
 * NewRecommendedRuleRollout's (Common's suite, and against a real Postgres
 * in AddSensitiveFileServedToRecommendedRulesPostgres); this pins the
 * migration itself:
 *
 *   - registered once, after the schema migration that adds the column it
 *     writes, and before the two slots kept last;
 *   - it rolls out Sensitive file served, under its own lock namespace,
 *     and says what it did - and what it could not do;
 *   - rollback changes nothing.
 */

const DATA_MIGRATIONS_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Workers/DataMigrations",
);

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

function summaryOf(
  outcomes: Partial<Record<NewRecommendedRuleOutcome, number>>,
): NewRecommendedRuleRolloutSummary {
  return {
    candidates: 9,
    outcomes: {
      [NewRecommendedRuleOutcome.Added]: 0,
      [NewRecommendedRuleOutcome.AlreadyHas]: 0,
      [NewRecommendedRuleOutcome.ChoseOwnSet]: 0,
      [NewRecommendedRuleOutcome.Failed]: 0,
      ...outcomes,
    },
  };
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("AddSensitiveFileServedToRecommendedRules", () => {
  test("is registered once, before the two slots kept last", () => {
    const registered: Array<string> = registeredMigrations();

    expect(
      registered.filter((name: string): boolean => {
        return name === SENSITIVE_FILE_SERVED_ROLLOUT_NAME;
      }),
    ).toHaveLength(1);
    expect(registered.slice(-2)).toEqual([
      "BackfillIncidentCallTranscriptSignInAccount",
      "AddAuditLogMcpClientColumns",
    ]);
    expect(new AddSensitiveFileServedToRecommendedRules().name).toBe(
      SENSITIVE_FILE_SERVED_ROLLOUT_NAME,
    );
    // After the Scanners policy's own rule of #10745.
    expect(
      registered.indexOf(SENSITIVE_FILE_SERVED_ROLLOUT_NAME),
    ).toBeGreaterThan(
      registered.indexOf("AddSensitiveFileRuleToScannersPolicies"),
    );
  });

  test("rolls out Sensitive file served, a recommended rule, under its own lock", async () => {
    const rollOut: ReturnType<typeof jest.spyOn> = jest
      .spyOn(
        NewRecommendedRuleRollout,
        "addToProjectsRunningEveryOtherRecommendedRule",
      )
      .mockResolvedValue(summaryOf({ [NewRecommendedRuleOutcome.Added]: 3 }));
    jest.spyOn(logger, "info").mockImplementation(() => {
      return undefined as never;
    });

    await new AddSensitiveFileServedToRecommendedRules().migrate();

    expect(rollOut).toHaveBeenCalledTimes(1);
    expect(rollOut.mock.calls[0]![0]).toEqual({
      libraryRuleId: SENSITIVE_FILE_SERVED_RULE_ID,
      lockNamespace: SENSITIVE_FILE_SERVED_ROLLOUT_NAME,
    });
    expect(
      isRecommendedDetectionRule(
        getDetectionRuleLibraryEntry(SENSITIVE_FILE_SERVED_RULE_ID)!,
      ),
    ).toBe(true);
  });

  test("says what it did, and warns of the projects it could not add the rule to", async () => {
    jest
      .spyOn(
        NewRecommendedRuleRollout,
        "addToProjectsRunningEveryOtherRecommendedRule",
      )
      .mockResolvedValue(
        summaryOf({
          [NewRecommendedRuleOutcome.Added]: 3,
          [NewRecommendedRuleOutcome.AlreadyHas]: 2,
          [NewRecommendedRuleOutcome.ChoseOwnSet]: 3,
          [NewRecommendedRuleOutcome.Failed]: 1,
        }),
      );
    const info: ReturnType<typeof jest.spyOn> = jest
      .spyOn(logger, "info")
      .mockImplementation(() => {
        return undefined as never;
      });
    const warn: ReturnType<typeof jest.spyOn> = jest
      .spyOn(logger, "warn")
      .mockImplementation(() => {
        return undefined as never;
      });

    await new AddSensitiveFileServedToRecommendedRules().migrate();

    expect(String(info.mock.calls[0]![0])).toBe(
      "AddSensitiveFileServedToRecommendedRules: of 9 projects that may run every other recommended rule, Sensitive file served was added to 3; 2 had it already and 3 chose their own set.",
    );
    expect(String(warn.mock.calls[0]![0])).toContain(
      "it could not be added to 1 projects",
    );
  });

  test("no warning when every project's turn went through", async () => {
    jest
      .spyOn(
        NewRecommendedRuleRollout,
        "addToProjectsRunningEveryOtherRecommendedRule",
      )
      .mockResolvedValue(summaryOf({}));
    jest.spyOn(logger, "info").mockImplementation(() => {
      return undefined as never;
    });
    const warn: ReturnType<typeof jest.spyOn> = jest
      .spyOn(logger, "warn")
      .mockImplementation(() => {
        return undefined as never;
      });

    await new AddSensitiveFileServedToRecommendedRules().migrate();

    expect(warn).not.toHaveBeenCalled();
  });

  test("a failed read fails the migration, so it runs again on the next start", async () => {
    jest
      .spyOn(
        NewRecommendedRuleRollout,
        "addToProjectsRunningEveryOtherRecommendedRule",
      )
      .mockRejectedValue(new Error("Postgres is away"));

    await expect(
      new AddSensitiveFileServedToRecommendedRules().migrate(),
    ).rejects.toThrow("Postgres is away");
  });

  test("rollback changes nothing", async () => {
    const rollOut: ReturnType<typeof jest.spyOn> = jest.spyOn(
      NewRecommendedRuleRollout,
      "addToProjectsRunningEveryOtherRecommendedRule",
    );

    await expect(
      new AddSensitiveFileServedToRecommendedRules().rollback(),
    ).resolves.toBeUndefined();
    expect(rollOut).not.toHaveBeenCalled();
  });
});
