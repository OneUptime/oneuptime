import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The queue pages' wiring, pinned at the source level (App's jest runs in
 * node, without a renderer; what the pages render is covered by the
 * MessageQueue* suites in Common/Tests/App/Dashboard).
 *
 *   - the Overview keeps the house data-loading shape (issue #4105 and its
 *     follow-up): its telemetry effect is keyed on what scopes the queue —
 *     never on the row object a refresh replaces — has a staleness guard,
 *     and an auto-refresh tick never supersedes a load still running;
 *   - one zoom for the whole page: TimeRangeZoomScope around every section;
 *   - telemetry is scoped by the key built from the row's queueIdentifier
 *     (the identity FAMILY), while the broker catalog is picked by the row's
 *     SPECIFIC messagingSystem;
 *   - the Traces and Metrics tabs mount their viewer only with a key, scoped
 *     by it and named by it;
 *   - the queue's telemetry is never filtered by an attribute, its counters
 *     are turned into rates in a .ts module (RateChartReloadWiring sweeps
 *     .tsx components for computeCounterRate), and the Create monitor link
 *     is built only through the alert templates' query and view builders.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

const BLOCK_COMMENT: RegExp = /\/\*[\s\S]*?\*\//g;
const LINE_COMMENT: RegExp = /(^|[^:])\/\/[^\n]*/g;
const WHITESPACE: RegExp = /\s+/g;

function readSource(relative: string): string {
  return fs.readFileSync(
    path.join(DASHBOARD_SRC, ...relative.split("/")),
    "utf8",
  );
}

function readSquashed(relative: string): string {
  return readSource(relative)
    .replace(BLOCK_COMMENT, " ")
    .replace(LINE_COMMENT, "$1")
    .replace(WHITESPACE, " ");
}

// The slice of `source` from `from` up to (not including) the next `to`.
function between(source: string, from: string, to: string): string {
  const start: number = source.indexOf(from);

  if (start < 0) {
    throw new Error(`Expected the source to contain "${from}".`);
  }

  const end: number = source.indexOf(to, start + from.length);

  if (end < 0) {
    throw new Error(`Expected "${to}" after "${from}".`);
  }

  return source.slice(start, end);
}

function countOf(source: string, needle: string): number {
  return source.split(needle).length - 1;
}

const OVERVIEW: string = readSquashed("Pages/MessageQueue/View/Overview.tsx");
const TRACES: string = readSquashed("Pages/MessageQueue/View/Traces.tsx");
const METRICS: string = readSquashed("Pages/MessageQueue/View/Metrics.tsx");
const QUERIES: string = readSquashed(
  "Components/MessageQueue/MessageQueueTelemetryQueries.ts",
);
const LINK: string = readSquashed(
  "Components/MessageQueue/MessageQueueMetricMonitorLink.ts",
);
const SECTION: string = readSquashed(
  "Components/MessageQueue/MessageQueueBrokerHealthSection.tsx",
);
const SCOPE: string = readSquashed(
  "Components/MessageQueue/MessageQueueTelemetryScope.ts",
);

