import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  RenderResult,
  screen,
  within,
} from "@testing-library/react";
import fs from "fs";
import { createInstance, i18n } from "i18next";
import path from "path";
import React, { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { I18nextProvider } from "react-i18next";
import {
  afterEach,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import getJestMockFunction, { MockFunction } from "../../MockType";
import SecurityEvent from "../../../Models/AnalyticsModels/SecurityEvent";
import { Orange, Red, Yellow } from "../../../Types/BrandColors";
import OneUptimeDate from "../../../Types/Date";
import ObjectID from "../../../Types/ObjectID";
import OcsfSeverity from "../../../Types/SecurityEvent/OcsfSeverity";
import {
  CorrelateClassEventsPanel,
  CorrelateClassEventsPanelProps,
  CorrelateObservableClass,
  CorrelateObservablePivotPanel,
  CorrelateObservablePivotPanelProps,
  CorrelateOverview,
  CorrelateOverviewProps,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/CorrelateInspector";
import { CorrelationGraphNode } from "../../../../App/FeatureSet/Dashboard/src/Utils/CorrelationGraph";

/*
 * The inspector beside the correlation graph: the overview list (the
 * keyboard path into the graph), the class drill-down and the observable
 * pivots. All three are presentational, so these tests drive them through
 * props and pin what CorrelateGraph and its own tests rely on — test ids,
 * the single "matching event" line, the observable value being the own text
 * of exactly one element, callbacks receiving ids/events — plus the dark
 * theme promise: only remapped colour classes and tokenised inline colours.
 */

const english: i18n = createInstance();
const german: i18n = createInstance();

beforeAll(async () => {
  await english.init({
    lng: "en",
    fallbackLng: "en",
    resources: { en: { translation: {} } },
    interpolation: { escapeValue: false },
  });
  await german.init({
    lng: "de",
    fallbackLng: "de",
    resources: {
      de: {
        translation: {
          "Event classes": "Ereignisklassen",
          "No severity": "Kein Schweregrad",
          "less frequent observables not shown":
            "seltenere Observables nicht angezeigt",
          "matching event": "passendes Ereignis",
          "matching events": "passende Ereignisse",
          Close: "Schließen",
          "Filter to this class": "Auf diese Klasse filtern",
          "Clear selection": "Auswahl aufheben",
          "Copy value": "Wert kopieren",
          "Add to filter": "Zum Filter hinzufügen",
          "Seen in": "Gesehen in",
        },
      },
    },
    interpolation: { escapeValue: false },
  });
});

afterEach(() => {
  cleanup();
});

type WithI18nFunction = (ui: ReactElement, instance?: i18n) => ReactElement;

const withI18n: WithI18nFunction = (
  ui: ReactElement,
  instance?: i18n,
): ReactElement => {
  return <I18nextProvider i18n={instance || english}>{ui}</I18nextProvider>;
};

type RenderWithI18nFunction = (
  ui: ReactElement,
  instance?: i18n,
) => RenderResult;

const renderWithI18n: RenderWithI18nFunction = (
  ui: ReactElement,
  instance?: i18n,
): RenderResult => {
  return render(withI18n(ui, instance));
};

interface ConsoleSpy {
  mock: { calls: Array<Array<unknown>> };
  mockRestore: () => void;
}

type WriteTextMock = ReturnType<
  typeof jest.fn<(text: string) => Promise<void>>
>;

// jsdom normalises hex colours to rgb() in inline styles.
function hexToRgb(hex: string): string {
  const value: string = hex.replace("#", "");
  const red: number = parseInt(value.substring(0, 2), 16);
  const green: number = parseInt(value.substring(2, 4), 16);
  const blue: number = parseInt(value.substring(4, 6), 16);
  return `rgb(${red}, ${green}, ${blue})`;
}

function classNode(
  name: string,
  count: number,
  worstSeverity?: OcsfSeverity,
): CorrelationGraphNode {
  return {
    id: `class:${name}`,
    label: name,
    kind: "class",
    count: count,
    worstSeverity: worstSeverity,
  };
}

function observableNode(value: string, count: number): CorrelationGraphNode {
  return {
    id: `observable:${value}`,
    label: value,
    kind: "observable",
    count: count,
  };
}

interface EventInput {
  id?: string;
  severityName?: OcsfSeverity;
  message?: string;
  principalUser?: string;
  principalHost?: string;
  time?: Date;
}

function buildEvent(input: EventInput): SecurityEvent {
  const event: SecurityEvent = new SecurityEvent();
  if (input.id) {
    event._id = new ObjectID(input.id);
  }
  if (input.time) {
    event.time = input.time;
  }
  if (input.severityName) {
    event.severityName = input.severityName;
  }
  if (input.message) {
    event.message = input.message;
  }
  if (input.principalUser) {
    event.principalUser = input.principalUser;
  }
  if (input.principalHost) {
    event.principalHost = input.principalHost;
  }
  return event;
}

function buildEvents(count: number): Array<SecurityEvent> {
  const events: Array<SecurityEvent> = [];
  for (let index: number = 0; index < count; index++) {
    events.push(
      buildEvent({
        severityName: OcsfSeverity.Low,
        message: `event message ${index}`,
        time: new Date("2026-08-25T10:00:00.000Z"),
      }),
    );
  }
  return events;
}

/* ---------- CorrelateOverview ---------- */

interface OverviewHarness {
  props: CorrelateOverviewProps;
  onSelectNode: MockFunction;
}

function overviewProps(
  overrides?: Partial<CorrelateOverviewProps>,
): OverviewHarness {
  const onSelectNode: MockFunction = getJestMockFunction();
  const props: CorrelateOverviewProps = {
    // Deliberately not alphabetical and not by count: order is the caller's.
    classes: [
      classNode("Process Activity", 4, OcsfSeverity.Critical),
      classNode("Authentication", 8, OcsfSeverity.High),
      classNode("Network Activity", 2),
    ],
    observables: [
      observableNode("wb-ubuntu-03", 6),
      observableNode("10.0.0.7", 3),
    ],
    droppedObservableCount: 0,
    countsAreLowerBounds: false,
    isStale: false,
    onSelectNode: onSelectNode,
    ...(overrides || {}),
  };
  return { props, onSelectNode };
}

describe("CorrelateOverview", () => {
  test("renders class and observable rows in the order they are passed", () => {
    const { props } = overviewProps();
    renderWithI18n(<CorrelateOverview {...props} />);

    expect(screen.getByTestId("correlate-overview-class-0")).toHaveTextContent(
      "Process Activity",
    );
    expect(screen.getByTestId("correlate-overview-class-1")).toHaveTextContent(
      "Authentication",
    );
    expect(screen.getByTestId("correlate-overview-class-2")).toHaveTextContent(
      "Network Activity",
    );
    expect(screen.queryByTestId("correlate-overview-class-3")).toBeNull();

    expect(
      screen.getByTestId("correlate-overview-observable-0"),
    ).toHaveTextContent("wb-ubuntu-03");
    expect(
      screen.getByTestId("correlate-overview-observable-1"),
    ).toHaveTextContent("10.0.0.7");
    expect(screen.queryByTestId("correlate-overview-observable-2")).toBeNull();
  });

  test("clicking a row reports that node's id", () => {
    const { props, onSelectNode } = overviewProps();
    renderWithI18n(<CorrelateOverview {...props} />);

    fireEvent.click(screen.getByTestId("correlate-overview-class-1"));
    expect(onSelectNode).toHaveBeenLastCalledWith("class:Authentication");

    fireEvent.click(screen.getByTestId("correlate-overview-observable-1"));
    expect(onSelectNode).toHaveBeenLastCalledWith("observable:10.0.0.7");

    fireEvent.click(screen.getByTestId("correlate-overview-class-0"));
    expect(onSelectNode).toHaveBeenLastCalledWith("class:Process Activity");
    expect(onSelectNode).toHaveBeenCalledTimes(3);
  });

  test("rows are real buttons inside labelled lists", () => {
    const { props } = overviewProps();
    renderWithI18n(<CorrelateOverview {...props} />);

    const overview: HTMLElement = screen.getByTestId("correlate-overview");
    const row: HTMLElement = screen.getByTestId("correlate-overview-class-0");
    expect(row.tagName).toBe("BUTTON");
    expect(row).toHaveAttribute("type", "button");
    expect(row).toBeEnabled();

    expect(within(overview).getAllByRole("list")).toHaveLength(2);
    const headings: Array<HTMLElement> = within(overview).getAllByRole(
      "heading",
      { level: 3 },
    );
    expect(
      headings.map((heading: HTMLElement): string => {
        return heading.textContent || "";
      }),
    ).toEqual(["Event classes", "Co-occurring observables"]);

    // Each list is named by its heading and holds only its own rows.
    const classList: HTMLElement = within(overview).getByRole("list", {
      name: "Event classes",
    });
    expect(within(classList).getAllByRole("listitem")).toHaveLength(3);
    expect(
      within(classList).getByTestId("correlate-overview-class-2"),
    ).toBeInTheDocument();
    expect(
      within(classList).queryByTestId("correlate-overview-observable-0"),
    ).toBeNull();

    const observableList: HTMLElement = within(overview).getByRole("list", {
      name: "Co-occurring observables",
    });
    expect(within(observableList).getAllByRole("listitem")).toHaveLength(2);
    expect(
      within(observableList).getByTestId("correlate-overview-observable-1"),
    ).toBeInTheDocument();

    // The two sections get distinct heading ids.
    expect(headings[0]?.id).toBeTruthy();
    expect(headings[0]?.id).not.toBe(headings[1]?.id);

    // Every row is reachable by its visible name.
    expect(
      within(overview).getByRole("button", { name: /Authentication/ }),
    ).toBe(screen.getByTestId("correlate-overview-class-1"));
    expect(within(overview).getByRole("button", { name: /10\.0\.0\.7/ })).toBe(
      screen.getByTestId("correlate-overview-observable-1"),
    );
  });

  test("the class name is the own text of a single span", () => {
    const { props } = overviewProps();
    renderWithI18n(<CorrelateOverview {...props} />);

    const name: HTMLElement = within(
      screen.getByTestId("correlate-overview-class-1"),
    ).getByText("Authentication");
    expect(name.tagName).toBe("SPAN");
    expect(name).toHaveAttribute("title", "Authentication");
    expect(name.textContent).toBe("Authentication");
  });

  test("shows the severity word and a matching severity dot", () => {
    const { props } = overviewProps();
    renderWithI18n(<CorrelateOverview {...props} />);

    const critical: HTMLElement = screen.getByTestId(
      "correlate-overview-class-0",
    );
    expect(within(critical).getByText("Critical")).toBeInTheDocument();
    expect(
      screen.getByTestId("correlate-overview-class-dot-0").style.background,
    ).toBe(hexToRgb(Red.toString()));
    expect(
      screen.getByTestId("correlate-overview-class-bar-0").style.background,
    ).toBe(hexToRgb(Red.toString()));

    const high: HTMLElement = screen.getByTestId("correlate-overview-class-1");
    expect(within(high).getByText("High")).toBeInTheDocument();
    expect(
      screen.getByTestId("correlate-overview-class-dot-1").style.background,
    ).toBe(hexToRgb(Orange.toString()));
  });

  test("a class without a severity says so in words", () => {
    const { props } = overviewProps();
    renderWithI18n(<CorrelateOverview {...props} />);

    const none: HTMLElement = screen.getByTestId("correlate-overview-class-2");
    expect(within(none).getByText("No severity")).toBeInTheDocument();
    // The colour cue is never the only cue: the other rows have no such word.
    expect(screen.getAllByText("No severity")).toHaveLength(1);
  });

  test("counts carry a + only when they are lower bounds", () => {
    const exact: OverviewHarness = overviewProps();
    const { unmount } = renderWithI18n(<CorrelateOverview {...exact.props} />);
    expect(
      within(screen.getByTestId("correlate-overview-class-1")).getByText("8"),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId("correlate-overview-observable-0")).getByText(
        "6",
      ),
    ).toBeInTheDocument();
    expect(screen.getByTestId("correlate-overview").textContent).not.toContain(
      "+",
    );
    unmount();

    const capped: OverviewHarness = overviewProps({
      countsAreLowerBounds: true,
    });
    renderWithI18n(<CorrelateOverview {...capped.props} />);
    expect(
      within(screen.getByTestId("correlate-overview-class-1")).getByText("8+"),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId("correlate-overview-class-2")).getByText("2+"),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId("correlate-overview-observable-0")).getByText(
        "6+",
      ),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId("correlate-overview-observable-1")).getByText(
        "3+",
      ),
    ).toBeInTheDocument();
  });

  test("bars are relative to the largest count in each list", () => {
    const { props } = overviewProps();
    renderWithI18n(<CorrelateOverview {...props} />);

    // Classes: 4, 8, 2 against a max of 8.
    expect(
      screen.getByTestId("correlate-overview-class-bar-0").style.width,
    ).toBe("50%");
    expect(
      screen.getByTestId("correlate-overview-class-bar-1").style.width,
    ).toBe("100%");
    expect(
      screen.getByTestId("correlate-overview-class-bar-2").style.width,
    ).toBe("25%");

    // Observables: 6, 3 against their own max of 6.
    expect(
      screen.getByTestId("correlate-overview-observable-bar-0").style.width,
    ).toBe("100%");
    expect(
      screen.getByTestId("correlate-overview-observable-bar-1").style.width,
    ).toBe("50%");
  });

  test("a tiny count keeps a visible sliver and a zero count has no bar", () => {
    const { props } = overviewProps({
      classes: [
        classNode("Busy", 400, OcsfSeverity.Medium),
        classNode("Quiet", 1, OcsfSeverity.Low),
        classNode("Empty", 0),
      ],
    });
    renderWithI18n(<CorrelateOverview {...props} />);

    expect(
      screen.getByTestId("correlate-overview-class-bar-0").style.width,
    ).toBe("100%");
    expect(
      screen.getByTestId("correlate-overview-class-bar-1").style.width,
    ).toBe("2%");
    expect(
      screen.getByTestId("correlate-overview-class-bar-2").style.width,
    ).toBe("0%");
    expect(
      screen.getByTestId("correlate-overview-class-bar-0").style.background,
    ).toBe(hexToRgb(Yellow.toString()));
  });

  test("a node without a count reads 0 and has no bar", () => {
    const { props } = overviewProps({
      classes: [
        { id: "class:Legacy", label: "Legacy", kind: "class" },
        classNode("Authentication", 3, OcsfSeverity.High),
      ],
      observables: [
        { id: "observable:10.0.0.9", label: "10.0.0.9", kind: "observable" },
      ],
    });
    renderWithI18n(<CorrelateOverview {...props} />);

    const legacy: HTMLElement = screen.getByTestId(
      "correlate-overview-class-0",
    );
    expect(within(legacy).getByText("0")).toBeInTheDocument();
    expect(within(legacy).getByText("No severity")).toBeInTheDocument();
    expect(
      screen.getByTestId("correlate-overview-class-bar-0").style.width,
    ).toBe("0%");
    expect(
      screen.getByTestId("correlate-overview-class-bar-1").style.width,
    ).toBe("100%");

    // A list whose only count is missing has no maximum to scale against.
    expect(
      within(screen.getByTestId("correlate-overview-observable-0")).getByText(
        "0",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("correlate-overview-observable-bar-0").style.width,
    ).toBe("0%");
  });

  test("an empty class list still renders the section and the hint", () => {
    const { props } = overviewProps({ classes: [], observables: [] });
    renderWithI18n(<CorrelateOverview {...props} />);

    expect(screen.getByText("Event classes")).toBeInTheDocument();
    expect(screen.queryByTestId("correlate-overview-class-0")).toBeNull();
    expect(
      within(
        screen.getByRole("list", { name: "Event classes" }),
      ).queryAllByRole("listitem"),
    ).toHaveLength(0);
    expect(
      screen.getByText("Select a node or a row to see its details."),
    ).toBeInTheDocument();
  });

  test("the bars are decorative and hidden from assistive technology", () => {
    const { props } = overviewProps();
    renderWithI18n(<CorrelateOverview {...props} />);

    const bar: HTMLElement = screen.getByTestId(
      "correlate-overview-class-bar-0",
    );
    expect(bar.parentElement).toHaveAttribute("aria-hidden", "true");
    expect(
      screen.getByTestId("correlate-overview-class-dot-0"),
    ).toHaveAttribute("aria-hidden", "true");
  });

  test("while stale the rows are disabled and the list is dimmed", () => {
    const { props, onSelectNode } = overviewProps({ isStale: true });
    renderWithI18n(<CorrelateOverview {...props} />);

    const overview: HTMLElement = screen.getByTestId("correlate-overview");
    expect(overview).toHaveClass("opacity-60");

    const rows: Array<HTMLElement> = [
      screen.getByTestId("correlate-overview-class-0"),
      screen.getByTestId("correlate-overview-class-1"),
      screen.getByTestId("correlate-overview-class-2"),
      screen.getByTestId("correlate-overview-observable-0"),
      screen.getByTestId("correlate-overview-observable-1"),
    ];
    for (const row of rows) {
      expect(row).toBeDisabled();
      // No hover highlight on a row that cannot be used.
      expect(row).not.toHaveClass("hover:bg-gray-50");
      fireEvent.click(row);
    }
    expect(onSelectNode).not.toHaveBeenCalled();
  });

  test("when fresh the rows are enabled and not dimmed", () => {
    const { props } = overviewProps({ isStale: false });
    renderWithI18n(<CorrelateOverview {...props} />);

    expect(screen.getByTestId("correlate-overview")).not.toHaveClass(
      "opacity-60",
    );
    expect(screen.getByTestId("correlate-overview-class-0")).toBeEnabled();
    expect(screen.getByTestId("correlate-overview-class-0")).toHaveClass(
      "hover:bg-gray-50",
    );
    expect(screen.getByTestId("correlate-overview-observable-0")).toBeEnabled();
  });

  test("notes how many less frequent observables were left out", () => {
    const { props } = overviewProps({ droppedObservableCount: 7 });
    renderWithI18n(<CorrelateOverview {...props} />);

    const note: HTMLElement = screen.getByTestId("correlate-overview-dropped");
    expect(note).toHaveTextContent("7 less frequent observables not shown");
    expect(
      within(screen.getByTestId("correlate-overview")).getAllByText(
        /less frequent/,
      ),
    ).toHaveLength(1);
  });

  test("has no dropped note when nothing was left out", () => {
    const { props } = overviewProps({ droppedObservableCount: 0 });
    renderWithI18n(<CorrelateOverview {...props} />);

    expect(screen.queryByTestId("correlate-overview-dropped")).toBeNull();
    expect(screen.queryByText(/less frequent/)).toBeNull();
  });

  test("says so when there are no co-occurring observables", () => {
    const { props } = overviewProps({ observables: [] });
    renderWithI18n(<CorrelateOverview {...props} />);

    expect(
      screen.getByText("No co-occurring observables in these events."),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("correlate-overview-observable-0")).toBeNull();
    // The classes list is still there, and only one list is rendered.
    expect(
      screen.getByTestId("correlate-overview-class-0"),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId("correlate-overview")).getAllByRole("list"),
    ).toHaveLength(1);
  });

  test("the empty sentence is absent when observables exist", () => {
    const { props } = overviewProps();
    renderWithI18n(<CorrelateOverview {...props} />);

    expect(
      screen.queryByText("No co-occurring observables in these events."),
    ).toBeNull();
  });

  test("the dropped note still shows when every observable was dropped", () => {
    const { props } = overviewProps({
      observables: [],
      droppedObservableCount: 3,
    });
    renderWithI18n(<CorrelateOverview {...props} />);

    expect(screen.getByTestId("correlate-overview-dropped")).toHaveTextContent(
      "3 less frequent observables not shown",
    );
  });

  test("ends with a hint on how to open details", () => {
    const { props } = overviewProps();
    renderWithI18n(<CorrelateOverview {...props} />);

    expect(
      screen.getByText("Select a node or a row to see its details."),
    ).toBeInTheDocument();
  });

  test("never mentions matching events or lower bounds", () => {
    const { props } = overviewProps({
      countsAreLowerBounds: true,
      droppedObservableCount: 4,
    });
    renderWithI18n(<CorrelateOverview {...props} />);

    const text: string =
      screen.getByTestId("correlate-overview").textContent || "";
    expect(text).not.toMatch(/matching event/);
    expect(text).not.toMatch(/lower bounds/);
  });

  test("translates its copy", () => {
    const { props } = overviewProps({ droppedObservableCount: 2 });
    renderWithI18n(<CorrelateOverview {...props} />, german);

    expect(screen.getByText("Ereignisklassen")).toBeInTheDocument();
    expect(screen.getByText("Kein Schweregrad")).toBeInTheDocument();
    expect(screen.getByTestId("correlate-overview-dropped")).toHaveTextContent(
      "2 seltenere Observables nicht angezeigt",
    );
    // OCSF severity words stay as the pills show them.
    expect(screen.getByText("Critical")).toBeInTheDocument();
  });
});

