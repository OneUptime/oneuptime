import { VMwareResourceKind } from "../Monitor/MonitorStepVMwareMonitor";
import { translationKey } from "../Translator";
import {
  DEFAULT_VMWARE_HEALTH_RULES,
  VMWARE_HEALTH_PERIOD_RULE_KEYS,
  VMWARE_HEALTH_RULE_KEYS,
  VMwareHealthRuleKey,
  VMwareHealthRules,
  isVMwareHealthPeriodRuleKey,
  isVMwareHealthThreshold,
} from "./VMwareHealthRules";

/*
 * RULES OF THEIR OWN FOR A VCENTER, A CLUSTER, AN ESXI HOST OR A VM (#11469).
 *
 * The project's health rules (VMware > Settings > Health Rules) judge every
 * vCenter alike, so a lab vCenter, or a cluster of batch hosts meant to run
 * hot, could not get looser rules than production. An override replaces
 * some of the project's rules for one part of one vCenter, and what it
 * covers:
 *
 *   - a vCenter: everything in it;
 *   - a cluster: the cluster, its ESXi hosts, their VMs and the cluster's
 *     resource pools;
 *   - an ESXi host: the host and the VMs on it (and a standalone host's
 *     resource pools);
 *   - a VM: that VM.
 *
 * Rule by rule, the most specific override that sets it wins - a VM's over
 * its host's over its cluster's over its vCenter's over the project's - and
 * a rule no override sets is the project's. An override sets a threshold to
 * a number, or turns it off (null); a rule it does not hold, it inherits.
 * A period ("for at least N minutes") is set the same way, but is never off.
 *
 * Every page that judges a part - the Overview, the part's page, the lists,
 * the bars and tiles, the Topology - resolves its rules here
 * (resolveVMwareHealthRules), and the Health Rules page says where each
 * override applies. Isomorphic: the server validates an override with the
 * same rules (VMwareHealthRuleOverrideService).
 */

export enum VMwareHealthRuleScope {
  VCenter = "VCenter",
  Cluster = "Cluster",
  Host = "Host",
  VirtualMachine = "VirtualMachine",
}

// The least specific first: the order the overrides are applied in.
export const VMWARE_HEALTH_RULE_SCOPES: ReadonlyArray<VMwareHealthRuleScope> = [
  VMwareHealthRuleScope.VCenter,
  VMwareHealthRuleScope.Cluster,
  VMwareHealthRuleScope.Host,
  VMwareHealthRuleScope.VirtualMachine,
];

// The kind of part an override of a scope names (none for a whole vCenter).
export const VMWARE_HEALTH_RULE_SCOPE_KIND: Readonly<
  Record<VMwareHealthRuleScope, VMwareResourceKind | null>
> = {
  [VMwareHealthRuleScope.VCenter]: null,
  [VMwareHealthRuleScope.Cluster]: VMwareResourceKind.Cluster,
  [VMwareHealthRuleScope.Host]: VMwareResourceKind.Host,
  [VMwareHealthRuleScope.VirtualMachine]: VMwareResourceKind.VirtualMachine,
};

/*
 * The rules an override of each scope may set: the ones that judge a part
 * it covers. A VM's override has no host or datastore rule to change, and a
 * datastore belongs to no cluster or host, so only a vCenter's override
 * reaches it.
 */
const HOST_RULES: Array<VMwareHealthRuleKey> = [
  "hostCpuWarningPercent",
  "hostMemoryWarningPercent",
  "hostEvaluationMinutes",
];
const DATASTORE_RULES: Array<VMwareHealthRuleKey> = [
  "datastoreWarningPercent",
  "datastoreCriticalPercent",
  "datastoreEvaluationMinutes",
];
const VM_RULES: Array<VMwareHealthRuleKey> = [
  "vmSwapOutCriticalKibPerSecond",
  "vmSwapInWarningKibPerSecond",
  "vmSwappedWarningMebibytes",
  "vmSwapEvaluationMinutes",
  "vmBalloonedWarningMebibytes",
  "vmCpuReadyWarningPercent",
  "vmMemoryCpuEvaluationMinutes",
];
const RESOURCE_POOL_RULES: Array<VMwareHealthRuleKey> = [
  "resourcePoolSwapOutWarningKibPerSecond",
  "resourcePoolEvaluationMinutes",
];

export const VMWARE_HEALTH_RULE_SCOPE_RULES: Readonly<
  Record<VMwareHealthRuleScope, ReadonlyArray<VMwareHealthRuleKey>>
