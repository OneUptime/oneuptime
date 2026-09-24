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
  waitFor,
  within,
} from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import SecurityEvent from "../../../Models/AnalyticsModels/SecurityEvent";
import OcsfSeverity from "../../../Types/SecurityEvent/OcsfSeverity";
import Navigation from "../../../UI/Utils/Navigation";
import Clipboard from "../../../UI/Utils/Clipboard";
import getJestMockFunction, { MockFunction } from "../../MockType";
import SecurityEventDetailPanel, {
  SECURITY_EVENT_DETAIL_ATTRIBUTES_TAB_ID,
  SECURITY_EVENT_DETAIL_JSON_TAB_ID,
  SECURITY_EVENT_DETAIL_JSON_TEST_ID,
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
    attributeColumnKeys?: Array<string>;
    onToggleAttributeColumn?: (attributeKey: string) => void;
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
        {...(props.attributeColumnKeys
          ? { attributeColumnKeys: props.attributeColumnKeys }
          : {})}
        {...(props.onToggleAttributeColumn
          ? { onToggleAttributeColumn: props.onToggleAttributeColumn }
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

/*
 * A Google SecOps detection carries hundreds of attributes, many of them
 * long keys holding long values (escaped JSON labels, base64 tokens). Printed
 * unwrapped, those lines ran off the drawer's edge and the only horizontal
 * scrollbar sat below hundreds of lines — the reader could not see the end
 * of a value at all. And the only way to get the record into a ticket was to
 * drag-select the whole thing.
 */
describe("reading and copying the JSON", () => {
  const LONG_VALUE: string = `{"key":"identity_risk","value":"${"x".repeat(400)}"}`;

  const DETECTION: SecurityEvent = event({
    message: "Mass_Password_Reset_Modification",
    attributes: {
      "collectionElements.0.references.0.event.target.user.attribute.labels.9":
        LONG_VALUE,
      "collectionElements.0.references.0.event.target.user.firstName": "jdoe",
    },
  });

  function json(): HTMLElement {
    return screen.getByTestId(SECURITY_EVENT_DETAIL_JSON_TEST_ID);
  }

  function wrapToggle(): HTMLElement {
    return screen.getByRole("button", { name: /Wrap lines/ });
  }

  test("the Wrap and Copy controls stay in reach however far the record is scrolled", () => {
    renderPanel(DETECTION);
    fireEvent.click(tab("JSON"));

    const toolbar: HTMLElement = screen.getByRole("button", {
      name: /Copy JSON/,
    }).parentElement as HTMLElement;

    expect(toolbar).toHaveClass("sticky");
    expect(toolbar).toContainElement(wrapToggle());
  });

  test("long lines wrap to fit the drawer by default", () => {
    renderPanel(DETECTION);
    fireEvent.click(tab("JSON"));

    expect(json()).toHaveClass("whitespace-pre-wrap");
    expect(json()).toHaveClass("break-words");
    expect(json()).not.toHaveClass("whitespace-pre");
    expect(wrapToggle()).toHaveAttribute("aria-pressed", "true");
  });

  test("wrapping can be switched off for a reader who would rather scroll sideways", () => {
    renderPanel(DETECTION);
    fireEvent.click(tab("JSON"));

    fireEvent.click(wrapToggle());

    expect(json()).toHaveClass("whitespace-pre");
    expect(json()).not.toHaveClass("whitespace-pre-wrap");
    /*
     * Scrolling within itself, height-capped, so its sideways scrollbar is on
     * screen rather than below hundreds of lines.
     */
    expect(json()).toHaveClass("overflow-auto");
    expect(json()).toHaveClass("max-h-[70vh]");
    expect(wrapToggle()).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(wrapToggle());

    expect(json()).toHaveClass("whitespace-pre-wrap");
  });

  test("wrapping changes how it looks, never what it says", () => {
    renderPanel(DETECTION);
    fireEvent.click(tab("JSON"));

    const wrapped: string = json().textContent || "";

    fireEvent.click(wrapToggle());

    expect(json().textContent).toBe(wrapped);
    expect(wrapped).toContain("x".repeat(400));
  });

  test("Copy JSON puts the whole record on the clipboard, exactly as shown", async () => {
    const copy: MockFunction = getJestMockFunction();
    copy.mockResolvedValue(true as never);
    jest
      .spyOn(Clipboard, "copyToClipboard")
      .mockImplementation(copy as unknown as typeof Clipboard.copyToClipboard);

    renderPanel(DETECTION);
    fireEvent.click(tab("JSON"));

    fireEvent.click(screen.getByRole("button", { name: /Copy JSON/ }));

    await waitFor(() => {
      expect(copy).toHaveBeenCalledTimes(1);
    });

    const copied: string = (copy.mock.calls[0] as Array<unknown>)[0] as string;

    expect(copied).toBe(json().textContent);

    const parsed: Record<string, unknown> = JSON.parse(copied);
    expect(parsed["message"]).toBe("Mass_Password_Reset_Modification");
    expect(
      (parsed["attributes"] as Record<string, string>)[
        "collectionElements.0.references.0.event.target.user.attribute.labels.9"
      ],
    ).toBe(LONG_VALUE);
  });

  test("says so once it has copied", async () => {
    jest.spyOn(Clipboard, "copyToClipboard").mockResolvedValue(true as never);

    renderPanel(DETECTION);
    fireEvent.click(tab("JSON"));

    fireEvent.click(screen.getByRole("button", { name: /Copy JSON/ }));

    expect(await screen.findByText("Copied!")).toBeInTheDocument();
  });

  test("does not claim to have copied when the browser refused", async () => {
    const copy: MockFunction = getJestMockFunction();
    copy.mockResolvedValue(false as never);
    jest
      .spyOn(Clipboard, "copyToClipboard")
      .mockImplementation(copy as unknown as typeof Clipboard.copyToClipboard);

    renderPanel(DETECTION);
    fireEvent.click(tab("JSON"));

    fireEvent.click(screen.getByRole("button", { name: /Copy JSON/ }));

    await waitFor(() => {
      expect(copy).toHaveBeenCalledTimes(1);
    });

    expect(screen.queryByText("Copied!")).toBeNull();
  });

  test("copying reads the event the drawer is showing now, not the first one it opened on", async () => {
    const copy: MockFunction = getJestMockFunction();
    copy.mockResolvedValue(true as never);
    jest
      .spyOn(Clipboard, "copyToClipboard")
      .mockImplementation(copy as unknown as typeof Clipboard.copyToClipboard);

    const { rerender } = render(
      <MemoryRouter>
        <SecurityEventDetailPanel
          securityEvent={event({ message: "first" })}
          onClose={(): void => {}}
        />
      </MemoryRouter>,
    );

    rerender(
      <MemoryRouter>
        <SecurityEventDetailPanel
          securityEvent={event({ message: "second" })}
          onClose={(): void => {}}
        />
      </MemoryRouter>,
    );

    fireEvent.click(tab("JSON"));
    fireEvent.click(screen.getByRole("button", { name: /Copy JSON/ }));

    await waitFor(() => {
      expect(copy).toHaveBeenCalledTimes(1);
    });

    expect(
      JSON.parse((copy.mock.calls[0] as Array<unknown>)[0] as string)[
        "message"
      ],
    ).toBe("second");
  });
});

/*
 * The reader who finds the attribute they care about in this tab should be
 * able to put it on every row from right here, rather than go find the same
 * key again among thousands in the toolbar's picker.
 */
describe("showing an attribute on the list's rows", () => {
  const FIRST_NAME_KEY: string =
    "collectionElements.0.references.0.event.target.user.firstName";

  const DETECTION: SecurityEvent = event({
    message: "Mass_Password_Reset_Modification",
    attributes: {
      [FIRST_NAME_KEY]: "jdoe",
      "device.hostname": "web-01",
    },
  });

  function columnButton(key: string): HTMLElement {
    return screen.getByRole("button", {
      name: new RegExp(
        `(Show|Stop showing) ${key.replace(/\./g, "\\.")} on event rows`,
      ),
    });
  }

  test("each attribute offers it, and says which ones are already shown", () => {
    renderPanel(DETECTION, {
      attributeColumnKeys: [FIRST_NAME_KEY],
      onToggleAttributeColumn: (): void => {},
    });

    fireEvent.click(tab("Attributes"));

    expect(columnButton(FIRST_NAME_KEY)).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(columnButton(FIRST_NAME_KEY)).toHaveAccessibleName(
      `Stop showing ${FIRST_NAME_KEY} on event rows`,
    );
    expect(columnButton("device.hostname")).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(columnButton("device.hostname")).toHaveAccessibleName(
      "Show device.hostname on event rows",
    );
  });

  test("clicking it hands the page the attribute's key", () => {
    const onToggle: MockFunction = getJestMockFunction();

    renderPanel(DETECTION, {
      attributeColumnKeys: [],
      onToggleAttributeColumn: onToggle as unknown as (key: string) => void,
    });

    fireEvent.click(tab("Attributes"));
    fireEvent.click(columnButton(FIRST_NAME_KEY));

    expect(onToggle).toHaveBeenCalledWith(FIRST_NAME_KEY);

    fireEvent.click(columnButton("device.hostname"));

    expect(onToggle).toHaveBeenLastCalledWith("device.hostname");
  });

  test("sits beside the attribute's filter action, not in place of it", () => {
    const onFilterBy: MockFunction = getJestMockFunction();
    const onToggle: MockFunction = getJestMockFunction();

    renderPanel(DETECTION, {
      onFilterBy: onFilterBy as unknown as (
        facetKey: string,
        value: string,
      ) => void,
      onToggleAttributeColumn: onToggle as unknown as (key: string) => void,
    });

    fireEvent.click(tab("Attributes"));
    fireEvent.click(filterButton(FIRST_NAME_KEY));

    expect(onFilterBy).toHaveBeenCalledWith(
      `${SECURITY_EVENT_ATTRIBUTE_FACET_PREFIX}${FIRST_NAME_KEY}`,
      "jdoe",
    );
    expect(onToggle).not.toHaveBeenCalled();
  });

  test("a page with no rows to add to gets no such action", () => {
    renderPanel(DETECTION);

    fireEvent.click(tab("Attributes"));

    expect(screen.queryByRole("button", { name: /on event rows/ })).toBeNull();
  });

  test("only the Attributes tab offers it — the typed fields already have their chips", () => {
    renderPanel(DETECTION, {
      onToggleAttributeColumn: (): void => {},
    });

    expect(tab("Overview")).toHaveAttribute("aria-selected", "true");

    expect(screen.queryByRole("button", { name: /on event rows/ })).toBeNull();
  });
});
