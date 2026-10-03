import { afterEach, describe, expect, test } from "@jest/globals";
import "@testing-library/jest-dom";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../../MockType";
import TelemetryViewer from "../../../../UI/Components/TelemetryViewer/TelemetryViewer";
import { TELEMETRY_RESULT_TOTAL_TEST_ID } from "../../../../UI/Components/TelemetryViewer/components/TelemetryResultTotal";
import {
  ResultTotal,
  ResultTotalStatus,
  ResultTotalUnavailableReason,
} from "../../../../UI/Utils/Telemetry/ResultTotal";
import TimeRange from "../../../../Types/Time/TimeRange";

/*
 * The shared telemetry shell's result total and footer (issue #4202).
 *
 * The traces explorer read its total off an analytics list endpoint that
 * answers `skip + rows + 1`, so the only count on the page was "Showing 1-50
 * of 51 traces" over hundreds of thousands of spans, under a pager of two
 * pages that grew by one per click. The shell now opens the list with the
 * real total and numbers pages only by an exact one; until then the footer
 * pages forward on `hasMore` and claims nothing it does not know.
 *
 * The shell has four consumers, so the Postgres-backed ones (Metrics,
 * Exceptions), which pass an exact count and nothing else, are pinned
 * unchanged too.
 */

interface Item {
  id: string;
}

const rows: (count: number, from?: number) => Array<Item> = (
  count: number,
  from: number = 0,
): Array<Item> => {
  return Array.from({ length: count }, (_: unknown, index: number): Item => {
    return { id: `span-${from + index}` };
  });
};

const exact: (count: number) => ResultTotal = (count: number): ResultTotal => {
  return { status: ResultTotalStatus.Exact, count };
};

const COUNTING: ResultTotal = { status: ResultTotalStatus.Counting };

const TOO_MANY: ResultTotal = {
  status: ResultTotalStatus.Unavailable,
  unavailableReason: ResultTotalUnavailableReason.TooManyToCount,
};

const FAILED: ResultTotal = {
  status: ResultTotalStatus.Unavailable,
  unavailableReason: ResultTotalUnavailableReason.CountFailed,
};

