import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Source wiring for entity names in the exceptions explorer, the profiles
 * table and the profile page.
 *
 * The naming rules themselves are unit-tested in
 * ExceptionsEntityChipDisplay.test.ts and ProfilesEntityDisplay.test.ts, and
 * rendered in Common/Tests/App/Dashboard. What those cannot catch is a
 * component quietly going back to its own Service-only lookup — the exact
 * shape of the bug where a RUM application page locked a chip reading
 * "Service: 84858d6c-…". So the plumbing is pinned here.
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

const EXCEPTIONS_VIEWER: string = readSource(
  "Components",
  "Exceptions",
  "ExceptionsViewer.tsx",
);
const PROFILE_TABLE: string = readSource(
  "Components",
  "Profiles",
  "ProfileTable.tsx",
);
const PROFILE_VIEW: string = readSource(
  "Pages",
  "Profiles",
  "View",
  "Index.tsx",
);

type CountFunction = (source: string, needle: string) => number;

const count: CountFunction = (source: string, needle: string): number => {
  return source.split(needle).length - 1;
};

describe("ExceptionsViewer names every entity chip", () => {
  test("declares the scopeEntityType prop from the shared contract", () => {
    expect(EXCEPTIONS_VIEWER).toContain(
      "scopeEntityType?: ServiceType | undefined;",
    );
    expect(EXCEPTIONS_VIEWER).toContain(
      'import ServiceType from "Common/Types/Telemetry/ServiceType";',
    );
  });

  test("resolves names with ONE useTelemetryEntityNames call", () => {
    expect(EXCEPTIONS_VIEWER).toContain(
      'import useTelemetryEntityNames from "Common/UI/Utils/Telemetry/UseTelemetryEntityNames";',
    );
    expect(count(EXCEPTIONS_VIEWER, "useTelemetryEntityNames(")).toBe(1);
    expect(EXCEPTIONS_VIEWER).toContain(
      "useTelemetryEntityNames( entityChipIds, { typeHints: entityTypeHints }, )",
    );
  });

  test("the ids cover the page scope, the host's stored scope and the user's chips", () => {
    expect(EXCEPTIONS_VIEWER).toContain(
      "const scopeEntityId: string | undefined = props.primaryEntityId?.toString();",
    );
    expect(EXCEPTIONS_VIEWER).toContain(
      "[...hostScope.chips, ...activeFilters]",
    );
    expect(EXCEPTIONS_VIEWER).toContain(
      "collectExceptionEntityChipIds({ scopeEntityId, scopeEntityType: props.scopeEntityType, chips: entityChipRefs, knownIds: knownEntityChipIds, isKnownIdsPending: !areResourceListsLoaded, })",
    );
  });

  test("ids the chip's own facet already names are not sent to the resolver", () => {
    expect(EXCEPTIONS_VIEWER).toContain(
      "buildExceptionKnownChipIds({ facetConfigs, facetDisplayNames })",
    );
    // Known names must exist before the ids are collected from them.
    expect(
      EXCEPTIONS_VIEWER.indexOf("buildExceptionKnownChipIds({"),
    ).toBeLessThan(
      EXCEPTIONS_VIEWER.indexOf("collectExceptionEntityChipIds({"),
    );
    expect(
      EXCEPTIONS_VIEWER.indexOf(
        "buildExceptionFacetDisplayNames(mergedFacetData)",
      ),
    ).toBeLessThan(EXCEPTIONS_VIEWER.indexOf("buildExceptionKnownChipIds({"));
  });

  test("chip ids are held until the resource lists settle, even when they fail", () => {
    expect(EXCEPTIONS_VIEWER).toContain(
      "const [areResourceListsLoaded, setAreResourceListsLoaded] = useState<boolean>(false);",
    );
    expect(EXCEPTIONS_VIEWER).toMatch(
      /setKubernetesClusters\(clusterResult\.data \|\| \[\]\); \} catch \{ \} finally \{ setAreResourceListsLoaded\(true\); \}/,
    );
    const memoDeps: RegExpMatchArray | null = EXCEPTIONS_VIEWER.match(
      /isKnownIdsPending: !areResourceListsLoaded, \}\); \}, \[([^\]]*)\]\);/,
    );
    expect(memoDeps).not.toBeNull();
    for (const dep of [
      "scopeEntityId",
      "props.scopeEntityType",
      "entityChipRefs",
      "knownEntityChipIds",
      "areResourceListsLoaded",
    ]) {
      expect(memoDeps![1]!).toContain(dep);
    }
  });

  test("the page's scope type is passed as the resolver hint", () => {
    expect(EXCEPTIONS_VIEWER).toContain(
      "buildExceptionEntityTypeHints({ scopeEntityId, scopeEntityType: props.scopeEntityType, chips: entityChipRefs, })",
    );
  });

  test("every chip is re-derived through the shared display helper", () => {
    expect(EXCEPTIONS_VIEWER).toContain("return resolveExceptionChipDisplay({");
    expect(EXCEPTIONS_VIEWER).toContain(
      "facetDisplayNames: facetDisplayNames[chip.facetKey],",
    );
    expect(EXCEPTIONS_VIEWER).toContain(
      "scopeEntityType: props.scopeEntityType,",
    );
    expect(EXCEPTIONS_VIEWER).toContain(
      "buildExceptionFacetDisplayNames(mergedFacetData)",
    );
  });

  test("the chip labels update when names or facets land", () => {
    const memoDeps: RegExpMatchArray | null = EXCEPTIONS_VIEWER.match(
      /return \[\.\.\.base, \.\.\.activeFilters\.map\(resolveDisplay\)\]; \}, \[([^\]]*)\]\);/,
    );
    expect(memoDeps).not.toBeNull();
    const deps: string = memoDeps![1]!;
    for (const dep of [
      "props.primaryEntityId",
      "props.scopeEntityType",
      "hostScope",
      "activeFilters",
      "facetConfigs",
      "entityNames",
      "facetDisplayNames",
    ]) {
      expect(deps).toContain(dep);
    }
  });

  test("the old Service-title-only derivation is gone", () => {
    /*
     * `config?.title || chip.displayKey` for a primaryEntityId chip is what
     * forced "Service" onto a RUM application.
     */
    expect(EXCEPTIONS_VIEWER).not.toContain(
      ": config?.title || chip.displayKey || chip.facetKey; const displayValue: string = config?.valueDisplayMap?.[chip.value] ||",
    );
  });

  test("the facet include falls back to the server facet displayName", () => {
    expect(EXCEPTIONS_VIEWER).toContain(
      "getExceptionFacetIncludeDisplayValue({ value, config, facetValues: mergedFacetData[facetKey], })",
    );
    expect(EXCEPTIONS_VIEWER).toContain("[facetConfigs, mergedFacetData],");
  });

  test("filtering still uses the raw id", () => {
    expect(EXCEPTIONS_VIEWER).toContain(
      "q.primaryEntityId = props.primaryEntityId;",
    );
    expect(EXCEPTIONS_VIEWER).toContain(
      "histogramResourceIds.push(props.primaryEntityId.toString());",
    );
    expect(EXCEPTIONS_VIEWER).toContain(
      "facetResourceIds.push(props.primaryEntityId.toString());",
    );
    expect(EXCEPTIONS_VIEWER).toContain("return [f.facetKey, f.value];");
  });
});

