import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The metrics explorer's locked scope chip used to read "Service: <uuid>" on
 * a RUM application page: the scope id is a RumApplication id, and the chip
 * resolved it through the Service-only useServiceNames. The display rules
 * themselves are unit-tested in MetricsEntityChipDisplay.test.ts; this pins
 * that the viewer and the Insights page actually use them, and that the
 * query / URL / saved-view paths still carry ids.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

type ReadSourceFunction = (...relativeParts: Array<string>) => string;

const readSource: ReadSourceFunction = (
  ...relativeParts: Array<string>
): string => {
  return fs
    .readFileSync(path.join(DASHBOARD_SRC, ...relativeParts), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/.*$/gm, " ")
    .replace(/\s+/g, " ")
    .trim();
};

const METRICS_VIEWER: string = readSource(
  "Components",
  "Metrics",
  "MetricsViewer.tsx",
);
const METRICS_DASHBOARD: string = readSource(
  "Components",
  "Metrics",
  "MetricsDashboard.tsx",
);

describe("MetricsViewer props contract", () => {
  test("declares scopeEntityType and attributeFilterDisplayValues", () => {
    expect(METRICS_VIEWER).toContain(
      'import ServiceType from "Common/Types/Telemetry/ServiceType";',
    );
    expect(METRICS_VIEWER).toContain(
      "scopeEntityType?: ServiceType | undefined;",
    );
    expect(METRICS_VIEWER).toContain(
      "attributeFilterDisplayValues?: Record<string, string> | undefined;",
    );
    // The existing props are still there.
    expect(METRICS_VIEWER).toContain(
      "attributeFilterDisplayKeys?: Record<string, string> | undefined;",
    );
    expect(METRICS_VIEWER).toContain(
      "serviceIds?: Array<ObjectID> | undefined;",
    );
  });
});

describe("MetricsViewer resolves chip names through the generic entity resolver", () => {
  test("no longer resolves the scope chip through the Service-only hook", () => {
    expect(METRICS_VIEWER).not.toContain("useServiceNames");
    expect(METRICS_VIEWER).not.toContain("scopedServiceNameMap");
  });

  test("collects the scope ids with the page's scope type as hints, plus every chip", () => {
    expect(METRICS_VIEWER).toContain(
      'import useTelemetryEntityNames from "Common/UI/Utils/Telemetry/UseTelemetryEntityNames";',
    );
    expect(METRICS_VIEWER).toContain(
      "collectMetricsEntityLookup({ scopeIds: props.serviceIds, scopeEntityType: props.scopeEntityType, filters: activeFilters, })",
    );
    expect(METRICS_VIEWER).toContain(
      "[props.serviceIds, props.scopeEntityType, activeFilters]",
    );
  });

  test("issues exactly one lookup, with the type hints", () => {
    const calls: number = METRICS_VIEWER.split(
      "useTelemetryEntityNames(",
    ).length;
    // One import-free call site: split yields calls + 1 pieces.
    expect(calls - 1).toBe(1);
    expect(METRICS_VIEWER).toContain(
      "useTelemetryEntityNames( entityLookup.ids, { typeHints: entityLookup.typeHints }, )",
    );
  });

  test("builds the chip bar from the pure helper with the resolved names", () => {
    /*
     * Membership inside the call rather than its exact text: the entity-key
     * scope added two inputs here, and a call pinned verbatim reads every
     * such addition as this wiring having been undone.
     */
    const callStart: number = METRICS_VIEWER.indexOf(
      "buildMetricsActiveFilterChips({",
    );

    expect(callStart).toBeGreaterThanOrEqual(0);

    const call: string = METRICS_VIEWER.slice(
      callStart,
      METRICS_VIEWER.indexOf("})", callStart) + "})".length,
    );

    for (const argument of [
      "scopeIds: props.serviceIds,",
      "scopeEntityType: props.scopeEntityType,",
      "attributeFilters: props.attributeFilters,",
      "attributeFilterDisplayKeys: props.attributeFilterDisplayKeys,",
      "attributeFilterDisplayValues: props.attributeFilterDisplayValues,",
      "entityScope: props.entityScope,",
      "activeFilters,",
      "facetConfigs,",
      "nameMap: entityNameMap,",
    ]) {
      expect(call).toContain(argument);
    }
    // Every input is a memo dependency, so a late name re-renders the chip.
    for (const dependency of [
      "props.scopeEntityType,",
      "props.attributeFilterDisplayValues,",
      "props.entityScope,",
      "entityNameMap,",
    ]) {
      expect(METRICS_VIEWER).toContain(dependency);
    }
  });

  test("the scope chip no longer hard-codes a Service key or a raw id value", () => {
    expect(METRICS_VIEWER).not.toContain('displayKey: "Service"');
    expect(METRICS_VIEWER).not.toContain(
      "displayValue: primaryEntityId.toString()",
    );
    // Locked attribute chips go through the helper that honours the overrides.
    expect(METRICS_VIEWER).not.toContain("displayValue: value, readOnly: true");
  });

  test("a facet include keeps the server's display name as a fallback", () => {
    expect(METRICS_VIEWER).toContain(
      "buildMetricsIncludedFacetChip({ facetKey, value, facetConfigs, facetData, })",
    );
    expect(METRICS_VIEWER).toContain("[facetConfigs, facetData]");
  });
});

