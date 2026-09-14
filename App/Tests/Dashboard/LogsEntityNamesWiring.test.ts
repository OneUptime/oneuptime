import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Wiring for "why does the RUM logs tab show the service id as a locked
 * filter?". The display logic lives in React-free helpers with their own
 * tests (LogsEntityChipDisplay, LogsResourceDisplay,
 * LogsAttributeFilterChips); these assertions pin that the logs viewer, the
 * Logs Insights page and the error-pattern drawer actually route their
 * chips and labels through them — and that queries still filter on ids.
 *
 * Sources are compared with comments and ALL whitespace removed (and
 * trailing commas before a closing bracket dropped), so a reformat does not
 * break a test while a real change to the wiring does.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

type CompactFunction = (source: string) => string;

const compact: CompactFunction = (source: string): string => {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\s+/g, "")
    .replace(/,([)\]}])/g, "$1");
};

type ReadCompactFunction = (...relativeParts: Array<string>) => string;

const readCompact: ReadCompactFunction = (
  ...relativeParts: Array<string>
): string => {
  return compact(
    fs.readFileSync(path.join(DASHBOARD_SRC, ...relativeParts), "utf8"),
  );
};

type CountFunction = (haystack: string, needle: string) => number;

const count: CountFunction = (haystack: string, needle: string): number => {
  return haystack.split(needle).length - 1;
};

const LOGS_VIEWER: string = readCompact("Components", "Logs", "LogsViewer.tsx");
const ERROR_PATTERN_DETAIL: string = readCompact(
  "Components",
  "Logs",
  "ErrorPatternDetail.tsx",
);
const LOGS_DASHBOARD: string = readCompact(
  "Components",
  "Logs",
  "LogsDashboard.tsx",
);
const TOP_ERRORS_PANEL: string = readCompact(
  "Components",
  "Logs",
  "TopErrorsPanel.tsx",
);
const SPAN_VIEWER: string = readCompact("Components", "Span", "SpanViewer.tsx");

type ObjectLiteralAfterFunction = (source: string, marker: string) => string;

/*
 * The `{...}` object literal that starts at the first "{" after `marker`
 * (brace-balanced), so a select can be pinned without depending on the
 * order of its keys.
 */
const objectLiteralAfter: ObjectLiteralAfterFunction = (
  source: string,
  marker: string,
): string => {
  const markerAt: number = source.indexOf(marker);

  if (markerAt < 0) {
    return "";
  }

  const start: number = source.indexOf("{", markerAt + marker.length);
  let depth: number = 0;

  for (let i: number = start; i < source.length; i++) {
    if (source[i] === "{") {
      depth++;
    } else if (source[i] === "}") {
      depth--;

      if (depth === 0) {
        return source.substring(start, i + 1);
      }
    }
  }

  return "";
};

describe("DashboardLogsViewer props contract", () => {
  test("declares scopeEntityType and the attribute chip display overrides", () => {
    expect(LOGS_VIEWER).toContain("scopeEntityType?:ServiceType|undefined;");
    expect(LOGS_VIEWER).toContain(
      "attributeFilterDisplayKeys?:Record<string,string>|undefined;",
    );
    expect(LOGS_VIEWER).toContain(
      "attributeFilterDisplayValues?:Record<string,string>|undefined;",
    );
  });
});

