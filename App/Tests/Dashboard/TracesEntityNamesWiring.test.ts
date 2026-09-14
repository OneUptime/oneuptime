import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The traces explorer used to name every span entity through the Service
 * table alone. A RUM application's traces tab therefore read
 * "Service: 84858d6c-…" on its locked chip, "unknown service" on every row
 * and in the span panel, and a list of UUIDs in the analytics "Service"
 * split; the Insights tab's scope pill showed the raw id too.
 *
 * The display rules live in Components/Traces/TracesEntityDisplay and are
 * exercised in TracesEntityDisplay.test.ts. What is pinned here is the
 * wiring, which is where this fix can regress without a single thrown error:
 * a viewer that stops passing `entity` to its rows, or builds a chip without
 * going through resolveTraceChipDisplay, just quietly shows the UUID again.
 *
 * The App suite has no renderer (testEnvironment "node", no react), so the
 * sources are read comment-stripped and whitespace-squashed — a prettier
 * re-wrap cannot turn a real regression check into a red herring.
 */

const TRACES_DIR: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
  "Components",
  "Traces",
);

type ReadSourceFunction = (fileName: string) => string;

const readSource: ReadSourceFunction = (fileName: string): string => {
  return fs
    .readFileSync(path.join(TRACES_DIR, fileName), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:"'`])\/\/.*$/gm, "$1 ")
    .replace(/\s+/g, " ")
    .trim();
};

type CountFunction = (haystack: string, needle: string) => number;

const count: CountFunction = (haystack: string, needle: string): number => {
  return haystack.split(needle).length - 1;
};

const TRACES_VIEWER: string = readSource("TracesViewer.tsx");
const TRACE_ROW: string = readSource("TraceRow.tsx");
const SPAN_PANEL: string = readSource("SpanDetailsPanel.tsx");
const ANALYTICS_VIEW: string = readSource("TracesAnalyticsView.tsx");
const TRACES_DASHBOARD: string = readSource("TracesDashboard.tsx");
const ENTITY_DISPLAY: string = readSource("TracesEntityDisplay.ts");

describe("TracesViewer props contract", () => {
  test("declares scopeEntityType as the ServiceType of primaryEntityId", () => {
    expect(TRACES_VIEWER).toContain(
      'import ServiceType from "Common/Types/Telemetry/ServiceType";',
    );
    expect(TRACES_VIEWER).toContain(
      "scopeEntityType?: ServiceType | undefined;",
    );
  });

  test("declares the display-only attribute value override", () => {
    expect(TRACES_VIEWER).toContain(
      "attributeFilterDisplayValues?: Record<string, string> | undefined;",
    );
    // Still declares the key override it already had.
    expect(TRACES_VIEWER).toContain(
      "attributeFilterDisplayKeys?: Record<string, string> | undefined;",
    );
  });
});

describe("TracesViewer resolves entity names with one lookup", () => {
  test("calls useTelemetryEntityNames exactly once, hinted with the scope type", () => {
    expect(TRACES_VIEWER).toContain(
      'import useTelemetryEntityNames from "Common/UI/Utils/Telemetry/UseTelemetryEntityNames";',
    );
    expect(count(TRACES_VIEWER, "useTelemetryEntityNames(")).toBe(1);
    expect(TRACES_VIEWER).toContain(
      "useTelemetryEntityNames( entityIdsToResolve, { typeHints: entityTypeHints }, );",
    );
    expect(TRACES_VIEWER).toContain(
      "buildTraceEntityTypeHints(scopeEntityId, props.scopeEntityType)",
    );
  });

  test("the lookup covers the scope id, the stored-query chips, user chips and span rows", () => {
    const start: number = TRACES_VIEWER.indexOf(
      "const entityIdsToResolve: Array<string> = useMemo(",
    );
    expect(start).toBeGreaterThan(-1);
    const block: string = TRACES_VIEWER.substring(start, start + 1200);

    expect(block).toContain("collectTraceEntityIdsToResolve({");
    expect(block).toContain(
      '{ facetKey: "primaryEntityId", value: scopeEntityId }',
    );
    expect(block).toContain("...(spanScope.chips as Array<SpanScopeChip>)");
    expect(block).toContain("...activeFilters");
    expect(block).toContain("span.primaryEntityId?.toString()");
    // Existing name sources keep precedence and are not re-looked-up.
    expect(block).toContain(
      'knownNames: [serviceNameMap, facetDisplayNames["primaryEntityId"]]',
    );
    // Span ids wait for the Service list, which names most of them.
    expect(block).toContain("includeSpanEntityIds: resourcesLoaded");
  });

  test("resourcesLoaded flips once the resource lists land, even on failure", () => {
    expect(TRACES_VIEWER).toContain(
      "const [resourcesLoaded, setResourcesLoaded] = useState<boolean>(false);",
    );
    expect(TRACES_VIEWER).toContain(
      "} catch { } finally { setResourcesLoaded(true); }",
    );
  });

  test("server facet display names are indexed for chips", () => {
    expect(TRACES_VIEWER).toContain("buildFacetDisplayNames(facetData)");
  });
});

describe("TracesViewer chips", () => {
  const mergedStart: number = TRACES_VIEWER.indexOf(
    "const mergedActiveFilters: Array<ActiveFilter> = useMemo(",
  );
  const mergedEnd: number = TRACES_VIEWER.indexOf(
    "const handleCreateMetric:",
    mergedStart,
  );
  const MERGED: string = TRACES_VIEWER.substring(mergedStart, mergedEnd);

  test("the merged chip block is found", () => {
    expect(mergedStart).toBeGreaterThan(-1);
    expect(mergedEnd).toBeGreaterThan(mergedStart);
  });

  test("every non-attribute chip goes through resolveTraceChipDisplay with the entity context", () => {
    expect(MERGED).toContain("return resolveTraceChipDisplay(chip, {");
    expect(MERGED).toContain("facetConfigs,");
    expect(MERGED).toContain("facetDisplayNames,");
    expect(MERGED).toContain("entityNames,");
    expect(MERGED).toContain("scopeEntityId,");
    expect(MERGED).toContain("scopeEntityType: props.scopeEntityType,");

    // The locked scope chip, the stored-query chips, and user chips.
    expect(MERGED).toContain(
      'resolveDisplay({ facetKey: "primaryEntityId", value: props.primaryEntityId.toString(),',
    );
    expect(MERGED).toContain(
      "base.push( resolveDisplay({ facetKey: chip.facetKey, value: chip.value, displayKey: chip.displayKey,",
    );
    expect(MERGED).toContain("...activeFilters.map(resolveDisplay)");
  });

  test("the old Service-only lookup is gone from the chip path", () => {
    expect(MERGED).not.toContain(
      "config?.valueDisplayMap?.[chip.value] || chip.value",
    );
    expect(MERGED).not.toContain(
      "let displayKey: string = config?.title || chip.facetKey;",
    );
  });

  test("locked attribute chips carry both display overrides and the unchanged value", () => {
    expect(MERGED).toContain("buildLockedAttributeChip({");
    expect(MERGED).toContain("displayKeys: props.attributeFilterDisplayKeys,");
    expect(MERGED).toContain(
      "displayValues: props.attributeFilterDisplayValues,",
    );
    expect(MERGED).not.toContain("displayValue: value, readOnly: true,");
  });

  test("the memo re-runs when names, facets or the scope type change", () => {
    const depsStart: number = MERGED.lastIndexOf("}, [");
    const deps: string = MERGED.substring(depsStart);

    for (const dependency of [
      "props.primaryEntityId",
      "props.scopeEntityType",
      "props.attributeFilters",
      "props.attributeFilterDisplayKeys",
      "props.attributeFilterDisplayValues",
      "spanScope",
      "activeFilters",
      "facetConfigs",
      "facetDisplayNames",
      "entityNames",
    ]) {
      expect(deps).toContain(`${dependency},`);
    }
  });

  test("a sidebar chip seeds its value from the server facet displayName", () => {
    expect(TRACES_VIEWER).toContain(
      "facetData[facetKey]?.find((facet: FacetValue): boolean => { return facet.value === value; })?.displayName || value",
    );
    expect(TRACES_VIEWER).toContain("[facetConfigs, facetData],");
  });
});

describe("TracesViewer resource facets come from the shared catalog", () => {
  const facetConfigsStart: number = TRACES_VIEWER.indexOf(
    "const facetConfigs: Array<FacetConfig> = useMemo(",
  );
  const facetConfigsEnd: number = TRACES_VIEWER.indexOf(
    "const histogramSeries:",
    facetConfigsStart,
  );
  const FACET_CONFIGS: string = TRACES_VIEWER.substring(
    facetConfigsStart,
    facetConfigsEnd,
  );

  test("the facet config block is found", () => {
    expect(facetConfigsStart).toBeGreaterThan(-1);
    expect(facetConfigsEnd).toBeGreaterThan(facetConfigsStart);
  });

  test("imports the catalog keys and the shared config builder", () => {
    expect(TRACES_VIEWER).toContain(
      'import { RESOURCE_FACET_CATALOG_KEYS } from "Common/Types/Telemetry/ResourceFacetCatalog";',
    );
    expect(TRACES_VIEWER).toContain(
      'import { buildResourceFacetConfigs } from "Common/UI/Components/TelemetryViewer/ResourceFacetConfigs";',
    );
  });

  test("the facets request asks for Service, every catalog resource, then the span facets in their old order", () => {
    expect(TRACES_VIEWER).toContain(
      'facetKeys: [ "primaryEntityId", ...RESOURCE_FACET_CATALOG_KEYS, "statusCode", "kind", "isRootSpan", "hasException", "name", ...Array.from(ATTRIBUTE_FACET_KEYS), ],',
    );
  });

  test("REGRESSION: resource facets are built from the catalog, not hand-written per type", () => {
    expect(FACET_CONFIGS).toContain(
      "...buildResourceFacetConfigs({ basePriority: 2, valueDisplayMaps: { hostId: hostNameMap, dockerHostId: dockerHostNameMap, podmanHostId: podmanHostNameMap, kubernetesClusterId: clusterNameMap, }, }),",
    );
    for (const key of [
      "hostId",
      "dockerHostId",
      "podmanHostId",
      "kubernetesClusterId",
      "proxmoxClusterId",
      "vmwareVCenterId",
      "iotFleetId",
    ]) {
      expect(FACET_CONFIGS).not.toContain(`key: "${key}"`);
    }
  });

  test("Service stays first, always shown, with its icon; Status keeps its place after the resources", () => {
    expect(FACET_CONFIGS).toContain(
      'key: "primaryEntityId", title: "Service", icon: IconProp.SquareStack, valueDisplayMap: serviceNameMap, valueColorMap: serviceColorMap, priority: 1, serverSearchable: true, },',
    );
    expect(FACET_CONFIGS.indexOf('title: "Service"')).toBeLessThan(
      FACET_CONFIGS.indexOf("...buildResourceFacetConfigs({"),
    );
    expect(
      FACET_CONFIGS.indexOf("...buildResourceFacetConfigs({"),
    ).toBeLessThan(FACET_CONFIGS.indexOf('key: "statusCode"'));
    expect(FACET_CONFIGS).toContain(
      'key: "statusCode", title: "Status", valueDisplayMap: statusLabelMap, valueColorMap: statusColorMap, priority: 6,',
    );
    // Only resource facets fold away while empty.
    expect(FACET_CONFIGS).not.toContain("hideWhenEmpty");
  });

  test("resource selections never become Span column filters", () => {
    expect(TRACES_VIEWER).toContain(
      "for (const key of Object.keys(facetGroups)) { if (isResourceFacetKey(key)) { continue; }",
    );
    expect(TRACES_VIEWER).toContain(
      "collectResourceEntityFacetSelections(Object.entries(facetGroups));",
    );
    expect(TRACES_VIEWER).toContain(
      "collectResourceEntityFacetSelections(Object.entries(groups));",
    );
  });
});

describe("filtering is untouched", () => {
  test("queries, the URL and saved views still carry the chip's raw value", () => {
    // URL mirror.
    expect(TRACES_VIEWER).toContain("return [f.facetKey, f.value];");
    // Saved view capture.
    expect(TRACES_VIEWER).toContain(
      "filters: activeFilters.map((filter: ActiveFilter): [string, string] => { return [filter.facetKey, filter.value]; }),",
    );
    // The prop scope still filters by the id.
    expect(TRACES_VIEWER).toContain(
      "query.primaryEntityId = props.primaryEntityId;",
    );
    expect(TRACES_VIEWER).toContain(
      'applyScopeGroup("primaryEntityId", [props.primaryEntityId.toString()]);',
    );
  });

  test("the chip resolver never rewrites facetKey or value", () => {
    expect(ENTITY_DISPLAY).not.toMatch(/facetKey:\s*display/);
    expect(ENTITY_DISPLAY).not.toMatch(/value:\s*display\.value,\s*readOnly/);
    expect(ENTITY_DISPLAY).toContain(
      "return { ...chip, displayKey: display.key, displayValue: display.value };",
    );
  });
});

describe("span rows and the span panel", () => {
  test("TracesViewer hands each row its Service or its resolved entity", () => {
    expect(TRACES_VIEWER).toContain(
      "getSpanEntity({ spanEntityId: span.primaryEntityId, serviceById, entityNames, });",
    );
    expect(TRACES_VIEWER).toContain(
      "<TraceRow span={span} service={service} entity={spanEntity.entity}",
    );
    expect(TRACES_VIEWER).toContain(
      "<SpanDetailsPanel span={span} service={service} entity={spanEntity.entity}",
    );
  });

  test("TraceRow names the entity through getSpanEntityDisplay", () => {
    expect(TRACE_ROW).toContain(
      "entity?: ResolvedTelemetryEntity | undefined;",
    );
    expect(TRACE_ROW).toContain(
      "getSpanEntityDisplay({ service, entity: props.entity, });",
    );
    expect(TRACE_ROW).not.toContain('service?.name || "unknown service"');
  });

  test("SpanDetailsPanel names the entity and labels its type", () => {
    expect(SPAN_PANEL).toContain(
      "entity?: ResolvedTelemetryEntity | undefined;",
    );
    expect(SPAN_PANEL).toContain(
      "getSpanEntityDisplay({ service, entity: props.entity, });",
    );
    expect(SPAN_PANEL).toContain(
      "{ label: entityDisplay.typeLabel, value: serviceName },",
    );
    expect(SPAN_PANEL).not.toContain('service?.name || "unknown service"');
    expect(SPAN_PANEL).not.toContain(
      '{ label: "Service", value: serviceName }',
    );
  });
});

describe("analytics split-by Service", () => {
  test("resolves the unnamed entity ids on screen and formats through the shared helper", () => {
    expect(count(ANALYTICS_VIEW, "useTelemetryEntityNames(")).toBe(1);
    expect(ANALYTICS_VIEW).toContain("collectTraceAnalyticsEntityIds({");
    expect(ANALYTICS_VIEW).toContain(
      "rows: [...timeseriesData, ...tableData],",
    );
    expect(ANALYTICS_VIEW).toContain("topList: topListData,");
    expect(ANALYTICS_VIEW).not.toContain(
      "return props.serviceNameMap[raw] || raw;",
    );
  });

  test("REGRESSION: timeseries series are keyed by raw group values, not by display label", () => {
    expect(ANALYTICS_VIEW).toContain(
      "pivotTraceAnalyticsTimeseries({ rows: timeseriesData, serviceNameMap: props.serviceNameMap, entityNames, metricLabel, });",
    );
    // The old pivot joined display labels into the series key.
    expect(ANALYTICS_VIEW).not.toContain(
      "return displayGroupValue(key, value);",
    );
    expect(ANALYTICS_VIEW).not.toContain("pivotRow[seriesKey] = row.value;");
    // The unique label is what the legend keys and the chart series use.
    expect(ANALYTICS_VIEW).toContain(
      '<div key={key} className="flex items-center gap-1.5">',
    );
    expect(ANALYTICS_VIEW).toContain("dataKey={key}");
  });

  test("top list and table cells use per-dimension unique labels", () => {
    expect(ANALYTICS_VIEW).toContain(
      'buildTraceAnalyticsValueLabels({ key: groupByFields[0] || "",',
    );
    expect(ANALYTICS_VIEW).toContain(
      'topListLabels.get(item.value || "") || item.value',
    );
    expect(ANALYTICS_VIEW).toContain(
      'tableColumnLabels .get(key) ?.get(row.groupValues[key] || "")',
    );
    // Label memos re-run when names land.
    expect(ANALYTICS_VIEW).toContain(
      "}, [topListData, groupByFields, props.serviceNameMap, entityNames]);",
    );
    expect(ANALYTICS_VIEW).toContain(
      "}, [tableData, props.serviceNameMap, entityNames]);",
    );
    expect(ANALYTICS_VIEW).toContain(
      "}, [timeseriesData, metric, props.serviceNameMap, entityNames]);",
    );
  });
});

describe("Insights tab", () => {
  test("a carried scope id without a Service row is named, not shown raw", () => {
    expect(count(TRACES_DASHBOARD, "useTelemetryEntityNames(")).toBe(1);
    expect(TRACES_DASHBOARD).not.toContain(
      "|| { value: serviceId, label: serviceId }",
    );
    expect(TRACES_DASHBOARD).toContain(
      "label: getTraceEntityOptionLabel({ id: serviceId, entityNames, }),",
    );
  });

  test("recent trace rows fall back to the resolved entity name", () => {
    expect(TRACES_DASHBOARD).toContain(
      'getTraceEntityOptionLabel({ id: primaryEntityId, knownLabel: service?.name?.toString(), entityNames, fallback: "Unknown", });',
    );
  });

  test("the Insights span fetch still filters by the selected ids", () => {
    expect(TRACES_DASHBOARD).toContain(
      "{ primaryEntityId: new Includes(selectedServiceIds) }",
    );
  });
});
