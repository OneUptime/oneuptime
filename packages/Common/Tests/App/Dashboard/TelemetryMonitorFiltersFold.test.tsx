import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import React, { ReactElement } from "react";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { JSONObject } from "../../../Types/JSON";

/*
 * "The idea is to make software as simple as possible to use and reduce
 * decision paralysis." - the maintainer, asking for the same fix wherever
 * the same problem is.
 *
 * The log, trace and exception monitors' filter forms were among the last
 * to show their extra filters with a "Show / Hide Advanced Options" link of
 * their own: each with its own rule for when it opened (the log and trace
 * forms took an empty filter list for a set one, so theirs never started
 * folded; the exception form's folded itself again as soon as a filter
 * above it was typed into), no word of what was inside, and nothing to say
 * that a hidden filter was in force. They now fold those filters under More
 * fields, the section every form folds its rarely needed fields into:
 *
 *   - folded on a new monitor and on an edited one alike, its header naming
 *     what it holds;
 *   - each filter a monitor uses drawn on that header as a chip with what it
 *     is set to ("Filter by Telemetry Service: 1"), so nothing in force is
 *     hidden;
 *   - the filters most monitors use (severity, span status, text,
 *     exception types, environments) left on screen; the time window is the
 *     rule's now, set beside its number in When to alert
 *     (TelemetryRuleEditor);
 *   - folded fields still mounted, so what is picked in them reaches the
 *     saved step and the preview with every other filter;
 *   - the list of what the filters match folded too (Matching logs, spans,
 *     exceptions), and drawn - and read - only once opened: the rule's chart
 *     counts them already.
 *
 * The security event monitor's form has the same section and its own suite
 * (SecurityEventsMonitorStepForm.test.tsx).
 */

interface MockPreviews {
  logs: Array<JSONObject>;
  traces: Array<JSONObject>;
  exceptions: Array<JSONObject>;
}

