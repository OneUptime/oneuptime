import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import "@testing-library/jest-dom";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import SecurityEventsPageTabs, {
  SECURITY_EVENTS_TABS_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityEventsPageTabs";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import SecurityPlaybookRun from "../../../Models/DatabaseModels/SecurityPlaybookRun";
import { JSONObject } from "../../../Types/JSON";
import SecurityPlaybookRunStatus from "../../../Types/SecurityPlaybook/SecurityPlaybookRunStatus";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import { PROJECT_ID, goTo, routeFor } from "./SideMenuHarness";

/*
 * The tabs across the top of a Security Events page: the pages behind one
 * menu entry, each a link to its own address, the page you are on marked
 * (aria-current) - and nothing at all on a page that stands alone, such as
 * the Overview or the case queue.
 */

function renderTabs(): void {
  render(
    <MemoryRouter>
      <SecurityEventsPageTabs />
    </MemoryRouter>,
  );
}

function tabs(): Array<{ title: string; href: string; current: boolean }> {
  return within(screen.getByTestId(SECURITY_EVENTS_TABS_ID))
    .getAllByRole("link")
    .map((link: HTMLElement) => {
      return {
        title: (link.textContent || "").trim(),
        href: link.getAttribute("href") || "",
        current: link.getAttribute("aria-current") === "page",
      };
    });
}

const GROUPS: Array<{ pages: Array<string>; titles: Array<string> }> = [
  {
    pages: [
      PageMap.SECURITY_EVENTS,
      PageMap.SECURITY_EVENTS_ENTITIES,
      PageMap.SECURITY_EVENTS_CORRELATE,
    ],
    titles: ["Events", "Entities", "Correlate"],
  },
  {
    pages: [
      PageMap.SECURITY_EVENTS_DETECTION_RULES,
      PageMap.SECURITY_EVENTS_RULE_LIBRARY,
      PageMap.SECURITY_EVENTS_THREAT_INTEL,
      PageMap.SECURITY_EVENTS_ATTACK_COVERAGE,
    ],
    titles: [
      "Detection Rules",
      "Rule Library",
      "Threat Intel",
      "ATT&CK Coverage",
    ],
  },
  {
    pages: [PageMap.SECURITY_PLAYBOOKS, PageMap.SECURITY_PLAYBOOK_RUNS],
    titles: ["Playbooks", "Playbook Runs"],
  },
  {
    pages: [
      PageMap.SECURITY_EVENTS_CONNECTIONS,
      PageMap.SECURITY_EVENTS_DOCUMENTATION,
    ],
    titles: ["Connections", "Setup Guide"],
  },
];

describe("Security Events page tabs", () => {
  beforeEach(() => {
    // The Playbook Runs tab counts its runs; nothing waits unless a test says so.
    jest.spyOn(ModelAPI, "count").mockResolvedValue(0 as never);
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  for (const group of GROUPS) {
    group.pages.forEach((page: string, index: number) => {
      test(`on ${page}, shows ${group.titles.join(", ")} with ${group.titles[index]} current`, () => {
        goTo(routeFor(page));
        renderTabs();

        expect(tabs()).toEqual(
          group.pages.map((tabPage: string, tabIndex: number) => {
            return {
              title: group.titles[tabIndex],
              href: routeFor(tabPage),
              current: tabPage === page,
            };
          }),
        );
        expect(screen.getByTestId(SECURITY_EVENTS_TABS_ID)).toHaveAttribute(
          "aria-label",
          "Pages in this section",
        );
      });
    });
  }

  test.each([
    ["the Overview", `/dashboard/${PROJECT_ID}/security-events/overview`],
    ["the case queue", `/dashboard/${PROJECT_ID}/security-events/cases`],
    [
      "a case",
      `/dashboard/${PROJECT_ID}/security-events/cases/44444444-4444-4444-8444-444444444444`,
    ],
  ])("draws nothing on %s", (_label: string, path: string) => {
    goTo(path);
    renderTabs();

    expect(screen.queryByTestId(SECURITY_EVENTS_TABS_ID)).toBeNull();
  });

  test("Playbook Runs carries the count the Playbooks entry shows: the runs waiting for an approval", async () => {
    const count: ReturnType<typeof jest.spyOn> = jest
      .spyOn(ModelAPI, "count")
      .mockResolvedValue(2 as never);
    goTo(routeFor(PageMap.SECURITY_PLAYBOOKS));

    await act(async () => {
      renderTabs();
    });

    const badge: HTMLElement = await screen.findByTestId(
      `security-events-tab-badge-${PageMap.SECURITY_PLAYBOOK_RUNS}`,
    );
    const runsTab: HTMLElement = screen.getByTestId(
      `security-events-tab-${PageMap.SECURITY_PLAYBOOK_RUNS}`,
    );

    expect(runsTab).toContainElement(badge);
    // The number is drawn for the eye; a screen reader hears what it counts.
    expect(within(badge).getByText("2")).toHaveAttribute("aria-hidden", "true");
    expect(badge).toHaveTextContent("2 runs waiting for approval");
    expect(count).toHaveBeenCalledTimes(1);

    const request: JSONObject = count.mock.calls[0]![0] as JSONObject;

    expect(request["modelType"]).toBe(SecurityPlaybookRun);
    expect((request["query"] as JSONObject)["status"]).toBe(
      SecurityPlaybookRunStatus.WaitingForApproval,
    );
    expect(String((request["query"] as JSONObject)["projectId"])).toBe(
      PROJECT_ID,
    );
    // Only that tab counts anything.
    expect(
      screen.queryByTestId(
        `security-events-tab-badge-${PageMap.SECURITY_PLAYBOOKS}`,
      ),
    ).toBeNull();
  });

  test("no runs waiting, or a count that cannot be read, draws no number at all", async () => {
    jest.spyOn(ModelAPI, "count").mockResolvedValue(0 as never);
    goTo(routeFor(PageMap.SECURITY_PLAYBOOK_RUNS));

    await act(async () => {
      renderTabs();
    });

    expect(
      screen.queryByTestId(
        `security-events-tab-badge-${PageMap.SECURITY_PLAYBOOK_RUNS}`,
      ),
    ).toBeNull();

    cleanup();
    jest
      .spyOn(ModelAPI, "count")
      .mockRejectedValue(new Error("Not allowed") as never);

    await act(async () => {
      renderTabs();
    });

    expect(
      screen.queryByTestId(
        `security-events-tab-badge-${PageMap.SECURITY_PLAYBOOK_RUNS}`,
      ),
    ).toBeNull();
    expect(
      screen.getByTestId(
        `security-events-tab-${PageMap.SECURITY_PLAYBOOK_RUNS}`,
      ),
    ).toHaveTextContent("Playbook Runs");
  });

  test("each tab is its own link, so it opens in a new tab and keeps its place in history", () => {
    goTo(routeFor(PageMap.SECURITY_EVENTS_RULE_LIBRARY));
    renderTabs();

    for (const tab of tabs()) {
      expect(tab.href).toMatch(/^\/dashboard\//);
    }
  });
});
