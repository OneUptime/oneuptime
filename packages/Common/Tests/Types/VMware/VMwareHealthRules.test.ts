import {
  DEFAULT_VMWARE_HEALTH_RULES,
  VMWARE_HEALTH_MAX_EVALUATION_MINUTES,
  VMWARE_HEALTH_PERCENT_RULE_KEYS,
  VMWARE_HEALTH_PERIOD_RULE_KEYS,
  VMWARE_HEALTH_RULE_KEYS,
  VMWARE_HEALTH_RULE_PERIOD,
  VMWARE_HEALTH_THRESHOLD_RULE_KEYS,
  VMwareHealthRuleKey,
  VMwareHealthRules,
  getVMwareHealthEvaluationMinutes,
  getVMwareHealthRules,
  isPastVMwareHealthThreshold,
  isVMwareHealthPeriodRuleKey,
  isVMwareHealthThreshold,
} from "../../../Types/VMware/VMwareHealthRules";
import VMwareHealthSetting from "../../../Models/DatabaseModels/VMwareHealthSetting";
import { getTableColumns } from "../../../Types/Database/TableColumn";
import { describe, expect, test } from "@jest/globals";

/*
 * A project's VMware health rules (#11157): the thresholds its settings row
 * holds, read the one way every page reads them. A row that does not say is
 * the defaults; a threshold set to nothing is a rule turned off; a value no
 * threshold can be never turns a rule off by accident.
 */

describe("the defaults", () => {
  test("are the levels the Overview judged by before, but for swapping", () => {
    expect(DEFAULT_VMWARE_HEALTH_RULES).toEqual({
      hostCpuWarningPercent: 90,
      hostMemoryWarningPercent: 90,
      datastoreWarningPercent: 80,
      datastoreCriticalPercent: 90,
      vmSwapOutCriticalKibPerSecond: 0,
      vmSwapInWarningKibPerSecond: 1024,
      vmSwappedWarningMebibytes: 1024,
      vmBalloonedWarningMebibytes: 0,
      vmCpuReadyWarningPercent: 10,
      resourcePoolSwapOutWarningKibPerSecond: 0,
      // Every group judges the latest report until told to wait (#11469).
      hostEvaluationMinutes: 0,
      datastoreEvaluationMinutes: 0,
      vmSwapEvaluationMinutes: 0,
      vmMemoryCpuEvaluationMinutes: 0,
      resourcePoolEvaluationMinutes: 0,
    });
  });

  test("are what a new settings row is made with, column by column", () => {
    const columns: Record<string, { defaultValue?: unknown }> = getTableColumns(
      new VMwareHealthSetting(),
    ) as unknown as Record<string, { defaultValue?: unknown }>;
    for (const key of VMWARE_HEALTH_RULE_KEYS) {
      expect({ key, defaultValue: columns[key]?.defaultValue }).toEqual({
        key,
        defaultValue: DEFAULT_VMWARE_HEALTH_RULES[key],
      });
    }
  });

  test("every rule has a key, and every percent rule is one", () => {
    expect([...VMWARE_HEALTH_RULE_KEYS].sort()).toEqual(
      Object.keys(DEFAULT_VMWARE_HEALTH_RULES).sort(),
    );
    for (const key of VMWARE_HEALTH_PERCENT_RULE_KEYS) {
      expect(VMWARE_HEALTH_RULE_KEYS).toContain(key);
    }
  });
});

