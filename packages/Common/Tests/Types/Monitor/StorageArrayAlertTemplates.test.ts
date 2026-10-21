import {
  StorageArrayAlertTemplate,
  StorageArrayAlertTemplateArgs,
  StorageArrayAlertTemplateCategory,
  buildStorageArrayMonitorConfig,
  buildStorageArrayMonitorStep,
  buildStorageArrayOfflineCriteriaInstance,
  buildStorageArrayOnlineCriteriaInstance,
  getAllStorageArrayAlertTemplates,
  getStorageArrayAlertTemplateById,
  getStorageArrayAlertTemplatesByCategory,
  getStorageArrayAlertTemplatesForSystem,
} from "../../../Types/Monitor/StorageArrayAlertTemplates";
import {
  StorageArrayMetricDefinition,
  getStorageArrayMetric,
  getStorageArrayObjectLabel,
} from "../../../Types/Monitor/StorageArrayMetricCatalog";
import { getRecoveryThreshold } from "../../../Types/Monitor/Recommendation/RecommendationCriteriaBuilder";
import {
  getComplementFilterType,
  hasRecoveryDeadBand,
} from "./Utils/RecommendationCriteriaAssertions";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorStepStorageArrayMonitor, {
  StorageArrayResourceScope,
} from "../../../Types/Monitor/MonitorStepStorageArrayMonitor";
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorType from "../../../Types/Monitor/MonitorType";
import FilterCondition from "../../../Types/Filter/FilterCondition";
import {
  CriteriaFilter,
  EvaluateOverTimeType,
  FilterType,
  NoDataPolicy,
} from "../../../Types/Monitor/CriteriaFilter";
import CompareCriteria from "../../../Server/Utils/Monitor/Criteria/CompareCriteria";
import MetricsAggregationType from "../../../Types/Metrics/MetricsAggregationType";
import RollingTime from "../../../Types/RollingTime/RollingTime";
import StorageSystem from "../../../Types/StorageArray/StorageSystem";
import ObjectID from "../../../Types/ObjectID";
import { JSONObject } from "../../../Types/JSON";
import { describe, expect, test } from "@jest/globals";

/*
 * Lock in the storage array alert-template contracts. Same two layers as
 * the Ceph and VMware suites:
 *
 *   1. ENUMERATED invariants over getAllStorageArrayAlertTemplates(), so a
 *      newly added template is covered automatically: it must build a
 *      MonitorStep that validates as a Storage Array monitor and survives a
 *      JSON round trip, carry the array identity and platform, read only
 *      catalog metrics through labels the series really carries, group by
 *      the object label of the object its metric describes, use disjoint
 *      fire/recover thresholds, and — for the state-in-a-label series —
 *      recover with TreatAsZero, because those series exist only while the
 *      object is in the bad state.
 *
 *   2. A per-template expectation table pins every spec'd decision, and is
 *      exhaustive both ways: a template without a row fails loudly.
 */

const FA: StorageSystem = StorageSystem.PureStorageFlashArray;
const FB: StorageSystem = StorageSystem.PureStorageFlashBlade;

/*
 * The labels of every series a template reads, from the exporters'
 * prometheus.NewDesc calls: label -> values the exporter emits, or null for
 * a free-form label.
 */
const SERIES_LABELS: Record<string, Record<string, Array<string> | null>> = {
  purefa_alerts_open: {
    category: ["array", "hardware", "software"],
    code: null,
    component_type: null,
    created: null,
    issue: null,
    name: null,
    severity: ["info", "warning", "critical", "hidden"],
    summary: null,
  },
  purefa_array_space_utilization: {},
  purefa_array_performance_latency_usec: {
    dimension: [
      "usec_per_read_op",
      "usec_per_write_op",
      "usec_per_mirrored_write_op",
      "san_usec_per_read_op",
      "san_usec_per_write_op",
      "queue_usec_per_read_op",
      "queue_usec_per_write_op",
      "service_usec_per_read_op",
      "service_usec_per_write_op",
    ],
  },
  purefa_hw_component_status: {
    component_name: null,
    component_type: null,
    component_status: [
      "ok",
      "critical",
      "degraded",
      "device_off",
      "identifying",
      "not_installed",
      "unknown",
    ],
  },
  purefa_drive_capacity_bytes: {
    component_name: null,
    component_type: null,
    component_status: [
      "empty",
      "failed",
      "healthy",
      "identifying",
      "missing",
      "recovering",
      "unadmitted",
      "unhealthy",
      "unrecognized",
      "updating",
    ],
    component_protocol: null,
  },
  purefa_host_connectivity_info: {
    host: null,
    details: null,
    status: ["unused", "critical", "healthy"],
  },
  purefa_pod_replica_links_lag_max_msec: {
    remote: null,
    local_pod: null,
    remote_pod: null,
    direction: null,
    status: null,
  },
  purefb_alerts_open: {
    action: null,
    code: null,
    component_name: null,
    component_type: null,
    created: null,
    kburl: null,
    severity: ["info", "warning", "critical"],
    summary: null,
  },
  purefb_array_space_utilization: {
    type: ["array", "file-system", "object-store"],
  },
  purefb_hardware_health: { type: null, name: null, index: null, slot: null },
  purefb_array_performance_latency_usec: {
    protocol: ["all", "HTTP", "SMB", "NFS", "S3"],
    dimension: ["usec_per_other_op", "usec_per_read_op", "usec_per_write_op"],
  },
  purefb_file_systems_space_bytes: {
    name: null,
    nfspolicy: null,
    nfs: null,
    smb: null,
    space: [
      "snapshots",
      "total_physical",
      "unique",
      "virtual",
      "total_provisioned",
      "available_provisioned",
      "available_ratio",
      "destroyed",
      "destroyed_virtual",
      "shared",
      "provisioned",
    ],
  },
};

/*
 * Series that carry the state in a LABEL with the value 1 (or a drive's
 * capacity): a filtered series exists only while the object is in that
 * state. Absence is healthy, so recovery must read no data as 0.
 */
const STATE_IN_A_LABEL_METRICS: Set<string> = new Set<string>([
  "purefa_alerts_open",
  "purefb_alerts_open",
  "purefa_hw_component_status",
  "purefa_drive_capacity_bytes",
  "purefa_host_connectivity_info",
]);

/*
 * purefb_hardware_health only ever emits 0 (unhealthy), 1 (healthy) and 2
 * (unused): a code, not a level. The shared 10% recovery dead band would
 * put recovery at `>= 1.1`, reachable by an empty slot but never by a
 * repaired blade.
 */
const BINARY_FLAG_METRICS: Set<string> = new Set<string>([
  "purefb_hardware_health",
]);

