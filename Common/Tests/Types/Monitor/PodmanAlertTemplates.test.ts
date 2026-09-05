import {
  PodmanAlertTemplate,
  PodmanAlertTemplateArgs,
  PodmanAlertTemplateCategory,
  getAllPodmanAlertTemplates,
  getPodmanAlertTemplateById,
  getPodmanAlertTemplatesByCategory,
} from "../../../Types/Monitor/PodmanAlertTemplates";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import { hasRecoveryDeadBand } from "./Utils/RecommendationCriteriaAssertions";
import MonitorStepPodmanMonitor from "../../../Types/Monitor/MonitorStepPodmanMonitor";
import MetricsAggregationType from "../../../Types/Metrics/MetricsAggregationType";
import RollingTime from "../../../Types/RollingTime/RollingTime";
import { FilterType } from "../../../Types/Monitor/CriteriaFilter";
import ObjectID from "../../../Types/ObjectID";

/*
 * Podman containers emit the same OTel container.* metrics as Docker, so the
 * Podman templates mirror the Docker set. These tests lock in the same three
 * regression-prone decisions (metric name, per-minute aggregation, and the
 * unhealthy/healthy range partition) independently, so a divergence between
 * the two catalogs — a renamed metric or a flipped comparison copied from one
 * into the other — is caught here rather than in production.
 */

interface PodmanTemplateCase {
  id: string;
  category: PodmanAlertTemplateCategory;
  severity: "Critical" | "Warning";
  metricName: string;
  metricAlias: string;
  aggregation: MetricsAggregationType;
  rollingTime: RollingTime;
  offlineFilterType: FilterType;
  onlineFilterType: FilterType;
  threshold: number;
}

const PODMAN_TEMPLATES: Array<PodmanTemplateCase> = [
  {
    id: "podman-high-cpu",
    category: "Resource",
    severity: "Warning",
    metricName: "container.cpu.utilization",
    metricAlias: "container_cpu",
    aggregation: MetricsAggregationType.Max,
    rollingTime: RollingTime.Past5Minutes,
    offlineFilterType: FilterType.GreaterThan,
    onlineFilterType: FilterType.LessThanOrEqualTo,
    threshold: 80,
  },
  {
    id: "podman-high-memory",
    category: "Resource",
    severity: "Warning",
    metricName: "container.memory.percent",
    metricAlias: "container_memory",
    aggregation: MetricsAggregationType.Max,
    rollingTime: RollingTime.Past5Minutes,
    offlineFilterType: FilterType.GreaterThan,
    onlineFilterType: FilterType.LessThanOrEqualTo,
    threshold: 85,
  },
  {
    id: "podman-restart-loop",
    category: "Container",
    severity: "Critical",
    metricName: "container.restarts",
    metricAlias: "container_restarts",
    aggregation: MetricsAggregationType.Max,
    rollingTime: RollingTime.Past5Minutes,
    offlineFilterType: FilterType.GreaterThan,
    onlineFilterType: FilterType.LessThanOrEqualTo,
    threshold: 5,
  },
  {
    id: "podman-cpu-throttling",
    category: "Resource",
    severity: "Warning",
    metricName: "container.cpu.throttling_data.throttled_time",
    metricAlias: "cpu_throttled",
    aggregation: MetricsAggregationType.Max,
    rollingTime: RollingTime.Past5Minutes,
    // throttled_time is non-negative: (> 0) unhealthy, (= 0) healthy partitions it.
    offlineFilterType: FilterType.GreaterThan,
    onlineFilterType: FilterType.EqualTo,
    threshold: 0,
  },
  {
    id: "podman-high-pids",
    category: "Container",
    severity: "Warning",
    metricName: "container.pids.count",
    metricAlias: "pids_count",
    aggregation: MetricsAggregationType.Max,
    rollingTime: RollingTime.Past5Minutes,
    offlineFilterType: FilterType.GreaterThan,
    onlineFilterType: FilterType.LessThanOrEqualTo,
    threshold: 500,
  },
  {
    id: "podman-container-down",
    category: "Container",
    severity: "Critical",
    metricName: "container.uptime",
    metricAlias: "container_uptime",
    aggregation: MetricsAggregationType.Min,
    rollingTime: RollingTime.Past1Minute,
    // uptime is non-negative: (= 0) unhealthy, (> 0) healthy partitions it.
    offlineFilterType: FilterType.EqualTo,
    onlineFilterType: FilterType.GreaterThan,
    threshold: 0,
  },
];

function buildArgs(): PodmanAlertTemplateArgs {
  return {
    hostIdentifier: "podman-host-01",
    onlineMonitorStatusId: ObjectID.generate(),
    offlineMonitorStatusId: ObjectID.generate(),
    defaultIncidentSeverityId: ObjectID.generate(),
    defaultAlertSeverityId: ObjectID.generate(),
    monitorName: "Test Podman Monitor",
  };
}

function getPodmanMonitor(step: MonitorStep): MonitorStepPodmanMonitor {
  const podmanMonitor: MonitorStepPodmanMonitor | undefined =
    step.data?.podmanMonitor;
  if (!podmanMonitor) {
    throw new Error("podmanMonitor missing from monitor step");
  }
  return podmanMonitor;
}

