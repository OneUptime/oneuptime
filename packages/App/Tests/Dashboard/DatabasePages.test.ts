import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * What the Databases pages must do, pinned at the source level (the App
 * suite has no renderer and App/tsconfig.json excludes the dashboard; the
 * pure helpers the pages call have their own unit tests in
 * Common/Tests/App/Dashboard/Database*.test.ts). The invariants that matter
 * most:
 *
 *   - telemetry is scoped by the database's entity-key set ONLY, and a
 *     database with no keys never mounts a viewer or issues a query (an
 *     empty Includes drops the predicate — the whole project would show);
 *   - the create form asks for what the server needs to derive the identity
 *     (engine + address), never for the identity itself;
 *   - endpoints can be added and removed, except the primary one;
 *   - delete explains that discovered databases come back.
 *
 * Comments are stripped and whitespace squashed so rationale comments and
 * Prettier reflows cannot make a test pass or fail.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

function readSource(relativePath: string): string {
  return fs.readFileSync(
    path.join(DASHBOARD_SRC, ...relativePath.split("/")),
    "utf8",
  );
}

function squash(text: string): string {
  return text.replace(/\s+/g, " ");
}

function stripComments(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

function readCode(relativePath: string): string {
  return squash(stripComments(readSource(relativePath)));
}

function between(source: string, from: string, to: string): string {
  const start: number = source.indexOf(from);

  if (start < 0) {
    throw new Error(`Expected the source to contain "${from}".`);
  }

  const end: number = source.indexOf(to, start + from.length);

  return end >= 0 ? source.slice(start, end) : source.slice(start);
}

const SCOPE_UTIL: string = "Pages/Database/Utils/DatabaseTelemetryScope.ts";
const QUERY_UTIL: string =
  "Pages/Database/Utils/DatabaseServerTelemetryQueries.ts";
const SCOPE_HOOK: string =
  "Components/DatabaseServer/useDatabaseServerTelemetryScope.ts";
const BANNER_TAG: string = "<DatabaseServerUnscopedBanner";

describe("the telemetry scope helper", () => {
  const util: string = readCode(SCOPE_UTIL);

  test("wraps the one isomorphic key-set definition instead of re-deriving it", () => {
    expect(util).toContain(
      'from "Common/Utils/Telemetry/DatabaseServerEntityKeys"',
    );
    expect(util).toContain("getDatabaseServerSignalEntityKeys({");
    expect(util).toContain("export function getDatabaseServerScopeKeys(");
    expect(util).toContain("export function isDatabaseServerScoped(");
  });

  test("an empty key set yields no query value, never an empty Includes", () => {
    const fn: string = between(
      util,
      "export function getDatabaseServerEntityKeysQueryValue(",
      "export function",
    );

    expect(fn).toContain("if (!isDatabaseServerScoped(keys)) { return null; }");
    expect(fn).toContain("return new Includes([...");
  });

  test("stays React-free", () => {
    for (const file of [
      SCOPE_UTIL,
      QUERY_UTIL,
      "Pages/Database/Utils/DatabaseServerPresentation.ts",
      "Pages/Database/Utils/DatabaseServerSummary.ts",
      "Pages/Database/Utils/DocumentationMarkdown.ts",
    ]) {
      const code: string = readCode(file);
      expect(code).not.toContain('from "react"');
      expect(code).not.toContain("ReactElement");
    }
  });
});

describe("the Overview's own queries", () => {
  const util: string = readCode(QUERY_UTIL);

  test("aggregate through AnalyticsModelAPI with an entityKeys Includes", () => {
    expect(util).toContain(
      'from "Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI"',
    );
    expect(util).toContain("AnalyticsModelAPI.aggregate<Span>(");
    expect(util).toContain("AnalyticsModelAPI.aggregate<Metric>(");
    expect(util).toContain("entityKeys: entityKeys,");
    expect(util).toContain("getDatabaseServerEntityKeysQueryValue(");
  });

  test("scope by keys only — the one attribute predicate is a catalog pin", () => {
    const spans: string = between(
      util,
      "export function buildDatabaseSpanQuery(",
      "export function",
    );
    expect(spans).not.toContain("primaryEntityId");
    expect(spans).not.toContain("attributes");

    const metrics: string = between(
      util,
      "export function buildDatabaseMetricQuery(",
      "function bucketDate(",
    );
    expect(metrics).not.toContain("primaryEntityId");
    // A catalog pin narrows the metric; it is never the database's scope.
    expect(metrics).toContain(
      "const pins: Record<string, string> | null = pinsOf(window.pins);",
    );
    expect(metrics).toContain('query["attributes"] = pins;');
    expect(metrics).toContain("entityKeys: entityKeys,");

    // Grouping BY the calling service is fine; filtering by it is not.
    expect(util).toContain("groupBy: { primaryEntityId: true }");
  });

  test("engine metrics are read per series: gauges grouped and combined, counters rated per series", () => {
    const gauges: string = between(
      util,
      "export async function fetchDatabaseGaugeSeries(",
      "export async function",
    );
    expect(gauges).toContain("groupByAttributeKeys: window.groupKeys,");
    expect(gauges).toContain("combineGaugeSeries(result, window.combine)");

    const counters: string = between(
      util,
      "export async function fetchDatabaseCounterRateSeries(",
      "export async function",
    );
    expect(counters).toContain("groupBy: { attributes: true },");
    expect(counters).toContain("aggregationType: AggregationType.Max,");
    expect(counters).toContain("counterResultToRatePerSecond(result)");

    // The shared cumulative-counter math, not a local copy.
    expect(util).toContain('from "../../../Utils/CounterRateUtils"');
    expect(util).toContain("computeCounterRate(result, {");
  });

  test("each builder returns null before building anything when unscoped", () => {
    for (const fn of ["buildDatabaseSpanQuery(", "buildDatabaseMetricQuery("]) {
      const body: string = between(util, `export function ${fn}`, "return {");
      expect(body).toContain("return null;");
    }
  });

  test("the D2-owned telemetryMetrics helpers are not edited or relied on", () => {
    expect(util).not.toContain("TelemetryResource/telemetryMetrics");
    expect(readCode("Pages/Database/View/Overview.tsx")).not.toContain(
      "TelemetryResource/telemetryMetrics",
    );
  });
});

describe("the Logs / Traces / Metrics tabs", () => {
  test("the shared hook loads the row and its endpoints and derives keys through the helper", () => {
    const hook: string = readCode(SCOPE_HOOK);

    expect(hook).toContain("modelType: DatabaseServerEndpoint");
    expect(hook).toContain("query: { databaseServerId: modelId }");
    expect(hook).toContain("memberEntityKeys: true");
    expect(hook).toContain("getDatabaseServerScopeKeys(source)");
    expect(hook).toContain("buildDatabaseServerEntityKeyDisplays(source)");
  });

  test.each(["Logs", "Traces", "Metrics"])(
    "%s scopes through the hook and never renders an unscoped viewer",
    (tab: string) => {
      const code: string = readCode(`Pages/Database/View/${tab}.tsx`);

      expect(code).toContain(
        'from "../../../Components/DatabaseServer/useDatabaseServerTelemetryScope"',
      );
      expect(code).toContain("useDatabaseServerTelemetryScope(modelId)");
      expect(code).toContain("Navigation.getLastParamAsObjectID(1)");

      const guard: number = code.indexOf("if (!isDatabaseServerScoped(keys)");
      const banner: number = code.indexOf(BANNER_TAG, guard);
      const viewerStart: number = code.indexOf("return ( <Fragment>");

      expect(guard).toBeGreaterThan(-1);
      expect(banner).toBeGreaterThan(guard);
      expect(viewerStart).toBeGreaterThan(banner);

      // No tab scopes by attributes.
      expect(code).not.toContain("attributeFilters");
      expect(code).not.toContain("attributes:");
    },
  );

  test("Traces and Metrics hand the viewer the key set and its chip names", () => {
    for (const tab of ["Traces", "Metrics"]) {
      const code: string = readCode(`Pages/Database/View/${tab}.tsx`);
      expect(code).toContain("entityKeysFilter={keys}");
      expect(code).toContain("entityKeyDisplays={entityKeyDisplays}");
    }
  });

  test("a metric row charts in place with the same keys, never in the attribute-scoped explorer", () => {
    const code: string = readCode("Pages/Database/View/Metrics.tsx");
    const viewer: string = between(code, "<MetricsViewer", "/>");

    expect(viewer).toContain("onMetricClick={(metric: MetricType): void =>");
    expect(code).toContain("<DatabaseMetricChartModal");
    expect(between(code, "<DatabaseMetricChartModal", "/>")).toContain(
      "keys={keys}",
    );

    const modal: string = readCode(
      "Components/DatabaseServer/DatabaseMetricChartModal.tsx",
    );
    expect(modal).toContain("fetchDatabaseMetricChartSeries({");
    expect(modal).not.toContain("PageMap.METRIC_VIEW");
    expect(modal).not.toContain("attributes");
  });

  test("the chart's Create monitor is scoped by the database's id, and refuses what it cannot watch", () => {
    const metrics: string = readCode("Pages/Database/View/Metrics.tsx");
    expect(between(metrics, "<DatabaseMetricChartModal", "/>")).toContain(
      "databaseServerId={modelId}",
    );

    const modal: string = readCode(
      "Components/DatabaseServer/DatabaseMetricChartModal.tsx",
    );
    expect(modal).toContain("fetchDatabaseMetricCarriesServerId({");
    expect(modal).toContain("getDatabaseMetricMonitorBlocker({");
    expect(modal).toContain("buildDatabaseMetricMonitorRoute(");
    expect(modal).toContain("disabled={true}");

    const link: string = readCode(
      "Pages/Database/Utils/DatabaseMetricMonitorLink.ts",
    );
    // The same stamp the curated alert templates filter on.
    expect(link).toContain(
      "[DATABASE_SERVER_ID_SCOPE_ATTRIBUTE]: databaseServerIdText(",
    );
    expect(link).toContain(
      "MetricExplorerUrl.buildQueryParamsFromMetricViewData(viewData)",
    );
    expect(link).toContain("RouteMap[PageMap.MONITOR_CREATE] as Route");
    expect(link).toContain("if (data.spec.isRate) {");
  });

  test("Logs puts the keys in the log query and names the chips", () => {
    const code: string = readCode("Pages/Database/View/Logs.tsx");

    expect(code).toContain("getDatabaseServerEntityKeysQueryValue(keys)");
    expect(code).toContain("return { entityKeys: entityKeys } as Query<Log>;");
    expect(code).toContain("if (!entityKeys) { return null; }");
    expect(code).toContain("|| !logQuery");
    expect(code).toContain("entityKeyDisplays={entityKeyDisplays}");
    expect(code).toContain('noLogsMessage="No logs found for this database."');
  });

  test("the unscoped banner offers the two ways out", () => {
    const banner: string = readCode(
      "Components/DatabaseServer/DatabaseServerUnscopedBanner.tsx",
    );

    expect(banner).toContain("PageMap.DATABASE_SERVER_VIEW_ENDPOINTS");
    expect(banner).toContain("PageMap.DATABASE_SERVER_VIEW_DOCUMENTATION");
    expect(banner).toContain("No telemetry scope yet");
    expect(banner).toContain("Matched by its id only");
  });

  test.each([
    ["Logs", "logs"],
    ["Traces", "traces"],
    ["Metrics", "metrics"],
  ])(
    "%s shows the 'id only' hint above the viewer for a row scoped by its row key alone",
    (tab: string, signal: string) => {
      const code: string = readCode(`Pages/Database/View/${tab}.tsx`);
      const viewer: string = between(code, "return ( <Fragment>", "};");

      expect(code).toContain("isIdOnly,");
      expect(viewer).toContain(
        `{isIdOnly ? ( <div className="mb-4"> <DatabaseServerUnscopedBanner modelId={modelId} signal="${signal}" variant="id-only" />`,
      );
    },
  );

  test("the hook derives 'id only' through the scope helper", () => {
    const hook: string = readCode(SCOPE_HOOK);
    expect(hook).toContain("isDatabaseServerScopedByIdOnly(source)");
  });
});

describe("the Overview", () => {
  const code: string = readCode("Pages/Database/View/Overview.tsx");

  test("issues no telemetry query for a database without keys", () => {
    const guard: string = between(
      code,
      "if (!isDatabaseServerScoped(allKeys))",
      "Promise.all([",
    );

    expect(guard).toContain("setTelemetryLoading(false)");
    expect(guard).toContain("return;");
  });

  test("queries from applications use the endpoint keys, runtime the member keys", () => {
    expect(code).toContain(
      "fetchDatabaseQueryMetrics({ projectId, keys: endpointKeys, start, end })",
    );
    expect(code).toContain(
      "fetchDatabaseCallingServices({ projectId, keys: endpointKeys,",
    );
    expect(code).toContain(
      "fetchDatabaseEngineMetrics({ projectId, keys: allKeys,",
    );
    expect(code).toContain("keys: memberKeys,");
    expect(code).toContain("getDatabaseServerMetrics(item.dbSystem)");
  });

  test("renders the three sections, runtime only for a container platform", () => {
    expect(code).toContain("<DatabaseCallingServicesCard");
    expect(code).toContain("<DatabaseEngineMetricsSection");
    expect(code).toContain(
      '{platform ? ( <div className="mt-6"> <DatabaseRuntimeSection',
    );
  });

  test("shows the unscoped banner above the overview", () => {
    expect(code.indexOf(BANNER_TAG)).toBeGreaterThan(-1);
    expect(code.indexOf(BANNER_TAG)).toBeLessThan(
      code.indexOf("<ResourceOverview icon="),
    );
  });

  test("shows the database's incidents, alerts and maintenance like other overviews", () => {
    const cards: string = between(code, "<ResourceActivityCards", "/>");
    expect(cards).toContain('resourceQueryKey="databaseServers"');
    expect(cards).toContain("PageMap.DATABASE_SERVER_VIEW_INCIDENTS");
    expect(cards).toContain("PageMap.DATABASE_SERVER_VIEW_ALERTS");
    expect(cards).toContain(
      "PageMap.DATABASE_SERVER_VIEW_SCHEDULED_MAINTENANCE",
    );
    expect(cards).toContain("refreshToken={");
  });

  test("every tile and chart explains itself", () => {
    for (const key of [
      "queries",
      "errorRate",
      "p95Latency",
      "callingServices",
      "queriesChart",
      "p95Chart",
    ]) {
      expect(code).toContain(`DATABASE_METRIC_DESCRIPTIONS.${key}`);
    }
  });

  test("Calling services counts every service, not the table's ten", () => {
    expect(code).toContain("formatDatabaseCount(callingServices.total)");
    expect(code).not.toContain("String(callingServices.length)");
    expect(code).toContain("totalServices={callingServices.total}");
  });

  test("scopes by the row key too, like the telemetry tabs", () => {
    expect(code).toContain("id: modelId,");
  });

  test("links to the cluster or host it runs on", () => {
    expect(code).toContain("getDatabaseRunsOnRoute(r)");
    expect(code).toContain("source={r}");
  });

  test("resolves calling-service names through the Service model", () => {
    expect(code).toContain("modelType: Service,");
    expect(code).toContain("_id: new Includes(");
  });

  test("engine metrics that never arrived show a not-connected card with a way to connect", () => {
    const section: string = readCode(
      "Components/DatabaseServer/DatabaseEngineMetricsSection.tsx",
    );
    expect(section).toContain('"Engine metrics not connected"');
    expect(section).toContain("PageMap.DATABASE_SERVER_VIEW_DOCUMENTATION");
    expect(section).toContain("formatDatabaseMetricValue(");
    expect(section).toContain('result.definition.kind === "counter"');
  });

  test("what 'not connected' suggests follows the engine's metrics source, not the receiver flag", () => {
    const section: string = readCode(
      "Components/DatabaseServer/DatabaseEngineMetricsSection.tsx",
    );
    expect(section).toContain("getDatabaseEngineMetricsSource(");
    expect(section).toContain("getDatabaseAgentEngine(data.dbSystem)");
    expect(section).not.toContain("hasCollectorReceiver");
    expect(code).toContain("dbSystem={r.dbSystem}");
    expect(code).not.toContain("hasCollectorReceiver");
  });

  test("a row scoped by its id alone says so above the overview", () => {
    expect(code).toContain(
      "const isIdOnly: boolean = isDatabaseServerScopedByIdOnly(source);",
    );
    expect(code).toContain('variant={isScoped ? "id-only" : "unscoped"}');
  });

  test("a connected database with nothing to chart is not called disconnected", () => {
    const section: string = readCode(
      "Components/DatabaseServer/DatabaseEngineMetricsSection.tsx",
    );
    const connected: string = between(
      section,
      "if (!hasData && props.status === DatabaseEngineMetricsStatus.Connected)",
      "if (!hasData) {",
    );

    expect(connected).toContain("ENGINE_METRICS_NO_DATA_TITLE");
    expect(connected).toContain("props.hasCatalog");
    expect(connected).toContain("to={metricsRoute}");
    expect(connected).not.toContain("documentationRoute");
  });
});

describe("the Databases list", () => {
  const code: string = readCode("Pages/Database/Databases.tsx");
  const formFields: string = between(code, "formFields={[", "filters={[");

  test("the create form asks for the engine and address, never the identity", () => {
    const engine: string = between(
      formFields,
      "field: { dbSystem: true, }",
      "field: { serverAddress: true, }",
    );
    expect(engine).toContain("fieldType: FormFieldSchemaType.Dropdown");
    expect(engine).toContain("dropdownOptions: ENGINE_OPTIONS");
    expect(engine).toContain("required: true");

    const address: string = between(
      formFields,
      "field: { serverAddress: true, }",
      "field: { serverPort: true, }",
    );
    expect(address).toContain("required: true");
    // The help, the check and the hint come from the form helper.
    expect(address).toContain(
      "description: DATABASE_SERVER_ADDRESS_DESCRIPTION,",
    );
    expect(address).toContain("return validateDatabaseServerAddress(values);");
    expect(address).toContain(
      "const hint: string | null = getDatabaseServerAddressHint(values);",
    );
    const helper: string = readCode(
      "Pages/Database/Utils/DatabaseManualEndpointForm.ts",
    );
    expect(helper).toContain("Never localhost");
    expect(helper).toContain("parseManualDatabaseEndpoint(");

    const port: string = between(
      formFields,
      "field: { serverPort: true, }",
      "field: { name: true, }",
    );
    expect(port).toContain("fieldType: FormFieldSchemaType.Number");
    expect(port).toContain("required: false");

    const name: string = between(
      formFields,
      "field: { name: true, }",
      "field: { description: true, }",
    );
    expect(name).toContain("required: false");

    expect(formFields).toContain("field: { labels: true, }");
    expect(formFields).not.toContain("databaseIdentifier");
    expect(formFields).not.toContain("discoverySource");
  });

  test("onBeforeCreate only trims and leaves an empty name to the server", () => {
    const hook: string = between(code, "onBeforeCreate={", "onCreateSuccess={");

    expect(hook).toContain("delete item.name;");
    expect(hook).not.toContain("databaseIdentifier");
    expect(hook).not.toContain("discoverySource");
  });

  test("columns cover identity, engine, platform, source, engine metrics, recency, labels and owners", () => {
    for (const title of [
      'title: "Name"',
      'title: "Engine"',
      'title: "Runs on"',
      'title: "Discovered from"',
      'title: "Engine metrics"',
      'title: "Last Seen"',
      'title: "Labels"',
      'title: "Owners"',
    ]) {
      expect(code).toContain(title);
    }
    expect(code).toContain("getDatabaseEngineMetricsStatus(item)");
    // Runs on links to the cluster / host page.
    expect(code).toContain("<DatabaseRunsOnLink source={item} />");
    expect(code).toContain("getDatabaseEndpointLabel(item)");
  });

  test("the engine-metrics facet resolves rows by status, 'Not connected' included", () => {
    const facet: string = between(
      code,
      'key: "otelCollectorStatus"',
      "const { getOwnersForResource,",
    );
    expect(facet).toContain("options: ENGINE_METRICS_STATUS_OPTIONS");
    expect(facet).toContain(
      "computeDatabaseServerIdsForEngineMetricsStatuses(",
    );
    expect(code).toContain(
      "const ENGINE_METRICS_STATUS_OPTIONS: Array<DatabaseOption> = getDatabaseEngineMetricsStatusOptions();",
    );
  });

  test("the summary strip refreshes with every table fetch, not only after a create", () => {
    expect(code).toContain(
      "<DatabaseServerSummaryStrip refreshToken={summaryRefreshToken} />",
    );
    const onFetch: string = between(
      code,
      "onFetchSuccess={",
      "onBeforeCreate={",
    );
    expect(onFetch).toContain("onResourcesFetched(data);");
    expect(onFetch).toContain("setSummaryRefreshToken(");
    expect(code).not.toContain("refreshToken={count}");
  });

  test("facets filter by engine, discovery source and engine-metrics status", () => {
    expect(code).toContain('key: "dbSystem"');
    expect(code).toContain('key: "discoverySource"');
    expect(code).toContain('key: "otelCollectorStatus"');
    expect(code).toContain(
      "query={mergeFiltersIntoQuery({ isArchived: false })}",
    );
  });

  test("bulk label, owner and archive actions", () => {
    const bulk: string = between(code, "bulkActions={{", "}}");
    expect(bulk).toContain("...labelBulkActions");
    expect(bulk).toContain("...ownerBulkActions");
    expect(bulk).toContain("...archiveBulkActions");
    expect(code).toContain('resourceIdField: "databaseServerId"');
  });

  test("the summary strip sits above the table and the guide below it, count first", () => {
    expect(code.indexOf("<DatabaseServerSummaryStrip")).toBeGreaterThan(-1);
    expect(code.indexOf("<DatabaseServerSummaryStrip")).toBeLessThan(
      code.indexOf("<ModelTable<DatabaseServer>"),
    );
    expect(
      code.indexOf("{count === 0 && ( <DatabaseDocumentationCard"),
    ).toBeGreaterThan(code.indexOf("<ModelTable<DatabaseServer>"));
  });
});

describe("Archived", () => {
  const code: string = readCode("Pages/Database/Archived.tsx");

  test("View opens the database's own page, not an unrouted archived/<id> URL", () => {
    expect(code).not.toContain("viewPageRoute=");
    expect(between(code, "onViewPage={", "columns={[")).toContain(
      "RouteMap[PageMap.DATABASE_SERVER_VIEW] as Route",
    );
  });

  test("lists archived rows only and offers unarchive", () => {
    expect(code).toContain("query={{ isArchived: true, }}");
    expect(code).toContain("buttons: [...unarchiveBulkActions]");
    expect(code).toContain("isCreateable={false}");
  });
});

describe("Endpoints", () => {
  const code: string = readCode("Pages/Database/View/Endpoints.tsx");

  test("is a ModelTable of this database's DatabaseServerEndpoint rows", () => {
    expect(code).toContain("<ModelTable<DatabaseServerEndpoint>");
    expect(code).toContain("query={{ databaseServerId: modelId, }}");
    expect(code).toContain("Navigation.getLastParamAsObjectID(1)");
  });

  test("endpoints can be added and removed but not edited", () => {
    expect(code).toContain("isCreateable={true}");
    expect(code).toContain("isDeleteable={true}");
    expect(code).toContain("isEditable={false}");
    expect(code).toContain("item.databaseServerId = modelId;");
  });

  test("the primary endpoint is read-only", () => {
    const hook: string = between(code, "onBeforeDelete={", "cardProps={{");
    expect(hook).toContain("if (item.isPrimary)");
    expect(hook).toContain("PRIMARY_ENDPOINT_DELETE_MESSAGE");
    expect(code).toContain("selectMoreFields={{ isPrimary: true, }}");
  });

  test("'Added by' names each source, a workload's Kubernetes Service included", () => {
    const column: string = between(code, 'title: "Added by"', "title:");
    expect(column).toContain("getDatabaseEndpointSourceLabel(item.source)");
    expect(column).toContain("color={label.isUser ? Blue : Gray500}");
    // Last Matched is maintained now; it stays.
    expect(code).toContain("field: { lastMatchedAt: true, }");
  });
});

describe("Settings, Delete and Documentation", () => {
  test("Settings opens with an editable name, description and labels", () => {
    const code: string = readCode("Pages/Database/View/Settings.tsx");
    const card: string = between(
      code,
      "<CardModelDetail<DatabaseServer>",
      "<Alert",
    );

    expect(card).toContain("isEditable={true}");
    expect(card).toContain('editButtonText="Edit Database"');
    const formFields: string = between(
      card,
      "formFields={[",
      "modelDetailProps={{",
    );
    expect(formFields).toContain("field: { name: true, }");
    expect(formFields).toContain("fieldType: FormFieldSchemaType.Text");
    expect(formFields).toContain("field: { description: true, }");
    expect(formFields).toContain("fieldType: FormFieldSchemaType.LongText");
    expect(formFields).toContain("field: { labels: true, }");
    expect(formFields).toContain(
      "fieldType: FormFieldSchemaType.MultiSelectDropdown",
    );
    // The identity is never editable here.
    expect(formFields).not.toContain("serverAddress");
    expect(formFields).not.toContain("databaseIdentifier");
    expect(card).toContain("modelType: DatabaseServer,");
    expect(card).toContain("modelId: modelId,");
    expect(code.indexOf("<CardModelDetail<DatabaseServer>")).toBeLessThan(
      code.indexOf("DATABASE_RETENTION_SCOPE_NOTE}"),
    );
  });

  test("Settings: scoped retention copy, retention, then the archive card", () => {
    const code: string = readCode("Pages/Database/View/Settings.tsx");
    const note: number = code.indexOf("DATABASE_RETENTION_SCOPE_NOTE}");
    const retention: number = code.indexOf(
      "<TelemetryResourceRetentionSettings<DatabaseServer>",
    );
    const archive: number = code.indexOf(
      "<ArchiveResourceCard<DatabaseServer>",
    );

    expect(note).toBeGreaterThan(-1);
    expect(retention).toBeGreaterThan(note);
    expect(archive).toBeGreaterThan(retention);
    expect(code).toContain('modelDetailIdPrefix="database-server"');
    expect(code).toContain("RouteMap[PageMap.DATABASE_SERVERS] as Route");
    expect(readSource("Pages/Database/View/Settings.tsx")).toContain(
      "The traces of the queries your applications send it belong to the calling services",
    );
  });

  test("Delete warns that discovered databases come back and points at archiving", () => {
    const source: string = readSource("Pages/Database/View/Delete.tsx");
    expect(source).toContain("comes back the next time it is seen");
    expect(source).toContain("archive it instead");
    expect(readCode("Pages/Database/View/Delete.tsx")).toContain(
      "<ModelDelete modelType={DatabaseServer}",
    );
  });

  test("Documentation prefills the guide for this row, id included", () => {
    const code: string = readCode("Pages/Database/View/Documentation.tsx");
    expect(code).toContain("id: modelId.toString(),");
    expect(code).toContain("database={target}");
    expect(code).toContain(
      "getDatabaseRuntimePlatform(item) === DatabaseRuntimePlatform.Kubernetes",
    );
    expect(code).toContain("modelType: DatabaseServerEndpoint");
  });
});

describe("activity, feed and owners", () => {
  test.each(["Incidents", "Alerts", "ScheduledMaintenance"])(
    "%s lists the rows linked through the databaseServers relation",
    (tab: string) => {
      const code: string = readCode(`Pages/Database/View/${tab}.tsx`);
      expect(code).toContain(
        "query.databaseServers = new Includes([modelId]);",
      );
      expect(code).toContain("Navigation.getLastParamAsObjectID(1)");
    },
  );

  test("Feed offers its own model's event types", () => {
    const code: string = readCode("Pages/Database/View/Feed.tsx");
    expect(code).toContain("<ResourceFeed<DatabaseServerFeed>");
    expect(code).toContain('resourceIdColumn="databaseServerId"');
    expect(code).toContain('eventTypeColumn="databaseServerFeedEventType"');
    expect(code).toContain("Object.values(DatabaseServerFeedEventType)");
  });

  test("Owners uses the database owner models", () => {
    const code: string = readCode("Pages/Database/View/Owners.tsx");
    expect(code).toContain(
      "<OwnersCard<DatabaseServerOwnerUser, DatabaseServerOwnerTeam>",
    );
    expect(code).toContain('resourceIdField="databaseServerId"');
  });
});

describe("label and owner rules", () => {
  test.each(["LabelRules", "OwnerRules"])(
    "%s matches on the three database criteria fields",
    (page: string) => {
      const code: string = readCode(`Pages/Database/Settings/${page}.tsx`);
      for (const field of [
        "databaseServerLabels",
        "databaseServerNamePattern",
        "databaseServerDescriptionPattern",
      ]) {
        expect(code).toContain(`field: { ${field}: true }`);
      }
    },
  );

  test("the rule tables list, view and route through the database rule keys", () => {
    const label: string = readCode("Pages/Database/Settings/LabelRules.tsx");
    const owner: string = readCode("Pages/Database/Settings/OwnerRules.tsx");

    expect(label).toContain("modelType={DatabaseServerLabelRule}");
    expect(label).toContain("PageMap.DATABASE_SETTINGS_LABEL_RULE_VIEW");
    expect(label).toMatch(
      /RuleViewPageUtil\.getViewRuleId\( ?props, DatabaseServerLabelRule,? ?\)/,
    );
    expect(owner).toContain("modelType={DatabaseServerOwnerRule}");
    expect(owner).toContain("PageMap.DATABASE_SETTINGS_OWNER_RULE_VIEW");
    expect(owner).toMatch(
      /RuleViewPageUtil\.getViewRuleId\( ?props, DatabaseServerOwnerRule,? ?\)/,
    );
  });

  test("the help says names start with the engine", () => {
    expect(readSource("Pages/Database/Settings/LabelRules.tsx")).toContain(
      "matches every PostgreSQL database",
    );
  });
});

/*
 * The reverse of a database's "Runs on" / "Workload" links: the Kubernetes
 * StatefulSet / Deployment / pod pages and the Docker / Podman container
 * pages show the Database discovered on them, through the one shared
 * component (one query; nothing rendered without a match).
 */
describe("'Open database' on the workload and container pages", () => {
  test.each([
    ["Pages/Kubernetes/View/StatefulSetDetail.tsx", "StatefulSet"],
    ["Pages/Kubernetes/View/DeploymentDetail.tsx", "Deployment"],
    ["Pages/Kubernetes/View/PodDetail.tsx", "Pod"],
  ])(
    "%s asks by cluster, namespace and workload names once its object loaded",
    (file: string, kind: string) => {
      const code: string = readCode(file);
      const badge: string = between(
        code,
        "<DatabaseServerWorkloadBadge",
        "<Tabs tabs={tabs}",
      );

      expect(code).toContain(
        'from "../../../Components/DatabaseServer/DatabaseServerWorkloadBadge"',
      );
      expect(badge).toContain("isLoadingObject ? null");
      expect(badge).toContain('platform: "kubernetes"');
      expect(badge).toContain("parentId: modelId,");
      expect(badge).toContain("namespace: ");
      expect(badge).toContain(`kind: "${kind}"`);
    },
  );

  test("the pod page hands its owners and containers to the classifier", () => {
    const badge: string = between(
      readCode("Pages/Kubernetes/View/PodDetail.tsx"),
      "<DatabaseServerWorkloadBadge",
      "<Tabs tabs={tabs}",
    );
    expect(badge).toContain(
      "ownerReferences: podObject?.metadata.ownerReferences,",
    );
    expect(badge).toContain("containers: podObject?.spec.containers,");
  });

  test.each([
    ["Pages/Docker/View/ContainerDetail.tsx", "docker"],
    ["Pages/Podman/View/ContainerDetail.tsx", "podman"],
  ])("%s asks by its host and container", (file: string, platform: string) => {
    const badge: string = between(
      readCode(file),
      "<DatabaseServerWorkloadBadge",
      "<Tabs tabs={tabs}",
    );
    expect(badge).toContain(`platform: "${platform}"`);
    expect(badge).toContain("parentId: modelId,");
    expect(badge).toContain("getContainerDatabaseWorkloadNames({");
    expect(badge).toContain("containerName: containerName,");
    expect(badge).toContain("imageName: containerImage,");
  });

  test("the component asks one lean query and links the database page", () => {
    const code: string = readCode(
      "Components/DatabaseServer/DatabaseServerWorkloadBadge.tsx",
    );
    expect(code.match(/ModelAPI\.getList</g)).toHaveLength(1);
    expect(code).toContain("select: { _id: true, name: true, dbSystem: true }");
    expect(code).toContain("RouteMap[PageMap.DATABASE_SERVER_VIEW] as Route");
    expect(code).toContain("if (rows.length === 0) { return <></>; }");
  });
});
