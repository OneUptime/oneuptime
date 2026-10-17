/** @timezone UTC */

import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import {
  cleanup,
  fireEvent,
  render,
  RenderResult,
  screen,
} from "@testing-library/react";
import React, { ReactElement } from "react";
import { JSONObject } from "../../../Types/JSON";

/*
 * The dashboard half of Resolved By on a Logs monitor: the field on the
 * monitor form, the sentence the logs preview adds once it is set, and the
 * row on the monitor's own page.
 *
 * What a person must be able to rely on:
 *
 *   - a monitor that is not grouped is never asked the question - it has
 *     no groups for a log to resolve;
 *   - what they enter is saved, and is what the worker reads;
 *   - the form says, in a sentence, what the setting does.
 */

const mockLogsViewerProps: Array<Record<string, unknown>> = [];

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Logs/LogsViewer",
  () => {
    return {
      __esModule: true,
      default: (props: Record<string, unknown>): ReactElement => {
        mockLogsViewerProps.push(props);
        const ReactModule: typeof React = jest.requireActual(
          "react",
        ) as typeof React;

        return ReactModule.createElement(
          "div",
          { "data-testid": "logs-viewer" },
          "Logs viewer",
        );
      },
    };
  },
);

import LogMonitorStepForm from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/LogMonitor/LogMonitorStepFrom";
import LogMonitorPreview from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/LogMonitor/LogMonitorPreview";
import MonitorStepViewModel, {
  MonitorStepViewRow,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/MonitorStepViewModel";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import MonitorStepLogMonitor, {
  MonitorStepLogMonitorUtil,
} from "../../../Types/Monitor/MonitorStepLogMonitor";
import MonitorType from "../../../Types/Monitor/MonitorType";

// The same words as the row on the monitor's page: one name for the setting.
const FIELD_TITLE: string = "Resolved by Attributes";

afterEach(() => {
  cleanup();
  mockLogsViewerProps.length = 0;
});

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
      attributeKeys={["event.name", "event.device"]}
      telemetryServices={[]}
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

// The field's own block: its label, its sentence and its inputs.
function resolvedByField(): HTMLElement | null {
  const label: HTMLElement | null = screen.queryByText(FIELD_TITLE);

  return label?.closest("label")?.parentElement || null;
}

function inputOf(placeholder: "Key" | "Value"): HTMLInputElement {
  const input: HTMLInputElement | null | undefined =
    resolvedByField()?.querySelector<HTMLInputElement>(
      `input[placeholder="${placeholder}"]`,
    );

  if (!input) {
    throw new Error(`No ${placeholder} box in the Resolved By field.`);
  }

  return input;
}