function renderViewer(
  props: Partial<React.ComponentProps<typeof TelemetryViewer<Item>>> = {},
): void {
  render(
    <TelemetryViewer<Item>
      items={rows(50)}
      isLoading={false}
      renderRow={(item: Item): React.ReactElement => {
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
      // What the analytics list endpoint answers: a lower bound.
      totalCount={51}
      hasMore={true}
      onPageChange={(): void => {}}
      onPageSizeChange={(): void => {}}
      itemLabel="spans"
      {...props}
    />,
  );
}

const resultTotal: () => HTMLElement | null = (): HTMLElement | null => {
  return screen.queryByTestId(TELEMETRY_RESULT_TOTAL_TEST_ID);
};

const footerSummary: () => string = (): string => {
  return screen.getByTestId("pagination-summary").textContent || "";
};

const pageButtons: () => Array<string> = (): Array<string> => {
  return screen
    .queryAllByTestId(/^pagination-page-\d+$/)
    .map((button: HTMLElement): string => {
      return button.textContent || "";
    });
};

afterEach(() => {
  cleanup();
});

describe("REGRESSION (#4202): the list endpoint's lower bound is never printed as a total", () => {
  test("50 rows, a count of 51 and more to come: no 'of 51', no pager of two pages", () => {
    renderViewer({ resultTotal: COUNTING });

    expect(footerSummary()).toBe("Showing 1-50+ spans");
    expect(screen.getByTestId("telemetry-pagination").textContent).not.toMatch(
      /of 51/,
    );
    expect(pageButtons()).toEqual([]);
    expect(resultTotal()?.textContent).not.toMatch(/51/);
  });

  test("the same, from a caller that only passes hasMore (no result total)", () => {
    renderViewer();

    expect(footerSummary()).toBe("Showing 1-50+ spans");
    expect(pageButtons()).toEqual([]);
    expect(resultTotal()).toBeNull();
  });

  test("page 2's count of 101 is not a total either", () => {
    renderViewer({
      page: 2,
      items: rows(50, 50),
      totalCount: 101,
      resultTotal: COUNTING,
    });

    expect(footerSummary()).toBe("Showing 51-100+ spans");
    expect(pageButtons()).toEqual([]);
  });
});

describe("an exact total", () => {
  test("opens the list, and the footer numbers its pages by it", () => {
    renderViewer({ resultTotal: exact(712345) });

    const total: HTMLElement | null = resultTotal();
    expect(total?.textContent).toBe("712,345 spans");
    expect(total).toHaveAttribute("data-status", ResultTotalStatus.Exact);

    expect(footerSummary()).toBe("Showing 1-50 of 712,345 spans");
    expect(pageButtons()).toEqual(["1", "2", "3", "14,247"]);
    expect(screen.getByTestId("pagination-next-button")).not.toBeDisabled();
  });

  test("on a later page the range moves and the total stays", () => {
    renderViewer({
      page: 3,
      items: rows(50, 100),
      totalCount: 151,
      resultTotal: exact(712345),
    });

    expect(resultTotal()?.textContent).toBe("712,345 spans");
    expect(footerSummary()).toBe("Showing 101-150 of 712,345 spans");
  });

  test("the last page shows the rows it holds and offers no Next", () => {
    renderViewer({
      page: 3,
      items: rows(20, 100),
      totalCount: 120,
      hasMore: false,
      resultTotal: exact(120),
    });

    expect(footerSummary()).toBe("Showing 101-120 of 120 spans");
    expect(screen.getByTestId("pagination-next-button")).toBeDisabled();
  });

  test("one row reads in the singular", () => {
    renderViewer({
      items: rows(1),
      totalCount: 1,
      hasMore: false,
      resultTotal: exact(1),
    });

    expect(resultTotal()?.textContent).toBe("1 span");
    expect(footerSummary()).toBe("Showing 1 of 1 span");
  });

  test("the noun is the caller's: a root-spans-only list counts traces", () => {
    renderViewer({ itemLabel: "traces", resultTotal: exact(68811) });

    expect(resultTotal()?.textContent).toBe("68,811 traces");
    expect(footerSummary()).toBe("Showing 1-50 of 68,811 traces");
  });

  test("a page number in the footer navigates to that page", () => {
    const onPageChange: MockFunction = getJestMockFunction();
    renderViewer({
      resultTotal: exact(712345),
      onPageChange: onPageChange as unknown as (page: number) => void,
    });

    fireEvent.click(screen.getByTestId("pagination-page-14247"));

    expect(onPageChange).toHaveBeenCalledWith(14247);
  });
});

describe("while counting", () => {
  test("says so, and the footer pages forward without numbers", () => {
    const onPageChange: MockFunction = getJestMockFunction();
    renderViewer({
      resultTotal: COUNTING,
      onPageChange: onPageChange as unknown as (page: number) => void,
    });

    const total: HTMLElement | null = resultTotal();
    expect(total?.textContent).toBe("Counting spans…");
    expect(total).toHaveAttribute("data-status", ResultTotalStatus.Counting);
    expect(
      screen.getByTestId("pagination-current-page-indicator-desktop"),
    ).toHaveTextContent("Page 1");

    fireEvent.click(screen.getByTestId("pagination-next-button"));
    expect(onPageChange).toHaveBeenCalledWith(2);
  });

  test("Next is off when the endpoint saw nothing after this page", () => {
    renderViewer({
      page: 2,
      items: rows(10, 50),
      totalCount: 60,
      hasMore: false,
      resultTotal: COUNTING,
    });

    expect(footerSummary()).toBe("Showing 51-60 spans");
    expect(screen.getByTestId("pagination-next-button")).toBeDisabled();
  });
});

describe("when the total could not be counted", () => {
  test("too many to count: the rows the list has proven, with a '+', and what to do", () => {
    renderViewer({ resultTotal: TOO_MANY });

    const total: HTMLElement | null = resultTotal();
    expect(total?.textContent).toBe(
      "50+ spans · Too many to count in time. Narrow the time range for an exact total.",
    );
    expect(total).toHaveAttribute("data-status", ResultTotalStatus.Unavailable);
    expect(footerSummary()).toBe("Showing 1-50+ spans");
  });

  test("on page 3 it vouches for every row up to the end of the page", () => {
    renderViewer({
      page: 3,
      items: rows(50, 100),
      totalCount: 151,
      resultTotal: TOO_MANY,
    });

    expect(resultTotal()?.textContent).toMatch(/^150\+ spans/);
  });

  test("any other failure says only that it could not be counted", () => {
    renderViewer({ resultTotal: FAILED });

    expect(resultTotal()?.textContent).toBe(
      "50+ spans · The total could not be counted.",
    );
  });

  test("never claims a number it does not have: no 0, no 51", () => {
    renderViewer({ resultTotal: FAILED });

    expect(resultTotal()?.textContent).not.toMatch(/^0 /);
    expect(resultTotal()?.textContent).not.toMatch(/51/);
  });
});

describe("where the total is not shown", () => {
  test("over an empty list: its empty state already says there is nothing", () => {
    renderViewer({
      items: [],
      totalCount: 0,
      hasMore: false,
      resultTotal: exact(0),
    });

    expect(resultTotal()).toBeNull();
    expect(screen.getByText("No results")).toBeInTheDocument();
    expect(footerSummary()).toBe("No spans");
  });

  test("over an error", () => {
    renderViewer({ error: "The request failed.", resultTotal: exact(712345) });

    expect(resultTotal()).toBeNull();
    expect(screen.getByText(/The request failed\./)).toBeInTheDocument();
  });

  test("for a caller that tracks no result total (the Postgres-backed explorers)", () => {
    renderViewer({ hasMore: undefined, totalCount: 240, items: rows(25) });

    expect(resultTotal()).toBeNull();
  });
});

describe("callers with an exact count and no hasMore are unchanged", () => {
  // Metrics and Exceptions read Postgres, whose list endpoints count exactly.
  test("the footer prints their count and numbers their pages", () => {
    renderViewer({
      items: rows(25),
      pageSize: 25,
      totalCount: 240,
      hasMore: undefined,
      itemLabel: "exceptions",
    });

    expect(footerSummary()).toBe("Showing 1-25 of 240 exceptions");
    expect(pageButtons()).toEqual(["1", "2", "3", "10"]);
  });
});

describe("hasMore without a result total", () => {
  test("a page that ends the list proves the total, and the footer numbers by it", () => {
    renderViewer({
      items: rows(12),
      totalCount: 12,
      hasMore: false,
      itemLabel: "security events",
    });

    expect(footerSummary()).toBe("Showing 1-12 of 12 security events");
    expect(pageButtons()).toEqual(["1"]);
  });

  test("a later page that ends the list does too", () => {
    renderViewer({
      page: 3,
      items: rows(7, 100),
      totalCount: 107,
      hasMore: false,
      itemLabel: "security events",
    });

    expect(footerSummary()).toBe("Showing 101-107 of 107 security events");
  });

  test("an empty list reads as empty", () => {
    renderViewer({
      items: [],
      totalCount: 0,
      hasMore: false,
      itemLabel: "security events",
    });

    expect(footerSummary()).toBe("No security events");
  });

  test("more to come: has-more paging, no total", () => {
    renderViewer({ itemLabel: "security events" });

    expect(footerSummary()).toBe("Showing 1-50+ security events");
    expect(pageButtons()).toEqual([]);
  });
});
