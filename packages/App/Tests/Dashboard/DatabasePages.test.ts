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

  test("scope by keys only — no attribute or primaryEntityId filter", () => {
    expect(util).not.toContain("attributes:");
    for (const fn of ["buildDatabaseSpanQuery(", "buildDatabaseMetricQuery("]) {
      const body: string = between(
        util,
        `export function ${fn}`,
        "export function",
      );
      expect(body).not.toContain("primaryEntityId");
      expect(body).not.toContain("attributes");
    }
    // Grouping BY the calling service is fine; filtering by it is not.
    expect(util).toContain("groupBy: { primaryEntityId: true }");
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
    expect(address).toContain("Never localhost");

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
    expect(code).toContain("getDatabaseRunsOnLabel(item)");
    expect(code).toContain("getDatabaseEndpointLabel(item)");
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
});

describe("Settings, Delete and Documentation", () => {
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