/* ---------- CorrelateClassEventsPanel ---------- */

interface ClassPanelHarness {
  props: CorrelateClassEventsPanelProps;
  onFilterToClass: MockFunction;
  onClose: MockFunction;
  onOpenEvent: MockFunction;
}

const EVENT_TIME: Date = new Date("2026-08-25T10:00:00.000Z");

function classPanelProps(
  overrides?: Partial<CorrelateClassEventsPanelProps>,
): ClassPanelHarness {
  const onFilterToClass: MockFunction = getJestMockFunction();
  const onClose: MockFunction = getJestMockFunction();
  const onOpenEvent: MockFunction = getJestMockFunction();
  const props: CorrelateClassEventsPanelProps = {
    className: "Authentication",
    events: [
      buildEvent({
        id: "88888888-8888-4888-8888-888888888888",
        severityName: OcsfSeverity.High,
        message: "failed password for alice",
        principalUser: "alice",
        principalHost: "wb-ubuntu-03",
        time: EVENT_TIME,
      }),
    ],
    worstSeverity: OcsfSeverity.High,
    countIsLowerBound: false,
    canFilterToClass: true,
    showOrModeNote: false,
    rowLimit: 50,
    onFilterToClass: onFilterToClass,
    onClose: onClose,
    onOpenEvent: onOpenEvent,
    ...(overrides || {}),
  };
  return { props, onFilterToClass, onClose, onOpenEvent };
}

