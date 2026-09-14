import { describe, expect, test } from "@jest/globals";
import { RESOURCE_FACET_CATALOG_KEYS } from "Common/Types/Telemetry/ResourceFacetCatalog";
import fs from "fs";
import path from "path";

/*
 * Wiring for "we only have some resources added to the list": the Logs
 * explorer asked the server for Host / Docker / Podman / Kubernetes facets
 * from a literal list inside the viewer, labelled their chips from a second
 * literal table and hinted the name resolver from a third. The behaviour now
 * lives in React-free helpers derived from the shared resource facet catalog
 * (LogsFacetFilters, LogsResourceDisplay, LogsEntityNames), each with its own
 * tests; these assertions pin that the viewer and the Insights page actually
 * route through them, and that no hand-kept per-resource copy creeps back.
 *
 * Sources are compared with comments and ALL whitespace removed (and
 * trailing commas before a closing bracket dropped), so a reformat does not
 * break a test while a real change to the wiring does.
 */

const APP_ROOT: string = path.join(__dirname, "..", "..");
const DASHBOARD_SRC: string = path.join(
  APP_ROOT,
  "FeatureSet",
  "Dashboard",
  "src",
);
const COMMON_ROOT: string = path.join(APP_ROOT, "..", "Common");

type CompactFunction = (source: string) => string;

const compact: CompactFunction = (source: string): string => {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\s+/g, "")
    .replace(/,([)\]}])/g, "$1");
};

type ReadCompactFunction = (...absoluteParts: Array<string>) => string;

const readCompact: ReadCompactFunction = (
  ...absoluteParts: Array<string>
): string => {
  return compact(fs.readFileSync(path.join(...absoluteParts), "utf8"));
};

const LOGS_VIEWER: string = readCompact(
  DASHBOARD_SRC,
  "Components",
  "Logs",
  "LogsViewer.tsx",
);
const LOGS_FACET_FILTERS: string = readCompact(
  DASHBOARD_SRC,
  "Components",
  "Logs",
  "LogsFacetFilters.ts",
);
const LOGS_RESOURCE_DISPLAY: string = readCompact(
  DASHBOARD_SRC,
  "Components",
  "Logs",
  "LogsResourceDisplay.ts",
);
const LOGS_DASHBOARD: string = readCompact(
  DASHBOARD_SRC,
  "Components",
  "Logs",
  "LogsDashboard.tsx",
);
const LOGS_INSIGHTS: string = readCompact(
  DASHBOARD_SRC,
  "Utils",
  "LogsInsights.ts",
);
const LOGS_ENTITY_NAMES: string = readCompact(
  COMMON_ROOT,
  "UI",
  "Components",
  "LogsViewer",
  "LogsEntityNames.ts",
);

type CountFunction = (haystack: string, needle: string) => number;

const count: CountFunction = (haystack: string, needle: string): number => {
  return haystack.split(needle).length - 1;
};

const catalogKeys: Array<[string]> = RESOURCE_FACET_CATALOG_KEYS.map(
  (facetKey: string): [string] => {
    return [facetKey];
  },
);

describe("Dashboard LogsViewer facet request", () => {
  test("imports the facet helpers from LogsFacetFilters", () => {
    expect(LOGS_VIEWER).toContain(
      'import{LOGS_EXPLORER_FACET_KEYS,buildLogsFacetFiltersFromQuery,getLogsFacetChipDisplayKey,getLogsQueryValues}from"./LogsFacetFilters";',
    );
  });

  test("asks /telemetry/logs/facets for the catalog-derived key list", () => {
    expect(LOGS_VIEWER).toContain("facetKeys:[...LOGS_EXPLORER_FACET_KEYS]");
    expect(count(LOGS_VIEWER, '"/telemetry/logs/facets"')).toBe(1);
  });

  test("the key list is severity, Service and the whole catalog", () => {
    expect(LOGS_FACET_FILTERS).toContain(
      'LOGS_EXPLORER_FACET_KEYS:ReadonlyArray<string>=["severityText","primaryEntityId",...RESOURCE_FACET_CATALOG_KEYS];',
    );
  });

  test.each(catalogKeys)(
    "the viewer holds no hand-kept %s literal",
    (facetKey: string) => {
      /*
       * Any quoted key or `key:` entry would be a per-resource copy the
       * catalog no longer feeds.
       */
      expect(LOGS_VIEWER).not.toContain(`"${facetKey}"`);
      expect(LOGS_VIEWER).not.toContain(`${facetKey}:"`);
      expect(LOGS_FACET_FILTERS).not.toContain(`"${facetKey}"`);
      expect(LOGS_FACET_FILTERS).not.toContain(`${facetKey}:"`);
    },
  );
});

describe("Dashboard LogsViewer chips", () => {
  test("every chip's key is labelled through getLogsFacetChipDisplayKey", () => {
    expect(LOGS_VIEWER).toContain(
      "constdisplayKey:string=getLogsFacetChipDisplayKey(facetKey);",
    );
    expect(LOGS_VIEWER).not.toContain("facetKeyDisplayNames");
  });

  test("resource chip labels come from the catalog", () => {
    expect(LOGS_FACET_FILTERS).toContain("...getResourceFacetLabelMap()");
  });

  test("a saved view's chips are read back through the shared helper", () => {
    expect(LOGS_VIEWER).toContain(
      "buildLogsFacetFiltersFromQuery(mergedQuery,baseQuery)",
    );
    expect(LOGS_VIEWER).not.toContain("functionbuildFacetFiltersFromQuery(");
    expect(LOGS_VIEWER).not.toContain("functiongetQueryValues(");
    expect(LOGS_VIEWER).toContain(
      'getLogsQueryValues((props.logQueryasany)["entityKeys"])',
    );
  });

  test("resource chips are restored from resourceFilters", () => {
    expect(LOGS_FACET_FILTERS).toContain(
      'parseResourceEntityFacetSelections((queryasany)["resourceFilters"])',
    );
  });
});

describe("resource type hints and scope picker", () => {
  test("the Insights scope picker hints every catalog type from the catalog", () => {
    expect(LOGS_RESOURCE_DISPLAY).toContain(
      "=Object.fromEntries(getResourceFacetServiceTypeMap());",
    );
    expect(LOGS_RESOURCE_DISPLAY).not.toContain("hostId:ServiceType.Host");
  });

  test("the shared logs viewer hints every catalog type from the catalog", () => {
    expect(LOGS_ENTITY_NAMES).toContain(
      "LOGS_RESOURCE_FACET_ENTITY_TYPES:Record<string,ServiceType>=Object.fromEntries(getResourceFacetServiceTypeMap());",
    );
    expect(LOGS_ENTITY_NAMES).not.toContain("hostId:ServiceType.Host");
    expect(LOGS_ENTITY_NAMES).not.toContain('hostId:"Host"');
  });

  test("scope picker group titles are derived from the catalog's plural labels", () => {
    expect(LOGS_INSIGHTS).toContain(
      "toInsightsScopeGroupLabel(definition.pluralLabel)",
    );
    expect(LOGS_INSIGHTS).not.toContain('hostId:"Hosts"');
  });

  test("the Insights page still skips a resource group with nothing in it", () => {
    expect(LOGS_DASHBOARD).toContain(
      "for(constfacetKeyofINSIGHTS_SCOPE_FACET_KEYS){constvalues:Array<ScopeFacetValue>=scopeFacets[facetKey]||[];if(values.length===0){continue;}",
    );
    expect(LOGS_DASHBOARD).toContain(
      "label:INSIGHTS_SCOPE_FACET_LABELS[facetKey]||facetKey",
    );
  });
});
