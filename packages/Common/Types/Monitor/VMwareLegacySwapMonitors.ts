import { CriteriaFilter, FilterType, NoDataPolicy } from "./CriteriaFilter";
import MonitorCriteriaInstance from "./MonitorCriteriaInstance";
import MonitorStep from "./MonitorStep";
import MonitorSteps from "./MonitorSteps";
import MetricQueryConfigData from "../Metrics/MetricQueryConfigData";
import { VMwareSwapRateMetric } from "../VMware/VMwareSwapRates";

/*
 * MONITORS THAT FIRE ON ANY SWAPPED MEMORY (#11468).
 *
 * Until #11468 the VM Memory Swapping template read
 * vcenter.vm.memory.swapped > 0, and Resource Pool Memory Swapped
 * vcenter.resource_pool.memory.swapped > 0: any memory in the host's swap
 * file, including what ESXi keeps for weeks after the pressure that put it
 * there has gone. The templates now read the rate the host swaps memory out
 * at (VMwareAlertTemplates). A monitor made from an old version - or written
 * by hand the same way - is not changed behind its owner's back: an alert is
 * theirs. Its page says what it fires on and offers the update
 * (VMwareLegacySwapMonitorNotice), and the Recommendations still count it as
 * the template, so they never offer a second one.
 *
 * The update changes only what the monitor reads: the metric of each query
 * that reads swapped memory, and the template's own alias for it wherever a
 * criteria compares it. Its thresholds, its incidents and alerts, who is
 * told, its name and everything else stay as they are. A recovery that
 * compares the rate with 0 counts a series that is gone as 0, as the new
 * templates do: the rate is written only while it is known.
 */

export interface VMwareLegacySwapQuery {
  // The template the old version was, by id.
  templateId: string;
  // What the old version reads.
  swappedMetricName: string;
  swappedAlias: string;
  // What the new version reads.
  rateMetricName: VMwareSwapRateMetric;
  rateAlias: string;
  // The criteria the old version made, and what the new one names them.
  legacyCriteriaName: string;
  criteriaName: string;
  legacyCriteriaDescription: string;
  criteriaDescription: string;
}

export const VMWARE_LEGACY_SWAP_QUERIES: ReadonlyArray<VMwareLegacySwapQuery> =
  [
    {
      templateId: "vmware-vm-memory-swapping",
      swappedMetricName: "vcenter.vm.memory.swapped",
      swappedAlias: "vm_memory_swapped",
      rateMetricName: VMwareSwapRateMetric.VirtualMachineSwapOut,
      rateAlias: "vm_memory_swap_out_rate",
      legacyCriteriaName: "VM Memory Swapping - Swapped > 0",
      criteriaName: "VM Memory Swapping - Swap Out Rate > 0",
      legacyCriteriaDescription:
        "Triggers when a virtual machine reports non-zero host-swapped memory for every minute of the monitoring window.",
      criteriaDescription:
        "Triggers when the host swaps a virtual machine's memory out to disk in every minute of the monitoring window.",
    },
    {
      templateId: "vmware-resource-pool-memory-swapped",
      swappedMetricName: "vcenter.resource_pool.memory.swapped",
      swappedAlias: "resource_pool_memory_swapped",
      rateMetricName: VMwareSwapRateMetric.ResourcePoolSwapOut,
      rateAlias: "resource_pool_memory_swap_out_rate",
      legacyCriteriaName: "Resource Pool Memory Swapped - Swapped > 0",
      criteriaName: "Resource Pool Memory Swapping - Swap Out Rate > 0",
      legacyCriteriaDescription:
        "Triggers when a resource pool reports non-zero host-swapped memory for every minute of the monitoring window.",
      criteriaDescription:
        "Triggers when the hosts swap the memory of a resource pool's VMs out to disk in every minute of the monitoring window.",
    },
  ];

// One query of a step that fires on any swapped memory.
export interface VMwareLegacySwapMatch {
  // The step's place in the monitor's steps.
  stepIndex: number;
  query: VMwareLegacySwapQuery;
  // The alias the step's criteria compare it by (the template's own, or another).
  alias: string;
}

function sameName(a: unknown, b: string): boolean {
  return typeof a === "string" && a.trim().toLowerCase() === b.toLowerCase();
}

function legacyQueryOf(metricName: unknown): VMwareLegacySwapQuery | null {
  return (
    VMWARE_LEGACY_SWAP_QUERIES.find((query: VMwareLegacySwapQuery) => {
      return sameName(metricName, query.swappedMetricName);
    }) || null
  );
}

function criteriaInstancesOf(step: MonitorStep): Array<MonitorCriteriaInstance> {
  return step.data?.monitorCriteria?.data?.monitorCriteriaInstanceArray || [];
}

function filtersOf(instance: MonitorCriteriaInstance): Array<CriteriaFilter> {
  return [
    ...(instance.data?.filters || []),
    ...(instance.data?.recoveryFilters || []),
  ];
}