> = {
  [VMwareHealthRuleScope.VCenter]: [
    ...HOST_RULES,
    ...DATASTORE_RULES,
    ...VM_RULES,
    ...RESOURCE_POOL_RULES,
  ],
  [VMwareHealthRuleScope.Cluster]: [
    ...HOST_RULES,
    ...VM_RULES,
    ...RESOURCE_POOL_RULES,
  ],
  [VMwareHealthRuleScope.Host]: [
    ...HOST_RULES,
    ...VM_RULES,
    ...RESOURCE_POOL_RULES,
  ],
  [VMwareHealthRuleScope.VirtualMachine]: [...VM_RULES],
};

// What an override holds: a value per rule it sets; null turns a threshold off.
export type VMwareHealthRuleOverrideRules = Partial<
  Record<VMwareHealthRuleKey, number | null>
>;

// One override, as every page reads it.
export interface VMwareHealthRuleOverrideEntry {
  id?: string | undefined;
  vmwareVCenterId: string;
  scope: VMwareHealthRuleScope;
  // The VMwareResource externalId of the cluster, host or VM; null for a vCenter.
  resourceExternalId: string | null;
  // Where the part sits, copied from it when the override was made.
  resourceName?: string | null | undefined;
  datacenterName: string | null;
  clusterName: string | null;
  hostName: string | null;
  rules: VMwareHealthRuleOverrideRules;
}

// The project's rules and every override of them: what a page judges by.
export interface VMwareHealthRuleBook {
  project: VMwareHealthRules;
  overrides: ReadonlyArray<VMwareHealthRuleOverrideEntry>;
}

// What a part says of where it sits.
export interface VMwareHealthRulePart {
  vmwareVCenterId?: string | { toString: () => string } | null | undefined;
  // VMwareResourceKind, or "VCenter" for something of the whole vCenter.
  kind?: string | null | undefined;
  externalId?: string | null | undefined;
  name?: string | null | undefined;
  datacenterName?: string | null | undefined;
  clusterName?: string | null | undefined;
  hostName?: string | null | undefined;
}

// A part that is the whole vCenter: its storage total.
export const VMWARE_HEALTH_RULE_VCENTER_PART_KIND: string = "VCenter";

export function getVMwareHealthRuleBook(
  project?: VMwareHealthRules | null | undefined,
  overrides?: ReadonlyArray<VMwareHealthRuleOverrideEntry> | null | undefined,
): VMwareHealthRuleBook {
  return {
    project: project || { ...DEFAULT_VMWARE_HEALTH_RULES },
    overrides: overrides || [],
  };
}

export function isVMwareHealthRuleBook(
  value: unknown,
): value is VMwareHealthRuleBook {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    Array.isArray((value as VMwareHealthRuleBook).overrides) &&
    Boolean((value as VMwareHealthRuleBook).project) &&
    typeof (value as VMwareHealthRuleBook).project === "object"
  );
}

function idOf(value: VMwareHealthRulePart["vmwareVCenterId"]): string {
  return value ? value.toString() : "";
}

function sameName(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  if (!a || !b) {
    return false;
  }
  return a.trim().toLowerCase() === b.trim().toLowerCase();
}

// One datacenter, or a side that does not say: names repeat across datacenters only.
function sameDatacenter(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  return !a || !b || sameName(a, b);
}

// The cluster a part sits in, or is.
function clusterOf(part: VMwareHealthRulePart): string | null {
  if (part.kind === VMwareResourceKind.Cluster) {
    return part.clusterName || part.name || null;
  }
  return part.clusterName || null;
}

// The ESXi host a part runs on, or is.
function hostOf(part: VMwareHealthRulePart): string | null {
  if (part.kind === VMwareResourceKind.Host) {
    return part.hostName || part.name || null;
  }
  return part.hostName || null;
}

