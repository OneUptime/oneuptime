import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Recording health moved off the session list onto its own Replay Health
 * page. The pieces that make that true are wirings no runtime value exposes
 * - a side menu item, a page module, the list no longer mounting a strip, the
 * policy page linking across - and each fails silently: a missing menu item
 * is a page nobody can find, a leftover strip is the same facts in two
 * places, a policy page that still renders the full card is a second copy
 * that drifts. Same source-text shape as SessionReplayUsersPageWiring.test.ts.
 *
 * Comments are stripped first because these files explain the very things
 * being banned (the list page's comment names the health page it defers to).
 */

const repositoryRoot: string = path.join(__dirname, "../../..");
const dashboardSource: string = path.join(
  __dirname,
  "../../FeatureSet/Dashboard/src",
);

function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

function read(relativePath: string): string {
  return stripComments(
    fs.readFileSync(path.join(dashboardSource, relativePath), "utf8"),
  );
}

const sideMenuSource: string = read("Pages/Rum/View/SideMenu.tsx");
const listPageSource: string = read("Pages/Rum/View/SessionReplay.tsx");
const healthPageSource: string = read("Pages/Rum/View/SessionReplayHealth.tsx");
const policyPageSource: string = read(
  "Pages/Rum/View/SessionReplaySettings.tsx",
);
const dashboardComponentSource: string = read(
  "Components/SessionReplay/RecordingHealthDashboard.tsx",
);
const summaryCardSource: string = read(
  "Components/SessionReplay/RecordingHealthCard.tsx",
);
const pageMapSource: string = read("Utils/PageMap.ts");

describe("the Health page is reachable", () => {
  test("the side menu lists Health inside Session Replay, after Replay Users and before Replay Policy", () => {
    const usersIndex: number = sideMenuSource.indexOf('title: "Replay Users"');
    const healthIndex: number = sideMenuSource.indexOf('title: "Health"');
    const policyIndex: number = sideMenuSource.indexOf(
      'title: "Replay Policy"',
    );
    const settingsSectionIndex: number = sideMenuSource.indexOf(
      'SideMenuSection title="Settings"',
    );

    expect(usersIndex).toBeGreaterThan(-1);
    expect(healthIndex).toBeGreaterThan(usersIndex);
    expect(policyIndex).toBeGreaterThan(healthIndex);
    expect(settingsSectionIndex).toBeGreaterThan(policyIndex);

    const healthItem: string = sideMenuSource.slice(healthIndex, policyIndex);

    expect(healthItem).toContain(
      "PageMap.RUM_APPLICATION_VIEW_SESSION_REPLAY_HEALTH",
    );
    expect(healthItem).toContain("IconProp.Heartbeat");
    expect((sideMenuSource.match(/title: "Health"/g) ?? []).length).toBe(1);
  });

  test("the page key exists once", () => {
    expect(
      (
        pageMapSource.match(
          /RUM_APPLICATION_VIEW_SESSION_REPLAY_HEALTH = "RUM_APPLICATION_VIEW_SESSION_REPLAY_HEALTH"/g,
        ) ?? []
      ).length,
    ).toBe(1);
  });

  test("the page reads its id one segment from the end and renders the dashboard", () => {
    expect(healthPageSource).toContain("Navigation.getLastParamAsObjectID(1)");
    expect(healthPageSource).toContain(
      "<RecordingHealthDashboard rumApplicationId={modelId} />",
    );
  });
});

describe("the session list no longer carries recording health", () => {
  test("the list page mounts only the table", () => {
    expect(listPageSource).not.toContain("RecordingHealthStrip");
    expect(listPageSource).not.toContain("RecordingHealthCard");
    expect(listPageSource).not.toContain("RecordingHealthDashboard");
    expect(listPageSource).toContain(
      "<SessionReplayTable rumApplicationId={modelId} />",
    );
  });

  test("the strip component is gone rather than left unused", () => {
    expect(
      fs.existsSync(
        path.join(
          dashboardSource,
          "Components/SessionReplay/RecordingHealthStrip.tsx",
        ),
      ),
    ).toBe(false);
  });

  test("an empty list still explains itself from the same health poller", () => {
    const emptyStateSource: string = read(
      "Components/SessionReplay/SessionReplayEmptyState.tsx",
    );

    expect(emptyStateSource).toContain("useSessionReplayHealth(");
  });
});

describe("the policy page keeps a summary and links to the Health page", () => {
  test("the policy page still leads with the recording health card", () => {
    expect(policyPageSource).toContain(
      "<RecordingHealthCard rumApplicationId={modelId} />",
    );
  });

  test("that card is the one-line summary, not a second copy of the page", () => {
    expect(summaryCardSource).toContain("RecordingHealthSummaryView");
    expect(summaryCardSource).toContain('title: "View health details"');
    expect(summaryCardSource).toContain("getRecordingHealthPageRoute(");
    expect(summaryCardSource).not.toContain("buildFacts(");
    expect(summaryCardSource).not.toContain("BytesRow");
  });

  test("the Health page links back to the policy for every setting it shows", () => {
    expect(dashboardComponentSource).toContain('label="Edit policy"');
    expect(dashboardComponentSource).toContain('label="Change budget"');
    expect(dashboardComponentSource).toContain("getReplayPolicyPageRoute(");
  });
});

/*
 * The Storage budget panel's second link: "Set up alerts", to the session
 * replay storage budget alerts on the application's Recommendations page.
 * Whitespace-squashed on top of comment-stripped, because these pin
 * multi-line expressions a prettier re-wrap may reflow.
 */
describe("the Storage budget panel links to its alerts", () => {
  function squash(text: string): string {
    return text.replace(/\s+/g, " ");
  }

  function countOf(text: string, needle: string): number {
    return text.split(needle).length - 1;
  }

  const dashboard: string = squash(dashboardComponentSource);
  const card: string = squash(summaryCardSource);

  // From the panel's test id to the panel after it, then its header alone.
  const storagePanel: string = dashboard.slice(
    dashboard.indexOf('dataTestId="health-bytes"'),
    dashboard.indexOf("<PolicyPanel"),
  );
  const storageHeader: string = storagePanel.slice(
    storagePanel.indexOf("headerRight={"),
    storagePanel.indexOf("<UsageMeterRow"),
  );

  test("the slices below found the panel and its header", () => {
    expect(storagePanel.length).toBeGreaterThan(0);
    expect(storageHeader.startsWith("headerRight={")).toBe(true);
  });

  test("the header stacks Change budget above Set up alerts", () => {
    expect(storageHeader).toContain(
      '<div className="flex flex-col items-end gap-1">',
    );

    const changeIndex: number = storageHeader.indexOf('label="Change budget"');
    const alertsIndex: number = storageHeader.indexOf('label="Set up alerts"');

    expect(changeIndex).toBeGreaterThan(-1);
    expect(alertsIndex).toBeGreaterThan(changeIndex);

    // The second link, on its own: its target, label and test id.
    const alertsLink: string = storageHeader
      .split("{offersBudgetAlerts && (")[1]!
      .split("/>")[0]!;

    expect(alertsLink).toContain("<PanelLink");
    expect(alertsLink).toContain("getBudgetAlertRecommendationsRoute(");
    expect(alertsLink).toContain("props.rumApplicationId");
    expect(alertsLink).toContain('label="Set up alerts"');
    expect(alertsLink).toContain('dataTestId="health-budget-alerts"');
    expect(storageHeader).toContain('dataTestId="health-change-budget"');

    // Once, and only in this panel.
    expect(countOf(dashboard, 'label="Set up alerts"')).toBe(1);
    expect(countOf(dashboard, 'dataTestId="health-budget-alerts"')).toBe(1);
  });

  test("the link is drawn on the fact the Recommendations page offers the alerts on", () => {
    expect(dashboard).toContain(
      "const offersBudgetAlerts: boolean = status !== null && status.policy.isApplicationEnabled && Boolean(status.lastChunkReceivedAt);",
    );
    expect(storageHeader).toContain("{offersBudgetAlerts && (");
  });

  test("the header gains no (i): the link explains itself", () => {
    expect(storageHeader).not.toContain("InfoTooltip");
  });

  test("the route helper sits beside getReplayPolicyPageRoute and opens Recommendations on ?search=budget&status=All", () => {
    const policyIndex: number = card.indexOf(
      "export function getReplayPolicyPageRoute(",
    );
    const helperIndex: number = card.indexOf(
      "export function getBudgetAlertRecommendationsRoute(",
    );

    expect(policyIndex).toBeGreaterThan(-1);
    expect(helperIndex).toBeGreaterThan(policyIndex);

    const helper: string = card.slice(
      helperIndex,
      card.indexOf("export interface SeverityStyle"),
    );

    expect(helper).toContain("RouteUtil.populateRouteParams(");
    expect(helper).toContain(
      "RouteMap[PageMap.RUM_APPLICATION_VIEW_RECOMMENDATIONS] as Route",
    );
    expect(helper).toContain(
      "{ modelId: new ObjectID(rumApplicationId.toString()) }",
    );
    /*
     * status=All: opened on the alerts still to set up (the page's default),
     * a second visit - once they are created - would land on an empty list.
     */
    expect(helper).toContain(
      '.addQueryParams({ search: "budget", status: RecommendationStatusFilter.All, })',
    );
    expect(card).toContain(
      'import { RecommendationStatusFilter } from "../Recommendations/RecommendationViewModel";',
    );

    // One helper, imported from the card rather than rebuilt on the page.
    expect(dashboard).toContain("getBudgetAlertRecommendationsRoute,");
    expect(dashboard).toContain('} from "./RecordingHealthCard";');
    expect(dashboard).not.toContain("RUM_APPLICATION_VIEW_RECOMMENDATIONS");
  });
});

describe("the Health page composition", () => {
  test("hero, pipeline, uploads, storage, policy, recorder and browser diagnostics, in that order", () => {
    const order: Array<string> = [
      "<HealthHero",
      "<RecordingPipeline stages=",
      'dataTestId="health-uploads"',
      'dataTestId="health-bytes"',
      "<PolicyPanel",
      "<RecorderPanel",
      'dataTestId="health-browser-diagnostics"',
    ];

    const viewStart: number = dashboardComponentSource.indexOf(
      "export const RecordingHealthDashboardView",
    );

    expect(viewStart).toBeGreaterThan(-1);

    const view: string = dashboardComponentSource.slice(viewStart);
    let previous: number = -1;

    for (const marker of order) {
      const index: number = view.indexOf(marker);

      expect({ marker, found: index > previous }).toEqual({
        marker,
        found: true,
      });
      previous = index;
    }
  });

  test("the E2E state word keeps its test id", () => {
    expect(dashboardComponentSource).toContain('data-testid="health-level"');
    expect(dashboardComponentSource).toContain('data-testid="health-hero"');
  });

  test("the paste box is drawn without repeating the panel heading", () => {
    expect(dashboardComponentSource).toContain(
      "<RecorderDiagnosticsPasteBox showHeading={false} />",
    );
  });
});

describe("the offline UI fixture serves the page", () => {
  test("the fixture routes session-replay-health to the real page module", () => {
    const fixture: string = fs.readFileSync(
      path.join(repositoryRoot, "E2E/SessionReplay/Fixture/Fixture.js"),
      "utf8",
    );

    expect(fixture).toContain(
      'from "../../../App/FeatureSet/Dashboard/src/Pages/Rum/View/SessionReplayHealth"',
    );
    expect(fixture).toContain(
      '<Route path="session-replay-health" element={<ReplayHealth />} />',
    );
  });
});
