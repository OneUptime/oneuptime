import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import "@testing-library/jest-dom";
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import * as React from "react";

/*
 * The alerts side menu is the only map users have of the alerts product, and
 * the reorganisation that split AI and Rules out of Settings is exactly the
 * kind of change that silently drops a page: an entry moved into a new section
 * but never added, or added twice, or pointed at the wrong route. Nothing about
 * any of those looks wrong in a diff.
 *
 * So these render the real component against the real RouteMap rather than
 * asserting on its source, and every href is compared to the route the page is
 * actually registered under. The last test in "coverage" is the important one:
 * it pins the full set of settings pages that were reachable before the move,
 * so a page can be re-sectioned freely but never lost.
 *
 * ModelAPI.count backs the two badge entries ("Active Alerts", "Active
 * Episodes"); it is stubbed so the menu renders without a server. The counts
 * themselves are CountModelSideMenuItem's concern, not this file's.
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
import Route from "../../../Types/API/Route";
import Navigation from "../../../UI/Utils/Navigation";
import { Location } from "react-router-dom";

/*
 * Project ids are UUIDs; ProjectUtil rejects anything else, leaving the
 * menu's hrefs stuck on the literal ":projectId" placeholder.
 */
const PROJECT_ID: string = "8f2a1b3c-4d5e-4f60-9a7b-1c2d3e4f5a6b";

const DESKTOP_WIDTH: number = 1280;
const MOBILE_WIDTH: number = 375;

// The href the menu must produce for a page, from the app's own route table.
function routeFor(pageMapKey: string): string {
  return RouteUtil.populateRouteParams(
    RouteMap[pageMapKey] as Route,
  ).toString();
}

/*
 * Two sources of truth to keep in step: the menu items read window.location
 * (through RouteUtil/ProjectUtil) while active-item detection reads the
 * react-router Location that the app normally pushes into Navigation.
 */
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

function setViewportWidth(width: number): void {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    writable: true,
    value: width,
  });
}

function headings(): Array<HTMLElement> {
  return Array.from(document.querySelectorAll("h6"));
}

function sectionTitlesInOrder(): Array<string> {
  return headings().map((heading: HTMLElement): string => {
    return heading.textContent?.trim() ?? "";
  });
}

function sectionRoot(title: string): HTMLElement {
  const heading: HTMLElement | undefined = headings().find(
    (candidate: HTMLElement): boolean => {
      return candidate.textContent?.trim() === title;
    },
  );

  if (!heading) {
    throw new Error(
      `No side-menu section titled "${title}". Sections rendered: ${sectionTitlesInOrder().join(", ")}`,
    );
  }

  const root: HTMLElement | null = heading.closest("div.mb-2");

  if (!root) {
    throw new Error(`Section "${title}" is not wrapped in a section element.`);
  }

  return root;
}

function sectionToggle(title: string): HTMLElement {
  const toggle: HTMLElement | null = sectionRoot(title).querySelector("button");

  if (!toggle) {
    throw new Error(`Section "${title}" has no collapse toggle.`);
  }

  return toggle;
}

// The element SideMenuSection collapses — it stays mounted, so "hidden" is a class.
function sectionBody(title: string): HTMLElement {
  const body: Element | null = sectionToggle(title).nextElementSibling;

  if (!body) {
    throw new Error(`Section "${title}" has no content element.`);
  }

  return body as HTMLElement;
}

function isExpanded(title: string): boolean {
  return sectionToggle(title).getAttribute("aria-expanded") === "true";
}

interface MenuLink {
  title: string;
  href: string;
}

function linksIn(title: string): Array<MenuLink> {
  return Array.from(sectionRoot(title).querySelectorAll("a")).map(
    (anchor: HTMLAnchorElement): MenuLink => {
      return {
        title: (
          anchor.querySelector("span.truncate")?.textContent ??
          anchor.textContent ??
          ""
        ).trim(),
        href: anchor.getAttribute("href") ?? "",
      };
    },
  );
}

