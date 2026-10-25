import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import "@testing-library/jest-dom";
import { cleanup } from "@testing-library/react";
import * as React from "react";
import LogsAISideMenu from "../../../../App/FeatureSet/Dashboard/src/Pages/Logs/AI/SideMenu";
import { TELEMETRY_AI_PAGES } from "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryAi/TelemetryAiCopy";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import { TelemetryAiLane } from "../../../Types/AI/TelemetryAi";
import {
  DESKTOP_WIDTH,
  MOBILE_WIDTH,
  PROJECT_ID,
  activeLinkTitles,
  goTo,
  isExpanded,
  linksIn,
  mobileSummaryText,
  renderMenu,
  routeFor,
  sectionTitlesInOrder,
  setViewportWidth,
} from "./SideMenuHarness";

/*
 * Logs → AI's side menu, rendered for real against the real RouteMap: the
 * AI section every telemetry product has - what OneUptime found in the logs
 * (Insights), what OneUptime AI did with it and how it is set up (Settings)
 * - beside the page, as Logs → Settings draws its own. The record of what
 * OneUptime AI did is "Activity" here: inside Logs, a page called Logs would
 * read as log lines.
 */

async function renderLogsAiMenu(): Promise<void> {
  await renderMenu(<LogsAISideMenu />);
}

const FINDING_PATH: string = `/dashboard/${PROJECT_ID}/logs/ai/insights/5a770000-0000-4000-8000-000000000001`;

describe("Logs AI side menu", () => {
  beforeEach(() => {
    setViewportWidth(DESKTOP_WIDTH);
    window.localStorage.clear();
    goTo(routeFor(PageMap.LOGS_AI_INSIGHTS));
  });

  afterEach(() => {
    cleanup();
  });

  test("one AI section: Insights, Activity and Settings, under Logs", async () => {
    await renderLogsAiMenu();

    expect(sectionTitlesInOrder()).toEqual(["AI"]);
    expect(linksIn("AI")).toEqual([
      { title: "Insights", href: routeFor(PageMap.LOGS_AI_INSIGHTS) },
      { title: "Activity", href: routeFor(PageMap.LOGS_AI_ACTIVITY) },
      { title: "Settings", href: routeFor(PageMap.LOGS_AI_SETTINGS) },
    ]);
  });

  test("no menu entry inside Logs is called Logs", async () => {
    await renderLogsAiMenu();

    expect(
      linksIn("AI").map((link: { title: string }): string => {
        return link.title;
      }),
    ).not.toContain("Logs");
  });

  test("its pages live under Logs' own address, and are the lane's", () => {
    expect(RouteMap[PageMap.LOGS_AI_INSIGHTS]?.toString()).toBe(
      "/dashboard/:projectId/logs/ai/insights",
    );
    expect(RouteMap[PageMap.LOGS_AI_INSIGHT_VIEW]?.toString()).toBe(
      "/dashboard/:projectId/logs/ai/insights/:id",
    );
    expect(RouteMap[PageMap.LOGS_AI_ACTIVITY]?.toString()).toBe(
      "/dashboard/:projectId/logs/ai/activity",
    );
    expect(RouteMap[PageMap.LOGS_AI_SETTINGS]?.toString()).toBe(
      "/dashboard/:projectId/logs/ai/settings",
    );
    expect(TELEMETRY_AI_PAGES[TelemetryAiLane.Log]).toEqual({
      insights: PageMap.LOGS_AI_INSIGHTS,
      insightView: PageMap.LOGS_AI_INSIGHT_VIEW,
      logs: PageMap.LOGS_AI_ACTIVITY,
      settings: PageMap.LOGS_AI_SETTINGS,
    });
  });

  test.each([
    [PageMap.LOGS_AI_INSIGHTS, "Insights"],
    [PageMap.LOGS_AI_ACTIVITY, "Activity"],
    [PageMap.LOGS_AI_SETTINGS, "Settings"],
  ])("open on %s, with its page lit", async (page: PageMap, title: string) => {
    goTo(routeFor(page));
    await renderLogsAiMenu();

    expect(isExpanded("AI")).toBe(true);
    expect(activeLinkTitles()).toEqual([title]);
  });

  test("a finding's own page keeps Insights lit", async () => {
    goTo(FINDING_PATH);
    await renderLogsAiMenu();

    expect(isExpanded("AI")).toBe(true);
    expect(activeLinkTitles()).toEqual(["Insights"]);
  });

  test("on a phone, a finding's page names where it is: AI / Insights", async () => {
    setViewportWidth(MOBILE_WIDTH);
    goTo(FINDING_PATH);
    await renderLogsAiMenu();

    expect(mobileSummaryText()).toContain("AI / Insights");
  });
});
