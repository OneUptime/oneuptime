import "@testing-library/jest-dom";
import { act, fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import TimeRange from "../../../Types/Time/TimeRange";
import getJestMockFunction, { MockFunction } from "../../MockType";
import SessionReplaySearchBar, {
  SESSION_REPLAY_SEARCH_DEBOUNCE_MS,
  SessionReplaySearchBarProps,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/SessionReplaySearchBar";
import {
  EMPTY_ADVANCED_FILTERS,
  SessionReplayAdvancedFilters,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/SessionReplayListFilters";

/*
 * The list's toolbar. Typing is debounced into ONE filter change, Enter
 * flushes and is the only thing that acts on an id: token, the box follows
 * filters changed elsewhere, and every dropped token is explained.
 */

const SESSION_ID: string = "a1b2c3d4e5f60718293a4b5c6d7e8f90";

const onFiltersChange: MockFunction = getJestMockFunction();
const onNavigateToSession: MockFunction = getJestMockFunction();
const onSignalChange: MockFunction = getJestMockFunction();
const onSortChange: MockFunction = getJestMockFunction();
const onTimeRangeChange: MockFunction = getJestMockFunction();
const onOpenAdvancedFilters: MockFunction = getJestMockFunction();

function renderBar(
  overrides?: Partial<SessionReplaySearchBarProps>,
): ReturnType<typeof render> {
  return render(
    <SessionReplaySearchBar
      filters={EMPTY_ADVANCED_FILTERS}
      onFiltersChange={onFiltersChange}
      onNavigateToSession={onNavigateToSession}
      signal="all"
      onSignalChange={onSignalChange}
      sortBy="startTime"
      onSortChange={onSortChange}
      timeRange={{ range: TimeRange.PAST_ONE_DAY }}
      onTimeRangeChange={onTimeRangeChange}
      onOpenAdvancedFilters={onOpenAdvancedFilters}
      {...overrides}
    />,
  );
}

function input(): HTMLInputElement {
  return screen.getByTestId("session-search-input") as HTMLInputElement;
}

beforeEach(() => {
  jest.useFakeTimers();
  onFiltersChange.mockReset();
  onNavigateToSession.mockReset();
  onSignalChange.mockReset();
  onSortChange.mockReset();
  onTimeRangeChange.mockReset();
  onOpenAdvancedFilters.mockReset();
});

afterEach(() => {
  jest.useRealTimers();
});

describe("SessionReplaySearchBar typing", () => {
  it("debounces keystrokes into one filter change", () => {
    renderBar();

    fireEvent.change(input(), { target: { value: "/check" } });
    fireEvent.change(input(), { target: { value: "/checkout" } });

    expect(onFiltersChange).not.toHaveBeenCalled();

    act(() => {
      jest.advanceTimersByTime(SESSION_REPLAY_SEARCH_DEBOUNCE_MS - 1);
    });

    expect(onFiltersChange).not.toHaveBeenCalled();

    act(() => {
      jest.advanceTimersByTime(1);
    });

    expect(onFiltersChange).toHaveBeenCalledTimes(1);
    expect(
      (onFiltersChange.mock.calls[0]![0] as SessionReplayAdvancedFilters)
        .urlPrefix,
    ).toBe("/checkout");
  });

  it("does not emit when the parsed filters did not change", () => {
    renderBar({
      filters: { ...EMPTY_ADVANCED_FILTERS, urlPrefix: "/checkout" },
    });

    expect(input().value).toBe("url:/checkout");

    fireEvent.change(input(), { target: { value: "url:/checkout " } });

    act(() => {
      jest.advanceTimersByTime(SESSION_REPLAY_SEARCH_DEBOUNCE_MS);
    });

    expect(onFiltersChange).not.toHaveBeenCalled();
  });

  it("Enter flushes immediately", () => {
    renderBar();

    fireEvent.change(input(), { target: { value: "jane@acme.com" } });
    fireEvent.keyDown(input(), { key: "Enter" });

    expect(onFiltersChange).toHaveBeenCalledTimes(1);
    expect(
      (onFiltersChange.mock.calls[0]![0] as SessionReplayAdvancedFilters)
        .identifiedUserRef,
    ).toBe("jane@acme.com");

    /* The pending debounce was cancelled, so no second emission. */
    act(() => {
      jest.advanceTimersByTime(SESSION_REPLAY_SEARCH_DEBOUNCE_MS);
    });

    expect(onFiltersChange).toHaveBeenCalledTimes(1);
  });

  it("keeps a modal-only field while the box is edited", () => {
    renderBar({
      filters: { ...EMPTY_ADVANCED_FILTERS, route: "https://a.b/exact" },
    });

    fireEvent.change(input(), { target: { value: "browser:Chrome" } });

    act(() => {
      jest.advanceTimersByTime(SESSION_REPLAY_SEARCH_DEBOUNCE_MS);
    });

    const emitted: SessionReplayAdvancedFilters = onFiltersChange.mock
      .calls[0]![0] as SessionReplayAdvancedFilters;

    expect(emitted.browserName).toBe("Chrome");
    expect(emitted.route).toBe("https://a.b/exact");
  });
});

describe("SessionReplaySearchBar id: navigation", () => {
  it("a full id navigates ONLY on Enter, and still narrows the list while typing", () => {
    renderBar();

    fireEvent.change(input(), { target: { value: `id:${SESSION_ID}` } });

    act(() => {
      jest.advanceTimersByTime(SESSION_REPLAY_SEARCH_DEBOUNCE_MS);
    });

    expect(onNavigateToSession).not.toHaveBeenCalled();
    expect(
      (onFiltersChange.mock.calls[0]![0] as SessionReplayAdvancedFilters)
        .search,
    ).toBe(SESSION_ID);
    expect(screen.getByTestId("session-search-hint")).toHaveTextContent(
      "Press Enter to open this session.",
    );

    fireEvent.keyDown(input(), { key: "Enter" });

    expect(onNavigateToSession).toHaveBeenCalledWith(SESSION_ID);
  });

  it("a partial id never navigates", () => {
    renderBar();

    fireEvent.change(input(), { target: { value: "id:a1b2c3" } });
    fireEvent.keyDown(input(), { key: "Enter" });

    expect(onNavigateToSession).not.toHaveBeenCalled();
  });
});

describe("SessionReplaySearchBar follows external changes", () => {
  it("rewrites the box when the applied filters change elsewhere", () => {
    const view: ReturnType<typeof render> = renderBar();

    expect(input().value).toBe("");

    view.rerender(
      <SessionReplaySearchBar
        filters={{
          ...EMPTY_ADVANCED_FILTERS,
          browserName: "Chrome",
          search: "x",
        }}
        onFiltersChange={onFiltersChange}
        onNavigateToSession={onNavigateToSession}
        signal="all"
        onSignalChange={onSignalChange}
        sortBy="startTime"
        onSortChange={onSortChange}
        timeRange={{ range: TimeRange.PAST_ONE_DAY }}
        onTimeRangeChange={onTimeRangeChange}
        onOpenAdvancedFilters={onOpenAdvancedFilters}
      />,
    );

    expect(input().value).toBe("browser:Chrome x");
  });

  it("does NOT rewrite the box for the filters it emitted itself", () => {
    const view: ReturnType<typeof render> = renderBar();

    fireEvent.change(input(), { target: { value: "/checkout" } });

    act(() => {
      jest.advanceTimersByTime(SESSION_REPLAY_SEARCH_DEBOUNCE_MS);
    });

    const emitted: SessionReplayAdvancedFilters = onFiltersChange.mock
      .calls[0]![0] as SessionReplayAdvancedFilters;

    view.rerender(
      <SessionReplaySearchBar
        filters={emitted}
        onFiltersChange={onFiltersChange}
        onNavigateToSession={onNavigateToSession}
        signal="all"
        onSignalChange={onSignalChange}
        sortBy="startTime"
        onSortChange={onSortChange}
        timeRange={{ range: TimeRange.PAST_ONE_DAY }}
        onTimeRangeChange={onTimeRangeChange}
        onOpenAdvancedFilters={onOpenAdvancedFilters}
      />,
    );

    /* The person typed "/checkout"; the box keeps their spelling. */
    expect(input().value).toBe("/checkout");
  });
});

describe("SessionReplaySearchBar hints", () => {
  it("explains a dropped error: token", () => {
    renderBar();

    fireEvent.change(input(), { target: { value: "error:TypeError" } });

    expect(screen.getByTestId("session-search-hint")).toHaveTextContent(
      "error: is not a filter",
    );
  });

  /*
   * ux-03: a URL filter that anchors nowhere can only ever return "no
   * sessions match", so the box anchors it and says what it applied
   * instead of leaving the viewer to conclude the page was not recorded.
   */
  it("says what an un-anchored URL filter was applied as", () => {
    renderBar();

    fireEvent.change(input(), { target: { value: "url:checkout" } });

    expect(screen.getByTestId("session-search-hint")).toHaveTextContent(
      'was applied as "/checkout"',
    );
  });

  it("a path URL filter is applied as typed, with no warning", () => {
    renderBar();

    fireEvent.change(input(), { target: { value: "url:/checkout" } });

    expect(screen.getByTestId("session-search-hint")).toHaveTextContent(
      "Tokens: user:, url:",
    );
  });

  it("says when the server ignores the user filter", () => {
    renderBar({
      filters: {
        ...EMPTY_ADVANCED_FILTERS,
        identifiedUserRef: "jane@acme.com",
      },
      isIdentityFilterIgnored: true,
    });

    expect(screen.getByTestId("session-search-hint")).toHaveTextContent(
      "ignored by the server",
    );
  });

  it("shows the grammar when there is nothing to warn about", () => {
    renderBar();

    expect(screen.getByTestId("session-search-hint")).toHaveTextContent(
      "Tokens: user:, url:",
    );
  });
});

describe("SessionReplaySearchBar controls", () => {
  it("quick filters call onSignalChange with the predicate's value", () => {
    renderBar();

    fireEvent.click(screen.getByText("Playable"));

    expect(onSignalChange).toHaveBeenCalledWith("playable");
    expect(screen.getByTestId("session-signal-description")).toHaveTextContent(
      "Every session in the range.",
    );
  });

  it("the sort dropdown calls onSortChange with the server key", () => {
    renderBar();

    const combobox: HTMLElement = screen.getByRole("combobox", {
      name: "Sort sessions",
    });

    fireEvent.keyDown(combobox, { key: "ArrowDown", code: "ArrowDown" });
    fireEvent.click(screen.getByText("Longest"));

    expect(onSortChange).toHaveBeenCalledWith("durationMs");
  });

  it("the Filters button opens the advanced modal and has a name", () => {
    renderBar();

    fireEvent.click(screen.getByTestId("session-open-filters"));

    expect(onOpenAdvancedFilters).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("session-open-filters")).toHaveAttribute(
      "aria-label",
      "Open advanced filters",
    );
  });
});