describe("getVMwareHealthRules", () => {
  test("a project with no settings row has the defaults, as a copy", () => {
    const rules: VMwareHealthRules = getVMwareHealthRules(null);
    expect(rules).toEqual(DEFAULT_VMWARE_HEALTH_RULES);
    rules.hostCpuWarningPercent = 1;
    expect(DEFAULT_VMWARE_HEALTH_RULES.hostCpuWarningPercent).toBe(90);
    expect(getVMwareHealthRules(undefined)).toEqual(
      DEFAULT_VMWARE_HEALTH_RULES,
    );
  });

  test("a row's own thresholds win; a column it did not read is the default", () => {
    expect(
      getVMwareHealthRules({
        hostCpuWarningPercent: 95,
        vmSwappedWarningMebibytes: 2048,
      }),
    ).toEqual({
      ...DEFAULT_VMWARE_HEALTH_RULES,
      hostCpuWarningPercent: 95,
      vmSwappedWarningMebibytes: 2048,
    });
  });

  test("nothing (null) turns a rule off", () => {
    expect(
      getVMwareHealthRules({
        vmSwapOutCriticalKibPerSecond: null,
        datastoreCriticalPercent: null,
      }),
    ).toEqual({
      ...DEFAULT_VMWARE_HEALTH_RULES,
      vmSwapOutCriticalKibPerSecond: null,
      datastoreCriticalPercent: null,
    });
  });

  test("0 is a threshold, not off: any amount at all", () => {
    expect(
      getVMwareHealthRules({ vmSwappedWarningMebibytes: 0 })
        .vmSwappedWarningMebibytes,
    ).toBe(0);
  });

  test("a number written as text is read; anything no threshold can be is the default", () => {
    expect(
      getVMwareHealthRules({ hostMemoryWarningPercent: "85" })
        .hostMemoryWarningPercent,
    ).toBe(85);
    for (const bad of ["lots", -1, Number.NaN, Number.POSITIVE_INFINITY, {}]) {
      expect(
        getVMwareHealthRules({ vmBalloonedWarningMebibytes: bad })
          .vmBalloonedWarningMebibytes,
      ).toBe(0);
    }
    // A share above 100% is no share.
    expect(
      getVMwareHealthRules({ datastoreWarningPercent: 120 })
        .datastoreWarningPercent,
    ).toBe(80);
    // An amount may be as large as it likes.
    expect(
      getVMwareHealthRules({ vmSwappedWarningMebibytes: 1048576 })
        .vmSwappedWarningMebibytes,
    ).toBe(1048576);
  });

  test("keys a row carries that are not rules are left out", () => {
    expect(
      Object.keys(
        getVMwareHealthRules({
          hostCpuWarningPercent: 91,
          projectId: "x",
        } as unknown as Partial<Record<string, unknown>>),
      ).sort(),
    ).toEqual([...VMWARE_HEALTH_RULE_KEYS].sort());
  });
});

describe("isVMwareHealthThreshold", () => {
  test("a percent from 0 to 100, an amount or a rate from 0", () => {
    expect(isVMwareHealthThreshold("hostCpuWarningPercent", 0)).toBe(true);
    expect(isVMwareHealthThreshold("hostCpuWarningPercent", 100)).toBe(true);
    expect(isVMwareHealthThreshold("hostCpuWarningPercent", 100.5)).toBe(false);
    expect(isVMwareHealthThreshold("vmSwapInWarningKibPerSecond", 1e9)).toBe(
      true,
    );
    expect(isVMwareHealthThreshold("vmSwapInWarningKibPerSecond", -0.1)).toBe(
      false,
    );
  });
});

describe("isPastVMwareHealthThreshold", () => {
  test("above the line is past it; at the line is not", () => {
    expect(isPastVMwareHealthThreshold(90.01, 90)).toBe(true);
    expect(isPastVMwareHealthThreshold(90, 90)).toBe(false);
    expect(isPastVMwareHealthThreshold(1, 0)).toBe(true);
    expect(isPastVMwareHealthThreshold(0, 0)).toBe(false);
  });

  test("a rule turned off, a reading not taken, or not a number is never past", () => {
    expect(isPastVMwareHealthThreshold(99, null)).toBe(false);
    expect(isPastVMwareHealthThreshold(null, 90)).toBe(false);
    expect(isPastVMwareHealthThreshold(undefined, 90)).toBe(false);
    expect(isPastVMwareHealthThreshold(Number.NaN, 0)).toBe(false);
  });
});