describe("the queue Overview's data loading", () => {
  test("the telemetry effect is keyed on the scope, the range and the refresh count", () => {
    expect(OVERVIEW).toContain(
      "}, [telemetryScope, timeRange, telemetryRefreshCount]);",
    );
    // The scope: what the key and the catalog are worked out from, no more.
    const scope: string = between(
      OVERVIEW,
      "const telemetryScope: string = messageQueue ? JSON.stringify({",
      '}) : "";',
    );
    expect(scope).toContain("queueIdentifier: messageQueue.queueIdentifier");
    expect(scope).toContain("messagingSystem: messageQueue.messagingSystem");
    expect(scope).not.toContain("lastSeenAt");
    expect(scope).not.toContain("brokerMetricsLastSeenAt");
  });

  test("a load that lands late is dropped: the staleness guard", () => {
    const effect: string = between(
      OVERVIEW,
      "let ignore: boolean = false;",
      "}, [telemetryScope, timeRange, telemetryRefreshCount]);",
    );
    expect(effect).toContain("telemetryInFlightRef.current = true;");
    // The answer, the name lookup after it, and the failure all check it.
    expect(countOf(effect, "if (ignore) { return; }")).toBe(3);
    expect(effect).toContain("return () => { ignore = true; };");
  });

  test("an auto-refresh tick never supersedes a load still running; Refresh does", () => {
    const refresh: string = between(
      OVERVIEW,
      "const refresh: (options: { isAutoRefresh: boolean }) => void",
      "const { autoRefreshInterval, setAutoRefreshInterval } = useAutoRefresh(",
    );
    expect(refresh).toContain("fetchModel(false).catch(() => {});");
    expect(refresh).toContain(
      "if (options.isAutoRefresh && telemetryInFlightRef.current) { return; }",
    );
    expect(refresh).toContain(
      "setTelemetryRefreshCount((count: number): number => { return count + 1; });",
    );
    expect(OVERVIEW).toContain(
      'storageKey: "message-queue-overview-auto-refresh-interval"',
    );
    expect(OVERVIEW).toContain(
      "onManualRefresh={(): void => { refresh({ isAutoRefresh: false }); }}",
    );
  });

  test("one zoom for the whole page, the picker in the hero", () => {
    expect(OVERVIEW).toContain(
      "<TimeRangeZoomScope timeRange={timeRange} onTimeRangeChange={setTimeRange}>",
    );
    const scoped: string = between(
      OVERVIEW,
      "<TimeRangeZoomScope ",
      "</TimeRangeZoomScope>",
    );
    for (const section of [
      "<ResourceOverview ",
      "<MessageQueueServicesCard ",
      "<MessageQueueBrokerHealthSection ",
      "<TelemetryTimeRangePicker ",
    ]) {
      expect(scoped).toContain(section);
    }
  });

  test("the key comes from the identifier, the catalog from the specific system", () => {
    const effect: string = between(
      OVERVIEW,
      "const item: MessageQueue | null = messageQueue;",
      "}, [telemetryScope, timeRange, telemetryRefreshCount]);",
    );
    expect(effect).toContain(
      "getMessageQueueScopeKeys({ projectId: projectId, queueIdentifier: item.queueIdentifier, })",
    );
    expect(effect).toContain(
      "getMessageQueueMetricsForSystem(item.messagingSystem)",
    );
    // No key: nothing is fetched.
    expect(
      between(effect, "if (!isMessageQueueScoped(keys)) {", "return; }"),
    ).not.toContain("fetch");
    // The index page reads its own id; the tabs one segment up.
    expect(OVERVIEW).toContain(
      "const modelId: ObjectID = Navigation.getLastParamAsObjectID();",
    );
  });

  test("the spans are split by kind: PRODUCER publishes, CONSUMER consumes", () => {
    expect(OVERVIEW).toContain("kind: MESSAGE_QUEUE_PUBLISH_SPAN_KIND,");
    expect(OVERVIEW).toContain("kind: MESSAGE_QUEUE_CONSUME_SPAN_KIND,");
    expect(QUERIES).toContain(
      "export const MESSAGE_QUEUE_PUBLISH_SPAN_KIND: SpanKind = SpanKind.Producer;",
    );
    expect(QUERIES).toContain(
      "export const MESSAGE_QUEUE_CONSUME_SPAN_KIND: SpanKind = SpanKind.Consumer;",
    );
  });
});

describe("the queue's Traces and Metrics tabs", () => {
  test.each([
    [
      "Traces",
      TRACES,
      "TracesViewer",
      "../../../Components/Traces/TracesViewer",
    ],
    [
      "Metrics",
      METRICS,
      "MetricsViewer",
      "../../../Components/Metrics/MetricsViewer",
    ],
  ])(
    "%s: the shared viewer, scoped by the queue's key and only with one",
    (_name: string, source: string, viewer: string, modulePath: string) => {
      expect(source).toContain(`import ${viewer} from "${modulePath}";`);
      expect(source).toContain(
        "const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);",
      );
      expect(source).toContain("useMessageQueueTelemetryScope(modelId)");
      expect(source).toContain(
        `<${viewer} entityKeysFilter={keys} entityKeyDisplays={entityKeyDisplays}`,
      );
      // The unscoped guard comes before the viewer, which renders once.
      expect(source.indexOf("if (!isMessageQueueScoped(keys)) {")).toBeLessThan(
        source.indexOf(`<${viewer} `),
      );
      expect(countOf(source, `<${viewer} `)).toBe(1);
      expect(source).not.toContain("attributeFilters");
    },
  );

  test("Metrics: a row click charts the metric in place, never in the unscoped explorer", () => {
    const viewer: string = between(METRICS, "<MetricsViewer ", "/>");
    expect(viewer).toContain("onMetricClick={(metric: MetricType): void => {");
    expect(viewer).toContain("fetchRowValueOverrides={fetchRowValueOverrides}");
    expect(viewer).toContain(
      "defaultRowValueCaption={MESSAGE_QUEUE_METRIC_LIST_DEFAULT_CAPTION}",
    );
    expect(viewer).not.toContain("disableMetricDrillDown");
    const modal: string = between(
      METRICS,
      "<MessageQueueMetricChartModal ",
      "/>",
    );
    for (const prop of [
      "keys={keys}",
      "messagingSystem={messagingSystem}",
      "identity={identity}",
      "initialTimeRange={listRange}",
    ]) {
      expect(modal).toContain(prop);
    }
    // The modal is the viewer's sibling in the page's Fragment, not a wrapper.
    expect(METRICS.indexOf("<MessageQueueMetricChartModal ")).toBeGreaterThan(
      METRICS.indexOf("<MetricsViewer "),
    );
  });
});