function allLinks(): Array<MenuLink> {
  return sectionTitlesInOrder().flatMap((title: string): Array<MenuLink> => {
    return linksIn(title);
  });
}

/*
 * Awaited so the badge counts settle inside act() — CountModelSideMenuItem
 * sets state when its (stubbed) count resolves, and an unawaited render
 * leaves that update outside the test.
 */
async function renderMenu(): Promise<void> {
  await act(async () => {
    render(<AlertsSideMenu />);
  });
}

describe("Alerts side menu", () => {
  beforeEach(() => {
    setViewportWidth(DESKTOP_WIDTH);
    goTo(`/dashboard/${PROJECT_ID}/alerts`);
  });

  afterEach(() => {
    cleanup();
  });

  describe("sections", () => {
    test("renders the six product sections in order", async () => {
      await renderMenu();

      expect(sectionTitlesInOrder()).toEqual([
        "Alerts",
        "Episodes",
        "AI",
        "Workspace",
        "Rules",
        "Settings",
      ]);
    });

    test("the day-to-day sections are expanded and the configuration sections are collapsed", async () => {
      await renderMenu();

      expect(isExpanded("Alerts")).toBe(true);
      expect(isExpanded("Episodes")).toBe(true);
      expect(isExpanded("AI")).toBe(true);
      expect(isExpanded("Workspace")).toBe(true);
      expect(isExpanded("Rules")).toBe(false);
      expect(isExpanded("Settings")).toBe(false);
    });

    test("the alert, episode and workspace sections are unchanged by the move", async () => {
      await renderMenu();

      expect(linksIn("Alerts")).toEqual([
        { title: "All Alerts", href: routeFor(PageMap.ALERTS) },
        {
          title: "Active Alerts",
          href: routeFor(PageMap.UNRESOLVED_ALERTS),
        },
      ]);

      expect(linksIn("Episodes")).toEqual([
        { title: "All Episodes", href: routeFor(PageMap.ALERT_EPISODES) },
        {
          title: "Active Episodes",
          href: routeFor(PageMap.UNRESOLVED_ALERT_EPISODES),
        },
        {
          title: "Documentation",
          href: routeFor(PageMap.ALERT_EPISODE_DOCS),
        },
      ]);

      expect(linksIn("Workspace")).toEqual([
        {
          title: "Slack",
          href: routeFor(PageMap.ALERTS_WORKSPACE_CONNECTION_SLACK),
        },
        {
          title: "Microsoft Teams",
          href: routeFor(PageMap.ALERTS_WORKSPACE_CONNECTION_MICROSOFT_TEAMS),
        },
      ]);
    });
  });

  describe("AI section", () => {
    test("holds exactly Investigation and Remediation, pointing at the AI and auto-remediation pages", async () => {
      await renderMenu();

      expect(linksIn("AI")).toEqual([
        {
          title: "Investigation",
          href: routeFor(PageMap.ALERTS_SETTINGS_AI),
        },
        {
          title: "Remediation",
          href: routeFor(PageMap.ALERTS_SETTINGS_AUTO_REMEDIATION_RULES),
        },
      ]);
    });

    test("is visible without expanding anything", async () => {
      await renderMenu();

      expect(isExpanded("AI")).toBe(true);
      expect(sectionBody("AI").className).toContain("opacity-100");
      expect(sectionBody("AI").className).not.toContain("max-h-0");
    });

    test("both entries carry an icon", async () => {
      await renderMenu();

      const icons: Array<Element | null> = Array.from(
        sectionRoot("AI").querySelectorAll("a"),
      ).map((anchor: HTMLAnchorElement): Element | null => {
        return anchor.querySelector("svg");
      });

      expect(icons).toHaveLength(2);
      icons.forEach((icon: Element | null) => {
        expect(icon).not.toBeNull();
      });
    });
  });

  describe("Rules section", () => {
    test("holds every alert rule page", async () => {
      await renderMenu();

      expect(linksIn("Rules")).toEqual([
        {
          title: "Grouping Rules",
          href: routeFor(PageMap.ALERTS_SETTINGS_GROUPING_RULES),
        },
        {
          title: "On-Call Rules",
          href: routeFor(PageMap.ALERTS_SETTINGS_ON_CALL_RULES),
        },
        {
          title: "Owner Rules",
          href: routeFor(PageMap.ALERTS_SETTINGS_OWNER_RULES),
        },
        {
          title: "Runbook Rules",
          href: routeFor(PageMap.ALERTS_SETTINGS_RUNBOOK_RULES),
        },
        {
          title: "Privacy Rules",
          href: routeFor(PageMap.ALERTS_SETTINGS_PRIVACY_RULES),
        },
        {
          title: "Label Rules",
          href: routeFor(PageMap.ALERTS_SETTINGS_LABEL_RULES),
        },
        {
          title: "Reminder Rules",
          href: routeFor(PageMap.ALERTS_SETTINGS_REMINDER_RULES),
        },
      ]);
    });

    test("starts collapsed", async () => {
      await renderMenu();

      expect(isExpanded("Rules")).toBe(false);
      expect(sectionBody("Rules").className).toContain("max-h-0");
      expect(sectionBody("Rules").className).toContain("opacity-0");
    });

    test("expands on click and collapses again", async () => {
      await renderMenu();

      fireEvent.click(sectionToggle("Rules"));

      expect(isExpanded("Rules")).toBe(true);
      expect(sectionBody("Rules").className).not.toContain("max-h-0");
      expect(sectionBody("Rules").className).toContain("opacity-100");

      fireEvent.click(sectionToggle("Rules"));

      expect(isExpanded("Rules")).toBe(false);
      expect(sectionBody("Rules").className).toContain("max-h-0");
    });

    /*
     * Collapsed is a style, not an unmount — the links stay in the DOM and
     * stay clickable through keyboard navigation. Worth pinning: a future
     * change to conditional rendering would make the collapsed section
     * unreachable for anything that is not a mouse.
     */
    test("its links stay reachable while collapsed", async () => {
      await renderMenu();

      expect(isExpanded("Rules")).toBe(false);
      expect(linksIn("Rules")).toHaveLength(7);
    });
  });

  describe("Settings section", () => {
    test("keeps only the settings pages that are neither AI nor rules", async () => {
      await renderMenu();

      expect(linksIn("Settings")).toEqual([
        {
          title: "Alert State",
          href: routeFor(PageMap.ALERTS_SETTINGS_STATE),
        },
        {
          title: "Alert Severity",
          href: routeFor(PageMap.ALERTS_SETTINGS_SEVERITY),
        },
        {
          title: "Note Templates",
          href: routeFor(PageMap.ALERTS_SETTINGS_NOTE_TEMPLATES),
        },
        {
          title: "Custom Fields",
          href: routeFor(PageMap.ALERTS_SETTINGS_CUSTOM_FIELDS),
        },
        {
          title: "More Settings",
          href: routeFor(PageMap.ALERTS_SETTINGS_MORE),
        },
      ]);
    });

    test("no longer links to the AI or auto-remediation pages", async () => {
      await renderMenu();

      const settingsHrefs: Array<string> = linksIn("Settings").map(
        (link: MenuLink): string => {
          return link.href;
        },
      );

      expect(settingsHrefs).not.toContain(routeFor(PageMap.ALERTS_SETTINGS_AI));
      expect(settingsHrefs).not.toContain(
        routeFor(PageMap.ALERTS_SETTINGS_AUTO_REMEDIATION_RULES),
      );
    });

    test("no longer holds any rule page", async () => {
      await renderMenu();

      const ruleEntries: Array<MenuLink> = linksIn("Settings").filter(
        (link: MenuLink): boolean => {
          return link.title.endsWith("Rules");
        },
      );

      expect(ruleEntries).toEqual([]);
    });
  });

  describe("coverage", () => {
    /*
     * The set of settings pages the menu reached before AI and Rules were
     * split out. Re-sectioning is fine; dropping one is not.
     */
    const SETTINGS_PAGES_BEFORE_THE_MOVE: Array<string> = [
      PageMap.ALERTS_SETTINGS_AI,
      PageMap.ALERTS_SETTINGS_STATE,
      PageMap.ALERTS_SETTINGS_SEVERITY,
      PageMap.ALERTS_SETTINGS_NOTE_TEMPLATES,
      PageMap.ALERTS_SETTINGS_CUSTOM_FIELDS,
      PageMap.ALERTS_SETTINGS_GROUPING_RULES,
      PageMap.ALERTS_SETTINGS_ON_CALL_RULES,
      PageMap.ALERTS_SETTINGS_OWNER_RULES,
      PageMap.ALERTS_SETTINGS_RUNBOOK_RULES,
      PageMap.ALERTS_SETTINGS_AUTO_REMEDIATION_RULES,
      PageMap.ALERTS_SETTINGS_PRIVACY_RULES,
      PageMap.ALERTS_SETTINGS_LABEL_RULES,
      PageMap.ALERTS_SETTINGS_REMINDER_RULES,
      PageMap.ALERTS_SETTINGS_MORE,
    ];

    test("every settings page reachable before the move is still reachable", async () => {
      await renderMenu();

      const hrefs: Array<string> = allLinks().map((link: MenuLink): string => {
        return link.href;
      });

      SETTINGS_PAGES_BEFORE_THE_MOVE.forEach((pageMapKey: string) => {
        expect(hrefs).toContain(routeFor(pageMapKey));
      });
    });

    test("no page is listed in two places", async () => {
      await renderMenu();

      const hrefs: Array<string> = allLinks().map((link: MenuLink): string => {
        return link.href;
      });

      expect(hrefs).toEqual(Array.from(new Set(hrefs)));
    });

    test("no title is used twice", async () => {
      await renderMenu();

      const titles: Array<string> = allLinks().map((link: MenuLink): string => {
        return link.title;
      });

      expect(titles).toEqual(Array.from(new Set(titles)));
    });

    test("every link resolves to a fully populated route", async () => {
      await renderMenu();

      allLinks().forEach((link: MenuLink) => {
        expect(link.href).toContain(`/dashboard/${PROJECT_ID}/alerts`);
        expect(link.href).not.toContain(":");
        expect(link.title).not.toBe("");
      });
    });
  });

  /*
   * On a phone the menu collapses to a single button that names where you
   * are as "<section> / <page>". That string is the one place the section
   * rename is spelled out to the user, so it is worth pinning directly.
   */
  describe("mobile summary", () => {
    beforeEach(() => {
      setViewportWidth(MOBILE_WIDTH);
    });

    test("names the AI section on the investigation page", async () => {
      goTo(`/dashboard/${PROJECT_ID}/alerts/settings/ai`);
      await renderMenu();

      expect(
        document.querySelector('[data-testid="mobile-sidemenu-toggle"]')
          ?.textContent,
      ).toContain("AI / Investigation");
    });

    test("names the AI section on the remediation page", async () => {
      goTo(`/dashboard/${PROJECT_ID}/alerts/settings/auto-remediation-rules`);
      await renderMenu();

      expect(
        document.querySelector('[data-testid="mobile-sidemenu-toggle"]')
          ?.textContent,
      ).toContain("AI / Remediation");
    });

    test("names the Rules section on a rule page", async () => {
      goTo(`/dashboard/${PROJECT_ID}/alerts/settings/grouping-rules`);
      await renderMenu();

      expect(
        document.querySelector('[data-testid="mobile-sidemenu-toggle"]')
          ?.textContent,
      ).toContain("Rules / Grouping Rules");
    });

    test("still names the Settings section on a settings page", async () => {
      goTo(`/dashboard/${PROJECT_ID}/alerts/settings/state`);
      await renderMenu();

      expect(
        document.querySelector('[data-testid="mobile-sidemenu-toggle"]')
          ?.textContent,
      ).toContain("Settings / Alert State");
    });
  });
});