interface Threshold {
  filterType: FilterType;
  value: number;
}

interface TemplateExpectation {
  id: string;
  system: StorageSystem;
  category: StorageArrayAlertTemplateCategory;
  severity: "Critical" | "Warning";
  rollingTime: RollingTime;
  aggregation: MetricsAggregationType;
  alias: string;
  metricName: string;
  attributes: Record<string, string>;
  groupBy: string | null;
  fire: Threshold;
  recoverFilterType: FilterType;
  treatNoDataAsZero: boolean;
}

function alertTemplate(
  id: string,
  system: StorageSystem,
  severity: "critical" | "warning",
): TemplateExpectation {
  return {
    id,
    system,
    category: "Array Health",
    severity: severity === "critical" ? "Critical" : "Warning",
    rollingTime: RollingTime.Past5Minutes,
    aggregation: MetricsAggregationType.Max,
    alias: `${severity}_alerts`,
    metricName: system === FA ? "purefa_alerts_open" : "purefb_alerts_open",
    attributes: { severity },
    groupBy: "summary",
    fire: { filterType: FilterType.GreaterThan, value: 0 },
    recoverFilterType: FilterType.EqualTo,
    treatNoDataAsZero: true,
  };
}

function capacityTemplate(
  id: string,
  system: StorageSystem,
  percent: 80 | 90,
): TemplateExpectation {
  return {
    id,
    system,
    category: "Capacity",
    severity: percent === 90 ? "Critical" : "Warning",
    rollingTime:
      percent === 90 ? RollingTime.Past5Minutes : RollingTime.Past15Minutes,
    aggregation: MetricsAggregationType.Max,
    alias: "capacity_used_percent",
    metricName:
      system === FA
        ? "purefa_array_space_utilization"
        : "purefb_array_space_utilization",
    attributes: system === FA ? {} : { type: "array" },
    groupBy: null,
    fire: { filterType: FilterType.GreaterThan, value: percent },
    recoverFilterType: FilterType.LessThanOrEqualTo,
    treatNoDataAsZero: false,
  };
}

const EXPECTED_TEMPLATES: Array<TemplateExpectation> = [
  alertTemplate("purefa-critical-alerts", FA, "critical"),
  alertTemplate("purefa-warning-alerts", FA, "warning"),
  capacityTemplate("purefa-capacity-high", FA, 80),
  capacityTemplate("purefa-capacity-critical", FA, 90),
  {
    id: "purefa-read-latency-high",
    system: FA,
    category: "Performance",
    severity: "Warning",
    rollingTime: RollingTime.Past10Minutes,
    aggregation: MetricsAggregationType.Avg,
    alias: "read_latency_usec",
    metricName: "purefa_array_performance_latency_usec",
    attributes: { dimension: "usec_per_read_op" },
    groupBy: null,
    // 5 ms, in the series' own microseconds.
    fire: { filterType: FilterType.GreaterThan, value: 5000 },
    recoverFilterType: FilterType.LessThanOrEqualTo,
    treatNoDataAsZero: false,
  },
  {
    id: "purefa-write-latency-high",
    system: FA,
    category: "Performance",
    severity: "Warning",
    rollingTime: RollingTime.Past10Minutes,
    aggregation: MetricsAggregationType.Avg,
    alias: "write_latency_usec",
    metricName: "purefa_array_performance_latency_usec",
    attributes: { dimension: "usec_per_write_op" },
    groupBy: null,
    fire: { filterType: FilterType.GreaterThan, value: 5000 },
    recoverFilterType: FilterType.LessThanOrEqualTo,
    treatNoDataAsZero: false,
  },
  {
    id: "purefa-hardware-critical",
    system: FA,
    category: "Hardware",
    severity: "Critical",
    rollingTime: RollingTime.Past5Minutes,
    aggregation: MetricsAggregationType.Max,
    alias: "critical_components",
    metricName: "purefa_hw_component_status",
    attributes: { component_status: "critical" },
    groupBy: "component_name",
    fire: { filterType: FilterType.GreaterThan, value: 0 },
    recoverFilterType: FilterType.EqualTo,
    treatNoDataAsZero: true,
  },
  {
    id: "purefa-hardware-degraded",
    system: FA,
    category: "Hardware",
    severity: "Warning",
    rollingTime: RollingTime.Past5Minutes,
    aggregation: MetricsAggregationType.Max,
    alias: "degraded_components",
    metricName: "purefa_hw_component_status",
    attributes: { component_status: "degraded" },
    groupBy: "component_name",
    fire: { filterType: FilterType.GreaterThan, value: 0 },
    recoverFilterType: FilterType.EqualTo,
    treatNoDataAsZero: true,
  },
  {
    id: "purefa-drive-failed",
    system: FA,
    category: "Hardware",
    severity: "Critical",
    rollingTime: RollingTime.Past5Minutes,
    aggregation: MetricsAggregationType.Max,
    alias: "failed_drives",
    metricName: "purefa_drive_capacity_bytes",
    attributes: { component_status: "failed" },
    groupBy: "component_name",
    fire: { filterType: FilterType.GreaterThan, value: 0 },
    recoverFilterType: FilterType.EqualTo,
    treatNoDataAsZero: true,
  },
  {
    id: "purefa-host-connectivity-critical",
    system: FA,
    category: "Hosts",
    severity: "Warning",
    rollingTime: RollingTime.Past5Minutes,
    aggregation: MetricsAggregationType.Max,
    alias: "hosts_without_redundancy",
    metricName: "purefa_host_connectivity_info",
    attributes: { status: "critical" },
    groupBy: "host",
    fire: { filterType: FilterType.GreaterThan, value: 0 },
    recoverFilterType: FilterType.EqualTo,
    treatNoDataAsZero: true,
  },
  {
    id: "purefa-replica-link-lag",
    system: FA,
    category: "Replication",
    severity: "Warning",
    rollingTime: RollingTime.Past10Minutes,
    aggregation: MetricsAggregationType.Max,
    alias: "replica_lag_ms",
    metricName: "purefa_pod_replica_links_lag_max_msec",
    attributes: {},
    groupBy: "local_pod",
    // 60 s, in the series' own milliseconds.
    fire: { filterType: FilterType.GreaterThan, value: 60000 },
    recoverFilterType: FilterType.LessThanOrEqualTo,
    treatNoDataAsZero: false,
  },
  alertTemplate("purefb-critical-alerts", FB, "critical"),
  alertTemplate("purefb-warning-alerts", FB, "warning"),
  capacityTemplate("purefb-capacity-high", FB, 80),
  capacityTemplate("purefb-capacity-critical", FB, 90),
  {
    id: "purefb-hardware-unhealthy",
    system: FB,
    category: "Hardware",
    severity: "Critical",
    rollingTime: RollingTime.Past5Minutes,
    aggregation: MetricsAggregationType.Min,
    alias: "hardware_health",
    metricName: "purefb_hardware_health",
    attributes: {},
    groupBy: "name",
    fire: { filterType: FilterType.LessThan, value: 1 },
    recoverFilterType: FilterType.GreaterThanOrEqualTo,
    treatNoDataAsZero: false,
  },
  {
    id: "purefb-read-latency-high",
    system: FB,
    category: "Performance",
    severity: "Warning",
    rollingTime: RollingTime.Past10Minutes,
    aggregation: MetricsAggregationType.Avg,
    alias: "read_latency_usec",
    metricName: "purefb_array_performance_latency_usec",
    attributes: { dimension: "usec_per_read_op", protocol: "all" },
    groupBy: null,
    // 10 ms, in microseconds.
    fire: { filterType: FilterType.GreaterThan, value: 10000 },
    recoverFilterType: FilterType.LessThanOrEqualTo,
    treatNoDataAsZero: false,
  },
  {
    id: "purefb-file-system-near-full",
    system: FB,
    category: "File Systems",
    severity: "Warning",
    rollingTime: RollingTime.Past15Minutes,
    aggregation: MetricsAggregationType.Min,
    alias: "available_ratio",
    metricName: "purefb_file_systems_space_bytes",
    attributes: { space: "available_ratio" },
    groupBy: "name",
    fire: { filterType: FilterType.LessThan, value: 0.1 },
    recoverFilterType: FilterType.GreaterThanOrEqualTo,
    treatNoDataAsZero: false,
  },
];

