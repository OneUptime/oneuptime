import {
  DockerAlertTemplate,
  DockerAlertTemplateArgs,
  DockerAlertTemplateCategory,
  getAllDockerAlertTemplates,
  getDockerAlertTemplateById,
  getDockerAlertTemplatesByCategory,
} from "../../../Types/Monitor/DockerAlertTemplates";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import { hasRecoveryDeadBand } from "./Utils/RecommendationCriteriaAssertions";
import MonitorStepDockerMonitor from "../../../Types/Monitor/MonitorStepDockerMonitor";
import MetricsAggregationType from "../../../Types/Metrics/MetricsAggregationType";
import RollingTime from "../../../Types/RollingTime/RollingTime";
import { FilterType } from "../../../Types/Monitor/CriteriaFilter";
import ObjectID from "../../../Types/ObjectID";

/*
 * These tests lock in the container-alert templates' easy-to-regress
 * decisions:
 *
 *   1. The metric name each template queries — a rename in the collector
 *      pipeline (e.g. `container.memory.percent`) would silently make the
 *      template match nothing while every "template exists" check stays green.
 *
 *   2. The per-minute aggregation. Container templates deliberately use `Max`
 *      so a SINGLE hot/throttled/forking container trips the threshold instead
 *      of being diluted by averaging across the other containers on the host;
 *      the down/uptime template uses `Min` so a single zero-uptime scrape wins.
 *
 *   3. The unhealthy and healthy criteria PARTITION the value range — no gap
 *      (a value matching neither leaves the monitor stuck in its previous
 *      status) and no overlap (a value matching both makes the status depend
 *      on evaluation order). The failure mode is a strict/non-strict slip.
 *      The two zero-boundary templates (throttling, container-down) partition
 *      the non-negative domain with `> 0` / `= 0`, so they are pinned per case
 *      rather than by a generic complement rule.
 */

interface DockerTemplateCase {
  id: string;
  category: DockerAlertTemplateCategory;
  severity: "Critical" | "Warning";
  metricName: string;
  metricAlias: string;
  aggregation: MetricsAggregationType;
  rollingTime: RollingTime;
  offlineFilterType: FilterType;
  onlineFilterType: FilterType;
  threshold: number;
}

const DOCKER_TEMPLATES: Array<DockerTemplateCase> = [
  {
    id: "docker-high-cpu",
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
    id: "docker-high-memory",
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
    id: "docker-restart-loop",
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
    id: "docker-cpu-throttling",
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
    id: "docker-high-pids",
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
    id: "docker-container-down",
    category: "Container",
    severity: "Critical",
    metricName: "container.uptime",
    metricAlias: "container_uptime",
    // A single zero-uptime scrape means the container is down right now.
    aggregation: MetricsAggregationType.Min,
    rollingTime: RollingTime.Past1Minute,
    // uptime is non-negative: (= 0) unhealthy, (> 0) healthy partitions it.
    offlineFilterType: FilterType.EqualTo,
    onlineFilterType: FilterType.GreaterThan,
    threshold: 0,
  },
];

function buildArgs(): DockerAlertTemplateArgs {
  return {
    hostIdentifier: "docker-host-01",
    onlineMonitorStatusId: ObjectID.generate(),
    offlineMonitorStatusId: ObjectID.generate(),
    defaultIncidentSeverityId: ObjectID.generate(),
    defaultAlertSeverityId: ObjectID.generate(),
    monitorName: "Test Docker Monitor",
  };
}

function getDockerMonitor(step: MonitorStep): MonitorStepDockerMonitor {
  const dockerMonitor: MonitorStepDockerMonitor | undefined =
    step.data?.dockerMonitor;
  if (!dockerMonitor) {
    throw new Error("dockerMonitor missing from monitor step");
  }
  return dockerMonitor;
}

