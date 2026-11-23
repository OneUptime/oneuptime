import { describe, expect, test } from "@jest/globals";
import {
  EvaluateOverTimeType,
  FilterType,
  NoDataPolicy,
} from "../../../Types/Monitor/CriteriaFilter";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorStepMetricMonitor, {
  MetricMonitorQueryLanguage,
} from "../../../Types/Monitor/MonitorStepMetricMonitor";
import MonitorSteps from "../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../Types/Monitor/MonitorType";
import TelemetryAlertRuleUtil, {
  TelemetryAlertRule,
  TelemetryAlertRuleAction,
  TelemetryAlertRuleReadResult,
} from "../../../Types/Monitor/TelemetryAlertRule";
import ObjectID from "../../../Types/ObjectID";
import {
  AlertImportItem,
  AlertImportPlan,
  ImportItemStatus,
  ImportNote,
  ImportNoteKind,
  ImportQueryLanguage,
  ImportSourceKind,
  ImportedAlertRule,
  ImportedAlertSeverity,
} from "../../../Types/ObservabilityImport/ObservabilityImport";
import RollingTime from "../../../Types/RollingTime/RollingTime";
import {
  ALERT_TEXT_TEMPLATE_LEFT_OUT,
  RULE_FIRES_FOR_EVERY_SERIES,
  WINDOW_NEAREST,
  convertAlertTemplate,
  readImportSeverity,
  readImportWindow,
  uniqueImportName,
} from "../../../Utils/ObservabilityImport/AlertImportCommon";
import {
  AlertImportAction,
  AlertImportSeeds,
  buildImportedMonitorSteps,
} from "../../../Utils/ObservabilityImport/AlertImportMonitorBuilder";
import {
  MONITOR_NOTIFICATIONS_LEFT_OUT,
  MONITOR_WARNING_LEFT_OUT,
  convertDatadogMessage,
  getDatadogMonitorTargetKey,
} from "../../../Utils/ObservabilityImport/Datadog/DatadogMonitors";
import { DATADOG_FUNCTION_NOT_CONVERTED } from "../../../Utils/ObservabilityImport/Datadog/DatadogPromQL";
import {
  GRAFANA_RULE_PAUSED,
  GRAFANA_RULE_RANGE_THRESHOLD,
  GRAFANA_RULE_READS_LOGS,
} from "../../../Utils/ObservabilityImport/Grafana/GrafanaAlertRules";
import {
  ALERT_SOURCE_KINDS,
  readImportSource,
} from "../../../Utils/ObservabilityImport/ImportSource";
import {
  ImportPlanOptions,
  planAlertImport,
} from "../../../Utils/ObservabilityImport/ObservabilityImport";
import {
  RULE_GROUP_INTERVAL,
  RULE_IS_RECORDING,
  RULE_KEEP_FIRING,
  RULE_LABELS_NOT_KEPT,
  RULE_READS_LOGS,
  getPrometheusRuleTargetKey,
} from "../../../Utils/ObservabilityImport/Prometheus/PrometheusRules";
import {
  QUERY_CONVERTED_BY_AI,
  QUERY_DOES_NOT_PARSE,
  findPromQLImportProblem,
} from "../../../Utils/ObservabilityImport/PromQLImportQuery";
import { readFixture } from "./ImportFixtures";

/*
 * Alert rules from Prometheus, Grafana and Datadog as OneUptime's Metrics
 * monitors (issue #7697): one PromQL step judged series by series, its
 * condition, window, severity and alert text read from the rule, and what
 * differs said.
 */

const plan: (name: string, options?: ImportPlanOptions) => AlertImportPlan = (
  name: string,
  options?: ImportPlanOptions,
): AlertImportPlan => {
  return planAlertImport(
    readImportSource({ text: readFixture(name), accepts: ALERT_SOURCE_KINDS }),
    options,
  );
};

