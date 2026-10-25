import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import "@testing-library/jest-dom";
import { cleanup } from "@testing-library/react";
import * as React from "react";
import ExceptionsAISideMenu from "../../../../App/FeatureSet/Dashboard/src/Pages/Exceptions/AI/SideMenu";
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
 * Exceptions → AI's side menu, rendered for real against the real RouteMap:
 * the AI section every telemetry product has - what OneUptime found in the
 * exceptions (Insights), what OneUptime AI did with it (Logs) and how it is
 * set up (Settings) - beside the page, as Traces → AI draws its own.
 */

async function renderExceptionsAiMenu(): Promise<void> {
  await renderMenu(<ExceptionsAISideMenu />);
}

const FINDING_PATH: string = `/dashboard/${PROJECT_ID}/exceptions/ai/insights/5240abab-0000-4000-8000-000000000001`;

describe("Exceptions AI side menu", () => {
  beforeEach(() => {
    setViewportWidth(DESKTOP_WIDTH);
    window.localStorage.clear();
    goTo(routeFor(PageMap.EXCEPTIONS_AI_INSIGHTS));
  });

  afterEach(() => {
    cleanup();
  });

  test("one AI section: Insights, Logs and Settings, under Exceptions", async () => {
    await renderExceptionsAiMenu();

    expect(sectionTitlesInOrder()).toEqual(["AI"]);
    expect(linksIn("AI")).toEqual([
      { title: "Insights", href: routeFor(PageMap.EXCEPTIONS_AI_INSIGHTS) },
      { title: "Logs", href: routeFor(PageMap.EXCEPTIONS_AI_LOGS) },
      { title: "Settings", href: routeFor(PageMap.EXCEPTIONS_AI_SETTINGS) },
    ]);
  });

  test("its pages live under Exceptions' own address", () => {
    expect(RouteMap[PageMap.EXCEPTIONS_AI_INSIGHTS]?.toString()).toBe(
      "/dashboard/:projectId/exceptions/ai/insights",
    );
    expect(RouteMap[PageMap.EXCEPTIONS_AI_INSIGHT_VIEW]?.toString()).toBe(
      "/dashboard/:projectId/exceptions/ai/insights/:id",
    );
    expect(RouteMap[PageMap.EXCEPTIONS_AI_LOGS]?.toString()).toBe(
      "/dashboard/:projectId/exceptions/ai/logs",
    );
    expect(RouteMap[PageMap.EXCEPTIONS_AI_SETTINGS]?.toString()).toBe(
      "/dashboard/:projectId/exceptions/ai/settings",
    );
  });

  test.each([
    [PageMap.EXCEPTIONS_AI_INSIGHTS, "Insights"],
    [PageMap.EXCEPTIONS_AI_LOGS, "Logs"],
    [PageMap.EXCEPTIONS_AI_SETTINGS, "Settings"],
  ])("open on %s, with its page lit", async (page: PageMap, title: string) => {
    goTo(routeFor(page));
    await renderExceptionsAiMenu();

    expect(isExpanded("AI")).toBe(true);
    expect(activeLinkTitles()).toEqual([title]);
  });

  test("a finding's own page keeps Insights lit", async () => {
    goTo(FINDING_PATH);
    await renderExceptionsAiMenu();

    expect(isExpanded("AI")).toBe(true);
    expect(activeLinkTitles()).toEqual(["Insights"]);
  });

  test("on a phone, a finding's page names where it is: AI / Insights", async () => {
    setViewportWidth(MOBILE_WIDTH);
    goTo(FINDING_PATH);
    await renderExceptionsAiMenu();

    expect(mobileSummaryText()).toContain("AI / Insights");
  });
});
