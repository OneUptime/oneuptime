import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * AN APP PLATFORMS ENVIRONMENT'S RECOMMENDATIONS AND MAINTENANCE, WIRED.
 *
 * Maintenance that holds an environment holds the monitors of every app in
 * it (Common's MonitorMaintenanceSuppression reads them by the environment's
 * platform, account and Region), so the environment has a Scheduled
 * Maintenance tab that lists and creates those events, its Overview and each
 * app's page say while one holds it, and its Recommendations page adds an
 * app's recommended monitors to every app at once - drawn by the same
 * component as a cloud account's. A cloud resource's own Scheduled
 * Maintenance tab, and the environment's, leave out the Affected Resources
 * column, which would only say the resource again; no other list does.
 *
 * The pages are drawn for real in Common's Tests/App/Dashboard
 * (CloudEnvironmentAppRecommendations, CloudEnvironmentMaintenanceNotice,
 * AppPlatformsAppRecommendations, ScheduledMaintenanceResourceTabColumns,
 * AppPlatformsSideMenus); this holds the wiring between them.
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

// Comments out and whitespace squashed, so prettier's wrapping cannot matter.
function readCode(relativePath: string): string {
  return readSource(relativePath)
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1")
    .replace(/\s+/g, " ")
    .replace(/([[({]) /g, "$1")
    .replace(/,? ([\])}])/g, "$1");
}

function listSources(directory: string): Array<string> {
  const files: Array<string> = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      if (entry.name !== "node_modules" && entry.name !== "Locales") {
        files.push(...listSources(full));
      }
    } else if (entry.name.endsWith(".tsx") || entry.name.endsWith(".ts")) {
      files.push(full);
    }
  }

  return files;
}

describe("an environment's Recommendations", () => {
  test("its page draws every app's recommendations for the environment in view", () => {
    const page: string = readCode(
      "Pages/AppPlatforms/View/Recommendations.tsx",
    );

    expect(page).toContain(
      "const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);",
    );
    expect(page).toContain(
      "<CloudEnvironmentAppRecommendations environmentId={modelId} />",
    );
  });

  test("its menu entry counts what is still to set up, for that environment, after its Overview", () => {
    const menu: string = readCode("Pages/AppPlatforms/View/SideMenu.tsx");
    const entry: string = menu
      .split("<CloudEnvironmentRecommendationsMenuItem")[1]!
      .split("/>")[0]!;

    expect(entry).toContain('title: "Recommendations"');
    expect(entry).toContain(
      "RouteMap[PageMap.APP_PLATFORMS_ENVIRONMENT_VIEW_RECOMMENDATIONS]",
    );
    expect(entry).toContain("environmentId={props.modelId}");
    expect(
      menu.indexOf("<CloudEnvironmentRecommendationsMenuItem"),
    ).toBeLessThan(menu.indexOf('title: "Documentation"'));
  });

  test("an account's and an environment's are one component, each with its own words and elements", () => {
    for (const file of [
      "Components/Recommendations/CloudAccountMonitorRecommendations.tsx",
      "Components/Recommendations/CloudEnvironmentAppRecommendations.tsx",
    ]) {
      expect(readCode(file)).toContain(
        "import GroupedMonitorRecommendations, {",
      );
    }

    expect(
      readCode(
        "Components/Recommendations/CloudAccountMonitorRecommendations.tsx",
      ),
    ).toContain('testIdPrefix: "cloud-account-recommendation"');
    expect(
      readCode(
        "Components/Recommendations/CloudEnvironmentAppRecommendations.tsx",
      ),
    ).toContain('testIdPrefix: "cloud-environment-recommendation"');
  });
});

describe("an environment's scheduled maintenance", () => {
  test("its tab lists the events that hold it and creates them with it picked", () => {
    const page: string = readCode(
      "Pages/AppPlatforms/View/ScheduledMaintenance.tsx",
    );

    expect(page).toContain("query.cloudResources = new Includes([modelId]);");
    expect(page).toContain(
      "createFrom={{kind: CreateFromRecordKind.CloudEnvironment, id: modelId}}",
    );
  });

  test("its menu entry counts the events not over yet, after its alerts", () => {
    const menu: string = readCode("Pages/AppPlatforms/View/SideMenu.tsx");
    const entry: string = menu
      .split("<CountModelSideMenuItem<ScheduledMaintenance>")[1]!
      .split("/>")[0]!;

    expect(entry).toContain(
      "RouteMap[PageMap.APP_PLATFORMS_ENVIRONMENT_VIEW_SCHEDULED_MAINTENANCE]",
    );
    expect(entry).toContain("cloudResources: new Includes([props.modelId])");
    expect(entry).toContain("activeScheduledMaintenanceStates");
    expect(menu.indexOf('title: "Alerts"')).toBeLessThan(
      menu.indexOf("<CountModelSideMenuItem<ScheduledMaintenance>"),
    );
  });

  test("the Overview says while an event holds the environment, at its top", () => {
    const overview: string = readCode("Pages/AppPlatforms/View/Overview.tsx");

    expect(overview).toContain(
      "<CloudEnvironmentMaintenanceNotice environmentId={modelId} scope={CloudEnvironmentMaintenanceNoticeScope.Environment} />",
    );
    expect(overview.indexOf("<CloudEnvironmentMaintenanceNotice")).toBeLessThan(
      overview.indexOf("<ResourceOverview icon="),
    );
  });

  test("an app's page says it of the app, under its header and before its tabs", () => {
    const app: string = readCode("Pages/AppPlatforms/View/App.tsx");
    const notice: number = app.indexOf(
      "<CloudEnvironmentMaintenanceNotice environmentId={environmentId} scope={CloudEnvironmentMaintenanceNoticeScope.App} />",
    );

    expect(notice).toBeGreaterThan(-1);
    expect(app.indexOf("<CloudAppHeader")).toBeLessThan(notice);
    expect(notice).toBeLessThan(app.indexOf("<Tabs"));
  });
});

describe("a resource's own Scheduled Maintenance tab", () => {
  const LEAVE_OUT: string = "isResourceOwnTab={true}";

  test("a cloud resource's and an environment's leave out the column that says them again", () => {
    expect(readCode("Pages/Cloud/View/ScheduledMaintenance.tsx")).toContain(
      LEAVE_OUT,
    );
    expect(
      readCode("Pages/AppPlatforms/View/ScheduledMaintenance.tsx"),
    ).toContain(LEAVE_OUT);
  });

  test("no other list leaves it out: the shared table's columns are as they were", () => {
    const leaving: Array<string> = listSources(DASHBOARD_SRC)
      .filter((file: string): boolean => {
        return fs.readFileSync(file, "utf8").includes(LEAVE_OUT);
      })
      .map((file: string): string => {
        return path.relative(DASHBOARD_SRC, file).split(path.sep).join("/");
      })
      .sort();

    expect(leaving).toEqual([
      "Pages/AppPlatforms/View/ScheduledMaintenance.tsx",
      "Pages/Cloud/View/ScheduledMaintenance.tsx",
    ]);
  });

  test("the shared table keeps the column unless a page asks, and asks by the column's own title", () => {
    const table: string = readCode(
      "Components/ScheduledMaintenance/ScheduledMaintenanceTable.tsx",
    );

    expect(table).toContain(
      'export const AFFECTED_RESOURCES_COLUMN_TITLE: string = "Affected Resources";',
    );
    expect(table).toContain("if (!isResourceOwnTab) {return columns;}");
    expect(table).toContain('title: "Affected Resources",');
    expect(table).toContain("columns={columnsOfThisList([");
  });
});