const named: (from: AlertImportPlan, name: string) => AlertImportItem = (
  from: AlertImportPlan,
  name: string,
): AlertImportItem => {
  const item: AlertImportItem | undefined = from.items.find(
    (candidate: AlertImportItem): boolean => {
      return candidate.name === name;
    },
  );

  if (!item) {
    throw new Error(`no rule named ${name}`);
  }

  return item;
};

const texts: (notes: ReadonlyArray<ImportNote>) => Array<string> = (
  notes: ReadonlyArray<ImportNote>,
): Array<string> => {
  return notes.map((note: ImportNote): string => {
    return note.text;
  });
};

describe("a Prometheus rule file", () => {
  const rules: AlertImportPlan = plan("prometheus-rules.yaml");

  test("a rule ending in a comparison is the query and the condition, waiting its `for`", () => {
    const down: AlertImportItem = named(rules, "InstanceDown");

    expect(rules.source).toBe(ImportSourceKind.PrometheusRules);
    expect(down.status).toBe(ImportItemStatus.Exact);
    expect(down.group).toBe("availability");
    expect(down.rule).toEqual({
      promQL: "up",
      filterType: FilterType.EqualTo,
      threshold: 0,
      rollingTime: RollingTime.Past5Minutes,
      aggregation: EvaluateOverTimeType.AllValues,
      onNoData: NoDataPolicy.Ignore,
      severity: ImportedAlertSeverity.Critical,
      title: "{{instance}} of {{job}} is down",
      description:
        "{{instance}} has been down for more than 5 minutes.\n\nRunbook: https://runbooks.example.com/instance-down",
      monitorDescription: "{{instance}} has been down for more than 5 minutes.",
    });
    expect(down.notes).toEqual([
      {
        kind: ImportNoteKind.Info,
        text: RULE_GROUP_INTERVAL,
        values: { interval: "30s" },
      },
      {
        kind: ImportNoteKind.Info,
        text: RULE_LABELS_NOT_KEPT,
        values: { labels: "team" },
      },
      { kind: ImportNoteKind.Info, text: ALERT_TEXT_TEMPLATE_LEFT_OUT },
    ]);
  });

  test("a rule with no comparison fires for each series it returns; a `for` OneUptime has no window of waits the nearest longer one", () => {
    const missing: AlertImportItem = named(rules, "TargetMissing");

    expect(missing.status).toBe(ImportItemStatus.Approximate);
    expect(missing.rule?.promQL).toBe('(absent(up{job="checkout"})) * 0 + 1');
    expect(missing.rule?.filterType).toBe(FilterType.GreaterThan);
    expect(missing.rule?.threshold).toBe(0);
    expect(missing.rule?.rollingTime).toBe(RollingTime.Past5Minutes);
    expect(missing.rule?.severity).toBe(ImportedAlertSeverity.Critical);
    expect(missing.notes).toEqual(
      expect.arrayContaining([
        { kind: ImportNoteKind.Info, text: RULE_FIRES_FOR_EVERY_SERIES },
        {
          kind: ImportNoteKind.Approximation,
          text: WINDOW_NEAREST,
          values: { source: "3m", window: RollingTime.Past5Minutes },
        },
      ]),
    );
  });

  test("keep_firing_for is said; the value in its summary goes, and the words around it", () => {
    const latency: AlertImportItem = named(rules, "HighLatency");

    expect(latency.status).toBe(ImportItemStatus.Approximate);
    expect(latency.rule?.promQL).toBe(
      "histogram_quantile(0.99, sum by (le, job) (rate(http_request_duration_seconds_bucket[5m])))",
    );
    expect(latency.rule?.threshold).toBe(0.5);
    expect(latency.rule?.rollingTime).toBe(RollingTime.Past1Minute);
    expect(latency.rule?.severity).toBe(ImportedAlertSeverity.Warning);
    expect(latency.rule?.title).toBe("p99 latency of {{job}}");
    expect(latency.notes).toContainEqual({
      kind: ImportNoteKind.Approximation,
      text: RULE_KEEP_FIRING,
      values: { duration: "10m" },
    });
  });

  test("recording rules, LogQL and a query that does not parse are not converted, each with why", () => {
    expect(texts(named(rules, "job:http_requests:rate5m").notes)).toEqual([
      RULE_IS_RECORDING,
    ]);
    expect(texts(named(rules, "ErrorLogs").notes)).toEqual([RULE_READS_LOGS]);
    expect(named(rules, "ErrorLogs").aiCandidate).toBeUndefined();

    const broken: AlertImportItem = named(rules, "Broken");

    expect(broken.status).toBe(ImportItemStatus.NotConverted);
    expect(texts(broken.notes)).toEqual([QUERY_DOES_NOT_PARSE]);
    expect(broken.aiCandidate).toEqual({
      language: ImportQueryLanguage.PromQL,
      query: "rate(http_requests_total[5m] > 1",
      variableNames: [],
      targetKey: getPrometheusRuleTargetKey(broken.key),
      isForMonitor: true,
    });
  });

  test("OneUptime AI's answer, once used, converts the rule, and says so", () => {
    const broken: AlertImportItem = named(rules, "Broken");
    const answered: AlertImportPlan = plan("prometheus-rules.yaml", {
      queryOverrides: new Map<string, string>([
        [
          getPrometheusRuleTargetKey(broken.key),
          "rate(http_requests_total[5m]) > 1",
        ],
      ]),
    });
    const converted: AlertImportItem = named(answered, "Broken");

    expect(converted.status).toBe(ImportItemStatus.Approximate);
    expect(texts(converted.notes)).toContain(QUERY_CONVERTED_BY_AI);
    expect(converted.rule?.promQL).toBe("rate(http_requests_total[5m])");
    expect(converted.rule?.filterType).toBe(FilterType.GreaterThan);
    expect(converted.rule?.threshold).toBe(1);
  });
});

