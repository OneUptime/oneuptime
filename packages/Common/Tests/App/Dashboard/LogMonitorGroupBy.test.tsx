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

/*
 * The dashboard half of a Logs monitor's Group By: the "Group by
 * Attributes" input on the log monitor form, and the note the logs
 * preview shows once the monitor is grouped. The logs viewer is stubbed
 * to record the query it is handed - grouping is not a filter, so editing
 * it must never hand the viewer a new query (which resets and refetches).
 */

type OnChangeMock = ReturnType<typeof jest.fn<(keys: Array<string>) => void>>;

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

import LogGroupByAttributesInput from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/LogMonitor/LogGroupByAttributesInput";
import LogMonitorPreview from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/LogMonitor/LogMonitorPreview";
import MonitorStepLogMonitor, {
  MAX_LOG_MONITOR_GROUP_BY_ATTRIBUTES,
  MonitorStepLogMonitorUtil,
} from "../../../Types/Monitor/MonitorStepLogMonitor";

afterEach(() => {
  cleanup();
  mockLogsViewerProps.length = 0;
});

function rowInput(index: number): HTMLInputElement {
  return screen.getByTestId(
    `log-group-by-attribute-${index}`,
  ) as HTMLInputElement;
}

describe("LogGroupByAttributesInput", () => {
  test("shows one row per saved attribute", () => {
    render(
      <LogGroupByAttributesInput initialValue={["con_name", "gw_name"]} />,
    );

    expect(rowInput(0)).toHaveValue("con_name");
    expect(rowInput(1)).toHaveValue("gw_name");
    expect(
      screen.queryByTestId("log-group-by-attribute-2"),
    ).not.toBeInTheDocument();
  });

  test("starts empty for a monitor that is not grouped", () => {
    render(<LogGroupByAttributesInput initialValue={undefined} />);

    expect(
      screen.queryByTestId("log-group-by-attribute-0"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId("add-log-group-by-attribute"),
    ).toBeInTheDocument();
  });

  test("adding a row changes nothing until a key is typed, then reports it", () => {
    const onChange: OnChangeMock = jest.fn<(keys: Array<string>) => void>();

    render(<LogGroupByAttributesInput initialValue={[]} onChange={onChange} />);

    fireEvent.click(screen.getByTestId("add-log-group-by-attribute"));

    expect(rowInput(0)).toHaveValue("");
    expect(onChange).not.toHaveBeenCalled();

    // Free text: a key no log has carried yet can be typed in.
    fireEvent.change(rowInput(0), { target: { value: "sophos.con_name" } });

    expect(onChange).toHaveBeenLastCalledWith(["sophos.con_name"]);
  });

  test("reports cleaned-up keys: trimmed, no blanks, no repeats", () => {
    const onChange: OnChangeMock = jest.fn<(keys: Array<string>) => void>();

    render(
      <LogGroupByAttributesInput
        initialValue={["con_name", ""]}
        onChange={onChange}
      />,
    );

    fireEvent.change(rowInput(1), { target: { value: " con_name " } });
    expect(onChange).toHaveBeenLastCalledWith(["con_name"]);

    fireEvent.change(rowInput(1), { target: { value: " gw_name " } });
    expect(onChange).toHaveBeenLastCalledWith(["con_name", "gw_name"]);
  });

  test("removing a row stops grouping by that attribute", () => {
    const onChange: OnChangeMock = jest.fn<(keys: Array<string>) => void>();

    render(
      <LogGroupByAttributesInput
        initialValue={["con_name", "gw_name"]}
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByTestId("remove-log-group-by-attribute-0"));

    expect(onChange).toHaveBeenLastCalledWith(["gw_name"]);
    expect(rowInput(0)).toHaveValue("gw_name");

    fireEvent.click(screen.getByTestId("remove-log-group-by-attribute-0"));

    // Back to "not grouped".
    expect(onChange).toHaveBeenLastCalledWith([]);
  });

  test(`stops offering more rows at ${MAX_LOG_MONITOR_GROUP_BY_ATTRIBUTES}`, () => {
    render(
      <LogGroupByAttributesInput
        initialValue={Array.from(
          { length: MAX_LOG_MONITOR_GROUP_BY_ATTRIBUTES },
          (_: unknown, index: number) => {
            return `key_${index}`;
          },
        )}
      />,
    );

    expect(
      screen.queryByTestId("add-log-group-by-attribute"),
    ).not.toBeInTheDocument();
  });

  test("offers the project's log attribute keys as suggestions", () => {
    render(
      <LogGroupByAttributesInput
        initialValue={["con_name", ""]}
        suggestions={["con_name", "gw_name", "log_component"]}
      />,
    );

    fireEvent.focus(rowInput(1));

    const menu: HTMLElement = screen.getByTestId(
      "log-group-by-attribute-1-suggestions",
    );

    // A key already grouped by is not offered a second time.
    expect(menu).toHaveTextContent("gw_name");
    expect(menu).toHaveTextContent("log_component");
    expect(menu).not.toHaveTextContent("con_name");
  });
});

describe("LogMonitorPreview with Group By", () => {
  function logMonitor(
    overrides?: Partial<MonitorStepLogMonitor>,
  ): MonitorStepLogMonitor {
    return {
      ...MonitorStepLogMonitorUtil.getDefault(),
      body: "terminated",
      attributes: { log_component: "IPSec" },
      ...overrides,
    };
  }

  test("says what grouping does, naming the attributes", () => {
    render(
      <LogMonitorPreview
        monitorStepLogMonitor={logMonitor({
          groupByAttributes: ["con_name", "gw_name"],
        })}
      />,
    );

    const summary: HTMLElement = screen.getByTestId(
      "log-monitor-group-by-summary",
    );

    expect(summary).toHaveTextContent("Grouped by con_name, gw_name");
    expect(summary).toHaveTextContent("raises its own alert or incident");
    expect(summary).toHaveTextContent("empty value");
  });

  test("shows no note for a monitor that is not grouped", () => {
    render(<LogMonitorPreview monitorStepLogMonitor={logMonitor()} />);

    expect(
      screen.queryByTestId("log-monitor-group-by-summary"),
    ).not.toBeInTheDocument();
  });

  test("editing the group-by keeps the same log query, so the list is not refetched", () => {
    const view: RenderResult = render(
      <LogMonitorPreview monitorStepLogMonitor={logMonitor()} />,
    );

    const first: unknown =
      mockLogsViewerProps[mockLogsViewerProps.length - 1]!["logQuery"];

    view.rerender(
      <LogMonitorPreview
        monitorStepLogMonitor={logMonitor({ groupByAttributes: ["con_name"] })}
      />,
    );

    expect(
      mockLogsViewerProps[mockLogsViewerProps.length - 1]!["logQuery"],
    ).toBe(first);
  });
});
