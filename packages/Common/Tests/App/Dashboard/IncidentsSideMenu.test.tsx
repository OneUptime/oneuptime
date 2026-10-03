import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import "@testing-library/jest-dom";
import { cleanup, fireEvent, screen } from "@testing-library/react";
import * as React from "react";

/*
 * Incidents carry the same layout as alerts — the rule pages in a Rules
 * section, the AI settings page first in Settings as "AI", and no AI section
 * of its own — but with two pages alerts does not have (SLA Rules, Incident
 * Roles), and those are exactly where a copy-paste of the alerts menu would
 * go wrong: SLA Rules belongs in Rules, Incident Roles stays in Settings.
 *
 * These render the real component against the real RouteMap rather than
 * asserting on its source, so a menu entry pointing at a route that does not
 * exist fails here. The "coverage" block pins the full set of settings pages
 * reachable before the move: a page may be re-sectioned freely, never lost.
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

import IncidentsSideMenu from "../../../../App/FeatureSet/Dashboard/src/Pages/Incidents/SideMenu";
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

async function renderIncidentsMenu(): Promise<void> {
  await renderMenu(<IncidentsSideMenu />);
}

describe("Incidents side menu", () => {
  beforeEach(() => {
    setViewportWidth(DESKTOP_WIDTH);
    goTo(`/dashboard/${PROJECT_ID}/incidents`);

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
      await renderIncidentsMenu();

      expect(sectionTitlesInOrder()).toEqual([
        "Overview",
        "Episodes",
        "Workspace",
        "Rules",
        "Settings",
        "Developer",
      ]);
    });

    /*
     * The maintainer's picture of this menu: Overview and Episodes open, and
     * Workspace, Rules and Settings folded down to their titles.
     */
    test("the day-to-day sections are expanded and the configuration sections are collapsed", async () => {
      await renderIncidentsMenu();

      expect(isExpanded("Overview")).toBe(true);
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
      ["Slack", PageMap.INCIDENTS_WORKSPACE_CONNECTION_SLACK],
      [
        "Microsoft Teams",
        PageMap.INCIDENTS_WORKSPACE_CONNECTION_MICROSOFT_TEAMS,
      ],
    ])(
      "Workspace opens by itself on the %s page, and marks it",
      async (title: string, pageMapKey: string) => {
        goTo(routeFor(pageMapKey));
        await renderIncidentsMenu();

        expect(isExpanded("Workspace")).toBe(true);
        expect(sectionBody("Workspace")).not.toHaveClass("invisible");
        expect(isExpanded("Rules")).toBe(false);
        expect(isExpanded("Settings")).toBe(false);
        expect(activeLinkTitles()).toEqual([title]);
      },
    );

    test("Workspace opens with a click, and folds away again", async () => {
      await renderIncidentsMenu();

      fireEvent.click(sectionToggle("Workspace"));

      expect(isExpanded("Workspace")).toBe(true);
      expect(sectionBody("Workspace")).toHaveClass("opacity-100");

      fireEvent.click(sectionToggle("Workspace"));

      expect(isExpanded("Workspace")).toBe(false);
      expect(sectionBody("Workspace")).toHaveClass("max-h-0");
    });

    test("with nothing connected, Workspace holds one entry, to the Workspace page", async () => {
      ConnectedWorkspaces.setConnected(PROJECT_ID, []);
      await renderIncidentsMenu();

      expect(linksIn("Workspace")).toEqual([
        {
          title: "Connect Slack or Teams",
          href: routeFor(PageMap.INCIDENTS_WORKSPACE_CONNECTIONS),
        },
      ]);
    });

    test("the overview, episode and workspace sections are unchanged by the move", async () => {
      await renderIncidentsMenu();

      expect(linksIn("Overview")).toEqual([
        { title: "All Incidents", href: routeFor(PageMap.INCIDENTS) },
        {
          title: "Active Incidents",
          href: routeFor(PageMap.UNRESOLVED_INCIDENTS),
        },
      ]);

      expect(linksIn("Episodes")).toEqual([
        { title: "All Episodes", href: routeFor(PageMap.INCIDENT_EPISODES) },
        {
          title: "Active Episodes",
          href: routeFor(PageMap.UNRESOLVED_INCIDENT_EPISODES),
        },
        {
          title: "Documentation",
          href: routeFor(PageMap.INCIDENT_EPISODE_DOCS),
        },
      ]);

      expect(linksIn("Workspace")).toEqual([
        {
          title: "Slack",
          href: routeFor(PageMap.INCIDENTS_WORKSPACE_CONNECTION_SLACK),
        },
        {
          title: "Microsoft Teams",
          href: routeFor(
            PageMap.INCIDENTS_WORKSPACE_CONNECTION_MICROSOFT_TEAMS,
          ),
        },
      ]);
    });
  });

  describe("the AI settings page", () => {
    test("is the first Settings entry, called AI, pointing at the AI settings page", async () => {
      await renderIncidentsMenu();

      expect(linksIn("Settings")[0]).toEqual({
        title: "AI",
        href: routeFor(PageMap.INCIDENTS_SETTINGS_AI),
      });
    });

    test("is listed once, and only under Settings", async () => {
      await renderIncidentsMenu();

      const aiHref: string = routeFor(PageMap.INCIDENTS_SETTINGS_AI);

      expect(
        hrefsInMenu().filter((href: string): boolean => {
          return href === aiHref;
        }),
      ).toHaveLength(1);
      for (const section of ["Overview", "Episodes", "Workspace", "Rules"]) {
        expect(
          linksIn(section).map((link: MenuLink): string => {
            return link.href;
          }),
        ).not.toContain(aiHref);
      }
    });

    test("no entry keeps the old Investigation or Remediation names", async () => {
      await renderIncidentsMenu();

      expect(titlesInMenu()).not.toContain("Investigation");
      expect(titlesInMenu()).not.toContain("Remediation");
    });

    /*
     * The two products configure AI independently — one page each — so their
     * menu entries must never resolve to the same route.
     */
    test("its AI and auto-remediation entries are incident routes, not the alert ones", async () => {
      await renderIncidentsMenu();

      const hrefs: Array<string> = hrefsInMenu();

      expect(hrefs).not.toContain(routeFor(PageMap.ALERTS_SETTINGS_AI));
      expect(hrefs).not.toContain(
        routeFor(PageMap.ALERTS_SETTINGS_AUTO_REMEDIATION_RULES),
      );
      expect(hrefs).toContain(routeFor(PageMap.INCIDENTS_SETTINGS_AI));
      expect(hrefs).toContain(
        routeFor(PageMap.INCIDENTS_SETTINGS_AUTO_REMEDIATION_RULES),
      );
    });

    test("carries an icon", async () => {
      await renderIncidentsMenu();

      expect(iconCountIn("Settings")).toBe(linksIn("Settings").length);
    });

    // Settings is collapsed by default, so it must open itself on its pages.
    test("opens the collapsed Settings section when you are on it", async () => {
      goTo(`/dashboard/${PROJECT_ID}/incidents/settings/ai`);
      await renderIncidentsMenu();

      expect(isExpanded("Settings")).toBe(true);
      expect(sectionBody("Settings").className).toContain("opacity-100");
      expect(sectionBody("Settings").className).not.toContain("max-h-0");
    });
  });

  describe("Rules section", () => {
    test("holds every incident rule page, including SLA Rules", async () => {
      await renderIncidentsMenu();

      expect(linksIn("Rules")).toEqual([
        {
          title: "Grouping Rules",
          href: routeFor(PageMap.INCIDENTS_SETTINGS_GROUPING_RULES),
        },
        {
          title: "On-Call Rules",
          href: routeFor(PageMap.INCIDENTS_SETTINGS_ON_CALL_RULES),
        },
        {
          title: "Owner Rules",
          href: routeFor(PageMap.INCIDENTS_SETTINGS_OWNER_RULES),
        },
        {
          title: "Runbook Rules",
          href: routeFor(PageMap.INCIDENTS_SETTINGS_RUNBOOK_RULES),
        },
        {
          title: "Auto Remediation Rules",
          href: routeFor(PageMap.INCIDENTS_SETTINGS_AUTO_REMEDIATION_RULES),
        },
        {
          title: "Privacy Rules",
          href: routeFor(PageMap.INCIDENTS_SETTINGS_PRIVACY_RULES),
        },
        {
          title: "Label Rules",
          href: routeFor(PageMap.INCIDENTS_SETTINGS_LABEL_RULES),
        },
        {
          title: "SLA Rules",
          href: routeFor(PageMap.INCIDENTS_SETTINGS_SLA_RULES),
        },
        {
          title: "Reminder Rules",
          href: routeFor(PageMap.INCIDENTS_SETTINGS_REMINDER_RULES),
        },
      ]);
    });

    test("starts collapsed", async () => {
      await renderIncidentsMenu();

      expect(isExpanded("Rules")).toBe(false);
      expect(sectionBody("Rules").className).toContain("max-h-0");
      expect(sectionBody("Rules").className).toContain("opacity-0");
    });

    test("expands on click and collapses again", async () => {
      await renderIncidentsMenu();

      fireEvent.click(sectionToggle("Rules"));

      expect(isExpanded("Rules")).toBe(true);
      expect(sectionBody("Rules").className).not.toContain("max-h-0");
      expect(sectionBody("Rules").className).toContain("opacity-100");

      fireEvent.click(sectionToggle("Rules"));

      expect(isExpanded("Rules")).toBe(false);
      expect(sectionBody("Rules").className).toContain("max-h-0");
    });

    test("its links stay reachable while collapsed", async () => {
      await renderIncidentsMenu();

      expect(isExpanded("Rules")).toBe(false);
      expect(linksIn("Rules")).toHaveLength(9);
    });

    // Rules is collapsed by default, so it must open itself on its pages.
    test("opens itself on the auto-remediation rules page", async () => {
      goTo(
        `/dashboard/${PROJECT_ID}/incidents/settings/auto-remediation-rules`,
      );
      await renderIncidentsMenu();

      expect(isExpanded("Rules")).toBe(true);
    });

    /*
     * Incident Roles is a rule-adjacent page that is not a rule: it defines
     * the roles people can be assigned, not a condition/action pair. It stays
     * in Settings.
     */
    test("does not swallow Incident Roles", async () => {
      await renderIncidentsMenu();

      expect(
        linksIn("Rules").map((link: MenuLink): string => {
          return link.href;
        }),
      ).not.toContain(routeFor(PageMap.INCIDENTS_SETTINGS_ROLES));
    });
  });

  describe("Settings section", () => {
    test("holds the AI page first, then the configuration pages that are not rules", async () => {
      await renderIncidentsMenu();

      expect(linksIn("Settings")).toEqual([
        {
          title: "AI",
          href: routeFor(PageMap.INCIDENTS_SETTINGS_AI),
        },
        {
          title: "Incident State",
          href: routeFor(PageMap.INCIDENTS_SETTINGS_STATE),
        },
        {
          title: "Incident Severity",
          href: routeFor(PageMap.INCIDENTS_SETTINGS_SEVERITY),
        },
        {
          title: "Incident Templates",
          href: routeFor(PageMap.INCIDENTS_SETTINGS_TEMPLATES),
        },
        {
          title: "Note Templates",
          href: routeFor(PageMap.INCIDENTS_SETTINGS_NOTE_TEMPLATES),
        },
        {
          title: "Postmortem Templates",
          href: routeFor(PageMap.INCIDENTS_SETTINGS_POSTMORTEM_TEMPLATES),
        },
        {
          title: "Custom Fields",
          href: routeFor(PageMap.INCIDENTS_SETTINGS_CUSTOM_FIELDS),
        },
        {
          title: "Incident Roles",
          href: routeFor(PageMap.INCIDENTS_SETTINGS_ROLES),
        },
        {
          title: "Measurements",
          href: routeFor(PageMap.INCIDENTS_SETTINGS_MEASUREMENTS),
        },
        // The linked alert switches, on a page of their own.
        {
          title: "Linked Alerts",
          href: routeFor(PageMap.INCIDENTS_SETTINGS_LINKED_ALERTS),
        },
        /*
         * The number prefixes, on a page named for them. It replaced More
         * Settings, which held nothing else.
         */
        {
          title: "Number Prefix",
          href: routeFor(PageMap.INCIDENTS_SETTINGS_NUMBER_PREFIX),
        },
      ]);
    });

    test("lists Number Prefix last, at settings/number-prefix", async () => {
      await renderIncidentsMenu();

      const settings: Array<MenuLink> = linksIn("Settings");

      expect(settings[settings.length - 1]).toEqual({
        title: "Number Prefix",
        href: `/dashboard/${PROJECT_ID}/incidents/settings/number-prefix`,
      });
    });

    test("has no More Settings entry, and nothing points at the old address", async () => {
      await renderIncidentsMenu();

      expect(titlesInMenu()).not.toContain("More Settings");
      expect(hrefsInMenu()).not.toContain(
        `/dashboard/${PROJECT_ID}/incidents/settings/more`,
      );
    });

    // Settings is collapsed by default, so it must open itself on its pages.
    test("opens itself on the Number Prefix page, and marks it", async () => {
      goTo(`/dashboard/${PROJECT_ID}/incidents/settings/number-prefix`);
      await renderIncidentsMenu();

      expect(isExpanded("Settings")).toBe(true);
      expect(isExpanded("Rules")).toBe(false);
      expect(activeLinkTitles()).toEqual(["Number Prefix"]);
    });

    test("lists Linked Alerts at settings/linked-alerts", async () => {
      await renderIncidentsMenu();

      const linkedAlerts: Array<MenuLink> = linksIn("Settings").filter(
        (link: MenuLink): boolean => {
          return link.title === "Linked Alerts";
        },
      );

      expect(linkedAlerts).toEqual([
        {
          title: "Linked Alerts",
          href: `/dashboard/${PROJECT_ID}/incidents/settings/linked-alerts`,
        },
      ]);
    });

    // Settings is collapsed by default, so it must open itself on its pages.
    test("opens itself on the Linked Alerts page", async () => {
      goTo(`/dashboard/${PROJECT_ID}/incidents/settings/linked-alerts`);
      await renderIncidentsMenu();

      expect(isExpanded("Settings")).toBe(true);
      expect(isExpanded("Rules")).toBe(false);
    });

    test("does not hold the auto-remediation rules, which are a rule page", async () => {
      await renderIncidentsMenu();

      const settingsHrefs: Array<string> = linksIn("Settings").map(
        (link: MenuLink): string => {
          return link.href;
        },
      );

      expect(settingsHrefs).not.toContain(
        routeFor(PageMap.INCIDENTS_SETTINGS_AUTO_REMEDIATION_RULES),
      );
    });

    /*
     * Incident forms became the Forms product (/dashboard/:projectId/forms),
     * with a menu of its own: the incidents menu links to no form page.
     */
    test("holds no Forms page, which is a product of its own now", async () => {
      await renderIncidentsMenu();

      expect(
        hrefsInMenu().filter((href: string): boolean => {
          return href.includes("/forms");
        }),
      ).toEqual([]);
      expect(
        linksIn("Settings").map((link: MenuLink): string => {
          return link.title;
        }),
      ).not.toContain("Forms");
    });

    test("no longer holds any rule page", async () => {
      await renderIncidentsMenu();

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
      PageMap.INCIDENTS_SETTINGS_AI,
      PageMap.INCIDENTS_SETTINGS_STATE,
      PageMap.INCIDENTS_SETTINGS_SEVERITY,
      PageMap.INCIDENTS_SETTINGS_TEMPLATES,
      PageMap.INCIDENTS_SETTINGS_NOTE_TEMPLATES,
      PageMap.INCIDENTS_SETTINGS_POSTMORTEM_TEMPLATES,
      PageMap.INCIDENTS_SETTINGS_CUSTOM_FIELDS,
      PageMap.INCIDENTS_SETTINGS_GROUPING_RULES,
      PageMap.INCIDENTS_SETTINGS_ON_CALL_RULES,
      PageMap.INCIDENTS_SETTINGS_OWNER_RULES,
      PageMap.INCIDENTS_SETTINGS_RUNBOOK_RULES,
      PageMap.INCIDENTS_SETTINGS_AUTO_REMEDIATION_RULES,
      PageMap.INCIDENTS_SETTINGS_PRIVACY_RULES,
      PageMap.INCIDENTS_SETTINGS_LABEL_RULES,
      PageMap.INCIDENTS_SETTINGS_SLA_RULES,
      PageMap.INCIDENTS_SETTINGS_REMINDER_RULES,
      PageMap.INCIDENTS_SETTINGS_ROLES,
      // More Settings, renamed for the one thing it held.
      PageMap.INCIDENTS_SETTINGS_NUMBER_PREFIX,
    ];

    test("every settings page reachable before the move is still reachable", async () => {
      await renderIncidentsMenu();

      const hrefs: Array<string> = hrefsInMenu();

      SETTINGS_PAGES_BEFORE_THE_MOVE.forEach((pageMapKey: string) => {
        expect(hrefs).toContain(routeFor(pageMapKey));
      });
    });

    test("no page is listed in two places", async () => {
      await renderIncidentsMenu();

      const hrefs: Array<string> = hrefsInMenu();

      expect(hrefs).toEqual(Array.from(new Set(hrefs)));
    });

    test("no title is used twice", async () => {
      await renderIncidentsMenu();

      const titles: Array<string> = titlesInMenu();

      expect(titles).toEqual(Array.from(new Set(titles)));
    });

    test("every link resolves to a fully populated incident route", async () => {
      await renderIncidentsMenu();

      linksIn("Rules")
        .concat(linksIn("Settings"), linksIn("Overview"))
        .forEach((link: MenuLink) => {
          expect(link.href).toContain(`/dashboard/${PROJECT_ID}/incidents`);
          expect(link.href).not.toContain(":");
          expect(link.title).not.toBe("");
        });
    });
  });

  describe("mobile summary", () => {
    beforeEach(() => {
      setViewportWidth(MOBILE_WIDTH);
    });

    test("names the Settings section on the AI page", async () => {
      goTo(`/dashboard/${PROJECT_ID}/incidents/settings/ai`);
      await renderIncidentsMenu();

      expect(mobileSummaryText()).toContain("Settings / AI");
    });

    test("names the Workspace section on the Slack page", async () => {
      goTo(routeFor(PageMap.INCIDENTS_WORKSPACE_CONNECTION_SLACK));
      await renderIncidentsMenu();

      expect(mobileSummaryText()).toContain("Workspace / Slack");
    });

    /*
     * The phone menu is a panel that closes when a page is picked; a tap on
     * a folded section's header opens the section and leaves the panel open.
     */
    test("opens Workspace from the phone menu without closing it", async () => {
      await renderIncidentsMenu();

      fireEvent.click(screen.getByTestId("mobile-sidemenu-toggle"));

      expect(isExpanded("Workspace")).toBe(false);

      fireEvent.click(sectionToggle("Workspace"));

      expect(screen.getByTestId("mobile-sidemenu-toggle")).toHaveAttribute(
        "aria-expanded",
        "true",
      );
      expect(isExpanded("Workspace")).toBe(true);
      expect(sectionBody("Workspace")).not.toHaveClass("invisible");
    });

    test("names the Rules section on the auto-remediation rules page", async () => {
      goTo(
        `/dashboard/${PROJECT_ID}/incidents/settings/auto-remediation-rules`,
      );
      await renderIncidentsMenu();

      expect(mobileSummaryText()).toContain("Rules / Auto Remediation Rules");
    });

    test("names the Rules section on a rule page", async () => {
      goTo(`/dashboard/${PROJECT_ID}/incidents/settings/sla-rules`);
      await renderIncidentsMenu();

      expect(mobileSummaryText()).toContain("Rules / SLA Rules");
    });

    test("still names the Settings section on a settings page", async () => {
      goTo(`/dashboard/${PROJECT_ID}/incidents/settings/roles`);
      await renderIncidentsMenu();

      expect(mobileSummaryText()).toContain("Settings / Incident Roles");
    });

    test("names the Settings section on the Number Prefix page", async () => {
      goTo(`/dashboard/${PROJECT_ID}/incidents/settings/number-prefix`);
      await renderIncidentsMenu();

      expect(mobileSummaryText()).toContain("Settings / Number Prefix");
    });

    test("names the Settings section on the Linked Alerts page", async () => {
      goTo(`/dashboard/${PROJECT_ID}/incidents/settings/linked-alerts`);
      await renderIncidentsMenu();

      expect(mobileSummaryText()).toContain("Settings / Linked Alerts");
    });
  });
});
