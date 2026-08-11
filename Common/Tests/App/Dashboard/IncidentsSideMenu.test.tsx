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
 * Incidents carry the same reorganisation as alerts — AI and the rule pages
 * lifted out of a collapsed Settings section — but with two pages alerts does
 * not have (SLA Rules, Incident Roles), and those are exactly where a
 * copy-paste of the alerts menu would go wrong: SLA Rules belongs in Rules,
 * Incident Roles stays in Settings.
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
import {
  DESKTOP_WIDTH,
  MOBILE_WIDTH,
  MenuLink,
  PROJECT_ID,
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
  });

  afterEach(() => {
    cleanup();
  });

  describe("sections", () => {
    test("renders the six product sections in order", async () => {
      await renderIncidentsMenu();

      expect(sectionTitlesInOrder()).toEqual([
        "Overview",
        "Episodes",
        "AI",
        "Workspace",
        "Rules",
        "Settings",
      ]);
    });

    test("the day-to-day sections are expanded and the configuration sections are collapsed", async () => {
      await renderIncidentsMenu();

      expect(isExpanded("Overview")).toBe(true);
      expect(isExpanded("Episodes")).toBe(true);
      expect(isExpanded("AI")).toBe(true);
      expect(isExpanded("Workspace")).toBe(true);
      expect(isExpanded("Rules")).toBe(false);
      expect(isExpanded("Settings")).toBe(false);
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

  describe("AI section", () => {
    test("holds exactly Investigation and Remediation, pointing at the AI and auto-remediation pages", async () => {
      await renderIncidentsMenu();

      expect(linksIn("AI")).toEqual([
        {
          title: "Investigation",
          href: routeFor(PageMap.INCIDENTS_SETTINGS_AI),
        },
        {
          title: "Remediation",
          href: routeFor(PageMap.INCIDENTS_SETTINGS_AUTO_REMEDIATION_RULES),
        },
      ]);
    });

    test("is visible without expanding anything", async () => {
      await renderIncidentsMenu();

      expect(isExpanded("AI")).toBe(true);
      expect(sectionBody("AI").className).toContain("opacity-100");
      expect(sectionBody("AI").className).not.toContain("max-h-0");
    });

    test("both entries carry an icon", async () => {
      await renderIncidentsMenu();

      expect(iconCountIn("AI")).toBe(2);
    });

    /*
     * The two products configure AI independently — one page each — so their
     * menu entries must never resolve to the same route.
     */
    test("its entries are incident routes, not the alert ones", async () => {
      await renderIncidentsMenu();

      const aiHrefs: Array<string> = linksIn("AI").map(
        (link: MenuLink): string => {
          return link.href;
        },
      );

      expect(aiHrefs).not.toContain(routeFor(PageMap.ALERTS_SETTINGS_AI));
      expect(aiHrefs).not.toContain(
        routeFor(PageMap.ALERTS_SETTINGS_AUTO_REMEDIATION_RULES),
      );
      aiHrefs.forEach((href: string) => {
        expect(href).toContain("/incidents/");
      });
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
      expect(linksIn("Rules")).toHaveLength(8);
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
    test("keeps only the settings pages that are neither AI nor rules", async () => {
      await renderIncidentsMenu();

      expect(linksIn("Settings")).toEqual([
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
          title: "More Settings",
          href: routeFor(PageMap.INCIDENTS_SETTINGS_MORE),
        },
      ]);
    });

    test("no longer links to the AI or auto-remediation pages", async () => {
      await renderIncidentsMenu();

      const settingsHrefs: Array<string> = linksIn("Settings").map(
        (link: MenuLink): string => {
          return link.href;
        },
      );

      expect(settingsHrefs).not.toContain(
        routeFor(PageMap.INCIDENTS_SETTINGS_AI),
      );
      expect(settingsHrefs).not.toContain(
        routeFor(PageMap.INCIDENTS_SETTINGS_AUTO_REMEDIATION_RULES),
      );
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
     * split out. Re-sectioning is fine; dropping one is not.
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
      PageMap.INCIDENTS_SETTINGS_MORE,
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
        .concat(linksIn("AI"), linksIn("Settings"), linksIn("Overview"))
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

    test("names the AI section on the investigation page", async () => {
      goTo(`/dashboard/${PROJECT_ID}/incidents/settings/ai`);
      await renderIncidentsMenu();

      expect(mobileSummaryText()).toContain("AI / Investigation");
    });

    test("names the AI section on the remediation page", async () => {
      goTo(
        `/dashboard/${PROJECT_ID}/incidents/settings/auto-remediation-rules`,
      );
      await renderIncidentsMenu();

      expect(mobileSummaryText()).toContain("AI / Remediation");
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
  });
});
