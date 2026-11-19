import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * A SITE'S, A DEVICE'S AND A GROUP'S "DOWN" OPENS WHICH ONE (#9596).
 *
 * The pages compose tables, info cards and heroes that no node harness
 * renders, so the wiring is pinned at the source here; the Common suite
 * NetworkSitesAndGroupsSayWhatIsDown draws the heroes and runs the
 * builders. Comments are dropped and whitespace squashed, so a reflow or a
 * note cannot make a test pass or fail.
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
const JSX_COMMENT: RegExp = /\{\s*\}/g;

function readCode(relativePath: string): string {
  return fs
    .readFileSync(path.join(DASHBOARD_SRC, ...relativePath.split("/")), "utf8")
    .replace(BLOCK_COMMENT, " ")
    .replace(LINE_COMMENT, "$1")
    .replace(JSX_COMMENT, " ")
    .replace(/\s+/g, " ");
}

describe("the Network Overview's Sites tile", () => {
  const code: string = readCode("Pages/NetworkDevice/Overview.tsx");

  test("opens the unhealthy sites while any site is unhealthy", () => {
    expect(code).toContain(
      "unhealthySiteCount > 0 ? getUnhealthySitesRoute() : RouteUtil.populateRouteParams( RouteMap[PageMap.NETWORK_SITES] as Route, )",
    );
  });
});

describe("the Sites page", () => {
  const code: string = readCode("Pages/NetworkSite/Sites.tsx");

  test("presses its Unhealthy Sites tile once its counts arrive, when the address names it", () => {
    expect(code).toContain("onCountsLoaded={onSummaryCountsLoaded}");
    expect(code).toContain(
      "Navigation.getQueryStringByName(SITE_LIST_SHOW_PARAM) !== SITE_LIST_SHOW_UNHEALTHY",
    );
    expect(code).toContain(
      "tile.statusFilter === SiteSummaryStatusFilter.Unhealthy",
    );
    expect(code).toContain("applyFacetTileSelection({");
  });

  test("presses it once, and takes the word off the address", () => {
    expect(code).toContain("hasPressedRequestedTile.current = true;");
    expect(code).toContain(
      "Navigation.setQueryString({ [SITE_LIST_SHOW_PARAM]: null });",
    );
  });

  test("its summary hands the page each tile's chip from the counts it read", () => {
    const cards: string = readCode(
      "Components/NetworkSite/SiteSummaryCards.tsx",
    );

    expect(cards).toContain("props.onCountsLoaded?.(");
    expect(cards).toContain(
      "unhealthyStatusIds: summary.unhealthyStatusIds || [],",
    );
  });
});

describe("a device's interfaces that are down", () => {
  test("the hero's 'N down' opens them", () => {
    const code: string = readCode(
      "Components/NetworkDevice/DeviceStatusHero.tsx",
    );

    expect(code).toContain(
      'to={getDownInterfacesRoute(props.modelId)} dataTestId="device-hero-interfaces-down"',
    );
  });

  test("the Interfaces page's Down card filters its table to them, and back", () => {
    const code: string = readCode("Pages/NetworkDevice/View/Interfaces.tsx");

    expect(code).toContain(
      "Navigation.getQueryStringByName(INTERFACES_SHOW_PARAM) === INTERFACES_SHOW_DOWN",
    );
    expect(code).toContain(
      "? { networkDeviceId: modelId.toString(), ...DOWN_INTERFACES_QUERY }",
    );
    expect(code).toContain("setIsDownOnly(!isDownOnly);");
    expect(code).toContain("query={tableQuery}");
  });
});

describe("a site's hero", () => {
  const code: string = readCode("Components/NetworkSite/SiteStatusHero.tsx");

  test("reads its devices' names with their status, and builds what 'N down' opens", () => {
    expect(code).toContain("...SITE_DEVICE_NAME_SELECT,");
    expect(code).toContain("downDeviceItems: getSiteDownDeviceItems({");
    expect(code).toContain('testId="site-hero-devices-down"');
  });

  test("an Offline or Degraded health opens what is not operational under it", () => {
    expect(code).toContain(
      "data.site.currentMonitorStatus.isOperationalState === false",
    );
    expect(code).toContain('testId="site-hero-health-why"');
    expect(code).toContain("load: loadSiteHealthItems,");
    expect(code).toContain("parentSiteId: props.modelId.toString(),");
  });
});

describe("a monitor group's Current Status", () => {
  const code: string = readCode("Pages/MonitorGroup/View/Index.tsx");

  test("opens its monitors that are not operational while it is not", () => {
    expect(code).toContain("currentGroupStatus.isOperationalState === false");
    expect(code).toContain('testId="monitor-group-status-why"');
    expect(code).toContain("return loadMonitorGroupStatusReason({");
  });

  test("reads how bad each status is with the project's statuses", () => {
    expect(code).toContain("isOfflineState: true,");
  });
});
