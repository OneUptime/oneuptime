import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import "@testing-library/jest-dom";
import { cleanup } from "@testing-library/react";
import * as React from "react";
import MetricsAISideMenu from "../../../../App/FeatureSet/Dashboard/src/Pages/Metrics/AI/SideMenu";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
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
 * Metrics → AI's side menu, rendered for real against the real RouteMap:
 * the AI section every telemetry product has - what OneUptime found in the
 * metrics (Insights), what OneUptime AI did with it (Logs) and how it is
 * set up (Settings) - beside the page, as Traces → AI draws its own.
 */

async function renderMetricsAiMenu(): Promise<void> {
  await renderMenu(<MetricsAISideMenu />);
}

const FINDING_PATH: string = `/dashboard/${PROJECT_ID}/metrics/ai/insights/5231efef-0000-4000-8000-000000000001`;

describe("Metrics AI side menu", () => {
  beforeEach(() => {
    setViewportWidth(DESKTOP_WIDTH);
    window.localStorage.clear();
    goTo(routeFor(PageMap.METRICS_AI_INSIGHTS));
  });

  afterEach(() => {
    cleanup();
  });

  test("one AI section: Insights, Logs and Settings, under Metrics", async () => {
    await renderMetricsAiMenu();

    expect(sectionTitlesInOrder()).toEqual(["AI"]);
    expect(linksIn("AI")).toEqual([
      { title: "Insights", href: routeFor(PageMap.METRICS_AI_INSIGHTS) },
      { title: "Logs", href: routeFor(PageMap.METRICS_AI_LOGS) },
      { title: "Settings", href: routeFor(PageMap.METRICS_AI_SETTINGS) },
    ]);
  });

  test("its pages live under Metrics' own address", () => {
    expect(RouteMap[PageMap.METRICS_AI_INSIGHTS]?.toString()).toBe(
      "/dashboard/:projectId/metrics/ai/insights",
    );
    expect(RouteMap[PageMap.METRICS_AI_INSIGHT_VIEW]?.toString()).toBe(
      "/dashboard/:projectId/metrics/ai/insights/:id",
    );
    expect(RouteMap[PageMap.METRICS_AI_LOGS]?.toString()).toBe(
      "/dashboard/:projectId/metrics/ai/logs",
    );
    expect(RouteMap[PageMap.METRICS_AI_SETTINGS]?.toString()).toBe(
      "/dashboard/:projectId/metrics/ai/settings",
    );
  });

  test.each([
    [PageMap.METRICS_AI_INSIGHTS, "Insights"],
    [PageMap.METRICS_AI_LOGS, "Logs"],
    [PageMap.METRICS_AI_SETTINGS, "Settings"],
  ])("open on %s, with its page lit", async (page: PageMap, title: string) => {
    goTo(routeFor(page));
    await renderMetricsAiMenu();

    expect(isExpanded("AI")).toBe(true);
    expect(activeLinkTitles()).toEqual([title]);
  });

  test("a finding's own page keeps Insights lit", async () => {
    goTo(FINDING_PATH);
    await renderMetricsAiMenu();

    expect(isExpanded("AI")).toBe(true);
    expect(activeLinkTitles()).toEqual(["Insights"]);
  });

  test("on a phone, a finding's page names where it is: AI / Insights", async () => {
    setViewportWidth(MOBILE_WIDTH);
    goTo(FINDING_PATH);
    await renderMetricsAiMenu();

    expect(mobileSummaryText()).toContain("AI / Insights");
  });
});