describe("kube-prometheus's node-exporter PrometheusRule", () => {
  const rules: AlertImportPlan = plan("prometheus-rule-node-exporter.yaml");

  test("every alerting rule converts, and parses as OneUptime runs it", () => {
    const alerting: Array<AlertImportItem> = rules.items.filter(
      (item: AlertImportItem): boolean => {
        return item.sourceType === "alerting rule";
      },
    );

    expect(alerting.length).toBeGreaterThanOrEqual(25);

    for (const item of alerting) {
      expect(item.status).not.toBe(ImportItemStatus.NotConverted);
      expect(
        findPromQLImportProblem({ promQL: item.rule?.promQL || "" }),
      ).toBeNull();
    }
  });

  test("its recording rules are listed, not converted", () => {
    const recording: Array<AlertImportItem> = rules.items.filter(
      (item: AlertImportItem): boolean => {
        return item.sourceType === "recording rule";
      },
    );

    expect(recording.length).toBeGreaterThan(10);

    for (const item of recording) {
      expect(item.status).toBe(ImportItemStatus.NotConverted);
    }
  });

  test("a rule kept once per severity is named by it, each its own severity", () => {
    expect(
      named(rules, "NodeFilesystemAlmostOutOfSpace (warning)").rule?.severity,
    ).toBe(ImportedAlertSeverity.Warning);
    expect(
      named(rules, "NodeFilesystemAlmostOutOfSpace (critical)").rule?.severity,
    ).toBe(ImportedAlertSeverity.Critical);
    expect(
      named(rules, "NodeFilesystemAlmostOutOfSpace (critical)").rule
        ?.rollingTime,
    ).toBe(RollingTime.Past30Minutes);
  });
});

