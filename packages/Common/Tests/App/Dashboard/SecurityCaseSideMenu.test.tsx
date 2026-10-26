import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import "@testing-library/jest-dom";
import { RenderResult, act, cleanup, fireEvent } from "@testing-library/react";
import * as React from "react";

/*
 * A security case's own side menu, rendered against the real RouteMap: "When
 * I open the case, can I have a side menu (on the similar lines that we do
 * for incidents / alerts / scheduled maintenance)" (the maintainer).
 *
 * Pinned here: the sections and entries in order and where each links (the
 * case's own address for its Overview, each other page one level under it),
 * an icon for every entry, Advanced folded on the case's Overview and open
 * on its own pages, exactly the entry of the page you are on lit, the count
 * of the case's runs waiting for an approval beside Playbooks (asking
 * for this case's runs only, and asked again when the case changes), Delete
 * Case drawn as a deletion, and the phone's "Section / Page" summary.
 *
 * ModelAPI.count backs the count; it is stubbed inline because jest.mock is
 * hoisted above the imports.
 */
const countQueries: Array<{ model: string; query: unknown }> = [];
let waitingRuns: number = 2;

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      count: (data: { modelType: { name: string }; query: unknown }) => {
        countQueries.push({ model: data.modelType.name, query: data.query });
        return Promise.resolve(waitingRuns);
      },
    },
  };
});

import SecurityCaseSideMenu from "../../../../App/FeatureSet/Dashboard/src/Pages/SecurityEvents/CaseView/SideMenu";
import { getSecurityCaseMenuBadgeCount } from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityCase/SecurityCaseMenuBadgeCount";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import { RouteUtil } from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import ObjectID from "../../../Types/ObjectID";
import SecurityPlaybookRunStatus from "../../../Types/SecurityPlaybook/SecurityPlaybookRunStatus";
import { BadgeType } from "../../../UI/Components/Badge/Badge";
import { REFRESH_SIDEBAR_COUNT_EVENT } from "../../../UI/Components/SideMenu/CountModelSideMenuItem";
import GlobalEvents from "../../../UI/Utils/GlobalEvents";
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
  sectionBody,
  sectionTitlesInOrder,
  sectionToggle,
  setViewportWidth,
} from "./SideMenuHarness";

const CASE_ID: string = "20000000-0000-4000-8000-000000000142";
const OTHER_CASE_ID: string = "20000000-0000-4000-8000-000000000141";

// A case page's address in the project, from the app's own route table.
function caseRoute(page: PageMap, caseId: string = CASE_ID): string {
  return RouteUtil.getRouteString(page)
    .replace(":projectId", PROJECT_ID)
    .replace(":id", caseId);
}

async function renderCaseMenu(caseId: string = CASE_ID): Promise<RenderResult> {
  return await renderMenu(
    <SecurityCaseSideMenu modelId={new ObjectID(caseId)} />,
  );
}

// Each section, and its entries as the menu links them.
const EXPECTED: Array<[string, Array<[string, PageMap]>]> = [
  [
    "Overview",
    [
      ["Overview", PageMap.SECURITY_CASE_VIEW],
      ["Timeline", PageMap.SECURITY_CASE_VIEW_TIMELINE],
    ],
  ],
  [
    "Investigation",
    [
      ["Detections", PageMap.SECURITY_CASE_VIEW_DETECTIONS],
      ["Entities", PageMap.SECURITY_CASE_VIEW_ENTITIES],
      ["Connected Signals", PageMap.SECURITY_CASE_VIEW_CONNECTED_SIGNALS],
      ["Playbooks", PageMap.SECURITY_CASE_VIEW_PLAYBOOK_RUNS],
    ],
  ],
  ["Notes", [["Private Notes", PageMap.SECURITY_CASE_VIEW_NOTES]]],
  [
    "Advanced",
    [
      ["Audit Logs", PageMap.SECURITY_CASE_VIEW_AUDIT_LOGS],
      ["Delete Case", PageMap.SECURITY_CASE_VIEW_DELETE],
    ],
  ],
];

