import { afterEach, describe, expect, test } from "@jest/globals";
import "@testing-library/jest-dom";
import { cleanup, render, screen, within } from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import SecurityEventsPageTabs, {
  SECURITY_EVENTS_TABS_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityEventsPageTabs";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
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
  afterEach(() => {
    cleanup();
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

  test("each tab is its own link, so it opens in a new tab and keeps its place in history", () => {
    goTo(routeFor(PageMap.SECURITY_EVENTS_RULE_LIBRARY));
    renderTabs();

    for (const tab of tabs()) {
      expect(tab.href).toMatch(/^\/dashboard\//);
    }
  });
});