describe("Grafana's alert rules", () => {
  const rules: AlertImportPlan = plan("grafana-alert-rules-export.yaml");

  test("a threshold on the last value is the condition, with Grafana's rate interval filled as Grafana fills it", () => {
    const errors: AlertImportItem = named(rules, "High error ratio");

    expect(rules.source).toBe(ImportSourceKind.GrafanaAlertRules);
    expect(errors.status).toBe(ImportItemStatus.Exact);
    expect(errors.group).toBe("Services / checkout");
    expect(errors.rule).toEqual({
      promQL:
        'sum by (job) (rate(http_requests_total{code=~"5.."}[60s])) / sum by (job) (rate(http_requests_total[60s]))',
      filterType: FilterType.GreaterThan,
      threshold: 0.05,
      rollingTime: RollingTime.Past5Minutes,
      aggregation: EvaluateOverTimeType.AllValues,
      onNoData: NoDataPolicy.Ignore,
      severity: ImportedAlertSeverity.Critical,
      title: "Error ratio of {{job}}",
      description:
        "More than 5% of the requests of {{job}} fail.\n\nRunbook: https://runbooks.example.com/high-error-ratio",
      monitorDescription: "More than 5% of the requests of {{job}} fail.",
    });
  });

  test("a math condition on a mean is read over its range; no data alerts; a paused rule starts unticked", () => {
    const memory: AlertImportItem = named(rules, "Memory usage high");

    expect(memory.status).toBe(ImportItemStatus.Exact);
    expect(memory.isEnabledInSource).toBe(false);
    expect(texts(memory.notes)).toEqual([GRAFANA_RULE_PAUSED]);
    expect(memory.rule?.promQL).toBe(
      "100 * (1 - node_memory_MemAvailable_bytes / node_memory_MemTotal_bytes)",
    );
    expect(memory.rule?.filterType).toBe(FilterType.GreaterThan);
    expect(memory.rule?.threshold).toBe(90);
    expect(memory.rule?.rollingTime).toBe(RollingTime.Past15Minutes);
    expect(memory.rule?.aggregation).toBe(EvaluateOverTimeType.Average);
    expect(memory.rule?.onNoData).toBe(NoDataPolicy.Trigger);
    expect(memory.rule?.severity).toBe(ImportedAlertSeverity.Warning);
  });

  test("a range threshold and a rule over Loki are listed with why", () => {
    expect(named(rules, "Disk usage outside its range").notes).toEqual([
      {
        kind: ImportNoteKind.Reason,
        text: GRAFANA_RULE_RANGE_THRESHOLD,
        values: { type: "outside_range" },
      },
    ]);
    expect(texts(named(rules, "Error logs").notes)).toEqual([
      GRAFANA_RULE_READS_LOGS,
    ]);
  });
});