function buildArgs(): StorageArrayAlertTemplateArgs {
  return {
    arrayIdentifier: "pure-prod-01",
    onlineMonitorStatusId: ObjectID.generate(),
    offlineMonitorStatusId: ObjectID.generate(),
    defaultIncidentSeverityId: ObjectID.generate(),
    defaultAlertSeverityId: ObjectID.generate(),
    monitorName: "Test Monitor",
  };
}

function getStorageArrayMonitor(
  step: MonitorStep,
): MonitorStepStorageArrayMonitor {
  const monitor: MonitorStepStorageArrayMonitor | undefined =
    step.data?.storageArrayMonitor;
  if (!monitor) {
    throw new Error("storageArrayMonitor missing from monitor step");
  }
  return monitor;
}

function getCriteriaInstances(
  step: MonitorStep,
): Array<MonitorCriteriaInstance> {
  const instances: Array<MonitorCriteriaInstance> | undefined =
    step.data?.monitorCriteria.data?.monitorCriteriaInstanceArray;
  if (!instances || instances.length === 0) {
    throw new Error("monitorCriteria missing from monitor step");
  }
  return instances;
}

function queryConfigsOf(step: MonitorStep): Array<any> {
  return getStorageArrayMonitor(step).metricViewConfig
    .queryConfigs as Array<any>;
}

function filtersOf(instance: MonitorCriteriaInstance): Array<CriteriaFilter> {
  return (instance.data?.filters || []) as Array<CriteriaFilter>;
}

function systemOf(template: StorageArrayAlertTemplate): StorageSystem {
  expect(template.storageSystems).toHaveLength(1);
  return template.storageSystems[0]!;
}

function isBinaryFlagTemplate(step: MonitorStep): boolean {
  return queryConfigsOf(step).some((queryConfig: any) => {
    return BINARY_FLAG_METRICS.has(
      queryConfig.metricQueryData.filterData.metricName,
    );
  });
}

function expectedRecoveryValue(fire: Threshold, isBinary: boolean): number {
  if (isBinary) {
    return fire.value;
  }
  return (
    getRecoveryThreshold({ filterType: fire.filterType, value: fire.value }) ??
    fire.value
  );
}

// Run a filter through the real evaluator against a window holding one value.
function matchesSustainedWindow(
  filter: CriteriaFilter,
  value: number,
): boolean {
  return (
    CompareCriteria.compareCriteriaNumbers({
      value: [value, value, value, value, value],
      threshold: filter.value as number,
      criteriaFilter: filter,
    }) !== null
  );
}

const ALL_TEMPLATES: Array<StorageArrayAlertTemplate> =
  getAllStorageArrayAlertTemplates();

const TEMPLATE_CASES: Array<[string, StorageArrayAlertTemplate]> =
  ALL_TEMPLATES.map(
    (
      template: StorageArrayAlertTemplate,
    ): [string, StorageArrayAlertTemplate] => {
      return [template.id, template];
    },
  );

