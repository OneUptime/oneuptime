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
 * earlier is a warning only when there is a lot of it. The rates are worked
 * out at ingest from how the amount moves between reports
 * (VMwareResourceService.bulkUpdateLatestMetrics).
 *
 * Every rule compares "above": a part is marked when its reading is
 * greater than the threshold, so 0 marks any amount at all.
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
}

export type VMwareHealthRuleKey = keyof VMwareHealthRules;

/*
 * Each is the level its alert template fires at
 * (Common/Types/Monitor/VMwareAlertTemplates), so a part the Overview marks
 * is one its alert would page about - except swapping, which the templates
 * read as an amount and the Overview tells apart from residual memory.
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
};

export const VMWARE_HEALTH_RULE_KEYS: ReadonlyArray<VMwareHealthRuleKey> =
  Object.keys(DEFAULT_VMWARE_HEALTH_RULES) as Array<VMwareHealthRuleKey>;

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
 * the default rather than turning the rule off.
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
      rules[key] = null;
      continue;
    }
    const threshold: number = typeof value === "number" ? value : Number(value);
    if (isVMwareHealthThreshold(key, threshold)) {
      rules[key] = threshold;
    }
  }

  return rules;
}

// Whether a number is one this rule's threshold can be.
export function isVMwareHealthThreshold(
  key: VMwareHealthRuleKey,
  value: number,
): boolean {
  if (!Number.isFinite(value) || value < 0) {
    return false;
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