describe("for at least N minutes (#11469)", () => {
  test("five periods, one per group of rules, and every other rule a threshold", () => {
    expect(VMWARE_HEALTH_PERIOD_RULE_KEYS).toEqual([
      "hostEvaluationMinutes",
      "datastoreEvaluationMinutes",
      "vmSwapEvaluationMinutes",
      "vmMemoryCpuEvaluationMinutes",
      "resourcePoolEvaluationMinutes",
    ]);
    expect(
      [...VMWARE_HEALTH_PERIOD_RULE_KEYS, ...VMWARE_HEALTH_THRESHOLD_RULE_KEYS]
        .slice()
        .sort(),
    ).toEqual([...VMWARE_HEALTH_RULE_KEYS].sort());
    for (const key of VMWARE_HEALTH_PERIOD_RULE_KEYS) {
      expect(isVMwareHealthPeriodRuleKey(key)).toBe(true);
    }
    for (const key of VMWARE_HEALTH_THRESHOLD_RULE_KEYS) {
      expect(isVMwareHealthPeriodRuleKey(key)).toBe(false);
    }
  });

  test("each threshold waits for its card's period, and a period for none", () => {
    expect(VMWARE_HEALTH_RULE_PERIOD).toEqual({
      hostCpuWarningPercent: "hostEvaluationMinutes",
      hostMemoryWarningPercent: "hostEvaluationMinutes",
      datastoreWarningPercent: "datastoreEvaluationMinutes",
      datastoreCriticalPercent: "datastoreEvaluationMinutes",
      vmSwapOutCriticalKibPerSecond: "vmSwapEvaluationMinutes",
      vmSwapInWarningKibPerSecond: "vmSwapEvaluationMinutes",
      vmSwappedWarningMebibytes: "vmSwapEvaluationMinutes",
      vmBalloonedWarningMebibytes: "vmMemoryCpuEvaluationMinutes",
      vmCpuReadyWarningPercent: "vmMemoryCpuEvaluationMinutes",
      resourcePoolSwapOutWarningKibPerSecond: "resourcePoolEvaluationMinutes",
      hostEvaluationMinutes: null,
      datastoreEvaluationMinutes: null,
      vmSwapEvaluationMinutes: null,
      vmMemoryCpuEvaluationMinutes: null,
      resourcePoolEvaluationMinutes: null,
    });
  });

  test("a wait is 0 to 30 minutes", () => {
    expect(VMWARE_HEALTH_MAX_EVALUATION_MINUTES).toBe(30);
    for (const key of VMWARE_HEALTH_PERIOD_RULE_KEYS) {
      expect(isVMwareHealthThreshold(key, 0)).toBe(true);
      expect(isVMwareHealthThreshold(key, 30)).toBe(true);
      expect(isVMwareHealthThreshold(key, 31)).toBe(false);
      expect(isVMwareHealthThreshold(key, -1)).toBe(false);
    }
  });

  test("a period the row holds nothing for is the latest report, never off", () => {
    const rules: VMwareHealthRules = getVMwareHealthRules({
      hostEvaluationMinutes: null,
      vmSwapEvaluationMinutes: 10,
      datastoreEvaluationMinutes: "15",
      resourcePoolEvaluationMinutes: 45,
    });
    expect(rules.hostEvaluationMinutes).toBe(0);
    expect(rules.vmSwapEvaluationMinutes).toBe(10);
    expect(rules.datastoreEvaluationMinutes).toBe(15);
    // Longer than ingest keeps readings: the default, not a longer wait.
    expect(rules.resourcePoolEvaluationMinutes).toBe(0);
  });

  test("how long a threshold waits is its group's period", () => {
    const rules: VMwareHealthRules = {
      ...DEFAULT_VMWARE_HEALTH_RULES,
      hostEvaluationMinutes: 10,
      vmSwapEvaluationMinutes: 5,
    };
    expect(
      getVMwareHealthEvaluationMinutes(rules, "hostCpuWarningPercent"),
    ).toBe(10);
    expect(
      getVMwareHealthEvaluationMinutes(rules, "hostMemoryWarningPercent"),
    ).toBe(10);
    expect(
      getVMwareHealthEvaluationMinutes(rules, "vmSwapOutCriticalKibPerSecond"),
    ).toBe(5);
    expect(
      getVMwareHealthEvaluationMinutes(rules, "datastoreWarningPercent"),
    ).toBe(0);
    // A period has no period of its own.
    expect(
      getVMwareHealthEvaluationMinutes(rules, "hostEvaluationMinutes"),
    ).toBe(0);
  });

  test("a period of nothing, below 0 or not a number waits for nothing; past 30 waits 30", () => {
    for (const minutes of [null, -5, Number.NaN]) {
      expect(
        getVMwareHealthEvaluationMinutes(
          { ...DEFAULT_VMWARE_HEALTH_RULES, hostEvaluationMinutes: minutes },
          "hostCpuWarningPercent",
        ),
      ).toBe(0);
    }
    expect(
      getVMwareHealthEvaluationMinutes(
        { ...DEFAULT_VMWARE_HEALTH_RULES, hostEvaluationMinutes: 90 },
        "hostCpuWarningPercent",
      ),
    ).toBe(30);
  });

  test("the settings row has a column for every period, 0 by default", () => {
    const columns: Record<
      string,
      { defaultValue?: unknown; title?: string; required?: boolean }
    > = getTableColumns(new VMwareHealthSetting()) as unknown as Record<
      string,
      { defaultValue?: unknown; title?: string; required?: boolean }
    >;
    for (const key of VMWARE_HEALTH_PERIOD_RULE_KEYS) {
      expect({ key, defaultValue: columns[key]?.defaultValue }).toEqual({
        key,
        defaultValue: 0,
      });
      expect(columns[key]?.title).toMatch(/For At Least$/);
    }
  });

  test("every rule key reads as its kind: a period's never null", () => {
    const allNull: Record<string, null> = {};
    for (const key of VMWARE_HEALTH_RULE_KEYS) {
      allNull[key] = null;
    }
    const rules: VMwareHealthRules = getVMwareHealthRules(allNull);
    for (const key of VMWARE_HEALTH_RULE_KEYS as Array<VMwareHealthRuleKey>) {
      expect({ key, value: rules[key] }).toEqual({
        key,
        value: isVMwareHealthPeriodRuleKey(key) ? 0 : null,
      });
    }
  });
});
