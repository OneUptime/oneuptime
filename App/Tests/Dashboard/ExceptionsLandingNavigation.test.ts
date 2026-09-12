import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import { getActiveExceptionsTab } from "../../FeatureSet/Dashboard/src/Utils/ExceptionsNavigation";

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "src",
);

function readSquashed(relativePath: string): string {
  return fs
    .readFileSync(path.join(DASHBOARD_SRC, relativePath), "utf8")
    .replace(/\s+/g, " ");
}

function sectionBetween(
  source: string,
  startMarker: string,
  endMarker: string,
): string {
  const start: number = source.indexOf(startMarker);

  if (start < 0) {
    throw new Error(`Start marker not found: ${startMarker}`);
  }

  const end: number = source.indexOf(endMarker, start + startMarker.length);

  if (end < 0) {
    throw new Error(`End marker not found: ${endMarker}`);
  }

  return source.slice(start, end);
}

interface TabDefinition {
  key: string;
  label: string;
}

function getTabDefinitions(source: string): Array<TabDefinition> {
  return Array.from(source.matchAll(/key: "([^"]+)", label: "([^"]+)",/g)).map(
    (match: RegExpMatchArray): TabDefinition => {
      const key: string | undefined = match[1];
      const label: string | undefined = match[2];

      if (!key || !label) {
        throw new Error("A tab is missing its key or label");
      }

      return { key, label };
    },
  );
}

describe("Exceptions landing navigation", () => {
  test.each([
    ["/dashboard/project-id/exceptions", "unresolved"],
    ["/dashboard/project-id/exceptions/unresolved", "unresolved"],
    ["/dashboard/project-id/exceptions/overview", "overview"],
    ["/dashboard/project-id/exceptions/resolved", "resolved"],
    ["/dashboard/project-id/exceptions/archived", "archived"],
    ["/dashboard/project-id/exceptions/documentation", "setup"],
  ])("selects the %s route's %s tab", (route: string, tab: string) => {
    expect(getActiveExceptionsTab(route)).toBe(tab);
  });

  test("shows Unresolved first and the former Overview dashboard as Insights second", () => {
    const source: string = readSquashed(
      "Components/Exceptions/ExceptionsNavTabs.tsx",
    );
    const tabs: string = sectionBetween(
      source,
      "const tabs: Array<TelemetryTab> = [",
      "];",
    );

    expect(getTabDefinitions(tabs).slice(0, 2)).toEqual([
      { key: "unresolved", label: "Unresolved" },
      { key: "overview", label: "Insights" },
    ]);

    const insightsTab: string = sectionBetween(
      tabs,
      'key: "overview",',
      'key: "resolved",',
    );

    expect(insightsTab).toContain("IconProp.ChartBar");
    expect(insightsTab).toContain("PageMap.EXCEPTIONS_OVERVIEW");
  });

  test("makes the primary Exceptions route unresolved while preserving the Overview URL", () => {
    const source: string = readSquashed("Utils/RouteMap.ts");

    expect(source).toContain('[PageMap.EXCEPTIONS]: "unresolved"');
    expect(source).toContain('[PageMap.EXCEPTIONS_UNRESOLVED]: "unresolved"');
    expect(source).toContain('[PageMap.EXCEPTIONS_OVERVIEW]: "overview"');
  });

  test("keeps the Exceptions product active across every child route", () => {
    const source: string = readSquashed("Utils/NavigationItems.tsx");
    const exceptionsItem: string = sectionBetween(
      source,
      'title: t("navbar.items.exceptionsTitle")',
      'title: t("navbar.items.llmObservabilityTitle"',
    );

    expect(exceptionsItem).toContain("RouteMap[PageMap.EXCEPTIONS] as Route");
    expect(exceptionsItem).toContain(
      "activeRoute: RouteMap[PageMap.EXCEPTIONS_VIEW_ROOT]",
    );
  });

  test("renders and redirects every bare Exceptions entry point to the primary route", () => {
    const routes: string = readSquashed("Routes/ExceptionsRoutes.tsx");
    const indexRoute: string = sectionBetween(
      routes,
      "<PageRoute index",
      "<PageRoute path=",
    );
    const insightsRoute: string = sectionBetween(
      routes,
      "path={ExceptionsRoutePath[PageMap.EXCEPTIONS_OVERVIEW]",
      "path={ExceptionsRoutePath[PageMap.EXCEPTIONS_UNRESOLVED]",
    );

    expect(indexRoute).toContain("<ExceptionsUnresolved");
    expect(indexRoute).toContain("RouteMap[PageMap.EXCEPTIONS]");
    expect(indexRoute).not.toContain("<ExceptionsOverview");
    expect(insightsRoute).toContain("<ExceptionsOverview");
    expect(insightsRoute).toContain(
      "RouteMap[PageMap.EXCEPTIONS_OVERVIEW] as Route",
    );
    expect(insightsRoute).not.toContain("<ExceptionsUnresolved");

    for (const layout of [
      "Pages/Exceptions/Layout.tsx",
      "Pages/Exceptions/View/Layout.tsx",
    ]) {
      const source: string = readSquashed(layout);

      expect(source).toContain(
        "Navigation.navigate( RouteUtil.populateRouteParams(RouteMap[PageMap.EXCEPTIONS]!), );",
      );
      expect(source).not.toContain("RouteMap[PageMap.EXCEPTIONS_OVERVIEW]!");
    }
  });

  test("labels the preserved Overview route as Insights in its breadcrumb", () => {
    const source: string = readSquashed(
      "Utils/Breadcrumbs/ExceptionsBreadcrumbs.ts",
    );
    const insightsBreadcrumb: string = sectionBetween(
      source,
      "BuildBreadcrumbLinksByTitles(PageMap.EXCEPTIONS_OVERVIEW",
      "BuildBreadcrumbLinksByTitles(PageMap.EXCEPTIONS_UNRESOLVED",
    );

    expect(insightsBreadcrumb).toContain('"Insights"');
    expect(insightsBreadcrumb).not.toContain('"Overview"');
  });
});
