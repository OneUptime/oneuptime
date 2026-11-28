/*
 * THE BUILT-IN VMWARE HEALTH RULES: WHERE EACH TURNS AMBER OR RED (#11157).
 *
 * What a vCenter's Overview, its parts' pages, its lists' Status column and
 * its Topology mark as needing a look (warning) or someone now (critical) -
 * the rules in the Dashboard's VMwareHealth - at the thresholds a project
 * sets on VMware > Settings > Health Rules (the VMwareHealthSetting row),
 * these defaults until it sets its own. A threshold set to nothing (null)
 * turns its rule off.
 *
 * Swapping is three rules, because the amount of a VM's memory in the host's
 * swap file says nothing about whether the host is swapping now: ESXi leaves
 * a swapped page there until the guest touches it, so a VM keeps a few MiB
 * for weeks after the pressure that put them there has gone. The host
 * swapping memory out now is real memory pressure, and critical; the guest
 * reading swapped memory back is slow while it lasts, and a warning above a
 * rate that is more than touching a few old pages; memory merely left from
 * earlier is a warning only when there is a lot of it. The rates are
 * vSphere's own where a probe collects the vCenter, and otherwise worked out
 * at ingest from how the amount moves between reports
 * (VMwareResourceService.bulkUpdateLatestMetrics, #11468).
 *
 * Every rule compares "above": a part is marked when its reading is
 * greater than the threshold, so 0 marks any amount at all.
 *
 * FOR AT LEAST N MINUTES (#11469). Each group of rules - a card on the
 * Health Rules page - can wait before it marks a part: a busy host needs a
 * look once every report for 10 minutes was busy, not on its first busy
 * report. 0, the default, judges the latest report, as the rules always
 * did. Ingest keeps each part's last readings for this
 * (VMwareResource.healthReadings, VMwareHealthReadings).
 *
 * A vCenter, a cluster, an ESXi host or a VM can have rules of its own that
 * replace the project's, one rule at a time, the most specific winning
 * (VMwareHealthRuleOverrides): a lab vCenter, a batch cluster meant to run
 * hot.
 */
export interface VMwareHealthRules {
  // An ESXi host whose CPU is busier than this, in percent: warning.
  hostCpuWarningPercent: number | null;
  // An ESXi host whose memory is busier than this, in percent: warning.
  hostMemoryWarningPercent: number | null;
  // A datastore fuller than this, in percent: warning.
  datastoreWarningPercent: number | null;
  // A datastore fuller than this, in percent: critical.
  datastoreCriticalPercent: number | null;
  // The host swapping a VM's memory out faster than this, KiB/s: critical.
  vmSwapOutCriticalKibPerSecond: number | null;
  // The guest reading swapped memory back faster than this, KiB/s: warning.
  vmSwapInWarningKibPerSecond: number | null;
  // More of a VM's memory than this left in the swap file, MiB: warning.
  vmSwappedWarningMebibytes: number | null;
  // More of a VM's memory than this taken back by ballooning, MiB: warning.
  vmBalloonedWarningMebibytes: number | null;
  // A VM waiting for a free CPU more than this share of the time: warning.
  vmCpuReadyWarningPercent: number | null;
  // The host swapping a resource pool's memory out faster than this: warning.
  resourcePoolSwapOutWarningKibPerSecond: number | null;
  /*
   * How long, in minutes, each group's rules must hold before they mark a
   * part: every report in that time past the threshold. 0 (or nothing)
   * judges the latest report alone.
   */
  hostEvaluationMinutes: number | null;
  datastoreEvaluationMinutes: number | null;
  vmSwapEvaluationMinutes: number | null;
  vmMemoryCpuEvaluationMinutes: number | null;
  resourcePoolEvaluationMinutes: number | null;
}

export type VMwareHealthRuleKey = keyof VMwareHealthRules;

/*
 * Each is the level its alert template fires at
 * (Common/Types/Monitor/VMwareAlertTemplates), so a part the Overview marks
 * is one its alert would page about: VM Memory Swapping fires on any swap-out
 * rate, and VM Swapped Memory High on more than 1 GiB swapped (#11468). The
 * templates wait 5 minutes where these judge the latest report, unless a
 * period says otherwise.
 */
export const DEFAULT_VMWARE_HEALTH_RULES: Readonly<
  Record<VMwareHealthRuleKey, number>
> = {
  hostCpuWarningPercent: 90,
  hostMemoryWarningPercent: 90,
  datastoreWarningPercent: 80,
  datastoreCriticalPercent: 90,
  vmSwapOutCriticalKibPerSecond: 0,
  // 1 MiB/s: reading back more than touching a few old pages does.
  vmSwapInWarningKibPerSecond: 1024,
  // 1 GiB left in the swap file: enough to stall the guest when it is read.
  vmSwappedWarningMebibytes: 1024,
  vmBalloonedWarningMebibytes: 0,
  vmCpuReadyWarningPercent: 10,
  resourcePoolSwapOutWarningKibPerSecond: 0,
  // The latest report, as the rules always judged.
  hostEvaluationMinutes: 0,
  datastoreEvaluationMinutes: 0,
  vmSwapEvaluationMinutes: 0,
  vmMemoryCpuEvaluationMinutes: 0,
  resourcePoolEvaluationMinutes: 0,
};