describe("Datadog's metric monitors", () => {
  test("a monitor's window and its time aggregation are the monitor's; its warning threshold is said", () => {
    const monitors: AlertImportPlan = plan(
      "datadog-monitor-redis-high-memory.json",
    );
    const memory: AlertImportItem = named(
      monitors,
      "[Redis] High memory consumption",
    );

    expect(monitors.source).toBe(ImportSourceKind.DatadogMonitors);
    expect(memory.status).toBe(ImportItemStatus.Approximate);
    expect(memory.rule?.promQL).toBe(
      "((100) * (avg (avg_over_time(redis_mem_used[1m])))) / (avg (avg_over_time(redis_mem_maxmemory[1m])))",
    );
    expect(memory.rule?.rollingTime).toBe(RollingTime.Past5Minutes);
    expect(memory.rule?.aggregation).toBe(EvaluateOverTimeType.Average);
    expect(memory.rule?.threshold).toBe(90);
    expect(memory.notes).toContainEqual({
      kind: ImportNoteKind.Approximation,
      text: MONITOR_WARNING_LEFT_OUT,
      values: { warning: "70" },
    });
    // The alert's own text, not the warning's.
    expect(memory.rule?.description).toContain("exceeded 90%");
    expect(memory.rule?.description).not.toContain("exceeded 70%");
    expect(memory.rule?.description).not.toContain("](/metric");
  });

  test("a group's tag in the name is the series' label in the alert's title", () => {
    const monitors: AlertImportPlan = plan(
      "datadog-monitor-postgres-connections.json",
    );

    // The Agent's host is the resource's: its series' label is resource_host_name.
    expect(monitors.items[0]?.rule?.title).toBe(
      "[Postgres] Number of connections is approaching connection limit on {{resource_host_name}}",
    );
    expect(monitors.items[0]?.rule?.rollingTime).toBe(
      RollingTime.Past15Minutes,
    );
  });

  test("an outliers monitor is listed with why, and not offered to OneUptime AI", () => {
    const monitors: AlertImportPlan = planAlertImport(
      readImportSource({
        text: JSON.stringify({
          name: "A host out of line",
          type: "query alert",
          query:
            "avg(last_15m):outliers(avg:system.cpu.user{*} by {host}, 'DBSCAN', 2) > 0",
          options: {},
        }),
        accepts: ALERT_SOURCE_KINDS,
      }),
    );
    const item: AlertImportItem | undefined = monitors.items[0];

    expect(item?.status).toBe(ImportItemStatus.NotConverted);
    expect(item?.notes).toEqual([
      {
        kind: ImportNoteKind.Reason,
        text: DATADOG_FUNCTION_NOT_CONVERTED,
        values: { function: "outliers" },
      },
    ]);
    expect(item?.aiCandidate).toBeUndefined();
  });

  test("a monitor whose query PromQL cannot say is offered to OneUptime AI, for a monitor", () => {
    const monitors: AlertImportPlan = planAlertImport(
      readImportSource({
        text: JSON.stringify({
          name: "Cumulative errors",
          type: "metric alert",
          query: "sum(last_1h):cumsum(sum:app.errors{*}.as_count()) > 100",
          options: {},
        }),
        accepts: ALERT_SOURCE_KINDS,
      }),
    );
    const item: AlertImportItem | undefined = monitors.items[0];

    expect(item?.status).toBe(ImportItemStatus.NotConverted);
    expect(item?.aiCandidate?.language).toBe(ImportQueryLanguage.Datadog);
    expect(item?.aiCandidate?.isForMonitor).toBe(true);
    expect(item?.aiCandidate?.targetKey).toBe(
      getDatadogMonitorTargetKey(item?.key || ""),
    );
  });
});

describe("an alert's text", () => {
  test("a series' label, in each way Go templates write one, is OneUptime's", () => {
    const notes: Array<ImportNote> = [];

    expect(
      convertAlertTemplate({
        text: '{{ $labels.instance }} / {{ .Labels.job }} / {{ index $labels "k8s.pod" }}',
        notes,
      }),
    ).toBe("{{instance}} / {{job}} / {{k8s_pod}}");
    expect(notes).toEqual([]);
  });

  test("the value goes with its unit and the words that led up to it, and it is said", () => {
    const notes: Array<ImportNote> = [];

    expect(
      convertAlertTemplate({
        text: "Disk of {{ $labels.instance }} is {{ $value | humanizePercentage }}",
        notes,
      }),
    ).toBe("Disk of {{instance}}");
    expect(
      convertAlertTemplate({
        text: "Down for 5 minutes (value {{ $value }}).",
        notes,
      }),
    ).toBe("Down for 5 minutes.");
    expect(
      convertAlertTemplate({
        text: 'Latency is {{ printf "%.2f" $value }}s.',
        notes,
      }),
    ).toBe("Latency.");
    expect(texts(notes)).toEqual([
      ALERT_TEXT_TEMPLATE_LEFT_OUT,
      ALERT_TEXT_TEMPLATE_LEFT_OUT,
      ALERT_TEXT_TEMPLATE_LEFT_OUT,
    ]);
  });

  test("words in parentheses that held no value stay", () => {
    expect(
      convertAlertTemplate({ text: "Disk almost full (critical)", notes: [] }),
    ).toBe("Disk almost full (critical)");
  });

  test("a Datadog message reads as it does for an open alert", () => {
    const notes: Array<ImportNote> = [];

    expect(
      convertDatadogMessage({
        text: "{{#is_alert}}CPU on {{host.name}} is above {{threshold}}: {{value}}.{{/is_alert}}{{#is_warning}}CPU is high.{{/is_warning}}{{#is_recovery}}Recovered.{{/is_recovery}}{{^is_warning}} Check the host.{{/is_warning}} @slack-ops @oncall@example.com",
        notes,
        threshold: 90,
        comparison: ">",
      }),
    ).toBe("CPU on {{resource_host_name}} is above 90. Check the host.");
    expect(notes).toEqual([
      {
        kind: ImportNoteKind.Info,
        text: MONITOR_NOTIFICATIONS_LEFT_OUT,
        values: { handles: "@slack-ops, @oncall@example.com" },
      },
      { kind: ImportNoteKind.Info, text: ALERT_TEXT_TEMPLATE_LEFT_OUT },
    ]);
  });
});