describe("StorageArrayAlertTemplates - registry", () => {
  test("template ids are unique and match the expectation table exactly", () => {
    const ids: Array<string> = ALL_TEMPLATES.map(
      (t: StorageArrayAlertTemplate) => {
        return t.id;
      },
    );
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual(
      EXPECTED_TEMPLATES.map((t: TemplateExpectation) => {
        return t.id;
      }).sort(),
    );
  });

  test("ships eighteen templates: eleven FlashArray, seven FlashBlade", () => {
    expect(ALL_TEMPLATES).toHaveLength(18);
    expect(getStorageArrayAlertTemplatesForSystem(FA)).toHaveLength(11);
    expect(getStorageArrayAlertTemplatesForSystem(FB)).toHaveLength(7);
  });

  test("every template id carries its platform's prefix", () => {
    for (const template of ALL_TEMPLATES) {
      expect(template.id).toMatch(
        systemOf(template) === FA
          ? /^purefa-[a-z0-9-]+$/
          : /^purefb-[a-z0-9-]+$/,
      );
    }
  });

  test("template names are unique within a platform", () => {
    for (const system of [FA, FB]) {
      const names: Array<string> = getStorageArrayAlertTemplatesForSystem(
        system,
      ).map((t: StorageArrayAlertTemplate) => {
        return t.name;
      });
      expect(new Set(names).size).toBe(names.length);
    }
  });

  test("getStorageArrayAlertTemplateById round-trips every template and misses unknown ids", () => {
    for (const template of ALL_TEMPLATES) {
      expect(getStorageArrayAlertTemplateById(template.id)?.id).toBe(
        template.id,
      );
    }
    expect(
      getStorageArrayAlertTemplateById("ceph-health-error"),
    ).toBeUndefined();
    expect(getStorageArrayAlertTemplateById("")).toBeUndefined();
  });

  test("getStorageArrayAlertTemplatesByCategory partitions the registry", () => {
    const categories: Array<StorageArrayAlertTemplateCategory> = [
      "Array Health",
      "Capacity",
      "Performance",
      "Hardware",
      "Hosts",
      "Replication",
      "File Systems",
    ];

    let total: number = 0;
    for (const category of categories) {
      const templates: Array<StorageArrayAlertTemplate> =
        getStorageArrayAlertTemplatesByCategory(category);
      expect(templates.length).toBeGreaterThan(0);
      for (const template of templates) {
        expect(template.category).toBe(category);
      }
      total += templates.length;
    }
    expect(total).toBe(ALL_TEMPLATES.length);
  });

  test("getStorageArrayAlertTemplatesForSystem returns only that platform's templates", () => {
    for (const system of [FA, FB]) {
      for (const template of getStorageArrayAlertTemplatesForSystem(system)) {
        expect(template.storageSystems).toEqual([system]);
      }
    }
  });

  test.each([
    ["null", null],
    ["undefined", undefined],
    ["the empty string", ""],
    ["an unknown platform", "netapp.ontap"],
  ])(
    "an array whose platform is %s gets every template",
    (_: string, system: string | null | undefined) => {
      expect(
        getStorageArrayAlertTemplatesForSystem(system).map(
          (t: StorageArrayAlertTemplate) => {
            return t.id;
          },
        ),
      ).toEqual(
        ALL_TEMPLATES.map((t: StorageArrayAlertTemplate) => {
          return t.id;
        }),
      );
    },
  );

  test("the every-template list names each template with its platform, so names stay unique", () => {
    const mixed: Array<StorageArrayAlertTemplate> =
      getStorageArrayAlertTemplatesForSystem(null);
    const names: Array<string> = mixed.map((t: StorageArrayAlertTemplate) => {
      return t.name;
    });
    expect(new Set(names).size).toBe(names.length);
    expect(names).toContain("Capacity Above 80% (FlashArray)");
    expect(names).toContain("Capacity Above 80% (FlashBlade)");
    // The platform's own list keeps the plain names.
    expect(
      getStorageArrayAlertTemplatesForSystem(FA).map(
        (t: StorageArrayAlertTemplate) => {
          return t.name;
        },
      ),
    ).toContain("Capacity Above 80%");
    // Renaming the copies never touches the shared template objects.
    expect(getStorageArrayAlertTemplateById("purefa-capacity-high")?.name).toBe(
      "Capacity Above 80%",
    );
  });

  test("both platforms cover alerts, capacity, latency and hardware", () => {
    for (const system of [FA, FB]) {
      const categories: Set<string> = new Set(
        getStorageArrayAlertTemplatesForSystem(system).map(
          (t: StorageArrayAlertTemplate) => {
            return t.category;
          },
        ),
      );
      for (const category of [
        "Array Health",
        "Capacity",
        "Performance",
        "Hardware",
      ]) {
        expect(categories.has(category)).toBe(true);
      }
    }
  });

  test("severities are the two-member vocabulary the recommendation mapper understands", () => {
    for (const template of ALL_TEMPLATES) {
      expect(["Critical", "Warning"]).toContain(template.severity);
    }
  });
});

