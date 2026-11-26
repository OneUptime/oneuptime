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
 * THE DATA SECURITY SIDE MENU (Pages/DataSecurity/SideMenu, from
 * Utils/DataSecurityNavigation): its sections and entries in order, where
 * each links, and the two live counts beside them - the open issues beside
 * Issues, in red, and what OneUptime AI proposes that waits for a person
 * beside AI, in amber (#10364). Nothing broke while a proposal waits: amber,
 * as approvals are counted elsewhere.
 */

const countQueries: Array<{ model: string; query: unknown }> = [];
let openIssues: number = 4;
let waitingProposals: number = 2;

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      count: (data: { modelType: { name: string }; query: unknown }) => {
        countQueries.push({ model: data.modelType.name, query: data.query });
        return Promise.resolve(
          data.modelType.name === "DataSecurityAiProposal"
            ? waitingProposals
            : openIssues,
        );
      },
    },
  };
});

import DataSecuritySideMenu, {
  getBadgeCount,
  MenuBadgeCount,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/DataSecurity/SideMenu";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import DataSecurityAiProposal from "../../../Models/DatabaseModels/DataSecurityAiProposal";
import DataSecurityIssue from "../../../Models/DatabaseModels/DataSecurityIssue";
import { DataSecurityAiProposalStatus } from "../../../Types/DataSecurity/DataSecurityAi";
import DataSecurityIssueStatus from "../../../Types/DataSecurity/DataSecurityIssueStatus";
import { BadgeType } from "../../../UI/Components/Badge/Badge";
import {
  DESKTOP_WIDTH,
  MenuLink,
  PROJECT_ID,
  goTo,
  linksIn,
  renderMenu,
  routeFor,
  sectionBody,
  sectionTitlesInOrder,
  sectionToggle,
  setViewportWidth,
} from "./SideMenuHarness";

const EXPECTED: Array<[string, Array<[string, PageMap]>]> = [
  [
    "Data Security",
    [
      ["Overview", PageMap.DATA_SECURITY_OVERVIEW],
      ["Data Stores", PageMap.DATA_SECURITY_STORES],
      ["Issues", PageMap.DATA_SECURITY_ISSUES],
      ["AI", PageMap.DATA_SECURITY_AI],
      ["Sensitive Data", PageMap.DATA_SECURITY_SENSITIVE_DATA],
      ["In Your Telemetry", PageMap.DATA_SECURITY_TELEMETRY],
      ["Data Flows", PageMap.DATA_SECURITY_FLOWS],
      ["Access", PageMap.DATA_SECURITY_ACCESS],
      ["Compliance", PageMap.DATA_SECURITY_COMPLIANCE],
    ],
  ],
  [
    "Settings",
    [
      ["Data Types", PageMap.DATA_SECURITY_SETTINGS_DATA_TYPES],
      ["Checks", PageMap.DATA_SECURITY_SETTINGS_CHECKS],
      ["Residency Rules", PageMap.DATA_SECURITY_SETTINGS_RESIDENCY],
      ["Scan Settings", PageMap.DATA_SECURITY_SETTINGS_SCANNING],
      ["OneUptime AI", PageMap.DATA_SECURITY_SETTINGS_AI],
    ],
  ],
  [
    "Rules",
    [
      ["Owner Rules", PageMap.DATA_SECURITY_SETTINGS_OWNER_RULES],
      ["Label Rules", PageMap.DATA_SECURITY_SETTINGS_LABEL_RULES],
    ],
  ],
  ["Help", [["Documentation", PageMap.DATA_SECURITY_DOCUMENTATION]]],
  [
    "Advanced",
    [
      ["Scans", PageMap.DATA_SECURITY_SCANS],
      ["Archived Stores", PageMap.DATA_SECURITY_STORES_ARCHIVED],
    ],
  ],
];

function entryAnchor(section: string, title: string): HTMLAnchorElement {
  const anchor: HTMLAnchorElement | undefined = Array.from(
    sectionBody(section).querySelectorAll("a"),
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

// A count's query, its project id as text.
function queryOf(count: MenuBadgeCount | undefined): Record<string, string> {
  const query: Record<string, unknown> = (count?.countQuery || {}) as Record<
    string,
    unknown
  >;

  return Object.fromEntries(
    Object.entries(query).map(
      ([key, value]: [string, unknown]): [string, string] => {
        return [key, String(value)];
      },
    ),
  );
}

describe("the Data Security side menu", () => {
  beforeEach(() => {
    setViewportWidth(DESKTOP_WIDTH);
    countQueries.length = 0;
    openIssues = 4;
    waitingProposals = 2;
    goTo(`/dashboard/${PROJECT_ID}/data-security/ai`);
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  test("lists AI among the everyday pages, right after the issues it works on", async () => {
    await renderMenu(<DataSecuritySideMenu />);

    expect(sectionTitlesInOrder()).toEqual(
      EXPECTED.map(([section]: [string, unknown]): string => {
        return section;
      }),
    );

    for (const [section] of EXPECTED) {
      if (section !== "Data Security") {
        fireEvent.click(sectionToggle(section));
      }
    }

    for (const [section, entries] of EXPECTED) {
      expect([
        section,
        linksIn(section).map((link: MenuLink): [string, string] => {
          return [link.title, link.href];
        }),
      ]).toEqual([
        section,
        entries.map(([title, page]: [string, PageMap]): [string, string] => {
          return [title, routeFor(page)];
        }),
      ]);
    }

    expect(entryAnchor("Data Security", "AI")).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID}/data-security/ai`,
    );
  });

  test("counts the open issues beside Issues and the proposals waiting beside AI, and nothing else", async () => {
    await renderMenu(<DataSecuritySideMenu />);

    expect(badgeOf("Data Security", "Issues")).toBe("4");
    expect(badgeOf("Data Security", "AI")).toBe("2");
    expect(badgeOf("Data Security", "Overview")).toBe("");
    expect(badgeOf("Data Security", "Compliance")).toBe("");

    expect(
      countQueries
        .map((entry: { model: string; query: unknown }): string => {
          return entry.model;
        })
        .sort(),
    ).toEqual(["DataSecurityAiProposal", "DataSecurityIssue"]);
  });

  test("what waits is counted in amber, by its status; the open issues in red", () => {
    const waiting: MenuBadgeCount | undefined =
      getBadgeCount("aiProposalsWaiting");
    const open: MenuBadgeCount | undefined = getBadgeCount("openIssues");

    expect(waiting?.modelType).toBe(DataSecurityAiProposal);
    expect(queryOf(waiting)).toEqual({
      projectId: PROJECT_ID,
      status: DataSecurityAiProposalStatus.Proposed,
    });
    expect(waiting?.badgeType).toBe(BadgeType.WARNING);

    expect(open?.modelType).toBe(DataSecurityIssue);
    expect(queryOf(open)).toEqual({
      projectId: PROJECT_ID,
      status: DataSecurityIssueStatus.Open,
    });
    expect(open?.badgeType).toBe(BadgeType.DANGER);

    expect(getBadgeCount(undefined)).toBeUndefined();
  });
});
