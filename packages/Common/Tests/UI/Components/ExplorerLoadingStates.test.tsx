/** @timezone UTC */
/**
 * What the explorers show while their first answers are out (issue #4709).
 *
 * The logs explorer now waits for a saved view to apply before it reads its
 * list, chart and facets, and the Exceptions and Metrics explorers hold
 * their reads until a `@service:` token's names are in. Those loading states
 * last longer than they did, so they have to read as loading, everywhere on
 * screen at once:
 *
 *   - the list footer says "Loading..." while nothing is on screen, never
 *     "No logs" or "No exceptions" under a loader;
 *   - the logs list gives its loader the room its rows will take, as the
 *     other explorers' lists do, rather than a strip over the headings;
 *   - the shared facet sidebar shows its loader alone while there is nothing
 *     to list, never "No values in this time range" under every facet that
 *     has not been read - a host can hand a key over before its values (the
 *     Exceptions explorer counts error classes itself).
 *
 * Rows already on screen keep their range while the next page loads, and
 * an answer that really is empty still says so.
 */
import "@testing-library/jest-dom";
import {
  cleanup,
  fireEvent,
  render,
  RenderResult,
  screen,
  within,
} from "@testing-library/react";
import React, { ReactElement } from "react";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * Declared before jest.mock but dereferenced inside the factories: ts-jest
 * hoists the jest.mock calls above these initializers.
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

// Imported after the mocks so the containers pick them up.
import LogsViewer from "../../../UI/Components/LogsViewer/LogsViewer";
import LogsPagination from "../../../UI/Components/LogsViewer/components/LogsPagination";
import { LOGS_TABLE_TEST_ID } from "../../../UI/Components/LogsViewer/components/LogsTable";
import { LOGS_VIEWER_TOOLBAR_TEST_ID } from "../../../UI/Components/LogsViewer/components/LogsViewerToolbar";
import TelemetryViewer from "../../../UI/Components/TelemetryViewer/TelemetryViewer";
import TelemetryPagination from "../../../UI/Components/TelemetryViewer/components/TelemetryPagination";
import TelemetryFacetSidebar, {
  TELEMETRY_FACET_SIDEBAR_LOADER_TEST_ID,
} from "../../../UI/Components/TelemetryViewer/components/TelemetryFacetSidebar";
import {
  FacetConfig,
  FacetData,
} from "../../../UI/Components/TelemetryViewer/types";
import Log from "../../../Models/AnalyticsModels/Log";
import LogSeverity from "../../../Types/Log/LogSeverity";
import TimeRange from "../../../Types/Time/TimeRange";

const NO_VALUES: string = "No values in this time range";

function summaryOf(footer: HTMLElement): string {
  return within(footer).getByTestId("pagination-summary").textContent || "";
}

afterEach(() => {
  cleanup();
});

describe("the list footer while nothing is on screen", () => {
  function logsFooter(props: {
    isLoading?: boolean;
    isDisabled?: boolean;
    totalItems?: number;
  }): HTMLElement {
    render(
      <LogsPagination
        currentPage={2}
        totalItems={props.totalItems ?? 0}
        pageSize={100}
        pageSizeOptions={[100, 250]}
        hasMore={false}
        itemsOnCurrentPage={0}
        onPageChange={() => {}}
        onPageSizeChange={() => {}}
        isLoading={props.isLoading}
        isDisabled={props.isDisabled}
      />,
    );
    return screen.getByTestId("logs-pagination");
  }

  test("the logs footer says it is loading, not that there are no logs", () => {
    const footer: HTMLElement = logsFooter({
      isLoading: true,
      isDisabled: true,
    });

    expect(summaryOf(footer)).toBe("Loading...");
    expect(footer).not.toHaveTextContent("No logs");
    // Nothing to page through yet.
    expect(within(footer).getByTestId("pagination-next-button")).toBeDisabled();
    expect(
      within(footer).getByTestId("pagination-items-on-page-select"),
    ).toBeDisabled();
  });

  test("an answer with no logs still says so", () => {
    expect(summaryOf(logsFooter({}))).toBe("No logs");
  });

  test("the telemetry footer says it is loading, in no one's words but its own", () => {
    render(
      <TelemetryPagination
        currentPage={1}
        totalItems={0}
        pageSize={50}
        pageSizeOptions={[50]}
        onPageChange={() => {}}
        onPageSizeChange={() => {}}
        itemLabel="exceptions"
        isLoading={true}
        isDisabled={true}
      />,
    );

    const footer: HTMLElement = screen.getByTestId("telemetry-pagination");
    expect(summaryOf(footer)).toBe("Loading...");
    expect(footer).not.toHaveTextContent("No exceptions");
  });

  test("an empty telemetry answer still says so", () => {
    render(
      <TelemetryPagination
        currentPage={1}
        totalItems={0}
        pageSize={50}
        pageSizeOptions={[50]}
        onPageChange={() => {}}
        onPageSizeChange={() => {}}
        itemLabel="exceptions"
      />,
    );

    expect(summaryOf(screen.getByTestId("telemetry-pagination"))).toBe(
      "No exceptions",
    );
  });
});

