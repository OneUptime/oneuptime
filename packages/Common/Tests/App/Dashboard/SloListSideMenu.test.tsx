import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import "@testing-library/jest-dom";
import { cleanup, fireEvent } from "@testing-library/react";
import * as React from "react";
import SloListSideMenu from "../../../../App/FeatureSet/Dashboard/src/Pages/Slo/SideMenu";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import {
  DESKTOP_WIDTH,
  MOBILE_WIDTH,
  activeLinkTitles,
  goTo,
  isExpanded,
  linksIn,
  mobileSummaryText,
  renderMenu,
  routeFor,
  sectionBody,
  sectionTitlesInOrder,
  sectionToggle,
  setViewportWidth,
} from "./SideMenuHarness";

/*
 * The SLO list menu was the one product menu whose Settings section started
 * open, because it was written as hand-rolled <SideMenuSection> JSX that never
 * set `defaultCollapsed`. Collapsing it is only half the job: a hand-rolled
 * section is not told whether it holds the current page, so collapsing it
 * naively would also hide Owner Rules and Label Rules while you are on them.
 *
 * These render the real menu against the real RouteMap and check both halves.
 *
 * Archived SLOs are reached from an Advanced section of their own, which
 * starts collapsed like every Advanced section and opens by itself on the
 * Archived page.
 */

async function renderSloMenuAt(pageMapKey: string): Promise<void> {
  goTo(routeFor(pageMapKey));
  await renderMenu(<SloListSideMenu />);
}

describe("SLO list side menu", () => {
  beforeEach(() => {
    setViewportWidth(DESKTOP_WIDTH);
  });

  afterEach(() => {
    cleanup();
  });

  test("renders the SLO pages, then Settings, then Advanced, then Developer", async () => {
    await renderSloMenuAt(PageMap.SLOS);

    expect(sectionTitlesInOrder()).toEqual([
      "Service Level Objectives",
      "Settings",
      "Advanced",
      "Developer",
    ]);
    expect(linksIn("Service Level Objectives")).toEqual([
      { title: "SLOs", href: routeFor(PageMap.SLOS) },
    ]);
    expect(linksIn("Advanced")).toEqual([
      { title: "Archived", href: routeFor(PageMap.SLOS_ARCHIVED) },
    ]);
    expect(linksIn("Settings")).toEqual([
      {
        title: "Owner Rules",
        href: routeFor(PageMap.SLOS_SETTINGS_OWNER_RULES),
      },
      {
        title: "Label Rules",
        href: routeFor(PageMap.SLOS_SETTINGS_LABEL_RULES),
      },
    ]);
  });

  test.each([PageMap.SLOS, PageMap.SLOS_ARCHIVED])(
    "on %s the SLO pages are open and Settings is collapsed",
    async (pageMapKey: string) => {
      await renderSloMenuAt(pageMapKey);

      expect(isExpanded("Service Level Objectives")).toBe(true);
      expect(isExpanded("Settings")).toBe(false);
      expect(sectionBody("Settings")).toHaveClass("max-h-0", "opacity-0");
    },
  );

  test.each([
    PageMap.SLOS_SETTINGS_OWNER_RULES,
    PageMap.SLOS_SETTINGS_LABEL_RULES,
  ])(
    "on %s Settings opens so the current page stays visible",
    async (pageMapKey: string) => {
      await renderSloMenuAt(pageMapKey);

      expect(isExpanded("Settings")).toBe(true);
      expect(sectionBody("Settings")).not.toHaveClass("max-h-0");
    },
  );

  test("on the SLO list, Advanced is collapsed with Archived folded away", async () => {
    await renderSloMenuAt(PageMap.SLOS);

    expect(isExpanded("Advanced")).toBe(false);
    expect(sectionBody("Advanced")).toHaveClass(
      "max-h-0",
      "opacity-0",
      "invisible",
    );
  });

  test("on the Archived page, Advanced opens so the current page stays visible", async () => {
    await renderSloMenuAt(PageMap.SLOS_ARCHIVED);

    expect(isExpanded("Advanced")).toBe(true);
    expect(sectionBody("Advanced")).not.toHaveClass("max-h-0");
    expect(sectionBody("Advanced")).not.toHaveClass("invisible");
    expect(activeLinkTitles()).toEqual(["Archived"]);
  });

  test("on a phone the menu summary names Advanced / Archived on the Archived page", async () => {
    setViewportWidth(MOBILE_WIDTH);
    await renderSloMenuAt(PageMap.SLOS_ARCHIVED);

    expect(mobileSummaryText()).toContain("Advanced / Archived");
  });

  test("the collapsed Settings section opens and closes from its heading", async () => {
    await renderSloMenuAt(PageMap.SLOS);

    fireEvent.click(sectionToggle("Settings"));
    expect(isExpanded("Settings")).toBe(true);

    fireEvent.click(sectionToggle("Settings"));
    expect(isExpanded("Settings")).toBe(false);
  });

  /*
   * Collapsed is a style, not an unmount, so the Settings links stay in the
   * DOM (and in the tab order's reach once opened) rather than being dropped.
   */
  test("the Settings links stay mounted while collapsed", async () => {
    await renderSloMenuAt(PageMap.SLOS);

    expect(isExpanded("Settings")).toBe(false);
    expect(linksIn("Settings")).toHaveLength(2);
  });

  test("on a phone the menu summary still names the Settings page you are on", async () => {
    setViewportWidth(MOBILE_WIDTH);
    await renderSloMenuAt(PageMap.SLOS_SETTINGS_LABEL_RULES);

    expect(mobileSummaryText()).toContain("Settings / Label Rules");
  });
});
