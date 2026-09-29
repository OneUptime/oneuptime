import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import "@testing-library/jest-dom";
import { act, cleanup, render } from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import SecurityEventsNavTabs from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityEventsNavTabs";
import { getSecurityEventsBreadcrumbs } from "../../../../App/FeatureSet/Dashboard/src/Utils/Breadcrumbs/SecurityEventsBreadcrumbs";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import { RouteUtil } from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import {
  SecurityEventsTabKey,
  getActiveSecurityEventsTab,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/SecurityEventsNavigation";
import { writeTelemetryViewerUrlState } from "../../../../App/FeatureSet/Dashboard/src/Utils/TelemetryViewerUrlState";
import Link from "../../../Types/Link";
import { goTo, PROJECT_ID, routeFor } from "./SideMenuHarness";

/*
 * The Security Events destinations, as header tabs.
 *
 * They used to be a left side menu, which put this product out of step with
 * every other telemetry signal — Logs, Traces, Metrics and Exceptions all
 * carry theirs in the page header through the same shared TelemetryNavTabs.
 * What is pinned here is what the move must not lose: every destination still
 * reachable exactly once, the tab you are on highlighted, the labels still
 * matching their breadcrumb leaves, and the Events tab carrying the slice the
 * reader is looking at so switching away and back does not silently reset it.
 */

interface ExpectedTab {
  label: string;
  pageMapKey: string;
  tab: SecurityEventsTabKey;
}

const EXPECTED_TABS: Array<ExpectedTab> = [
  { label: "Events", pageMapKey: PageMap.SECURITY_EVENTS, tab: "events" },
  {
    label: "Correlate",
    pageMapKey: PageMap.SECURITY_EVENTS_CORRELATE,
    tab: "correlate",
  },
  {
    label: "Detection Rules",
    pageMapKey: PageMap.SECURITY_EVENTS_DETECTION_RULES,
    tab: "detection-rules",
  },
  {
    label: "Threat Intel",
    pageMapKey: PageMap.SECURITY_EVENTS_THREAT_INTEL,
    tab: "threat-intel",
  },
  {
    label: "Monitors",
    pageMapKey: PageMap.SECURITY_EVENTS_MONITORS,
    tab: "monitors",
  },
  {
    label: "Connections",
    pageMapKey: PageMap.SECURITY_EVENTS_CONNECTIONS,
    tab: "connections",
  },
  {
    label: "Setup Guide",
    pageMapKey: PageMap.SECURITY_EVENTS_DOCUMENTATION,
    tab: "setup",
  },
];

function renderTabs(active: SecurityEventsTabKey): void {
  render(
    <MemoryRouter>
      <SecurityEventsNavTabs active={active} />
    </MemoryRouter>,
  );
}

function anchors(): Array<HTMLAnchorElement> {
  return Array.from(document.querySelectorAll("a"));
}

function labels(): Array<string> {
  return anchors().map((anchor: HTMLAnchorElement): string => {
    return anchor.textContent?.trim() ?? "";
  });
}

function hrefs(): Array<string> {
  return anchors().map((anchor: HTMLAnchorElement): string => {
    return anchor.getAttribute("href") ?? "";
  });
}

function anchorFor(label: string): HTMLAnchorElement {
  const anchor: HTMLAnchorElement | undefined = anchors().find(
    (candidate: HTMLAnchorElement): boolean => {
      return candidate.textContent?.trim() === label;
    },
  );

  if (!anchor) {
    throw new Error(
      `No tab labelled "${label}". Tabs rendered: ${labels().join(", ")}`,
    );
  }

  return anchor;
}

beforeEach(() => {
  goTo(`/dashboard/${PROJECT_ID}/security-events`);
});

afterEach(() => {
  cleanup();
});

describe("Security Events header tabs", () => {
  test("every destination is a tab, in the intended order", () => {
    renderTabs("events");

    expect(labels()).toEqual(
      EXPECTED_TABS.map((tab: ExpectedTab): string => {
        return tab.label;
      }),
    );
  });

  test("keeps all seven routes reachable exactly once, with icons", () => {
    renderTabs("events");

    const expectedHrefs: Array<string> = EXPECTED_TABS.map(
      (tab: ExpectedTab): string => {
        return routeFor(tab.pageMapKey);
      },
    );

    expect(anchors()).toHaveLength(7);
    expect(hrefs()).toEqual(expectedHrefs);
    expect(new Set(hrefs()).size).toBe(hrefs().length);
    expect(new Set(labels()).size).toBe(labels().length);

    for (const anchor of anchors()) {
      expect(anchor.querySelector("svg")).not.toBeNull();
    }
  });

  /*
   * A ":projectId" left in an href is the classic failure of these menus: the
   * link renders, reads correctly, and navigates to a page that cannot load.
   */
  test("every href is resolved against the current project", () => {
    renderTabs("events");

    for (const href of hrefs()) {
      expect(href.startsWith(`/dashboard/${PROJECT_ID}/`)).toBe(true);
      expect(href).not.toContain(":projectId");
    }
  });

  test.each(EXPECTED_TABS)(
    "$label is the highlighted tab when it is the active one",
    (tab: ExpectedTab): void => {
      renderTabs(tab.tab);

      const anchor: HTMLAnchorElement = anchorFor(tab.label);

      expect(anchor).toHaveClass("bg-indigo-50");
      expect(anchor).toHaveClass("text-indigo-700");
      expect(
        Array.from(document.querySelectorAll("a.bg-indigo-50")),
      ).toHaveLength(1);
    },
  );

  test.each(EXPECTED_TABS)(
    "the route of $label resolves back to its own tab",
    (tab: ExpectedTab): void => {
      expect(getActiveSecurityEventsTab(routeFor(tab.pageMapKey))).toBe(
        tab.tab,
      );
    },
  );

  test("every tab label matches its breadcrumb leaf", () => {
    for (const tab of EXPECTED_TABS) {
      const trail: Array<Link> | undefined = getSecurityEventsBreadcrumbs(
        RouteUtil.getRouteString(tab.pageMapKey as never),
      );

      expect(trail).toBeDefined();
      expect(trail?.[trail.length - 1]?.title).toBe(
        tab.pageMapKey === PageMap.SECURITY_EVENTS
          ? "Security Events"
          : tab.label,
      );
    }
  });
});

describe("the Events tab carries the slice the reader is looking at", () => {
  /*
   * Only the Events tab is backed by an explorer, so it is the only tab whose
   * link can describe a slice. Handing a `filters` payload to Detection Rules
   * or Connections would put params on a URL nothing there reads — and
   * re-emit them on the way back as if the user had set them there.
   */
  test("carries the window and chips onto the Events link, and onto no other", () => {
    goTo(`/dashboard/${PROJECT_ID}/security-events/correlate`);

    act(() => {
      writeTelemetryViewerUrlState({
        range: "PAST_ONE_WEEK",
        filters: JSON.stringify([["severityName", "Critical"]]),
        search: "failed logon",
      });
    });

    renderTabs("correlate");

    const eventsHref: string = anchorFor("Events").getAttribute("href") ?? "";
    const params: URLSearchParams = new URLSearchParams(
      eventsHref.slice(eventsHref.indexOf("?")),
    );

    expect(params.get("range")).toBe("PAST_ONE_WEEK");
    expect(JSON.parse(params.get("filters") as string)).toEqual([
      ["severityName", "Critical"],
    ]);
    expect(params.get("search")).toBe("failed logon");

    for (const label of ["Correlate", "Detection Rules", "Connections"]) {
      expect(anchorFor(label).getAttribute("href")).not.toContain("?");
    }
  });

  test("an unscoped page leaves every href bare", () => {
    act(() => {
      writeTelemetryViewerUrlState({});
    });

    renderTabs("events");

    for (const href of hrefs()) {
      expect(href).not.toContain("?");
    }
  });
});
