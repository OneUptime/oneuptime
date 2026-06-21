import {
  DockerSwarmAlertTemplate,
  DockerSwarmAlertTemplateArgs,
  getAllDockerSwarmAlertTemplates,
  getDockerSwarmAlertTemplateById,
  getDockerSwarmAlertTemplatesByCategory,
} from "../../../Types/Monitor/DockerSwarmAlertTemplates";
import { getDockerSwarmMetricByMetricName } from "../../../Types/Monitor/DockerSwarmMetricCatalog";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorStepDockerSwarmMonitor from "../../../Types/Monitor/MonitorStepDockerSwarmMonitor";
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import { FilterType } from "../../../Types/Monitor/CriteriaFilter";
import MetricsAggregationType from "../../../Types/Metrics/MetricsAggregationType";
import RollingTime from "../../../Types/RollingTime/RollingTime";
import ObjectID from "../../../Types/ObjectID";

/*
 * Lock in the Docker Swarm alert-template contracts (mirrors the Proxmox/Ceph
 * precedents). Two layers:
 *
 *   1. ENUMERATED invariants run over getAllDockerSwarmAlertTemplates(), so a
 *      newly added template is automatically covered: it must build a valid
 *      MonitorStep, reference only catalog metrics, resolve every criteria
 *      alias, group by the raw `container.name` datapoint label (docker_stats
 *      container identity lives in datapoint labels — NEVER `resource.`
 *      -prefixed), and use disjoint fire/recover thresholds on the same alias.
 *
 *   2. A per-template expectation table pins the spec'd metric / aggregation /
 *      threshold / rolling-time decisions. The table is exhaustive both ways —
 *      adding a template without a row here fails loudly, which is the point.
 *
 * Telemetry contract: the Docker Swarm agent stamps ONLY the resource
 * attribute `docker.swarm.cluster.name` (no container.runtime, no host.name).
 * Metrics come from the docker_stats receiver as standard `container.*`
 * series, with container identity (`container.name` =
 * `<service>.<slot>.<taskid>`) in datapoint labels. Templates group by
 * `container.name` so one incident fires per task; the worker injects the
 * cluster scope from clusterIdentifier.
 */

interface QueryExpectation {
  metricName: string;
  aggregation: MetricsAggregationType;
}

interface ThresholdExpectation {
  alias: string;
  filterType: FilterType;
  value: number;
}

interface TemplateExpectation {
  id: string;
  name: string;
  category: string;
  severity: string;
  rollingTime: RollingTime;
  query: QueryExpectation;
  groupBy: string;
  fire: ThresholdExpectation;
  recover: ThresholdExpectation;
}

const EXPECTED_TEMPLATES: Array<TemplateExpectation> = [
  {
    /*
     * Min per task over Past1Minute so a single zero-uptime scrape (a fresh
     * restart) trips it instead of being masked by a longer-running window.
     */
    id: "docker-swarm-task-down",
    name: "Task Down (Low Uptime)",
    category: "Availability",
    severity: "Critical",
    rollingTime: RollingTime.Past1Minute,
    query: {
      metricName: "container.uptime",
      aggregation: MetricsAggregationType.Min,
    },
    groupBy: "container.name",
    fire: {
      alias: "container_uptime",
      filterType: FilterType.EqualTo,
      value: 0,
    },
    recover: {
      alias: "container_uptime",
      filterType: FilterType.GreaterThan,
      value: 0,
    },
  },
  {
    /*
     * container.cpu.utilization is already a percentage per container, so the
     * per-minute Avg is the sustained utilization regardless of scrape count.
     */
    id: "docker-swarm-high-cpu",
    name: "High Task CPU Usage",
    category: "Resource",
    severity: "Warning",
    rollingTime: RollingTime.Past5Minutes,
    query: {
      metricName: "container.cpu.utilization",
      aggregation: MetricsAggregationType.Avg,
    },
    groupBy: "container.name",
    fire: {
      alias: "container_cpu",
      filterType: FilterType.GreaterThan,
      value: 80,
    },
    recover: {
      alias: "container_cpu",
      filterType: FilterType.LessThanOrEqualTo,
      value: 80,
    },
  },
  {
    // container.memory.percent is a true percentage per container -> Avg.
    id: "docker-swarm-high-memory",
    name: "High Task Memory Usage",
    category: "Resource",
    severity: "Warning",
    rollingTime: RollingTime.Past5Minutes,
    query: {
      metricName: "container.memory.percent",
      aggregation: MetricsAggregationType.Avg,
    },
    groupBy: "container.name",
    fire: {
      alias: "container_memory",
      filterType: FilterType.GreaterThan,
      value: 85,
    },
    recover: {
      alias: "container_memory",
      filterType: FilterType.LessThanOrEqualTo,
      value: 85,
    },
  },
  {
    // Max per task — any scrape over the threshold trips it (fork bomb/leak).
    id: "docker-swarm-high-pids",
    name: "High Task Process Count",
    category: "Container",
    severity: "Warning",
    rollingTime: RollingTime.Past5Minutes,
    query: {
      metricName: "container.pids.count",
      aggregation: MetricsAggregationType.Max,
    },
    groupBy: "container.name",
    fire: {
      alias: "container_pids",
      filterType: FilterType.GreaterThan,
      value: 500,
    },
    recover: {
      alias: "container_pids",
      filterType: FilterType.LessThanOrEqualTo,
      value: 500,
    },
  },
];