describe("what each imported rule needs", () => {
  test("a window: the one of that length, else the nearest longer, said; a minute or less is a minute", () => {
    const notes: Array<ImportNote> = [];

    expect(readImportWindow({ ms: 0, sourceText: "0s", notes })).toBe(
      RollingTime.Past1Minute,
    );
    expect(
      readImportWindow({ ms: 15 * 60 * 1000, sourceText: "15m", notes }),
    ).toBe(RollingTime.Past15Minutes);
    expect(notes).toEqual([]);
    expect(
      readImportWindow({ ms: 7 * 60 * 1000, sourceText: "7m", notes }),
    ).toBe(RollingTime.Past10Minutes);
    expect(notes).toHaveLength(1);
    expect(
      readImportWindow({
        ms: 400 * 24 * 3600 * 1000,
        sourceText: "400d",
        notes,
      }),
    ).toBeDefined();
  });

  test("a severity: critical words are critical, others a warning, none critical", () => {
    for (const word of ["critical", "PAGE", "P1", "sev1", "high", undefined]) {
      expect(readImportSeverity(word)).toBe(ImportedAlertSeverity.Critical);
    }

    for (const word of ["warning", "info", "low", "P3"]) {
      expect(readImportSeverity(word)).toBe(ImportedAlertSeverity.Warning);
    }
  });

  test("a name not yet taken, in any case", () => {
    const taken: Set<string> = new Set<string>(["CPU high", "cpu high 2"]);

    expect(uniqueImportName({ name: "CPU High", taken, maxLength: 100 })).toBe(
      "CPU High 3",
    );
    expect(uniqueImportName({ name: "Memory", taken, maxLength: 100 })).toBe(
      "Memory",
    );
    expect(
      uniqueImportName({
        name: "x".repeat(20),
        taken: new Set(["x".repeat(10)]),
        maxLength: 10,
      }),
    ).toBe(`${"x".repeat(8)} 2`);
  });
});

