/** @timezone UTC */

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import "@testing-library/jest-dom";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import SecurityEvent from "../../../Models/AnalyticsModels/SecurityEvent";
import OcsfSeverity from "../../../Types/SecurityEvent/OcsfSeverity";
import Navigation from "../../../UI/Utils/Navigation";
import getJestMockFunction, { MockFunction } from "../../MockType";
import SecurityEventDetailPanel, {
  SECURITY_EVENT_DETAIL_ATTRIBUTES_TAB_ID,
  SECURITY_EVENT_DETAIL_JSON_TAB_ID,
  SECURITY_EVENT_DETAIL_OVERVIEW_TAB_ID,
  SECURITY_EVENT_DETAIL_PANEL_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityEventDetailPanel";
import { SECURITY_EVENT_ATTRIBUTE_FACET_PREFIX } from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/SecurityEventsFacets";

/*
 * One security event, opened from the list.
 *
 * Built on the shared TelemetryDetailPanel — the drawer the traces and
 * exceptions explorers open — rather than a SideOver, so the list stays
 * usable behind it. What is pinned here is what the drawer is FOR: reading
 * the whole event (typed fields, every source attribute, the raw record) and
 * turning anything in it into a filter on the list behind it without
 * re-typing it into the search bar.
 */

const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";

function event(fields: Partial<SecurityEvent> = {}): SecurityEvent {
  return Object.assign(new SecurityEvent(), fields);
}

const FULL_EVENT: SecurityEvent = event({
  time: new Date("2026-09-17T10:00:00.000Z"),
  eventUid: "abc123",
  severityName: OcsfSeverity.Critical,
  className: "Authentication",
  categoryName: "IAM",
  activityName: "Logon",
  statusName: "Failure",
  message: "Failed logon for alice",
  vendorName: "Acme",
  productName: "Defender",
  ruleName: "BruteForce",
  principalUser: "alice",
  principalHost: "web-01",
  observables: ["alice", "10.0.0.4"],
  attributes: {
    "threat.matched": "true",
    "device.hostname": "web-01",
  },
});

function renderPanel(
  securityEvent: SecurityEvent = FULL_EVENT,
  props: {
    onClose?: () => void;
    onFilterBy?: (facetKey: string, value: string) => void;
    onCorrelateObservable?: (observable: string) => void;
  } = {},
): void {
  render(
    <MemoryRouter>
      <SecurityEventDetailPanel
        securityEvent={securityEvent}
        onClose={props.onClose || ((): void => {})}
        {...(props.onFilterBy ? { onFilterBy: props.onFilterBy } : {})}
        {...(props.onCorrelateObservable
          ? { onCorrelateObservable: props.onCorrelateObservable }
          : {})}
      />
    </MemoryRouter>,
  );
}

function panel(): HTMLElement {
  return screen.getByTestId(SECURITY_EVENT_DETAIL_PANEL_TEST_ID);
}

function tab(label: string): HTMLElement {
  return screen.getByRole("tab", { name: new RegExp(`^${label}`) });
}

function filterButton(label: string): HTMLElement {
  return screen.getByRole("button", { name: `Filter by ${label}` });
}

beforeEach(() => {
  window.history.replaceState(
    null,
    "",
    `/dashboard/${PROJECT_ID}/security-events`,
  );
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("the drawer", () => {
  test("names the event and when it happened", () => {
    renderPanel();

    expect(panel()).toHaveTextContent("Failed logon for alice");
    expect(panel().textContent).toContain("2026");
  });

  test("falls back to the event class when there is no message", () => {
    renderPanel(event({ className: "Authentication" }));

    expect(panel()).toHaveTextContent("Authentication");
  });

  test("offers Overview, Attributes and JSON, opening on Overview", () => {
    renderPanel();

    expect(
      screen.getAllByRole("tab").map((node: HTMLElement): string => {
        return node.getAttribute("id") || "";
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.stringContaining(SECURITY_EVENT_DETAIL_OVERVIEW_TAB_ID),
        expect.stringContaining(SECURITY_EVENT_DETAIL_ATTRIBUTES_TAB_ID),
        expect.stringContaining(SECURITY_EVENT_DETAIL_JSON_TAB_ID),
      ]),
    );
    expect(tab("Overview")).toHaveAttribute("aria-selected", "true");
  });

  test("the Attributes tab counts what it holds, so a reader knows before opening it", () => {
    renderPanel();

    expect(tab("Attributes")).toHaveTextContent("2");
  });

  test("closing it tells the page", () => {
    const onClose: MockFunction = getJestMockFunction();

    renderPanel(FULL_EVENT, { onClose: onClose as unknown as () => void });

    fireEvent.click(screen.getByRole("button", { name: /close/i }));

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("Overview", () => {
  test("shows the typed OCSF fields, severity as a pill", () => {
    renderPanel();

    expect(panel()).toHaveTextContent("Event Class");
    expect(panel()).toHaveTextContent("Authentication");
    expect(panel()).toHaveTextContent("Status");
    expect(panel()).toHaveTextContent("Failure");
    expect(panel()).toHaveTextContent(OcsfSeverity.Critical);
  });

  test("omits what the source did not say", () => {
    renderPanel(event({ className: "Authentication" }));

    expect(panel()).not.toHaveTextContent("Target Host");
    expect(panel()).not.toHaveTextContent("MITRE Tactics");
  });

  test("lists observables as chips, and says so when there are none", () => {
    renderPanel();

    expect(
      screen.getByTestId("security-event-panel-observable-chip-0"),
    ).toHaveTextContent("alice");
    expect(
      screen.getByTestId("security-event-panel-observable-chip-1"),
    ).toHaveTextContent("10.0.0.4");

    cleanup();
    renderPanel(event({ message: "no observables" }));

    expect(panel()).toHaveTextContent(
      "No observables extracted from this event.",
    );
  });
});

describe("filtering the list from the drawer", () => {
  test("severity, and every typed field the sidebar also facets, offers a filter", () => {
    const onFilterBy: MockFunction = getJestMockFunction();

    renderPanel(FULL_EVENT, {
      onFilterBy: onFilterBy as unknown as (
        facetKey: string,
        value: string,
      ) => void,
    });

    fireEvent.click(filterButton("Severity"));
    expect(onFilterBy).toHaveBeenLastCalledWith(
      "severityName",
      OcsfSeverity.Critical,
    );

    fireEvent.click(filterButton("Event Class"));
    expect(onFilterBy).toHaveBeenLastCalledWith("className", "Authentication");

    fireEvent.click(filterButton("Principal User"));
    expect(onFilterBy).toHaveBeenLastCalledWith("principalUser", "alice");

    fireEvent.click(filterButton("Detection Rule"));
    expect(onFilterBy).toHaveBeenLastCalledWith("ruleName", "BruteForce");
  });

  /*
   * Filtering on a value that is unique per row would return the one event
   * already on screen, so those fields deliberately offer no action.
   */
  test("free-text and unique fields offer none", () => {
    renderPanel(FULL_EVENT, {
      onFilterBy: getJestMockFunction() as unknown as (
        facetKey: string,
        value: string,
      ) => void,
    });

    expect(
      screen.queryByRole("button", { name: "Filter by Message" }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Filter by Event UID" }),
    ).toBeNull();
  });

  test("an attribute filters under its own attributes.<key> chip", () => {
    const onFilterBy: MockFunction = getJestMockFunction();

    renderPanel(FULL_EVENT, {
      onFilterBy: onFilterBy as unknown as (
        facetKey: string,
        value: string,
      ) => void,
    });

    fireEvent.click(tab("Attributes"));
    fireEvent.click(filterButton("threat.matched"));

    expect(onFilterBy).toHaveBeenCalledWith(
      `${SECURITY_EVENT_ATTRIBUTE_FACET_PREFIX}threat.matched`,
      "true",
    );
  });

  test("a page that cannot filter gets no filter actions at all", () => {
    renderPanel();

    expect(screen.queryByRole("button", { name: /^Filter by/ })).toBeNull();
  });
});

describe("Attributes", () => {
  test("lists every source attribute, sorted, with its value", () => {
    renderPanel();

    fireEvent.click(tab("Attributes"));

    const terms: Array<string> = Array.from(panel().querySelectorAll("dt")).map(
      (node: Element): string => {
        return node.textContent || "";
      },
    );

    expect(terms).toEqual(["device.hostname", "threat.matched"]);
    expect(panel()).toHaveTextContent("web-01");
    expect(panel()).toHaveTextContent("true");
  });

  test("an event with none says so", () => {
    renderPanel(event({ message: "bare" }));

    fireEvent.click(tab("Attributes"));

    expect(panel()).toHaveTextContent("No attributes recorded for this event.");
  });
});

describe("JSON", () => {
  test("prints the record, including what the source left empty", () => {
    renderPanel();

    fireEvent.click(tab("JSON"));

    const json: Record<string, unknown> = JSON.parse(
      screen.getByTestId("security-event-detail-json").textContent || "{}",
    );

    expect(json["message"]).toBe("Failed logon for alice");
    expect(json["severityName"]).toBe(OcsfSeverity.Critical);
    expect(json["targetHost"]).toBe("");
    expect(json["attributes"]).toEqual({
      "threat.matched": "true",
      "device.hostname": "web-01",
    });
  });

  /*
   * An analytics model carries its whole table definition on the object;
   * serializing that would bury twenty facts about the event under a few
   * hundred about the table.
   */
  test("describes the event, not the table", () => {
    renderPanel();

    fireEvent.click(tab("JSON"));

    const text: string =
      screen.getByTestId("security-event-detail-json").textContent || "";

    expect(text).not.toContain("tableColumns");
    expect(text).not.toContain("accessControl");
  });
});

describe("correlating an observable", () => {
  test("deep-links to the Correlate tab seeded with the observable", () => {
    const navigate: MockFunction = getJestMockFunction();
    jest
      .spyOn(Navigation, "navigate")
      .mockImplementation(navigate as unknown as typeof Navigation.navigate);

    renderPanel();

    fireEvent.click(
      screen.getByTestId("security-event-panel-observable-chip-1"),
    );

    expect(navigate).toHaveBeenCalledTimes(1);
    const route: string = String((navigate.mock.calls[0] as Array<unknown>)[0]);

    expect(route).toContain("/security-events/correlate");
    expect(route).toContain(`observable=${encodeURIComponent("10.0.0.4")}`);
  });

  test("a host that already shows a graph pivots in place instead", () => {
    const onCorrelateObservable: MockFunction = getJestMockFunction();
    const navigate: MockFunction = getJestMockFunction();
    jest
      .spyOn(Navigation, "navigate")
      .mockImplementation(navigate as unknown as typeof Navigation.navigate);

    renderPanel(FULL_EVENT, {
      onCorrelateObservable: onCorrelateObservable as unknown as (
        observable: string,
      ) => void,
    });

    fireEvent.click(
      screen.getByTestId("security-event-panel-observable-chip-0"),
    );

    expect(onCorrelateObservable).toHaveBeenCalledWith("alice");
    expect(navigate).not.toHaveBeenCalled();
  });
});

describe("the drawer is a modal", () => {
  test("Escape closes it", () => {
    const onClose: MockFunction = getJestMockFunction();

    renderPanel(FULL_EVENT, { onClose: onClose as unknown as () => void });

    fireEvent.keyDown(document, { key: "Escape" });

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  test("its tabs are a real tablist", () => {
    renderPanel();

    const tablist: HTMLElement = screen.getByRole("tablist");

    expect(within(tablist).getAllByRole("tab")).toHaveLength(3);
  });
});