describe("the logs explorer's list while it loads", () => {
  function makeLogs(count: number): Array<Log> {
    const logs: Array<Log> = [];

    for (let index: number = 0; index < count; index++) {
      const log: Log = new Log();
      log.body = `request ${index} served`;
      log.time = new Date(Date.UTC(2026, 9, 2, 7, 0, 0) - index * 1000);
      log.severityText = LogSeverity.Information;
      logs.push(log);
    }

    return logs;
  }

  async function renderLogs(props: {
    logs: Array<Log>;
    isLoading: boolean;
  }): Promise<void> {
    render(
      <LogsViewer
        logs={props.logs}
        isLoading={props.isLoading}
        filterData={{}}
        onFilterChanged={jest.fn()}
        showFilters={true}
        page={1}
        pageSize={100}
        totalCount={props.logs.length}
        hasMore={false}
        onPageChange={jest.fn()}
        onPageSizeChange={jest.fn()}
        timeRange={{ range: TimeRange.PAST_ONE_HOUR }}
      />,
    );

    // The container renders a loader until its service lookup resolves.
    await screen.findByTestId(LOGS_VIEWER_TOOLBAR_TEST_ID);
  }

  test("the first page: a loader with room for the rows, and a footer that says Loading...", async () => {
    await renderLogs({ logs: [], isLoading: true });

    const table: HTMLElement = screen.getByTestId(LOGS_TABLE_TEST_ID);
    expect(table).toHaveClass("min-h-48");
    expect(within(table).getByTestId("component-loader")).toBeInTheDocument();
    expect(within(table).queryByText("No logs found")).toBeNull();
    expect(summaryOf(screen.getByTestId("logs-pagination"))).toBe("Loading...");
  });

  test("the next page loading over rows on screen: the rows keep their range and their height", async () => {
    await renderLogs({ logs: makeLogs(2), isLoading: true });

    const table: HTMLElement = screen.getByTestId(LOGS_TABLE_TEST_ID);
    expect(table).not.toHaveClass("min-h-48");
    expect(within(table).getByTestId("component-loader")).toBeInTheDocument();
    expect(summaryOf(screen.getByTestId("logs-pagination"))).toBe(
      "Showing 1-2 of 2 logs",
    );
  });

  test("an answer with no logs: the empty state and 'No logs', no loader", async () => {
    await renderLogs({ logs: [], isLoading: false });

    const table: HTMLElement = screen.getByTestId(LOGS_TABLE_TEST_ID);
    expect(table).not.toHaveClass("min-h-48");
    expect(within(table).queryByTestId("component-loader")).toBeNull();
    expect(within(table).getByText("No logs found")).toBeInTheDocument();
    expect(summaryOf(screen.getByTestId("logs-pagination"))).toBe("No logs");
  });
});

describe("the telemetry explorers' list while it loads", () => {
  interface Item {
    id: string;
  }

  function renderTelemetry(props: {
    items: Array<Item>;
    isLoading: boolean;
  }): void {
    render(
      <TelemetryViewer<Item>
        items={props.items}
        isLoading={props.isLoading}
        renderRow={(item: Item): ReactElement => {
          return <span>{item.id}</span>;
        }}
        getRowKey={(item: Item): string => {
          return item.id;
        }}
        searchValue=""
        onSearchChange={(): void => {}}
        onSearchSubmit={(): void => {}}
        timeRange={{ range: TimeRange.PAST_ONE_HOUR }}
        onTimeRangeChange={(): void => {}}
        page={1}
        pageSize={50}
        totalCount={props.items.length}
        onPageChange={(): void => {}}
        onPageSizeChange={(): void => {}}
        itemLabel="exceptions"
        emptyMessage="No exceptions found"
      />,
    );
  }

  test("the first page: the loader, and a footer that says Loading...", () => {
    renderTelemetry({ items: [], isLoading: true });

    expect(screen.getByTestId("component-loader")).toBeInTheDocument();
    expect(screen.queryByText("No exceptions found")).toBeNull();
    expect(summaryOf(screen.getByTestId("telemetry-pagination"))).toBe(
      "Loading...",
    );
  });

  test("rows on screen keep their range while the next read is out", () => {
    renderTelemetry({
      items: [{ id: "row-1" }, { id: "row-2" }],
      isLoading: true,
    });

    expect(screen.getByText("row-1")).toBeInTheDocument();
    expect(summaryOf(screen.getByTestId("telemetry-pagination"))).toBe(
      "Showing 1-2 of 2 exceptions",
    );
  });

  test("an answer with no rows: the empty state and 'No exceptions'", () => {
    renderTelemetry({ items: [], isLoading: false });

    expect(screen.getByText("No exceptions found")).toBeInTheDocument();
    expect(summaryOf(screen.getByTestId("telemetry-pagination"))).toBe(
      "No exceptions",
    );
  });
});