describe("StorageArrayAlertTemplates - enumerated invariants (every template)", () => {
  test.each(TEMPLATE_CASES)(
    "%s builds a valid Storage Array MonitorStep",
    (_id: string, template: StorageArrayAlertTemplate) => {
      const args: StorageArrayAlertTemplateArgs = buildArgs();
      const step: MonitorStep = template.getMonitorStep(args);
      const monitor: MonitorStepStorageArrayMonitor =
        getStorageArrayMonitor(step);

      // The array identity and platform are injected from the template.
      expect(monitor.arrayIdentifier).toBe(args.arrayIdentifier);
      expect(monitor.storageSystem).toBe(systemOf(template));
      expect(monitor.resourceFilters).toEqual({});
      expect(monitor.metricViewConfig.queryConfigs).toHaveLength(1);
      expect(monitor.metricViewConfig.formulaConfigs).toEqual([]);

      // Only the storage array sub-config is populated.
      expect(step.data?.cephMonitor).toBeUndefined();
      expect(step.data?.metricMonitor).toBeUndefined();
      expect(step.data?.kubernetesMonitor).toBeUndefined();
      expect(step.data?.proxmoxMonitor).toBeUndefined();
      expect(step.data?.vmwareMonitor).toBeUndefined();
      expect(step.data?.logMonitor).toBeUndefined();

      // One unhealthy instance, then the Healthy recovery.
      const instances: Array<MonitorCriteriaInstance> =
        getCriteriaInstances(step);
      expect(instances).toHaveLength(2);
      const [offline, online] = instances as [
        MonitorCriteriaInstance,
        MonitorCriteriaInstance,
      ];

      expect(offline.data?.monitorStatusId).toBe(args.offlineMonitorStatusId);
      expect(offline.data?.changeMonitorStatus).toBe(true);
      expect(offline.data?.createIncidents).toBe(true);
      expect(offline.data?.createAlerts).toBe(true);
      expect(offline.data?.incidents).toHaveLength(1);
      expect(offline.data?.alerts).toHaveLength(1);
      expect(offline.data?.incidents?.[0]?.autoResolveIncident).toBe(true);
      expect(offline.data?.alerts?.[0]?.autoResolveAlert).toBe(true);
      expect(offline.data?.incidents?.[0]?.incidentSeverityId).toBe(
        args.defaultIncidentSeverityId,
      );
      expect(offline.data?.alerts?.[0]?.alertSeverityId).toBe(
        args.defaultAlertSeverityId,
      );

      expect(online.data?.monitorStatusId).toBe(args.onlineMonitorStatusId);
      expect(online.data?.createIncidents).toBe(false);
      expect(online.data?.createAlerts).toBe(false);
      expect(online.data?.incidents).toEqual([]);
      expect(online.data?.name).toBe("Healthy");
    },
  );

  test.each(TEMPLATE_CASES)(
    "%s passes MonitorStep validation for MonitorType.StorageArray",
    (_id: string, template: StorageArrayAlertTemplate) => {
      const step: MonitorStep = template.getMonitorStep(buildArgs());
      expect(
        MonitorStep.getValidationError(step, MonitorType.StorageArray),
      ).toBeNull();
    },
  );

  test.each(TEMPLATE_CASES)(
    "%s survives a JSON round trip",
    (_id: string, template: StorageArrayAlertTemplate) => {
      const step: MonitorStep = template.getMonitorStep(buildArgs());
      const json: JSONObject = step.toJSON();
      const restored: MonitorStep = MonitorStep.fromJSON(
        JSON.parse(JSON.stringify(json)) as JSONObject,
      );

      expect(restored.data?.storageArrayMonitor).toEqual(
        step.data?.storageArrayMonitor,
      );
      expect(getCriteriaInstances(restored)).toHaveLength(2);
      expect(
        filtersOf(getCriteriaInstances(restored)[0]!).map(
          (f: CriteriaFilter) => {
            return [f.filterType, f.value];
          },
        ),
      ).toEqual(
        filtersOf(getCriteriaInstances(step)[0]!).map((f: CriteriaFilter) => {
          return [f.filterType, f.value];
        }),
      );
      expect(
        MonitorStep.getValidationError(restored, MonitorType.StorageArray),
      ).toBeNull();
    },
  );

  test.each(TEMPLATE_CASES)(
    "%s reads a catalog metric of its own platform, and the entry means exactly the template's filter",
    (_id: string, template: StorageArrayAlertTemplate) => {
      for (const queryConfig of queryConfigsOf(
        template.getMonitorStep(buildArgs()),
      )) {
        const filterData: any = queryConfig.metricQueryData.filterData;
        const definition: StorageArrayMetricDefinition | undefined =
          getStorageArrayMetric(filterData.metricName, filterData.attributes);

        expect(definition).toBeDefined();
        expect(definition!.metricName).toBe(filterData.metricName);
        expect(definition!.storageSystems).toContain(systemOf(template));
        // Everything the catalog entry pins, the template pins too.
        expect(filterData.attributes).toMatchObject(
          definition!.attributes || {},
        );
      }
    },
  );

  test.each(TEMPLATE_CASES)(
    "%s resolves every criteria alias",
    (_id: string, template: StorageArrayAlertTemplate) => {
      const step: MonitorStep = template.getMonitorStep(buildArgs());
      const aliases: Set<string> = new Set(
        queryConfigsOf(step).map((queryConfig: any) => {
          return queryConfig.metricAliasData.metricVariable;
        }),
      );
      for (const instance of getCriteriaInstances(step)) {
        for (const filter of filtersOf(instance)) {
          expect(aliases).toContain(filter.metricMonitorOptions?.metricAlias);
        }
      }
    },
  );

  test.each(TEMPLATE_CASES)(
    "%s filters only on bare labels its series carries, with values the exporter emits",
    (_id: string, template: StorageArrayAlertTemplate) => {
      for (const queryConfig of queryConfigsOf(
        template.getMonitorStep(buildArgs()),
      )) {
        const filterData: any = queryConfig.metricQueryData.filterData;
        const labels: Record<string, Array<string> | null> | undefined =
          SERIES_LABELS[filterData.metricName];
        expect(labels).toBeDefined();

        for (const [key, value] of Object.entries(
          filterData.attributes as Record<string, unknown>,
        )) {
          // Datapoint labels are stored bare; a prefix would match nothing.
          expect(key.startsWith("resource.")).toBe(false);
          expect(typeof value).toBe("string");
          expect(Object.keys(labels!)).toContain(key);
          const allowed: Array<string> | null | undefined = labels![key];
          if (allowed) {
            expect(allowed).toContain(value);
          }
        }
      }
    },
  );

  test.each(TEMPLATE_CASES)(
    "%s groups by the label naming the object its metric describes",
    (_id: string, template: StorageArrayAlertTemplate) => {
      const step: MonitorStep = template.getMonitorStep(buildArgs());

      for (const queryConfig of queryConfigsOf(step)) {
        const filterData: any = queryConfig.metricQueryData.filterData;
        const groupBys: Array<string> =
          queryConfig.metricQueryData.groupByAttributeKeys || [];
        const definition: StorageArrayMetricDefinition = getStorageArrayMetric(
          filterData.metricName,
          filterData.attributes,
        )!;

        expect(groupBys.length).toBeLessThanOrEqual(1);
        for (const key of groupBys) {
          expect(key.startsWith("resource.")).toBe(false);
          expect(Object.keys(SERIES_LABELS[filterData.metricName]!)).toContain(
            key,
          );
        }

        if (
          definition.defaultResourceScope !== StorageArrayResourceScope.Array
        ) {
          /*
           * A per-object metric must fire one incident per object, grouped
           * by the very label a resource filter on it would use.
           */
          expect(groupBys).toEqual([
            getStorageArrayObjectLabel(
              definition.defaultResourceScope,
              systemOf(template),
              filterData.metricName,
            ),
          ]);
        }
      }

      // The worker and the evaluator agree on what the step is grouped by.
      expect(MonitorStep.getGroupByAttributeKeys(step)).toEqual(
        queryConfigsOf(step)[0].metricQueryData.groupByAttributeKeys || [],
      );
    },
  );

  test.each(TEMPLATE_CASES)(
    "%s has disjoint fire/recover thresholds on the same alias",
    (_id: string, template: StorageArrayAlertTemplate) => {
      const step: MonitorStep = template.getMonitorStep(buildArgs());
      const instances: Array<MonitorCriteriaInstance> =
        getCriteriaInstances(step);
      const onlineFilters: Array<CriteriaFilter> = filtersOf(
        instances[instances.length - 1]!,
      );
      const isBinary: boolean = isBinaryFlagTemplate(step);

      for (const offline of instances.slice(0, -1)) {
        for (const fireFilter of filtersOf(offline)) {
          const recoverFilter: CriteriaFilter | undefined = onlineFilters.find(
            (f: CriteriaFilter) => {
              return (
                f.metricMonitorOptions?.metricAlias ===
                fireFilter.metricMonitorOptions?.metricAlias
              );
            },
          );
          expect(recoverFilter).toBeDefined();

          const fire: Threshold = {
            filterType: fireFilter.filterType!,
            value: fireFilter.value as number,
          };
          const recover: Threshold = {
            filterType: recoverFilter!.filterType!,
            value: recoverFilter!.value as number,
          };

          if (isBinary) {
            // A 0/1/2 code: exact complements on the identical threshold.
            expect(recover.filterType).toBe(
              getComplementFilterType(fire.filterType),
            );
            expect(recover.value).toBe(fire.value);
          } else {
            expect(hasRecoveryDeadBand(fire, recover)).toBe(true);
          }
        }
      }
    },
  );

  test.each(TEMPLATE_CASES)(
    "%s evaluates sustained over the whole window, not on a single sample",
    (_id: string, template: StorageArrayAlertTemplate) => {
      for (const instance of getCriteriaInstances(
        template.getMonitorStep(buildArgs()),
      )) {
        for (const filter of filtersOf(instance)) {
          expect(filter.metricMonitorOptions?.metricAggregationType).toBe(
            EvaluateOverTimeType.AllValues,
          );
        }
      }
    },
  );

  test.each(TEMPLATE_CASES)(
    "%s treats missing data as healthy exactly when its series carries the state in a label",
    (_id: string, template: StorageArrayAlertTemplate) => {
      /*
       * purefa_alerts_open, purefa_hw_component_status,
       * purefa_drive_capacity_bytes and purefa_host_connectivity_info exist
       * only while the object is in the filtered state. Without TreatAsZero
       * the "= 0" recovery would never see data once the problem cleared,
       * and the monitor would stay Offline forever.
       */
      const step: MonitorStep = template.getMonitorStep(buildArgs());
      const stateInALabel: boolean = queryConfigsOf(step).some(
        (queryConfig: any) => {
          return STATE_IN_A_LABEL_METRICS.has(
            queryConfig.metricQueryData.filterData.metricName,
          );
        },
      );
      const [offline, online] = getCriteriaInstances(step) as [
        MonitorCriteriaInstance,
        MonitorCriteriaInstance,
      ];

      for (const filter of filtersOf(online)) {
        if (stateInALabel) {
          expect(filter.metricMonitorOptions?.onNoDataPolicy).toBe(
            NoDataPolicy.TreatAsZero,
          );
          expect(filter.filterType).toBe(FilterType.EqualTo);
          expect(filter.value).toBe(0);
        } else {
          expect(filter.metricMonitorOptions?.onNoDataPolicy).toBeUndefined();
        }
      }

      // Absence never fires: the unhealthy side keeps the default policy.
      for (const filter of filtersOf(offline)) {
        expect(filter.metricMonitorOptions?.onNoDataPolicy).toBeUndefined();
        if (stateInALabel) {
          expect(filter.filterType).toBe(FilterType.GreaterThan);
          expect(filter.value).toBe(0);
        }
      }
    },
  );

  test.each(TEMPLATE_CASES)(
    "%s fires on a breached window and recovers on a healthy one",
    (_id: string, template: StorageArrayAlertTemplate) => {
      const expectation: TemplateExpectation = EXPECTED_TEMPLATES.find(
        (t: TemplateExpectation) => {
          return t.id === template.id;
        },
      )!;
      const [offline, online] = getCriteriaInstances(
        template.getMonitorStep(buildArgs()),
      ) as [MonitorCriteriaInstance, MonitorCriteriaInstance];
      const fire: CriteriaFilter = filtersOf(offline)[0]!;
      const recover: CriteriaFilter = filtersOf(online)[0]!;

      const above: boolean =
        expectation.fire.filterType === FilterType.GreaterThan;
      const breached: number = above
        ? expectation.fire.value * 2 + 1
        : expectation.fire.value / 2;
      const healthy: number = above ? 0 : expectation.fire.value * 2;

      expect(matchesSustainedWindow(fire, breached)).toBe(true);
      expect(matchesSustainedWindow(fire, healthy)).toBe(false);
      expect(matchesSustainedWindow(recover, healthy)).toBe(true);
      expect(matchesSustainedWindow(recover, breached)).toBe(false);
    },
  );

  test.each(TEMPLATE_CASES)(
    "%s titles itself as a storage array alert and says where to look",
    (_id: string, template: StorageArrayAlertTemplate) => {
      const step: MonitorStep = template.getMonitorStep(buildArgs());
      const fireInstance: MonitorCriteriaInstance =
        getCriteriaInstances(step)[0]!;
      const incident: any = fireInstance.data?.incidents?.[0];
      const alert: any = fireInstance.data?.alerts?.[0];

      expect(incident.title).toMatch(/^\[Storage Array\] /);
      expect(incident.title.endsWith(" - Test Monitor")).toBe(true);
      expect(alert.title).toBe(incident.title);
      expect(alert.description).toBe(incident.description);
      expect(incident.description.length).toBeGreaterThan(40);

      if (template.severity === "Critical") {
        expect(incident.title).toContain("CRITICAL:");
      } else {
        expect(incident.title).not.toContain("CRITICAL:");
      }

      // Named criteria, not the builder's generic fallback.
      expect(fireInstance.data?.name).not.toBe("Test Monitor - Unhealthy");
      expect(fireInstance.data?.description).not.toBe(
        "Criteria for detecting unhealthy state.",
      );
      expect(fireInstance.data?.description).toMatch(/^Triggers /);

      // The template description names the series it reads.
      const metricName: string =
        queryConfigsOf(step)[0].metricQueryData.filterData.metricName;
      expect(template.description).toContain(metricName);
    },
  );

  test.each(TEMPLATE_CASES)(
    "%s speaks only about its own platform",
    (_id: string, template: StorageArrayAlertTemplate) => {
      const step: MonitorStep = template.getMonitorStep(buildArgs());
      const fireInstance: MonitorCriteriaInstance =
        getCriteriaInstances(step)[0]!;
      const texts: Array<string> = [
        template.name,
        template.description,
        fireInstance.data?.incidents?.[0]?.title || "",
        fireInstance.data?.incidents?.[0]?.description || "",
        fireInstance.data?.name || "",
        fireInstance.data?.description || "",
      ];
      const otherPlatform: RegExp =
        systemOf(template) === FA ? /FlashBlade|purefb_/ : /FlashArray|purefa_/;

      for (const text of texts) {
        expect(text).not.toMatch(otherPlatform);
        // Cloned from Ceph: no Ceph, Proxmox or vSphere vocabulary.
        expect(text).not.toMatch(/ceph|proxmox|pve|vcenter|vsphere|osd\b/i);
      }
    },
  );
});

