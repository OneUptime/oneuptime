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
 * The logs explorer's toolbar and footer never print the list endpoint's
 * lower bound as a total (issue #4202).
 *
 * The logs list endpoint skips COUNT(*): it answers with one page and
 * whether more logs follow, and the `count` it sends is a lower bound
 * (`skip + rows + 1`). The toolbar printed it as the total — "101 results ·
 * Page 1 of 2" over millions of logs — and the footer numbered two pages by
 * it, growing by one page per click. The total is now worked out apart from
 * the list (see UseResultTotal) and handed to LogsViewer as `resultTotal`:
 *
 *   - exact: "712,345 logs · Page 1 of 7,124", and the footer numbers pages;
 *   - counting: "Counting logs… · Page 1", and the footer pages forward on
 *     `hasMore` with no "of N";
 *   - unavailable: "100+ logs · <why>", the footer as while counting.
 *
 * The real LogsViewer is rendered, so the toolbar and footer read here are
 * the ones a person reads. The container loads services and log attributes
 * on mount, so both API surfaces are mocked out.
 */

/*
 * Declared before jest.mock but dereferenced inside the factories: ts-jest
 * hoists the jest.mock calls above these initializers, so naming the mocks
 * directly in a factory would capture undefined.
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

// Imported after the mocks so the container picks them up.
import LogsViewer from "../../../UI/Components/LogsViewer/LogsViewer";
import { LOGS_VIEWER_TOOLBAR_TEST_ID } from "../../../UI/Components/LogsViewer/components/LogsViewerToolbar";
import { TELEMETRY_RESULT_TOTAL_TEST_ID } from "../../../UI/Components/TelemetryViewer/components/TelemetryResultTotal";
import {
  ResultTotal,
  ResultTotalStatus,
  ResultTotalUnavailableReason,
} from "../../../UI/Utils/Telemetry/ResultTotal";
import Log from "../../../Models/AnalyticsModels/Log";
import LogSeverity from "../../../Types/Log/LogSeverity";

const PAGE_SIZE: number = 100;

const TOO_MANY_TO_COUNT: string =
  "Too many to count in time. Narrow the time range for an exact total.";
const COUNT_FAILED: string = "The total could not be counted.";

const EXACT: (count: number) => ResultTotal = (count: number): ResultTotal => {
  return { status: ResultTotalStatus.Exact, count: count };
};

const COUNTING: ResultTotal = { status: ResultTotalStatus.Counting };

const UNAVAILABLE: (reason: ResultTotalUnavailableReason) => ResultTotal = (
  reason: ResultTotalUnavailableReason,
): ResultTotal => {
  return { status: ResultTotalStatus.Unavailable, unavailableReason: reason };
};

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

interface RenderedViewer {
  onPageChange: MockFunction;
}

interface RenderOptions {
  /*
   * Leave paging to the viewer itself (no page, page size or handlers), the
   * way a host that hands it every log does.
   */
  isClientPaged?: boolean;
}

async function renderViewer(
  props: Partial<React.ComponentProps<typeof LogsViewer>>,
  options: RenderOptions = {},
): Promise<RenderedViewer> {
  const onPageChange: MockFunction = getJestMockFunction();

  render(
    <LogsViewer
      logs={[]}
      isLoading={false}
      filterData={{}}
      onFilterChanged={jest.fn()}
      showFilters={true}
      {...(options.isClientPaged
        ? {}
        : {
            page: 1,
            pageSize: PAGE_SIZE,
            onPageChange: onPageChange,
            onPageSizeChange: jest.fn(),
          })}
      {...props}
    />,
  );

  // The container renders a loader until its service lookup resolves.
  await screen.findByTestId(LOGS_VIEWER_TOOLBAR_TEST_ID);

  return { onPageChange: onPageChange };
}

function toolbar(): HTMLElement {
  return screen.getByTestId(LOGS_VIEWER_TOOLBAR_TEST_ID);
}

function toolbarText(): string {
  return toolbar().textContent || "";
}