describe("the facet sidebar while there is nothing to list", () => {
  const CONFIGS: Array<FacetConfig> = [
    {
      key: "primaryEntityId",
      title: "Service",
      priority: 1,
      serverSearchable: true,
    },
    { key: "exceptionType", title: "Exception Type", priority: 2 },
    { key: "errorClass", title: "Error Class", priority: 3 },
  ];

  // The Exceptions explorer's error-class key, handed over before its values.
  const KEYS_WITHOUT_VALUES: FacetData = { errorClass: [] };

  const WITH_VALUES: FacetData = {
    primaryEntityId: [{ value: "svc-1", count: 4, displayName: "checkout" }],
    exceptionType: [],
    errorClass: [],
  };

  function sidebar(props: {
    facetData: FacetData;
    isLoading: boolean;
  }): ReactElement {
    return (
      <TelemetryFacetSidebar
        facetData={props.facetData}
        facetConfigs={CONFIGS}
        isLoading={props.isLoading}
        onIncludeFilter={jest.fn()}
        onExcludeFilter={jest.fn()}
        onFacetSearchChange={jest.fn()}
      />
    );
  }

  function sectionHeading(title: string): HTMLElement | null {
    return screen.queryByRole("button", { name: new RegExp(`^${title}`) });
  }

  test("a held or first read: the loader alone, and no facet says it has no values", () => {
    render(sidebar({ facetData: KEYS_WITHOUT_VALUES, isLoading: true }));

    expect(
      screen.getByTestId(TELEMETRY_FACET_SIDEBAR_LOADER_TEST_ID),
    ).toBeInTheDocument();
    expect(screen.queryByText(NO_VALUES)).toBeNull();
    expect(sectionHeading("Service")).toBeNull();
    expect(sectionHeading("Error Class")).toBeNull();
    // Still the sidebar: its heading stays.
    expect(screen.getByText("Filters")).toBeInTheDocument();
  });

  test("the first read of a host that hands over nothing: the loader alone", () => {
    render(sidebar({ facetData: {}, isLoading: true }));

    expect(
      screen.getByTestId(TELEMETRY_FACET_SIDEBAR_LOADER_TEST_ID),
    ).toBeInTheDocument();
    expect(screen.queryByText(NO_VALUES)).toBeNull();
  });

  test("values on screen stay while the next read is out, with no loader over them", () => {
    render(sidebar({ facetData: WITH_VALUES, isLoading: true }));

    expect(
      screen.queryByTestId(TELEMETRY_FACET_SIDEBAR_LOADER_TEST_ID),
    ).toBeNull();
    expect(screen.getByText("checkout")).toBeInTheDocument();
    expect(sectionHeading("Error Class")).toBeInTheDocument();
  });

  test("the answer lands: every facet, and an empty one says so", () => {
    const view: RenderResult = render(
      sidebar({ facetData: KEYS_WITHOUT_VALUES, isLoading: true }),
    );

    view.rerender(
      sidebar({ facetData: KEYS_WITHOUT_VALUES, isLoading: false }),
    );

    expect(
      screen.queryByTestId(TELEMETRY_FACET_SIDEBAR_LOADER_TEST_ID),
    ).toBeNull();
    expect(sectionHeading("Service")).toBeInTheDocument();
    expect(sectionHeading("Exception Type")).toBeInTheDocument();
    expect(sectionHeading("Error Class")).toBeInTheDocument();
    expect(screen.getAllByText(NO_VALUES).length).toBeGreaterThan(0);
  });

  test("a facet the reader is searching keeps its box while its answer is out", () => {
    const view: RenderResult = render(
      sidebar({ facetData: KEYS_WITHOUT_VALUES, isLoading: false }),
    );

    const box: HTMLElement = screen.getByRole("textbox", {
      name: "Search Service",
    });
    box.focus();
    fireEvent.change(box, { target: { value: "check" } });

    // The search goes out; nothing has values yet.
    view.rerender(sidebar({ facetData: KEYS_WITHOUT_VALUES, isLoading: true }));

    expect(
      screen.queryByTestId(TELEMETRY_FACET_SIDEBAR_LOADER_TEST_ID),
    ).toBeNull();
    const sameBox: HTMLElement = screen.getByRole("textbox", {
      name: "Search Service",
    });
    expect(sameBox).toBe(box);
    expect(sameBox).toHaveValue("check");
    expect(sameBox).toHaveFocus();
  });
});
