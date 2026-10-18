import "@testing-library/jest-dom";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The logs explorer's empty list, as the Logs page and an embed see it.
 *
 * The Logs page hands the explorer what to show in place of an empty list
 * that nothing narrows (emptyContentWhenUnfiltered): the first steps of a
 * project that may not be sending logs yet. A list a filter or a search
 * emptied keeps its "try adjusting filters" line, and a page that passes
 * nothing - a service's, a host's or an incident's logs - is unchanged.
 *
 * The default block is drawn as every other explorer draws an empty list (a
 * search icon, what is true, what to try): it was a boxed card of upper-case
 * monospace text, unlike any other empty list in the product.
 */

const getListMock: MockFunction = getJestMockFunction();
const postMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<any>) => {
        return getListMock(...args);
      },
      getCommonHeaders: () => {
        return {};
      },
    },
  };
});

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: (...args: Array<any>) => {
        return postMock(...args);
      },
      getFriendlyErrorMessage: (error: Error) => {
        return error.message;
      },
      getFriendlyMessage: (error: Error) => {
        return error.message;
      },
    },
  };
});

getListMock.mockImplementation(() => {
  return Promise.resolve({ data: [], count: 0, skip: 0, limit: 0 });
});

postMock.mockImplementation(() => {
  return Promise.resolve({ data: {} });
});

import LogsViewer, {
  isNarrowedByReader,
} from "../../../UI/Components/LogsViewer/LogsViewer";
import { LOGS_TABLE_TEST_ID } from "../../../UI/Components/LogsViewer/components/LogsTable";
import { LOGS_VIEWER_TOOLBAR_TEST_ID } from "../../../UI/Components/LogsViewer/components/LogsViewerToolbar";
import { ActiveFilter } from "../../../UI/Components/TelemetryViewer/types";
import Log from "../../../Models/AnalyticsModels/Log";
import LogSeverity from "../../../Types/Log/LogSeverity";
import TimeRange from "../../../Types/Time/TimeRange";

const FIRST_STEPS: React.ReactElement = (
  <div data-testid="page-first-steps">No logs here yet</div>
);

const SEVERITY_CHIP: ActiveFilter = {
  facetKey: "severityText",
  value: "Error",
  displayKey: "Severity",
  displayValue: "Error",
};

function makeLog(): Log {
  const log: Log = new Log();
  log.body = "request served";
  log.time = new Date(Date.UTC(2026, 9, 2, 7, 0, 0));
  log.severityText = LogSeverity.Information;
  return log;
}

async function renderLogs(props: {
  logs?: Array<Log> | undefined;
  isLoading?: boolean | undefined;
  firstSteps?: React.ReactElement | undefined;
  activeFilters?: Array<ActiveFilter> | undefined;
  noLogsMessage?: string | undefined;
}): Promise<HTMLElement> {
  const logs: Array<Log> = props.logs || [];

  render(
    <LogsViewer
      logs={logs}
      isLoading={props.isLoading || false}
      filterData={{}}
      onFilterChanged={jest.fn()}
      showFilters={true}
      page={1}
      pageSize={100}
      totalCount={logs.length}
      hasMore={false}
      onPageChange={jest.fn()}
      onPageSizeChange={jest.fn()}
      timeRange={{ range: TimeRange.PAST_ONE_HOUR }}
      activeFilters={props.activeFilters}
      noLogsMessage={props.noLogsMessage}
      emptyContentWhenUnfiltered={props.firstSteps}
    />,
  );

  await screen.findByTestId(LOGS_VIEWER_TOOLBAR_TEST_ID);

  return screen.getByTestId(LOGS_TABLE_TEST_ID);
}

afterEach(() => {
  cleanup();
});

describe("the Logs page's first steps in an empty explorer", () => {
  test("an empty list nothing narrows shows the page's first steps, not 'try adjusting filters'", async () => {
    const table: HTMLElement = await renderLogs({ firstSteps: FIRST_STEPS });

    expect(within(table).getByTestId("page-first-steps")).toBeInTheDocument();
    expect(within(table).queryByText("No logs found")).toBeNull();
    expect(table.textContent).not.toMatch(/adjusting filters/);
  });

  test("a filter chip that emptied the list keeps the 'try adjusting filters' line", async () => {
    const table: HTMLElement = await renderLogs({
      firstSteps: FIRST_STEPS,
      activeFilters: [SEVERITY_CHIP],
    });

    expect(within(table).queryByTestId("page-first-steps")).toBeNull();
    expect(within(table).getByText("No logs found")).toBeInTheDocument();
    expect(table.textContent).toMatch(/Try adjusting filters/);
  });

  test("a typed search keeps the 'try adjusting filters' line too", async () => {
    const table: HTMLElement = await renderLogs({ firstSteps: FIRST_STEPS });

    const search: HTMLElement = screen.getByPlaceholderText(
      /^Search logs\.\.\./,
    );
    fireEvent.change(search, { target: { value: "connection refused" } });

    expect(within(table).queryByTestId("page-first-steps")).toBeNull();
    expect(within(table).getByText("No logs found")).toBeInTheDocument();

    // Emptied again, the list is unnarrowed again.
    fireEvent.change(search, { target: { value: "" } });

    expect(within(table).getByTestId("page-first-steps")).toBeInTheDocument();
  });

  test("never over rows, and never while loading", async () => {
    const table: HTMLElement = await renderLogs({
      firstSteps: FIRST_STEPS,
      logs: [makeLog()],
    });

    expect(within(table).queryByTestId("page-first-steps")).toBeNull();
    expect(within(table).getByText("request served")).toBeInTheDocument();

    cleanup();

    const loading: HTMLElement = await renderLogs({
      firstSteps: FIRST_STEPS,
      isLoading: true,
    });

    expect(within(loading).queryByTestId("page-first-steps")).toBeNull();
    expect(within(loading).getByTestId("component-loader")).toBeInTheDocument();
  });

  test("a page that hands over nothing keeps its own message: an embed is unchanged", async () => {
    const table: HTMLElement = await renderLogs({
      noLogsMessage: "No logs found for this service.",
    });

    expect(within(table).queryByTestId("page-first-steps")).toBeNull();
    expect(within(table).getByText("No logs found")).toBeInTheDocument();
    expect(
      within(table).getByText("No logs found for this service."),
    ).toBeInTheDocument();
  });
});

describe("the default empty block", () => {
  test("is drawn like every other explorer's: an icon, what is true, what to try", async () => {
    const table: HTMLElement = await renderLogs({});

    const empty: HTMLElement = within(table).getByTestId("logs-table-empty");
    const title: HTMLElement = within(empty).getByText("No logs found");

    // Not the old boxed card of upper-case monospace text.
    expect(title).not.toHaveClass("uppercase");
    expect(title).not.toHaveClass("font-mono");
    expect(empty.querySelector(".shadow-sm")).toBeNull();
    expect(empty.querySelector("svg")).not.toBeNull();
    expect(title).toHaveClass("text-sm", "font-medium", "text-gray-500");
  });
});

describe("isNarrowedByReader", () => {
  test("a chip or a search narrows the list; blanks do not", () => {
    expect(
      isNarrowedByReader({ activeFilters: undefined, searchQuery: "" }),
    ).toBe(false);
    expect(isNarrowedByReader({ activeFilters: [], searchQuery: "   " })).toBe(
      false,
    );
    expect(
      isNarrowedByReader({ activeFilters: [SEVERITY_CHIP], searchQuery: "" }),
    ).toBe(true);
    expect(
      isNarrowedByReader({ activeFilters: [], searchQuery: "severity:error" }),
    ).toBe(true);
  });
});