// Any swapped memory at all: above 0.
function isAboveZero(filter: CriteriaFilter): boolean {
  return (
    filter.filterType === FilterType.GreaterThan &&
    Number(filter.value) === 0 &&
    filter.value !== null &&
    filter.value !== undefined &&
    String(filter.value).trim() !== ""
  );
}

/*
 * The queries of a VMware monitor's steps that read swapped memory and a
 * criteria of which fires on any of it (above 0). A query whose criteria
 * compare it with an amount someone chose is theirs, and none of these.
 */
export function getVMwareLegacySwapMatches(
  monitorSteps: MonitorSteps | null | undefined,
): Array<VMwareLegacySwapMatch> {
  const matches: Array<VMwareLegacySwapMatch> = [];

  const steps: Array<MonitorStep> =
    monitorSteps?.data?.monitorStepsInstanceArray || [];

  for (let stepIndex: number = 0; stepIndex < steps.length; stepIndex++) {
    const step: MonitorStep = steps[stepIndex]!;
    const queryConfigs: Array<MetricQueryConfigData> =
      step.data?.vmwareMonitor?.metricViewConfig?.queryConfigs || [];

    for (const queryConfig of queryConfigs) {
      const query: VMwareLegacySwapQuery | null = legacyQueryOf(
        queryConfig.metricQueryData?.filterData?.metricName,
      );
      const alias: string | undefined =
        queryConfig.metricAliasData?.metricVariable;

      if (!query || !alias) {
        continue;
      }

      const firesOnAny: boolean = criteriaInstancesOf(step).some(
        (instance: MonitorCriteriaInstance): boolean => {
          return (instance.data?.filters || []).some(
            (filter: CriteriaFilter): boolean => {
              return (
                filter.metricMonitorOptions?.metricAlias === alias &&
                isAboveZero(filter)
              );
            },
          );
        },
      );

      if (firesOnAny) {
        matches.push({ stepIndex, query, alias });
      }
    }
  }

  return matches;
}

export function hasVMwareLegacySwapMonitorSteps(
  monitorSteps: MonitorSteps | null | undefined,
): boolean {
  return getVMwareLegacySwapMatches(monitorSteps).length > 0;
}

/*
 * The same steps reading the swap-out rate instead (see the header), as a
 * copy: the steps handed in are left as they are. Steps that fire on no
 * swapped memory come back unchanged.
 */
export function updateVMwareLegacySwapMonitorSteps(
  monitorSteps: MonitorSteps,
): MonitorSteps {
  const updated: MonitorSteps = MonitorSteps.fromJSON(
    JSON.parse(JSON.stringify(monitorSteps.toJSON())),
  );

  const matches: Array<VMwareLegacySwapMatch> =
    getVMwareLegacySwapMatches(updated);

  for (const match of matches) {
    const step: MonitorStep | undefined =
      updated.data?.monitorStepsInstanceArray[match.stepIndex];

    if (!step) {
      continue;
    }

    // The template's own alias takes the new template's name; another stays.
    const newAlias: string =
      match.alias === match.query.swappedAlias
        ? match.query.rateAlias
        : match.alias;

    for (const queryConfig of step.data?.vmwareMonitor?.metricViewConfig
      ?.queryConfigs || []) {
      if (
        queryConfig.metricAliasData?.metricVariable !== match.alias ||
        !sameName(
          queryConfig.metricQueryData?.filterData?.metricName,
          match.query.swappedMetricName,
        )
      ) {
        continue;
      }

      queryConfig.metricQueryData.filterData.metricName =
        match.query.rateMetricName;

      const aliasData: MetricQueryConfigData["metricAliasData"] =
        queryConfig.metricAliasData;
      if (aliasData) {
        aliasData.metricVariable = newAlias;
        if (aliasData.title === match.alias) {
          aliasData.title = newAlias;
        }
        if (aliasData.description === match.alias) {
          aliasData.description = newAlias;
        }
        if (aliasData.legend === match.alias) {
          aliasData.legend = newAlias;
        }
      }
    }

    for (const instance of criteriaInstancesOf(step)) {
      for (const filter of filtersOf(instance)) {
        if (filter.metricMonitorOptions?.metricAlias !== match.alias) {
          continue;
        }

        filter.metricMonitorOptions.metricAlias = newAlias;

        // A rate that is gone is no swapping: the recovery reads it as 0.
        if (
          filter.filterType === FilterType.EqualTo &&
          Number(filter.value) === 0 &&
          !filter.metricMonitorOptions.onNoDataPolicy
        ) {
          filter.metricMonitorOptions.onNoDataPolicy = NoDataPolicy.TreatAsZero;
        }
      }

      // The template's own words for its criteria follow it; a person's stay.
      if (instance.data?.name === match.query.legacyCriteriaName) {
        instance.data.name = match.query.criteriaName;
      }
      if (
        instance.data?.description === match.query.legacyCriteriaDescription
      ) {
        instance.data.description = match.query.criteriaDescription;
      }
    }
  }

  return updated;
}
