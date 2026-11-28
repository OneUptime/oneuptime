import {
  CriteriaFilter,
  FilterType,
  NoDataPolicy,
} from "../../../Types/Monitor/CriteriaFilter";
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import MetricQueryConfigData from "../../../Types/Metrics/MetricQueryConfigData";
import {
  VMWARE_LEGACY_SWAP_QUERIES,
  VMwareLegacySwapMatch,
  getVMwareLegacySwapMatches,
  hasVMwareLegacySwapMonitorSteps,
  updateVMwareLegacySwapMonitorSteps,
} from "../../../Types/Monitor/VMwareLegacySwapMonitors";
import {
  VMwareAlertTemplate,
  VMwareAlertTemplateArgs,
  getVMwareAlertTemplateById,
} from "../../../Types/Monitor/VMwareAlertTemplates";
import ObjectID from "../../../Types/ObjectID";
import { VMwareSwapRateMetric } from "../../../Types/VMware/VMwareSwapRates";
import { describe, expect, test } from "@jest/globals";

/*
 * Monitors made from the VM Memory Swapping or Resource Pool Memory Swapped
 * template before #11468 fire on any memory in the host's swap file - what
 * ESXi keeps for weeks after the pressure that put it there has gone. They
 * are not changed behind their owner's back: their page offers an update,
 * which changes only what they read - the metric, and the template's own
 * alias for it - and leaves every threshold, incident, alert and recipient
 * as it was. Built from the templates' own old versions, so a monitor made
 * on the day #11419 shipped is the one tested.
 */

const ARGS: VMwareAlertTemplateArgs = {
  vcenterIdentifier: "vcsa-prod",
  onlineMonitorStatusId: ObjectID.generate(),
  offlineMonitorStatusId: ObjectID.generate(),
  defaultIncidentSeverityId: ObjectID.generate(),
  defaultAlertSeverityId: ObjectID.generate(),
  monitorName: "Prod",
};

function template(id: string): VMwareAlertTemplate {
  return getVMwareAlertTemplateById(id)!;
}

// The step a monitor made from the template before #11468 holds.
function legacyStep(id: string): MonitorStep {
  return template(id).getEquivalentMonitorSteps!(ARGS)[0]!;
}

function stepsOf(steps: Array<MonitorStep>): MonitorSteps {
  const monitorSteps: MonitorSteps = new MonitorSteps();
  monitorSteps.data = {
    monitorStepsInstanceArray: steps,
    defaultMonitorStatusId: ObjectID.generate(),
  };
  // As the monitor's row holds it: read back from its JSON.
  return MonitorSteps.fromJSON(monitorSteps.toJSON());
}

function queriesOf(step: MonitorStep): Array<MetricQueryConfigData> {
  return step.data!.vmwareMonitor!.metricViewConfig.queryConfigs;
}

function instancesOf(step: MonitorStep): Array<MonitorCriteriaInstance> {
  return step.data!.monitorCriteria!.data!.monitorCriteriaInstanceArray;
}

function firstStep(steps: MonitorSteps): MonitorStep {
  return steps.data!.monitorStepsInstanceArray[0]!;
}

describe("the old versions", () => {
  test("read the swapped amount above 0, as #11419 shipped them", () => {
    for (const [id, metricName, alias] of [
      ["vmware-vm-memory-swapping", "vcenter.vm.memory.swapped", "vm_memory_swapped"],
      [
        "vmware-resource-pool-memory-swapped",
        "vcenter.resource_pool.memory.swapped",
        "resource_pool_memory_swapped",
      ],
    ] as Array<[string, string, string]>) {
      const step: MonitorStep = legacyStep(id);
      expect(queriesOf(step)[0]!.metricQueryData.filterData.metricName).toBe(
        metricName,
      );
      expect(queriesOf(step)[0]!.metricAliasData!.metricVariable).toBe(alias);
      const fire: CriteriaFilter = instancesOf(step)[0]!.data!.filters[0]!;
      expect(fire.filterType).toBe(FilterType.GreaterThan);
      expect(fire.value).toBe(0);
    }
  });

  test("are listed once each, with what the new version reads instead", () => {
    expect(
      VMWARE_LEGACY_SWAP_QUERIES.map((query) => {
        return [query.templateId, query.swappedMetricName, query.rateMetricName];
      }),
    ).toEqual([
      [
        "vmware-vm-memory-swapping",
        "vcenter.vm.memory.swapped",
        VMwareSwapRateMetric.VirtualMachineSwapOut,
      ],
      [
        "vmware-resource-pool-memory-swapped",
        "vcenter.resource_pool.memory.swapped",
        VMwareSwapRateMetric.ResourcePoolSwapOut,
      ],
    ]);
  });
});

