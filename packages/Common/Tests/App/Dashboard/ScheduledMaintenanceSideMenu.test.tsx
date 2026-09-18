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
 * Scheduled maintenance gets the Rules section that incidents and alerts got,
 * and deliberately does not get an AI section: nothing here is investigated or
 * auto-remediated, so there is no page to put under one. That absence is the
 * thing worth pinning — an AI section added here by symmetry would be a
 * heading with nothing behind it.
 *
 * Rendered against the real RouteMap rather than asserted on the source, so a
 * menu entry pointing at a route that does not exist fails here. The
 * "coverage" block pins the full set of settings pages reachable before the
 * move: a page may be re-sectioned freely, never lost.
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

import ScheduledMaintenanceSideMenu from "../../../../App/FeatureSet/Dashboard/src/Pages/ScheduledMaintenanceEvents/SideMenu";
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

const ROOT: string = `/dashboard/${PROJECT_ID}/scheduled-maintenance-events`;

async function renderScheduledMaintenanceMenu(): Promise<void> {
  await renderMenu(<ScheduledMaintenanceSideMenu />);
}

describe("Scheduled maintenance side menu", () => {
  beforeEach(() => {
    setViewportWidth(DESKTOP_WIDTH);
    goTo(ROOT);
  });

  afterEach(() => {
    cleanup();
  });

  describe("sections", () => {
    test("renders Overview, Workspace, Rules and Settings in order", async () => {
      await renderScheduledMaintenanceMenu();

      expect(sectionTitlesInOrder()).toEqual([
        "Overview",
        "Workspace",
        "Rules",
        "Settings",
      ]);
    });

    /*
     * The deliberate asymmetry with incidents and alerts. If maintenance
     * events ever gain an investigation or auto-remediation page this test
     * fails, which is the moment to add the section — not before.
     */
    test("has no AI section, because there is no maintenance AI page", async () => {
      await renderScheduledMaintenanceMenu();

      expect(sectionTitlesInOrder()).not.toContain("AI");
    });

    test("the day-to-day sections are expanded and the configuration sections are collapsed", async () => {
      await renderScheduledMaintenanceMenu();

      expect(isExpanded("Overview")).toBe(true);
      expect(isExpanded("Workspace")).toBe(true);
      expect(isExpanded("Rules")).toBe(false);
      expect(isExpanded("Settings")).toBe(false);
    });

    test("the overview and workspace sections are unchanged by the move", async () => {
      await renderScheduledMaintenanceMenu();

      expect(linksIn("Overview")).toEqual([
        {
          title: "All Events",
          href: routeFor(PageMap.SCHEDULED_MAINTENANCE_EVENTS),
        },
        {
          title: "Ongoing Events",
          href: routeFor(PageMap.ONGOING_SCHEDULED_MAINTENANCE_EVENTS),
        },
      ]);

      expect(linksIn("Workspace")).toEqual([
        {
          title: "Slack",
          href: routeFor(
            PageMap.SCHEDULED_MAINTENANCE_EVENTS_WORKSPACE_CONNECTION_SLACK,
          ),
        },
        {
          title: "Microsoft Teams",
          href: routeFor(
            PageMap.SCHEDULED_MAINTENANCE_EVENTS_WORKSPACE_CONNECTION_MICROSOFT_TEAMS,
          ),
        },
      ]);
    });
  });

  describe("Rules section", () => {
    test("holds every maintenance rule page", async () => {
      await renderScheduledMaintenanceMenu();

      expect(linksIn("Rules")).toEqual([
        {
          title: "Owner Rules",
          href: routeFor(
            PageMap.SCHEDULED_MAINTENANCE_EVENTS_SETTINGS_OWNER_RULES,
          ),
        },
        {
          title: "Runbook Rules",
          href: routeFor(
            PageMap.SCHEDULED_MAINTENANCE_EVENTS_SETTINGS_RUNBOOK_RULES,
          ),
        },
        {
          title: "Label Rules",
          href: routeFor(
            PageMap.SCHEDULED_MAINTENANCE_EVENTS_SETTINGS_LABEL_RULES,
          ),
        },
        {
          title: "Reminder Rules",
          href: routeFor(
            PageMap.SCHEDULED_MAINTENANCE_EVENTS_SETTINGS_REMINDER_RULES,
          ),
        },
      ]);
    });

    test("starts collapsed", async () => {
      await renderScheduledMaintenanceMenu();

      expect(isExpanded("Rules")).toBe(false);
      expect(sectionBody("Rules").className).toContain("max-h-0");
      expect(sectionBody("Rules").className).toContain("opacity-0");
    });

    test("expands on click and collapses again", async () => {
      await renderScheduledMaintenanceMenu();

      fireEvent.click(sectionToggle("Rules"));

      expect(isExpanded("Rules")).toBe(true);
      expect(sectionBody("Rules").className).not.toContain("max-h-0");
      expect(sectionBody("Rules").className).toContain("opacity-100");

      fireEvent.click(sectionToggle("Rules"));

      expect(isExpanded("Rules")).toBe(false);
      expect(sectionBody("Rules").className).toContain("max-h-0");
    });

    test("its links stay reachable while collapsed", async () => {
      await renderScheduledMaintenanceMenu();

      expect(isExpanded("Rules")).toBe(false);
      expect(linksIn("Rules")).toHaveLength(4);
      expect(iconCountIn("Rules")).toBe(4);
    });
  });

  describe("Settings section", () => {
    test("keeps only the settings pages that are not rules", async () => {
      await renderScheduledMaintenanceMenu();

      expect(linksIn("Settings")).toEqual([
        {
          title: "Event State",
          href: routeFor(PageMap.SCHEDULED_MAINTENANCE_EVENTS_SETTINGS_STATE),
        },
        {
          title: "Event Templates",
          href: routeFor(
            PageMap.SCHEDULED_MAINTENANCE_EVENTS_SETTINGS_TEMPLATES,
          ),
        },
        {
          title: "Note Templates",
          href: routeFor(
            PageMap.SCHEDULED_MAINTENANCE_EVENTS_SETTINGS_NOTE_TEMPLATES,
          ),
        },
        {
          title: "Custom Fields",
          href: routeFor(
            PageMap.SCHEDULED_MAINTENANCE_EVENTS_SETTINGS_CUSTOM_FIELDS,
          ),
        },
        {
          title: "Measurements",
          href: routeFor(
            PageMap.SCHEDULED_MAINTENANCE_EVENTS_SETTINGS_MEASUREMENTS,
          ),
        },
        {
          title: "More Settings",
          href: routeFor(PageMap.SCHEDULED_MAINTENANCE_EVENTS_SETTINGS_MORE),
        },
      ]);
    });

    test("no longer holds any rule page", async () => {
      await renderScheduledMaintenanceMenu();

      expect(
        linksIn("Settings").filter((link: MenuLink): boolean => {
          return link.title.endsWith("Rules");
        }),
      ).toEqual([]);
    });
  });

  describe("coverage", () => {
    /*
     * The set of settings pages the menu reached before Rules was split out.
     * Re-sectioning is fine; dropping one is not.
     */
    const SETTINGS_PAGES_BEFORE_THE_MOVE: Array<string> = [
      PageMap.SCHEDULED_MAINTENANCE_EVENTS_SETTINGS_STATE,
      PageMap.SCHEDULED_MAINTENANCE_EVENTS_SETTINGS_TEMPLATES,
      PageMap.SCHEDULED_MAINTENANCE_EVENTS_SETTINGS_NOTE_TEMPLATES,
      PageMap.SCHEDULED_MAINTENANCE_EVENTS_SETTINGS_CUSTOM_FIELDS,
      PageMap.SCHEDULED_MAINTENANCE_EVENTS_SETTINGS_OWNER_RULES,
      PageMap.SCHEDULED_MAINTENANCE_EVENTS_SETTINGS_RUNBOOK_RULES,
      PageMap.SCHEDULED_MAINTENANCE_EVENTS_SETTINGS_LABEL_RULES,
      PageMap.SCHEDULED_MAINTENANCE_EVENTS_SETTINGS_REMINDER_RULES,
      PageMap.SCHEDULED_MAINTENANCE_EVENTS_SETTINGS_MORE,
    ];

    test("every settings page reachable before the move is still reachable", async () => {
      await renderScheduledMaintenanceMenu();

      const hrefs: Array<string> = hrefsInMenu();

      SETTINGS_PAGES_BEFORE_THE_MOVE.forEach((pageMapKey: string) => {
        expect(hrefs).toContain(routeFor(pageMapKey));
      });
    });

    test("no page is listed in two places", async () => {
      await renderScheduledMaintenanceMenu();

      const hrefs: Array<string> = hrefsInMenu();

      expect(hrefs).toEqual(Array.from(new Set(hrefs)));
    });

    test("no title is used twice", async () => {
      await renderScheduledMaintenanceMenu();

      const titles: Array<string> = titlesInMenu();

      expect(titles).toEqual(Array.from(new Set(titles)));
    });

    test("every link resolves to a fully populated maintenance route", async () => {
      await renderScheduledMaintenanceMenu();

      linksIn("Rules")
        .concat(linksIn("Settings"), linksIn("Overview"))
        .forEach((link: MenuLink) => {
          expect(link.href).toContain(ROOT);
          expect(link.href).not.toContain(":");
          expect(link.title).not.toBe("");
        });
    });
  });

  describe("mobile summary", () => {
    beforeEach(() => {
      setViewportWidth(MOBILE_WIDTH);
    });

    test("names the Rules section on a rule page", async () => {
      goTo(`${ROOT}/settings/runbook-rules`);
      await renderScheduledMaintenanceMenu();

      expect(mobileSummaryText()).toContain("Rules / Runbook Rules");
    });

    test("still names the Settings section on a settings page", async () => {
      goTo(`${ROOT}/settings/state`);
      await renderScheduledMaintenanceMenu();

      expect(mobileSummaryText()).toContain("Settings / Event State");
    });
  });
});
