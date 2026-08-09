import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import "@testing-library/jest-dom";
import { act, cleanup, render } from "@testing-library/react";
import * as React from "react";

/*
 * A page's section is stated twice: once by the side menu, which highlights it,
 * and once by the breadcrumb trail above the page body. Moving AI and the rule
 * pages out of Settings changes the first; nothing forces the second to follow.
 * The failure is quiet and permanent — the menu highlights "Rules" while the
 * header still reads "Alerts / Settings / Grouping Rules", and only a user
 * notices.
 *
 * So rather than pinning the trails on their own, this derives the sections
 * from the rendered menu and requires the trails to agree with it. Adding a
 * page to AI or Rules without a matching breadcrumb fails here.
 */
jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      count: () => {
        return Promise.resolve(0);
      },
    },
  };
});

import AlertsSideMenu from "../../../../App/FeatureSet/Dashboard/src/Pages/Alerts/SideMenu";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap, {
  RouteUtil,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import { getAlertsBreadcrumbs } from "../../../../App/FeatureSet/Dashboard/src/Utils/Breadcrumbs/AlertBreadcrumbs";
import Route from "../../../Types/API/Route";
import Link from "../../../Types/Link";
import Navigation from "../../../UI/Utils/Navigation";
import { Location } from "react-router-dom";

const PROJECT_ID: string = "8f2a1b3c-4d5e-4f60-9a7b-1c2d3e4f5a6b";

/*
 * Sections whose entries are configuration pages, keyed by how the trail
 * should name them. The alert/episode/workspace sections predate this change
 * and keep their own hand-written trails.
 */
const CONFIGURATION_SECTIONS: Array<string> = ["AI", "Rules", "Settings"];

function goTo(path: string): void {
  window.history.pushState({}, "", path);
  Navigation.setLocation({
    pathname: path,
    search: "",
    hash: "",
    state: null,
    key: "test",
  } as Location);
}

function populatedRoute(pageMapKey: string): string {
  return RouteUtil.populateRouteParams(
    RouteMap[pageMapKey] as Route,
  ).toString();
}

/*
 * Populated href -> PageMap key, so a link scraped out of the menu can be
 * turned back into the key the breadcrumb map is indexed by. Built per call
 * rather than once at module load: populating a route reads the project id out
 * of the current URL, which is not set until the test starts.
 */
function buildRouteIndex(): Map<string, string> {
  const index: Map<string, string> = new Map();

  Object.keys(RouteMap).forEach((pageMapKey: string) => {
    index.set(populatedRoute(pageMapKey), pageMapKey);
  });

  return index;
}

function trailTitlesFor(pageMapKey: string): Array<string> | undefined {
  /*
   * Trails resolve their links against the live location, so stand on the page
   * being asked about — the same context the app builds them in.
   */
  goTo(populatedRoute(pageMapKey));

  const trail: Array<Link> | undefined = getAlertsBreadcrumbs(
    RouteUtil.getRouteString(pageMapKey),
  );

  return trail?.map((link: Link): string => {
    return link.title;
  });
}

interface MenuEntry {
  section: string;
  title: string;
  pageMapKey: string;
}

async function renderMenuEntries(): Promise<Array<MenuEntry>> {
  render(<AlertsSideMenu />);

  // Let the stubbed badge counts settle so their state updates stay in act().
  await act(async () => {
    await Promise.resolve();
  });

  const routeIndex: Map<string, string> = buildRouteIndex();
  const entries: Array<MenuEntry> = [];

  Array.from(document.querySelectorAll("h6")).forEach(
    (heading: HTMLElement) => {
      const section: string = heading.textContent?.trim() ?? "";
      const root: HTMLElement | null = heading.closest("div.mb-2");

      if (!root) {
        return;
      }

      Array.from(root.querySelectorAll("a")).forEach(
        (anchor: HTMLAnchorElement) => {
          const href: string = anchor.getAttribute("href") ?? "";
          const pageMapKey: string | undefined = routeIndex.get(href);

          if (!pageMapKey) {
            throw new Error(
              `Side-menu link "${anchor.textContent?.trim()}" points at ${href}, which is not in RouteMap.`,
            );
          }

          entries.push({
            section,
            title: (
              anchor.querySelector("span.truncate")?.textContent ?? ""
            ).trim(),
            pageMapKey,
          });
        },
      );
    },
  );

  return entries;
}

describe("Alerts breadcrumbs follow the side menu sections", () => {
  beforeEach(() => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      writable: true,
      value: 1280,
    });
    goTo(`/dashboard/${PROJECT_ID}/alerts`);
  });

  afterEach(() => {
    cleanup();
  });

  test("the AI pages are named AI, not Settings", () => {
    expect(trailTitlesFor(PageMap.ALERTS_SETTINGS_AI)).toEqual([
      "Project",
      "Alerts",
      "AI",
      "Investigation",
    ]);

    expect(
      trailTitlesFor(PageMap.ALERTS_SETTINGS_AUTO_REMEDIATION_RULES),
    ).toEqual(["Project", "Alerts", "AI", "Remediation"]);
  });

  test("every rule page is named Rules, not Settings", () => {
    const rulePages: Array<[string, string]> = [
      [PageMap.ALERTS_SETTINGS_GROUPING_RULES, "Grouping Rules"],
      [PageMap.ALERTS_SETTINGS_ON_CALL_RULES, "On-Call Rules"],
      [PageMap.ALERTS_SETTINGS_OWNER_RULES, "Owner Rules"],
      [PageMap.ALERTS_SETTINGS_RUNBOOK_RULES, "Runbook Rules"],
      [PageMap.ALERTS_SETTINGS_PRIVACY_RULES, "Privacy Rules"],
      [PageMap.ALERTS_SETTINGS_LABEL_RULES, "Label Rules"],
      [PageMap.ALERTS_SETTINGS_REMINDER_RULES, "Reminder Rules"],
    ];

    rulePages.forEach(([pageMapKey, title]: [string, string]) => {
      expect(trailTitlesFor(pageMapKey)).toEqual([
        "Project",
        "Alerts",
        "Rules",
        title,
      ]);
    });
  });

  test("the pages left behind in Settings are still named Settings", () => {
    const settingsPages: Array<[string, string]> = [
      [PageMap.ALERTS_SETTINGS_STATE, "Alert State"],
      [PageMap.ALERTS_SETTINGS_SEVERITY, "Alert Severity"],
      [PageMap.ALERTS_SETTINGS_NOTE_TEMPLATES, "Note Templates"],
      [PageMap.ALERTS_SETTINGS_CUSTOM_FIELDS, "Custom Fields"],
    ];

    settingsPages.forEach(([pageMapKey, title]: [string, string]) => {
      expect(trailTitlesFor(pageMapKey)).toEqual([
        "Project",
        "Alerts",
        "Settings",
        title,
      ]);
    });
  });

  test("no alert trail still files an AI or rule page under Settings", () => {
    const movedPages: Array<string> = [
      PageMap.ALERTS_SETTINGS_AI,
      PageMap.ALERTS_SETTINGS_AUTO_REMEDIATION_RULES,
      PageMap.ALERTS_SETTINGS_GROUPING_RULES,
      PageMap.ALERTS_SETTINGS_ON_CALL_RULES,
      PageMap.ALERTS_SETTINGS_OWNER_RULES,
      PageMap.ALERTS_SETTINGS_RUNBOOK_RULES,
      PageMap.ALERTS_SETTINGS_PRIVACY_RULES,
      PageMap.ALERTS_SETTINGS_LABEL_RULES,
      PageMap.ALERTS_SETTINGS_REMINDER_RULES,
    ];

    movedPages.forEach((pageMapKey: string) => {
      expect(trailTitlesFor(pageMapKey)).not.toContain("Settings");
    });
  });

  /*
   * The cross-check. Everything above pins one side; this one requires the two
   * sides to say the same thing, so a page added to AI or Rules later cannot
   * quietly keep a Settings trail (or no trail at all).
   */
  test("every AI and Rules entry has a trail naming its menu section and title", async () => {
    const entries: Array<MenuEntry> = await renderMenuEntries();

    const configurationEntries: Array<MenuEntry> = entries.filter(
      (entry: MenuEntry): boolean => {
        return CONFIGURATION_SECTIONS.includes(entry.section);
      },
    );

    // Guard against a vacuous pass if the menu stops rendering these sections.
    expect(configurationEntries.length).toBeGreaterThanOrEqual(14);

    const withoutTrails: Array<string> = [];

    configurationEntries.forEach((entry: MenuEntry) => {
      const titles: Array<string> | undefined = trailTitlesFor(
        entry.pageMapKey,
      );

      if (!titles) {
        withoutTrails.push(`${entry.section} / ${entry.title}`);
        return;
      }

      expect(titles).toEqual(["Project", "Alerts", entry.section, entry.title]);
    });

    /*
     * "More Settings" is the one configuration page that has never had a
     * trail. Listing it explicitly means any *other* page losing its trail
     * fails here rather than being silently tolerated.
     */
    expect(withoutTrails).toEqual(["Settings / More Settings"]);
  });

  test("every crumb resolves to a concrete route with no unfilled params", () => {
    const trail: Array<Link> | undefined = ((): Array<Link> | undefined => {
      goTo(populatedRoute(PageMap.ALERTS_SETTINGS_GROUPING_RULES));
      return getAlertsBreadcrumbs(
        RouteUtil.getRouteString(PageMap.ALERTS_SETTINGS_GROUPING_RULES),
      );
    })();

    expect(trail).toBeDefined();

    trail?.forEach((link: Link) => {
      expect(link.to.toString()).not.toContain(":");
      expect(link.to.toString().startsWith("/dashboard/")).toBe(true);
    });
  });
});
