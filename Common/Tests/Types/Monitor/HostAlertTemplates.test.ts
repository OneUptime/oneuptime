import {
  HostAlertTemplate,
  HostAlertTemplateArgs,
  HostAlertTemplateCategory,
  getAllHostAlertTemplates,
  getHostAlertTemplateById,
  getHostAlertTemplatesByCategory,
} from "../../../Types/Monitor/HostAlertTemplates";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import { hasRecoveryDeadBand } from "./Utils/RecommendationCriteriaAssertions";
import MonitorStepHostMonitor from "../../../Types/Monitor/MonitorStepHostMonitor";
import MetricsAggregationType from "../../../Types/Metrics/MetricsAggregationType";
import { FilterType } from "../../../Types/Monitor/CriteriaFilter";
import ObjectID from "../../../Types/ObjectID";

/*
 * Host resource templates. The regression-prone details these tests pin:
 *
 *   1. The OTel metric name each template reads (system.cpu.utilization,
 *      system.memory.utilization, ...). A rename in the host receiver would
 *      make the template match nothing while staying "registered".
 *
 *   2. Ratio metrics are on a [0, 1] scale, so a "90%" threshold is the
 *      literal 0.9 — NOT 90. A slip to 90 makes the utilization templates
 *      unreachable (utilization never exceeds 1). Load average and process
 *      count are raw counts, so their thresholds (4, 2000) are literal.
 *
 *   3. Aggregation: filesystem usage and process count use `Max` so a single
 *      full mount / one runaway host trips the alert instead of being averaged
 *      away; the rest use `Avg` for a representative sustained reading.
 *
 *   4. The unhealthy/healthy criteria partition the range at the threshold
 *      with `>` / `<=` — no gap, no overlap.
 */

interface HostTemplateCase {
  id: string;
  category: HostAlertTemplateCategory;
  severity: "Critical" | "Warning";
  metricName: string;
  metricAlias: string;
  aggregation: MetricsAggregationType;
  threshold: number;
}

const HOST_TEMPLATES: Array<HostTemplateCase> = [
  {
    id: "host-high-cpu",
    category: "Resource",
    severity: "Warning",
    metricName: "system.cpu.utilization",
    metricAlias: "host_cpu",
    aggregation: MetricsAggregationType.Avg,
    threshold: 0.8,
  },
  {
    id: "host-high-memory",
    category: "Resource",
    severity: "Warning",
    metricName: "system.memory.utilization",
    metricAlias: "host_memory",
    aggregation: MetricsAggregationType.Avg,
    threshold: 0.85,
  },
  {
    id: "host-high-filesystem",
    category: "Resource",
    severity: "Critical",
    metricName: "system.filesystem.utilization",
    metricAlias: "host_filesystem",
    // Max so a single full filesystem is not diluted by averaging mounts.
    aggregation: MetricsAggregationType.Max,
    threshold: 0.9,
  },
  {
    id: "host-high-load-average",
    category: "Resource",
    severity: "Warning",
    metricName: "system.cpu.load_average.1m",
    metricAlias: "host_load_1m",
    aggregation: MetricsAggregationType.Avg,
    // Load average is a raw count, not a ratio — threshold is literal 4.
    threshold: 4,
  },
  {
    id: "host-high-processes",
    category: "Host",
    severity: "Warning",
    metricName: "system.processes.count",
    metricAlias: "host_processes",
    aggregation: MetricsAggregationType.Max,
    threshold: 2000,
  },
];

function buildArgs(): HostAlertTemplateArgs {
  return {
    hostIdentifier: "host-01",
    onlineMonitorStatusId: ObjectID.generate(),
    offlineMonitorStatusId: ObjectID.generate(),
    defaultIncidentSeverityId: ObjectID.generate(),
    defaultAlertSeverityId: ObjectID.generate(),
    monitorName: "Test Host Monitor",
  };
}

function getHostMonitor(step: MonitorStep): MonitorStepHostMonitor {
  const hostMonitor: MonitorStepHostMonitor | undefined =
    step.data?.hostMonitor;
  if (!hostMonitor) {
    throw new Error("hostMonitor missing from monitor step");
  }
  return hostMonitor;
}