describe("which monitors fire on any swapped memory", () => {
  test("one made from either old version", () => {
    for (const id of [
      "vmware-vm-memory-swapping",
      "vmware-resource-pool-memory-swapped",
    ]) {
      const matches: Array<VMwareLegacySwapMatch> = getVMwareLegacySwapMatches(
        stepsOf([legacyStep(id)]),
      );
      expect(matches).toHaveLength(1);
      expect(matches[0]!.stepIndex).toBe(0);
      expect(matches[0]!.query.templateId).toBe(id);
    }
  });

  test("not one made from the new version, nor from VM Swapped Memory High", () => {
    for (const id of [
      "vmware-vm-memory-swapping",
      "vmware-resource-pool-memory-swapped",
      "vmware-vm-swapped-memory-high",
      "vmware-vm-memory-ballooning",
    ]) {
      expect(
        hasVMwareLegacySwapMonitorSteps(
          stepsOf([template(id).getMonitorStep(ARGS)]),
        ),
      ).toBe(false);
    }
  });

  test("one written by hand the same way, under an alias of its own", () => {
    const step: MonitorStep = legacyStep("vmware-vm-memory-swapping");
    queriesOf(step)[0]!.metricAliasData!.metricVariable = "swap";
    for (const instance of instancesOf(step)) {
      for (const filter of [
        ...(instance.data!.filters || []),
        ...(instance.data!.recoveryFilters || []),
      ]) {
        filter.metricMonitorOptions!.metricAlias = "swap";
      }
    }
    const matches: Array<VMwareLegacySwapMatch> = getVMwareLegacySwapMatches(
      stepsOf([step]),
    );
    expect(matches.map((match: VMwareLegacySwapMatch) => {
      return match.alias;
    })).toEqual(["swap"]);
  });

  test("not one whose owner chose an amount: above 512 MiB is a choice, not the bug", () => {
    const step: MonitorStep = legacyStep("vmware-vm-memory-swapping");
    instancesOf(step)[0]!.data!.filters[0]!.value = 512;
    expect(hasVMwareLegacySwapMonitorSteps(stepsOf([step]))).toBe(false);
  });

  test("not a monitor of another kind, nor none", () => {
    expect(hasVMwareLegacySwapMonitorSteps(undefined)).toBe(false);
    expect(hasVMwareLegacySwapMonitorSteps(null)).toBe(false);
    expect(hasVMwareLegacySwapMonitorSteps(new MonitorSteps())).toBe(false);
  });

  test("names each step it is found in, among others", () => {
    const steps: MonitorSteps = stepsOf([
      template("vmware-host-cpu-saturation").getMonitorStep(ARGS),
      legacyStep("vmware-resource-pool-memory-swapped"),
      legacyStep("vmware-vm-memory-swapping"),
    ]);
    expect(
      getVMwareLegacySwapMatches(steps).map((match: VMwareLegacySwapMatch) => {
        return [match.stepIndex, match.query.templateId];
      }),
    ).toEqual([
      [1, "vmware-resource-pool-memory-swapped"],
      [2, "vmware-vm-memory-swapping"],
    ]);
  });
});