describe("DockerAlertTemplates", () => {
  test("every documented template id is registered", () => {
    const ids: Array<string> = getAllDockerAlertTemplates().map(
      (t: DockerAlertTemplate) => {
        return t.id;
      },
    );
    for (const tc of DOCKER_TEMPLATES) {
      expect(ids).toContain(tc.id);
    }
    // The suite must be exhaustive: no template ships without a case here.
    expect(ids.sort()).toEqual(
      DOCKER_TEMPLATES.map((t: DockerTemplateCase) => {
        return t.id;
      }).sort(),
    );
  });

  test("every template id is unique", () => {
    const ids: Array<string> = getAllDockerAlertTemplates().map(
      (t: DockerAlertTemplate) => {
        return t.id;
      },
    );
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("getDockerAlertTemplateById returns undefined for an unknown id", () => {
    expect(getDockerAlertTemplateById("does-not-exist")).toBeUndefined();
  });

  test("getDockerAlertTemplatesByCategory partitions the catalog by category", () => {
    const all: Array<DockerAlertTemplate> = getAllDockerAlertTemplates();
    const categories: Array<DockerAlertTemplateCategory> = [
      "Container",
      "Resource",
      "Host",
    ];

    let total: number = 0;
    for (const category of categories) {
      const inCategory: Array<DockerAlertTemplate> =
        getDockerAlertTemplatesByCategory(category);
      for (const template of inCategory) {
        expect(template.category).toBe(category);
      }
      total += inCategory.length;
    }
    // Every template falls into exactly one of the known categories.
    expect(total).toBe(all.length);
  });

  test.each(DOCKER_TEMPLATES)(
    "$id is a $severity $category template with populated copy",
    (tc: DockerTemplateCase) => {
      const template: DockerAlertTemplate | undefined =
        getDockerAlertTemplateById(tc.id);
      expect(template).toBeDefined();
      expect(template!.category).toBe(tc.category);
      expect(template!.severity).toBe(tc.severity);
      expect(template!.name.length).toBeGreaterThan(0);
      expect(template!.description.length).toBeGreaterThan(0);
    },
  );

  test.each(DOCKER_TEMPLATES)(
    "$id queries $metricName with the intended aggregation and window",
    (tc: DockerTemplateCase) => {
      const template: DockerAlertTemplate = getDockerAlertTemplateById(tc.id)!;
      const step: MonitorStep = template.getMonitorStep(buildArgs());
      const monitor: MonitorStepDockerMonitor = getDockerMonitor(step);

      expect(monitor.hostIdentifier).toBe("docker-host-01");

      const queryConfigs: Array<any> = monitor.metricViewConfig
        .queryConfigs as Array<any>;
      // A single-metric threshold template has exactly one query, no formula.
      expect(queryConfigs).toHaveLength(1);
      expect(monitor.metricViewConfig.formulaConfigs).toHaveLength(0);

      const filterData: any = queryConfigs[0].metricQueryData.filterData;
      expect(filterData.metricName).toBe(tc.metricName);
      expect(filterData.aggegationType).toBe(tc.aggregation);
      expect(monitor.rollingTime).toBe(tc.rollingTime);
    },
  );

  test.each(DOCKER_TEMPLATES)(
    "$id unhealthy/healthy criteria leave a recovery dead band around $threshold",
    (tc: DockerTemplateCase) => {
      const template: DockerAlertTemplate = getDockerAlertTemplateById(tc.id)!;
      const step: MonitorStep = template.getMonitorStep(buildArgs());

      const instances: Array<any> = step.data?.monitorCriteria.data
        ?.monitorCriteriaInstanceArray as Array<any>;
      // Exactly two criteria: [unhealthy, healthy].
      expect(instances).toHaveLength(2);
      const [offline, online] = instances;

      const offlineFilter: any = offline.data.filters[0];
      const onlineFilter: any = online.data.filters[0];

      // Both criteria evaluate the same metric alias, at different thresholds.
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

      // Only the comparison DIRECTION differs — pinned per template.
      expect(offlineFilter.filterType).toBe(tc.offlineFilterType);
      expect(onlineFilter.filterType).toBe(tc.onlineFilterType);

      // Only the unhealthy criterion opens incidents/alerts.
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
    // A container alert must not linger once the container is healthy again.
    for (const tc of DOCKER_TEMPLATES) {
      const step: MonitorStep = getDockerAlertTemplateById(
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