function resultTotal(): HTMLElement {
  return within(toolbar()).getByTestId(TELEMETRY_RESULT_TOTAL_TEST_ID);
}

// The toolbar's "Page 1 of 7,124" (or "Page 1"), or null when there is none.
function toolbarPage(): string | null {
  const page: HTMLElement | null = within(toolbar()).queryByText(/^Page /);
  return page ? page.textContent : null;
}

function footer(): HTMLElement {
  return screen.getByTestId("logs-pagination");
}

function footerSummary(): string {
  return within(footer()).getByTestId("pagination-summary").textContent || "";
}

function pageButtons(): Array<string> {
  return within(footer())
    .queryAllByTestId(/^pagination-page-/)
    .map((button: HTMLElement): string => {
      return button.textContent || "";
    });
}

function nextButton(): HTMLButtonElement {
  return within(footer()).getByTestId(
    "pagination-next-button",
  ) as HTMLButtonElement;
}

afterEach(() => {
  cleanup();
});

describe("REGRESSION (#4202): the list endpoint's lower bound is never printed as a total", () => {
  test("a first page of 100 with more behind it, while the total is counted, never reads '101 results' or 'Page 1 of 2'", async () => {
    // What the explorer passes: the endpoint's count (100 + 1 probe row).
    await renderViewer({
      logs: makeLogs(100),
      totalCount: 101,
      hasMore: true,
      resultTotal: COUNTING,
    });

    expect(toolbarText()).not.toContain("101 results");
    expect(toolbarText()).not.toContain("101");
    expect(toolbarText()).not.toContain("Page 1 of 2");
    expect(footerSummary()).not.toContain("of 101");
    expect(pageButtons()).toEqual([]);
  });

  test("on page 2 the bound grows to 201, and still is not printed as a total", async () => {
    await renderViewer({
      logs: makeLogs(100),
      page: 2,
      totalCount: 201,
      hasMore: true,
      resultTotal: COUNTING,
    });

    expect(toolbarText()).not.toContain("201");
    expect(toolbarText()).not.toContain("Page 2 of 3");
    expect(footerSummary()).toBe("Showing 101-200+ logs");
    expect(pageButtons()).toEqual([]);
  });

  /*
   * A caller that says only "more logs follow" — no result total — has the
   * same lower bound in totalCount. The footer already pages on hasMore for
   * it; the toolbar must not read that bound as "101 results" either.
   */
  test("without a result total, a page with more behind it does not read '101 results' in the toolbar", async () => {
    await renderViewer({
      logs: makeLogs(100),
      totalCount: 101,
      hasMore: true,
    });

    expect(footerSummary()).toBe("Showing 1-100+ logs");
    expect(toolbarText()).not.toContain("Page 1 of 2");
    expect(toolbarText()).not.toContain("101 results");
    // What it can say: the logs shown so far, as a lower bound.
    expect(toolbarText()).toContain("100+ results");
    expect(toolbarText()).toContain("Page 1");
  });
});

