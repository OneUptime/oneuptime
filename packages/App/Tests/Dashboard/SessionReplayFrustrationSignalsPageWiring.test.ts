import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The Frustration Signals page (issue #6443) is reached only through
 * hand-written wirings no runtime value exposes: a side menu item in the
 * Session Replay category, a page module that reads its application from
 * the route, and the edit gate on the one column it saves. Each fails
 * silently - a page nobody can find, the wrong application's settings, or
 * switches that look editable to a reader the server will refuse. Same
 * source-text shape as SessionReplayHealthPageWiring.test.ts.
 */

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
const pageSource: string = read(
  "Pages/Rum/View/SessionReplayFrustrationSignals.tsx",
);
const hookSource: string = read(
  "Components/SessionReplay/FrustrationSignals/useFrustrationSettings.ts",
);
const pageMapSource: string = read("Utils/PageMap.ts");

describe("the Frustration Signals page is reachable", () => {
  test("the side menu lists it in Session Replay, right after Replay Policy", () => {
    const policyIndex: number = sideMenuSource.indexOf(
      'title: "Replay Policy"',
    );
    const signalsIndex: number = sideMenuSource.indexOf(
      'title: "Frustration Signals"',
    );
    const accessLogIndex: number = sideMenuSource.indexOf(
      'title: "Replay Access Log"',
    );
    const settingsSectionIndex: number = sideMenuSource.indexOf(
      'SideMenuSection title="Settings"',
    );

    expect(policyIndex).toBeGreaterThan(-1);
    expect(signalsIndex).toBeGreaterThan(policyIndex);
    expect(accessLogIndex).toBeGreaterThan(signalsIndex);
    expect(settingsSectionIndex).toBeGreaterThan(accessLogIndex);

    const item: string = sideMenuSource.slice(signalsIndex, accessLogIndex);

    expect(item).toContain(
      "PageMap.RUM_APPLICATION_VIEW_SESSION_REPLAY_FRUSTRATION_SIGNALS",
    );
    expect(item).toContain("IconProp.FaceFrown");
    expect(
      (sideMenuSource.match(/title: "Frustration Signals"/g) ?? []).length,
    ).toBe(1);
  });

  test("the page key exists once", () => {
    expect(
      (
        pageMapSource.match(
          /RUM_APPLICATION_VIEW_SESSION_REPLAY_FRUSTRATION_SIGNALS = "RUM_APPLICATION_VIEW_SESSION_REPLAY_FRUSTRATION_SIGNALS"/g,
        ) ?? []
      ).length,
    ).toBe(1);
  });

  test("the page reads its id one segment from the end and renders the settings", () => {
    expect(pageSource).toContain("Navigation.getLastParamAsObjectID(1)");
    expect(pageSource).toContain(
      "<FrustrationSignalsSettings rumApplicationId={modelId} />",
    );
  });
});

describe("the page saves one column, behind that column's own gate", () => {
  test("it reads and writes RumApplication.sessionReplayFrustrationSignals only", () => {
    expect(hookSource).toContain("sessionReplayFrustrationSignals: true");
    expect(hookSource).toContain(
      "sessionReplayFrustrationSignals: next as unknown as JSONObject",
    );
    expect(hookSource).toContain("ModelAPI.updateById<RumApplication>");
  });

  test("the edit gate is the column's update gate, not the record's", () => {
    expect(hookSource).toContain("PermissionGate.checkColumnUpdate(");
    expect(hookSource).toContain('"sessionReplayFrustrationSignals"');
  });
});