describe("StorageArrayAlertTemplates - spec table expectations", () => {
  test.each(
    EXPECTED_TEMPLATES.map(
      (t: TemplateExpectation): [string, TemplateExpectation] => {
        return [t.id, t];
      },
    ),
  )(
    "%s matches the spec'd metric / aggregation / threshold contract",
    (_id: string, tc: TemplateExpectation) => {
      const template: StorageArrayAlertTemplate | undefined =
        getStorageArrayAlertTemplateById(tc.id);
      expect(template).toBeDefined();

      expect(template!.category).toBe(tc.category);
      expect(template!.severity).toBe(tc.severity);
      expect(template!.storageSystems).toEqual([tc.system]);

      const step: MonitorStep = template!.getMonitorStep(buildArgs());
      const monitor: MonitorStepStorageArrayMonitor =
        getStorageArrayMonitor(step);
      expect(monitor.rollingTime).toBe(tc.rollingTime);

      const queryConfigs: Array<any> = queryConfigsOf(step);
      expect(queryConfigs).toHaveLength(1);
      const queryConfig: any = queryConfigs[0];
      expect(queryConfig.metricAliasData.metricVariable).toBe(tc.alias);
      expect(queryConfig.metricQueryData.filterData.metricName).toBe(
        tc.metricName,
      );
      expect(queryConfig.metricQueryData.filterData.aggegationType).toBe(
        tc.aggregation,
      );
      expect(queryConfig.metricQueryData.filterData.attributes).toEqual(
        tc.attributes,
      );
      if (tc.groupBy) {
        expect(queryConfig.metricQueryData.groupByAttributeKeys).toEqual([
          tc.groupBy,
        ]);
      } else {
        // Ungrouped: the key is absent, not an empty list.
        expect("groupByAttributeKeys" in queryConfig.metricQueryData).toBe(
          false,
        );
      }

      const [offline, online] = getCriteriaInstances(step) as [
        MonitorCriteriaInstance,
        MonitorCriteriaInstance,
      ];
      expect(offline.data?.filterCondition).toBe(FilterCondition.Any);
      expect(filtersOf(offline)).toHaveLength(1);
      expect(filtersOf(offline)[0]!.metricMonitorOptions?.metricAlias).toBe(
        tc.alias,
      );
      expect(filtersOf(offline)[0]!.filterType).toBe(tc.fire.filterType);
      expect(filtersOf(offline)[0]!.value).toBe(tc.fire.value);

      expect(online.data?.filterCondition).toBe(FilterCondition.Any);
      expect(filtersOf(online)).toHaveLength(1);
      const recover: CriteriaFilter = filtersOf(online)[0]!;
      expect(recover.metricMonitorOptions?.metricAlias).toBe(tc.alias);
      expect(recover.filterType).toBe(tc.recoverFilterType);
      /*
       * The table states the FIRING threshold; the recovery threshold is
       * derived from it, so a change to the dead band shows up as a
       * behaviour change in one place.
       */
      expect(recover.value).toBe(
        expectedRecoveryValue(tc.fire, BINARY_FLAG_METRICS.has(tc.metricName)),
      );
      expect(
        recover.metricMonitorOptions?.onNoDataPolicy ===
          NoDataPolicy.TreatAsZero,
      ).toBe(tc.treatNoDataAsZero);
    },
  );
});

