import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * A Cloud Environment is one row per cloud.platform + cloud.account.id +
 * cloud.region, matched by ingest on that composite key. The dashboard used
 * to contradict that in three places at once: the create form asked for a
 * "resource identifier" that "should match service.name" (so nothing typed
 * there could ever be matched), the telemetry tabs spread an empty attribute
 * filter for a platform-less environment (so a fresh one showed the whole
 * project's logs as its own), and Owners had rules but no page.
 *
 * The App suite runs in plain Node with no renderer and App/tsconfig.json
 * excludes FeatureSet/Dashboard, so these pin the JSX wiring by reading the
 * sources, the way EmptyResourceInventoryPages.test.ts does. Whitespace is
 * squashed and comments stripped so Prettier reflows and rationale comments
 * cannot make a test pass or fail.
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

const LIST_PAGE: string = "Pages/Cloud/CloudResources.tsx";
const SCOPE_UTIL: string = "Pages/Cloud/Utils/CloudResourceTelemetryScope.ts";
const SCOPE_IMPORT: string = 'from "../Utils/CloudResourceTelemetryScope"';
const BANNER_TAG: string = "<CloudResourceConnectBanner";

describe("Cloud Environments create form", () => {
  const code: string = readCode(LIST_PAGE);
  const formFields: string = between(code, "formFields={[", "filters={[");

  test("no longer asks for a resource identifier", () => {
    /*
     * The key is derived, never typed. A typed one could not match ingest's
     * "platform|account|region" and would leave the environment orphaned.
     */
    expect(formFields).not.toContain("resourceIdentifier");
    expect(code).not.toContain("service.name");
    expect(code).not.toContain("checkout-service");
  });

  test("picks the platform from the shared managed-platform catalogue", () => {
    expect(code).toContain('from "Common/Types/Cloud/CloudPlatform"');
    expect(code).toContain("MANAGED_CLOUD_PLATFORMS.map(");

    const platformField: string = between(
      formFields,
      "field: { cloudPlatform: true, }",
      "field: { cloudAccountId: true, }",
    );

    expect(platformField).toContain("fieldType: FormFieldSchemaType.Dropdown");
    expect(platformField).toContain(
      "dropdownOptions: PLATFORM_DROPDOWN_OPTIONS",
    );
    expect(platformField).toContain("required: true");
  });

  test("collects account id and region as optional text", () => {
    const accountField: string = between(
      formFields,
      "field: { cloudAccountId: true, }",
      "field: { cloudRegion: true, }",
    );
    const regionField: string = between(
      formFields,
      "field: { cloudRegion: true, }",
      "field: { name: true, }",
    );

    expect(accountField).toContain("fieldType: FormFieldSchemaType.Text");
    expect(accountField).toContain("required: false");
    expect(accountField).toContain("cloud.account.id");
    expect(regionField).toContain("fieldType: FormFieldSchemaType.Text");
    expect(regionField).toContain("required: false");
    expect(regionField).toContain("us-east-1");
  });

  test("keeps the name required and suggests the auto-discovery form", () => {
    const nameField: string = between(
      formFields,
      "field: { name: true, }",
      "field: { description: true, }",
    );

    expect(nameField).toContain("required: true");
    expect(nameField).toContain("platform · region · account");
  });

  test("derives key, provider and default name in onBeforeCreate", () => {
    const hook: string = between(code, "onBeforeCreate={", "onCreateSuccess={");

    expect(hook).toContain("buildCloudEnvironmentKey(");
    expect(hook).toContain(
      "item.resourceIdentifier = buildCloudEnvironmentKey(",
    );
    expect(hook).toContain("getCloudProviderForPlatform(platform)");
    expect(hook).toContain("buildCloudEnvironmentName(");
  });

  test("shows friendly platform and provider labels and filters by platform", () => {
    expect(code).toContain("getManagedCloudPlatformLabel(platform)");
    expect(code).toContain('title: "Provider"');
    expect(code).toContain("getCloudProviderLabel(");

    const filters: string = between(code, "filters={[", "columns={[");
    const platformFilter: string = between(
      filters,
      "field: { cloudPlatform: true, }",
      "field: { cloudProvider: true, }",
    );

    expect(platformFilter).toContain("type: FieldType.Dropdown");
    expect(platformFilter).toContain(
      "filterDropdownOptions: PLATFORM_DROPDOWN_OPTIONS",
    );
  });

  test("renders the cloud documentation card and the fleet summary", () => {
    expect(code).toContain(
      'from "../../Components/Cloud/CloudDocumentationCard"',
    );
    expect(code).toContain("<CloudDocumentationCard");
    expect(code).not.toContain("getCloudDocMarkdown");
    expect(code).not.toContain("<ResourceDocumentationCard");

    expect(code).toContain('from "../../Components/Cloud/CloudFleetSummary"');
    expect(code.indexOf("<CloudFleetSummary")).toBeGreaterThan(-1);
    expect(code.indexOf("<CloudFleetSummary")).toBeLessThan(
      code.indexOf("<ModelTable<CloudResource>"),
    );
  });
});

describe("Cloud Environment telemetry scope", () => {
  test("the live window constant mirrors the sweeper's 15 minutes", () => {
    const util: string = readCode(SCOPE_UTIL);

    expect(util).toContain(
      "export const CLOUD_INSTANCE_LIVE_WINDOW_MINUTES: number = 15;",
    );
    expect(util).toContain("export function isCloudResourceScoped(");
    expect(util).toContain("export function getCloudResourceAttributeFilters(");
    expect(util).toContain(
      "export function getCloudResourceAttributeDisplayKeys(",
    );
  });

  test.each(["Logs", "Traces", "Metrics"])(
    "%s tab scopes through the helper and never renders unfiltered",
    (tab: string) => {
      const code: string = readCode(`Pages/Cloud/View/${tab}.tsx`);

      expect(code).toContain(SCOPE_IMPORT);
      expect(code).toContain("isCloudResourceScoped");
      expect(code).toContain("getCloudResourceAttributeFilters(");
      expect(code).toContain(
        'from "../../../Components/Cloud/CloudResourceConnectBanner"',
      );

      // The guard must come before the viewer, not after it.
      const guard: number = code.indexOf("if (!isCloudResourceScoped(");
      const banner: number = code.indexOf(BANNER_TAG);

      expect(guard).toBeGreaterThan(-1);
      expect(banner).toBeGreaterThan(guard);

      // No page builds the attribute filter by hand any more.
      expect(code).not.toContain('"resource.cloud.platform"');
      expect(code).not.toContain('"resource.cloud.account.id"');
      expect(code).not.toContain('"resource.cloud.region"');
    },
  );

  test("Traces and Metrics also hand the viewer display keys from the helper", () => {
    for (const tab of ["Traces", "Metrics"]) {
      const code: string = readCode(`Pages/Cloud/View/${tab}.tsx`);

      expect(code).toContain("getCloudResourceAttributeDisplayKeys(");
    }
  });

  test("the banner links to the environment's documentation page", () => {
    const code: string = readCode(
      "Components/Cloud/CloudResourceConnectBanner.tsx",
    );

    expect(code).toContain("PageMap.CLOUD_RESOURCE_VIEW_DOCUMENTATION");
    expect(code).toContain("Waiting for telemetry");
  });
});

describe("Cloud Environment overview", () => {
  const code: string = readCode("Pages/Cloud/View/Overview.tsx");

  test("scopes span and metric fetches through the helper", () => {
    expect(code).toContain(SCOPE_IMPORT);
    expect(code).toContain("getCloudResourceAttributeFilters(item)");

    /*
     * The scope guard has to sit inside the metrics effect, ahead of the
     * fetch, so an unscoped environment issues no query at all.
     */
    const effect: string = between(
      code,
      "if (!isCloudResourceScoped(item))",
      "fetchSpanMetrics(",
    );

    expect(effect).toContain("setMetricsLoading(false)");
    expect(effect).toContain("return;");
  });

  test("shows the connect banner above the overview when unscoped", () => {
    expect(code).toContain(BANNER_TAG);
    // "<ResourceOverview " with the space: Array<ResourceOverviewTile> also starts that way.
    expect(code.indexOf(BANNER_TAG)).toBeLessThan(
      code.indexOf("<ResourceOverview icon="),
    );
  });

  test("counts only instances inside the live window", () => {
    expect(code).toContain("CLOUD_INSTANCE_LIVE_WINDOW_MINUTES");
    expect(code).toContain("isCloudInstanceLive(i.lastSeenAt, now)");

    const tile: string = between(
      code,
      'title: "Instances"',
      'title: "Requests"',
    );

    expect(tile).toContain("formatCompact(liveInstances.length)");
    expect(tile).toContain(
      "sublabel: `live in the last ${CLOUD_INSTANCE_LIVE_WINDOW_MINUTES} min`",
    );
  });

  test("adds error rate and p95 latency tiles from the span metrics", () => {
    const errorTile: string = between(
      code,
      'title: "Error rate"',
      'title: "p95 latency"',
    );

    expect(errorTile).toContain("formatPercent(m.errorRatePercent)");
    expect(errorTile).toContain("percent: m ? m.errorRatePercent : null");
    expect(errorTile).toContain("higherIsBetter: false");
    expect(errorTile).toContain("thresholds: { warn: 1, danger: 5 }");

    const p95Tile: string = between(code, 'title: "p95 latency"', "];");

    expect(p95Tile).toContain("formatDurationMs(m.p95DurationMs)");
  });

  test("names the platform and provider by their labels, raw key in details", () => {
    expect(code).toContain("getManagedCloudPlatformLabel(r.cloudPlatform)");
    expect(code).toContain("getCloudProviderLabel(r.cloudProvider)");
    expect(code).toContain("identifier={platformLabel}");
    expect(code).toContain(
      '{ label: "Environment Key", value: r.resourceIdentifier',
    );
    expect(code).toContain("value: r.cloudPlatform }");
  });

  test("links to Instances and Owners", () => {
    const quickLinks: string = between(
      code,
      "const quickLinks: Array<ResourceOverviewQuickLink> = [",
      "const detailRows",
    );

    expect(quickLinks).toContain("PageMap.CLOUD_RESOURCE_VIEW_INSTANCES");
    expect(quickLinks).toContain("PageMap.CLOUD_RESOURCE_VIEW_OWNERS");
  });
});

describe("Cloud Environment instances", () => {
  const code: string = readCode("Pages/Cloud/View/Instances.tsx");

  test("formats CPU and memory instead of printing raw numbers", () => {
    expect(code).toContain(
      'from "../../../Components/TelemetryResource/telemetryMetrics"',
    );
    expect(code).toContain("formatPercent(");
    expect(code).toContain("formatBytes(");
    expect(code).not.toContain("Memory (bytes)");
  });

  test("marks instances stale outside the shared live window", () => {
    expect(code).toContain(SCOPE_IMPORT);
    expect(code).toContain("CLOUD_INSTANCE_LIVE_WINDOW_MINUTES");
    expect(code).toContain("isCloudInstanceLive(item.lastSeenAt)");
    expect(code).toContain('title: "Status"');
    expect(code).toContain('"Running"');
    expect(code).toContain('"Stale"');
  });

  test("lists the newest first and names the identity chain from the shared constant", () => {
    expect(code).toContain('sortBy="lastSeenAt"');
    expect(code).toContain("sortOrder={SortOrder.Descending}");

    /*
     * The copy is built from CLOUD_INSTANCE_IDENTITY_ATTRIBUTES rather than
     * hand-typed, so it cannot list a different chain than ingest walks.
     */
    expect(code).toContain(
      'from "Common/Utils/Telemetry/CloudInstanceIdentity"',
    );
    expect(code).toContain("CLOUD_INSTANCE_IDENTITY_ATTRIBUTES.join(");
    expect(code).toContain("IDENTITY_ATTRIBUTE_LIST");
  });

  test("the derived Status column does not compete with Last Seen for the sort", () => {
    const statusColumn: number = code.indexOf('title: "Status"');
    const lastSeenColumn: number = code.indexOf('title: "Last Seen"');
    expect(statusColumn).toBeGreaterThan(-1);
    expect(code.slice(statusColumn, lastSeenColumn)).toContain(
      "disableSort: true",
    );
  });
});

describe("Cloud Environment owners page wiring", () => {
  test("has a PageMap key and an /owners route", () => {
    /*
     * RouteMap is read raw: its "cloud/*" mount pattern would open a fake
     * block comment for the stripper and swallow the entries after it.
     */
    const pageMap: string = readCode("Utils/PageMap.ts");
    const routeMap: string = squash(readSource("Utils/RouteMap.ts"));

    expect(pageMap).toContain(
      'CLOUD_RESOURCE_VIEW_OWNERS = "CLOUD_RESOURCE_VIEW_OWNERS"',
    );
    expect(routeMap).toContain(
      "[PageMap.CLOUD_RESOURCE_VIEW_OWNERS]: `${RouteParams.ModelID}/owners`",
    );
    expect(routeMap).toContain(
      "CloudRoutePath[PageMap.CLOUD_RESOURCE_VIEW_OWNERS]",
    );
  });

  test("mounts the page in the cloud routes", () => {
    const routes: string = readCode("Routes/CloudResourceRoutes.tsx");

    expect(routes).toContain('from "../Pages/Cloud/View/Owners"');
    expect(routes).toContain(
      "RouteUtil.getLastPathForKey(PageMap.CLOUD_RESOURCE_VIEW_OWNERS)",
    );
    expect(routes).toContain("<CloudResourceOwners");
  });

  test("links to it from the environment side menu", () => {
    const sideMenu: string = readCode("Pages/Cloud/View/SideMenu.tsx");

    expect(sideMenu).toContain('title: "Owners"');
    expect(sideMenu).toContain(
      "RouteMap[PageMap.CLOUD_RESOURCE_VIEW_OWNERS] as Route",
    );
    // The Feed entry the feed-wiring sweep depends on stays put.
    expect(sideMenu).toContain('title: "Feed"');
  });

  test("the page reads the id from the route and uses the cloud owner models", () => {
    const page: string = readCode("Pages/Cloud/View/Owners.tsx");

    // The route is <modelId>/owners, so the id is one segment back.
    expect(page).toContain("Navigation.getLastParamAsObjectID(1)");
    expect(page).toContain(
      "<OwnersCard<CloudResourceOwnerUser, CloudResourceOwnerTeam>",
    );
    expect(page).toContain('resourceIdField="cloudResourceId"');
    expect(page).toContain('resourceDisplayName="cloud environment"');
  });
});

describe("Cloud breadcrumbs", () => {
  test("cover every routed CLOUD_* page", () => {
    /*
     * A routed page with no trail renders with no breadcrumbs, silently.
     * Read the keys from PageMap, keep the ones RouteMap actually routes
     * (CLOUD_ROOT is a mount point whose pattern ends in "/*", not a page)
     * and demand a trail for each.
     */
    const pageMap: string = readSource("Utils/PageMap.ts");
    const routeMap: string = readSource("Utils/RouteMap.ts");
    const breadcrumbs: string = readCode(
      "Utils/Breadcrumbs/CloudBreadcrumbs.ts",
    );

    const keys: Array<string> = Array.from(
      pageMap.matchAll(/^\s*(CLOUD_[A-Z_]+)\s*=\s*"/gm),
    ).map((match: RegExpMatchArray): string => {
      return match[1] as string;
    });

    expect(keys.length).toBeGreaterThan(10);

    const routedKeys: Array<string> = keys.filter((key: string): boolean => {
      const start: number = routeMap.indexOf(`[PageMap.${key}]: new Route(`);
      if (start < 0) {
        return false;
      }
      const declaration: string = routeMap.slice(
        start,
        routeMap.indexOf("),", start),
      );
      return !declaration.includes("/*`");
    });

    expect(routedKeys).toContain("CLOUD_RESOURCE_VIEW_OWNERS");
    expect(routedKeys).not.toContain("CLOUD_ROOT");

    const missing: Array<string> = routedKeys.filter((key: string): boolean => {
      return !breadcrumbs.includes(`PageMap.${key},`);
    });

    expect(missing).toEqual([]);
  });

  test.each([
    ["CLOUD_RESOURCE_VIEW_INSTANCES", "Instances"],
    ["CLOUD_RESOURCE_VIEW_FEED", "Feed"],
    ["CLOUD_RESOURCE_VIEW_OWNERS", "Owners"],
    ["CLOUD_ARCHIVED", "Archived"],
    ["CLOUD_SETTINGS_LABEL_RULES", "Label Rules"],
    ["CLOUD_SETTINGS_OWNER_RULES", "Owner Rules"],
  ])("%s ends its trail with %s", (key: string, title: string) => {
    const breadcrumbs: string = readCode(
      "Utils/Breadcrumbs/CloudBreadcrumbs.ts",
    );
    const entry: string = between(breadcrumbs, `PageMap.${key},`, "]),");

    expect(entry).toContain(`"${title}",`);
  });
});

describe("Cloud Environment copy", () => {
  test("the view layout, list and inventory catalogue say environment, not resource", () => {
    expect(readCode("Pages/Cloud/View/Layout.tsx")).toContain(
      'title="Cloud Environment"',
    );
    expect(readCode("Pages/Cloud/View/Logs.tsx")).toContain(
      'title="Cloud Environment Logs"',
    );
    expect(readCode("Pages/Cloud/SideMenu.tsx")).toContain(
      'title: "All Environments"',
    );

    const catalog: string = readCode(
      "Components/Inventory/InventoryTypeCatalog.ts",
    );
    const cloudEntry: string = between(
      catalog,
      "[EntityType.CloudResource]: {",
      "[EntityType.ExternalService]: {",
    );

    expect(cloudEntry).not.toContain("connected cloud account");
    expect(cloudEntry).toContain("cloud.* resource attributes");
  });
});
