import {
  XCP_NG_HOST_RESTARTED_UPTIME_SECONDS,
  XCP_NG_SR_NEAR_FULL_PERCENT,
  XCP_NG_SR_SLOW_LATENCY_SECONDS,
  XCP_NG_VM_CPU_CONTENTION_THRESHOLD,
  XcpNgAlertTemplate,
  XcpNgAlertTemplateArgs,
  getAllXcpNgAlertTemplates,
  getXcpNgAlertTemplateById,
  getXcpNgAlertTemplatesByCategory,
  getXcpNgDefaultAlertTemplateId,
} from "../../../Types/Monitor/XcpNgAlertTemplates";
import { getXcpNgMetricByMetricName } from "../../../Types/Monitor/XcpNgMetricCatalog";
import { getRecoveryThreshold } from "../../../Types/Monitor/Recommendation/RecommendationCriteriaBuilder";
import {
  getComplementFilterType,
  hasRecoveryDeadBand,
} from "./Utils/RecommendationCriteriaAssertions";
import {
  SamplesByAlias,
  evaluateTemplateCriteria,
} from "./Utils/TemplateCriteriaEvaluation";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorStepXcpNgMonitor from "../../../Types/Monitor/MonitorStepXcpNgMonitor";
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import { FilterType } from "../../../Types/Monitor/CriteriaFilter";
import FilterCondition from "../../../Types/Filter/FilterCondition";
import MetricsAggregationType from "../../../Types/Metrics/MetricsAggregationType";
import MetricsViewConfig from "../../../Types/Metrics/MetricsViewConfig";
import RollingTime from "../../../Types/RollingTime/RollingTime";
import ObjectID from "../../../Types/ObjectID";
import { JSONObject } from "../../../Types/JSON";
import {
  XcpNgDerivedSeries,
  XcpNgScope,
} from "../../../Types/XcpNg/XcpNgTelemetry";
import { normalizeXcpNgEnvelope } from "../../../Server/Utils/Telemetry/XcpNgSeriesNormalizer";
import {
  PRODUCTION_POOL_ID,
  SCRAPE_1_NOW_SECONDS,
  SCRAPE_2_NOW_SECONDS,
  getAttributeOf,
  getDatapoints,
  getResourceOfPool,
  parseOpenMetrics,
  readRecordedScrape,
  toAgentResourceMetrics,
} from "../../Server/Utils/Telemetry/XcpNgScrapeFixture";
import { describe, expect, test } from "@jest/globals";

/*
 * The XCP-ng alert templates: their structure (held to the invariants every
 * infrastructure template suite holds), their spec, and - the bar the issue
 * sets - that they fire on the recorded lab: a host offline, a VM halted
 * that ran, a storage repository past 90% and a pool disconnected, and stay
 * quiet on the healthy objects beside them, when the recorded readings are
 * run through the real metric criteria evaluator.
 */

const POOL_UUID: string = PRODUCTION_POOL_ID;

function buildArgs(): XcpNgAlertTemplateArgs {
  return {
    poolIdentifier: POOL_UUID,
    onlineMonitorStatusId: ObjectID.generate(),
    offlineMonitorStatusId: ObjectID.generate(),
    defaultIncidentSeverityId: ObjectID.generate(),
    defaultAlertSeverityId: ObjectID.generate(),
    monitorName: "Production pool",
  };
}

