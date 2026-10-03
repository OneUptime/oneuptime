import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import "@testing-library/jest-dom";
import { cleanup, fireEvent } from "@testing-library/react";
import * as React from "react";

/*
 * The alerts side menu is the only map users have of the alerts product, and
 * moving pages between its sections is exactly the kind of change that
 * silently drops a page: an entry moved into a new section but never added,
 * or added twice, or pointed at the wrong route. Nothing about any of those
 * looks wrong in a diff.
 *
 * The latest move: the AI section is gone. The AI settings page is the first
 * entry in Settings, called "AI", and auto-remediation rules sit in Rules
 * next to the other rule pages.
 *
 * So these render the real component against the real RouteMap rather than
 * asserting on its source, and every href is compared to the route the page is
 * actually registered under. The last test in "coverage" is the important one:
 * it pins the full set of settings pages that were reachable before the moves,
 * so a page can be re-sectioned freely but never lost.
 */
/*
 * ModelAPI.count backs the badge entries. Stubbed inline rather than through
 * the shared harness because jest.mock is hoisted above the imports — a helper
 * imported from another module is not initialised yet when it runs.
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
import ConnectedWorkspaces from "../../../../App/FeatureSet/Dashboard/src/Utils/Workspace/ConnectedWorkspaces";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";
import {
  DESKTOP_WIDTH,
  MOBILE_WIDTH,
  MenuLink,
  PROJECT_ID,
  activeLinkTitles,
  goTo,
  hrefsInMenu,
  iconCountIn,
  isExpanded,
  linksIn,
  mobileSummaryText,
  renderMenu,
  routeFor,
  sectionBody,
  sectionTitlesInOrder,
  sectionToggle,
  setViewportWidth,
  titlesInMenu,
} from "./SideMenuHarness";

async function renderAlertsMenu(): Promise<void> {
  await renderMenu(<AlertsSideMenu />);
}

describe("Alerts side menu", () => {
  beforeEach(() => {
    setViewportWidth(DESKTOP_WIDTH);
    goTo(`/dashboard/${PROJECT_ID}/alerts`);

    /*
     * A project with Slack and Microsoft Teams both connected, so the
     * Workspace section lists both. The other combinations, and what is
     * listed while nothing is connected, are pinned in
     * WorkspaceMenusConnected.test.tsx.
     */
    window.localStorage.clear();
    ConnectedWorkspaces.reset();
    ConnectedWorkspaces.setConnected(PROJECT_ID, [
      WorkspaceType.Slack,
      WorkspaceType.MicrosoftTeams,
    ]);
  });

  afterEach(() => {
    cleanup();
    ConnectedWorkspaces.reset();
  });

  describe("sections", () => {
    test("renders the five product sections in order, then Developer, with no AI section", async () => {
      await renderAlertsMenu();

      expect(sectionTitlesInOrder()).toEqual([
        "Alerts",
        "Episodes",
        "Workspace",
        "Rules",
        "Settings",
        "Developer",
      ]);
    });

    // As the maintainer drew the Incidents menu, which this one mirrors.
    test("the day-to-day sections are expanded and the configuration sections are collapsed", async () => {
      await renderAlertsMenu();

      expect(isExpanded("Alerts")).toBe(true);
      expect(isExpanded("Episodes")).toBe(true);
      expect(isExpanded("Workspace")).toBe(false);
      expect(isExpanded("Rules")).toBe(false);
      expect(isExpanded("Settings")).toBe(false);
      expect(isExpanded("Developer")).toBe(false);
      expect(sectionBody("Workspace")).toHaveClass(
        "max-h-0",
        "opacity-0",
        "invisible",
      );
    });

    test.each([
      ["Slack", PageMap.ALERTS_WORKSPACE_CONNECTION_SLACK],
      ["Microsoft Teams", PageMap.ALERTS_WORKSPACE_CONNECTION_MICROSOFT_TEAMS],
    ])(
      "Workspace opens by itself on the %s page, and marks it",
      async (title: string, pageMapKey: string) => {
        goTo(routeFor(pageMapKey));
        await renderAlertsMenu();

        expect(isExpanded("Workspace")).toBe(true);
        expect(sectionBody("Workspace")).not.toHaveClass("invisible");
        expect(isExpanded("Rules")).toBe(false);
        expect(isExpanded("Settings")).toBe(false);
        expect(activeLinkTitles()).toEqual([title]);
      },
    );

    test("Workspace opens with a click", async () => {
      await renderAlertsMenu();

      fireEvent.click(sectionToggle("Workspace"));

      expect(isExpanded("Workspace")).toBe(true);
      expect(sectionBody("Workspace")).toHaveClass("opacity-100");
    });

    test("with nothing connected, Workspace holds one entry, to the Workspace page", async () => {
      ConnectedWorkspaces.setConnected(PROJECT_ID, []);
      await renderAlertsMenu();

      expect(linksIn("Workspace")).toEqual([
        {
          title: "Connect Slack or Teams",
          href: routeFor(PageMap.ALERTS_WORKSPACE_CONNECTIONS),
        },
      ]);
    });

    test("the alert, episode and workspace sections are unchanged by the move", async () => {
      await renderAlertsMenu();

      expect(linksIn("Alerts")).toEqual([
        { title: "All Alerts", href: routeFor(PageMap.ALERTS) },
        { title: "Active Alerts", href: routeFor(PageMap.UNRESOLVED_ALERTS) },
      ]);

      expect(linksIn("Episodes")).toEqual([
        { title: "All Episodes", href: routeFor(PageMap.ALERT_EPISODES) },
        {
          title: "Active Episodes",
          href: routeFor(PageMap.UNRESOLVED_ALERT_EPISODES),
        },
        { title: "Documentation", href: routeFor(PageMap.ALERT_EPISODE_DOCS) },
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

  describe("the AI settings page", () => {
    test("is the first Settings entry, called AI, pointing at the AI settings page", async () => {
      await renderAlertsMenu();

      expect(linksIn("Settings")[0]).toEqual({
        title: "AI",
        href: routeFor(PageMap.ALERTS_SETTINGS_AI),
      });
    });

    test("is listed once, and only under Settings", async () => {
      await renderAlertsMenu();

      const aiHref: string = routeFor(PageMap.ALERTS_SETTINGS_AI);

      expect(
        hrefsInMenu().filter((href: string): boolean => {
          return href === aiHref;
        }),
      ).toHaveLength(1);
      for (const section of ["Alerts", "Episodes", "Workspace", "Rules"]) {
        expect(
          linksIn(section).map((link: MenuLink): string => {
            return link.href;
          }),
        ).not.toContain(aiHref);
      }
    });

    test("no entry keeps the old Investigation or Remediation names", async () => {
      await renderAlertsMenu();

      expect(titlesInMenu()).not.toContain("Investigation");
      expect(titlesInMenu()).not.toContain("Remediation");
    });

    test("carries an icon", async () => {
      await renderAlertsMenu();

      expect(iconCountIn("Settings")).toBe(linksIn("Settings").length);
    });

    // Settings is collapsed by default, so it must open itself on its pages.
    test("opens the collapsed Settings section when you are on it", async () => {
      goTo(`/dashboard/${PROJECT_ID}/alerts/settings/ai`);
      await renderAlertsMenu();

      expect(isExpanded("Settings")).toBe(true);
      expect(sectionBody("Settings").className).toContain("opacity-100");
      expect(sectionBody("Settings").className).not.toContain("max-h-0");
    });
  });

  describe("Rules section", () => {
    test("holds every alert rule page", async () => {
      await renderAlertsMenu();

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
          title: "Auto Remediation Rules",
          href: routeFor(PageMap.ALERTS_SETTINGS_AUTO_REMEDIATION_RULES),
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
      await renderAlertsMenu();

      expect(isExpanded("Rules")).toBe(false);
      expect(sectionBody("Rules").className).toContain("max-h-0");
      expect(sectionBody("Rules").className).toContain("opacity-0");
    });

    test("expands on click and collapses again", async () => {
      await renderAlertsMenu();

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
      await renderAlertsMenu();

      expect(isExpanded("Rules")).toBe(false);
      expect(linksIn("Rules")).toHaveLength(8);
    });

    // Rules is collapsed by default, so it must open itself on its pages.
    test("opens itself on the auto-remediation rules page", async () => {
      goTo(`/dashboard/${PROJECT_ID}/alerts/settings/auto-remediation-rules`);
      await renderAlertsMenu();

      expect(isExpanded("Rules")).toBe(true);
    });
  });

  describe("Settings section", () => {
    test("holds the AI page first, then the configuration pages that are not rules", async () => {
      await renderAlertsMenu();

      expect(linksIn("Settings")).toEqual([
        {
          title: "AI",
          href: routeFor(PageMap.ALERTS_SETTINGS_AI),
        },
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
          title: "Measurements",
          href: routeFor(PageMap.ALERTS_SETTINGS_MEASUREMENTS),
        },
        /*
         * The number prefixes, on a page named for them. It replaced More
         * Settings, which held nothing else.
         */
        {
          title: "Number Prefix",
          href: routeFor(PageMap.ALERTS_SETTINGS_NUMBER_PREFIX),
        },
      ]);
    });

    test("lists Number Prefix last, at settings/number-prefix", async () => {
      await renderAlertsMenu();

      const settings: Array<MenuLink> = linksIn("Settings");

      expect(settings[settings.length - 1]).toEqual({
        title: "Number Prefix",
        href: `/dashboard/${PROJECT_ID}/alerts/settings/number-prefix`,
      });
    });

    test("has no More Settings entry, and nothing points at the old address", async () => {
      await renderAlertsMenu();

      expect(titlesInMenu()).not.toContain("More Settings");
      expect(hrefsInMenu()).not.toContain(
        `/dashboard/${PROJECT_ID}/alerts/settings/more`,
      );
    });

    // Settings is collapsed by default, so it must open itself on its pages.
    test("opens itself on the Number Prefix page, and marks it", async () => {
      goTo(`/dashboard/${PROJECT_ID}/alerts/settings/number-prefix`);
      await renderAlertsMenu();

      expect(isExpanded("Settings")).toBe(true);
      expect(isExpanded("Rules")).toBe(false);
      expect(activeLinkTitles()).toEqual(["Number Prefix"]);
    });

    test("does not hold the auto-remediation rules, which are a rule page", async () => {
      await renderAlertsMenu();

      const settingsHrefs: Array<string> = linksIn("Settings").map(
        (link: MenuLink): string => {
          return link.href;
        },
      );

      expect(settingsHrefs).not.toContain(
        routeFor(PageMap.ALERTS_SETTINGS_AUTO_REMEDIATION_RULES),
      );
    });

    test("no longer holds any rule page", async () => {
      await renderAlertsMenu();

      expect(
        linksIn("Settings").filter((link: MenuLink): boolean => {
          return link.title.endsWith("Rules");
        }),
      ).toEqual([]);
    });
  });

  describe("coverage", () => {
    /*
     * The set of settings pages the menu reached before AI and Rules were
     * first split out of Settings. Re-sectioning is fine; dropping one is not.
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
      // More Settings, renamed for the one thing it held.
      PageMap.ALERTS_SETTINGS_NUMBER_PREFIX,
    ];

    test("every settings page reachable before the move is still reachable", async () => {
      await renderAlertsMenu();

      const hrefs: Array<string> = hrefsInMenu();

      SETTINGS_PAGES_BEFORE_THE_MOVE.forEach((pageMapKey: string) => {
        expect(hrefs).toContain(routeFor(pageMapKey));
      });
    });

    test("no page is listed in two places", async () => {
      await renderAlertsMenu();

      const hrefs: Array<string> = hrefsInMenu();

      expect(hrefs).toEqual(Array.from(new Set(hrefs)));
    });

    test("no title is used twice", async () => {
      await renderAlertsMenu();

      const titles: Array<string> = titlesInMenu();

      expect(titles).toEqual(Array.from(new Set(titles)));
    });

    test("every link resolves to a fully populated route", async () => {
      await renderAlertsMenu();

      linksIn("Rules")
        .concat(linksIn("Settings"), linksIn("Alerts"))
        .forEach((link: MenuLink) => {
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

    test("names the Settings section on the AI page", async () => {
      goTo(`/dashboard/${PROJECT_ID}/alerts/settings/ai`);
      await renderAlertsMenu();

      expect(mobileSummaryText()).toContain("Settings / AI");
    });

    test("names the Rules section on the auto-remediation rules page", async () => {
      goTo(`/dashboard/${PROJECT_ID}/alerts/settings/auto-remediation-rules`);
      await renderAlertsMenu();

      expect(mobileSummaryText()).toContain("Rules / Auto Remediation Rules");
    });

    test("names the Rules section on a rule page", async () => {
      goTo(`/dashboard/${PROJECT_ID}/alerts/settings/grouping-rules`);
      await renderAlertsMenu();

      expect(mobileSummaryText()).toContain("Rules / Grouping Rules");
    });

    test("still names the Settings section on a settings page", async () => {
      goTo(`/dashboard/${PROJECT_ID}/alerts/settings/state`);
      await renderAlertsMenu();

      expect(mobileSummaryText()).toContain("Settings / Alert State");
    });

    test("names the Settings section on the Number Prefix page", async () => {
      goTo(`/dashboard/${PROJECT_ID}/alerts/settings/number-prefix`);
      await renderAlertsMenu();

      expect(mobileSummaryText()).toContain("Settings / Number Prefix");
    });
  });
});