function buildArgs(): DockerSwarmAlertTemplateArgs {
  return {
    clusterIdentifier: "swarm-prod",
    onlineMonitorStatusId: ObjectID.generate(),
    offlineMonitorStatusId: ObjectID.generate(),
    defaultIncidentSeverityId: ObjectID.generate(),
    defaultAlertSeverityId: ObjectID.generate(),
    monitorName: "Test Monitor",
  };
}

function getDockerSwarmMonitor(
  step: MonitorStep,
): MonitorStepDockerSwarmMonitor {
  const dockerSwarmMonitor: MonitorStepDockerSwarmMonitor | undefined =
    step.data?.dockerSwarmMonitor;
  if (!dockerSwarmMonitor) {
    throw new Error("dockerSwarmMonitor missing from monitor step");
  }
  return dockerSwarmMonitor;
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

// Aliases a criteria filter may legally reference: query + formula variables.
function getReferencableAliases(
  monitor: MonitorStepDockerSwarmMonitor,
): Set<string> {
  const aliases: Set<string> = new Set<string>();
  for (const queryConfig of monitor.metricViewConfig
    .queryConfigs as Array<any>) {
    aliases.add(queryConfig.metricAliasData.metricVariable);
  }
  for (const formulaConfig of (monitor.metricViewConfig.formulaConfigs ||
    []) as Array<any>) {
    aliases.add(formulaConfig.metricAliasData.metricVariable);
  }
  return aliases;
}

/*
 * Fire and recover must be disjoint complements on the same alias —
 * otherwise the monitor either flaps (overlap) or wedges (gap).
 */
function isDisjointComplement(
  fire: { filterType: FilterType; value: number },
  recover: { filterType: FilterType; value: number },
): boolean {
  if (fire.value !== recover.value) {
    return false;
  }
  switch (fire.filterType) {
    case FilterType.GreaterThan:
      return (
        recover.filterType === FilterType.LessThanOrEqualTo ||
        (fire.value === 0 && recover.filterType === FilterType.EqualTo)
      );
    case FilterType.GreaterThanOrEqualTo:
      return recover.filterType === FilterType.LessThan;
    case FilterType.LessThan:
      return recover.filterType === FilterType.GreaterThanOrEqualTo;
    case FilterType.LessThanOrEqualTo:
      return recover.filterType === FilterType.GreaterThan;
    case FilterType.EqualTo:
      // Task-down: fire when uptime == 0, recover when uptime > 0.
      return fire.value === 0 && recover.filterType === FilterType.GreaterThan;
    default:
      return false;
  }
}

const ALL_TEMPLATES: Array<DockerSwarmAlertTemplate> =
  getAllDockerSwarmAlertTemplates();

describe("DockerSwarmAlertTemplates - registry", () => {
  test("template ids are unique and match the expectation table exactly", () => {
    const ids: Array<string> = ALL_TEMPLATES.map(
      (t: DockerSwarmAlertTemplate) => {
        return t.id;
      },
    );
    expect(new Set(ids).size).toBe(ids.length);
    // Exhaustive both ways: a new template must get an expectation row.
    expect([...ids].sort()).toEqual(
      EXPECTED_TEMPLATES.map((t: TemplateExpectation) => {
        return t.id;
      }).sort(),
    );
  });

  test("getDockerSwarmAlertTemplateById resolves every id (and misses cleanly)", () => {
    for (const expected of EXPECTED_TEMPLATES) {
      expect(getDockerSwarmAlertTemplateById(expected.id)).toBeDefined();
    }
    expect(getDockerSwarmAlertTemplateById("does-not-exist")).toBeUndefined();
  });

  test("getDockerSwarmAlertTemplatesByCategory partitions the registry", () => {
    const resource: Array<DockerSwarmAlertTemplate> =
      getDockerSwarmAlertTemplatesByCategory("Resource");
    const availability: Array<DockerSwarmAlertTemplate> =
      getDockerSwarmAlertTemplatesByCategory("Availability");
    const container: Array<DockerSwarmAlertTemplate> =
      getDockerSwarmAlertTemplatesByCategory("Container");

    expect(
      resource
        .map((t: DockerSwarmAlertTemplate) => {
          return t.id;
        })
        .sort(),
    ).toEqual(["docker-swarm-high-cpu", "docker-swarm-high-memory"].sort());
    expect(
      availability.map((t: DockerSwarmAlertTemplate) => {
        return t.id;
      }),
    ).toEqual(["docker-swarm-task-down"]);
    expect(
      container.map((t: DockerSwarmAlertTemplate) => {
        return t.id;
      }),
    ).toEqual(["docker-swarm-high-pids"]);

    // Every template lands in exactly one of the three categories.
    expect(resource.length + availability.length + container.length).toBe(
      ALL_TEMPLATES.length,
    );
  });
});

describe("DockerSwarmAlertTemplates - enumerated invariants (every template)", () => {
  test.each(
    ALL_TEMPLATES.map((t: DockerSwarmAlertTemplate) => {
      return [t.id, t];
    }),
  )("%s builds a valid MonitorStep", (_id: unknown, template: unknown) => {
    const args: DockerSwarmAlertTemplateArgs = buildArgs();
    const step: MonitorStep = (
      template as DockerSwarmAlertTemplate
    ).getMonitorStep(args);
    const monitor: MonitorStepDockerSwarmMonitor = getDockerSwarmMonitor(step);

    // The cluster identifier is injected from the template args.
    expect(monitor.clusterIdentifier).toBe(args.clusterIdentifier);
    expect(monitor.metricViewConfig.queryConfigs.length).toBeGreaterThan(0);

    const instances: Array<MonitorCriteriaInstance> =
      getCriteriaInstances(step);
    expect(instances.length).toBeGreaterThanOrEqual(2);

    /*
     * Criteria are evaluated first-match-wins: every instance before the
     * last is an unhealthy tier (creates incidents + alerts, flips to the
     * offline status); the LAST is the recover instance (no incidents, flips
     * to the online status).
     */
    const offlineInstances: Array<MonitorCriteriaInstance> = instances.slice(
      0,
      -1,
    );
    const onlineInstance: MonitorCriteriaInstance =
      instances[instances.length - 1]!;

    for (const offline of offlineInstances) {
      expect(offline.data?.monitorStatusId).toBe(args.offlineMonitorStatusId);
      expect(offline.data?.createIncidents).toBe(true);
      expect(offline.data?.createAlerts).toBe(true);
      expect(offline.data?.incidents).toHaveLength(1);
      expect(offline.data?.alerts).toHaveLength(1);
      expect(offline.data?.incidents?.[0]?.autoResolveIncident).toBe(true);
      expect(offline.data?.alerts?.[0]?.autoResolveAlert).toBe(true);
    }

    expect(onlineInstance.data?.monitorStatusId).toBe(
      args.onlineMonitorStatusId,
    );
    expect(onlineInstance.data?.createIncidents).toBe(false);
    expect(onlineInstance.data?.createAlerts).toBe(false);
    expect(onlineInstance.data?.name).toBe("Healthy");
  });

  test.each(
    ALL_TEMPLATES.map((t: DockerSwarmAlertTemplate) => {
      return [t.id, t];
    }),
  )(
    "%s references only catalog metrics and resolvable aliases",
    (_id: unknown, template: unknown) => {
      const step: MonitorStep = (
        template as DockerSwarmAlertTemplate
      ).getMonitorStep(buildArgs());
      const monitor: MonitorStepDockerSwarmMonitor =
        getDockerSwarmMonitor(step);

      for (const queryConfig of monitor.metricViewConfig
        .queryConfigs as Array<any>) {
        const metricName: string =
          queryConfig.metricQueryData.filterData.metricName;
        expect(getDockerSwarmMetricByMetricName(metricName)).toBeDefined();
      }

      const aliases: Set<string> = getReferencableAliases(monitor);
      for (const instance of getCriteriaInstances(step)) {
        for (const filter of instance.data?.filters || []) {
          expect(aliases).toContain(
            (filter as any).metricMonitorOptions.metricAlias,
          );
        }
      }
    },
  );

  test.each(
    ALL_TEMPLATES.map((t: DockerSwarmAlertTemplate) => {
      return [t.id, t];
    }),
  )(
    "%s groups by the container.name datapoint label only (never resource.-prefixed)",
    (_id: unknown, template: unknown) => {
      const step: MonitorStep = (
        template as DockerSwarmAlertTemplate
      ).getMonitorStep(buildArgs());
      const monitor: MonitorStepDockerSwarmMonitor =
        getDockerSwarmMonitor(step);

      for (const queryConfig of monitor.metricViewConfig
        .queryConfigs as Array<any>) {
        const groupBys: Array<string> =
          queryConfig.metricQueryData.groupByAttributeKeys || [];
        for (const key of groupBys) {
          /*
           * docker_stats container identity is the `container.name` DATAPOINT
           * label. A `resource.`-prefixed key would match nothing in
           * ClickHouse and collapse every task into one mislabeled series.
           */
          expect(key).toBe("container.name");
        }
      }
    },
  );

  test.each(
    ALL_TEMPLATES.map((t: DockerSwarmAlertTemplate) => {
      return [t.id, t];
    }),
  )(
    "%s has disjoint fire/recover thresholds on the same alias",
    (_id: unknown, template: unknown) => {
      const step: MonitorStep = (
        template as DockerSwarmAlertTemplate
      ).getMonitorStep(buildArgs());
      const instances: Array<MonitorCriteriaInstance> =
        getCriteriaInstances(step);
      const onlineFilters: Array<any> = (instances[instances.length - 1]!.data
        ?.filters || []) as Array<any>;

      for (const offline of instances.slice(0, -1)) {
        for (const fireFilter of (offline.data?.filters || []) as Array<any>) {
          const recoverFilter: any = onlineFilters.find((f: any) => {
            return (
              f.metricMonitorOptions.metricAlias ===
              fireFilter.metricMonitorOptions.metricAlias
            );
          });
          expect(recoverFilter).toBeDefined();
          expect(
            isDisjointComplement(
              {
                filterType: fireFilter.filterType,
                value: fireFilter.value as number,
              },
              {
                filterType: recoverFilter.filterType,
                value: recoverFilter.value as number,
              },
            ),
          ).toBe(true);
        }
      }
    },
  );

  test.each(
    ALL_TEMPLATES.map((t: DockerSwarmAlertTemplate) => {
      return [t.id, t];
    }),
  )(
    "%s is single-query with no formulas (per-task container metric)",
    (_id: unknown, template: unknown) => {
      const step: MonitorStep = (
        template as DockerSwarmAlertTemplate
      ).getMonitorStep(buildArgs());
      const monitor: MonitorStepDockerSwarmMonitor =
        getDockerSwarmMonitor(step);

      // Each Docker Swarm template reads exactly one container.* series.
      expect(monitor.metricViewConfig.queryConfigs).toHaveLength(1);
      expect(monitor.metricViewConfig.formulaConfigs || []).toHaveLength(0);
    },
  );
});

describe("DockerSwarmAlertTemplates - spec table expectations", () => {
  test.each(
    EXPECTED_TEMPLATES.map((t: TemplateExpectation) => {
      return [t.id, t];
    }),
  )(
    "%s matches the spec'd metric/aggregation/threshold contract",
    (_id: unknown, expected: unknown) => {
      const tc: TemplateExpectation = expected as TemplateExpectation;
      const template: DockerSwarmAlertTemplate | undefined =
        getDockerSwarmAlertTemplateById(tc.id);
      expect(template).toBeDefined();

      expect(template!.name).toBe(tc.name);
      expect(template!.category).toBe(tc.category);
      expect(template!.severity).toBe(tc.severity);

      const step: MonitorStep = template!.getMonitorStep(buildArgs());
      const monitor: MonitorStepDockerSwarmMonitor =
        getDockerSwarmMonitor(step);

      expect(monitor.rollingTime).toBe(tc.rollingTime);

      const queryConfigs: Array<any> = monitor.metricViewConfig
        .queryConfigs as Array<any>;
      expect(queryConfigs).toHaveLength(1);

      const filterData: any = queryConfigs[0].metricQueryData.filterData;
      expect(filterData.metricName).toBe(tc.query.metricName);
      expect(filterData.aggegationType).toBe(tc.query.aggregation);

      const groupBys: Array<string> =
        queryConfigs[0].metricQueryData.groupByAttributeKeys || [];
      expect(groupBys).toEqual([tc.groupBy]);

      const instances: Array<MonitorCriteriaInstance> =
        getCriteriaInstances(step);
      expect(instances).toHaveLength(2);

      const fireFilter: any = (instances[0]!.data?.filters as Array<any>)[0];
      expect(fireFilter.metricMonitorOptions.metricAlias).toBe(tc.fire.alias);
      expect(fireFilter.filterType).toBe(tc.fire.filterType);
      expect(fireFilter.value).toBe(tc.fire.value);

      const recoverFilter: any = (instances[1]!.data?.filters as Array<any>)[0];
      expect(recoverFilter.metricMonitorOptions.metricAlias).toBe(
        tc.recover.alias,
      );
      expect(recoverFilter.filterType).toBe(tc.recover.filterType);
      expect(recoverFilter.value).toBe(tc.recover.value);
    },
  );
});