describe("CorrelateClassEventsPanel", () => {
  /*
   * React reports a missing key only once per component, so this has to be
   * the first render of id-less rows in the file or it cannot fail.
   */
  test("rows without an id still render with stable keys", () => {
    const consoleError: ConsoleSpy = jest
      .spyOn(console, "error")
      .mockImplementation((): void => {}) as unknown as ConsoleSpy;
    try {
      const { props } = classPanelProps({ events: buildEvents(3) });
      renderWithI18n(<CorrelateClassEventsPanel {...props} />);
      expect(
        screen.getByTestId("correlate-drilldown-event-2"),
      ).toBeInTheDocument();
      const keyWarnings: Array<unknown> = consoleError.mock.calls.filter(
        (call: Array<unknown>): boolean => {
          return String(call[0]).includes('unique "key"');
        },
      );
      expect(keyWarnings).toHaveLength(0);
    } finally {
      consoleError.mockRestore();
    }
  });

  test("names the class in a heading under an eyebrow", () => {
    const { props } = classPanelProps();
    renderWithI18n(<CorrelateClassEventsPanel {...props} />);

    const panel: HTMLElement = screen.getByTestId("correlate-drilldown");
    const heading: HTMLElement = within(panel).getByRole("heading", {
      level: 4,
    });
    expect(heading).toHaveTextContent("Authentication");
    expect(heading).toHaveAttribute("title", "Authentication");
    expect(within(panel).getByText("Event class")).toBeInTheDocument();

    // The event list is announced under the class name.
    const list: HTMLElement = within(panel).getByRole("list", {
      name: "Authentication",
    });
    expect(within(list).getAllByRole("listitem")).toHaveLength(1);
    expect(
      within(list).getByTestId("correlate-drilldown-event-0"),
    ).toBeInTheDocument();
  });

  test("shows a single matching event line for one event", () => {
    const { props } = classPanelProps();
    renderWithI18n(<CorrelateClassEventsPanel {...props} />);

    const panel: HTMLElement = screen.getByTestId("correlate-drilldown");
    expect(within(panel).getAllByText(/1 matching event/)).toHaveLength(1);
    const meta: HTMLElement = within(panel).getByText(/1 matching event/);
    expect(meta).toBe(screen.getByTestId("correlate-drilldown-count"));
    // No trailing period and no em dash.
    expect(meta.textContent).toBe("1 matching event");
    expect(within(panel).queryByText(/matching events/)).toBeNull();
  });

  test("uses the plural for several events", () => {
    const { props } = classPanelProps({ events: buildEvents(3) });
    renderWithI18n(<CorrelateClassEventsPanel {...props} />);

    expect(screen.getByTestId("correlate-drilldown-count").textContent).toBe(
      "3 matching events",
    );
  });

  test("uses the plural for zero events and renders no rows", () => {
    const { props } = classPanelProps({ events: [] });
    renderWithI18n(<CorrelateClassEventsPanel {...props} />);

    expect(screen.getByTestId("correlate-drilldown-count").textContent).toBe(
      "0 matching events",
    );
    expect(screen.queryByTestId("correlate-drilldown-event-0")).toBeNull();
    expect(screen.queryByTestId("correlate-drilldown-cap")).toBeNull();
  });

  test("marks a capped count with +", () => {
    const { props } = classPanelProps({
      events: buildEvents(2),
      countIsLowerBound: true,
    });
    renderWithI18n(<CorrelateClassEventsPanel {...props} />);

    expect(screen.getByTestId("correlate-drilldown-count").textContent).toBe(
      "2+ matching events",
    );
  });

  test("shows the worst severity as a pill, or says there is none", () => {
    const withSeverity: ClassPanelHarness = classPanelProps({
      events: [],
      worstSeverity: OcsfSeverity.Critical,
    });
    const { unmount } = renderWithI18n(
      <CorrelateClassEventsPanel {...withSeverity.props} />,
    );
    const pill: HTMLElement = screen.getByTestId("pill");
    expect(pill).toHaveTextContent("Critical");
    // PillSize.Small.
    expect(pill.style.fontSize).toBe("10px");
    expect(screen.queryByText("No severity")).toBeNull();
    unmount();

    const withoutSeverity: ClassPanelHarness = classPanelProps({
      events: [],
      worstSeverity: undefined,
    });
    renderWithI18n(<CorrelateClassEventsPanel {...withoutSeverity.props} />);
    expect(screen.queryByTestId("pill")).toBeNull();
    expect(screen.getByText("No severity")).toBeInTheDocument();
  });

  test("clicking a row opens exactly that event", () => {
    const events: Array<SecurityEvent> = buildEvents(3);
    const { props, onOpenEvent } = classPanelProps({ events: events });
    renderWithI18n(<CorrelateClassEventsPanel {...props} />);

    fireEvent.click(screen.getByTestId("correlate-drilldown-event-2"));
    expect(onOpenEvent).toHaveBeenCalledTimes(1);
    expect(onOpenEvent.mock.calls[0]?.[0]).toBe(events[2]);

    fireEvent.click(screen.getByTestId("correlate-drilldown-event-0"));
    expect(onOpenEvent).toHaveBeenCalledTimes(2);
    expect(onOpenEvent.mock.calls[1]?.[0]).toBe(events[0]);
  });

  test("rows are buttons that show severity, relative time, message and principal", () => {
    const { props } = classPanelProps();
    renderWithI18n(<CorrelateClassEventsPanel {...props} />);

    const row: HTMLElement = screen.getByTestId("correlate-drilldown-event-0");
    expect(row.tagName).toBe("BUTTON");
    expect(row).toHaveAttribute("type", "button");
    expect(within(row).getByTestId("pill")).toHaveTextContent("High");

    const message: HTMLElement = within(row).getByText(
      "failed password for alice",
    );
    expect(message.textContent).toBe("failed password for alice");
    expect(message).toHaveClass("line-clamp-2");
    // `block` comes later in Tailwind's output and would cancel the clamp.
    expect(message).not.toHaveClass("block");

    // The user wins over the host.
    expect(within(row).getByText("alice")).toHaveClass("font-mono");
    expect(within(row).queryByText("wb-ubuntu-03")).toBeNull();

    const relative: HTMLElement = within(row).getByText(
      OneUptimeDate.fromNow(EVENT_TIME),
    );
    expect(relative).toHaveAttribute(
      "title",
      OneUptimeDate.getDateAsLocalFormattedString(EVENT_TIME),
    );
  });

  test("falls back to the host, and to a dash for a missing message or time", () => {
    const { props } = classPanelProps({
      events: [
        buildEvent({ principalHost: "db-01" }),
        buildEvent({ message: "no principal", time: EVENT_TIME }),
      ],
    });
    renderWithI18n(<CorrelateClassEventsPanel {...props} />);

    const first: HTMLElement = screen.getByTestId(
      "correlate-drilldown-event-0",
    );
    expect(within(first).getByText("db-01")).toBeInTheDocument();
    // Missing time and missing message each render a dash.
    expect(within(first).getAllByText("-")).toHaveLength(2);
    // Missing severity falls back to the pill's Unknown.
    expect(within(first).getByTestId("pill")).toHaveTextContent("Unknown");

    const second: HTMLElement = screen.getByTestId(
      "correlate-drilldown-event-1",
    );
    expect(within(second).getByText("no principal")).toBeInTheDocument();
    expect(second.querySelectorAll(".font-mono")).toHaveLength(0);
  });

  test("lists at most rowLimit rows and explains the cap", () => {
    const { props } = classPanelProps({
      events: buildEvents(55),
      rowLimit: 50,
    });
    renderWithI18n(<CorrelateClassEventsPanel {...props} />);

    expect(
      screen.getByTestId("correlate-drilldown-event-49"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("correlate-drilldown-event-50")).toBeNull();
    expect(
      within(screen.getByTestId("correlate-drilldown")).getAllByRole(
        "listitem",
      ),
    ).toHaveLength(50);

    const footer: HTMLElement = screen.getByTestId("correlate-drilldown-cap");
    expect(footer).toHaveTextContent(
      "Only the 50 most recent events are listed. Narrow the filter or time range to see the rest.",
    );
    expect(footer.textContent).not.toMatch(/matching event/);

    // The total still counts every event, and stays the only such line.
    const panel: HTMLElement = screen.getByTestId("correlate-drilldown");
    expect(within(panel).getAllByText(/matching event/)).toHaveLength(1);
    expect(screen.getByTestId("correlate-drilldown-count").textContent).toBe(
      "55 matching events",
    );
  });

  test("has no cap footer when the events fit exactly", () => {
    const { props } = classPanelProps({
      events: buildEvents(50),
      rowLimit: 50,
    });
    renderWithI18n(<CorrelateClassEventsPanel {...props} />);

    expect(
      screen.getByTestId("correlate-drilldown-event-49"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("correlate-drilldown-cap")).toBeNull();
  });

  test("honours a smaller row limit", () => {
    const { props } = classPanelProps({ events: buildEvents(4), rowLimit: 2 });
    renderWithI18n(<CorrelateClassEventsPanel {...props} />);

    expect(
      screen.getByTestId("correlate-drilldown-event-1"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("correlate-drilldown-event-2")).toBeNull();
    expect(screen.getByTestId("correlate-drilldown-cap")).toBeInTheDocument();
  });

  test("offers Filter to this class when allowed", () => {
    const { props, onFilterToClass } = classPanelProps({
      canFilterToClass: true,
    });
    renderWithI18n(<CorrelateClassEventsPanel {...props} />);

    const button: HTMLElement = screen.getByTestId(
      "correlate-drilldown-filter-class",
    );
    expect(button.tagName).toBe("BUTTON");
    expect(button).toHaveTextContent("Filter to this class");
    fireEvent.click(button);
    expect(onFilterToClass).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId("correlate-drilldown-or-note")).toBeNull();
  });

  test("hides Filter to this class when not allowed", () => {
    const { props } = classPanelProps({
      canFilterToClass: false,
      showOrModeNote: false,
    });
    renderWithI18n(<CorrelateClassEventsPanel {...props} />);

    expect(screen.queryByTestId("correlate-drilldown-filter-class")).toBeNull();
    expect(screen.queryByText("Filter to this class")).toBeNull();
    expect(screen.queryByTestId("correlate-drilldown-or-note")).toBeNull();
  });

  test("explains why the class filter is missing in OR mode", () => {
    const { props } = classPanelProps({
      canFilterToClass: false,
      showOrModeNote: true,
    });
    renderWithI18n(<CorrelateClassEventsPanel {...props} />);

    expect(screen.queryByTestId("correlate-drilldown-filter-class")).toBeNull();
    expect(screen.getByTestId("correlate-drilldown-or-note")).toHaveTextContent(
      "Class filters apply only when matching all conditions.",
    );
    // The note does not count as a "matching event" line.
    expect(
      within(screen.getByTestId("correlate-drilldown")).getAllByText(
        /1 matching event/,
      ),
    ).toHaveLength(1);
  });

  test("shows the button rather than the note when both are set", () => {
    const { props } = classPanelProps({
      canFilterToClass: true,
      showOrModeNote: true,
    });
    renderWithI18n(<CorrelateClassEventsPanel {...props} />);

    expect(
      screen.getByTestId("correlate-drilldown-filter-class"),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("correlate-drilldown-or-note")).toBeNull();
  });

  test("the close button is labelled and calls onClose", () => {
    const { props, onClose, onOpenEvent } = classPanelProps();
    renderWithI18n(<CorrelateClassEventsPanel {...props} />);

    const close: HTMLElement = screen.getByTestId("correlate-drilldown-close");
    expect(close).toHaveAttribute("aria-label", "Close");
    expect(screen.getByRole("button", { name: "Close" })).toBe(close);
    fireEvent.click(close);
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onOpenEvent).not.toHaveBeenCalled();
  });

  test("translates its copy", () => {
    const { props } = classPanelProps();
    renderWithI18n(<CorrelateClassEventsPanel {...props} />, german);

    expect(screen.getByTestId("correlate-drilldown-count").textContent).toBe(
      "1 passendes Ereignis",
    );
    expect(screen.getByTestId("correlate-drilldown-close")).toHaveAttribute(
      "aria-label",
      "Schließen",
    );
    expect(
      screen.getByTestId("correlate-drilldown-filter-class"),
    ).toHaveTextContent("Auf diese Klasse filtern");
  });
});

/* ---------- CorrelateObservablePivotPanel ---------- */

interface PivotPanelHarness {
  props: CorrelateObservablePivotPanelProps;
  onFocus: MockFunction;
  onAdd: MockFunction;
  onExclude: MockFunction;
  onSelectClass: MockFunction;
  onDismiss: MockFunction;
}

const SEEN_IN: Array<CorrelateObservableClass> = [
  {
    id: "class:Authentication",
    name: "Authentication",
    worstSeverity: OcsfSeverity.Critical,
    count: 5,
  },
  { id: "class:Process Activity", name: "Process Activity", count: 2 },
];

function pivotPanelProps(
  overrides?: Partial<CorrelateObservablePivotPanelProps>,
): PivotPanelHarness {
  const onFocus: MockFunction = getJestMockFunction();
  const onAdd: MockFunction = getJestMockFunction();
  const onExclude: MockFunction = getJestMockFunction();
  const onSelectClass: MockFunction = getJestMockFunction();
  const onDismiss: MockFunction = getJestMockFunction();
  const props: CorrelateObservablePivotPanelProps = {
    value: "alice",
    eventCount: 7,
    countIsLowerBound: false,
    classes: SEEN_IN,
    connector: "and",
    canExclude: true,
    onFocus: onFocus,
    onAdd: onAdd,
    onExclude: onExclude,
    onSelectClass: onSelectClass,
    onDismiss: onDismiss,
    ...(overrides || {}),
  };
  return { props, onFocus, onAdd, onExclude, onSelectClass, onDismiss };
}

describe("CorrelateObservablePivotPanel", () => {
  test("the value is the own text of exactly one element", () => {
    const { props } = pivotPanelProps();
    renderWithI18n(<CorrelateObservablePivotPanel {...props} />);

    const panel: HTMLElement = screen.getByTestId(
      "correlate-observable-actions",
    );
    expect(within(panel).getAllByText("alice")).toHaveLength(1);
    const value: HTMLElement = within(panel).getByText("alice");
    expect(value).toBe(screen.getByTestId("correlate-observable-value"));
    expect(value.textContent).toBe("alice");
    expect(value).toHaveClass("font-mono");
    expect(value).toHaveClass("break-all");
  });

  test("the value stays unique when it looks like a class name or a count", () => {
    const { props } = pivotPanelProps({
      value: "7",
      eventCount: 7,
      classes: [{ id: "class:7", name: "Seven", count: 7 }],
    });
    renderWithI18n(<CorrelateObservablePivotPanel {...props} />);

    const panel: HTMLElement = screen.getByTestId(
      "correlate-observable-actions",
    );
    // The value, the events tile and the chip count all read "7" …
    expect(within(panel).getAllByText("7").length).toBeGreaterThan(1);
    // … but only the value element has font-mono break-all.
    expect(
      within(panel)
        .getAllByText("7")
        .filter((element: HTMLElement): boolean => {
          return element.classList.contains("break-all");
        }),
    ).toHaveLength(1);
  });

  test("shows the events and classes facts", () => {
    const { props } = pivotPanelProps();
    renderWithI18n(<CorrelateObservablePivotPanel {...props} />);

    const events: HTMLElement = screen.getByTestId(
      "correlate-observable-fact-events",
    );
    expect(within(events).getByRole("term")).toHaveTextContent("Events");
    expect(within(events).getByRole("definition")).toHaveTextContent(/^7$/);

    const classes: HTMLElement = screen.getByTestId(
      "correlate-observable-fact-classes",
    );
    expect(within(classes).getByRole("term")).toHaveTextContent(
      "Event classes",
    );
    expect(within(classes).getByRole("definition")).toHaveTextContent(/^2$/);
  });

  test("marks a capped event count with +", () => {
    const { props } = pivotPanelProps({ countIsLowerBound: true });
    renderWithI18n(<CorrelateObservablePivotPanel {...props} />);

    expect(
      within(screen.getByTestId("correlate-observable-fact-events")).getByRole(
        "definition",
      ),
    ).toHaveTextContent(/^7\+$/);
    // Class count is exact regardless.
    expect(
      within(screen.getByTestId("correlate-observable-fact-classes")).getByRole(
        "definition",
      ),
    ).toHaveTextContent(/^2$/);
  });

  test("Correlate on this calls onFocus", () => {
    const { props, onFocus, onAdd, onExclude } = pivotPanelProps();
    renderWithI18n(<CorrelateObservablePivotPanel {...props} />);

    const focus: HTMLElement = screen.getByTestId("correlate-action-focus");
    expect(focus.tagName).toBe("BUTTON");
    expect(focus).toHaveAttribute("type", "button");
    expect(focus).toHaveTextContent("Correlate on this");
    expect(focus).toHaveTextContent(
      "Start a new graph centred on this observable.",
    );
    fireEvent.click(focus);
    expect(onFocus).toHaveBeenCalledTimes(1);
    expect(onAdd).not.toHaveBeenCalled();
    expect(onExclude).not.toHaveBeenCalled();
  });

  test("Add to filter calls onAdd with the AND hint", () => {
    const { props, onAdd, onFocus } = pivotPanelProps({ connector: "and" });
    renderWithI18n(<CorrelateObservablePivotPanel {...props} />);

    const add: HTMLElement = screen.getByTestId("correlate-action-add");
    expect(add).toHaveTextContent("Add to filter");
    expect(add).toHaveTextContent("Keep only events that also mention it.");
    expect(add).not.toHaveTextContent("Also include events that mention it.");
    fireEvent.click(add);
    expect(onAdd).toHaveBeenCalledTimes(1);
    expect(onFocus).not.toHaveBeenCalled();
  });

  test("Add to filter uses the OR hint in OR mode", () => {
    const { props } = pivotPanelProps({ connector: "or", canExclude: false });
    renderWithI18n(<CorrelateObservablePivotPanel {...props} />);

    const add: HTMLElement = screen.getByTestId("correlate-action-add");
    expect(add).toHaveTextContent("Also include events that mention it.");
    expect(add).not.toHaveTextContent("Keep only events that also mention it.");
  });

  test("Exclude from results calls onExclude and uses the danger tile", () => {
    const { props, onExclude } = pivotPanelProps({ canExclude: true });
    renderWithI18n(<CorrelateObservablePivotPanel {...props} />);

    const exclude: HTMLElement = screen.getByTestId("correlate-action-exclude");
    expect(exclude).toHaveTextContent("Exclude from results");
    expect(exclude).toHaveTextContent("Hide events that mention it.");
    expect(screen.getByTestId("correlate-action-exclude-icon")).toHaveClass(
      "bg-red-50",
      "text-red-600",
    );
    expect(screen.getByTestId("correlate-action-focus-icon")).toHaveClass(
      "bg-indigo-50",
      "text-indigo-600",
    );
    expect(screen.getByTestId("correlate-action-add-icon")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
    fireEvent.click(exclude);
    expect(onExclude).toHaveBeenCalledTimes(1);
  });

  test("hides Exclude when it cannot apply", () => {
    const { props } = pivotPanelProps({ canExclude: false });
    renderWithI18n(<CorrelateObservablePivotPanel {...props} />);

    expect(screen.queryByTestId("correlate-action-exclude")).toBeNull();
    expect(screen.queryByText("Exclude from results")).toBeNull();
    // The other two pivots remain.
    expect(screen.getByTestId("correlate-action-focus")).toBeInTheDocument();
    expect(screen.getByTestId("correlate-action-add")).toBeInTheDocument();
  });

  test("keeps the pivot order focus, add, exclude", () => {
    const { props } = pivotPanelProps();
    renderWithI18n(<CorrelateObservablePivotPanel {...props} />);

    const ids: Array<string> = Array.from(
      screen
        .getByTestId("correlate-observable-actions")
        .querySelectorAll("[data-testid^='correlate-action-']"),
    )
      .map((element: Element): string => {
        return element.getAttribute("data-testid") || "";
      })
      .filter((id: string): boolean => {
        return !id.endsWith("-icon");
      });
    expect(ids).toEqual([
      "correlate-action-dismiss",
      "correlate-action-focus",
      "correlate-action-add",
      "correlate-action-exclude",
    ]);
  });

  test("Seen-in chips list class names and select the class by id", () => {
    const { props, onSelectClass } = pivotPanelProps();
    renderWithI18n(<CorrelateObservablePivotPanel {...props} />);

    expect(screen.getByText("Seen in")).toBeInTheDocument();
    const seenIn: HTMLElement = screen.getByRole("list", { name: "Seen in" });
    expect(within(seenIn).getAllByRole("listitem")).toHaveLength(2);

    const first: HTMLElement = screen.getByTestId(
      "correlate-observable-class-0",
    );
    expect(first.tagName).toBe("BUTTON");
    expect(first).toHaveTextContent("Authentication");
    expect(first).toHaveTextContent("5");
    expect(first).toHaveAttribute("title", "Authentication");
    expect(
      screen.getByTestId("correlate-observable-class-dot-0").style.background,
    ).toBe(hexToRgb(Red.toString()));

    const second: HTMLElement = screen.getByTestId(
      "correlate-observable-class-1",
    );
    expect(second).toHaveTextContent("Process Activity");
    expect(second).toHaveTextContent("2");
    expect(screen.queryByTestId("correlate-observable-class-2")).toBeNull();

    fireEvent.click(second);
    expect(onSelectClass).toHaveBeenLastCalledWith("class:Process Activity");
    fireEvent.click(first);
    expect(onSelectClass).toHaveBeenLastCalledWith("class:Authentication");
    expect(onSelectClass).toHaveBeenCalledTimes(2);
  });

  test("Seen-in chips never contain the observable value", () => {
    const { props } = pivotPanelProps({ value: "wb-ubuntu-03" });
    renderWithI18n(<CorrelateObservablePivotPanel {...props} />);

    for (const index of [0, 1]) {
      const chip: HTMLElement = screen.getByTestId(
        `correlate-observable-class-${index}`,
      );
      expect(chip.textContent).not.toContain("wb-ubuntu-03");
      expect(chip.getAttribute("title")).not.toContain("wb-ubuntu-03");
    }
  });

  test("omits Seen in when there are no classes", () => {
    const { props } = pivotPanelProps({ classes: [] });
    renderWithI18n(<CorrelateObservablePivotPanel {...props} />);

    expect(screen.queryByText("Seen in")).toBeNull();
    expect(screen.queryByTestId("correlate-observable-class-0")).toBeNull();
    expect(
      within(screen.getByTestId("correlate-observable-fact-classes")).getByRole(
        "definition",
      ),
    ).toHaveTextContent(/^0$/);
  });

  test("the dismiss button is labelled and calls onDismiss", () => {
    const { props, onDismiss, onFocus } = pivotPanelProps();
    renderWithI18n(<CorrelateObservablePivotPanel {...props} />);

    const dismiss: HTMLElement = screen.getByTestId("correlate-action-dismiss");
    expect(dismiss).toHaveAttribute("aria-label", "Clear selection");
    expect(screen.getByRole("button", { name: "Clear selection" })).toBe(
      dismiss,
    );
    fireEvent.click(dismiss);
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onFocus).not.toHaveBeenCalled();
  });

  test("has an icon-only copy button that copies the value", async () => {
    const writeText: WriteTextMock = jest.fn<(text: string) => Promise<void>>(
      async (): Promise<void> => {},
    );
    const originalClipboard: PropertyDescriptor | undefined =
      Object.getOwnPropertyDescriptor(navigator, "clipboard");
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      configurable: true,
    });

    try {
      const { props, onFocus } = pivotPanelProps({ value: "10.0.0.7" });
      renderWithI18n(<CorrelateObservablePivotPanel {...props} />);

      const copy: HTMLElement = screen.getByRole("button", {
        name: "Copy value",
      });
      expect(copy).toHaveAttribute("title", "Copy value");
      // Icon only: no visible "Copy" label next to the value.
      expect(copy.textContent).toBe("");
      expect(
        within(screen.getByTestId("correlate-observable-actions")).getAllByText(
          "10.0.0.7",
        ),
      ).toHaveLength(1);

      await act(async () => {
        fireEvent.click(copy);
      });
      expect(writeText).toHaveBeenCalledWith("10.0.0.7");
      expect(onFocus).not.toHaveBeenCalled();
    } finally {
      if (originalClipboard) {
        Object.defineProperty(navigator, "clipboard", originalClipboard);
      } else {
        Object.defineProperty(navigator, "clipboard", {
          value: undefined,
          configurable: true,
        });
      }
    }
  });

  test("never mentions matching events", () => {
    const { props } = pivotPanelProps({ countIsLowerBound: true });
    renderWithI18n(<CorrelateObservablePivotPanel {...props} />);

    expect(
      screen.getByTestId("correlate-observable-actions").textContent,
    ).not.toMatch(/matching event/);
  });

  test("translates its copy", () => {
    const { props } = pivotPanelProps();
    renderWithI18n(<CorrelateObservablePivotPanel {...props} />, german);

    expect(screen.getByTestId("correlate-action-dismiss")).toHaveAttribute(
      "aria-label",
      "Auswahl aufheben",
    );
    expect(
      screen.getByRole("button", { name: "Wert kopieren" }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("correlate-action-add")).toHaveTextContent(
      "Zum Filter hinzufügen",
    );
    expect(screen.getByText("Gesehen in")).toBeInTheDocument();
    // The value itself is never translated.
    expect(screen.getByTestId("correlate-observable-value").textContent).toBe(
      "alice",
    );
  });
});