describe("the monitor an imported rule becomes", () => {
  const seeds: AlertImportSeeds = {
    operationalStatusId: ObjectID.generate(),
    degradedStatusId: ObjectID.generate(),
    offlineStatusId: ObjectID.generate(),
    rankedIncidentSeverityIds: [ObjectID.generate(), ObjectID.generate()],
    rankedAlertSeverityIds: [ObjectID.generate(), ObjectID.generate()],
  };

  const rule: ImportedAlertRule = {
    promQL: 'sum by (job) (rate(http_requests_total{code=~"5.."}[5m]))',
    filterType: FilterType.GreaterThan,
    threshold: 0.05,
    rollingTime: RollingTime.Past5Minutes,
    aggregation: EvaluateOverTimeType.AllValues,
    onNoData: NoDataPolicy.Ignore,
    severity: ImportedAlertSeverity.Warning,
    title: "Error ratio of {{job}}",
    description: "More than 5% of the requests of {{job}} fail.",
    monitorDescription: "More than 5% fail.",
  };

  const readBack: (steps: MonitorSteps) => TelemetryAlertRuleReadResult = (
    steps: MonitorSteps,
  ): TelemetryAlertRuleReadResult => {
    return TelemetryAlertRuleUtil.read({
      monitorType: MonitorType.Metrics,
      monitorStep: steps.data?.monitorStepsInstanceArray[0] as MonitorStep,
      defaultMonitorStatusId: seeds.operationalStatusId,
    });
  };

  test("one PromQL step, valid as the monitor form requires, whose rule the form reads back as written", () => {
    const steps: MonitorSteps = buildImportedMonitorSteps({
      rule,
      monitorName: "Error ratio",
      seeds,
      action: AlertImportAction.Alert,
    });

    expect(
      MonitorSteps.getValidationError(steps, MonitorType.Metrics),
    ).toBeNull();
    expect(steps.data?.monitorStepsInstanceArray).toHaveLength(1);

    const metric: MonitorStepMetricMonitor | undefined =
      steps.data?.monitorStepsInstanceArray[0]?.data?.metricMonitor;

    expect(metric?.queryLanguage).toBe(MetricMonitorQueryLanguage.PromQL);
    expect(metric?.promQLQuery).toBe(rule.promQL);
    expect(metric?.rollingTime).toBe(RollingTime.Past5Minutes);

    const read: TelemetryAlertRuleReadResult = readBack(steps);

    expect(read.problem).toBeNull();

    const written: TelemetryAlertRule | null = read.rule;

    expect(written?.filterType).toBe(FilterType.GreaterThan);
    expect(written?.threshold).toBe(0.05);
    expect(written?.metricAggregationType).toBe(EvaluateOverTimeType.AllValues);
    expect(written?.onNoDataPolicy).toBe(NoDataPolicy.Ignore);
    expect(written?.action).toBe(TelemetryAlertRuleAction.Alert);
    expect(written?.monitorStatusId?.toString()).toBe(
      seeds.degradedStatusId?.toString(),
    );
    expect(written?.alert?.title).toBe("Error ratio of {{job}}");
    expect(written?.alert?.autoResolveAlert).toBe(true);
    // A warning takes the project's second severity.
    expect(written?.alert?.alertSeverityId?.toString()).toBe(
      seeds.rankedAlertSeverityIds[1]?.toString(),
    );
  });

  test("as an incident: the offline status, and the most severe severity for a critical rule", () => {
    const steps: MonitorSteps = buildImportedMonitorSteps({
      rule: { ...rule, severity: ImportedAlertSeverity.Critical },
      monitorName: "Error ratio",
      seeds,
      action: AlertImportAction.Incident,
    });
    const written: TelemetryAlertRule | null = readBack(steps).rule;

    expect(written?.action).toBe(TelemetryAlertRuleAction.Incident);
    expect(written?.monitorStatusId?.toString()).toBe(
      seeds.offlineStatusId.toString(),
    );
    expect(written?.incident?.incidentSeverityId?.toString()).toBe(
      seeds.rankedIncidentSeverityIds[0]?.toString(),
    );
    expect(written?.incident?.autoResolveIncident).toBe(true);
  });

  test("a project with no status between operational and offline alerts as offline", () => {
    const steps: MonitorSteps = buildImportedMonitorSteps({
      rule,
      monitorName: "Error ratio",
      seeds: { ...seeds, degradedStatusId: undefined },
      action: AlertImportAction.Alert,
    });

    expect(readBack(steps).rule?.monitorStatusId?.toString()).toBe(
      seeds.offlineStatusId.toString(),
    );
  });
});
