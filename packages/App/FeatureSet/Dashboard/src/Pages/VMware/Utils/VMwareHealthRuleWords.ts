import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import {
  VMWARE_HEALTH_MAX_EVALUATION_MINUTES,
  VMwareHealthRuleKey,
  isVMwareHealthPeriodRuleKey,
} from "Common/Types/VMware/VMwareHealthRules";
import {
  VMWARE_HEALTH_RULE_SCOPE_RULES,
  VMwareHealthRuleScope,
} from "Common/Types/VMware/VMwareHealthRuleOverrides";

/*
 * WHAT EACH VMWARE HEALTH RULE IS CALLED, AND HOW ITS VALUE READS (#11469).
 *
 * One place for the words of the rules, so the Health Rules page's cards,
 * an override's dialog and its summary in the Overrides list name a rule
 * the same way: grouped as the page's cards group them, each value in the
 * rule's own unit - "Above 90%", "Above 1,024 KiB/s", "Any" for 0, "Off" -
 * and a group's wait as "For at least 10 min", or "Latest report" for 0.
 *
 * English, marked with translationKey() and looked up where it is drawn.
 * React-free, so App tests can read it.
 */

export type VMwareHealthRuleUnit =
  | "percent"
  | "kibPerSecond"
  | "mebibytes"
  | "minutes";

export interface VMwareHealthRuleWords {
  key: VMwareHealthRuleKey;
  // The card it is on.
  group: string;
  // Its name on the card ("CPU Warning Above").
  label: string;
  unit: VMwareHealthRuleUnit;
  // The most a value may be (a percent's 100, a wait's 30).
  maxValue?: number | undefined;
}

export const GROUP_HOSTS: string = translationKey("Busy ESXi Hosts");
export const GROUP_DATASTORES: string = translationKey("Full Datastores");
export const GROUP_VM_SWAPPING: string = translationKey("VM Swapping");
export const GROUP_VM_MEMORY_CPU: string = translationKey(
  "VM Ballooning and CPU Ready",
);
export const GROUP_RESOURCE_POOLS: string = translationKey(
  "Resource Pool Swapping",
);

export const FOR_AT_LEAST_LABEL: string = translationKey("For At Least");

// Every rule, in the order the page's cards list them.
export const VMWARE_HEALTH_RULE_WORDS: ReadonlyArray<VMwareHealthRuleWords> = [
  {
    key: "hostCpuWarningPercent",
    group: GROUP_HOSTS,
    label: translationKey("CPU Warning Above"),
    unit: "percent",
    maxValue: 100,
  },
  {
    key: "hostMemoryWarningPercent",
    group: GROUP_HOSTS,
    label: translationKey("Memory Warning Above"),
    unit: "percent",
    maxValue: 100,
  },
  {
    key: "hostEvaluationMinutes",
    group: GROUP_HOSTS,
    label: FOR_AT_LEAST_LABEL,
    unit: "minutes",
    maxValue: VMWARE_HEALTH_MAX_EVALUATION_MINUTES,
  },
  {
    key: "datastoreWarningPercent",
    group: GROUP_DATASTORES,
    label: translationKey("Warning Above"),
    unit: "percent",
    maxValue: 100,
  },
  {
    key: "datastoreCriticalPercent",
    group: GROUP_DATASTORES,
    label: translationKey("Critical Above"),
    unit: "percent",
    maxValue: 100,
  },
  {
    key: "datastoreEvaluationMinutes",
    group: GROUP_DATASTORES,
    label: FOR_AT_LEAST_LABEL,
    unit: "minutes",
    maxValue: VMWARE_HEALTH_MAX_EVALUATION_MINUTES,
  },
  {
    key: "vmSwapOutCriticalKibPerSecond",
    group: GROUP_VM_SWAPPING,
    label: translationKey("Swapping Out: Critical Above"),
    unit: "kibPerSecond",
  },
  {
    key: "vmSwapInWarningKibPerSecond",
    group: GROUP_VM_SWAPPING,
    label: translationKey("Reading Back: Warning Above"),
    unit: "kibPerSecond",
  },
  {
    key: "vmSwappedWarningMebibytes",
    group: GROUP_VM_SWAPPING,
    label: translationKey("Swapped Earlier: Warning Above"),
    unit: "mebibytes",
  },
  {
    key: "vmSwapEvaluationMinutes",
    group: GROUP_VM_SWAPPING,
    label: FOR_AT_LEAST_LABEL,
    unit: "minutes",
    maxValue: VMWARE_HEALTH_MAX_EVALUATION_MINUTES,
  },
  {
    key: "vmBalloonedWarningMebibytes",
    group: GROUP_VM_MEMORY_CPU,
    label: translationKey("Ballooned: Warning Above"),
    unit: "mebibytes",
  },
  {
    key: "vmCpuReadyWarningPercent",
    group: GROUP_VM_MEMORY_CPU,
    label: translationKey("CPU Ready: Warning Above"),
    unit: "percent",
    maxValue: 100,
  },
  {
    key: "vmMemoryCpuEvaluationMinutes",
    group: GROUP_VM_MEMORY_CPU,
    label: FOR_AT_LEAST_LABEL,
    unit: "minutes",
    maxValue: VMWARE_HEALTH_MAX_EVALUATION_MINUTES,
  },
  {
    key: "resourcePoolSwapOutWarningKibPerSecond",
    group: GROUP_RESOURCE_POOLS,
    label: translationKey("Swapping Out: Warning Above"),
    unit: "kibPerSecond",
  },
  {
    key: "resourcePoolEvaluationMinutes",
    group: GROUP_RESOURCE_POOLS,
    label: FOR_AT_LEAST_LABEL,
    unit: "minutes",
    maxValue: VMWARE_HEALTH_MAX_EVALUATION_MINUTES,
  },
];

