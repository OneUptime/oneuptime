import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import "@testing-library/jest-dom";
import { RenderResult, cleanup, fireEvent } from "@testing-library/react";
import * as React from "react";

/*
 * The Security Events side menu, rendered against the real RouteMap: six
 * sections - Overview, Security Cases, Events, Detections, Playbooks,
 * Connections - each holding its pages, every page an entry of its own.
 * "Can we create side menu sections instead and have different pages for
 * these things?" (the maintainer, of the tabs each page carried and the
 * views along the top of the case queue).
 *
 * Pinned here: the sections and entries in order and where each links, an
 * icon of its own drawn for every entry, Detections and Connections folded
 * on the overview and open on their own pages, exactly the entry of the
 * page you are on lit, the counts beside Open Cases, Assigned to Me and
 * Waiting for Approval (each asking what its page lists), and the phone's
 * "Section / Page" summary.
 *
 * ModelAPI.count backs the counts; it is stubbed inline because jest.mock
 * is hoisted above the imports.
 */
const countQueries: Array<{ model: string; query: unknown }> = [];

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      count: (data: { modelType: { name: string }; query: unknown }) => {
        countQueries.push({ model: data.modelType.name, query: data.query });
        // Open cases 6, mine 2, runs waiting 1: each count tells its entry apart.
        const query: Record<string, unknown> = data.query as Record<
          string,
          unknown
        >;

        if (data.modelType.name === "SecurityPlaybookRun") {
          return Promise.resolve(1);
        }

        return Promise.resolve(query["assignedToUserId"] ? 2 : 6);
      },
    },
  };
});

import SecurityEventsSideMenu from "../../../../App/FeatureSet/Dashboard/src/Pages/SecurityEvents/SideMenu";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import { getSecurityCaseQueueQuery } from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityCase/SecurityCaseQueueViews";
import Includes from "../../../Types/BaseDatabase/Includes";
import ObjectID from "../../../Types/ObjectID";
import { OPEN_SECURITY_CASE_STATUSES } from "../../../Types/SecurityCase/SecurityCaseStatus";
import SecurityPlaybookRunStatus from "../../../Types/SecurityPlaybook/SecurityPlaybookRunStatus";
import User from "../../../UI/Utils/User";
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
  sectionBody,
  sectionTitlesInOrder,
  sectionToggle,
  setViewportWidth,
} from "./SideMenuHarness";

const ME: string = "80000000-0000-4000-8000-000000000001";

async function renderSecurityMenu(): Promise<RenderResult> {
  return await renderMenu(<SecurityEventsSideMenu />);
}

// Each section, and its entries as the menu links them.
const EXPECTED: Array<[string, Array<[string, string]>]> = [
  ["Overview", [["Overview", PageMap.SECURITY_EVENTS_OVERVIEW]]],
  [
    "Security Cases",
    [
      ["Open Cases", PageMap.SECURITY_CASES],
      ["Assigned to Me", PageMap.SECURITY_CASES_ASSIGNED_TO_ME],
      ["Unassigned", PageMap.SECURITY_CASES_UNASSIGNED],
      ["Closed Cases", PageMap.SECURITY_CASES_CLOSED],
      ["All Cases", PageMap.SECURITY_CASES_ALL],
    ],
  ],
  [
    "Events",
    [
      ["Events", PageMap.SECURITY_EVENTS],
      ["Entities", PageMap.SECURITY_EVENTS_ENTITIES],
      ["Correlate", PageMap.SECURITY_EVENTS_CORRELATE],
    ],
  ],
  [
    "Detections",
    [
      ["Detection Rules", PageMap.SECURITY_EVENTS_DETECTION_RULES],
      ["Rule Library", PageMap.SECURITY_EVENTS_RULE_LIBRARY],
      ["Threat Intel", PageMap.SECURITY_EVENTS_THREAT_INTEL],
      ["ATT&CK Coverage", PageMap.SECURITY_EVENTS_ATTACK_COVERAGE],
    ],
  ],
  [
    "Playbooks",
    [
      ["Playbooks", PageMap.SECURITY_PLAYBOOKS],
      [
        "Waiting for Approval",
        PageMap.SECURITY_PLAYBOOK_RUNS_WAITING_FOR_APPROVAL,
      ],
      ["Playbook Runs", PageMap.SECURITY_PLAYBOOK_RUNS],
      ["Protected Entities", PageMap.SECURITY_PROTECTED_ENTITIES],
    ],
  ],
  [
    "Connections",
    [
      ["Connections", PageMap.SECURITY_EVENTS_CONNECTIONS],
      ["Setup Guide", PageMap.SECURITY_EVENTS_DOCUMENTATION],
    ],
  ],
];