// What each form's preview was last handed: the filters it shows the data of.
const mockPreviews: MockPreviews = { logs: [], traces: [], exceptions: [] };

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/LogMonitor/LogMonitorPreview",
  () => {
    return {
      __esModule: true,
      default: (props: { monitorStepLogMonitor: JSONObject }): ReactElement => {
        mockPreviews.logs.push(props.monitorStepLogMonitor);
        return <div data-testid="logs-preview" />;
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/TraceMonitor/TraceMonitorPreview",
  () => {
    return {
      __esModule: true,
      default: (props: {
        monitorStepTraceMonitor: JSONObject;
      }): ReactElement => {
        mockPreviews.traces.push(props.monitorStepTraceMonitor);
        return <div data-testid="spans-preview" />;
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Exceptions/ExceptionInstanceTable",
  () => {
    return {
      __esModule: true,
      default: (props: { query: JSONObject }): ReactElement => {
        mockPreviews.exceptions.push(props.query);
        return <div data-testid="exceptions-preview" />;
      },
    };
  },
);

/*
 * The resolved/archived fingerprint lookup the exception preview runs:
 * every read it asks for, by what it asks.
 */
const mockListReads: Array<JSONObject> = [];

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (options: { query: JSONObject }) => {
        mockListReads.push(options.query);
        return Promise.resolve({ data: [], count: 0, skip: 0, limit: 0 });
      },
    },
  };
});

import LogMonitorStepForm from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/LogMonitor/LogMonitorStepFrom";
import TraceMonitorStepForm from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/TraceMonitor/TraceMonitorStepForm";
import ExceptionMonitorStepForm from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/ExceptionMonitor/ExceptionMonitorStepForm";
import MonitorStepLogMonitor, {
  MonitorStepLogMonitorUtil,
} from "../../../Types/Monitor/MonitorStepLogMonitor";
import MonitorStepTraceMonitor, {
  MonitorStepTraceMonitorUtil,
} from "../../../Types/Monitor/MonitorStepTraceMonitor";
import MonitorStepExceptionMonitor, {
  MonitorStepExceptionMonitorUtil,
} from "../../../Types/Monitor/MonitorStepExceptionMonitor";
import Service from "../../../Models/DatabaseModels/Service";
import InventoryItem from "../../../Models/DatabaseModels/InventoryItem";
import LogSeverity from "../../../Types/Log/LogSeverity";
import { SpanStatus } from "../../../Models/AnalyticsModels/Span";
import ObjectID from "../../../Types/ObjectID";
import {
  getByTextOutsideFoldedHeaders,
  listedNames,
  setChips,
} from "../../UI/Components/FoldedSection/FoldedSectionQueries";

const SERVICE_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const ENTITY_KEY: string = "k8s.pod/checkout-7d9f";

function services(): Array<Service> {
  const service: Service = new Service();
  service.id = SERVICE_ID;
  service.name = "checkout";
  return [service];
}

function entities(): Array<InventoryItem> {
  const entity: InventoryItem = new InventoryItem();
  entity.entityKey = ENTITY_KEY;
  entity.entityType = "k8s.pod" as never;
  entity.displayName = "checkout-7d9f";
  return [entity];
}

function moreFields(): HTMLElement {
  return screen.getByRole("button", { name: "More fields" });
}

// The fold under the filters that lists what they match.
function openMatching(title: string): void {
  const header: HTMLElement = screen.getByRole("button", { name: title });

  expect(header).toHaveAttribute("aria-expanded", "false");
  fireEvent.click(header);
  expect(header).toHaveAttribute("aria-expanded", "true");
}

// A field's own label, not the name the folded header lists it by.
function fieldLabel(title: string): HTMLElement {
  return getByTextOutsideFoldedHeaders(document.body, title);
}

// The dropdown of the field with this title.
function comboboxOf(title: string): HTMLElement {
  let node: HTMLElement | null = fieldLabel(title);

  while (node) {
    const combobox: HTMLElement | null =
      node.querySelector<HTMLElement>('[role="combobox"]');

    if (combobox) {
      return combobox;
    }

    node = node.parentElement;
  }

  throw new Error(`No dropdown found for "${title}".`);
}

// Picks an option of a react-select, the way a pointer does.
function pick(combobox: HTMLElement, optionText: string): void {
  fireEvent.keyDown(combobox, { key: "ArrowDown" });
  const option: HTMLElement = screen.getByText(optionText);
  fireEvent.mouseDown(option);
  fireEvent.click(option);
}

function attributeKeyInput(): HTMLInputElement {
  const input: HTMLInputElement | undefined = Array.from(
    document.querySelectorAll<HTMLInputElement>(
      'input[aria-controls^="autocomplete-suggestions-"]',
    ),
  ).find((candidate: HTMLInputElement): boolean => {
    return candidate.getAttribute("placeholder") !== "Value";
  });

  if (!input) {
    throw new Error("No attribute key box in the attributes filter.");
  }

  return input;
}

function attributeValueInput(): HTMLInputElement {
  const input: HTMLInputElement | null =
    document.querySelector<HTMLInputElement>('input[placeholder="Value"]');

  if (!input) {
    throw new Error("No attribute value box in the attributes filter.");
  }

  return input;
}

function expectNoOldAdvancedLink(): void {
  expect(screen.queryByText("Show Advanced Options")).not.toBeInTheDocument();
  expect(screen.queryByText("Hide Advanced Options")).not.toBeInTheDocument();
}

afterEach(() => {
  cleanup();
  mockPreviews.logs = [];
  mockPreviews.traces = [];
  mockPreviews.exceptions = [];
  mockListReads.length = 0;
});

describe("Log monitor filters", () => {
  interface Recorder {
    latest: MonitorStepLogMonitor | null;
  }

  // Hands every change back as MonitorStep does: a new object each time.
  const Harness: React.FunctionComponent<{
    recorder: Recorder;
    initial: MonitorStepLogMonitor;
  }> = (props: {
    recorder: Recorder;
    initial: MonitorStepLogMonitor;
  }): ReactElement => {
    const [logMonitor, setLogMonitor] = React.useState<MonitorStepLogMonitor>(
      props.initial,
    );

    return (
      <LogMonitorStepForm
        monitorStepLogMonitor={logMonitor}
        onMonitorStepLogMonitorChanged={(value: MonitorStepLogMonitor) => {
          props.recorder.latest = value;
          setLogMonitor({ ...value });
        }}
        attributeKeys={["http.route"]}
        telemetryServices={services()}
        telemetryEntities={entities()}
      />
    );
  };

  function renderForm(initial: Partial<MonitorStepLogMonitor> = {}): Recorder {
    const recorder: Recorder = { latest: null };

    render(
      <Harness
        recorder={recorder}
        initial={{ ...MonitorStepLogMonitorUtil.getDefault(), ...initial }}
      />,
    );

    return recorder;
  }

  test("a new monitor shows the severity and the text, and folds the rest under More fields", () => {
    renderForm();

    // The filter most log monitors use is never folded away.
    expect(fieldLabel("Log Severity")).toBeVisible();
    expect(fieldLabel("Message contains")).toBeVisible();
    // The window is the rule's, set in When to alert.
    expect(
      screen.queryByText("Monitor Logs for (time)"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("Monitor Logs that include this text"),
    ).not.toBeInTheDocument();

    expect(moreFields()).toHaveAttribute("aria-expanded", "false");
    expect(listedNames(moreFields())).toEqual([
      "Filter by Telemetry Service",
      "Filter by Infrastructure Entity",
      "Filter by Attributes",
    ]);
    expect(setChips(moreFields())).toEqual([]);

    expect(fieldLabel("Filter by Telemetry Service")).not.toBeVisible();
    expect(fieldLabel("Filter by Infrastructure Entity")).not.toBeVisible();
    expect(fieldLabel("Filter by Attributes")).not.toBeVisible();

    expectNoOldAdvancedLink();
  });

  test("the logs the filters match are folded, and read only once opened", () => {
    renderForm({ body: "timeout" });

    expect(
      screen.getByRole("button", { name: "Matching logs" }),
    ).toHaveAttribute("aria-expanded", "false");
    expect(screen.queryByTestId("logs-preview")).not.toBeInTheDocument();
    expect(mockPreviews.logs).toEqual([]);

    openMatching("Matching logs");

    expect(screen.getByTestId("logs-preview")).toBeInTheDocument();
    expect(mockPreviews.logs[mockPreviews.logs.length - 1]).toMatchObject({
      body: "timeout",
    });
  });

  test("opening More fields shows its filters, and nothing else changes", () => {
    renderForm();

    fireEvent.click(moreFields());

    expect(moreFields()).toHaveAttribute("aria-expanded", "true");
    expect(fieldLabel("Filter by Telemetry Service")).toBeVisible();
    expect(fieldLabel("Filter by Infrastructure Entity")).toBeVisible();
    expect(fieldLabel("Filter by Attributes")).toBeVisible();
    expectNoOldAdvancedLink();
  });

  test("an edited monitor keeps More fields folded, its filters in force shown as chips", () => {
    renderForm({
      body: "timeout",
      severityTexts: [LogSeverity.Error],
      telemetryServiceIds: [SERVICE_ID],
      entityKeys: [ENTITY_KEY],
      attributes: { "http.route": "/checkout" },
    });

    expect(moreFields()).toHaveAttribute("aria-expanded", "false");
    expect(setChips(moreFields())).toEqual([
      "Filter by Telemetry Service: 1",
      "Filter by Infrastructure Entity: 1",
      "Filter by Attributes: 1",
    ]);

    // And the folded filters still scope what the preview shows.
    openMatching("Matching logs");

    expect(mockPreviews.logs[mockPreviews.logs.length - 1]).toMatchObject({
      body: "timeout",
      severityTexts: [LogSeverity.Error],
      telemetryServiceIds: [SERVICE_ID],
      entityKeys: [ENTITY_KEY],
      attributes: { "http.route": "/checkout" },
    });
  });

  test("a filter picked under More fields reaches the step and the preview with the others", () => {
    const recorder: Recorder = renderForm({ body: "timeout" });

    openMatching("Matching logs");
    fireEvent.click(moreFields());
    pick(comboboxOf("Filter by Telemetry Service"), "checkout");

    expect(recorder.latest).toMatchObject({
      body: "timeout",
      telemetryServiceIds: [SERVICE_ID.toString()],
    });
    expect(mockPreviews.logs[mockPreviews.logs.length - 1]).toMatchObject({
      body: "timeout",
      telemetryServiceIds: [SERVICE_ID.toString()],
    });

    fireEvent.click(screen.getByText("Add Filter by Attributes"));
    fireEvent.change(attributeKeyInput(), { target: { value: "http.route" } });
    fireEvent.change(attributeValueInput(), {
      target: { value: "/checkout" },
    });

    expect(recorder.latest).toMatchObject({
      body: "timeout",
      telemetryServiceIds: [SERVICE_ID.toString()],
      attributes: { "http.route": "/checkout" },
    });

    // Folded again, the header says what is now in force.
    fireEvent.click(moreFields());

    expect(setChips(moreFields())).toEqual([
      "Filter by Telemetry Service: 1",
      "Filter by Attributes: 1",
    ]);
  });

  test("typing in a filter above it leaves More fields as it was", () => {
    renderForm();

    fireEvent.click(moreFields());
    fireEvent.change(
      screen.getByRole("textbox", {
        name: "Message contains",
      }),
      { target: { value: "database" } },
    );

    expect(moreFields()).toHaveAttribute("aria-expanded", "true");
  });
});

describe("Trace monitor filters", () => {
  interface Recorder {
    latest: MonitorStepTraceMonitor | null;
  }

  const Harness: React.FunctionComponent<{
    recorder: Recorder;
    initial: MonitorStepTraceMonitor;
  }> = (props: {
    recorder: Recorder;
    initial: MonitorStepTraceMonitor;
  }): ReactElement => {
    const [traceMonitor, setTraceMonitor] =
      React.useState<MonitorStepTraceMonitor>(props.initial);

    return (
      <TraceMonitorStepForm
        monitorStepTraceMonitor={traceMonitor}
        onMonitorStepTraceMonitorChanged={(value: MonitorStepTraceMonitor) => {
          props.recorder.latest = value;
          setTraceMonitor({ ...value });
        }}
        attributeKeys={["http.route"]}
        telemetryServices={services()}
        telemetryEntities={entities()}
      />
    );
  };

  function renderForm(
    initial: Partial<MonitorStepTraceMonitor> = {},
  ): Recorder {
    const recorder: Recorder = { latest: null };

    render(
      <Harness
        recorder={recorder}
        initial={{ ...MonitorStepTraceMonitorUtil.getDefault(), ...initial }}
      />,
    );

    return recorder;
  }

  test("a new monitor shows the span status and the span name, and folds the rest under More fields", () => {
    renderForm();

    // Filtering on ERROR is how a trace monitor alerts on failures.
    expect(fieldLabel("Span Status")).toBeVisible();
    expect(fieldLabel("Span name contains")).toBeVisible();
    // The window is the rule's, set in When to alert.
    expect(
      screen.queryByText("Monitor Traces for (time)"),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("Filter by Span Status")).not.toBeInTheDocument();

    expect(moreFields()).toHaveAttribute("aria-expanded", "false");
    expect(listedNames(moreFields())).toEqual([
      "Filter by Telemetry Service",
      "Filter by Infrastructure Entity",
      "Filter by Attributes",
    ]);
    expect(setChips(moreFields())).toEqual([]);
    expect(fieldLabel("Filter by Attributes")).not.toBeVisible();

    expectNoOldAdvancedLink();
  });

  test("an edited monitor keeps More fields folded, its filters in force shown as chips", () => {
    renderForm({
      spanStatuses: [SpanStatus.Error],
      telemetryServiceIds: [SERVICE_ID],
      attributes: { "http.route": "/checkout" },
    });

    expect(moreFields()).toHaveAttribute("aria-expanded", "false");
    expect(setChips(moreFields())).toEqual([
      "Filter by Telemetry Service: 1",
      "Filter by Attributes: 1",
    ]);

    // Folded, the spans are not read; opened, the folded filters scope them.
    expect(mockPreviews.traces).toEqual([]);
    openMatching("Matching spans");

    expect(mockPreviews.traces[mockPreviews.traces.length - 1]).toMatchObject({
      spanStatuses: [SpanStatus.Error],
      telemetryServiceIds: [SERVICE_ID],
      attributes: { "http.route": "/checkout" },
    });
  });

  test("a filter picked under More fields reaches the step with the others", () => {
    const recorder: Recorder = renderForm({ spanName: "POST /checkout" });

    fireEvent.click(moreFields());
    pick(
      comboboxOf("Filter by Infrastructure Entity"),
      "checkout-7d9f (k8s.pod)",
    );

    expect(recorder.latest).toMatchObject({
      spanName: "POST /checkout",
      entityKeys: [ENTITY_KEY],
    });

    fireEvent.click(moreFields());

    expect(setChips(moreFields())).toEqual([
      "Filter by Infrastructure Entity: 1",
    ]);
  });
});

describe("Exception monitor filters", () => {
  interface Recorder {
    latest: MonitorStepExceptionMonitor | null;
  }

  // As MonitorStep does: every change handed back as a new object.
  const Harness: React.FunctionComponent<{
    recorder: Recorder;
    initial: MonitorStepExceptionMonitor;
  }> = (props: {
    recorder: Recorder;
    initial: MonitorStepExceptionMonitor;
  }): ReactElement => {
    const [exceptionMonitor, setExceptionMonitor] =
      React.useState<MonitorStepExceptionMonitor>(props.initial);

    return (
      <ExceptionMonitorStepForm
        monitorStepExceptionMonitor={exceptionMonitor}
        onMonitorStepExceptionMonitorChanged={(
          value: MonitorStepExceptionMonitor,
        ) => {
          props.recorder.latest = value;
          setExceptionMonitor(value);
        }}
        telemetryServices={services()}
        telemetryEntities={entities()}
      />
    );
  };

  function renderForm(
    initial: Partial<MonitorStepExceptionMonitor> = {},
  ): Recorder {
    const recorder: Recorder = { latest: null };

    render(
      <Harness
        recorder={recorder}
        initial={{
          ...MonitorStepExceptionMonitorUtil.getDefault(),
          ...initial,
        }}
      />,
    );

    return recorder;
  }

  test("a new monitor shows the message, types and environments, and folds the rest under More fields", () => {
    renderForm();

    expect(fieldLabel("Message contains")).toBeVisible();
    expect(fieldLabel("Exception Types")).toBeVisible();
    expect(fieldLabel("Environments")).toBeVisible();
    // The window is the rule's, set in When to alert.
    expect(
      screen.queryByText("Monitor exceptions for (time)"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("Filter Exception Message"),
    ).not.toBeInTheDocument();

    expect(moreFields()).toHaveAttribute("aria-expanded", "false");
    expect(listedNames(moreFields())).toEqual([
      "Filter by Telemetry Service",
      "Filter by Infrastructure Entity",
      "Include Resolved Exceptions",
      "Include Archived Exceptions",
    ]);
    expect(setChips(moreFields())).toEqual([]);
    expect(fieldLabel("Filter by Telemetry Service")).not.toBeVisible();

    expectNoOldAdvancedLink();
  });

  test("its list of matching exceptions asks for nothing until it is opened", async () => {
    renderForm();

    // Past the form's debounce: a folded list still asks nothing.
    await act(async () => {
      await new Promise((resolve: (value: unknown) => void) => {
        setTimeout(resolve, 800);
      });
    });
    expect(mockListReads).toEqual([]);
    expect(mockPreviews.exceptions).toEqual([]);

    openMatching("Matching exceptions");

    await act(async () => {
      await new Promise((resolve: (value: unknown) => void) => {
        setTimeout(resolve, 50);
      });
    });

    // Opened: the resolved and archived groups it leaves out are read.
    expect(mockListReads).toHaveLength(2);
    expect(mockListReads).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ isResolved: true }),
        expect.objectContaining({ isArchived: true }),
      ]),
    );
    expect(screen.getByTestId("exceptions-preview")).toBeInTheDocument();
  });

  test("an edited monitor keeps More fields folded, its filters in force shown as chips", () => {
    /*
     * The old link opened by itself for any of these. Folded, the header
     * still says each one is in force, and what it is set to.
     */
    renderForm({
      telemetryServiceIds: [SERVICE_ID],
      includeResolved: true,
    });

    expect(moreFields()).toHaveAttribute("aria-expanded", "false");
    expect(setChips(moreFields())).toEqual([
      "Filter by Telemetry Service: 1",
      "Include Resolved Exceptions: On",
    ]);

    // The folded service filter still scopes the preview, once opened.
    expect(mockPreviews.exceptions).toEqual([]);
    openMatching("Matching exceptions");

    expect(
      JSON.stringify(
        mockPreviews.exceptions[mockPreviews.exceptions.length - 1]?.[
          "primaryEntityId"
        ],
      ),
    ).toContain(SERVICE_ID.toString());
  });

  test("a switch under More fields reaches the step with the other filters", () => {
    const recorder: Recorder = renderForm({ exceptionTypes: ["TypeError"] });

    fireEvent.click(moreFields());
    fireEvent.click(
      screen.getByRole("checkbox", { name: "Include Archived Exceptions" }),
    );

    expect(recorder.latest).toMatchObject({
      exceptionTypes: ["TypeError"],
      includeArchived: true,
      includeResolved: false,
    });

    fireEvent.click(moreFields());

    expect(setChips(moreFields())).toEqual(["Include Archived Exceptions: On"]);
  });

  test("typing in a filter above it no longer folds More fields again", () => {
    /*
     * The old link re-read "is anything advanced set?" every time the step
     * came back from MonitorStep, so typing an exception type with it open
     * and nothing in it set folded it shut under the cursor.
     */
    const recorder: Recorder = renderForm();

    fireEvent.click(moreFields());

    expect(moreFields()).toHaveAttribute("aria-expanded", "true");

    fireEvent.change(
      screen.getByPlaceholderText("TypeError, NullReferenceException"),
      { target: { value: "TypeError" } },
    );

    expect(recorder.latest?.exceptionTypes).toEqual(["TypeError"]);
    expect(moreFields()).toHaveAttribute("aria-expanded", "true");
    expect(
      screen.getByRole("checkbox", { name: "Include Resolved Exceptions" }),
    ).toBeVisible();
  });
});