const PAGES: Array<[PageMap, string, string]> = EXPECTED.flatMap(
  ([section, entries]: [string, Array<[string, PageMap]>]): Array<
    [PageMap, string, string]
  > => {
    return entries.map(
      ([title, page]: [string, PageMap]): [PageMap, string, string] => {
        return [page, section, title];
      },
    );
  },
);

function entryAnchor(section: string, title: string): HTMLAnchorElement {
  const anchor: HTMLAnchorElement | undefined = Array.from(
    sectionBody(section).querySelectorAll("a"),
  ).find((candidate: HTMLAnchorElement): boolean => {
    return (
      (
        candidate.querySelector("span.truncate")?.textContent ||
        candidate.textContent ||
        ""
      ).trim() === title
    );
  });

  if (!anchor) {
    throw new Error(`No entry "${title}" in section "${section}".`);
  }

  return anchor;
}

function badgeOf(section: string, title: string): string {
  const badge: Element | null = entryAnchor(section, title).querySelector(
    "span.rounded-full",
  );

  return (badge?.textContent || "").trim();
}

describe("a security case's side menu", () => {
  beforeEach(() => {
    setViewportWidth(DESKTOP_WIDTH);
    countQueries.length = 0;
    waitingRuns = 2;
    goTo(caseRoute(PageMap.SECURITY_CASE_VIEW));
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  test("is an incident's sections where a case has pages for them, each holding its pages", async () => {
    await renderCaseMenu();

    expect(sectionTitlesInOrder()).toEqual([
      "Overview",
      "Investigation",
      "Notes",
      "Advanced",
    ]);

    // Advanced is folded here; open it to read what it holds.
    fireEvent.click(sectionToggle("Advanced"));

    for (const [section, entries] of EXPECTED) {
      expect([
        section,
        linksIn(section).map((link: MenuLink): string => {
          return link.title;
        }),
      ]).toEqual([
        section,
        entries.map(([title]: [string, PageMap]): string => {
          return title;
        }),
      ]);
    }
  });

  test("links each entry to the case's own page: its Overview at the case's address, the others one level under it", async () => {
    await renderCaseMenu();
    fireEvent.click(sectionToggle("Advanced"));

    for (const [section, entries] of EXPECTED) {
      expect(
        linksIn(section).map((link: MenuLink): [string, string] => {
          return [link.title, link.href];
        }),
      ).toEqual(
        entries.map(([title, page]: [string, PageMap]): [string, string] => {
          return [title, caseRoute(page)];
        }),
      );
    }

    expect(entryAnchor("Overview", "Overview")).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID}/security-events/cases/${CASE_ID}`,
    );
    expect(entryAnchor("Investigation", "Detections")).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID}/security-events/cases/${CASE_ID}/detections`,
    );
  });

  test("links another case's pages when it is another case's menu", async () => {
    goTo(caseRoute(PageMap.SECURITY_CASE_VIEW, OTHER_CASE_ID));
    await renderCaseMenu(OTHER_CASE_ID);

    expect(entryAnchor("Investigation", "Entities")).toHaveAttribute(
      "href",
      caseRoute(PageMap.SECURITY_CASE_VIEW_ENTITIES, OTHER_CASE_ID),
    );
  });

  test("draws every entry an icon of its own", async () => {
    const rendered: RenderResult = await renderCaseMenu();
    const drawings: Array<string> = Array.from(
      rendered.container.querySelectorAll("a"),
    ).map((anchor: HTMLAnchorElement): string => {
      const svg: SVGElement | null = anchor.querySelector("svg");

      expect(svg).not.toBeNull();

      return svg?.innerHTML || "";
    });

    expect(drawings).toHaveLength(PAGES.length);
    expect(new Set(drawings).size).toBe(drawings.length);
  });

  test("on the case's Overview, Advanced is folded to its title and everything else is open", async () => {
    await renderCaseMenu();

    expect(isExpanded("Overview")).toBe(true);
    expect(isExpanded("Investigation")).toBe(true);
    expect(isExpanded("Notes")).toBe(true);
    expect(isExpanded("Advanced")).toBe(false);
    expect(sectionBody("Advanced")).toHaveClass("invisible");
  });

  test.each(PAGES)(
    "%s opens its section, %s, and lights its own entry, %s, alone",
    async (page: PageMap, section: string, title: string) => {
      goTo(caseRoute(page));
      await renderCaseMenu();

      expect(isExpanded(section)).toBe(true);
      expect(activeLinkTitles()).toEqual([title]);
    },
  );

  test("Delete Case is drawn as a deletion, red on hover, as every record's Delete is", async () => {
    goTo(caseRoute(PageMap.SECURITY_CASE_VIEW_DELETE));
    await renderCaseMenu();

    expect(entryAnchor("Advanced", "Delete Case").className).toContain(
      "danger-on-hover",
    );
    expect(entryAnchor("Advanced", "Audit Logs").className).not.toContain(
      "danger-on-hover",
    );
  });

  test("counts the case's runs waiting for an approval beside Playbooks, and nothing else", async () => {
    await renderCaseMenu();

    expect(badgeOf("Investigation", "Playbooks")).toBe("2");
    expect(badgeOf("Investigation", "Detections")).toBe("");
    expect(badgeOf("Overview", "Timeline")).toBe("");

    expect(countQueries).toEqual([
      {
        model: "SecurityPlaybookRun",
        query: {
          projectId: PROJECT_ID,
          securityCaseId: CASE_ID,
          status: SecurityPlaybookRunStatus.WaitingForApproval,
        },
      },
    ]);
  });

  test("with no run waiting, Playbooks shows no count", async () => {
    waitingRuns = 0;
    await renderCaseMenu();

    expect(badgeOf("Investigation", "Playbooks")).toBe("");
  });

  test("asks again when the case changes, so a decided run leaves the count", async () => {
    await renderCaseMenu();

    expect(badgeOf("Investigation", "Playbooks")).toBe("2");

    waitingRuns = 1;

    await act(async () => {
      GlobalEvents.dispatchEvent(REFRESH_SIDEBAR_COUNT_EVENT);
    });

    expect(countQueries).toHaveLength(2);
    expect(badgeOf("Investigation", "Playbooks")).toBe("1");
  });

  test("on a phone, the menu names the section and the page it is on", async () => {
    setViewportWidth(MOBILE_WIDTH);
    goTo(caseRoute(PageMap.SECURITY_CASE_VIEW_PLAYBOOK_RUNS));
    await renderCaseMenu();

    expect(mobileSummaryText()).toContain("Investigation");
    expect(mobileSummaryText()).toContain("Playbooks");
  });
});