// Every page the menu reaches: its section, and its entry lit there.
const PAGES: Array<[string, string, string]> = EXPECTED.flatMap(
  ([section, entries]: [string, Array<[string, string]>]): Array<
    [string, string, string]
  > => {
    return entries.map(
      ([title, page]: [string, string]): [string, string, string] => {
        return [page, section, title];
      },
    );
  },
);

function entryTitles(links: Array<MenuLink>): Array<string> {
  return links.map((link: MenuLink): string => {
    return link.title;
  });
}

// The entry's anchor in its section.
function entryAnchor(section: string, title: string): HTMLAnchorElement {
  const toggle: HTMLElement = sectionToggle(section);
  const body: HTMLElement = sectionBody(section);
  const anchor: HTMLAnchorElement | undefined = Array.from(
    body.querySelectorAll("a"),
  ).find((candidate: HTMLAnchorElement): boolean => {
    return (
      (
        candidate.querySelector("span.truncate")?.textContent ||
        candidate.textContent ||
        ""
      ).trim() === title
    );
  });

  expect(toggle).toBeTruthy();

  if (!anchor) {
    throw new Error(`No entry "${title}" in section "${section}".`);
  }

  return anchor;
}

// The number drawn beside an entry, or "" when there is none.
function badgeOf(section: string, title: string): string {
  const anchor: HTMLAnchorElement = entryAnchor(section, title);
  const badge: Element | null = anchor.querySelector("span.rounded-full");

  return (badge?.textContent || "").trim();
}