describe("an exact total", () => {
  test("the toolbar reads '712,345 logs · Page 1 of 7,124' and the footer numbers the pages by it", async () => {
    await renderViewer({
      logs: makeLogs(100),
      totalCount: 101,
      hasMore: true,
      resultTotal: EXACT(712345),
    });

    expect(resultTotal()).toHaveAttribute("data-status", "exact");
    expect(resultTotal()).toHaveTextContent(/^712,345 logs$/);
    expect(toolbarPage()).toBe("Page 1 of 7,124");
    expect(toolbarText()).not.toContain("results");

    expect(footerSummary()).toBe("Showing 1-100 of 712,345 logs");
    expect(pageButtons()).toEqual(["1", "2", "3", "7,124"]);
    expect(
      within(footer()).getByTestId("pagination-ellipsis-end"),
    ).toBeInTheDocument();
    expect(nextButton()).not.toBeDisabled();
  });

  test("on page 3 the footer reads 201-300 of the total", async () => {
    await renderViewer({
      logs: makeLogs(100),
      page: 3,
      totalCount: 301,
      hasMore: true,
      resultTotal: EXACT(712345),
    });

    expect(toolbarPage()).toBe("Page 3 of 7,124");
    expect(footerSummary()).toBe("Showing 201-300 of 712,345 logs");
    expect(within(footer()).getByTestId("pagination-page-3")).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  test("a number on the footer goes to that page", async () => {
    const { onPageChange } = await renderViewer({
      logs: makeLogs(100),
      totalCount: 101,
      hasMore: true,
      resultTotal: EXACT(712345),
    });

    fireEvent.click(within(footer()).getByTestId("pagination-page-7124"));

    expect(onPageChange).toHaveBeenCalledWith(7124);
  });

  test("one log reads '1 log', singular", async () => {
    await renderViewer({
      logs: makeLogs(1),
      totalCount: 1,
      hasMore: false,
      resultTotal: EXACT(1),
    });

    expect(resultTotal()).toHaveTextContent(/^1 log$/);
    expect(toolbarPage()).toBe("Page 1 of 1");
    expect(footerSummary()).toBe("Showing 1 of 1 log");
  });

  test("a total that ends on this page disables Next", async () => {
    await renderViewer({
      logs: makeLogs(30),
      totalCount: 30,
      hasMore: false,
      resultTotal: EXACT(30),
    });

    expect(resultTotal()).toHaveTextContent(/^30 logs$/);
    expect(footerSummary()).toBe("Showing 1-30 of 30 logs");
    expect(pageButtons()).toEqual(["1"]);
    expect(nextButton()).toBeDisabled();
  });
});

describe("a total still being counted", () => {
  test("says so, and the footer pages forward with no 'of N' and no page numbers", async () => {
    const { onPageChange } = await renderViewer({
      logs: makeLogs(100),
      totalCount: 101,
      hasMore: true,
      resultTotal: COUNTING,
    });

    expect(resultTotal()).toHaveAttribute("data-status", "counting");
    expect(resultTotal()).toHaveTextContent(/^Counting logs…$/);
    expect(toolbarPage()).toBe("Page 1");

    expect(footerSummary()).toBe("Showing 1-100+ logs");
    expect(pageButtons()).toEqual([]);
    expect(nextButton()).not.toBeDisabled();

    fireEvent.click(nextButton());
    expect(onPageChange).toHaveBeenCalledWith(2);
  });

  /*
   * With a result total that is not exact the footer pages on hasMore, so a
   * page the endpoint says nothing follows has no Next — and still no "of N"
   * until the total itself is exact.
   */
  test("pages on hasMore: nothing after this page disables Next", async () => {
    await renderViewer({
      logs: makeLogs(30),
      totalCount: 30,
      hasMore: false,
      resultTotal: COUNTING,
    });

    expect(footerSummary()).toBe("Showing 1-30 logs");
    expect(pageButtons()).toEqual([]);
    expect(nextButton()).toBeDisabled();
  });
});

describe("a total that could not be counted", () => {
  test("too many to count: '100+ logs' and what to do about it", async () => {
    await renderViewer({
      logs: makeLogs(100),
      totalCount: 101,
      hasMore: true,
      resultTotal: UNAVAILABLE(ResultTotalUnavailableReason.TooManyToCount),
    });

    expect(resultTotal()).toHaveAttribute("data-status", "unavailable");
    expect(resultTotal()).toHaveTextContent(`100+ logs · ${TOO_MANY_TO_COUNT}`);
    expect(toolbarPage()).toBe("Page 1");
    expect(footerSummary()).toBe("Showing 1-100+ logs");
    expect(pageButtons()).toEqual([]);
    expect(nextButton()).not.toBeDisabled();
  });

  test("a failed count: '100+ logs' and that it could not be counted", async () => {
    await renderViewer({
      logs: makeLogs(100),
      totalCount: 101,
      hasMore: true,
      resultTotal: UNAVAILABLE(ResultTotalUnavailableReason.CountFailed),
    });

    expect(resultTotal()).toHaveTextContent(`100+ logs · ${COUNT_FAILED}`);
  });

  test("a status with no reason is explained as a failed count", async () => {
    await renderViewer({
      logs: makeLogs(100),
      totalCount: 101,
      hasMore: true,
      resultTotal: { status: ResultTotalStatus.Unavailable },
    });

    expect(resultTotal()).toHaveTextContent(`100+ logs · ${COUNT_FAILED}`);
  });

  test("on page 2 it vouches for the 200 logs shown so far", async () => {
    await renderViewer({
      logs: makeLogs(100),
      page: 2,
      totalCount: 201,
      hasMore: true,
      resultTotal: UNAVAILABLE(ResultTotalUnavailableReason.TooManyToCount),
    });

    expect(resultTotal()).toHaveTextContent(`200+ logs · ${TOO_MANY_TO_COUNT}`);
    expect(toolbarPage()).toBe("Page 2");
    expect(footerSummary()).toBe("Showing 101-200+ logs");
  });
});

describe("callers that pass no result total keep their old toolbar and footer", () => {
  test("client-side paging (no totalCount): 'N results · Page 1 of 1'", async () => {
    await renderViewer({ logs: makeLogs(30) }, { isClientPaged: true });

    expect(
      within(toolbar()).queryByTestId(TELEMETRY_RESULT_TOTAL_TEST_ID),
    ).toBeNull();
    expect(toolbarText()).toContain("30 results");
    expect(toolbarPage()).toBe("Page 1 of 1");
    expect(footerSummary()).toBe("Showing 1-30 of 30 logs");
  });

  test("an exact totalCount (no hasMore): 'N results · Page X of Y' and numbered pages", async () => {
    await renderViewer({
      logs: makeLogs(100),
      page: 2,
      totalCount: 250,
    });

    expect(
      within(toolbar()).queryByTestId(TELEMETRY_RESULT_TOTAL_TEST_ID),
    ).toBeNull();
    expect(toolbarText()).toContain("250 results");
    expect(toolbarPage()).toBe("Page 2 of 3");
    expect(footerSummary()).toBe("Showing 101-200 of 250 logs");
    expect(pageButtons()).toEqual(["1", "2", "3"]);
  });

  test("one result reads '1 result'", async () => {
    await renderViewer({
      logs: makeLogs(1),
      totalCount: 1,
    });

    expect(toolbarText()).toContain("1 result");
    expect(toolbarText()).not.toContain("1 results");
  });
});

describe("hasMore without a result total", () => {
  test("a page that ends the list proves the total, and the footer numbers by it", async () => {
    await renderViewer({
      logs: makeLogs(30),
      totalCount: 30,
      hasMore: false,
    });

    expect(footerSummary()).toBe("Showing 1-30 of 30 logs");
    expect(pageButtons()).toEqual(["1"]);
    expect(nextButton()).toBeDisabled();
    expect(toolbarPage()).toBe("Page 1 of 1");
  });

  test("the last page of several proves the total too", async () => {
    await renderViewer({
      logs: makeLogs(40),
      page: 3,
      totalCount: 240,
      hasMore: false,
    });

    expect(footerSummary()).toBe("Showing 201-240 of 240 logs");
    expect(pageButtons()).toEqual(["1", "2", "3"]);
  });

  test("a page with more behind it pages forward on hasMore", async () => {
    await renderViewer({
      logs: makeLogs(100),
      totalCount: 101,
      hasMore: true,
    });

    expect(footerSummary()).toBe("Showing 1-100+ logs");
    expect(pageButtons()).toEqual([]);
    expect(nextButton()).not.toBeDisabled();
  });

  /*
   * An old link to a page past what is now the end holds nothing; the rows
   * before it are then not known to be `skip`, so no total is claimed.
   */
  test("an empty page past the end proves nothing and claims no total", async () => {
    await renderViewer({
      logs: [],
      page: 5,
      totalCount: 400,
      hasMore: false,
    });

    expect(footerSummary()).toBe("No logs");
    expect(pageButtons()).toEqual([]);
    expect(nextButton()).toBeDisabled();
  });
});
