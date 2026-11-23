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
 * THE MONITORS MENU (#9126).
 *
 *   - Disabled is a choice, not a fault. It sat under Attention Required
 *     with the error icon and a red count beside Not Operational; it now
 *     sits with the monitors, under All Monitors, counted in grey with the
 *     pause icon the monitor's own banner shows.
 *   - "Probe Disabled" read as one probe being switched off. The page lists
 *     the monitors no enabled probe checks, so it is "No Probe Enabled", as
 *     the monitor's own badge says; and "Probe Disconnected" is "Probes
 *     Disconnected", as its badge says.
 *   - Owner Rules and Label Rules sat under Settings, where no other product
 *     files them. They have a Rules section of their own, folded, as
 *     Incidents, Alerts and Maintenance do, at the same addresses.
 *
 * The real menu is rendered against the real RouteMap, with every count at
 * three so the badges are drawn.
 */

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, options?: { defaultValue?: string }): string => {
          return options?.defaultValue ?? key;
        },
        i18n: { language: "en" },
      };
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      count: () => {
        return Promise.resolve(3);
      },
      getList: () => {
        return Promise.resolve({ data: [], count: 0, skip: 0, limit: 0 });
      },
    },
  };
});

jest.mock("../../../UI/Utils/ModelListCache", () => {
  return {
    __esModule: true,
    default: {
      getList: () => {
        return Promise.resolve({ data: [], count: 0, skip: 0, limit: 0 });
      },
    },
  };
});

jest.mock("../../../UI/Utils/Analytics", () => {
  return { __esModule: true, default: { capture: jest.fn() } };
});

import MonitorsSideMenu from "../../../../App/FeatureSet/Dashboard/src/Pages/Monitor/SideMenu";
import { getMonitorBreadcrumbs } from "../../../../App/FeatureSet/Dashboard/src/Utils/Breadcrumbs/MonitorBreadcrumbs";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import { RouteUtil } from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import Project from "../../../Models/DatabaseModels/Project";
import Link from "../../../Types/Link";
import { PillTone } from "../../../UI/Components/Pill/PillTone";
import {
  MONITOR_ROW_STATUS_WORDS,
  MonitorRowStatusKind,
} from "../../../Utils/Monitor/MonitorRowStatus";
import {
  DESKTOP_WIDTH,
  MOBILE_WIDTH,
  MenuLink,
  PROJECT_ID,
  activeLinkTitles,
  goTo,
  isExpanded,
  linksIn,
  mobileSummaryText,
  renderMenu,
  routeFor,
  sectionTitlesInOrder,
  sectionToggle,
  setViewportWidth,
} from "./SideMenuHarness";

function project(): Project {
  const value: Project = new Project();
  value._id = PROJECT_ID;
  return value;
}

async function renderMonitorsMenu(): Promise<void> {
  await renderMenu(<MonitorsSideMenu project={project()} />);
}

// The count badge drawn in an entry's row.
function badgeOf(title: string): HTMLElement {
  const row: HTMLElement = screen.getByRole("link", {
    name: new RegExp(title),
  });
  // A count is painted in a Pill's tone, which its data-tone names.
  const badge: HTMLElement | null = row.querySelector("span[data-tone]");

  expect({ title: title, hasBadge: Boolean(badge) }).toEqual({
    title: title,
    hasBadge: true,
  });

  return badge as HTMLElement;
}

function trailOf(pageMapKey: string): Array<string> {
  const pattern: string = RouteUtil.getRouteString(pageMapKey);

  return (getMonitorBreadcrumbs(pattern) || []).map((link: Link): string => {
    return link.title;
  });
}

beforeEach(() => {
  setViewportWidth(DESKTOP_WIDTH);
  goTo(`/dashboard/${PROJECT_ID}/monitors`);
});

afterEach(() => {
  cleanup();
});