describe("Security Events side menu", () => {
  beforeEach(() => {
    setViewportWidth(DESKTOP_WIDTH);
    countQueries.length = 0;
    jest.spyOn(User, "getUserId").mockReturnValue(new ObjectID(ME));
    goTo(`/dashboard/${PROJECT_ID}/security-events/overview`);
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  test("is six sections, in the order Security works, each holding its pages", async () => {
    await renderSecurityMenu();

    expect(sectionTitlesInOrder()).toEqual(
      EXPECTED.map(([section]: [string, unknown]): string => {
        return section;
      }),
    );

    for (const [section, entries] of EXPECTED) {
      expect([section, entryTitles(linksIn(section))]).toEqual([
        section,
        entries.map(([title]: [string, string]): string => {
          return title;
        }),
      ]);
    }
  });

  test("links every entry to the route its page is registered under", async () => {
    await renderSecurityMenu();

    for (const [section, entries] of EXPECTED) {
      expect(
        linksIn(section).map((link: MenuLink): [string, string] => {
          return [link.title, link.href];
        }),
      ).toEqual(
        entries.map(([title, page]: [string, string]): [string, string] => {
          return [title, routeFor(page)];
        }),
      );
    }
  });

  test("keeps the old addresses on what they showed: the case queue on Open Cases, the runs page on Waiting for Approval", async () => {
    await renderSecurityMenu();

    expect(entryAnchor("Security Cases", "Open Cases")).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID}/security-events/cases`,
    );
    expect(entryAnchor("Playbooks", "Waiting for Approval")).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID}/security-events/playbook-runs`,
    );
    expect(entryAnchor("Playbooks", "Playbook Runs")).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID}/security-events/playbook-runs/all`,
    );
  });

  test("draws every entry an icon of its own", async () => {
    const rendered: RenderResult = await renderSecurityMenu();
    const drawings: Array<string> = Array.from(
      rendered.container.querySelectorAll("a"),
    ).map((anchor: HTMLAnchorElement): string => {
      const svg: SVGElement | null = anchor.querySelector("svg");

      expect(svg).not.toBeNull();

      return svg?.innerHTML || "";
    });

    expect(drawings).toHaveLength(PAGES.length);
    // Drawn differently, not only named differently (Graph draws ChartBar's bars).
    expect(new Set(drawings).size).toBe(drawings.length);
  });

  test("on the overview, folds Detections and Connections and keeps the everyday sections open", async () => {
    await renderSecurityMenu();

    expect(
      EXPECTED.map(([section]: [string, unknown]): [string, boolean] => {
        return [section, isExpanded(section)];
      }),
    ).toEqual([
      ["Overview", true],
      ["Security Cases", true],
      ["Events", true],
      ["Detections", false],
      ["Playbooks", true],
      ["Connections", false],
    ]);
    expect(sectionBody("Detections")).toHaveClass(
      "max-h-0",
      "opacity-0",
      "invisible",
    );
    expect(sectionBody("Connections")).toHaveClass("invisible");
  });

  test("opens a folded section with one click", async () => {
    await renderSecurityMenu();

    fireEvent.click(sectionToggle("Detections"));

    expect(isExpanded("Detections")).toBe(true);
    expect(sectionBody("Detections")).not.toHaveClass("invisible");
  });

  test.each(PAGES)(
    "on %s, lights only its entry, in its section, open",
    async (page: string, section: string, title: string) => {
      goTo(routeFor(page));
      await renderSecurityMenu();

      expect(activeLinkTitles()).toEqual([title]);
      expect(isExpanded(section)).toBe(true);
      expect(entryAnchor(section, title).getAttribute("href")).toBe(
        routeFor(page),
      );
    },
  );

  test("lights nothing on a case's own page: it opens outside the menu", async () => {
    goTo(
      `/dashboard/${PROJECT_ID}/security-events/cases/44444444-4444-4444-8444-444444444444`,
    );
    await renderSecurityMenu();

    expect(activeLinkTitles()).toEqual([]);
  });

  test("counts what each page lists beside Open Cases, Assigned to Me and Waiting for Approval, and nowhere else", async () => {
    await renderSecurityMenu();

    expect(badgeOf("Security Cases", "Open Cases")).toBe("6");
    expect(badgeOf("Security Cases", "Assigned to Me")).toBe("2");
    expect(badgeOf("Playbooks", "Waiting for Approval")).toBe("1");

    for (const [section, entries] of EXPECTED) {
      for (const [title] of entries) {
        if (
          ["Open Cases", "Assigned to Me", "Waiting for Approval"].includes(
            title,
          )
        ) {
          continue;
        }

        expect([title, badgeOf(section, title)]).toEqual([title, ""]);
      }
    }
  });

  test("asks for the open cases, your open cases and the runs held for approval: the pages' own queries", async () => {
    await renderSecurityMenu();

    expect(countQueries).toHaveLength(3);

    const cases: Array<Record<string, unknown>> = countQueries
      .filter((entry: { model: string }): boolean => {
        return entry.model === "SecurityCase";
      })
      .map((entry: { query: unknown }): Record<string, unknown> => {
        return entry.query as Record<string, unknown>;
      });
    const runs: Array<Record<string, unknown>> = countQueries
      .filter((entry: { model: string }): boolean => {
        return entry.model === "SecurityPlaybookRun";
      })
      .map((entry: { query: unknown }): Record<string, unknown> => {
        return entry.query as Record<string, unknown>;
      });

    expect(cases).toHaveLength(2);
    expect(runs).toHaveLength(1);

    const open: Record<string, unknown> | undefined = cases.find(
      (query: Record<string, unknown>): boolean => {
        return !query["assignedToUserId"];
      },
    );
    const mine: Record<string, unknown> | undefined = cases.find(
      (query: Record<string, unknown>): boolean => {
        return Boolean(query["assignedToUserId"]);
      },
    );

    expect(open?.["projectId"]).toBe(PROJECT_ID);
    expect((open?.["status"] as Includes).values).toEqual([
      ...OPEN_SECURITY_CASE_STATUSES,
    ]);
    expect(mine?.["projectId"]).toBe(PROJECT_ID);
    expect(mine?.["assignedToUserId"]).toEqual(new ObjectID(ME));
    expect((mine?.["status"] as Includes).values).toEqual([
      ...OPEN_SECURITY_CASE_STATUSES,
    ]);
    // Exactly what Assigned to Me itself asks for.
    expect({ ...mine, projectId: undefined }).toEqual({
      ...getSecurityCaseQueueQuery("mine", new ObjectID(ME)),
      projectId: undefined,
    });
    expect(runs[0]).toEqual({
      projectId: PROJECT_ID,
      status: SecurityPlaybookRunStatus.WaitingForApproval,
    });
  });

  test("with nobody signed in, counts no cases of their own", async () => {
    jest.spyOn(User, "getUserId").mockReturnValue(new ObjectID(""));

    await renderSecurityMenu();

    expect(countQueries).toHaveLength(2);
    expect(badgeOf("Security Cases", "Assigned to Me")).toBe("");
  });

  test("on a phone, names the section and the page you are on, and a page named like its section once", async () => {
    setViewportWidth(MOBILE_WIDTH);

    goTo(routeFor(PageMap.SECURITY_CASES_ASSIGNED_TO_ME));
    await renderSecurityMenu();
    expect(mobileSummaryText()).toContain("Security Cases / Assigned to Me");
    cleanup();

    goTo(routeFor(PageMap.SECURITY_PLAYBOOK_RUNS_WAITING_FOR_APPROVAL));
    await renderSecurityMenu();
    expect(mobileSummaryText()).toContain("Playbooks / Waiting for Approval");
    cleanup();

    goTo(routeFor(PageMap.SECURITY_EVENTS));
    await renderSecurityMenu();
    expect(mobileSummaryText()).toContain("Events");
    expect(mobileSummaryText()).not.toContain("Events / Events");
  });
});
