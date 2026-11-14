import PageMap from "../../FeatureSet/AdminDashboard/src/Utils/PageMap";
import RouteMap from "../../FeatureSet/AdminDashboard/src/Utils/RouteMap";
import Route from "Common/Types/API/Route";
import {
  TELEMETRY_USAGE_DEFAULT_RETENTION_IN_DAYS,
  TELEMETRY_USAGE_MAX_RETENTION_IN_DAYS,
  TELEMETRY_USAGE_MIN_RETENTION_IN_DAYS,
} from "Common/Types/Telemetry/TelemetryUsage";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  RouteAttributes,
  pageRoutesIn,
  routeMapPath,
  routesAt,
} from "../Helpers/PageRoutes";

/*
 * THE INSTANCE ADMIN'S VIEW OF TELEMETRY USAGE (issue #5916), with billing
 * on or off:
 *
 *   - Telemetry Usage in the Admin Dashboard's menu: every project, heaviest
 *     first;
 *   - Projects > a project > Telemetry Usage: one project by day, signal and
 *     resource;
 *   - Settings > Data Retention > Telemetry Usage Retention: how long the
 *     daily usage rows are kept.
 */

const ADMIN_SRC: string = path.resolve(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "AdminDashboard",
  "src",
);

const read: (...parts: Array<string>) => string = (
  ...parts: Array<string>
): string => {
  return fs.readFileSync(path.join(ADMIN_SRC, ...parts), "utf8");
};

describe("the Admin Dashboard's usage pages", () => {
  test("are at /admin/telemetry-usage and /admin/projects/:id/telemetry-usage", () => {
    expect((RouteMap[PageMap.TELEMETRY_USAGE] as Route).toString()).toBe(
      "/admin/telemetry-usage",
    );
    expect(
      (RouteMap[PageMap.PROJECT_TELEMETRY_USAGE] as Route).toString(),
    ).toBe("/admin/projects/:id/telemetry-usage");
  });

  test("are routed, each to its own page", () => {
    const app: string = read("App.tsx").replace(/\s+/g, " ");

    expect(app).toContain(
      'import TelemetryUsage from "./Pages/TelemetryUsage/Index";',
    );
    expect(app).toContain(
      'import ProjectTelemetryUsage from "./Pages/Projects/View/TelemetryUsage";',
    );

    const routes: Array<RouteAttributes> = pageRoutesIn(
      path.join(ADMIN_SRC, "App.tsx"),
    );

    expect(routesAt(routes, routeMapPath("TELEMETRY_USAGE"))).toEqual([
      {
        path: routeMapPath("TELEMETRY_USAGE"),
        element: "<TelemetryUsage />",
      },
    ]);
    expect(routesAt(routes, routeMapPath("PROJECT_TELEMETRY_USAGE"))).toEqual([
      {
        path: routeMapPath("PROJECT_TELEMETRY_USAGE"),
        element: "<ProjectTelemetryUsage />",
      },
    ]);
  });

  test("Telemetry Usage is in the menu with the instance's health, on every install", () => {
    const navBar: string = read("Components", "NavBar", "NavBar.tsx");
    const item: string = navBar.slice(
      navBar.indexOf('title: "Telemetry Usage"'),
      navBar.indexOf("},", navBar.indexOf('title: "Telemetry Usage"')),
    );

    expect(item).toContain(
      'description: "How much telemetry each project sends, heaviest first."',
    );
    expect(item).toContain("RouteMap[PageMap.TELEMETRY_USAGE]");
    expect(item).toContain("category: monitoringCategory");

    // Not among the items only billing adds.
    const billingOnly: number = navBar.indexOf("...(BILLING_ENABLED");
    const billingOnlyEnd: number = navBar.indexOf(": [])", billingOnly);

    expect(navBar.indexOf('title: "Telemetry Usage"')).toBeGreaterThan(
      billingOnlyEnd,
    );
  });

  test("a project's Telemetry Usage is in its side menu's Basic section, on every install", () => {
    const sideMenu: string = read("Pages", "Projects", "View", "SideMenu.tsx");
    const basic: string = sideMenu.slice(
      sideMenu.indexOf('t("sideMenu.basic")'),
      sideMenu.indexOf("</SideMenuSection>"),
    );

    expect(basic).toContain('t("sideMenu.telemetryUsage")');
    expect(basic).toContain("RouteMap[PageMap.PROJECT_TELEMETRY_USAGE]");
  });

  test("read the usage as the master admin, through the admin routes", () => {
    const utils: string = read("Utils", "TelemetryUsage.ts");

    expect(utils).toContain(".addRoute(TELEMETRY_USAGE_ADMIN_PROJECTS_ROUTE)");
    expect(utils).toContain(
      "`${TELEMETRY_USAGE_ADMIN_PROJECTS_ROUTE}/${data.projectId.toString()}`",
    );

    const project: string = read(
      "Pages",
      "Projects",
      "View",
      "TelemetryUsage.tsx",
    );

    expect(project).toContain("<TelemetryUsageOverview");
    // No resource pages in the Admin Dashboard: nothing to link them to.
    expect(project).not.toContain("getResourceRoute");
  });
});

describe("Settings > Data Retention > Telemetry Usage Retention", () => {
  const page: string = read("Pages", "Settings", "DataRetention", "Index.tsx");
  const card: string = page.slice(
    page.indexOf('name="Telemetry Usage Retention Settings"'),
  );

  test("edits the instance's one setting, GlobalConfig.telemetryUsageRetentionInDays", () => {
    expect(card).toContain("telemetryUsageRetentionInDays: true");
    expect(card).toContain("modelType: GlobalConfig");
    expect(card).toContain("modelId: ObjectID.getZeroObjectID()");
  });

  test("holds the form to the bounds the server holds the setting to", () => {
    expect(card).toContain("minValue: TELEMETRY_USAGE_MIN_RETENTION_IN_DAYS");
    expect(card).toContain("maxValue: TELEMETRY_USAGE_MAX_RETENTION_IN_DAYS");
  });

  test("says those bounds and the default, in the numbers the server uses", () => {
    expect(TELEMETRY_USAGE_MIN_RETENTION_IN_DAYS).toBe(30);
    expect(TELEMETRY_USAGE_MAX_RETENTION_IN_DAYS).toBe(1095);
    expect(TELEMETRY_USAGE_DEFAULT_RETENTION_IN_DAYS).toBe(120);
    expect(card).toContain(
      `"How many days each project's daily telemetry usage is kept, from ${TELEMETRY_USAGE_MIN_RETENTION_IN_DAYS} to ${TELEMETRY_USAGE_MAX_RETENTION_IN_DAYS}. Leave empty for ${TELEMETRY_USAGE_DEFAULT_RETENTION_IN_DAYS} days."`,
    );
    expect(card).toContain(
      `placeholder: "${TELEMETRY_USAGE_DEFAULT_RETENTION_IN_DAYS}"`,
    );
    expect(card).toContain(
      `placeholder: "${TELEMETRY_USAGE_DEFAULT_RETENTION_IN_DAYS} (default)"`,
    );
  });

  test("is the last card, after the monitor log and metric retention", () => {
    expect(
      page.indexOf('name="Monitor Metric Retention Settings"'),
    ).toBeLessThan(page.indexOf('name="Telemetry Usage Retention Settings"'));
  });
});