describe("DashboardLogsViewer entity chips", () => {
  test("no longer names chips from the Service table only", () => {
    expect(LOGS_VIEWER).not.toContain("useServiceNames");
    expect(LOGS_VIEWER).not.toContain("scopedServiceNameMap");
    // The old hard-coded key that made a RUM application read "Service".
    expect(LOGS_VIEWER).not.toContain('displayKey:"Service"');
  });

  test("resolves every entity chip id with ONE generic lookup, hinted by the page's type", () => {
    expect(count(LOGS_VIEWER, "useTelemetryEntityNames(")).toBe(1);
    expect(LOGS_VIEWER).toContain(
      "useTelemetryEntityNames(entityChipIds,{typeHints:entityTypeHints})",
    );
    expect(LOGS_VIEWER).toContain(
      "collectLogsEntityIds({scopeIds:props.serviceIds,appliedFacetFilters})",
    );
    expect(LOGS_VIEWER).toContain(
      "buildLogsEntityTypeHints(props.serviceIds,props.scopeEntityType)",
    );
    expect(LOGS_VIEWER).toContain(
      "},[props.serviceIds,props.scopeEntityType]);",
    );
  });

  test("the locked scope chip is built from the resolved name and the page's type", () => {
    expect(LOGS_VIEWER).toContain(
      "buildLogsScopeEntityChips({scopeIds:props.serviceIds,nameMap:entityNameMap,scopeEntityType:props.scopeEntityType})",
    );
  });

  test("the locked attribute chips receive the page's display overrides", () => {
    expect(LOGS_VIEWER).toContain(
      "buildAttributeFilterChips(logQueryAttributes,{displayKeys:props.attributeFilterDisplayKeys,displayValues:props.attributeFilterDisplayValues})",
    );
  });

  test("the base chips re-render when a name lands or the overrides change", () => {
    const baseMemo: string =
      LOGS_VIEWER.split("constbaseActiveFilters:Array<ActiveFilter>=")[1] || "";
    /*
     * Only the dependency array, not the memo body that also names these.
     * Located from the memo's closing `]);` backwards to the `},[` that opens
     * the array, so the body's last statement can change (it used to be
     * `return filters;`, now the chips are decorated on the way out) without
     * this test claiming the dependencies vanished.
     */
    const memoEnd: number = baseMemo.indexOf("]);");
    const depsStart: number = baseMemo.lastIndexOf("},[", memoEnd);
    const deps: string =
      memoEnd > 0 && depsStart >= 0
        ? baseMemo.slice(depsStart + "},[".length, memoEnd)
        : "";

    expect(deps).not.toBe("");

    expect(deps).toContain("entityNameMap");
    expect(deps).toContain("props.scopeEntityType");
    expect(deps).toContain("props.attributeFilterDisplayKeys");
    expect(deps).toContain("props.attributeFilterDisplayValues");
  });

  test("user, URL and saved-view entity chips are named before they reach the shared viewer", () => {
    expect(LOGS_VIEWER).toContain(
      "returnapplyLogsEntityChipDisplay(filters,{nameMap:entityNameMap,scopeIds:props.serviceIds,scopeEntityType:props.scopeEntityType,knownNames:entityFacetDisplayNames})",
    );
    expect(LOGS_VIEWER).toContain(
      'buildFacetDisplayNames(facetData["primaryEntityId"])',
    );

    const activeMemo: string =
      LOGS_VIEWER.split("constactiveFilters:Array<ActiveFilter>=")[1] || "";
    const deps: string =
      activeMemo
        .split("knownNames:entityFacetDisplayNames});},[")[1]
        ?.split("]);")[0] || "";

    expect(deps).not.toBe("");
    expect(deps).toContain("appliedFacetFilters");

    expect(deps).toContain("entityNameMap");
    expect(deps).toContain("entityFacetDisplayNames");
    expect(deps).toContain("props.scopeEntityType");
  });

  test("the chips are handed to the shared viewer", () => {
    expect(LOGS_VIEWER).toContain("activeFilters={activeFilters}");
    expect(LOGS_VIEWER).toContain("baseActiveFilters={baseActiveFilters}");
  });

  test("filtering is untouched: the list query still scopes by id", () => {
    expect(LOGS_VIEWER).toContain(
      "query.primaryEntityId=newIncludes(props.serviceIds);",
    );
  });
});

describe("ErrorPatternDetail resource labels", () => {
  test("resolves unnamed resources against their own tables, hinted by the reported type", () => {
    expect(ERROR_PATTERN_DETAIL).toContain(
      "useTelemetryEntityNames(unnamedResourceIds,{typeHints:resourceTypeHints})",
    );
    expect(ERROR_PATTERN_DETAIL).toContain(
      "buildLogsResourceTypeHints(resourceRefs)",
    );
    expect(ERROR_PATTERN_DETAIL).toContain(
      "collectLogsResourceIds(resourceRefs,(resourceId:string)=>{returnBoolean(props.serviceNameById.get(resourceId)?.name);})",
    );
  });

  test("the loaded Service name keeps precedence; the resolver is the fallback", () => {
    expect(ERROR_PATTERN_DETAIL).toContain(
      "describeLogsResource({resourceId,resourceType:resourceTypeById.get(resourceId),nameMap:resourceNames,knownName:props.serviceNameById.get(resourceId)?.name?.toString()})",
    );
  });

  test("shows the type label, not the raw ServiceType string", () => {
    expect(ERROR_PATTERN_DETAIL).not.toContain("{resource.resourceType}");
    expect(ERROR_PATTERN_DETAIL).toContain("{display.typeLabel}");
    expect(ERROR_PATTERN_DETAIL).toContain("{display.name}");
  });

  test("findings, the AI prompt and sample lines use the same resolved label", () => {
    expect(ERROR_PATTERN_DETAIL).toContain(
      "returndescribeResource(resourceId).name;",
    );
    expect(ERROR_PATTERN_DETAIL).toContain("events,resourceLabel}");
    expect(ERROR_PATTERN_DETAIL).toContain(
      "<span>{resourceLabel(sample.resourceId)}</span>",
    );
  });
});

