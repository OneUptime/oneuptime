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
