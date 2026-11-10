import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import "@testing-library/jest-dom";
import { cleanup } from "@testing-library/react";
import * as React from "react";
import DataObservabilitySideMenu from "../../../../App/FeatureSet/Dashboard/src/Pages/DataObservability/SideMenu";
import {
  DATA_OBSERVABILITY_LANDING_PAGE,
  DATA_OBSERVABILITY_MENU,
  DataObservabilityMenuItem,
  getDataObservabilityMenuItems,
  getDataObservabilityMenuSectionFor,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/DataObservabilityNavigation";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import {
  DESKTOP_WIDTH,
  PROJECT_ID,
  activeLinkTitles,
  goTo,
  isExpanded,
  linksIn,
  renderMenu,
  sectionTitlesInOrder,
  setViewportWidth,
} from "./SideMenuHarness";

/*
 * THE DATA OBSERVABILITY MENU: SEVENTEEN PAGES IN SECTIONS A DATA ENGINEER
 * READS IN ORDER.
 *
 * Eleven entries stood in one section, Unused Tables and the rules folded
 * under Advanced. Now: the everyday pages (is anything wrong, what is
 * watched and where it comes from), then Quality (the rules the data must
 * keep) and Usage (who relies on it, what it costs), open; Rules, Help and
 * Advanced folded to their titles, each opening by itself on its own
 * pages. Every page the menu had is still in it.
 */

const DO: string = `/dashboard/${PROJECT_ID}/data-observability`;

beforeEach(() => {
  setViewportWidth(DESKTOP_WIDTH);
});

afterEach(() => {
  cleanup();
});

describe("the sections and their pages", () => {
  test("in the order a data engineer asks: what is wrong, the rules the data keeps, who relies on it", async () => {
    goTo(`${DO}/overview`);
    await renderMenu(<DataObservabilitySideMenu />);

    expect(sectionTitlesInOrder()).toEqual([
      "Data Observability",
      "Quality",
      "Usage",
      "Rules",
      "Help",
      "Advanced",
    ]);
    expect(linksIn("Data Observability")).toEqual([
      { title: "Overview", href: `${DO}/overview` },
      { title: "Tables", href: `${DO}/tables` },
      { title: "Pipelines", href: `${DO}/pipelines` },
      { title: "Schema Changes", href: `${DO}/schema-changes` },
      { title: "Databases", href: `${DO}/stores` },
      { title: "Storage Paths", href: `${DO}/storage-paths` },
    ]);
    expect(linksIn("Quality")).toEqual([
      { title: "Checks", href: `${DO}/checks` },
      { title: "Reconciliations", href: `${DO}/reconciliations` },
    ]);
    expect(linksIn("Usage")).toEqual([
      { title: "Data Products", href: `${DO}/data-products` },
      { title: "BI Dashboards", href: `${DO}/bi-dashboards` },
      { title: "Warehouse Spend", href: `${DO}/spend` },
      { title: "Unused Tables", href: `${DO}/tables/unused` },
    ]);
    expect(linksIn("Rules")).toEqual([
      { title: "Owner Rules", href: `${DO}/settings/owner-rules` },
      { title: "Label Rules", href: `${DO}/settings/label-rules` },
    ]);
    expect(linksIn("Help")).toEqual([
      { title: "Documentation", href: `${DO}/documentation` },
    ]);
    expect(linksIn("Advanced")).toEqual([
      { title: "Settings", href: `${DO}/settings` },
      { title: "Dropped Tables", href: `${DO}/tables/dropped` },
    ]);
  });

  test("on the Overview: the everyday sections open, the rest folded to their titles", async () => {
    goTo(`${DO}/overview`);
    await renderMenu(<DataObservabilitySideMenu />);

    expect(isExpanded("Data Observability")).toBe(true);
    expect(isExpanded("Quality")).toBe(true);
    expect(isExpanded("Usage")).toBe(true);
    expect(isExpanded("Rules")).toBe(false);
    expect(isExpanded("Help")).toBe(false);
    expect(isExpanded("Advanced")).toBe(false);
    expect(activeLinkTitles()).toEqual(["Overview"]);
  });

  test.each([
    ["settings/owner-rules", "Rules", "Owner Rules"],
    ["settings/label-rules", "Rules", "Label Rules"],
    ["documentation", "Help", "Documentation"],
    ["settings", "Advanced", "Settings"],
    ["tables/dropped", "Advanced", "Dropped Tables"],
  ])(
    "a folded section opens by itself on its page (%s), marked",
    async (path: string, section: string, title: string) => {
      goTo(`${DO}/${path}`);
      await renderMenu(<DataObservabilitySideMenu />);

      expect(isExpanded(section)).toBe(true);
      expect(activeLinkTitles()).toEqual([title]);
    },
  );
});

describe("the menu as data", () => {
  test("seventeen pages, each once - every page the menu had before", () => {
    const pages: Array<PageMap> = getDataObservabilityMenuItems().map(
      (item: DataObservabilityMenuItem): PageMap => {
        return item.page;
      },
    );

    expect(new Set(pages).size).toBe(pages.length);
    expect([...pages].sort()).toEqual(
      [
        PageMap.DATA_OBSERVABILITY_OVERVIEW,
        PageMap.DATA_OBSERVABILITY_DATA_PRODUCTS,
        PageMap.DATA_OBSERVABILITY_TABLES,
        PageMap.DATA_OBSERVABILITY_CHECKS,
        PageMap.DATA_OBSERVABILITY_RECONCILIATIONS,
        PageMap.DATA_OBSERVABILITY_PIPELINES,
        PageMap.DATA_OBSERVABILITY_BI_DASHBOARDS,
        PageMap.DATA_OBSERVABILITY_SPEND,
        PageMap.DATA_OBSERVABILITY_SCHEMA_CHANGES,
        PageMap.DATA_OBSERVABILITY_STORES,
        PageMap.DATA_OBSERVABILITY_STORAGE_PATHS,
        PageMap.DATA_OBSERVABILITY_DOCUMENTATION,
        PageMap.DATA_OBSERVABILITY_TABLES_UNUSED,
        PageMap.DATA_OBSERVABILITY_TABLES_DROPPED,
        PageMap.DATA_OBSERVABILITY_SETTINGS,
        PageMap.DATA_OBSERVABILITY_SETTINGS_OWNER_RULES,
        PageMap.DATA_OBSERVABILITY_SETTINGS_LABEL_RULES,
      ].sort(),
    );
  });

  test("no section is longer than six entries, and the product opens on its Overview", () => {
    for (const section of DATA_OBSERVABILITY_MENU) {
      expect(section.items.length).toBeLessThanOrEqual(6);
    }

    expect(DATA_OBSERVABILITY_LANDING_PAGE).toBe(
      PageMap.DATA_OBSERVABILITY_OVERVIEW,
    );
    expect(DATA_OBSERVABILITY_MENU[0]!.items[0]!.page).toBe(
      DATA_OBSERVABILITY_LANDING_PAGE,
    );
  });

  test("each page's section, and none for a page the menu does not list", () => {
    expect(
      getDataObservabilityMenuSectionFor(PageMap.DATA_OBSERVABILITY_CHECKS)
        ?.title,
    ).toBe("Quality");
    expect(
      getDataObservabilityMenuSectionFor(PageMap.DATA_OBSERVABILITY_SPEND)
        ?.title,
    ).toBe("Usage");
    expect(
      getDataObservabilityMenuSectionFor(PageMap.DATA_OBSERVABILITY_TABLE_VIEW),
    ).toBeUndefined();
    expect(getDataObservabilityMenuSectionFor(undefined)).toBeUndefined();
  });
});