describe("Monitors side menu", () => {
  test("lists its daily pages first, then Rules, Settings, Advanced and Developer", async () => {
    await renderMonitorsMenu();

    expect(sectionTitlesInOrder()).toEqual([
      "Monitors",
      "Attention Required",
      "Workspace",
      "Rules",
      "Settings",
      "Advanced",
      "Developer",
    ]);
  });

  describe("Disabled", () => {
    test("sits with the monitors, under All Monitors, at the same address", async () => {
      await renderMonitorsMenu();

      expect(linksIn("Monitors")).toEqual([
        { title: "All Monitors", href: routeFor(PageMap.MONITORS) },
        { title: "Disabled", href: routeFor(PageMap.MONITORS_DISABLED) },
      ]);
      expect(routeFor(PageMap.MONITORS_DISABLED)).toBe(
        `/dashboard/${PROJECT_ID}/monitors/disabled`,
      );
    });

    test("is not under Attention Required", async () => {
      await renderMonitorsMenu();

      expect(
        linksIn("Attention Required").map((link: MenuLink): string => {
          return link.title;
        }),
      ).not.toContain("Disabled");
    });

    test("is counted in grey, while what needs attention is counted in red", async () => {
      await renderMonitorsMenu();

      // A choice: the tone a switched-off state is drawn in (#9255).
      expect(badgeOf("Disabled")).toHaveAttribute("data-tone", PillTone.Paused);

      for (const title of [
        "Not Operational",
        "Probes Disconnected",
        "No Probe Enabled",
      ]) {
        expect(badgeOf(title)).toHaveAttribute("data-tone", PillTone.Danger);
      }
    });
  });

  describe("the monitors no probe checks", () => {
    test("are named as the monitor's own badge names them", async () => {
      await renderMonitorsMenu();

      expect(linksIn("Attention Required")).toEqual([
        {
          title: "Not Operational",
          href: routeFor(PageMap.MONITORS_INOPERATIONAL),
        },
        {
          title:
            MONITOR_ROW_STATUS_WORDS[MonitorRowStatusKind.ProbesDisconnected],
          href: routeFor(PageMap.MONITORS_PROBE_DISCONNECTED),
        },
        {
          title: MONITOR_ROW_STATUS_WORDS[MonitorRowStatusKind.NoProbeEnabled],
          href: routeFor(PageMap.MONITORS_PROBE_DISABLED),
        },
      ]);
      expect(
        MONITOR_ROW_STATUS_WORDS[MonitorRowStatusKind.NoProbeEnabled],
      ).toBe("No Probe Enabled");
      expect(
        MONITOR_ROW_STATUS_WORDS[MonitorRowStatusKind.ProbesDisconnected],
      ).toBe("Probes Disconnected");
    });

    test("no entry says Probe Disabled or Probe Disconnected", async () => {
      await renderMonitorsMenu();

      for (const title of sectionTitlesInOrder()) {
        for (const link of linksIn(title)) {
          expect(link.title).not.toMatch(/^Probe Dis(abled|connected)$/);
        }
      }
    });

    test("keep their addresses, so bookmarks still work", () => {
      expect(routeFor(PageMap.MONITORS_PROBE_DISABLED)).toBe(
        `/dashboard/${PROJECT_ID}/monitors/probe-disabled`,
      );
      expect(routeFor(PageMap.MONITORS_PROBE_DISCONNECTED)).toBe(
        `/dashboard/${PROJECT_ID}/monitors/probe-disconnected`,
      );
    });

    test("their trails end in the menu's names", () => {
      expect(trailOf(PageMap.MONITORS_PROBE_DISABLED)).toEqual([
        "Project",
        "Monitors",
        "No Probe Enabled",
      ]);
      expect(trailOf(PageMap.MONITORS_PROBE_DISCONNECTED)).toEqual([
        "Project",
        "Monitors",
        "Probes Disconnected",
      ]);
    });
  });

  describe("Rules", () => {
    test("holds Owner Rules and Label Rules, at their old addresses, then their history", async () => {
      await renderMonitorsMenu();

      expect(linksIn("Rules")).toEqual([
        {
          title: "Owner Rules",
          href: routeFor(PageMap.MONITORS_SETTINGS_OWNER_RULES),
        },
        {
          title: "Label Rules",
          href: routeFor(PageMap.MONITORS_SETTINGS_LABEL_RULES),
        },
        // Who changed the rules above, what and when (#10462).
        {
          title: "Audit Logs",
          href: routeFor(PageMap.MONITORS_SETTINGS_RULES_AUDIT_LOGS),
        },
      ]);
      expect(routeFor(PageMap.MONITORS_SETTINGS_OWNER_RULES)).toBe(
        `/dashboard/${PROJECT_ID}/monitors/settings/owner-rules`,
      );
      expect(routeFor(PageMap.MONITORS_SETTINGS_LABEL_RULES)).toBe(
        `/dashboard/${PROJECT_ID}/monitors/settings/label-rules`,
      );
      expect(routeFor(PageMap.MONITORS_SETTINGS_RULES_AUDIT_LOGS)).toBe(
        `/dashboard/${PROJECT_ID}/monitors/settings/rules-audit-logs`,
      );
    });

    test("opens itself on the rules' Audit Logs page, and marks it", async () => {
      goTo(routeFor(PageMap.MONITORS_SETTINGS_RULES_AUDIT_LOGS));
      await renderMonitorsMenu();

      expect(isExpanded("Rules")).toBe(true);
      expect(activeLinkTitles()).toEqual(["Audit Logs"]);
      expect(isExpanded("Settings")).toBe(false);
    });

    test("Settings no longer holds them", async () => {
      await renderMonitorsMenu();

      expect(
        linksIn("Settings").map((link: MenuLink): string => {
          return link.title;
        }),
      ).toEqual([
        "Monitor Status",
        "Custom Fields",
        "Secrets",
        "Incoming Request Secrets",
        "Templates",
        "Probes",
      ]);
    });

    test("starts folded, and opens with a click", async () => {
      await renderMonitorsMenu();

      expect(isExpanded("Rules")).toBe(false);
      fireEvent.click(sectionToggle("Rules"));
      expect(isExpanded("Rules")).toBe(true);
    });

    test("opens itself on a rule's page, and marks it", async () => {
      goTo(routeFor(PageMap.MONITORS_SETTINGS_LABEL_RULES));
      await renderMonitorsMenu();

      expect(isExpanded("Rules")).toBe(true);
      expect(isExpanded("Settings")).toBe(false);
      expect(activeLinkTitles()).toEqual(["Label Rules"]);
    });

    test("a rule's trail runs through Rules, as an incident rule's does", () => {
      expect(trailOf(PageMap.MONITORS_SETTINGS_OWNER_RULES)).toEqual([
        "Project",
        "Monitors",
        "Rules",
        "Owner Rules",
      ]);
      expect(trailOf(PageMap.MONITORS_SETTINGS_LABEL_RULE_VIEW)).toEqual([
        "Project",
        "Monitors",
        "Rules",
        "Label Rules",
        "View Rule",
      ]);
    });

    test("on a phone, the menu's summary names Rules", async () => {
      setViewportWidth(MOBILE_WIDTH);
      goTo(routeFor(PageMap.MONITORS_SETTINGS_OWNER_RULES));
      await renderMonitorsMenu();

      expect(mobileSummaryText()).toContain("Rules");
      expect(mobileSummaryText()).toContain("Owner Rules");
    });
  });
});