describe("the queue's telemetry queries", () => {
  test("no query builder ever filters by an attribute: the key is the queue", () => {
    for (const builder of [
      "export function buildMessageQueueSpanQuery(",
      "export function buildMessageQueueMetricQuery(",
    ]) {
      const body: string = between(QUERIES, builder, "function aggregateBy<");
      expect(body).not.toContain('["attributes"]');
      expect(body).not.toContain("attributes:");
    }
    expect(QUERIES).toContain(
      "const entityKeys: Includes | null = getMessageQueueEntityKeysQueryValue(",
    );
  });

  test("an empty key set is never an empty Includes", () => {
    expect(SCOPE).toContain(
      "if (!isMessageQueueScoped(keys)) { return null; } return new Includes([...(keys as ReadonlyArray<string>)]);",
    );
  });

  test("each catalog metric is read as its read plan says, through the shared series math", () => {
    const fetch: string = between(
      QUERIES,
      "export async function fetchMessageQueueCatalogMetricSeries(",
      "function observedSeriesOf(",
    );
    expect(fetch).toContain(
      "const plan: MessageQueueMetricReadPlan = getMessageQueueMetricReadPlan(descriptor);",
    );
    expect(fetch).toContain("return counterResultToRatePerSecond(result);");
    // A level carries a missing series forward; a per-period count never.
    expect(fetch).toContain(
      "? combineMessageQueueCountSeries(result, descriptor.seriesCombine) : combineGaugeSeries(result, descriptor.seriesCombine);",
    );
    // Only a count keeps whole intervals only, through the shared rule.
    expect(fetch).toContain(
      "return plan.isPerPeriodCount ? getCompleteMessageQueueCountSeries(",
    );
    expect(QUERIES).toContain(
      "return getCompleteBucketSeries( series, window, now - getMessageQueueCountSettleMs(descriptor, window), );",
    );
    // A per-series read that the row limit cut off is read again, wider.
    expect(QUERIES).toContain("widen: true,");
    expect(QUERIES).toContain("widen: !plan.isPerPeriodCount,");
    expect(QUERIES).toContain(
      "return result.truncated ? withoutOldestInterval(result) : result;",
    );
    const componentsDir: string = path.join(
      DASHBOARD_SRC,
      "Components",
      "MessageQueue",
    );
    for (const file of fs.readdirSync(componentsDir)) {
      if (file.endsWith(".tsx")) {
        expect([
          file,
          fs
            .readFileSync(path.join(componentsDir, file), "utf8")
            .includes("computeCounterRate("),
        ]).toEqual([file, false]);
      }
    }
  });
});

describe("Create monitor", () => {
  test("is built by the alert templates' query and view builders, never by hand", () => {
    expect(LINK).toContain("buildMessageQueueMetricMonitorQuery({");
    expect(LINK).toContain("buildMessageQueueMetricMonitorViewConfig({");
    expect(LINK).toContain("getMessageQueueAlertTemplateForMetric(descriptor)");
    expect(LINK).toContain("getMessageQueueMetricMonitorRollingTime(");
    expect(LINK).toContain("getMessageQueueMetricMonitorSeed(descriptor)");
    expect(LINK).toContain(
      "MetricExplorerUrl.buildQueryParamsFromMetricViewData(viewData)",
    );
    expect(LINK).toContain("RouteMap[PageMap.MONITOR_CREATE] as Route");
  });

  test("the section offers it on gauges only", () => {
    expect(SECTION).toContain(
      'if (result.descriptor.kind !== "gauge" || result.series.length === 0) { continue; }',
    );
    expect(SECTION).toContain('{result.descriptor.kind === "gauge" ? (');
  });

  test("the section picks its metrics by the specific system and links its docs by anchor", () => {
    expect(OVERVIEW).toContain("messagingSystem={q.messagingSystem}");
    expect(OVERVIEW).toContain("identity={identity}");
    // The queue's identity decides whether its broker metrics can reach it.
    expect(SECTION).toContain(
      "getMessageQueueBrokerMetricsGuidance( props.messagingSystem, props.identity, )",
    );
    expect(SECTION).toContain("{guidance.reachesQueue ? ( <AppLink");
  });

  test("the hint beside Create monitor is built from the criteria Monitor Create builds", () => {
    expect(LINK).toContain(
      "export const MONITOR_CREATE_LINK_FILTER_TYPE: FilterType = FilterType.GreaterThan;",
    );
    expect(LINK).toContain(
      "export const MONITOR_CREATE_LINK_EVALUATION: EvaluateOverTimeType = EvaluateOverTimeType.AnyValue;",
    );
    const hint: string = between(
      readSource("Components/MessageQueue/MessageQueueMetricMonitorLink.ts"),
      "export function getMessageQueueMetricMonitorHint(",
      "\n}\n",
    );
    expect(hint).toContain("link.criteria");
    expect(hint).not.toContain("thresholdLabel");
  });
});