/* ---------- Dark theme ---------- */

function renderAllPanels(): Array<HTMLElement> {
  const overview: OverviewHarness = overviewProps({
    droppedObservableCount: 2,
    countsAreLowerBounds: true,
  });
  const staleOverview: OverviewHarness = overviewProps({
    isStale: true,
    observables: [],
  });
  const classPanel: ClassPanelHarness = classPanelProps({
    events: buildEvents(3),
    rowLimit: 2,
  });
  const orClassPanel: ClassPanelHarness = classPanelProps({
    canFilterToClass: false,
    showOrModeNote: true,
    worstSeverity: undefined,
  });
  const pivot: PivotPanelHarness = pivotPanelProps();

  const { container } = renderWithI18n(
    <div>
      <CorrelateOverview {...overview.props} />
      <CorrelateOverview {...staleOverview.props} />
      <CorrelateClassEventsPanel {...classPanel.props} />
      <CorrelateClassEventsPanel {...orClassPanel.props} />
      <CorrelateObservablePivotPanel {...pivot.props} />
    </div>,
  );
  return Array.from(container.querySelectorAll<HTMLElement>("*"));
}

function staticMarkupOfAllPanels(): string {
  const overview: OverviewHarness = overviewProps({
    droppedObservableCount: 2,
  });
  const classPanel: ClassPanelHarness = classPanelProps();
  const pivot: PivotPanelHarness = pivotPanelProps();
  return renderToStaticMarkup(
    withI18n(
      <div>
        <CorrelateOverview {...overview.props} />
        <CorrelateClassEventsPanel {...classPanel.props} />
        <CorrelateObservablePivotPanel {...pivot.props} />
      </div>,
    ),
  );
}

