/** @timezone UTC */

import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { cleanup, render, RenderResult } from "@testing-library/react";
import React, { ReactElement } from "react";

/*
 * The log monitor's preview, on the overview and in the criteria form. The
 * logs viewer is stubbed to record what it is handed. It resets its filters
 * and page, and refetches, whenever it is handed a new query object, and
 * the overview hands the preview a freshly read monitor on every poll. So
 * the query must be the same object until the filter itself changes, and
 * it must never carry the evaluation window toQuery() stamps (a window
 * frozen when the page opened empties out a minute later).
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

import LogMonitorPreview from "../../../../App/FeatureSet/Dashboard/src/Components/Monitor/LogMonitor/LogMonitorPreview";
import Log from "../../../Models/AnalyticsModels/Log";
import Includes from "../../../Types/BaseDatabase/Includes";
import Query from "../../../Types/BaseDatabase/Query";
import Search from "../../../Types/BaseDatabase/Search";
import LogSeverity from "../../../Types/Log/LogSeverity";
import MonitorStepLogMonitor, {
  MonitorStepLogMonitorUtil,
} from "../../../Types/Monitor/MonitorStepLogMonitor";
import ObjectID from "../../../Types/ObjectID";

const SERVICE_ID: string = "44444444-4444-4444-8444-444444444444";

// A new object on every call, as each poll's freshly read monitor is.
const logMonitor: (
  overrides?: Partial<MonitorStepLogMonitor>,
) => MonitorStepLogMonitor = (
  overrides?: Partial<MonitorStepLogMonitor>,
): MonitorStepLogMonitor => {
  return {
    ...MonitorStepLogMonitorUtil.getDefault(),
    body: "OutOfMemory",
    severityTexts: [LogSeverity.Error],
    telemetryServiceIds: [new ObjectID(SERVICE_ID)],
    attributes: { "k8s.namespace": "checkout" },
    lastXSecondsOfLogs: 300,
    ...overrides,
  };
};

const lastViewerProps: () => Record<string, unknown> = (): Record<
  string,
  unknown
> => {
  const props: Record<string, unknown> | undefined =
    mockLogsViewerProps[mockLogsViewerProps.length - 1];

  if (!props) {
    throw new Error("The logs viewer was never rendered");
  }

  return props;
};

const lastLogQuery: () => Query<Log> = (): Query<Log> => {
  return lastViewerProps()["logQuery"] as Query<Log>;
};

afterEach(() => {
  cleanup();
  mockLogsViewerProps.length = 0;
});

describe("LogMonitorPreview", () => {
  test("the log query has the monitor's filter but no time window", () => {
    // toQuery() itself does stamp the window: that is what must be removed.
    expect(
      Object.keys(MonitorStepLogMonitorUtil.toQuery(logMonitor())),
    ).toContain("time");

    render(<LogMonitorPreview monitorStepLogMonitor={logMonitor()} />);

    const query: Query<Log> = lastLogQuery();

    expect(Object.keys(query)).not.toContain("time");
    expect(query.body).toBeInstanceOf(Search);
    expect((query.body as Search<string>).toString()).toBe("OutOfMemory");
    expect(query.severityText).toBeInstanceOf(Includes);
    expect(query.primaryEntityId).toBeInstanceOf(Includes);
    expect(query.attributes).toEqual({ "k8s.namespace": "checkout" });
  });

  test("the viewer is a ten-row preview with its own empty message", () => {
    render(<LogMonitorPreview monitorStepLogMonitor={logMonitor()} />);

    const props: Record<string, unknown> = lastViewerProps();
    expect(props["id"]).toBe("logs-preview");
    expect(props["limit"]).toBe(10);
    expect(props["noLogsMessage"]).toBe("No logs found");
  });

  test("an equal log monitor keeps the same query object across re-renders", () => {
    const view: RenderResult = render(
      <LogMonitorPreview monitorStepLogMonitor={logMonitor()} />,
    );
    const first: Query<Log> = lastLogQuery();

    // A new object with the same content, as every poll hands down.
    view.rerender(<LogMonitorPreview monitorStepLogMonitor={logMonitor()} />);
    view.rerender(<LogMonitorPreview monitorStepLogMonitor={logMonitor()} />);

    expect(mockLogsViewerProps.length).toBeGreaterThan(2);
    for (const props of mockLogsViewerProps) {
      expect(props["logQuery"]).toBe(first);
    }
  });

  test("a changed filter hands the viewer a new query", () => {
    const view: RenderResult = render(
      <LogMonitorPreview monitorStepLogMonitor={logMonitor()} />,
    );
    const first: Query<Log> = lastLogQuery();

    view.rerender(
      <LogMonitorPreview
        monitorStepLogMonitor={logMonitor({ body: "Timeout" })}
      />,
    );
    const second: Query<Log> = lastLogQuery();

    expect(second).not.toBe(first);
    expect((second.body as Search<string>).toString()).toBe("Timeout");

    // So does a change the body text does not show: another service.
    view.rerender(
      <LogMonitorPreview
        monitorStepLogMonitor={logMonitor({
          body: "Timeout",
          telemetryServiceIds: [
            new ObjectID("55555555-5555-4555-8555-555555555555"),
          ],
        })}
      />,
    );

    expect(lastLogQuery()).not.toBe(second);
  });

  test("no log monitor gives an empty query", () => {
    render(<LogMonitorPreview monitorStepLogMonitor={undefined} />);

    expect(lastLogQuery()).toEqual({});
  });
});
