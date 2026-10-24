import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import "@testing-library/jest-dom";
import { cleanup } from "@testing-library/react";
import * as React from "react";
import ProfilesSideMenu from "../../../../App/FeatureSet/Dashboard/src/Pages/Profiles/SideMenu";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
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
 * The Profiler's side menu, rendered for real against the real RouteMap: its
 * own pages, then - like every product's menu - an AI section of its own:
 * what OneUptime found (Insights), what OneUptime AI did with it (Logs) and
 * how it is set up (Settings, with the AI rules under More settings). The
 * section folds to its title until opened, and opens by itself on its pages.
 */

async function renderProfilesMenu(): Promise<void> {
  await renderMenu(<ProfilesSideMenu />);
}

describe("Profiler side menu", () => {
  beforeEach(() => {
    setViewportWidth(DESKTOP_WIDTH);
    window.localStorage.clear();
    goTo(`/dashboard/${PROJECT_ID}/profiles`);
  });

  afterEach(() => {
    cleanup();
  });

  test("the Profiler's pages, then its AI section, then help", async () => {
    await renderProfilesMenu();

    expect(sectionTitlesInOrder()).toEqual(["Profiler", "AI", "Help"]);
    expect(linksIn("Profiler")).toEqual([
      { title: "Overview", href: routeFor(PageMap.PROFILES) },
      { title: "All profiles", href: routeFor(PageMap.PROFILES_INSIGHTS) },
    ]);
  });

  test("the AI section holds what OneUptime found, what it did, and its settings", async () => {
    await renderProfilesMenu();

    expect(linksIn("AI")).toEqual([
      { title: "Insights", href: routeFor(PageMap.PROFILES_AI_INSIGHTS) },
      { title: "Logs", href: routeFor(PageMap.PROFILES_AI_LOGS) },
      { title: "Settings", href: routeFor(PageMap.PROFILES_AI_SETTINGS) },
    ]);
    expect(routeFor(PageMap.PROFILES_AI_SETTINGS)).toBe(
      `/dashboard/${PROJECT_ID}/profiles/ai/settings`,
    );
  });

  test("folded on the Profiler's own pages, as every AI section is", async () => {
    await renderProfilesMenu();

    expect(isExpanded("Profiler")).toBe(true);
    expect(isExpanded("AI")).toBe(false);
  });

  test.each([
    [PageMap.PROFILES_AI_INSIGHTS, "Insights"],
    [PageMap.PROFILES_AI_LOGS, "Logs"],
    [PageMap.PROFILES_AI_SETTINGS, "Settings"],
  ])(
    "open by itself on %s, with its page lit",
    async (page: PageMap, title: string) => {
      goTo(routeFor(page));
      await renderProfilesMenu();

      expect(isExpanded("AI")).toBe(true);
      expect(activeLinkTitles()).toEqual([title]);
    },
  );

  /*
   * A finding's own page is one of the Insights: the UI review found no
   * entry lit there, and a phone's menu button saying only "Navigation".
   */
  const FINDING_PATH: string = `/dashboard/${PROJECT_ID}/profiles/ai/insights/5092efef-0000-4000-8000-000000000001`;

  test("a finding's own page keeps Insights lit, and the AI section open", async () => {
    goTo(FINDING_PATH);
    await renderProfilesMenu();

    expect(isExpanded("AI")).toBe(true);
    expect(activeLinkTitles()).toEqual(["Insights"]);
  });

  test("on a phone, a finding's page names where it is: AI / Insights", async () => {
    setViewportWidth(MOBILE_WIDTH);
    goTo(FINDING_PATH);
    await renderProfilesMenu();

    expect(mobileSummaryText()).toContain("AI / Insights");
  });
});