function getXcpNgMonitor(step: MonitorStep): MonitorStepXcpNgMonitor {
  const monitor: MonitorStepXcpNgMonitor | undefined = step.data?.xcpNgMonitor;
  if (!monitor) {
    throw new Error("xcpNgMonitor missing from monitor step");
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

function getReferencableAliases(monitor: MonitorStepXcpNgMonitor): Set<string> {
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
 * 0/1 series thresholded at one ("< 1" fires, ">= 1" recovers): fire and
 * recover are exact complements on that threshold, with no dead band. The
 * qualifying halves ({> 0} / {= 0}) are the zero-threshold pair the shared
 * dead-band check accepts.
 */
const BINARY_METRIC_ALIASES: Set<string> = new Set<string>([
  "host_running",
  "host_enabled",
]);

function isDisjointComplement(
  fire: { filterType: FilterType; value: number },
  recover: { filterType: FilterType; value: number },
  alias: string,
): boolean {
  if (BINARY_METRIC_ALIASES.has(alias)) {
    return (
      getComplementFilterType(fire.filterType) === recover.filterType &&
      recover.value === fire.value
    );
  }
  return hasRecoveryDeadBand(fire, recover);
}

interface QueryExpectation {
  metricName: string;
  aggregation: MetricsAggregationType;
  attributes: Record<string, string>;
}

interface TemplateExpectation {
  id: string;
  category: string;
  severity: string;
  rollingTime: RollingTime;
  queries: Array<QueryExpectation>;
  groupBy: string | null;
  formula: string | null;
  fire: { alias: string; filterType: FilterType; value: number };
}

const HOST_SCOPE: Record<string, string> = { "xcp_ng.scope": XcpNgScope.Host };
const VM_SCOPE: Record<string, string> = { "xcp_ng.scope": XcpNgScope.VM };
const SR_SCOPE: Record<string, string> = {
  "xcp_ng.scope": XcpNgScope.StorageRepository,
};

const EXPECTED_TEMPLATES: Array<TemplateExpectation> = [
  {
    id: "xcp-ng-pool-disconnected",
    category: "Availability",
    severity: "Critical",
    rollingTime: RollingTime.Past10Minutes,
    queries: [
      {
        metricName: "xcp_pool_connected",
        aggregation: MetricsAggregationType.Count,
        attributes: {},
      },
    ],
    groupBy: null,
    formula: null,
    fire: {
      alias: "samples_received",
      filterType: FilterType.LessThan,
      value: 0,
    },
  },
  {
    id: "xcp-ng-host-offline",
    category: "Availability",
    severity: "Critical",
    rollingTime: RollingTime.Past5Minutes,
    queries: [
      {
        metricName: XcpNgDerivedSeries.HostRunning,
        aggregation: MetricsAggregationType.Min,
        attributes: HOST_SCOPE,
      },
    ],
    groupBy: "xcp_ng.id",
    formula: null,
    fire: { alias: "host_running", filterType: FilterType.LessThan, value: 1 },
  },
  {
    id: "xcp-ng-vm-stopped",
    category: "VM",
    severity: "Warning",
    rollingTime: RollingTime.Past5Minutes,
    queries: [
      {
        metricName: XcpNgDerivedSeries.VmStoppedAfterRunning,
        aggregation: MetricsAggregationType.Min,
        attributes: VM_SCOPE,
      },
    ],
    groupBy: "xcp_ng.id",
    formula: null,
    fire: { alias: "vm_stopped", filterType: FilterType.GreaterThan, value: 0 },
  },
  {
    id: "xcp-ng-sr-near-full",
    category: "Storage",
    severity: "Critical",
    rollingTime: RollingTime.Past5Minutes,
    queries: [
      {
        metricName: "xcp_sr_physical_usage_bytes",
        aggregation: MetricsAggregationType.Sum,
        attributes: SR_SCOPE,
      },
      {
        metricName: "xcp_sr_physical_size_bytes",
        aggregation: MetricsAggregationType.Sum,
        attributes: SR_SCOPE,
      },
    ],
    groupBy: "xcp_ng.id",
    formula: "(sr_used / sr_size) * 100",
    fire: {
      alias: "sr_used_percent",
      filterType: FilterType.GreaterThan,
      value: 90,
    },
  },
  {
    id: "xcp-ng-host-disabled",
    category: "Host",
    severity: "Warning",
    rollingTime: RollingTime.Past30Minutes,
    queries: [
      {
        metricName: XcpNgDerivedSeries.HostEnabled,
        aggregation: MetricsAggregationType.Max,
        attributes: HOST_SCOPE,
      },
    ],
    groupBy: "xcp_ng.id",
    formula: null,
    fire: { alias: "host_enabled", filterType: FilterType.LessThan, value: 1 },
  },
  {
    id: "xcp-ng-host-restarted",
    category: "Host",
    severity: "Warning",
    rollingTime: RollingTime.Past5Minutes,
    queries: [
      {
        metricName: "xcp_host_uptime_seconds",
        aggregation: MetricsAggregationType.Min,
        attributes: HOST_SCOPE,
      },
      {
        metricName: XcpNgDerivedSeries.HostRunning,
        aggregation: MetricsAggregationType.Min,
        attributes: HOST_SCOPE,
      },
    ],
    groupBy: "xcp_ng.id",
    formula: null,
    fire: {
      alias: "host_uptime",
      filterType: FilterType.LessThan,
      value: XCP_NG_HOST_RESTARTED_UPTIME_SECONDS,
    },
  },
  {
    id: "xcp-ng-host-high-cpu",
    category: "Host",
    severity: "Warning",
    rollingTime: RollingTime.Past10Minutes,
    queries: [
      {
        metricName: "xcp_host_cpu_average",
        aggregation: MetricsAggregationType.Avg,
        attributes: HOST_SCOPE,
      },
    ],
    groupBy: "xcp_ng.id",
    formula: null,
    fire: { alias: "host_cpu", filterType: FilterType.GreaterThan, value: 0.9 },
  },
  {
    id: "xcp-ng-host-high-memory",
    category: "Host",
    severity: "Warning",
    rollingTime: RollingTime.Past10Minutes,
    queries: [
      {
        metricName: "xcp_host_memory_total_bytes",
        aggregation: MetricsAggregationType.Sum,
        attributes: HOST_SCOPE,
      },
      {
        metricName: "xcp_host_memory_free_bytes",
        aggregation: MetricsAggregationType.Sum,
        attributes: HOST_SCOPE,
      },
    ],
    groupBy: "xcp_ng.id",
    formula: "((mem_total - mem_free) / mem_total) * 100",
    fire: {
      alias: "host_memory_used_percent",
      filterType: FilterType.GreaterThan,
      value: 95,
    },
  },
  {
    id: "xcp-ng-vm-cpu-starved",
    category: "VM",
    severity: "Warning",
    rollingTime: RollingTime.Past15Minutes,
    queries: [
      {
        metricName: "xcp_vm_runstate_full_contention",
        aggregation: MetricsAggregationType.Avg,
        attributes: VM_SCOPE,
      },
    ],
    groupBy: "xcp_ng.id",
    formula: null,
    fire: {
      alias: "vm_cpu_contention",
      filterType: FilterType.GreaterThan,
      value: XCP_NG_VM_CPU_CONTENTION_THRESHOLD,
    },
  },
  {
    id: "xcp-ng-sr-slow",
    category: "Storage",
    severity: "Warning",
    rollingTime: RollingTime.Past15Minutes,
    queries: [
      {
        metricName: "xcp_host_disk_latency_seconds",
        aggregation: MetricsAggregationType.Avg,
        attributes: HOST_SCOPE,
      },
    ],
    groupBy: "sr",
    formula: null,
    fire: {
      alias: "sr_latency",
      filterType: FilterType.GreaterThan,
      value: XCP_NG_SR_SLOW_LATENCY_SECONDS,
    },
  },
];

const ALL_TEMPLATES: Array<XcpNgAlertTemplate> = getAllXcpNgAlertTemplates();

function getTemplate(id: string): XcpNgAlertTemplate {
  const template: XcpNgAlertTemplate | undefined =
    getXcpNgAlertTemplateById(id);
  if (!template) {
    throw new Error(`template ${id} is not registered`);
  }
  return template;
}

describe("XcpNgAlertTemplates - registry", () => {
  test("template ids are unique and match the expectation table exactly", () => {
    const ids: Array<string> = ALL_TEMPLATES.map((t: XcpNgAlertTemplate) => {
      return t.id;
    });
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual(
      EXPECTED_TEMPLATES.map((t: TemplateExpectation) => {
        return t.id;
      }).sort(),
    );
  });

  test("the templates the issue asks for out of the box are all there", () => {
    for (const id of [
      "xcp-ng-host-offline",
      "xcp-ng-host-disabled",
      "xcp-ng-vm-stopped",
      "xcp-ng-vm-cpu-starved",
      "xcp-ng-sr-near-full",
      "xcp-ng-pool-disconnected",
    ]) {
      expect(getXcpNgAlertTemplateById(id)).toBeDefined();
    }
  });

  test("a new monitor starts on the pool going silent", () => {
    expect(getXcpNgDefaultAlertTemplateId()).toBe("xcp-ng-pool-disconnected");
  });

  test("templates by category cover every template once", () => {
    const byCategory: Array<XcpNgAlertTemplate> = [
      "Availability",
      "Host",
      "VM",
      "Storage",
    ].flatMap((category: string) => {
      return getXcpNgAlertTemplatesByCategory(
        category as XcpNgAlertTemplate["category"],
      );
    });
    expect(byCategory).toHaveLength(ALL_TEMPLATES.length);
  });

  test("an unknown id finds nothing", () => {
    expect(getXcpNgAlertTemplateById("pve-node-offline")).toBeUndefined();
  });

  test.each(
    ALL_TEMPLATES.map((t: XcpNgAlertTemplate) => {
      return [t.id, t];
    }),
  )(
    "%s says when it fires in one plain sentence, and how in its description",
    (_id: unknown, template: unknown) => {
      const t: XcpNgAlertTemplate = template as XcpNgAlertTemplate;
      expect(t.name.length).toBeGreaterThan(3);
      expect(t.summary.endsWith(".")).toBe(true);
      expect(t.summary).not.toMatch(/xcp_|xcp_ng\./);
      expect(t.description.length).toBeGreaterThan(t.summary.length);
    },
  );
});

describe("XcpNgAlertTemplates - enumerated invariants (every template)", () => {
  test.each(
    ALL_TEMPLATES.map((t: XcpNgAlertTemplate) => {
      return [t.id, t];
    }),
  )(
    "%s builds a valid monitor step for the pool",
    (_id: unknown, template: unknown) => {
      const args: XcpNgAlertTemplateArgs = buildArgs();
      const step: MonitorStep = (template as XcpNgAlertTemplate).getMonitorStep(
        args,
      );
      const monitor: MonitorStepXcpNgMonitor = getXcpNgMonitor(step);

      expect(monitor.poolIdentifier).toBe(args.poolIdentifier);
      expect(monitor.resourceFilters).toEqual({});
      expect(monitor.metricViewConfig.queryConfigs.length).toBeGreaterThan(0);

      const instances: Array<MonitorCriteriaInstance> =
        getCriteriaInstances(step);
      expect(instances).toHaveLength(2);
      const [offline, online] = instances as [
        MonitorCriteriaInstance,
        MonitorCriteriaInstance,
      ];
      expect(offline.data?.monitorStatusId).toBe(args.offlineMonitorStatusId);
      expect(offline.data?.createIncidents).toBe(true);
      expect(offline.data?.createAlerts).toBe(true);
      expect(offline.data?.incidents).toHaveLength(1);
      expect(offline.data?.alerts).toHaveLength(1);
      expect(offline.data?.incidents?.[0]?.autoResolveIncident).toBe(true);
      expect(offline.data?.alerts?.[0]?.autoResolveAlert).toBe(true);
      expect(offline.data?.incidents?.[0]?.title).toContain("[XCP-ng]");
      expect(offline.data?.incidents?.[0]?.title).toContain(args.monitorName);
      expect(online.data?.monitorStatusId).toBe(args.onlineMonitorStatusId);
      expect(online.data?.createIncidents).toBe(false);
      expect(online.data?.createAlerts).toBe(false);
      expect(online.data?.name).toBe("Healthy");
    },
  );

  test.each(
    ALL_TEMPLATES.map((t: XcpNgAlertTemplate) => {
      return [t.id, t];
    }),
  )(
    "%s reads only catalog metrics, through aliases it defines",
    (_id: unknown, template: unknown) => {
      const step: MonitorStep = (template as XcpNgAlertTemplate).getMonitorStep(
        buildArgs(),
      );
      const monitor: MonitorStepXcpNgMonitor = getXcpNgMonitor(step);
      for (const queryConfig of monitor.metricViewConfig
        .queryConfigs as Array<any>) {
        expect(
          getXcpNgMetricByMetricName(
            queryConfig.metricQueryData.filterData.metricName,
          ),
        ).toBeDefined();
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
    ALL_TEMPLATES.map((t: XcpNgAlertTemplate) => {
      return [t.id, t];
    }),
  )(
    "%s groups by datapoint labels only, never resource.-prefixed",
    (_id: unknown, template: unknown) => {
      const monitor: MonitorStepXcpNgMonitor = getXcpNgMonitor(
        (template as XcpNgAlertTemplate).getMonitorStep(buildArgs()),
      );
      for (const queryConfig of monitor.metricViewConfig
        .queryConfigs as Array<any>) {
        for (const key of queryConfig.metricQueryData.groupByAttributeKeys ||
          []) {
          expect(key.startsWith("resource.")).toBe(false);
          expect(["xcp_ng.id", "sr"]).toContain(key);
        }
        for (const key of Object.keys(
          queryConfig.metricQueryData.filterData.attributes,
        )) {
          expect(key.startsWith("resource.")).toBe(false);
        }
      }
    },
  );

  test.each(
    ALL_TEMPLATES.map((t: XcpNgAlertTemplate) => {
      return [t.id, t];
    }),
  )(
    "%s has disjoint fire/recover thresholds on every firing alias",
    (_id: unknown, template: unknown) => {
      const instances: Array<MonitorCriteriaInstance> = getCriteriaInstances(
        (template as XcpNgAlertTemplate).getMonitorStep(buildArgs()),
      );
      const onlineFilters: Array<any> = (instances[1]!.data?.filters ||
        []) as Array<any>;
      for (const fireFilter of (instances[0]!.data?.filters ||
        []) as Array<any>) {
        const alias: string = fireFilter.metricMonitorOptions.metricAlias;
        const recoverFilter: any = onlineFilters.find((f: any) => {
          return f.metricMonitorOptions.metricAlias === alias;
        });
        expect(recoverFilter).toBeDefined();
        expect(
          isDisjointComplement(
            { filterType: fireFilter.filterType, value: fireFilter.value },
            {
              filterType: recoverFilter.filterType,
              value: recoverFilter.value,
            },
            alias,
          ),
        ).toBe(true);
      }
    },
  );

  test.each(
    ALL_TEMPLATES.map((t: XcpNgAlertTemplate) => {
      return [t.id, t];
    }),
  )(
    "%s formulas read same-receiver queries alike (Sum/Sum, same filters and group-by)",
    (_id: unknown, template: unknown) => {
      const monitor: MonitorStepXcpNgMonitor = getXcpNgMonitor(
        (template as XcpNgAlertTemplate).getMonitorStep(buildArgs()),
      );
      const queries: Array<any> = monitor.metricViewConfig
        .queryConfigs as Array<any>;
      const formulas: Array<any> = (monitor.metricViewConfig.formulaConfigs ||
        []) as Array<any>;
      if (formulas.length === 0) {
        return;
      }
      expect(formulas).toHaveLength(1);
      expect(formulas[0].metricAliasData.legendUnit).toBe("%");
      for (const query of queries) {
        expect(query.metricQueryData.filterData.aggegationType).toBe(
          MetricsAggregationType.Sum,
        );
        expect(query.metricQueryData.groupByAttributeKeys).toEqual(
          queries[0].metricQueryData.groupByAttributeKeys,
        );
        expect(query.metricQueryData.filterData.attributes).toEqual(
          queries[0].metricQueryData.filterData.attributes,
        );
      }
    },
  );
});

describe("XcpNgAlertTemplates - spec table", () => {
  test.each(
    EXPECTED_TEMPLATES.map((t: TemplateExpectation) => {
      return [t.id, t];
    }),
  )("%s matches its spec", (_id: unknown, expected: unknown) => {
    const tc: TemplateExpectation = expected as TemplateExpectation;
    const template: XcpNgAlertTemplate = getTemplate(tc.id);
    expect(template.category).toBe(tc.category);
    expect(template.severity).toBe(tc.severity);

    const step: MonitorStep = template.getMonitorStep(buildArgs());
    const monitor: MonitorStepXcpNgMonitor = getXcpNgMonitor(step);
    expect(monitor.rollingTime).toBe(tc.rollingTime);

    const queryConfigs: Array<any> = monitor.metricViewConfig
      .queryConfigs as Array<any>;
    expect(queryConfigs).toHaveLength(tc.queries.length);
    tc.queries.forEach((q: QueryExpectation, i: number) => {
      const filterData: any = queryConfigs[i].metricQueryData.filterData;
      expect(filterData.metricName).toBe(q.metricName);
      expect(filterData.aggegationType).toBe(q.aggregation);
      expect(filterData.attributes).toEqual(q.attributes);
      expect(
        queryConfigs[i].metricQueryData.groupByAttributeKeys || [],
      ).toEqual(tc.groupBy ? [tc.groupBy] : []);
    });

    const formulas: Array<any> = (monitor.metricViewConfig.formulaConfigs ||
      []) as Array<any>;
    if (tc.formula) {
      expect(formulas[0].metricFormulaData.metricFormula).toBe(tc.formula);
      expect(formulas[0].metricAliasData.metricVariable).toBe(tc.fire.alias);
    } else {
      expect(formulas).toHaveLength(0);
    }

    const instances: Array<MonitorCriteriaInstance> =
      getCriteriaInstances(step);
    const fire: any = (instances[0]!.data?.filters as Array<any>)[0];
    expect(fire.metricMonitorOptions.metricAlias).toBe(tc.fire.alias);
    expect(fire.filterType).toBe(tc.fire.filterType);
    expect(fire.value).toBe(tc.fire.value);

    const recover: any = (instances[1]!.data?.filters as Array<any>).find(
      (f: any) => {
        return f.metricMonitorOptions.metricAlias === tc.fire.alias;
      },
    );
    const expectedRecovery: number = BINARY_METRIC_ALIASES.has(tc.fire.alias)
      ? tc.fire.value
      : getRecoveryThreshold({
          filterType: tc.fire.filterType,
          value: tc.fire.value,
        }) ?? tc.fire.value;
    expect(recover.value).toBe(expectedRecovery);
  });

  test("Host Restarted fires only for a host that is running: both halves on one host", () => {
    const instances: Array<MonitorCriteriaInstance> = getCriteriaInstances(
      getTemplate("xcp-ng-host-restarted").getMonitorStep(buildArgs()),
    );
    expect(instances[0]!.data?.filterCondition).toBe(FilterCondition.All);
    const aliases: Array<string> = (
      instances[0]!.data?.filters as Array<any>
    ).map((f: any) => {
      return f.metricMonitorOptions.metricAlias;
    });
    expect(aliases.sort()).toEqual(["host_is_running", "host_uptime"]);
  });

  test("no template tells the person to rescope the monitor themselves", () => {
    for (const template of ALL_TEMPLATES) {
      const description: string =
        getCriteriaInstances(template.getMonitorStep(buildArgs()))[0]!.data
          ?.incidents?.[0]?.description || "";
      expect(description).not.toMatch(/re-?scope/i);
      expect(description.length).toBeGreaterThan(80);
    }
  });
});

/*
 * The recorded lab, through the real evaluator. One reading per minute for
 * the template's whole window: what the telemetry worker hands the
 * criteria for one series (one host, VM or storage repository).
 */
function normalizedLab(scrape: 1 | 2): JSONObject {
  const envelope: JSONObject = getResourceOfPool(
    toAgentResourceMetrics(parseOpenMetrics(readRecordedScrape(scrape)), {
      scrapeSeconds: scrape === 1 ? SCRAPE_1_NOW_SECONDS : SCRAPE_2_NOW_SECONDS,
    }),
    PRODUCTION_POOL_ID,
  );
  normalizeXcpNgEnvelope({
    envelope,
    poolIdentifier: PRODUCTION_POOL_ID,
    // web-01 ran in scrape 1, a minute before scrape 2 found it halted.
    ranRecentlyVmUuids: new Set(["e8a5b2c1-3d4e-4f5a-8b6c-7d8e9f0a1b2c"]),
  });
  return envelope;
}

function reading(
  envelope: JSONObject,
  metricName: string,
  id: string,
  idLabel: string = "xcp_ng.id",
): number {
  const found: { datapoint: JSONObject } | undefined = getDatapoints(
    envelope,
  ).find((entry: { metricName: string; datapoint: JSONObject }) => {
    return (
      entry.metricName === metricName &&
      getAttributeOf(entry.datapoint, idLabel) === id
    );
  });
  if (!found) {
    throw new Error(`No ${metricName} reading for ${id}`);
  }
  return found.datapoint["asDouble"] as number;
}

const WINDOW_MINUTES: Record<RollingTime, number> = {
  [RollingTime.Past5Minutes]: 5,
  [RollingTime.Past10Minutes]: 10,
  [RollingTime.Past15Minutes]: 15,
  [RollingTime.Past30Minutes]: 30,
} as Record<RollingTime, number>;

async function evaluateOnLab(
  templateId: string,
  samplesByAlias: SamplesByAlias,
): Promise<{ breached: boolean; healthy: boolean }> {
  const step: MonitorStep = getTemplate(templateId).getMonitorStep(buildArgs());
  const monitor: MonitorStepXcpNgMonitor = getXcpNgMonitor(step);
  return await evaluateTemplateCriteria({
    step,
    viewConfig: monitor.metricViewConfig as MetricsViewConfig,
    samplesByAlias,
    windowMinutes: WINDOW_MINUTES[monitor.rollingTime]!,
  });
}

function steady(value: number, minutes: number): Array<number> {
  return Array.from({ length: minutes }, () => {
    return value;
  });
}

describe("XcpNgAlertTemplates - on the recorded lab", () => {
  const scrape1: JSONObject = normalizedLab(1);
  const scrape2: JSONObject = normalizedLab(2);
  const HOST_PROD1: string = "9c6c0b6e-4f2a-4a7e-8b1e-0d1f2a3b4c5d";
  const HOST_PROD2: string = "4e1d3a2b-7c8d-4e9f-a0b1-c2d3e4f5a6b7";
  const HOST_PROD3: string = "f0e1d2c3-b4a5-4968-8776-655443322110";
  const VM_WEB01: string = "e8a5b2c1-3d4e-4f5a-8b6c-7d8e9f0a1b2c";
  const VM_DB01: string = "3c4d5e6f-7a8b-4c9d-8e0f-1a2b3c4d5e6f";
  const VM_APP02: string = "7b8c9d0e-1f2a-4b3c-9d4e-5f6a7b8c9d0e";
  const SR_NFS: string = "1d2c3b4a-5e6f-4789-9abc-def012345678";
  const SR_LOCAL: string = "ad4b8c63-1f2e-4d3c-8b4a-596877665544";

  test("Host Offline fires for the halted host, and stays quiet for the running one", async () => {
    const down: number = reading(
      scrape1,
      XcpNgDerivedSeries.HostRunning,
      HOST_PROD3,
    );
    const up: number = reading(
      scrape1,
      XcpNgDerivedSeries.HostRunning,
      HOST_PROD1,
    );
    expect(down).toBe(0);
    expect(
      await evaluateOnLab("xcp-ng-host-offline", {
        host_running: steady(down, 5),
      }),
    ).toEqual({
      breached: true,
      healthy: false,
    });
    expect(
      await evaluateOnLab("xcp-ng-host-offline", {
        host_running: steady(up, 5),
      }),
    ).toEqual({
      breached: false,
      healthy: true,
    });
  });

  test("VM Stopped fires for the VM halted after it ran, never for one halted all along", async () => {
    const stopped: number = reading(
      scrape2,
      XcpNgDerivedSeries.VmStoppedAfterRunning,
      VM_WEB01,
    );
    const neverRan: number = reading(
      scrape1,
      XcpNgDerivedSeries.VmStoppedAfterRunning,
      VM_APP02,
    );
    expect(stopped).toBe(1);
    expect(neverRan).toBe(0);
    expect(
      await evaluateOnLab("xcp-ng-vm-stopped", {
        vm_stopped: steady(stopped, 5),
      }),
    ).toEqual({
      breached: true,
      healthy: false,
    });
    expect(
      await evaluateOnLab("xcp-ng-vm-stopped", {
        vm_stopped: steady(neverRan, 5),
      }),
    ).toEqual({
      breached: false,
      healthy: true,
    });
  });

  test("Storage Repository Near Full fires for the NFS repository past 90%, not for the local one", async () => {
    const nfs: SamplesByAlias = {
      sr_used: steady(
        reading(scrape1, "xcp_sr_physical_usage_bytes", SR_NFS),
        5,
      ),
      sr_size: steady(
        reading(scrape1, "xcp_sr_physical_size_bytes", SR_NFS),
        5,
      ),
    };
    const local: SamplesByAlias = {
      sr_used: steady(
        reading(scrape1, "xcp_sr_physical_usage_bytes", SR_LOCAL),
        5,
      ),
      sr_size: steady(
        reading(scrape1, "xcp_sr_physical_size_bytes", SR_LOCAL),
        5,
      ),
    };
    expect((nfs["sr_used"]![0]! / nfs["sr_size"]![0]!) * 100).toBeGreaterThan(
      XCP_NG_SR_NEAR_FULL_PERCENT,
    );
    expect((await evaluateOnLab("xcp-ng-sr-near-full", nfs)).breached).toBe(
      true,
    );
    expect(await evaluateOnLab("xcp-ng-sr-near-full", local)).toEqual({
      breached: false,
      healthy: true,
    });
  });

  test("Pool Disconnected fires when no heartbeat arrives in the window, and not while it does", async () => {
    expect(
      await evaluateOnLab("xcp-ng-pool-disconnected", { samples_received: [] }),
    ).toEqual({
      breached: true,
      healthy: false,
    });
    const heartbeat: number = reading(
      scrape1,
      "xcp_pool_connected",
      PRODUCTION_POOL_ID,
    );
    expect(heartbeat).toBe(1);
    // Count of rows per minute: one scrape a minute, over the ten minutes.
    expect(
      await evaluateOnLab("xcp-ng-pool-disconnected", {
        samples_received: steady(1, 10),
      }),
    ).toEqual({ breached: false, healthy: true });
  });

  test("Host Disabled fires for the host in maintenance mode only", async () => {
    expect(
      (
        await evaluateOnLab("xcp-ng-host-disabled", {
          host_enabled: steady(
            reading(scrape1, XcpNgDerivedSeries.HostEnabled, HOST_PROD2),
            30,
          ),
        })
      ).breached,
    ).toBe(true);
    expect(
      (
        await evaluateOnLab("xcp-ng-host-disabled", {
          host_enabled: steady(
            reading(scrape1, XcpNgDerivedSeries.HostEnabled, HOST_PROD1),
            30,
          ),
        })
      ).breached,
    ).toBe(false);
  });

  test("VM Starved of CPU fires for the database VM waiting on its host, not for the web VM", async () => {
    const db: number = reading(
      scrape1,
      "xcp_vm_runstate_full_contention",
      VM_DB01,
    );
    const web: number = reading(
      scrape1,
      "xcp_vm_runstate_full_contention",
      VM_WEB01,
    );
    expect(db).toBeGreaterThan(XCP_NG_VM_CPU_CONTENTION_THRESHOLD);
    expect(
      (
        await evaluateOnLab("xcp-ng-vm-cpu-starved", {
          vm_cpu_contention: steady(db, 15),
        })
      ).breached,
    ).toBe(true);
    expect(
      (
        await evaluateOnLab("xcp-ng-vm-cpu-starved", {
          vm_cpu_contention: steady(web, 15),
        })
      ).breached,
    ).toBe(false);
  });

  test("Storage Repository Slow fires for the NFS repository's 61 ms, not the local one's 3 ms", async () => {
    const nfs: number = reading(
      scrape1,
      "xcp_host_disk_latency_seconds",
      "1d2c3b4a",
      "sr",
    );
    const local: number = reading(
      scrape1,
      "xcp_host_disk_latency_seconds",
      "ad4b8c63",
      "sr",
    );
    expect(
      (await evaluateOnLab("xcp-ng-sr-slow", { sr_latency: steady(nfs, 15) }))
        .breached,
    ).toBe(true);
    expect(
      (await evaluateOnLab("xcp-ng-sr-slow", { sr_latency: steady(local, 15) }))
        .breached,
    ).toBe(false);
  });

  test("High Host Memory stays quiet on a host with 14% free", async () => {
    const result: { breached: boolean } = await evaluateOnLab(
      "xcp-ng-host-high-memory",
      {
        mem_total: steady(
          reading(scrape1, "xcp_host_memory_total_bytes", HOST_PROD1),
          10,
        ),
        mem_free: steady(
          reading(scrape1, "xcp_host_memory_free_bytes", HOST_PROD1),
          10,
        ),
      },
    );
    expect(result.breached).toBe(false);
  });

  test("High Host CPU stays quiet on the lab's busiest host (62%)", async () => {
    expect(
      (
        await evaluateOnLab("xcp-ng-host-high-cpu", {
          host_cpu: steady(
            reading(scrape1, "xcp_host_cpu_average", HOST_PROD1),
            10,
          ),
        })
      ).breached,
    ).toBe(false);
  });

  test("Host Restarted: quiet on a host up for days, fires on one up for 5 minutes, never on a halted one", async () => {
    expect(
      (
        await evaluateOnLab("xcp-ng-host-restarted", {
          host_uptime: steady(
            reading(scrape1, "xcp_host_uptime_seconds", HOST_PROD1),
            5,
          ),
          host_is_running: steady(1, 5),
        })
      ).breached,
    ).toBe(false);
    expect(
      (
        await evaluateOnLab("xcp-ng-host-restarted", {
          host_uptime: steady(300, 5),
          host_is_running: steady(1, 5),
        })
      ).breached,
    ).toBe(true);
    expect(
      (
        await evaluateOnLab("xcp-ng-host-restarted", {
          host_uptime: steady(0, 5),
          host_is_running: steady(0, 5),
        })
      ).breached,
    ).toBe(false);
  });
});
