import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Issue #5080's wiring: a dashboard's saved default time range and
 * auto-refresh, the viewer's own picks remembered in their browser, and a
 * way back - on both dashboard shells, the one inside OneUptime
 * (DashboardView) and the public one (DashboardViewPage).
 *
 * The behaviour is tested where it lives (Common/Tests: the vocabulary, the
 * browser memory, the address, the shared hook, the picker's Default
 * choice, and both shells driven through the DOM). What is left is each
 * shell handing the right piece to the next, and a break there leaves no
 * trace: the dashboard still opens, on the past hour, as before. So the
 * sources are read, comments stripped and whitespace squashed first, so a
 * comment cannot pass a test and prettier re-wrapping a line cannot fail
 * one.
 */

const PACKAGES: string = path.join(__dirname, "..", "..", "..");

/*
 * Each block comment, from its opener to the next closer, as one space -
 * read with indexOf, one pass over the code.
 */
function withoutBlockComments(code: string): string {
  const parts: Array<string> = [];
  let at: number = 0;
  let open: number = code.indexOf("/*");

  while (open >= 0) {
    const close: number = code.indexOf("*/", open + 2);

    if (close < 0) {
      break;
    }

    parts.push(code.slice(at, open));
    at = close + 2;
    open = code.indexOf("/*", at);
  }

  parts.push(code.slice(at));

  return parts.join(" ");
}

function readCode(relative: string): string {
  return withoutBlockComments(
    fs.readFileSync(path.join(PACKAGES, relative), "utf8"),
  )
    .replace(/(^|[^:])\/\/.*$/gm, "$1 ")
    .replace(/\s+/g, " ");
}

const AUTHENTICATED_SHELL: string =
  "App/FeatureSet/Dashboard/src/Components/Dashboard/DashboardView.tsx";
const PUBLIC_SHELL: string =
  "App/FeatureSet/PublicDashboard/src/Pages/DashboardView/DashboardViewPage.tsx";
const TOOLBAR: string =
  "App/FeatureSet/Dashboard/src/Components/Dashboard/Toolbar/DashboardToolbar.tsx";
const HOOK: string = "Common/UI/Utils/UseDashboardViewerSettings.ts";
const PICKS: string = "Common/UI/Utils/DashboardViewerPicks.ts";
const REMEMBERED_CHOICE: string = "Common/UI/Utils/RememberedChoice.ts";
const PUBLIC_THEME: string =
  "App/FeatureSet/PublicDashboard/src/Utils/DashboardTheme.ts";

describe.each([
  ["the dashboard inside OneUptime", AUTHENTICATED_SHELL],
  ["the public dashboard", PUBLIC_SHELL],
])("%s", (_name: string, shell: string) => {
  const code: string = readCode(shell);

  test("keeps its time range and auto-refresh in the shared viewer settings, for this dashboard", () => {
    expect(code).toContain(
      "useDashboardViewerSettings({ dashboardId: props.dashboardId.toString(),",
    );
    expect(code).toContain(
      "const autoRefreshInterval: AutoRefreshInterval = viewerSettings.autoRefreshInterval;",
    );
    // No interval of its own any more, and no hard-coded past hour.
    expect(code).not.toContain("useState<AutoRefreshInterval>");
    expect(code).not.toContain("setAutoRefreshInterval(");
    expect(code).not.toContain("TimeRange.PAST_ONE_HOUR");
  });

  test("hands the viewer settings the dashboard's own defaults as its config loads", () => {
    expect(code).toContain("viewerSettings.applySavedDefaults(config);");
    // The old restore, which an Off stored as text skipped and a viewer's pick never beat.
    expect(code).not.toContain("if (config.refreshInterval)");
  });

  test("offers Default (...) first in its time range picker", () => {
    // Inside OneUptime through the toolbar, which hands it to the picker.
    const handsTheDefault: string =
      shell === AUTHENTICATED_SHELL
        ? "defaultTimeRange={viewerSettings.defaultTimeRange} isOnDefaultTimeRange={viewerSettings.isOnDefaultTimeRange} onDefaultTimeRangeSelect={viewerSettings.pickDefaultTimeRange}"
        : "defaultRange={viewerSettings.defaultTimeRange} isOnDefaultRange={viewerSettings.isOnDefaultTimeRange} onDefaultRangeSelect={viewerSettings.pickDefaultTimeRange}";

    expect(code).toContain(handsTheDefault);
  });
});