describe("MetricsViewer offers no resource facets it cannot apply", () => {
  test("the facets request asks for Services only", () => {
    expect(METRICS_VIEWER).toContain('facetKeys: ["primaryEntityId"],');
    expect(METRICS_VIEWER).not.toContain("RESOURCE_FACET_CATALOG_KEYS");
    expect(METRICS_VIEWER).not.toContain("buildResourceFacetConfigs");
  });

  test("the one Service facet carries the same icon as the other explorers", () => {
    expect(METRICS_VIEWER).toContain(
      'key: "primaryEntityId", title: "Service", icon: IconProp.SquareStack, valueDisplayMap: serviceNameMap, valueColorMap: serviceColorMap, priority: 1, serverSearchable: true, },',
    );
    expect(METRICS_VIEWER).not.toContain('key: "hostId"');
    expect(METRICS_VIEWER).not.toContain("hideWhenEmpty");
  });
});

describe("MetricsViewer filtering still uses ids", () => {
  test("the metric list query is built from the chip value, not its display", () => {
    /*
     * Both polymorphic keys (primaryEntityId and its serviceId alias) go
     * through the shared helper, so a serviceId chip the bar labels as a
     * filter actually filters the list.
     */
    expect(METRICS_VIEWER).toContain(
      "const facetServiceIds: Array<ObjectID> = getMetricsAppliedEntityFilterIds( activeFilters, ).map((id: string): ObjectID => { return new ObjectID(id); });",
    );
    expect(METRICS_VIEWER).not.toContain(
      'if (filter.facetKey === "primaryEntityId") {',
    );
    expect(METRICS_VIEWER).toContain(
      "const mergedServiceIds: Array<ObjectID> = [ ...propServiceIds, ...facetServiceIds, ];",
    );
    expect(METRICS_VIEWER).toContain(
      '(query as Record<string, unknown>)["services"] = new Includes( mergedServiceIds, );',
    );
  });

  test("URL state and saved views store facetKey / value tuples only", () => {
    expect(METRICS_VIEWER).toContain("return [f.facetKey, f.value];");
    expect(METRICS_VIEWER).toContain(
      "filters: activeFilters.map((filter: ActiveFilter): [string, string] => { return [filter.facetKey, filter.value]; }),",
    );
  });
});

describe("MetricsDashboard scope dropdown names carried entities", () => {
  test("resolves selected ids through the generic resolver", () => {
    expect(METRICS_DASHBOARD).toContain(
      'import useTelemetryEntityNames from "Common/UI/Utils/Telemetry/UseTelemetryEntityNames";',
    );
    expect(METRICS_DASHBOARD).toContain(
      "useTelemetryEntityNames( unnamedSelectedServiceIds, )",
    );
  });

  test("only looks up UUID selections the service list does not already name", () => {
    expect(METRICS_DASHBOARD).not.toContain(
      "useTelemetryEntityNames(selectedServiceIds)",
    );
    expect(METRICS_DASHBOARD).toContain(
      "const unnamedSelectedServiceIds: Array<string> = useMemo(() => { return getMetricsUnnamedScopeIds({ selectedIds: selectedServiceIds, knownIds: serviceOptions.map((option: DropdownOption): string => { return option.value.toString(); }), }); }, [selectedServiceIds, serviceOptions]);",
    );
    // Exactly one lookup on the page.
    expect(METRICS_DASHBOARD.split("useTelemetryEntityNames(").length - 1).toBe(
      1,
    );
  });

  test("the fallback pill label is the resolved name, not the raw id", () => {
    expect(METRICS_DASHBOARD).not.toContain(
      "{ value: serviceId, label: serviceId }",
    );
    expect(METRICS_DASHBOARD).toContain(
      "label: getMetricsScopeFallbackLabel({ id: serviceId, nameMap: selectedEntityNames, }),",
    );
    expect(METRICS_DASHBOARD).toContain(
      "[selectedServiceIds, serviceOptions, selectedEntityNames]",
    );
  });

  test("the scope query still filters by the selected ids", () => {
    expect(METRICS_DASHBOARD).toContain(
      "primaryEntityId: new Includes(selectedServiceIds)",
    );
  });
});