describe("the Resolved By field on the Logs monitor form", () => {
  test("is not there for a monitor that is not grouped: it has no groups for a log to resolve", () => {
    renderForm();

    expect(resolvedByField()).toBeNull();
    // Group By itself is.
    expect(screen.getByText("Group by Attributes")).toBeInTheDocument();
  });

  test("is there once the monitor is grouped, right under Group By, and says what it does", () => {
    renderForm({ groupByAttributes: ["event.device"] });

    const field: HTMLElement | null = resolvedByField();

    expect(field).not.toBeNull();
    expect(field).toHaveTextContent(
      "Keep a group's alert or incident open until a log with these attributes arrives.",
    );
    expect(field).toHaveTextContent(
      "Leave empty to resolve a group when its logs stop.",
    );

    // After Group By, before the folded filters.
    const groupBy: HTMLElement = screen.getByText("Group by Attributes");

    expect(
      groupBy.compareDocumentPosition(field as HTMLElement) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  test("appears when the first Group By attribute is typed, and goes when the last is removed", () => {
    renderForm();

    expect(resolvedByField()).toBeNull();

    fireEvent.click(screen.getByTestId("add-log-group-by-attribute"));

    // A row with nothing typed in it does not group the monitor yet.
    expect(resolvedByField()).toBeNull();

    fireEvent.change(screen.getByTestId("log-group-by-attribute-0"), {
      target: { value: "event.device" },
    });

    expect(resolvedByField()).not.toBeNull();

    fireEvent.click(screen.getByTestId("remove-log-group-by-attribute-0"));

    expect(resolvedByField()).toBeNull();
  });

  test("shows what a monitor already has", () => {
    renderForm({
      groupByAttributes: ["event.device", "network.interface.name"],
      resolvedByAttributes: { "event.name": "interface.up" },
    });

    expect(inputOf("Key")).toHaveValue("event.name");
    expect(inputOf("Value")).toHaveValue("interface.up");
  });

  test("what is entered is saved on the step, as the worker reads it", () => {
    const recorder: Recorder = renderForm({
      groupByAttributes: ["event.device"],
      resolvedByAttributes: { "event.name": "interface.up" },
    });

    fireEvent.change(inputOf("Value"), {
      target: { value: "vpn.tunnel_up" },
    });

    expect(recorder.latest?.resolvedByAttributes).toEqual({
      "event.name": "vpn.tunnel_up",
    });
    expect(
      MonitorStepLogMonitorUtil.getResolvedByAttributes(recorder.latest),
    ).toEqual({ "event.name": "vpn.tunnel_up" });
    expect(MonitorStepLogMonitorUtil.isResolvedByLog(recorder.latest)).toBe(
      true,
    );
    // And it goes into the saved step.
    expect(
      MonitorStepLogMonitorUtil.toJSON(
        recorder.latest as MonitorStepLogMonitor,
      )["resolvedByAttributes"],
    ).toEqual({ "event.name": "vpn.tunnel_up" });
  });

  test("editing it leaves the monitor's own filters and grouping as they were", () => {
    const recorder: Recorder = renderForm({
      body: "down",
      attributes: { "event.name": "interface.down" },
      groupByAttributes: ["event.device"],
      resolvedByAttributes: { "event.name": "interface.up" },
    });

    fireEvent.change(inputOf("Value"), { target: { value: "link.up" } });

    expect(recorder.latest?.attributes).toEqual({
      "event.name": "interface.down",
    });
    expect(recorder.latest?.groupByAttributes).toEqual(["event.device"]);
    expect(recorder.latest?.body).toBe("down");
  });

  test("it is not folded away with the filters: it changes how alerts close, not which logs match", () => {
    renderForm({
      groupByAttributes: ["event.device"],
      resolvedByAttributes: { "event.name": "interface.up" },
    });

    // On screen without opening More fields, and ahead of that section.
    const moreFields: HTMLElement = screen.getByRole("button", {
      name: "More fields",
    });

    expect(inputOf("Key")).toBeVisible();
    expect(
      (resolvedByField() as HTMLElement).compareDocumentPosition(moreFields) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(moreFields).toHaveAttribute("aria-expanded", "false");
  });
});

describe("LogMonitorPreview with Resolved By", () => {
  function logMonitor(
    overrides?: Partial<MonitorStepLogMonitor>,
  ): MonitorStepLogMonitor {
    return {
      ...MonitorStepLogMonitorUtil.getDefault(),
      attributes: { "event.name": "interface.down" },
      groupByAttributes: ["event.device", "network.interface.name"],
      ...overrides,
    };
  }

  test("says what it does, naming the attributes and their values", () => {
    render(
      <LogMonitorPreview
        monitorStepLogMonitor={logMonitor({
          resolvedByAttributes: {
            "event.domain": "network",
            "event.name": "interface.up",
          },
        })}
      />,
    );

    const sentence: HTMLElement = screen.getByTestId(
      "log-monitor-resolved-by-summary",
    );

    expect(sentence).toHaveTextContent(
      "A group's alert or incident stays open until a log with event.domain = network, event.name = interface.up arrives for that group.",
    );
    expect(sentence).toHaveTextContent(
      "A group that only goes quiet is left open.",
    );
    // Inside the note about grouping, which it qualifies.
    expect(screen.getByTestId("log-monitor-group-by-summary")).toContainElement(
      sentence,
    );
  });

  test("says nothing of it for a grouped monitor that names no resolving log", () => {
    render(<LogMonitorPreview monitorStepLogMonitor={logMonitor()} />);

    expect(
      screen.getByTestId("log-monitor-group-by-summary"),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId("log-monitor-resolved-by-summary"),
    ).not.toBeInTheDocument();
  });

  test("says nothing of it while the monitor is not grouped: the setting does not apply", () => {
    render(
      <LogMonitorPreview
        monitorStepLogMonitor={logMonitor({
          groupByAttributes: [],
          resolvedByAttributes: { "event.name": "interface.up" },
        })}
      />,
    );

    expect(
      screen.queryByTestId("log-monitor-resolved-by-summary"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("log-monitor-group-by-summary"),
    ).not.toBeInTheDocument();
  });

  test("editing it keeps the same log query, so the list below is not refetched", () => {
    const view: RenderResult = render(
      <LogMonitorPreview monitorStepLogMonitor={logMonitor()} />,
    );

    const first: unknown =
      mockLogsViewerProps[mockLogsViewerProps.length - 1]!["logQuery"];

    view.rerender(
      <LogMonitorPreview
        monitorStepLogMonitor={logMonitor({
          resolvedByAttributes: { "event.name": "interface.up" },
        })}
      />,
    );

    expect(
      mockLogsViewerProps[mockLogsViewerProps.length - 1]!["logQuery"],
    ).toBe(first);

    // The logs shown are the ones the monitor counts, not the resolving ones.
    expect((first as JSONObject)["attributes"]).toEqual({
      "event.name": "interface.down",
    });
  });
});

describe("a Logs monitor's own page", () => {
  function rowsFor(
    logMonitor: Partial<MonitorStepLogMonitor>,
  ): Array<MonitorStepViewRow> {
    const step: MonitorStep = new MonitorStep();

    step.data!.logMonitor = {
      ...MonitorStepLogMonitorUtil.getDefault(),
      ...logMonitor,
    };

    return MonitorStepViewModel.getRows({
      monitorType: MonitorType.Logs,
      monitorStep: step,
    });
  }

  function resolvedByRow(
    rows: Array<MonitorStepViewRow>,
  ): MonitorStepViewRow | undefined {
    return rows.find((row: MonitorStepViewRow): boolean => {
      return row.key === "logResolvedByAttributes";
    });
  }

  test("shows Resolved By, with what the setting does", () => {
    const row: MonitorStepViewRow | undefined = resolvedByRow(
      rowsFor({
        groupByAttributes: ["event.device"],
        resolvedByAttributes: { "event.name": "interface.up" },
      }),
    );

    expect(row?.title).toBe(FIELD_TITLE);
    expect(row?.value).toEqual({ "event.name": "interface.up" });
    expect(row?.description).toBe(
      "A group's alert or incident stays open until a log with these attributes arrives for that group.",
    );
  });

  test("leaves the row out when the monitor names no resolving log, or is not grouped", () => {
    expect(
      resolvedByRow(rowsFor({ groupByAttributes: ["event.device"] })),
    ).toBeUndefined();
    expect(
      resolvedByRow(
        rowsFor({
          groupByAttributes: [],
          resolvedByAttributes: { "event.name": "interface.up" },
        }),
      ),
    ).toBeUndefined();
  });

  test("the row sits right after Group by Attributes", () => {
    const keys: Array<string> = rowsFor({
      groupByAttributes: ["event.device"],
      resolvedByAttributes: { "event.name": "interface.up" },
    }).map((row: MonitorStepViewRow): string => {
      return row.key;
    });

    expect(keys.indexOf("logResolvedByAttributes")).toBe(
      keys.indexOf("logGroupByAttributes") + 1,
    );
  });
});