describe("ProfileTable names every source", () => {
  test("the local, incomplete type-label switch is gone", () => {
    expect(PROFILE_TABLE).not.toContain("function getEntityTypeLabel");
    expect(PROFILE_TABLE).not.toContain("switch (entityType)");
    expect(PROFILE_TABLE).not.toContain('"Docker host"');
  });

  test("captures the loaded page's sources from the table's own fetch", () => {
    expect(PROFILE_TABLE).toContain(
      "onFetchSuccess={(profiles: Array<Profile>) => { handleProfilesFetched(profiles); }}",
    );
    expect(PROFILE_TABLE).toContain(
      "collectProfileEntityRefs({ profiles, knownIds: knownEntityIds, })",
    );
  });

  test("one type-hinted resolver call covers the cells and the deep-link chip", () => {
    expect(count(PROFILE_TABLE, "useTelemetryEntityNames(")).toBe(1);
    expect(PROFILE_TABLE).toContain(
      "useTelemetryEntityNames( entityIdsToResolve, { typeHints: entityTypeHints }, )",
    );
    expect(PROFILE_TABLE).toContain(
      "buildProfileEntityTypeHints(unnamedEntityRefs)",
    );
    expect(PROFILE_TABLE).toContain("ids.push(serviceIdFilter);");
  });

  test("the hook runs before the loading early-return (rules of hooks)", () => {
    const hookIndex: number = PROFILE_TABLE.indexOf("useTelemetryEntityNames(");
    const earlyReturn: number = PROFILE_TABLE.indexOf(
      "if (isPageLoading) { return <PageLoader",
    );
    expect(hookIndex).toBeGreaterThan(-1);
    expect(earlyReturn).toBeGreaterThan(-1);
    expect(hookIndex).toBeLessThan(earlyReturn);
  });

  test("the Source column uses the shared display helper", () => {
    expect(PROFILE_TABLE).toContain(
      "getProfileEntityDisplay({ entityId, entityType, nameMap: entityNames, })",
    );
    expect(PROFILE_TABLE).toContain(
      "<ServiceElement service={telemetryService} />",
    );
  });

  test("REGRESSION: the ?serviceId= chip is not an 8-character id prefix", () => {
    expect(PROFILE_TABLE).not.toContain(
      "`${serviceIdFilter.substring(0, 8)}…`",
    );
    expect(PROFILE_TABLE).toContain("getProfileServiceFilterChipDisplay({");
    expect(PROFILE_TABLE).toContain("{serviceFilterChip.key}");
    expect(PROFILE_TABLE).toContain("{serviceFilterChip.value}");
  });

  test("REGRESSION: the ?serviceId= chip can name a loaded Host, and only list-named ids skip the lookup", () => {
    // The chip is handed the loaded Host's name, not just the Service's.
    expect(
      count(PROFILE_TABLE, "hostName: serviceFilterListNames.hostName,"),
    ).toBe(2);
    expect(PROFILE_TABLE).toContain(
      "hostName: host ? host.name || host.hostIdentifier : undefined,",
    );
    /*
     * The lookup is skipped by asking the chip itself, not the broader
     * knownEntityIds set (which the chip could not always print from).
     */
    expect(PROFILE_TABLE).not.toContain(
      "serviceIdFilter && !knownEntityIds.has(serviceIdFilter)",
    );
    expect(PROFILE_TABLE).toContain(
      "if (serviceIdFilter && !isChipNamedByLists) { ids.push(serviceIdFilter); }",
    );
  });

  test("the deep link still filters by the raw id", () => {
    expect(PROFILE_TABLE).toContain(
      "baseQuery.primaryEntityId = new ObjectID(serviceIdFilter);",
    );
  });
});

