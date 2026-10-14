import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import "@testing-library/jest-dom";
import { cleanup } from "@testing-library/react";
import * as React from "react";

/*
 * The Security Events side menu, rendered against the real RouteMap: every
 * entry links to the route its page is registered under, the page you are
 * on is the one entry lit, and the counts beside Cases and Playbook Runs ask
 * for what is waiting - the open cases, and the runs held for approval.
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
  activeLinkTitles,
  allLinks,
  goTo,
  linksIn,
  renderMenu,
  routeFor,
  sectionTitlesInOrder,
  setViewportWidth,
} from "./SideMenuHarness";

async function renderSecurityMenu(): Promise<void> {
  await renderMenu(<SecurityEventsSideMenu />);
}

const EXPECTED: Array<{ section: string; links: Array<[string, string]> }> = [
  {
    section: "Overview",
    links: [
      ["Overview", PageMap.SECURITY_EVENTS_OVERVIEW],
      ["Security Cases", PageMap.SECURITY_CASES],
    ],
  },
  {
    section: "Investigate",
    links: [
      ["Events", PageMap.SECURITY_EVENTS],
      ["Correlate", PageMap.SECURITY_EVENTS_CORRELATE],
      ["Entities", PageMap.SECURITY_EVENTS_ENTITIES],
    ],
  },
  {
    section: "Detect",
    links: [
      ["Detection Rules", PageMap.SECURITY_EVENTS_DETECTION_RULES],
      ["Rule Library", PageMap.SECURITY_EVENTS_RULE_LIBRARY],
      ["ATT&CK Coverage", PageMap.SECURITY_EVENTS_ATTACK_COVERAGE],
      ["Threat Intel", PageMap.SECURITY_EVENTS_THREAT_INTEL],
      ["Monitors", PageMap.SECURITY_EVENTS_MONITORS],
    ],
  },
  {
    section: "Respond",
    links: [
      ["Playbooks", PageMap.SECURITY_PLAYBOOKS],
      ["Playbook Runs", PageMap.SECURITY_PLAYBOOK_RUNS],
    ],
  },
  {
    section: "Sources",
    links: [
      ["Connections", PageMap.SECURITY_EVENTS_CONNECTIONS],
      ["Setup Guide", PageMap.SECURITY_EVENTS_DOCUMENTATION],
    ],
  },
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

  test("renders its sections in the order the work goes", async () => {
    await renderSecurityMenu();

    expect(sectionTitlesInOrder()).toEqual(
      EXPECTED.map((entry: { section: string }): string => {
        return entry.section;
      }),
    );
  });

  test("links every entry to the route its page is registered under", async () => {
    await renderSecurityMenu();

    for (const entry of EXPECTED) {
      expect(
        linksIn(entry.section).map((link: MenuLink): [string, string] => {
          return [link.title, link.href];
        }),
      ).toEqual(
        entry.links.map(([title, page]: [string, string]): [string, string] => {
          return [title, routeFor(page)];
        }),
      );
    }
  });

  test("lists no page twice", async () => {
    await renderSecurityMenu();

    const hrefs: Array<string> = allLinks().map((link: MenuLink): string => {
      return link.href;
    });

    expect(new Set(hrefs).size).toBe(hrefs.length);
  });

  test.each(
    EXPECTED.flatMap((entry: { links: Array<[string, string]> }) => {
      return entry.links;
    }),
  )(
    "lights %s, and only it, on its own page",
    async (title: string, page: string) => {
      goTo(routeFor(page));
      await renderSecurityMenu();

      expect(activeLinkTitles()).toEqual([title]);
    },
  );

  test("lights nothing on a case's own page: it opens outside the menu", async () => {
    goTo(
      `/dashboard/${PROJECT_ID}/security-events/cases/44444444-4444-4444-8444-444444444444`,
    );
    await renderSecurityMenu();

    expect(activeLinkTitles()).toEqual([]);
  });

  test("counts the open cases and the runs waiting for approval", async () => {
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