describe("StorageArrayAlertTemplates - FlashBlade hardware health code (regression)", () => {
  /*
   * purefb_hardware_health is 1 healthy, 2 unused (an empty slot), 0
   * anything else. Without isBinaryMetric the recovery would be `>= 1.1`:
   * matched by an empty slot, never by a repaired blade, so the monitor
   * would stay Offline after the repair.
   */
  const template: StorageArrayAlertTemplate = getStorageArrayAlertTemplateById(
    "purefb-hardware-unhealthy",
  )!;
  const [offline, online] = getCriteriaInstances(
    template.getMonitorStep(buildArgs()),
  ) as [MonitorCriteriaInstance, MonitorCriteriaInstance];
  const fire: CriteriaFilter = filtersOf(offline)[0]!;
  const recover: CriteriaFilter = filtersOf(online)[0]!;

  test("fires below 1 and recovers at exactly 1, never at the unreachable 1.1", () => {
    expect(fire.filterType).toBe(FilterType.LessThan);
    expect(fire.value).toBe(1);
    expect(recover.filterType).toBe(FilterType.GreaterThanOrEqualTo);
    expect(recover.value).toBe(1);
    expect(recover.value).not.toBe(1.1);
  });

  test.each([
    [0, "unhealthy", true, false],
    [1, "healthy", false, true],
    [2, "unused", false, true],
  ])(
    "a component reporting %p (%s) fires: %p, recovers: %p",
    (value: number, _state: string, fires: boolean, recovers: boolean) => {
      expect(matchesSustainedWindow(fire, value)).toBe(fires);
      expect(matchesSustainedWindow(recover, value)).toBe(recovers);
    },
  );

  test("takes the minimum per component, so one unhealthy scrape is never averaged away", () => {
    const queryConfig: any = queryConfigsOf(
      template.getMonitorStep(buildArgs()),
    )[0];
    expect(queryConfig.metricQueryData.filterData.aggegationType).toBe(
      MetricsAggregationType.Min,
    );
    expect(queryConfig.metricQueryData.groupByAttributeKeys).toEqual(["name"]);
  });

  test("it is the only binary-coded template, and the only `< 1` threshold", () => {
    for (const other of ALL_TEMPLATES) {
      const step: MonitorStep = other.getMonitorStep(buildArgs());
      const usesLessThanOne: boolean = filtersOf(
        getCriteriaInstances(step)[0]!,
      ).some((f: CriteriaFilter) => {
        return f.filterType === FilterType.LessThan && f.value === 1;
      });
      expect(usesLessThanOne).toBe(other.id === "purefb-hardware-unhealthy");
      expect(isBinaryFlagTemplate(step)).toBe(
        other.id === "purefb-hardware-unhealthy",
      );
    }
  });
});

describe("StorageArrayAlertTemplates - capacity tiering", () => {
  test.each([
    [FA, "purefa-capacity-high", "purefa-capacity-critical"],
    [FB, "purefb-capacity-high", "purefb-capacity-critical"],
  ])(
    "%s: the warning tier fires below the critical tier, and the critical tier reacts faster",
    (_system: StorageSystem, warningId: string, criticalId: string) => {
      const firing: (id: string) => CriteriaFilter = (
        id: string,
      ): CriteriaFilter => {
        return filtersOf(
          getCriteriaInstances(
            getStorageArrayAlertTemplateById(id)!.getMonitorStep(buildArgs()),
          )[0]!,
        )[0]!;
      };
      const recovering: (id: string) => CriteriaFilter = (
        id: string,
      ): CriteriaFilter => {
        return filtersOf(
          getCriteriaInstances(
            getStorageArrayAlertTemplateById(id)!.getMonitorStep(buildArgs()),
          )[1]!,
        )[0]!;
      };

      expect(firing(warningId).value).toBe(80);
      expect(firing(criticalId).value).toBe(90);
      // Each tier recovers inside its own band, below where it fires.
      expect(recovering(warningId).value as number).toBeLessThan(80);
      expect(recovering(criticalId).value as number).toBeLessThan(90);
      expect(recovering(criticalId).value as number).toBeGreaterThan(80);

      const warning: StorageArrayAlertTemplate =
        getStorageArrayAlertTemplateById(warningId)!;
      const critical: StorageArrayAlertTemplate =
        getStorageArrayAlertTemplateById(criticalId)!;
      expect(warning.severity).toBe("Warning");
      expect(critical.severity).toBe("Critical");
      expect(
        getStorageArrayMonitor(critical.getMonitorStep(buildArgs()))
          .rollingTime,
      ).toBe(RollingTime.Past5Minutes);
      expect(
        getStorageArrayMonitor(warning.getMonitorStep(buildArgs())).rollingTime,
      ).toBe(RollingTime.Past15Minutes);
    },
  );
});