describe("HostAlertTemplates", () => {
  test("every documented template id is registered and the suite is exhaustive", () => {
    const ids: Array<string> = getAllHostAlertTemplates().map(
      (t: HostAlertTemplate) => {
        return t.id;
      },
    );
    for (const tc of HOST_TEMPLATES) {
      expect(ids).toContain(tc.id);
    }
    expect(ids.sort()).toEqual(
      HOST_TEMPLATES.map((t: HostTemplateCase) => {
        return t.id;
      }).sort(),
    );
  });

  test("every template id is unique", () => {
    const ids: Array<string> = getAllHostAlertTemplates().map(
      (t: HostAlertTemplate) => {
        return t.id;
      },
    );
    expect(new Set(ids).size).toBe(ids.length);
  });

  test("getHostAlertTemplateById returns undefined for an unknown id", () => {
    expect(getHostAlertTemplateById("host-nothing")).toBeUndefined();
  });

  test("getHostAlertTemplatesByCategory returns only that category and covers the catalog", () => {
    const all: Array<HostAlertTemplate> = getAllHostAlertTemplates();
    const categories: Array<HostAlertTemplateCategory> = ["Resource", "Host"];

    let total: number = 0;
    for (const category of categories) {
      const inCategory: Array<HostAlertTemplate> =
        getHostAlertTemplatesByCategory(category);
      for (const template of inCategory) {
        expect(template.category).toBe(category);
      }
      total += inCategory.length;
    }
    expect(total).toBe(all.length);
  });

  test.each(HOST_TEMPLATES)(
    "$id is a $severity $category template with populated copy",
    (tc: HostTemplateCase) => {
      const template: HostAlertTemplate | undefined = getHostAlertTemplateById(
        tc.id,
      );
      expect(template).toBeDefined();
      expect(template!.category).toBe(tc.category);
      expect(template!.severity).toBe(tc.severity);
      expect(template!.name.length).toBeGreaterThan(0);
      expect(template!.description.length).toBeGreaterThan(0);
    },
  );

  test.each(HOST_TEMPLATES)(
    "$id queries $metricName with the intended aggregation",
    (tc: HostTemplateCase) => {
      const template: HostAlertTemplate = getHostAlertTemplateById(tc.id)!;
      const step: MonitorStep = template.getMonitorStep(buildArgs());
      const monitor: MonitorStepHostMonitor = getHostMonitor(step);

      expect(monitor.hostIdentifier).toBe("host-01");

      const queryConfigs: Array<any> = monitor.metricViewConfig
        .queryConfigs as Array<any>;
      expect(queryConfigs).toHaveLength(1);
      expect(monitor.metricViewConfig.formulaConfigs).toHaveLength(0);

      const filterData: any = queryConfigs[0].metricQueryData.filterData;
      expect(filterData.metricName).toBe(tc.metricName);
      expect(filterData.aggegationType).toBe(tc.aggregation);
    },
  );

  test.each(HOST_TEMPLATES)(
    "$id unhealthy/healthy criteria leave a recovery dead band below $threshold",
    (tc: HostTemplateCase) => {
      const template: HostAlertTemplate = getHostAlertTemplateById(tc.id)!;
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

      // Host ceilings are all "> threshold" unhealthy / "<= threshold" healthy.
      expect(offlineFilter.filterType).toBe(FilterType.GreaterThan);
      expect(onlineFilter.filterType).toBe(FilterType.LessThanOrEqualTo);

      expect(offline.data.createIncidents).toBe(true);
      expect(offline.data.createAlerts).toBe(true);
      expect(online.data.createIncidents).toBe(false);
      expect(online.data.createAlerts).toBe(false);
    },
  );

  test("ratio-metric thresholds stay on the 0-1 scale, not 0-100", () => {
    /*
     * A "90%" threshold written as 90 would make a utilization ([0,1])
     * template unreachable. Lock the utilization templates below 1.
     */
    const ratioIds: Array<string> = [
      "host-high-cpu",
      "host-high-memory",
      "host-high-filesystem",
    ];
    for (const id of ratioIds) {
      const tc: HostTemplateCase = HOST_TEMPLATES.find(
        (t: HostTemplateCase) => {
          return t.id === id;
        },
      )!;
      expect(tc.threshold).toBeGreaterThan(0);
      expect(tc.threshold).toBeLessThanOrEqual(1);
    }
  });
});