describe("profile page summary card names its source", () => {
  test("the local type-label switch is gone", () => {
    expect(PROFILE_VIEW).not.toContain("function getEntityTypeLabel");
    expect(PROFILE_VIEW).not.toContain('return "Resource";');
  });

  test("resolves the entity with its type as a hint", () => {
    expect(count(PROFILE_VIEW, "useTelemetryEntityNames(")).toBe(1);
    expect(PROFILE_VIEW).toContain(
      "useTelemetryEntityNames( entityIds, { typeHints: entityTypeHints }, )",
    );
    expect(PROFILE_VIEW).toContain(
      "entityId && isKnownProfileEntityType(entityType) ? { [entityId]: entityType } : {}",
    );
  });

  test("REGRESSION: the card prints the name, keeping the id only as a fallback and tooltip", () => {
    expect(PROFILE_VIEW).not.toContain("{p.primaryEntityId.toString()}");
    expect(PROFILE_VIEW).toContain(
      "{source.isResolved ? source.primary : entityId}",
    );
    expect(PROFILE_VIEW).toContain("{source.typeLabel}");
    expect(PROFILE_VIEW).toContain("title={entityId}");
  });

  test("the baseline diff still scopes by the raw id", () => {
    expect(PROFILE_VIEW).toContain("? [new ObjectID(primaryEntityIdValue)]");
  });
});