describe("the count beside Playbooks", () => {
  beforeEach(() => {
    goTo(caseRoute(PageMap.SECURITY_CASE_VIEW));
  });

  test("asks for this case's runs held for an approval, in the warning colour the Approvals count has", () => {
    expect(
      getSecurityCaseMenuBadgeCount(
        "runsWaitingForApproval",
        new ObjectID(CASE_ID),
      ),
    ).toEqual({
      modelType: expect.anything(),
      countQuery: {
        projectId: PROJECT_ID,
        securityCaseId: CASE_ID,
        status: SecurityPlaybookRunStatus.WaitingForApproval,
      },
      badgeType: BadgeType.WARNING,
    });
  });

  test("counts nothing for an entry with no count, or a case with no id", () => {
    expect(
      getSecurityCaseMenuBadgeCount(undefined, new ObjectID(CASE_ID)),
    ).toBeUndefined();
    expect(
      getSecurityCaseMenuBadgeCount("runsWaitingForApproval", new ObjectID("")),
    ).toBeUndefined();
  });

  test("counts nothing outside a project", () => {
    goTo("/accounts/login");

    expect(
      getSecurityCaseMenuBadgeCount(
        "runsWaitingForApproval",
        new ObjectID(CASE_ID),
      ),
    ).toBeUndefined();
  });
});