describe("StorageArrayAlertTemplates - builders", () => {
  test("buildStorageArrayMonitorConfig: one query, no group-by key unless asked, platform carried", () => {
    const config: MonitorStepStorageArrayMonitor =
      buildStorageArrayMonitorConfig({
        arrayIdentifier: "pure-prod-01",
        storageSystem: FA,
        metricName: "purefa_array_space_utilization",
        metricAlias: "used",
        rollingTime: RollingTime.Past5Minutes,
        aggregationType: MetricsAggregationType.Max,
      });

    expect(config).toEqual({
      arrayIdentifier: "pure-prod-01",
      storageSystem: FA,
      resourceFilters: {},
      metricViewConfig: {
        queryConfigs: [
          {
            metricAliasData: {
              metricVariable: "used",
              title: "used",
              description: "used",
              legend: "used",
              legendUnit: undefined,
            },
            metricQueryData: {
              filterData: {
                metricName: "purefa_array_space_utilization",
                attributes: {},
                aggegationType: MetricsAggregationType.Max,
                aggregateBy: {},
              },
            },
          },
        ],
        formulaConfigs: [],
      },
      rollingTime: RollingTime.Past5Minutes,
    });
    expect(
      "groupByAttributeKeys" in
        (config.metricViewConfig.queryConfigs[0] as any).metricQueryData,
    ).toBe(false);
  });

  test("buildStorageArrayMonitorConfig: attributes and a group-by key pass through", () => {
    const config: MonitorStepStorageArrayMonitor =
      buildStorageArrayMonitorConfig({
        arrayIdentifier: "pure-fb-01",
        metricName: "purefb_hardware_health",
        metricAlias: "health",
        rollingTime: RollingTime.Past1Minute,
        aggregationType: MetricsAggregationType.Min,
        attributes: { type: "fb" },
        groupByAttributeKey: "name",
      });

    const queryData: any = (config.metricViewConfig.queryConfigs[0] as any)
      .metricQueryData;
    expect(config.storageSystem).toBeUndefined();
    expect(queryData.filterData.attributes).toEqual({ type: "fb" });
    expect(queryData.groupByAttributeKeys).toEqual(["name"]);
  });

  test("buildStorageArrayMonitorStep orders the unhealthy criteria before the recovery", () => {
    const offline: MonitorCriteriaInstance =
      buildStorageArrayOfflineCriteriaInstance({
        offlineMonitorStatusId: ObjectID.generate(),
        incidentSeverityId: ObjectID.generate(),
        alertSeverityId: ObjectID.generate(),
        monitorName: "Array",
        metricAlias: "a",
        filterType: FilterType.GreaterThan,
        value: 1,
      });
    const online: MonitorCriteriaInstance =
      buildStorageArrayOnlineCriteriaInstance({
        onlineMonitorStatusId: ObjectID.generate(),
        metricAlias: "a",
        filterType: FilterType.LessThanOrEqualTo,
        value: 1,
      });
    const monitor: MonitorStepStorageArrayMonitor =
      buildStorageArrayMonitorConfig({
        arrayIdentifier: "pure-prod-01",
        metricName: "purefa_alerts_open",
        metricAlias: "a",
        rollingTime: RollingTime.Past5Minutes,
        aggregationType: MetricsAggregationType.Max,
      });

    const step: MonitorStep = buildStorageArrayMonitorStep({
      storageArrayMonitor: monitor,
      offlineCriteriaInstance: offline,
      onlineCriteriaInstance: online,
    });

    expect(step.data?.storageArrayMonitor).toBe(monitor);
    expect(getCriteriaInstances(step)).toEqual([offline, online]);
    expect(step.data?.id).toBeTruthy();
    // Two steps never share an id.
    expect(
      buildStorageArrayMonitorStep({
        storageArrayMonitor: monitor,
        offlineCriteriaInstance: offline,
        onlineCriteriaInstance: online,
      }).data?.id,
    ).not.toBe(step.data?.id);
  });

  test("the offline criteria's default text names a storage array", () => {
    const offline: MonitorCriteriaInstance =
      buildStorageArrayOfflineCriteriaInstance({
        offlineMonitorStatusId: ObjectID.generate(),
        incidentSeverityId: ObjectID.generate(),
        alertSeverityId: ObjectID.generate(),
        monitorName: "Array",
        metricAlias: "a",
        filterType: FilterType.GreaterThan,
        value: 1,
      });
    expect(offline.data?.incidents?.[0]?.description).toContain(
      "storage array",
    );
    expect(offline.data?.incidents?.[0]?.title).toBe("Array - Alert Triggered");
  });

  test("the online criteria: TreatAsZero on request, and no dead band for a binary metric", () => {
    const treat: MonitorCriteriaInstance =
      buildStorageArrayOnlineCriteriaInstance({
        onlineMonitorStatusId: ObjectID.generate(),
        metricAlias: "a",
        filterType: FilterType.EqualTo,
        value: 0,
        treatNoDataAsZero: true,
      });
    expect(filtersOf(treat)[0]!.metricMonitorOptions?.onNoDataPolicy).toBe(
      NoDataPolicy.TreatAsZero,
    );

    const banded: MonitorCriteriaInstance =
      buildStorageArrayOnlineCriteriaInstance({
        onlineMonitorStatusId: ObjectID.generate(),
        metricAlias: "a",
        filterType: FilterType.GreaterThanOrEqualTo,
        value: 1,
      });
    expect(filtersOf(banded)[0]!.value).toBeCloseTo(1.1, 10);

    const binary: MonitorCriteriaInstance =
      buildStorageArrayOnlineCriteriaInstance({
        onlineMonitorStatusId: ObjectID.generate(),
        metricAlias: "a",
        filterType: FilterType.GreaterThanOrEqualTo,
        value: 1,
        isBinaryMetric: true,
      });
    expect(filtersOf(binary)[0]!.value).toBe(1);
  });

  test("validation refuses a Storage Array step without its monitor config or array", () => {
    const step: MonitorStep = getStorageArrayAlertTemplateById(
      "purefa-critical-alerts",
    )!.getMonitorStep(buildArgs());

    step.data!.storageArrayMonitor!.arrayIdentifier = "";
    expect(MonitorStep.getValidationError(step, MonitorType.StorageArray)).toBe(
      "Storage array is required",
    );

    step.data!.storageArrayMonitor = undefined;
    expect(MonitorStep.getValidationError(step, MonitorType.StorageArray)).toBe(
      "Storage array monitor configuration is required",
    );
  });
});