describe("LogsDashboard resource names", () => {
  test("one generic lookup for the ids its Service list cannot name", () => {
    expect(count(LOGS_DASHBOARD, "useTelemetryEntityNames(")).toBe(1);
    expect(LOGS_DASHBOARD).toContain(
      "useTelemetryEntityNames(unnamedResourceIds,{typeHints:resourceTypeHints})",
    );
    expect(LOGS_DASHBOARD).toContain("collectLogsInsightsResourceRefs({");
    expect(LOGS_DASHBOARD).toContain(
      "returnBoolean(serviceById.get(resourceId)?.name);",
    );
  });

  test("the scope picker never falls back to the raw id half of its value", () => {
    expect(LOGS_DASHBOARD).not.toContain('value.split(":")[1]');
    expect(count(LOGS_DASHBOARD, "labelLogsScopeOption({")).toBe(2);
    expect(LOGS_DASHBOARD).toContain(
      "labelLogsScopeOption({id:value.value,nameMap:resourceNames,knownName:serviceById.get(value.value)?.name?.toString(),facetDisplayName:value.displayName})",
    );
  });

  test("a non-Service card is named (with its type) before falling back to the id", () => {
    expect(LOGS_DASHBOARD).toContain(
      "describeLogsResource({resourceId:row.resourceId,nameMap:resourceNames})",
    );
    expect(LOGS_DASHBOARD).toContain("{resourceDisplay.name}");
    expect(LOGS_DASHBOARD).toContain("{resourceDisplay.typeLabel}");
    expect(LOGS_DASHBOARD).toContain("resourceDisplay.name!==row.resourceId?");
  });
});

/*
 * "Top errors" labelled each pattern's sources from the Service list only,
 * so a RUM application / host / cluster read as a raw UUID in the row while
 * the drawer it opened named it.
 */
describe("LogsDashboard Top errors resource names", () => {
  test("the displayed pattern ids join the page's one lookup, and re-collect when patterns land", () => {
    expect(LOGS_DASHBOARD).toContain(
      "errorPatterns,scopeFacets,selectedScopeValues});},[resourceBreakdown,errorPatterns,scopeFacets,selectedScopeValues]);",
    );
  });

  test("the page hands its resolved names to the panel", () => {
    const panelJsx: string =
      LOGS_DASHBOARD.split("<TopErrorsPanel")[1]?.split("/>")[0] || "";

    expect(panelJsx).not.toBe("");
    expect(panelJsx).toContain("resourceNames={resourceNames}");
    expect(panelJsx).toContain("serviceNameById={serviceById}");
    // Selecting a row still hands over the row itself, ids intact.
    expect(panelJsx).toContain("setSelectedPattern(row);");
  });

  test("the panel accepts the names and labels rows through the shared helper", () => {
    expect(TOP_ERRORS_PANEL).toContain(
      "resourceNames?:TelemetryEntityNameMap|undefined;",
    );
    expect(TOP_ERRORS_PANEL).toContain(
      "labelErrorPatternResources({resourceIds:row.resourceIds,nameMap:props.resourceNames,getKnownName:(resourceId:string):string|undefined=>{returnprops.serviceNameById.get(resourceId)?.name?.toString();}})",
    );
    expect(TOP_ERRORS_PANEL).toContain('`·${resourceNames.join(",")}`');
  });

  test("the Service-list-or-raw-id label and a second, drifting slice are gone", () => {
    expect(TOP_ERRORS_PANEL).not.toContain(
      "props.serviceNameById.get(resourceId)?.name?.toString()||resourceId",
    );
    expect(TOP_ERRORS_PANEL).not.toContain("resourceNames.slice(");
  });

  test("the row still selects with its own pattern (ids untouched)", () => {
    expect(TOP_ERRORS_PANEL).toContain("props.onSelect(row);");
  });
});

/*
 * primaryEntityId is polymorphic; the shared viewer hints the name lookup
 * with each row's primaryEntityType, which only works if the row was
 * fetched with it.
 */
describe("log list selects carry the row's entity type", () => {
  test("DashboardLogsViewer's list select", () => {
    const select: string = objectLiteralAfter(
      LOGS_VIEWER,
      "constselect:Select<Log>=useMemo(()=>{return",
    );

    expect(select).not.toBe("");
    expect(select).toContain("primaryEntityId:true");
    expect(select).toContain("primaryEntityType:true");
    expect(LOGS_VIEWER).toContain("select:select,");
  });

  test("SpanViewer's selectLog", () => {
    const select: string = objectLiteralAfter(
      SPAN_VIEWER,
      "constselectLog:Select<Log>=",
    );

    expect(select).not.toBe("");
    expect(select).toContain("primaryEntityId:true");
    expect(select).toContain("primaryEntityType:true");
    expect(SPAN_VIEWER).toContain("select:selectLog,");
  });
});

describe("the new display helpers stay React-free", () => {
  test.each([
    "LogsEntityChipDisplay.ts",
    "LogsResourceDisplay.ts",
    "LogsAttributeFilterChips.ts",
  ])("%p imports no React", (fileName: string) => {
    const source: string = fs.readFileSync(
      path.join(DASHBOARD_SRC, "Components", "Logs", fileName),
      "utf8",
    );

    expect(source).not.toMatch(/from\s+["']react["']/);
    expect(source).not.toContain("UseTelemetryEntityNames");
  });
});