export const VMWARE_HEALTH_RULE_KEYS: ReadonlyArray<VMwareHealthRuleKey> =
  Object.keys(DEFAULT_VMWARE_HEALTH_RULES) as Array<VMwareHealthRuleKey>;

// The rules that are a period, in minutes: never off, 0 is the latest report.
export const VMWARE_HEALTH_PERIOD_RULE_KEYS: ReadonlyArray<VMwareHealthRuleKey> =
  [
    "hostEvaluationMinutes",
    "datastoreEvaluationMinutes",
    "vmSwapEvaluationMinutes",
    "vmMemoryCpuEvaluationMinutes",
    "resourcePoolEvaluationMinutes",
  ];

// The rules that are a threshold: off when set to nothing.
export const VMWARE_HEALTH_THRESHOLD_RULE_KEYS: ReadonlyArray<VMwareHealthRuleKey> =
  VMWARE_HEALTH_RULE_KEYS.filter((key: VMwareHealthRuleKey): boolean => {
    return !VMWARE_HEALTH_PERIOD_RULE_KEYS.includes(key);
  });

/*
 * The longest a group's rules can wait: half an hour. Ingest keeps that
 * much of each part's readings, and a longer wait is an alert's job - a
 * monitor's window - not the Overview's.
 */
export const VMWARE_HEALTH_MAX_EVALUATION_MINUTES: number = 30;

// Which period each threshold waits for: the group (Health Rules card) it is in.
export const VMWARE_HEALTH_RULE_PERIOD: Readonly<
  Record<VMwareHealthRuleKey, VMwareHealthRuleKey | null>
> = {
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
};

export function isVMwareHealthPeriodRuleKey(key: VMwareHealthRuleKey): boolean {
  return VMWARE_HEALTH_PERIOD_RULE_KEYS.includes(key);
}

/*
 * How many minutes a threshold's rule must hold, by the rules handed in:
 * its group's period, 0 when the group has none (the latest report).
 */
export function getVMwareHealthEvaluationMinutes(
  rules: VMwareHealthRules,
  key: VMwareHealthRuleKey,
): number {
  const periodKey: VMwareHealthRuleKey | null = VMWARE_HEALTH_RULE_PERIOD[key];
  if (!periodKey) {
    return 0;
  }
  const minutes: number | null = rules[periodKey];
  return typeof minutes === "number" && Number.isFinite(minutes) && minutes > 0
    ? Math.min(minutes, VMWARE_HEALTH_MAX_EVALUATION_MINUTES)
    : 0;
}

// The rules whose threshold is a share of something, 0 to 100.
export const VMWARE_HEALTH_PERCENT_RULE_KEYS: ReadonlyArray<VMwareHealthRuleKey> =
  [
    "hostCpuWarningPercent",
    "hostMemoryWarningPercent",
    "datastoreWarningPercent",
    "datastoreCriticalPercent",
    "vmCpuReadyWarningPercent",
  ];

export const KIBIBYTE: number = 1024;
export const MEBIBYTE: number = 1024 * 1024;

/*
 * The rules a project's settings row says: a threshold the row holds, off
 * where it holds nothing, and the default where the row does not say (a
 * project with no row, or a column the read did not select). A value no
 * threshold can be - not a number, below 0, a share above 100 - is read as
 * the default rather than turning the rule off. A period the row holds
 * nothing for is 0, the latest report: a period is never off.
 */
export function getVMwareHealthRules(
  setting?: Partial<Record<VMwareHealthRuleKey, unknown>> | null,
): VMwareHealthRules {
  const rules: VMwareHealthRules = { ...DEFAULT_VMWARE_HEALTH_RULES };
  if (!setting) {
    return rules;
  }

  for (const key of VMWARE_HEALTH_RULE_KEYS) {
    const value: unknown = setting[key];
    if (value === undefined) {
      continue;
    }
    if (value === null) {
      rules[key] = isVMwareHealthPeriodRuleKey(key) ? 0 : null;
      continue;
    }
    const threshold: number = typeof value === "number" ? value : Number(value);
    if (isVMwareHealthThreshold(key, threshold)) {
      rules[key] = threshold;
    }
  }

  return rules;
}

// Whether a number is one this rule's threshold (or period) can be.
export function isVMwareHealthThreshold(
  key: VMwareHealthRuleKey,
  value: number,
): boolean {
  if (!Number.isFinite(value) || value < 0) {
    return false;
  }
  if (isVMwareHealthPeriodRuleKey(key)) {
    return value <= VMWARE_HEALTH_MAX_EVALUATION_MINUTES;
  }
  return !VMWARE_HEALTH_PERCENT_RULE_KEYS.includes(key) || value <= 100;
}

// Whether a reading is past a threshold: above it, and the rule on.
export function isPastVMwareHealthThreshold(
  reading: number | null | undefined,
  threshold: number | null,
): boolean {
  if (threshold === null || reading === null || reading === undefined) {
    return false;
  }
  return Number.isFinite(reading) && reading > threshold;
}
