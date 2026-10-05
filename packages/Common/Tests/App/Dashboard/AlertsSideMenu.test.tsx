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
 * The latest move: everything OneUptime AI does for alerts has an AI section
 * of its own again, right after Episodes. The AI settings page left Settings
 * for it, as "Settings", and the auto-remediation rules left Rules for it.
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
    test("renders the product sections in order, AI right after Episodes, then Developer", async () => {
      await renderAlertsMenu();

      expect(sectionTitlesInOrder()).toEqual([
        "Alerts",
        "Episodes",
        "AI",
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
      expect(isExpanded("AI")).toBe(false);
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
        expect(isExpanded("AI")).toBe(false);
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

  describe("the AI section", () => {
    test("holds what AI did, its settings and the auto-remediation rules", async () => {
      await renderAlertsMenu();

      expect(linksIn("AI")).toEqual([
        {
          title: "Logs",
          href: routeFor(PageMap.ALERTS_AI_LOGS),
        },
        {
          title: "Settings",
          href: routeFor(PageMap.ALERTS_SETTINGS_AI),
        },
        {
          title: "Auto Remediation Rules",
          href: routeFor(PageMap.ALERTS_SETTINGS_AUTO_REMEDIATION_RULES),
        },
      ]);
    });

    test("lives under …/alerts/ai, not under settings/ any more", async () => {
      await renderAlertsMenu();

      expect(
        linksIn("AI").map((link: MenuLink): string => {
          return link.href;
        }),
      ).toEqual([
        `/dashboard/${PROJECT_ID}/alerts/ai/logs`,
        `/dashboard/${PROJECT_ID}/alerts/ai/settings`,
        `/dashboard/${PROJECT_ID}/alerts/ai/auto-remediation-rules`,
      ]);
      expect(hrefsInMenu()).not.toContain(
        `/dashboard/${PROJECT_ID}/alerts/settings/ai`,
      );
      expect(hrefsInMenu()).not.toContain(
        `/dashboard/${PROJECT_ID}/alerts/settings/auto-remediation-rules`,
      );
    });

    test.each([
      PageMap.ALERTS_AI_LOGS,
      PageMap.ALERTS_SETTINGS_AI,
      PageMap.ALERTS_SETTINGS_AUTO_REMEDIATION_RULES,
    ])("%s is listed once, and only under AI", async (pageMapKey: string) => {
      await renderAlertsMenu();

      const href: string = routeFor(pageMapKey);

      expect(
        hrefsInMenu().filter((candidate: string): boolean => {
          return candidate === href;
        }),
      ).toHaveLength(1);
      for (const section of [
        "Alerts",
        "Episodes",
        "Workspace",
        "Rules",
        "Settings",
      ]) {
        expect(
          linksIn(section).map((link: MenuLink): string => {
            return link.href;
          }),
        ).not.toContain(href);
      }
    });

    test("no entry keeps the old Investigation or Remediation names", async () => {
      await renderAlertsMenu();

      expect(titlesInMenu()).not.toContain("Investigation");
      expect(titlesInMenu()).not.toContain("Remediation");
    });

    /*
     * The two products configure AI independently - one page each - so their
     * menu entries must never resolve to the same route.
     */
    test("its entries are alert routes, not the incident ones", async () => {
      await renderAlertsMenu();

      const hrefs: Array<string> = hrefsInMenu();

      expect(hrefs).not.toContain(routeFor(PageMap.INCIDENTS_SETTINGS_AI));
      expect(hrefs).not.toContain(
        routeFor(PageMap.INCIDENTS_SETTINGS_AUTO_REMEDIATION_RULES),
      );
    });

    test("every entry carries an icon", async () => {
      await renderAlertsMenu();

      expect(iconCountIn("AI")).toBe(linksIn("AI").length);
    });

    test("starts collapsed, and opens with a click", async () => {
      await renderAlertsMenu();

      expect(isExpanded("AI")).toBe(false);
      expect(sectionBody("AI")).toHaveClass("max-h-0", "opacity-0");

      fireEvent.click(sectionToggle("AI"));

      expect(isExpanded("AI")).toBe(true);
      expect(sectionBody("AI")).toHaveClass("opacity-100");
    });

    // AI is collapsed by default, so it must open itself on its pages.
    test.each([
      ["Logs", PageMap.ALERTS_AI_LOGS],
      ["Settings", PageMap.ALERTS_SETTINGS_AI],
      [
        "Auto Remediation Rules",
        PageMap.ALERTS_SETTINGS_AUTO_REMEDIATION_RULES,
      ],
    ])(
      "opens itself on its %s page, marks it, and leaves Rules and Settings folded",
      async (title: string, pageMapKey: string) => {
        goTo(routeFor(pageMapKey));
        await renderAlertsMenu();

        expect(isExpanded("AI")).toBe(true);
        expect(sectionBody("AI").className).toContain("opacity-100");
        expect(sectionBody("AI").className).not.toContain("max-h-0");
        expect(isExpanded("Rules")).toBe(false);
        expect(isExpanded("Settings")).toBe(false);
        expect(activeLinkTitles()).toEqual([title]);
      },
    );
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
      expect(linksIn("Rules")).toHaveLength(7);
    });

    // Rules is collapsed by default, so it must open itself on its pages.
    test("opens itself on a rule page", async () => {
      goTo(routeFor(PageMap.ALERTS_SETTINGS_GROUPING_RULES));
      await renderAlertsMenu();

      expect(isExpanded("Rules")).toBe(true);
      expect(isExpanded("AI")).toBe(false);
    });

    // They are AI's rules, so they moved to the AI section with its settings.
    test("no longer holds the auto-remediation rules", async () => {
      await renderAlertsMenu();

      expect(
        linksIn("Rules").map((link: MenuLink): string => {
          return link.title;
        }),
      ).not.toContain("Auto Remediation Rules");
    });
  });

  describe("Settings section", () => {
    test("holds the configuration pages that are not rules, and not AI's", async () => {
      await renderAlertsMenu();

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

    test("does not hold the AI settings page or the auto-remediation rules, which are in AI", async () => {
      await renderAlertsMenu();

      const settingsHrefs: Array<string> = linksIn("Settings").map(
        (link: MenuLink): string => {
          return link.href;
        },
      );

      expect(settingsHrefs).not.toContain(routeFor(PageMap.ALERTS_SETTINGS_AI));
      expect(settingsHrefs).not.toContain(
        routeFor(PageMap.ALERTS_SETTINGS_AUTO_REMEDIATION_RULES),
      );
      expect(
        linksIn("Settings").map((link: MenuLink): string => {
          return link.title;
        }),
      ).not.toContain("AI");
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
        .concat(linksIn("Settings"), linksIn("Alerts"), linksIn("AI"))
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

    test("names the AI section on the AI Logs page", async () => {
      goTo(`/dashboard/${PROJECT_ID}/alerts/ai/logs`);
      await renderAlertsMenu();

      expect(mobileSummaryText()).toContain("AI / Logs");
    });

    test("names the AI section on the AI settings page", async () => {
      goTo(`/dashboard/${PROJECT_ID}/alerts/ai/settings`);
      await renderAlertsMenu();

      expect(mobileSummaryText()).toContain("AI / Settings");
    });

    test("names the AI section on the auto-remediation rules page", async () => {
      goTo(`/dashboard/${PROJECT_ID}/alerts/ai/auto-remediation-rules`);
      await renderAlertsMenu();

      expect(mobileSummaryText()).toContain("AI / Auto Remediation Rules");
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
