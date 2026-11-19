import Log from "../../../../Models/AnalyticsModels/Log";
import OpenedLogLine, {
  LogsViewerOpenedLog,
  OPENED_LOG_LINE_TEST_ID,
} from "../../../../UI/Components/LogsViewer/components/OpenedLogLine";
import { describe, expect, jest, test } from "@jest/globals";
import "@testing-library/jest-dom";
import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";

/*
 * One log line a link opened by its id (#9620), above the logs explorer's
 * list: the line in the panel a row opens; while it is read, its shape; a
 * line that is gone or not the reader's, said the same way, with the way
 * to close it; a read that failed, with Try again.
 */

function opened(
  overrides: Partial<LogsViewerOpenedLog> = {},
): LogsViewerOpenedLog {
  return {
    log: null,
    isLoading: false,
    isNotFound: false,
    error: "",
    onClose: jest.fn(),
    onRetry: jest.fn(),
    ...overrides,
  };
}

function renderOpened(state: LogsViewerOpenedLog): void {
  render(
    <OpenedLogLine
      opened={state}
      renderLog={(log: Log) => {
        return <p data-testid="opened-log-body">{String(log.body)}</p>;
      }}
    />,
  );
}

describe("the line a link opened", () => {
  test("draws the line in the panel a row opens, under its name", () => {
    const log: Log = new Log();
    log.body = "GET /api/w/admins/../../etc/passwd 404";

    renderOpened(opened({ log }));

    expect(screen.getByTestId(OPENED_LOG_LINE_TEST_ID)).toHaveTextContent(
      "Log line",
    );
    expect(screen.getByTestId("opened-log-body")).toHaveTextContent(
      "GET /api/w/admins/../../etc/passwd 404",
    );
  });

  test("while it is read, draws its shape, not a bar", () => {
    renderOpened(opened({ isLoading: true }));

    expect(screen.getByTestId(OPENED_LOG_LINE_TEST_ID)).toBeInTheDocument();
    expect(screen.queryByTestId("opened-log-body")).toBeNull();
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  test("a line that is gone or not the reader's is said the same way, and closes", () => {
    const state: LogsViewerOpenedLog = opened({ isNotFound: true });

    renderOpened(state);

    expect(
      screen.getByTestId("logs-viewer-opened-line-not-found"),
    ).toHaveTextContent(
      "This log line was not found. It may be past its retention, or in a service your role cannot read.",
    );

    fireEvent.click(screen.getByTestId("logs-viewer-opened-line-close"));

    expect(state.onClose).toHaveBeenCalledTimes(1);
  });

  test("a read that failed says why, with Try again, and still closes", () => {
    const state: LogsViewerOpenedLog = opened({
      error: "OneUptime could not be reached.",
    });

    renderOpened(state);

    const section: HTMLElement = screen.getByTestId(OPENED_LOG_LINE_TEST_ID);

    expect(section).toHaveTextContent("OneUptime could not be reached.");
    expect(screen.getByTestId("logs-viewer-opened-line-close")).toBeVisible();
  });
});