// Whether an override covers a part (see the header).
export function doesVMwareHealthRuleOverrideCover(
  override: VMwareHealthRuleOverrideEntry,
  part: VMwareHealthRulePart,
): boolean {
  if (
    !override.vmwareVCenterId ||
    override.vmwareVCenterId !== idOf(part.vmwareVCenterId)
  ) {
    return false;
  }

  switch (override.scope) {
    case VMwareHealthRuleScope.VCenter:
      return true;
    case VMwareHealthRuleScope.Cluster: {
      if (
        part.kind !== VMwareResourceKind.Cluster &&
        part.kind !== VMwareResourceKind.Host &&
        part.kind !== VMwareResourceKind.VirtualMachine &&
        part.kind !== VMwareResourceKind.ResourcePool
      ) {
        return false;
      }
      if (
        part.kind === VMwareResourceKind.Cluster &&
        override.resourceExternalId &&
        part.externalId === override.resourceExternalId
      ) {
        return true;
      }
      return (
        sameName(override.clusterName, clusterOf(part)) &&
        sameDatacenter(override.datacenterName, part.datacenterName)
      );
    }
    case VMwareHealthRuleScope.Host: {
      if (
        part.kind !== VMwareResourceKind.Host &&
        part.kind !== VMwareResourceKind.VirtualMachine &&
        part.kind !== VMwareResourceKind.ResourcePool
      ) {
        return false;
      }
      if (
        part.kind === VMwareResourceKind.Host &&
        override.resourceExternalId &&
        part.externalId === override.resourceExternalId
      ) {
        return true;
      }
      return (
        sameName(override.hostName, hostOf(part)) &&
        sameDatacenter(override.datacenterName, part.datacenterName)
      );
    }
    case VMwareHealthRuleScope.VirtualMachine:
      return (
        part.kind === VMwareResourceKind.VirtualMachine &&
        Boolean(override.resourceExternalId) &&
        part.externalId === override.resourceExternalId
      );
    default:
      return false;
  }
}

/*
 * The overrides that cover a part, the least specific first - the order
 * they are applied in, so the most specific is applied last and wins.
 * Two of one scope (two names spelled alike in one datacenter) apply in the
 * order they were made.
 */
export function getVMwareHealthRuleOverridesFor(
  book: VMwareHealthRuleBook,
  part: VMwareHealthRulePart,
): Array<VMwareHealthRuleOverrideEntry> {
  const covering: Array<VMwareHealthRuleOverrideEntry> = book.overrides.filter(
    (override: VMwareHealthRuleOverrideEntry): boolean => {
      return doesVMwareHealthRuleOverrideCover(override, part);
    },
  );

  return VMWARE_HEALTH_RULE_SCOPES.flatMap(
    (scope: VMwareHealthRuleScope): Array<VMwareHealthRuleOverrideEntry> => {
      return covering.filter((override: VMwareHealthRuleOverrideEntry) => {
        return override.scope === scope;
      });
    },
  );
}

/*
 * A value an override holds for a rule, as the rule can take it: a
 * threshold a number in range or null (off), a period a number in range.
 * Anything else is no value: the rule is inherited.
 */
export function readVMwareHealthRuleOverrideValue(
  key: VMwareHealthRuleKey,
  value: unknown,
): { isSet: boolean; value: number | null } {
  if (value === undefined) {
    return { isSet: false, value: null };
  }
  if (value === null) {
    return isVMwareHealthPeriodRuleKey(key)
      ? { isSet: false, value: null }
      : { isSet: true, value: null };
  }
  const number: number = typeof value === "number" ? value : Number(value);
  if (!isVMwareHealthThreshold(key, number)) {
    return { isSet: false, value: null };
  }
  return { isSet: true, value: number };
}

// Where a resolved rule came from: the project, or the override that set it.
export interface VMwareHealthRuleOrigin {
  value: number | null;
  override: VMwareHealthRuleOverrideEntry | null;
}

/*
 * Each rule for a part, and where it came from. A rule no override covering
 * the part sets is the project's.
 */
export function explainVMwareHealthRules(
  book: VMwareHealthRuleBook,
  part: VMwareHealthRulePart,
): Record<VMwareHealthRuleKey, VMwareHealthRuleOrigin> {
  const origins: Record<string, VMwareHealthRuleOrigin> = {};

  for (const key of VMWARE_HEALTH_RULE_KEYS) {
    origins[key] = { value: book.project[key], override: null };
  }

  for (const override of getVMwareHealthRuleOverridesFor(book, part)) {
    for (const key of VMWARE_HEALTH_RULE_SCOPE_RULES[override.scope]) {
      const read: { isSet: boolean; value: number | null } =
        readVMwareHealthRuleOverrideValue(key, override.rules?.[key]);
      if (read.isSet) {
        origins[key] = { value: read.value, override };
      }
    }
  }

  return origins as Record<VMwareHealthRuleKey, VMwareHealthRuleOrigin>;
}

// The rules a part is judged by: the project's, with the overrides covering it applied.
export function resolveVMwareHealthRules(
  book: VMwareHealthRuleBook,
  part: VMwareHealthRulePart,
): VMwareHealthRules {
  const origins: Record<VMwareHealthRuleKey, VMwareHealthRuleOrigin> =
    explainVMwareHealthRules(book, part);
  const rules: Record<string, number | null> = {};

  for (const key of VMWARE_HEALTH_RULE_KEYS) {
    rules[key] = origins[key].value;
  }

  for (const key of VMWARE_HEALTH_PERIOD_RULE_KEYS) {
    if (rules[key] === null) {
      rules[key] = 0;
    }
  }

  return rules as unknown as VMwareHealthRules;
}