describe("the update", () => {
  test("is the new template, for a monitor made from the old one", () => {
    for (const id of [
      "vmware-vm-memory-swapping",
      "vmware-resource-pool-memory-swapped",
    ]) {
      const updated: MonitorStep = firstStep(
        updateVMwareLegacySwapMonitorSteps(stepsOf([legacyStep(id)])),
      );
      const shipped: MonitorStep = template(id).getMonitorStep(ARGS);

      expect(queriesOf(updated)).toEqual(queriesOf(shipped));
      const updatedFilters: Array<Array<CriteriaFilter>> = instancesOf(
        updated,
      ).map((instance: MonitorCriteriaInstance) => {
        return [
          ...(instance.data!.filters || []),
          ...(instance.data!.recoveryFilters || []),
        ];
      });
      const shippedFilters: Array<Array<CriteriaFilter>> = instancesOf(
        shipped,
      ).map((instance: MonitorCriteriaInstance) => {
        return [
          ...(instance.data!.filters || []),
          ...(instance.data!.recoveryFilters || []),
        ];
      });
      expect(JSON.parse(JSON.stringify(updatedFilters))).toEqual(
        JSON.parse(JSON.stringify(shippedFilters)),
      );
      // Its criteria named as the new template names them.
      expect(instancesOf(updated)[0]!.data!.name).toBe(
        instancesOf(shipped)[0]!.data!.name,
      );
      expect(instancesOf(updated)[0]!.data!.description).toBe(
        instancesOf(shipped)[0]!.data!.description,
      );
      // And no longer one to update.
      expect(
        hasVMwareLegacySwapMonitorSteps(stepsOf([updated])),
      ).toBe(false);
    }
  });

  test("keeps every threshold, incident, alert and recipient as the owner left them", () => {
    const step: MonitorStep = legacyStep("vmware-vm-memory-swapping");
    const fire: MonitorCriteriaInstance = instancesOf(step)[0]!;
    fire.data!.name = "Paging the DB team";
    fire.data!.description = "Our own words.";
    const before: string = JSON.stringify(
      instancesOf(step).map((instance: MonitorCriteriaInstance) => {
        return {
          incidents: instance.data!.incidents,
          alerts: instance.data!.alerts,
          monitorStatusId: instance.data!.monitorStatusId,
          changeMonitorStatus: instance.data!.changeMonitorStatus,
          createIncidents: instance.data!.createIncidents,
          createAlerts: instance.data!.createAlerts,
          values: (instance.data!.filters || []).map((filter: CriteriaFilter) => {
            return [filter.filterType, filter.value];
          }),
        };
      }),
    );

    const updated: MonitorStep = firstStep(
      updateVMwareLegacySwapMonitorSteps(stepsOf([step])),
    );
    expect(
      JSON.stringify(
        instancesOf(updated).map((instance: MonitorCriteriaInstance) => {
          return {
            incidents: instance.data!.incidents,
            alerts: instance.data!.alerts,
            monitorStatusId: instance.data!.monitorStatusId,
            changeMonitorStatus: instance.data!.changeMonitorStatus,
            createIncidents: instance.data!.createIncidents,
            createAlerts: instance.data!.createAlerts,
            values: (instance.data!.filters || []).map(
              (filter: CriteriaFilter) => {
                return [filter.filterType, filter.value];
              },
            ),
          };
        }),
      ),
    ).toBe(before);
    // A person's words for a criteria are theirs.
    expect(instancesOf(updated)[0]!.data!.name).toBe("Paging the DB team");
    expect(instancesOf(updated)[0]!.data!.description).toBe("Our own words.");
    // The vCenter it watches and its window too.
    expect(updated.data!.vmwareMonitor!.vcenterIdentifier).toBe("vcsa-prod");
    expect(updated.data!.vmwareMonitor!.rollingTime).toBe(
      step.data!.vmwareMonitor!.rollingTime,
    );
  });

  test("a hand-written alias stays its owner's; only the metric changes", () => {
    const step: MonitorStep = legacyStep("vmware-vm-memory-swapping");
    queriesOf(step)[0]!.metricAliasData!.metricVariable = "swap";
    for (const instance of instancesOf(step)) {
      for (const filter of [
        ...(instance.data!.filters || []),
        ...(instance.data!.recoveryFilters || []),
      ]) {
        filter.metricMonitorOptions!.metricAlias = "swap";
      }
    }
    const updated: MonitorStep = firstStep(
      updateVMwareLegacySwapMonitorSteps(stepsOf([step])),
    );
    expect(queriesOf(updated)[0]!.metricAliasData!.metricVariable).toBe("swap");
    expect(queriesOf(updated)[0]!.metricQueryData.filterData.metricName).toBe(
      VMwareSwapRateMetric.VirtualMachineSwapOut,
    );
    for (const instance of instancesOf(updated)) {
      for (const filter of instance.data!.filters || []) {
        expect(filter.metricMonitorOptions!.metricAlias).toBe("swap");
      }
    }
  });

  test("a recovery at 0 reads a rate that is gone as 0; one the owner set otherwise keeps it", () => {
    const updated: MonitorStep = firstStep(
      updateVMwareLegacySwapMonitorSteps(
        stepsOf([legacyStep("vmware-vm-memory-swapping")]),
      ),
    );
    const recover: CriteriaFilter = instancesOf(updated)[1]!.data!.filters[0]!;
    expect(recover.filterType).toBe(FilterType.EqualTo);
    expect(recover.metricMonitorOptions!.onNoDataPolicy).toBe(
      NoDataPolicy.TreatAsZero,
    );

    const owned: MonitorStep = legacyStep("vmware-vm-memory-swapping");
    instancesOf(owned)[1]!.data!.filters[0]!.metricMonitorOptions!.onNoDataPolicy =
      NoDataPolicy.Ignore;
    expect(
      instancesOf(
        firstStep(updateVMwareLegacySwapMonitorSteps(stepsOf([owned]))),
      )[1]!.data!.filters[0]!.metricMonitorOptions!.onNoDataPolicy,
    ).toBe(NoDataPolicy.Ignore);
  });

  test("is a copy: the steps handed in are left as they are", () => {
    const steps: MonitorSteps = stepsOf([
      legacyStep("vmware-vm-memory-swapping"),
    ]);
    const before: string = JSON.stringify(steps.toJSON());
    updateVMwareLegacySwapMonitorSteps(steps);
    expect(JSON.stringify(steps.toJSON())).toBe(before);
  });

  test("leaves every other step, and a monitor with nothing to update, as it was", () => {
    const cpu: MonitorStep = template("vmware-host-cpu-saturation").getMonitorStep(
      ARGS,
    );
    const steps: MonitorSteps = stepsOf([
      cpu,
      legacyStep("vmware-vm-memory-swapping"),
    ]);
    const updated: MonitorSteps = updateVMwareLegacySwapMonitorSteps(steps);
    expect(
      JSON.stringify(updated.data!.monitorStepsInstanceArray[0]!.toJSON()),
    ).toBe(JSON.stringify(steps.data!.monitorStepsInstanceArray[0]!.toJSON()));

    const untouched: MonitorSteps = stepsOf([cpu]);
    expect(
      JSON.stringify(updateVMwareLegacySwapMonitorSteps(untouched).toJSON()),
    ).toBe(JSON.stringify(untouched.toJSON()));
  });
});

describe("the Recommendations count an old monitor as the template", () => {
  test("each new template names its old version as the same monitor", () => {
    for (const id of [
      "vmware-vm-memory-swapping",
      "vmware-resource-pool-memory-swapped",
    ]) {
      const equivalents: Array<MonitorStep> =
        template(id).getEquivalentMonitorSteps!(ARGS);
      expect(equivalents).toHaveLength(1);
      expect(
        hasVMwareLegacySwapMonitorSteps(stepsOf(equivalents)),
      ).toBe(true);
    }
    // VM Swapped Memory High is new: nothing was made from it before.
    expect(
      template("vmware-vm-swapped-memory-high").getEquivalentMonitorSteps,
    ).toBeUndefined();
  });
});