export function getVMwareHealthRuleWords(
  key: VMwareHealthRuleKey,
): VMwareHealthRuleWords {
  return VMWARE_HEALTH_RULE_WORDS.find((words: VMwareHealthRuleWords) => {
    return words.key === key;
  })!;
}

// The rules an override of a scope may change, in the page's order.
export function getVMwareHealthRuleWordsForScope(
  scope: VMwareHealthRuleScope,
): Array<VMwareHealthRuleWords> {
  const allowed: ReadonlyArray<VMwareHealthRuleKey> =
    VMWARE_HEALTH_RULE_SCOPE_RULES[scope];
  return VMWARE_HEALTH_RULE_WORDS.filter((words: VMwareHealthRuleWords) => {
    return allowed.includes(words.key);
  });
}

export const VALUE_OFF: string = translationKey("Off");
export const VALUE_ANY: string = translationKey("Any");
export const VALUE_LATEST_REPORT: string = translationKey("Latest report");
export const VALUE_ABOVE_PERCENT: string = translationKey("Above {{percent}}%");
export const VALUE_ABOVE_RATE: string = translationKey("Above {{rate}} KiB/s");
export const VALUE_ABOVE_AMOUNT: string = translationKey(
  "Above {{amount}} MiB",
);
export const VALUE_FOR_MINUTES: string = translationKey(
  "For at least {{minutes}} min",
);

// How a rule's value reads, as an English template and its values.
export interface VMwareHealthRuleValueText {
  text: string;
  values?: { [key: string]: number } | undefined;
}

/*
 * "Above 90%", "Above 1,024 KiB/s", "Above 512 MiB", "Any" for a threshold
 * of 0, "Off" for none; a wait "For at least 10 min", or "Latest report"
 * for 0 or none. The number is handed as one, for the reader's digits.
 */
export function getVMwareHealthRuleValueText(
  key: VMwareHealthRuleKey,
  value: unknown,
): VMwareHealthRuleValueText {
  const number: number | null =
    value === null || value === undefined || value === ""
      ? null
      : Number(value);
  const isNumber: boolean = number !== null && Number.isFinite(number);

  if (isVMwareHealthPeriodRuleKey(key)) {
    if (!isNumber || number! <= 0) {
      return { text: VALUE_LATEST_REPORT };
    }
    return { text: VALUE_FOR_MINUTES, values: { minutes: number! } };
  }

  if (!isNumber) {
    return { text: VALUE_OFF };
  }
  if (number === 0) {
    return { text: VALUE_ANY };
  }

  switch (getVMwareHealthRuleWords(key).unit) {
    case "percent":
      return { text: VALUE_ABOVE_PERCENT, values: { percent: number! } };
    case "kibPerSecond":
      return { text: VALUE_ABOVE_RATE, values: { rate: number! } };
    default:
      return { text: VALUE_ABOVE_AMOUNT, values: { amount: number! } };
  }
}

// The words of what each scope is, as an override's "Applies To" says it.
export const SCOPE_VCENTER: string = translationKey("Whole vCenter");
export const SCOPE_CLUSTER: string = translationKey("Cluster");
export const SCOPE_HOST: string = translationKey("ESXi Host");
export const SCOPE_VIRTUAL_MACHINE: string = translationKey("Virtual Machine");

export const VMWARE_HEALTH_RULE_SCOPE_WORDS: Readonly<
  Record<VMwareHealthRuleScope, string>
> = {
  [VMwareHealthRuleScope.VCenter]: SCOPE_VCENTER,
  [VMwareHealthRuleScope.Cluster]: SCOPE_CLUSTER,
  [VMwareHealthRuleScope.Host]: SCOPE_HOST,
  [VMwareHealthRuleScope.VirtualMachine]: SCOPE_VIRTUAL_MACHINE,
};