describe("PodmanAlertTemplates", () => {
  test("every documented template id is registered and the suite is exhaustive", () => {
    const ids: Array<string> = getAllPodmanAlertTemplates().map(
      (t: PodmanAlertTemplate) => {
        return t.id;
      },
    );
    for (const tc of PODMAN_TEMPLATES) {
      expect(ids).toContain(tc.id);
    }
    expect(ids.sort()).toEqual(
      PODMAN_TEMPLATES.map((t: PodmanTemplateCase) => {
        return t.id;
      }).sort(),
    );
  });

  test("every template id is unique", () => {
    const ids: Array<string> = getAllPodmanAlertTemplates().map(
      (t: PodmanAlertTemplate) => {
        return t.id;
      },
    );
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("getPodmanAlertTemplateById returns undefined for an unknown id", () => {
    expect(getPodmanAlertTemplateById("does-not-exist")).toBeUndefined();
  });

  test("getPodmanAlertTemplatesByCategory partitions the catalog by category", () => {
    const all: Array<PodmanAlertTemplate> = getAllPodmanAlertTemplates();
    const categories: Array<PodmanAlertTemplateCategory> = [
      "Container",
      "Resource",
      "Host",
    ];

    let total: number = 0;
    for (const category of categories) {
      const inCategory: Array<PodmanAlertTemplate> =
        getPodmanAlertTemplatesByCategory(category);
      for (const template of inCategory) {
        expect(template.category).toBe(category);
      }
      total += inCategory.length;
    }
    expect(total).toBe(all.length);
  });

  test.each(PODMAN_TEMPLATES)(
    "$id is a $severity $category template with populated copy",
    (tc: PodmanTemplateCase) => {
      const template: PodmanAlertTemplate | undefined =
        getPodmanAlertTemplateById(tc.id);
      expect(template).toBeDefined();
      expect(template!.category).toBe(tc.category);
      expect(template!.severity).toBe(tc.severity);
      expect(template!.name.length).toBeGreaterThan(0);
      expect(template!.description.length).toBeGreaterThan(0);
    },
  );

  test.each(PODMAN_TEMPLATES)(
    "$id queries $metricName with the intended aggregation and window",
    (tc: PodmanTemplateCase) => {
      const template: PodmanAlertTemplate = getPodmanAlertTemplateById(tc.id)!;
      const step: MonitorStep = template.getMonitorStep(buildArgs());
      const monitor: MonitorStepPodmanMonitor = getPodmanMonitor(step);

      expect(monitor.hostIdentifier).toBe("podman-host-01");

      const queryConfigs: Array<any> = monitor.metricViewConfig
        .queryConfigs as Array<any>;
      expect(queryConfigs).toHaveLength(1);
      expect(monitor.metricViewConfig.formulaConfigs).toHaveLength(0);

      const filterData: any = queryConfigs[0].metricQueryData.filterData;
      expect(filterData.metricName).toBe(tc.metricName);
      expect(filterData.aggegationType).toBe(tc.aggregation);
      expect(monitor.rollingTime).toBe(tc.rollingTime);
    },
  );

  test.each(PODMAN_TEMPLATES)(
    "$id unhealthy/healthy criteria leave a recovery dead band around $threshold",
    (tc: PodmanTemplateCase) => {
      const template: PodmanAlertTemplate = getPodmanAlertTemplateById(tc.id)!;
      const step: MonitorStep = template.getMonitorStep(buildArgs());

      const instances: Array<any> = step.data?.monitorCriteria.data
        ?.monitorCriteriaInstanceArray as Array<any>;
      expect(instances).toHaveLength(2);
      const [offline, online] = instances;

      const offlineFilter: any = offline.data.filters[0];
      const onlineFilter: any = online.data.filters[0];

      expect(offlineFilter.metricMonitorOptions.metricAlias).toBe(
        tc.metricAlias,
      );
      expect(onlineFilter.metricMonitorOptions.metricAlias).toBe(
        tc.metricAlias,
      );
      expect(offlineFilter.value).toBe(tc.threshold);
      /*
       * The healthy criteria recovers at a threshold strictly INSIDE the
       * firing one, so a metric hovering at the boundary cannot satisfy
       * both on consecutive evaluations. This assertion used to be
       * `expect(onlineFilter.value).toBe(tc.threshold)` — the two criteria
       * exactly partitioned the range, which is the flapping configuration
       * this suite existed to lock in.
       */
      expect(
        hasRecoveryDeadBand(
          {
            filterType: offlineFilter.filterType,
            value: offlineFilter.value as number,
          },
          {
            filterType: onlineFilter.filterType,
            value: onlineFilter.value as number,
          },
        ),
      ).toBe(true);

      expect(offlineFilter.filterType).toBe(tc.offlineFilterType);
      expect(onlineFilter.filterType).toBe(tc.onlineFilterType);

      expect(offline.data.createIncidents).toBe(true);
      expect(offline.data.createAlerts).toBe(true);
      expect(offline.data.incidents).toHaveLength(1);
      expect(offline.data.alerts).toHaveLength(1);
      expect(offline.data.monitorStatusId).toBeDefined();

      expect(online.data.createIncidents).toBe(false);
      expect(online.data.createAlerts).toBe(false);
      expect(online.data.incidents).toHaveLength(0);
      expect(online.data.alerts).toHaveLength(0);
    },
  );

  test("incidents auto-resolve so a recovered container clears itself", () => {
    for (const tc of PODMAN_TEMPLATES) {
      const step: MonitorStep = getPodmanAlertTemplateById(
        tc.id,
      )!.getMonitorStep(buildArgs());
      const offline: any = (
        step.data?.monitorCriteria.data
          ?.monitorCriteriaInstanceArray as Array<any>
      )[0];
      expect(offline.data.incidents[0].autoResolveIncident).toBe(true);
      expect(offline.data.alerts[0].autoResolveAlert).toBe(true);
    }
  });
});