describe("the dashboard inside OneUptime", () => {
  const code: string = readCode(AUTHENTICATED_SHELL);
  const toolbar: string = readCode(TOOLBAR);

  test("only a playlist's turn opens on the saved defaults alone, and the public dashboard never does", () => {
    /*
     * A playlist plays dashboards one after another on one address
     * (issue #5235): the link's ?range= and the viewer's remembered picks
     * are not the board's to follow there, nor to write to.
     */
    expect(code).toContain(
      "useDashboardViewerSettings({ dashboardId: props.dashboardId.toString(), savedDefaultsOnly: isPlayback, })",
    );
    expect(code).toContain(
      "const isPlayback: boolean = Boolean(props.isPlayback);",
    );
    expect(readCode(PUBLIC_SHELL)).not.toContain("savedDefaultsOnly");
  });

  test("Save Changes saves the board as edited, and stamps no view-mode interval onto it", () => {
    expect(code).not.toContain("refreshInterval: autoRefreshInterval");
    expect(code).toContain(
      "const configToSave: DashboardViewConfig = dashboardViewConfig; saveDashboardViewConfig(configToSave)",
    );
  });

  test("its toolbar's pickers go through the viewer settings", () => {
    expect(code).toContain("viewerSettings.pickAutoRefreshInterval(interval);");

    // Prettier puts a long prop's value on lines of its own, inside its braces.
    const props: string = code.split("{ ").join("{").split(" }").join("}");

    expect(props).toContain(
      "defaultAutoRefreshInterval={viewerSettings.defaultAutoRefreshInterval} isOnDefaultAutoRefresh={viewerSettings.isOnDefaultAutoRefresh} onDefaultAutoRefreshSelect={viewerSettings.pickDefaultAutoRefreshInterval}",
    );
  });

  test("the defaults are set in the config being edited, so Save Changes saves them and Discard Changes drops them", () => {
    expect(code).toContain("onDashboardDefaultsChange={(defaults: {");
    expect(code).toContain("next.timeRange = defaults.timeRange;");
    expect(code).toContain("next.refreshInterval = defaults.refreshInterval;");
    expect(code).toContain(
      "setDashboardViewConfig((previous: DashboardViewConfig) => {",
    );
  });

  test("the defaults' row is drawn only while editing a dashboard with a widget, for someone who may edit", () => {
    /*
     * Once it has a widget, as the viewer's own time range and auto-refresh
     * are: an empty dashboard's editor has one thing to do, add a widget.
     */
    expect(toolbar).toContain(
      "{isEditMode && hasComponents && props.canEditDashboard && props.onDashboardDefaultsChange ? ( <DashboardDefaultsBar",
    );
    expect(toolbar.split("<DashboardDefaultsBar").length - 1).toBe(1);
  });

  test("its toolbar hands the dashboard's default range to the time range picker", () => {
    expect(toolbar).toContain(
      "defaultRange={props.defaultTimeRange} isOnDefaultRange={props.isOnDefaultTimeRange} onDefaultRangeSelect={props.onDefaultTimeRangeSelect}",
    );
  });

  test("the auto-refresh menu's Default (...) choice comes first", () => {
    const defaultChoice: number = toolbar.indexOf(
      "data-testid={AUTO_REFRESH_DEFAULT_CHOICE_TEST_ID}",
    );
    const intervals: number = toolbar.indexOf(
      "Object.values(AutoRefreshInterval).map(",
    );

    expect(defaultChoice).toBeGreaterThan(-1);
    expect(intervals).toBeGreaterThan(defaultChoice);
  });
});

describe("the public dashboard", () => {
  const code: string = readCode(PUBLIC_SHELL);

  test("its auto-refresh menu offers the dashboard's own interval first, and goes back to it", () => {
    const defaultChoice: number = code.indexOf(
      "dataTestId={PUBLIC_AUTO_REFRESH_DEFAULT_CHOICE_TEST_ID}",
    );
    const intervals: number = code.indexOf(
      "...Object.values(AutoRefreshInterval).map(",
    );

    expect(defaultChoice).toBeGreaterThan(-1);
    expect(intervals).toBeGreaterThan(defaultChoice);
    expect(code).toContain("viewerSettings.pickDefaultAutoRefreshInterval();");
    expect(code).toContain("viewerSettings.pickAutoRefreshInterval(interval);");
  });

  test("keeps the auto-refresh menu before the theme menu, as its theme wiring reads it", () => {
    expect(code.indexOf("menuIcon={IconProp.Refresh}")).toBeLessThan(
      code.indexOf("<ThemeMenu />"),
    );
  });
});

describe("one way of keeping a viewer's choice in their browser", () => {
  test("the shared hook keeps the picks through DashboardViewerPicks, and the address through DashboardSettingsUrlState", () => {
    const hook: string = readCode(HOOK);

    expect(hook).toContain("DashboardViewerPicks.setTimeRange(");
    expect(hook).toContain("DashboardViewerPicks.setAutoRefreshInterval(");
    expect(hook).toContain("DashboardSettingsUrlState.writeToBrowserUrl(");
    expect(hook).not.toContain("localStorage");
  });

  test("the dashboard's picks and the public dashboard's theme are both kept by RememberedChoice", () => {
    expect(readCode(PICKS)).toContain("RememberedChoice.remember(");
    expect(readCode(PICKS)).toContain("RememberedChoice.forget(");
    expect(readCode(PICKS)).not.toContain("localStorage");

    const theme: string = readCode(PUBLIC_THEME);

    expect(theme).toContain("RememberedChoice.read(");
    expect(theme).toContain("RememberedChoice.remember(");
    expect(theme).toContain("RememberedChoice.forget(");
    expect(theme).toContain("RememberedChoice.subscribe(");
    expect(theme).not.toContain("localStorage");
  });

  test("only RememberedChoice touches the browser's storage among them", () => {
    expect(readCode(REMEMBERED_CHOICE)).toContain("window.localStorage");
  });
});
