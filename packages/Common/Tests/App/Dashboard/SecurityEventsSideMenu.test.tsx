import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import "@testing-library/jest-dom";
import { RenderResult, cleanup } from "@testing-library/react";
import * as React from "react";

/*
 * The Security Events side menu, rendered against the real RouteMap: six
 * entries and no sections, every entry linking to the route its page is
 * registered under, the entry of the page you are on lit - on each of its
 * tabs too (Rule Library under Detections, Playbook Runs under Playbooks) -
 * and the counts beside Security Cases and Playbooks asking for what is
 * waiting: the open cases, and the runs held for approval.
 *
 * ModelAPI.count backs the badges; it is stubbed inline because jest.mock is
 * hoisted above the imports.
 */
const countQueries: Array<{ model: string; query: unknown }> = [];

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      count: (data: { modelType: { name: string }; query: unknown }) => {
        countQueries.push({ model: data.modelType.name, query: data.query });
        return Promise.resolve(3);
      },
    },
  };
});

import SecurityEventsSideMenu from "../../../../App/FeatureSet/Dashboard/src/Pages/SecurityEvents/SideMenu";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import Includes from "../../../Types/BaseDatabase/Includes";
import { OPEN_SECURITY_CASE_STATUSES } from "../../../Types/SecurityCase/SecurityCaseStatus";
import SecurityPlaybookRunStatus from "../../../Types/SecurityPlaybook/SecurityPlaybookRunStatus";
import {
  DESKTOP_WIDTH,
  MenuLink,
  PROJECT_ID,
  goTo,
  renderMenu,
  routeFor,
  sectionTitlesInOrder,
  setViewportWidth,
} from "./SideMenuHarness";

async function renderSecurityMenu(): Promise<RenderResult> {
  return await renderMenu(<SecurityEventsSideMenu />);
}

function entryTitle(anchor: HTMLAnchorElement): string {
  return (
    anchor.querySelector("span.truncate")?.textContent ??
    anchor.textContent ??
    ""
  ).trim();
}

function menuLinks(rendered: RenderResult): Array<HTMLAnchorElement> {
  return Array.from(rendered.container.querySelectorAll("a"));
}

function entries(rendered: RenderResult): Array<MenuLink> {
  return menuLinks(rendered).map((anchor: HTMLAnchorElement): MenuLink => {
    return {
      title: entryTitle(anchor),
      href: anchor.getAttribute("href") ?? "",
    };
  });
}

// The tinted row with the rail: SideMenuItem's active classes.
function litTitles(rendered: RenderResult): Array<string> {
  return menuLinks(rendered)
    .filter((anchor: HTMLAnchorElement): boolean => {
      return anchor.className.split(/\s+/).includes("bg-indigo-50");
    })
    .map(entryTitle);
}

const EXPECTED: Array<[string, string]> = [
  ["Overview", PageMap.SECURITY_EVENTS_OVERVIEW],
  ["Security Cases", PageMap.SECURITY_CASES],
  ["Events", PageMap.SECURITY_EVENTS],
  ["Detections", PageMap.SECURITY_EVENTS_DETECTION_RULES],
  ["Playbooks", PageMap.SECURITY_PLAYBOOKS],
  ["Connections", PageMap.SECURITY_EVENTS_CONNECTIONS],
];

// Every page the menu reaches, and the one entry lit on it.
const LIT_ON: Array<[string, string]> = [
  [PageMap.SECURITY_EVENTS_OVERVIEW, "Overview"],
  [PageMap.SECURITY_CASES, "Security Cases"],
  [PageMap.SECURITY_EVENTS, "Events"],
  [PageMap.SECURITY_EVENTS_ENTITIES, "Events"],
  [PageMap.SECURITY_EVENTS_CORRELATE, "Events"],
  [PageMap.SECURITY_EVENTS_DETECTION_RULES, "Detections"],
  [PageMap.SECURITY_EVENTS_RULE_LIBRARY, "Detections"],
  [PageMap.SECURITY_EVENTS_THREAT_INTEL, "Detections"],
  [PageMap.SECURITY_EVENTS_ATTACK_COVERAGE, "Detections"],
  [PageMap.SECURITY_PLAYBOOKS, "Playbooks"],
  [PageMap.SECURITY_PLAYBOOK_RUNS, "Playbooks"],
  [PageMap.SECURITY_EVENTS_CONNECTIONS, "Connections"],
  [PageMap.SECURITY_EVENTS_DOCUMENTATION, "Connections"],
];

describe("Security Events side menu", () => {
  beforeEach(() => {
    setViewportWidth(DESKTOP_WIDTH);
    countQueries.length = 0;
    goTo(`/dashboard/${PROJECT_ID}/security-events/overview`);
  });

  afterEach(() => {
    cleanup();
  });

  test("is six entries, in the order the work goes, with no sections to open or close", async () => {
    const rendered: RenderResult = await renderSecurityMenu();

    expect(sectionTitlesInOrder()).toEqual([]);
    expect(
      entries(rendered).map((link: MenuLink): string => {
        return link.title;
      }),
    ).toEqual(
      EXPECTED.map(([title]: [string, string]): string => {
        return title;
      }),
    );
    expect(
      rendered.container.querySelectorAll("button[aria-expanded]"),
    ).toHaveLength(0);
  });

  test("links every entry to the route its page is registered under", async () => {
    const rendered: RenderResult = await renderSecurityMenu();

    expect(
      entries(rendered).map((link: MenuLink): [string, string] => {
        return [link.title, link.href];
      }),
    ).toEqual(
      EXPECTED.map(([title, page]: [string, string]): [string, string] => {
        return [title, routeFor(page)];
      }),
    );
  });

  test("gives every entry an icon", async () => {
    const rendered: RenderResult = await renderSecurityMenu();

    for (const anchor of menuLinks(rendered)) {
      expect([
        entryTitle(anchor),
        anchor.querySelector("svg") !== null,
      ]).toEqual([entryTitle(anchor), true]);
    }
  });

  test.each(LIT_ON)(
    "on %s, lights %s and nothing else",
    async (page: string, title: string) => {
      goTo(routeFor(page));
      const rendered: RenderResult = await renderSecurityMenu();

      expect(litTitles(rendered)).toEqual([title]);
    },
  );

  test("lights nothing on a case's own page: it opens outside the menu", async () => {
    goTo(
      `/dashboard/${PROJECT_ID}/security-events/cases/44444444-4444-4444-8444-444444444444`,
    );
    const rendered: RenderResult = await renderSecurityMenu();

    expect(litTitles(rendered)).toEqual([]);
  });

  test("counts the open cases beside Security Cases and the runs waiting for approval beside Playbooks", async () => {
    await renderSecurityMenu();

    const cases: { model: string; query: unknown } | undefined =
      countQueries.find((entry: { model: string }) => {
        return entry.model === "SecurityCase";
      });
    const runs: { model: string; query: unknown } | undefined =
      countQueries.find((entry: { model: string }) => {
        return entry.model === "SecurityPlaybookRun";
      });

    expect(cases).toBeDefined();
    expect(runs).toBeDefined();

    const caseStatus: Includes = (cases!.query as Record<string, unknown>)[
      "status"
    ] as Includes;

    expect(caseStatus).toBeInstanceOf(Includes);
    expect(caseStatus.values).toEqual([...OPEN_SECURITY_CASE_STATUSES]);
    expect((runs!.query as Record<string, unknown>)["status"]).toBe(
      SecurityPlaybookRunStatus.WaitingForApproval,
    );
    expect(countQueries).toHaveLength(2);
  });
});
