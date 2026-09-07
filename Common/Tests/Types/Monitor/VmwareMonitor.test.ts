import MetricQueryConfigData from "../../../Types/Metrics/MetricQueryConfigData";
import MonitorStepVmwareMonitor, {
  MonitorStepVmwareMonitorUtil,
  VmwareResourceType,
  VMWARE_RESOURCE_ATTRIBUTE,
  VMWARE_RESOURCE_TYPE_ATTRIBUTE,
  VMWARE_SOURCE_ATTRIBUTE,
  VMWARE_RESOURCE_GROUP_KEYS,
} from "../../../Types/Monitor/MonitorStepVmwareMonitor";
import {
  buildVmwareMonitorConfig,
  getVmwareAlertTemplates,
  VmwareAlertTemplate,
} from "../../../Types/Monitor/VmwareAlertTemplates";
import {
  getVmwareMetricCatalog,
  VmwareMetricDefinition,
} from "../../../Types/Monitor/VmwareMetricCatalog";
import MonitorType, {
  MonitorTypeHelper,
} from "../../../Types/Monitor/MonitorType";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import MetricsAggregationType from "../../../Types/Metrics/MetricsAggregationType";
import RollingTime from "../../../Types/RollingTime/RollingTime";
import ObjectID from "../../../Types/ObjectID";
import {
  NoDataPolicy,
  CriteriaFilter,
} from "../../../Types/Monitor/CriteriaFilter";

function config(): MonitorStepVmwareMonitor {
  return buildVmwareMonitorConfig({
    sourceIdentifier: "vc-a",
    metricName: "oneuptime.vmware.vm.cpu.utilization",
    metricAlias: "cpu",
    rollingTime: RollingTime.Past5Minutes,
    aggregationType: MetricsAggregationType.Avg,
    resourceType: VmwareResourceType.VM,
    resourceIdentifier: "uuid-a",
  });
}

describe("VMware monitoring configuration", () => {
  test("is discoverable telemetry monitoring, evaluated without a probe", () => {
    expect(MonitorTypeHelper.isTelemetryMonitor(MonitorType.VMware)).toBe(true);
    expect(MonitorTypeHelper.isProbableMonitor(MonitorType.VMware)).toBe(false);
    expect(
      MonitorCriteriaInstance.isMetricBackedMonitorType(MonitorType.VMware),
    ).toBe(true);
    expect(MonitorTypeHelper.getKeywords(MonitorType.VMware)).toEqual(
      expect.arrayContaining(["esxi", "vcenter"]),
    );
  });
  test("enforces selected source and stable identity even for API-supplied grouping", () => {
    const input: MonitorStepVmwareMonitor = config();
    const query: MetricQueryConfigData =
      input.metricViewConfig.queryConfigs[0]!;
    query.metricQueryData.filterData.attributes = {
      [VMWARE_SOURCE_ATTRIBUTE]: "different",
      "resource.oneuptime.vmware.resource.name": "display",
    };
    query.metricQueryData.groupByAttributeKeys = [
      "resource.oneuptime.vmware.resource.name",
    ];
    const result: MetricQueryConfigData =
      MonitorStepVmwareMonitorUtil.toMetricMonitor(input).metricViewConfig
        .queryConfigs[0]!;
    expect(result.metricQueryData.groupByAttributeKeys).toEqual(
      VMWARE_RESOURCE_GROUP_KEYS,
    );
    expect(result.metricQueryData.filterData.attributes).toMatchObject({
      [VMWARE_SOURCE_ATTRIBUTE]: "vc-a",
      [VMWARE_RESOURCE_ATTRIBUTE]: "uuid-a",
      [VMWARE_RESOURCE_TYPE_ATTRIBUTE]: "vm",
    });
    expect(
      query.metricQueryData.filterData.attributes[VMWARE_SOURCE_ATTRIBUTE],
    ).toBe("different");
  });
  test("clearing a resource selection clears previously enforced query filters", () => {
    const input: MonitorStepVmwareMonitor = config();
    input.resourceFilters = {};
    const attributes: MetricQueryConfigData["metricQueryData"]["filterData"]["attributes"] =
      MonitorStepVmwareMonitorUtil.toMetricMonitor(input).metricViewConfig
        .queryConfigs[0]!.metricQueryData.filterData.attributes;
    expect(attributes).toEqual({ [VMWARE_SOURCE_ATTRIBUTE]: "vc-a" });
  });
  test("collection queries never inherit VM filters or identity", () => {
    const input: MonitorStepVmwareMonitor = config();
    input.metricViewConfig.queryConfigs[0]!.metricQueryData.filterData.metricName =
      "oneuptime.vmware.source.up";
    const query: MetricQueryConfigData =
      MonitorStepVmwareMonitorUtil.toMetricMonitor(input).metricViewConfig
        .queryConfigs[0]!;
    expect(query.metricQueryData.groupByAttributeKeys).toEqual([
      VMWARE_SOURCE_ATTRIBUTE,
    ]);
    expect(query.metricQueryData.filterData.attributes).toEqual({
      [VMWARE_SOURCE_ATTRIBUTE]: "vc-a",
    });
  });
  test("normalizes malformed saved configurations without crashing the form", () => {
    expect(
      MonitorStepVmwareMonitorUtil.fromJSON({
        sourceIdentifier: "vc-a",
        metricViewConfig: null,
      }).metricViewConfig.queryConfigs,
    ).toEqual([]);
    expect(
      MonitorStepVmwareMonitorUtil.getValidationError(
        MonitorStepVmwareMonitorUtil.getDefault(),
      ),
    ).toMatch(/source/);
  });
  test.each(["", " vc-a", "vc-a "])(
    "rejects blank or ambiguous source %j",
    (sourceIdentifier: string) => {
      expect(
        MonitorStepVmwareMonitorUtil.getValidationError({
          ...config(),
          sourceIdentifier,
        }),
      ).toMatch(/source/);
    },
  );
  test("rejects mixing source and resource scopes", () => {
    const input: MonitorStepVmwareMonitor = config();
    const other: MonitorStepVmwareMonitor = config();
    other.metricViewConfig.queryConfigs[0]!.metricQueryData.filterData.metricName =
      "oneuptime.vmware.source.up";
    input.metricViewConfig.queryConfigs.push(
      other.metricViewConfig.queryConfigs[0]!,
    );
    expect(MonitorStepVmwareMonitorUtil.getValidationError(input)).toMatch(
      /separate/,
    );
  });
  test("rejects external metric names and ambiguous resource ids", () => {
    const input: MonitorStepVmwareMonitor = config();
    input.metricViewConfig.queryConfigs[0]!.metricQueryData.filterData.metricName =
      "vcenter.vm.cpu.utilization";
    expect(MonitorStepVmwareMonitorUtil.getValidationError(input)).toMatch(
      /Agent/,
    );
    input.metricViewConfig.queryConfigs[0]!.metricQueryData.filterData.metricName =
      "oneuptime.vmware.vm.cpu.utilization";
    input.resourceFilters.resourceType = undefined;
    expect(MonitorStepVmwareMonitorUtil.getValidationError(input)).toMatch(
      /resource type/,
    );
  });
  test("round trips a native VMware step and exposes its metric aliases", () => {
    const step: MonitorStep = new MonitorStep();
    step.data!.vmwareMonitor = config();
    const restored: MonitorStep = MonitorStep.fromJSON(step.toJSON());
    expect(restored.data?.vmwareMonitor).toEqual(step.data!.vmwareMonitor);
    expect(MonitorStep.getMetricsViewConfig(restored)).toEqual(
      step.data!.vmwareMonitor.metricViewConfig,
    );
    expect(MonitorStep.getGroupByAttributeKeys(restored)).toEqual(
      VMWARE_RESOURCE_GROUP_KEYS,
    );
  });
});