/*
 * The rules a page hands a judgement - the project's alone (a test, a page
 * outside a project) or the book - for one part: a book is resolved for it.
 */
export function getVMwareHealthRulesForPart(
  rules: VMwareHealthRules | VMwareHealthRuleBook | null | undefined,
  part: VMwareHealthRulePart,
): VMwareHealthRules {
  if (!rules) {
    return { ...DEFAULT_VMWARE_HEALTH_RULES };
  }
  if (isVMwareHealthRuleBook(rules)) {
    return resolveVMwareHealthRules(rules, part);
  }
  return rules;
}

/*
 * The rules an override's scope may set, of the ones it holds, as the
 * override holds them: anything else - a rule its scope does not judge, an
 * unknown key, a value no rule can be - is dropped. What the server keeps,
 * and what a page applies.
 */
export function cleanVMwareHealthRuleOverrideRules(
  scope: VMwareHealthRuleScope,
  rules: unknown,
): VMwareHealthRuleOverrideRules {
  const clean: VMwareHealthRuleOverrideRules = {};

  if (!rules || typeof rules !== "object" || Array.isArray(rules)) {
    return clean;
  }

  for (const key of VMWARE_HEALTH_RULE_SCOPE_RULES[scope] || []) {
    const read: { isSet: boolean; value: number | null } =
      readVMwareHealthRuleOverrideValue(
        key,
        (rules as Record<string, unknown>)[key],
      );
    if (read.isSet) {
      clean[key] = read.value;
    }
  }

  return clean;
}

/*
 * Why an override's rules are refused, in words the person can act on: the
 * Health Rules page says them in the reader's language, and the API as
 * they are.
 */
export const VMWARE_HEALTH_RULE_OVERRIDE_RULES_SHAPE_ERROR: string =
  translationKey("An override's rules are a list of rules and their values.");
export const VMWARE_HEALTH_RULE_OVERRIDE_RULE_SCOPE_ERROR: string =
  translationKey(
    "That rule judges nothing an override of this kind covers. Set it on a vCenter, a cluster or a host that holds what it judges.",
  );
export const VMWARE_HEALTH_RULE_OVERRIDE_WAIT_ERROR: string = translationKey(
  "A wait is a whole number of minutes from 0 to 30.",
);
export const VMWARE_HEALTH_RULE_OVERRIDE_THRESHOLD_ERROR: string =
  translationKey(
    "A threshold is a whole number from 0 (a percent up to 100), or Off to turn its rule off.",
  );

/*
 * Why an override's rules cannot be kept, or null: a rule its scope does
 * not judge, a value no rule can be.
 */
export function getVMwareHealthRuleOverrideRulesRefusal(
  scope: VMwareHealthRuleScope,
  rules: unknown,
): string | null {
  if (rules === undefined || rules === null) {
    return null;
  }
  if (typeof rules !== "object" || Array.isArray(rules)) {
    return VMWARE_HEALTH_RULE_OVERRIDE_RULES_SHAPE_ERROR;
  }

  const allowed: ReadonlyArray<VMwareHealthRuleKey> =
    VMWARE_HEALTH_RULE_SCOPE_RULES[scope] || [];

  for (const [key, value] of Object.entries(rules as Record<string, unknown>)) {
    if (value === undefined) {
      continue;
    }
    if (!(VMWARE_HEALTH_RULE_KEYS as ReadonlyArray<string>).includes(key)) {
      return `"${key}" is not a VMware health rule.`;
    }
    if (!allowed.includes(key as VMwareHealthRuleKey)) {
      return VMWARE_HEALTH_RULE_OVERRIDE_RULE_SCOPE_ERROR;
    }
    if (value === null) {
      if (isVMwareHealthPeriodRuleKey(key as VMwareHealthRuleKey)) {
        return VMWARE_HEALTH_RULE_OVERRIDE_WAIT_ERROR;
      }
      continue;
    }
    const number: number = typeof value === "number" ? value : Number(value);
    if (
      !Number.isInteger(number) ||
      !isVMwareHealthThreshold(key as VMwareHealthRuleKey, number)
    ) {
      return isVMwareHealthPeriodRuleKey(key as VMwareHealthRuleKey)
        ? VMWARE_HEALTH_RULE_OVERRIDE_WAIT_ERROR
        : VMWARE_HEALTH_RULE_OVERRIDE_THRESHOLD_ERROR;
    }
  }

  return null;
}
