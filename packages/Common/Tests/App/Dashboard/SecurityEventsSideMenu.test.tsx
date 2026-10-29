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
 * The Security Events side menu, rendered against the real RouteMap: nine
 * sections - Overview, Security Cases, Events, Detections, Playbooks, AI,
 * Workspace, Connections and Settings (the project's own Case Priorities,
 * the Response Targets each sets, and Case Statuses) - each holding its
 * pages, every page an entry of its own. "Can we create side menu sections instead and have different
 * pages for these things?" (the maintainer, of the tabs each page carried
 * and the views along the top of the case queue).
 *
 * Pinned here: the sections and entries in order and where each links, an
 * icon of its own drawn for every entry, Detections, AI, Workspace,
 * Connections and Settings folded on the overview and open on their own
 * pages, exactly
 * the entry of the page you are on lit, the counts beside Open Cases,
 * Assigned to Me and Approvals (each asking what its page
 * lists), and the phone's "Section / Page" summary.
 *
 * Workspace is the one every product's menu has (WorkspaceSideMenuSection):
 * here a project with Slack and Microsoft Teams both connected, so it lists
 * both; with neither, it is the one entry that connects them.
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
import {
  WORKSPACE_MENU_ENTRY_TITLES,
  WORKSPACE_SECTION_TITLE,
  WorkspaceMenuEntry,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Workspace/WorkspaceSideMenuSection";
import {
  SECURITY_EVENTS_WORKSPACE_PAGES,
  SECURITY_EVENTS_WORKSPACE_SECTION_TITLE,
  getSecurityEventsPageTrail,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/SecurityEventsNavigation";
import ConnectedWorkspaces from "../../../../App/FeatureSet/Dashboard/src/Utils/Workspace/ConnectedWorkspaces";
import Includes from "../../../Types/BaseDatabase/Includes";
import ObjectID from "../../../Types/ObjectID";
import SecurityCaseStage from "../../../Types/SecurityCase/SecurityCaseStage";
import {
  TEST_STATUS_IDS,
  buildDefaultTestStatuses,
  buildTestStatus,
} from "../../Helpers/SecurityCaseValues";
import { stubDashboardSecurityCaseValues } from "./SecurityCaseValuesStub";
import ModelListCache from "../../../UI/Utils/ModelListCache";
import SecurityPlaybookRunStatus from "../../../Types/SecurityPlaybook/SecurityPlaybookRunStatus";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";
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
      ["Campaigns", PageMap.SECURITY_EVENTS_CAMPAIGNS],
      // The one riskiest list: Entities folded into it.
      ["Entity Risk", PageMap.SECURITY_EVENTS_ENTITY_RISK],
      ["Correlate", PageMap.SECURITY_EVENTS_CORRELATE],
    ],
  ],
  [
    "Detections",
    [
      ["Detection Rules", PageMap.SECURITY_EVENTS_DETECTION_RULES],
      // What the rules skip, every exception in one list to review.
      ["Rule Exceptions", PageMap.SECURITY_EVENTS_RULE_EXCEPTIONS],
      // The lists the rules match against: VIP users, critical hosts.
      ["Watchlists", PageMap.SECURITY_EVENTS_WATCHLISTS],
      ["Rule Library", PageMap.SECURITY_EVENTS_RULE_LIBRARY],
      ["Threat Intel", PageMap.SECURITY_EVENTS_THREAT_INTEL],
      ["ATT&CK Coverage", PageMap.SECURITY_EVENTS_ATTACK_COVERAGE],
    ],
  ],
  [
    "Playbooks",
    [
      ["Playbooks", PageMap.SECURITY_PLAYBOOKS],
      ["Approvals", PageMap.SECURITY_PLAYBOOK_RUNS_WAITING_FOR_APPROVAL],
      ["Playbook Runs", PageMap.SECURITY_PLAYBOOK_RUNS],
      ["Protected Entities", PageMap.SECURITY_PROTECTED_ENTITIES],
    ],
  ],
  // What OneUptime AI does on its own; the triage itself is on each case.
  ["AI", [["Settings", PageMap.SECURITY_EVENTS_SETTINGS_AI]]],
  // Both workspaces connected (beforeEach).
  [
    "Workspace",
    [
      ["Slack", PageMap.SECURITY_EVENTS_WORKSPACE_CONNECTION_SLACK],
      [
        "Microsoft Teams",
        PageMap.SECURITY_EVENTS_WORKSPACE_CONNECTION_MICROSOFT_TEAMS,
      ],
    ],
  ],
  [
    "Connections",
    [
      ["Connections", PageMap.SECURITY_EVENTS_CONNECTIONS],
      ["Setup Guide", PageMap.SECURITY_EVENTS_DOCUMENTATION],
    ],
  ],
  // The project's own scales, as Incidents and Alerts keep theirs under Settings.
  [
    "Settings",
    [
      ["Case Priorities", PageMap.SECURITY_EVENTS_SETTINGS_CASE_PRIORITIES],
      ["Response Targets", PageMap.SECURITY_EVENTS_SETTINGS_RESPONSE_TARGETS],
      ["Case Statuses", PageMap.SECURITY_EVENTS_SETTINGS_CASE_STATUSES],
      ["Risk Scoring", PageMap.SECURITY_EVENTS_SETTINGS_RISK_SCORING],
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
        candidate.querySelector('[data-testid="side-menu-item-title"]')
          ?.textContent ||
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
    // The project's case statuses, which say which cases are open.
    stubDashboardSecurityCaseValues();

    /*
     * A project with Slack and Microsoft Teams both connected, so the
     * Workspace section lists both. The other combinations, and what is
     * listed while the answer is on its way, are pinned for every product
     * menu in WorkspaceMenusConnected.test.tsx.
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
    jest.restoreAllMocks();
    ConnectedWorkspaces.reset();
  });

  test("is nine sections, in the order Security works, each holding its pages", async () => {
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

  test("keeps the old addresses on what they showed: the case queue on Open Cases, the runs page on Approvals", async () => {
    await renderSecurityMenu();

    expect(entryAnchor("Security Cases", "Open Cases")).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID}/security-events/cases`,
    );
    expect(entryAnchor("Playbooks", "Approvals")).toHaveAttribute(
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

  test("on the overview, folds Detections, AI, Workspace, Connections and Settings and keeps the everyday sections open", async () => {
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
      ["AI", false],
      ["Workspace", false],
      ["Connections", false],
      ["Settings", false],
    ]);
    expect(sectionBody("Detections")).toHaveClass(
      "max-h-0",
      "opacity-0",
      "invisible",
    );
    expect(sectionBody("AI")).toHaveClass("invisible");
    expect(sectionBody("Workspace")).toHaveClass("invisible");
    expect(sectionBody("Connections")).toHaveClass("invisible");
    expect(sectionBody("Settings")).toHaveClass("invisible");
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

  test("on an entity's page, lights Entity Risk, the list it opens from, whatever entity", async () => {
    for (const query of [
      "?value=203.0.113.47&type=IP+Address",
      "?value=k.morgan%40acme-commerce.example",
      "",
    ]) {
      cleanup();
      goTo(routeFor(PageMap.SECURITY_EVENTS_ENTITY_RISK_VIEW));
      // The entity is in the query, which the router's location leaves out.
      window.history.replaceState(
        {},
        "",
        `${routeFor(PageMap.SECURITY_EVENTS_ENTITY_RISK_VIEW)}${query}`,
      );
      await renderSecurityMenu();

      expect([query, activeLinkTitles()]).toEqual([query, ["Entity Risk"]]);
      expect(isExpanded("Events")).toBe(true);
      // The entry still opens the list, not the entity.
      expect(entryAnchor("Events", "Entity Risk").getAttribute("href")).toBe(
        routeFor(PageMap.SECURITY_EVENTS_ENTITY_RISK),
      );
    }
  });

  test("lights nothing on a case's own page: it opens outside the menu", async () => {
    goTo(
      `/dashboard/${PROJECT_ID}/security-events/cases/44444444-4444-4444-8444-444444444444`,
    );
    await renderSecurityMenu();

    expect(activeLinkTitles()).toEqual([]);
  });

  test("counts what each page lists beside Open Cases, Assigned to Me and Approvals, and nowhere else", async () => {
    await renderSecurityMenu();

    expect(badgeOf("Security Cases", "Open Cases")).toBe("6");
    expect(badgeOf("Security Cases", "Assigned to Me")).toBe("2");
    expect(badgeOf("Playbooks", "Approvals")).toBe("1");

    for (const [section, entries] of EXPECTED) {
      for (const [title] of entries) {
        if (["Open Cases", "Assigned to Me", "Approvals"].includes(title)) {
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

    // Open: the project's statuses that count as open, by id.
    const openStatusIds: Array<string> = [
      TEST_STATUS_IDS[SecurityCaseStage.New],
      TEST_STATUS_IDS[SecurityCaseStage.Acknowledged],
      TEST_STATUS_IDS[SecurityCaseStage.Contained],
    ];

    expect(open?.["projectId"]).toBe(PROJECT_ID);
    expect((open?.["securityCaseStatusId"] as Includes).values).toEqual(
      openStatusIds,
    );
    expect(mine?.["projectId"]).toBe(PROJECT_ID);
    expect(mine?.["assignedToUserId"]).toEqual(new ObjectID(ME));
    expect((mine?.["securityCaseStatusId"] as Includes).values).toEqual(
      openStatusIds,
    );
    // Exactly what Assigned to Me itself asks for.
    expect({ ...mine, projectId: undefined }).toEqual({
      ...getSecurityCaseQueueQuery(
        "mine",
        new ObjectID(ME),
        buildDefaultTestStatuses(),
      ),
      projectId: undefined,
    });
    expect(runs[0]).toEqual({
      projectId: PROJECT_ID,
      status: SecurityPlaybookRunStatus.WaitingForApproval,
    });
  });

  test("counts a project's own open status among the open cases, and nothing before its statuses are read", async () => {
    const eradicatingId: string = "c2000000-0000-4000-8000-0000000000a2";
    const statuses: ReturnType<typeof buildDefaultTestStatuses> =
      buildDefaultTestStatuses();
    statuses[3]!.order = 5; // Closed
    statuses.push(
      buildTestStatus({ id: eradicatingId, name: "Eradicating", order: 4 }),
    );
    stubDashboardSecurityCaseValues({ statuses });

    await renderSecurityMenu();

    const open: Record<string, unknown> | undefined = countQueries
      .map((entry: { query: unknown }): Record<string, unknown> => {
        return entry.query as Record<string, unknown>;
      })
      .find((query: Record<string, unknown>): boolean => {
        return (
          Boolean(query["securityCaseStatusId"]) && !query["assignedToUserId"]
        );
      });

    expect((open?.["securityCaseStatusId"] as Includes).values).toEqual([
      TEST_STATUS_IDS[SecurityCaseStage.New],
      TEST_STATUS_IDS[SecurityCaseStage.Acknowledged],
      TEST_STATUS_IDS[SecurityCaseStage.Contained],
      eradicatingId,
    ]);
    cleanup();

    // Statuses that cannot be read: no case count, never one of every case.
    countQueries.length = 0;
    jest
      .spyOn(ModelListCache, "getList")
      .mockRejectedValue(new Error("offline") as never);
    await renderSecurityMenu();

    expect(
      countQueries.filter((entry: { model: string }): boolean => {
        return entry.model === "SecurityCase";
      }),
    ).toEqual([]);
    expect(badgeOf("Security Cases", "Open Cases")).toBe("");
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
    expect(mobileSummaryText()).toContain("Playbooks / Approvals");
    cleanup();

    goTo(routeFor(PageMap.SECURITY_EVENTS));
    await renderSecurityMenu();
    expect(mobileSummaryText()).toContain("Events");
    expect(mobileSummaryText()).not.toContain("Events / Events");
    cleanup();

    goTo(routeFor(PageMap.SECURITY_EVENTS_WORKSPACE_CONNECTION_SLACK));
    await renderSecurityMenu();
    expect(mobileSummaryText()).toContain("Workspace / Slack");
  });
});

/*
 * "Products → Security Events → Workspace → Slack (or Microsoft Teams)": the
 * security cases' notification rules, as the Security Cases docs send
 * people to them. The section is every product's (useWorkspaceSideMenuSection),
 * so it lists only what the project has connected.
 */
describe("Security Events side menu: the Workspace section", () => {
  beforeEach(() => {
    setViewportWidth(DESKTOP_WIDTH);
    jest.spyOn(User, "getUserId").mockReturnValue(new ObjectID(ME));
    goTo(`/dashboard/${PROJECT_ID}/security-events/overview`);
    window.localStorage.clear();
    ConnectedWorkspaces.reset();
    stubDashboardSecurityCaseValues();
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
    ConnectedWorkspaces.reset();
  });

  test("sits after Playbooks and before Connections, whatever is connected", async () => {
    for (const connected of [
      [],
      [WorkspaceType.Slack],
      [WorkspaceType.MicrosoftTeams],
      [WorkspaceType.Slack, WorkspaceType.MicrosoftTeams],
    ]) {
      ConnectedWorkspaces.setConnected(PROJECT_ID, connected);
      await renderSecurityMenu();

      expect(sectionTitlesInOrder()).toEqual([
        "Overview",
        "Security Cases",
        "Events",
        "Detections",
        "Playbooks",
        "AI",
        "Workspace",
        "Connections",
        "Settings",
      ]);
      expect(isExpanded("Workspace")).toBe(false);

      cleanup();
    }
  });

  test("lists only the connected workspace: Slack", async () => {
    ConnectedWorkspaces.setConnected(PROJECT_ID, [WorkspaceType.Slack]);
    await renderSecurityMenu();

    expect(linksIn("Workspace")).toEqual([
      {
        title: "Slack",
        href: routeFor(PageMap.SECURITY_EVENTS_WORKSPACE_CONNECTION_SLACK),
      },
    ]);
  });

  test("lists only the connected workspace: Microsoft Teams", async () => {
    ConnectedWorkspaces.setConnected(PROJECT_ID, [
      WorkspaceType.MicrosoftTeams,
    ]);
    await renderSecurityMenu();

    expect(linksIn("Workspace")).toEqual([
      {
        title: "Microsoft Teams",
        href: routeFor(
          PageMap.SECURITY_EVENTS_WORKSPACE_CONNECTION_MICROSOFT_TEAMS,
        ),
      },
    ]);
  });

  test("with nothing connected, holds one entry, to its own page that connects them", async () => {
    ConnectedWorkspaces.setConnected(PROJECT_ID, []);
    await renderSecurityMenu();

    expect(linksIn("Workspace")).toEqual([
      {
        title: "Connect Slack or Teams",
        href: routeFor(PageMap.SECURITY_EVENTS_WORKSPACE_CONNECTIONS),
      },
    ]);
  });

  test.each([
    ["Slack", PageMap.SECURITY_EVENTS_WORKSPACE_CONNECTION_SLACK],
    [
      "Microsoft Teams",
      PageMap.SECURITY_EVENTS_WORKSPACE_CONNECTION_MICROSOFT_TEAMS,
    ],
  ])(
    "opens by itself on the %s page, and marks it",
    async (title: string, page: string) => {
      ConnectedWorkspaces.setConnected(PROJECT_ID, [
        WorkspaceType.Slack,
        WorkspaceType.MicrosoftTeams,
      ]);
      goTo(routeFor(page));
      await renderSecurityMenu();

      expect(isExpanded("Workspace")).toBe(true);
      expect(sectionBody("Workspace")).not.toHaveClass("invisible");
      expect(isExpanded("Detections")).toBe(false);
      expect(isExpanded("Connections")).toBe(false);
      expect(activeLinkTitles()).toEqual([title]);
    },
  );

  test("the page that connects them opens it and marks its entry", async () => {
    ConnectedWorkspaces.setConnected(PROJECT_ID, []);
    goTo(routeFor(PageMap.SECURITY_EVENTS_WORKSPACE_CONNECTIONS));
    await renderSecurityMenu();

    expect(isExpanded("Workspace")).toBe(true);
    expect(activeLinkTitles()).toEqual(["Connect Slack or Teams"]);
  });

  test("opens with a click", async () => {
    ConnectedWorkspaces.setConnected(PROJECT_ID, [WorkspaceType.Slack]);
    await renderSecurityMenu();

    fireEvent.click(sectionToggle("Workspace"));

    expect(isExpanded("Workspace")).toBe(true);
    expect(sectionBody("Workspace")).not.toHaveClass("invisible");
  });

  test("its pages and names are the ones the navigation lists, as every Workspace section names them", () => {
    expect(SECURITY_EVENTS_WORKSPACE_SECTION_TITLE).toBe(
      WORKSPACE_SECTION_TITLE,
    );
    expect(SECURITY_EVENTS_WORKSPACE_PAGES).toEqual({
      slack: PageMap.SECURITY_EVENTS_WORKSPACE_CONNECTION_SLACK,
      microsoftTeams:
        PageMap.SECURITY_EVENTS_WORKSPACE_CONNECTION_MICROSOFT_TEAMS,
      connect: PageMap.SECURITY_EVENTS_WORKSPACE_CONNECTIONS,
    });
    expect(
      getSecurityEventsPageTrail(SECURITY_EVENTS_WORKSPACE_PAGES.slack),
    ).toEqual([
      "Security Events",
      WORKSPACE_SECTION_TITLE,
      WORKSPACE_MENU_ENTRY_TITLES[WorkspaceMenuEntry.Slack],
    ]);
    expect(
      getSecurityEventsPageTrail(
        SECURITY_EVENTS_WORKSPACE_PAGES.microsoftTeams,
      ),
    ).toEqual([
      "Security Events",
      WORKSPACE_SECTION_TITLE,
      WORKSPACE_MENU_ENTRY_TITLES[WorkspaceMenuEntry.MicrosoftTeams],
    ]);
  });
});