describe("VMware alert catalog", () => {
  const id: ObjectID = ObjectID.generate();
  test("every template references a documented collected metric and has stable grouping", () => {
    const names: Set<string> = new Set(
      getVmwareMetricCatalog().map(
        (metric: VmwareMetricDefinition) => metric.metricName,
      ),
    );
    const templateIds: Set<string> = new Set();
    for (const template of getVmwareAlertTemplates()) {
      expect(templateIds.has(template.id)).toBe(false);
      templateIds.add(template.id);
      const step: MonitorStep = template.getMonitorStep({
        sourceIdentifier: "vc-a",
        monitorName: template.name,
        onlineMonitorStatusId: id,
        offlineMonitorStatusId: ObjectID.generate(),
        defaultIncidentSeverityId: id,
        defaultAlertSeverityId: id,
      });
      const input: MonitorStepVmwareMonitor = step.data!.vmwareMonitor!;
      expect(
        MonitorStepVmwareMonitorUtil.getValidationError(input),
      ).toBeUndefined();
      expect(
        names.has(
          input.metricViewConfig.queryConfigs[0]!.metricQueryData.filterData
            .metricName,
        ),
      ).toBe(true);
      expect(input.rollingTime).toBe(RollingTime.Past5Minutes);
      expect(
        step.data!.monitorCriteria.data!.monitorCriteriaInstanceArray,
      ).toHaveLength(2);
      const policies: Array<NoDataPolicy | undefined> =
        step.data!.monitorCriteria.data!.monitorCriteriaInstanceArray[0]!.data!.filters.map(
          (filter: CriteriaFilter) =>
            filter.metricMonitorOptions?.onNoDataPolicy,
        );
      if (template.category === "Collection") {
        expect(policies).toEqual([NoDataPolicy.Trigger]);
      } else {
        expect(policies).not.toContain(NoDataPolicy.Trigger);
        expect(policies).not.toContain(NoDataPolicy.TreatAsZero);
      }
    }
    expect(templateIds.size).toBeGreaterThanOrEqual(10);
  });
  test("keeps utilization in percentage units and expected-off checks opt-in", () => {
    for (const metric of getVmwareMetricCatalog().filter(
      (item: VmwareMetricDefinition) => item.metricName.endsWith("utilization"),
    )) {
      expect(metric.unit).toBe("%");
    }
    const template: VmwareAlertTemplate = getVmwareAlertTemplates().find(
      (item: VmwareAlertTemplate) => item.id === "vmware-vm-unexpected-off",
    )!;
    expect(template.description).toMatch(/explicitly expected/);
  });
});