describe("CorrelateInspector dark theme", () => {
  /*
   * The dashboard's dark theme is a list of specific classes remapped under
   * html.dark in Theme.css. A colour class outside that list keeps its light
   * value on a dark page.
   */
  test("uses only colour classes the dark theme remaps", () => {
    const themeCss: string = fs.readFileSync(
      path.join(__dirname, "..", "..", "..", "UI", "Styles", "Theme.css"),
      "utf8",
    );
    const colourClass: RegExp =
      /^(bg|border|text|divide)-(white|[a-z]+-\d{2,3})$/;
    const stateColourClass: RegExp =
      /^(hover|focus):(bg|border|text)-(white|[a-z]+-\d{2,3})$/;
    const used: Set<string> = new Set<string>();
    const usedStates: Set<string> = new Set<string>();

    for (const element of renderAllPanels()) {
      const className: string = element.getAttribute("class") || "";
      for (const token of className.split(/\s+/)) {
        if (colourClass.test(token)) {
          used.add(token);
        }
        if (stateColourClass.test(token)) {
          usedStates.add(token);
        }
      }
    }

    expect(used.size).toBeGreaterThan(5);
    expect(usedStates.size).toBeGreaterThan(0);

    for (const token of Array.from(used)) {
      expect({
        token: token,
        remapped: new RegExp(`\\.${token}(?![\\w-])`).test(themeCss),
      }).toEqual({ token: token, remapped: true });
    }

    for (const token of Array.from(usedStates)) {
      expect({
        token: token,
        remapped: themeCss.includes(`[class~="${token}"]`),
      }).toEqual({ token: token, remapped: true });
    }
  });

  test("inline colours are theme tokens or severity accents", () => {
    const markup: string = staticMarkupOfAllPanels();
    const container: HTMLElement = document.createElement("div");
    container.innerHTML = markup;
    // Pill is a shared component with its own contrast logic; judge ours only.
    for (const pill of Array.from(
      container.querySelectorAll("[data-testid='pill']"),
    )) {
      pill.remove();
    }
    const ownMarkup: string = container.innerHTML;

    const severityHexes: Array<string> = [
      Red.toString(),
      Orange.toString(),
    ].map((hex: string): string => {
      return hex.toLowerCase();
    });

    const colourProperty: RegExp =
      /^(color|background|background-color|border-color)$/;
    const colourDeclarations: Array<string> = [];
    for (const element of Array.from(container.querySelectorAll("[style]"))) {
      const style: string = element.getAttribute("style") || "";
      for (const declaration of style.split(";")) {
        const [property, ...rest] = declaration.split(":");
        const name: string = (property || "").trim();
        const value: string = rest.join(":").trim().toLowerCase();
        if (colourProperty.test(name)) {
          colourDeclarations.push(`${name}:${value}`);
          const isToken: boolean = value.startsWith("var(--ou-");
          const isSeverity: boolean = severityHexes.includes(value);
          expect({
            declaration: `${name}:${value}`,
            ok: isToken || isSeverity,
          }).toEqual({ declaration: `${name}:${value}`, ok: true });
        }
      }
    }

    // The no-severity dot and the observable bars use tokens with fallbacks.
    expect(colourDeclarations).toContain(
      "background:var(--ou-chart-series-neutral, #64748b)",
    );
    expect(colourDeclarations).toContain("background:var(--ou-link, #4f46e5)");
    // No literal dark text colour anywhere.
    expect(ownMarkup).not.toMatch(/color:\s*#(111827|000000|1f2937|374151)/i);
  });
});
