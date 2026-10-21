import "@testing-library/jest-dom";
import { act, fireEvent, render, screen, within } from "@testing-library/react";
import * as React from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import getJestMockFunction, { MockFunction } from "../../MockType";
import SessionReplaySearchBar, {
  SESSION_REPLAY_SEARCH_DEBOUNCE_MS,
  SESSION_REPLAY_SEARCH_HELP_TEST_ID,
  SESSION_REPLAY_SEARCH_HINT_ID,
  SessionReplaySearchBarProps,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/SessionReplaySearchBar";
import {
  EMPTY_ADVANCED_FILTERS,
  SessionReplayAdvancedFilters,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/SessionReplayListFilters";
import { SESSION_REPLAY_SEARCH_HELP_ROWS } from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/SessionReplaySearchQuery";
import { TABLE_HEADER_CONTROL_HEIGHT_CLASS_NAME } from "../../../UI/Components/Table/TableHeaderControls";

/*
 * The session list's search: the bar the header's "Search…  /" pill opens
 * into. Typing is debounced into ONE filter change, Enter flushes and is
 * the only thing that acts on an id: token, the box follows filters changed
 * elsewhere, every dropped token is explained while the box has the focus,
 * and an empty focused box drops down the syntax help.
 *
 * The box shows what the reader searches for - free text, user:, visitor:,
 * url: and tag: - and never writes out what the chips under the header hold
 * (browser, OS, device, country, capture reason, duration). Their tokens
 * still work when typed, and Enter moves them into their chips.
 */

const SESSION_ID: string = "a1b2c3d4e5f60718293a4b5c6d7e8f90";

const onFiltersChange: MockFunction = getJestMockFunction();
const onNavigateToSession: MockFunction = getJestMockFunction();
const onClose: MockFunction = getJestMockFunction();
const onFocus: MockFunction = getJestMockFunction();

function barProps(
  overrides?: Partial<SessionReplaySearchBarProps>,
): SessionReplaySearchBarProps {
  return {
    filters: EMPTY_ADVANCED_FILTERS,
    onFiltersChange: onFiltersChange,
    onNavigateToSession: onNavigateToSession,
    onClose: onClose,
    onFocus: onFocus,
    ...overrides,
  };
}

function renderBar(
  overrides?: Partial<SessionReplaySearchBarProps>,
): ReturnType<typeof render> {
  return render(<SessionReplaySearchBar {...barProps(overrides)} />);
}

function input(): HTMLInputElement {
  return screen.getByTestId("session-search-input") as HTMLInputElement;
}

function type(value: string): void {
  fireEvent.change(input(), { target: { value: value } });
}

function settle(): void {
  act(() => {
    jest.advanceTimersByTime(SESSION_REPLAY_SEARCH_DEBOUNCE_MS);
  });
}

function emitted(index: number = 0): SessionReplayAdvancedFilters {
  return onFiltersChange.mock.calls[index]![0] as SessionReplayAdvancedFilters;
}

function lastEmitted(): SessionReplayAdvancedFilters {
  return emitted(onFiltersChange.mock.calls.length - 1);
}

beforeEach(() => {
  jest.useFakeTimers();
  onFiltersChange.mockReset();
  onNavigateToSession.mockReset();
  onClose.mockReset();
  onFocus.mockReset();
});

afterEach(() => {
  jest.useRealTimers();
});

describe("SessionReplaySearchBar typing", () => {
  it("debounces keystrokes into one filter change", () => {
    renderBar();

    type("/check");
    type("/checkout");

    expect(onFiltersChange).not.toHaveBeenCalled();

    act(() => {
      jest.advanceTimersByTime(SESSION_REPLAY_SEARCH_DEBOUNCE_MS - 1);
    });

    expect(onFiltersChange).not.toHaveBeenCalled();

    act(() => {
      jest.advanceTimersByTime(1);
    });

    expect(onFiltersChange).toHaveBeenCalledTimes(1);
    expect(emitted().urlPrefix).toBe("/checkout");
  });

  it("does not emit when the parsed filters did not change", () => {
    renderBar({
      filters: { ...EMPTY_ADVANCED_FILTERS, urlPrefix: "/checkout" },
    });

    expect(input().value).toBe("url:/checkout");

    type("url:/checkout ");
    settle();

    expect(onFiltersChange).not.toHaveBeenCalled();
  });

  it("Enter flushes immediately", () => {
    renderBar();

    type("jane@acme.com");
    fireEvent.keyDown(input(), { key: "Enter" });

    expect(onFiltersChange).toHaveBeenCalledTimes(1);
    expect(emitted().identifiedUserRef).toBe("jane@acme.com");

    /* The pending debounce was cancelled, so no second emission. */
    settle();

    expect(onFiltersChange).toHaveBeenCalledTimes(1);
  });

  it("keeps a modal-only field while the box is edited", () => {
    renderBar({
      filters: { ...EMPTY_ADVANCED_FILTERS, route: "https://a.b/exact" },
    });

    type("browser:Chrome");
    settle();

    expect(emitted().browserName).toBe("Chrome");
    expect(emitted().route).toBe("https://a.b/exact");
  });
});

describe("SessionReplaySearchBar and the chips", () => {
  it("never writes a chip's filter into the box", () => {
    renderBar({
      filters: {
        ...EMPTY_ADVANCED_FILTERS,
        browserName: "Chrome",
        osName: "macOS",
        deviceType: "mobile",
        countryCode: "DE",
        triggerReason: "error",
        minDurationSeconds: "120",
        urlPrefix: "/checkout",
        search: "jane",
      },
    });

    expect(input().value).toBe("url:/checkout jane");
  });

  it("a keystroke never clears a chip set outside the box", () => {
    renderBar({
      filters: {
        ...EMPTY_ADVANCED_FILTERS,
        browserName: "Safari",
        minDurationSeconds: "60",
      },
    });

    expect(input().value).toBe("");

    type("checkout");
    settle();

    expect(emitted()).toEqual({
      ...EMPTY_ADVANCED_FILTERS,
      browserName: "Safari",
      minDurationSeconds: "60",
      search: "checkout",
    });
  });

  it("a typed chip token narrows the list at once and stays in the box until Enter", () => {
    renderBar();

    type("browser:Chrome checkout");
    settle();

    expect(emitted().browserName).toBe("Chrome");
    expect(emitted().search).toBe("checkout");
    expect(input().value).toBe("browser:Chrome checkout");
  });

  it("Enter moves the chip tokens into their chips and keeps the rest as typed", () => {
    renderBar();

    type('browser:"Mobile Safari" /cart min:2m jane');
    fireEvent.keyDown(input(), { key: "Enter" });

    expect(lastEmitted()).toEqual({
      ...EMPTY_ADVANCED_FILTERS,
      browserName: "Mobile Safari",
      minDurationSeconds: "120",
      urlPrefix: "/cart",
      search: "jane",
    });
    /* The reader's spelling of the rest survives: "/cart", not "url:/cart". */
    expect(input().value).toBe("/cart jane");
  });

  it("after Enter, the chips keep what the tokens set while the box is edited again", () => {
    renderBar();

    type("os:Linux");
    fireEvent.keyDown(input(), { key: "Enter" });

    expect(input().value).toBe("");

    type("checkout");
    settle();

    expect(lastEmitted().osName).toBe("Linux");
    expect(lastEmitted().search).toBe("checkout");
  });

  it("deleting a typed chip token before Enter gives the chip back what it held", () => {
    renderBar({
      filters: { ...EMPTY_ADVANCED_FILTERS, countryCode: "FR" },
    });

    type("country:DE");
    settle();

    expect(lastEmitted().countryCode).toBe("DE");

    type("");
    settle();

    expect(lastEmitted().countryCode).toBe("FR");
  });

  it("Enter leaves text without a chip token exactly as it was typed", () => {
    renderBar();

    type("/checkout   jane");
    fireEvent.keyDown(input(), { key: "Enter" });

    expect(input().value).toBe("/checkout   jane");
  });
});

describe("SessionReplaySearchBar id: navigation", () => {
  it("a full id navigates ONLY on Enter, and still narrows the list while typing", () => {
    renderBar();

    fireEvent.focus(input());
    type(`id:${SESSION_ID}`);
    settle();

    expect(onNavigateToSession).not.toHaveBeenCalled();
    expect(emitted().search).toBe(SESSION_ID);
    expect(screen.getByTestId("session-search-hint")).toHaveTextContent(
      "Press Enter to open this session.",
    );

    fireEvent.keyDown(input(), { key: "Enter" });

    expect(onNavigateToSession).toHaveBeenCalledWith(SESSION_ID);
  });

  it("a partial id never navigates", () => {
    renderBar();

    type("id:a1b2c3");
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
        {...barProps({
          filters: {
            ...EMPTY_ADVANCED_FILTERS,
            identifiedUserRef: "jane@acme.com",
            browserName: "Chrome",
            search: "x",
          },
        })}
      />,
    );

    /* The user is the box's; the browser is its chip's. */
    expect(input().value).toBe("user:jane@acme.com x");
  });

  it("does NOT rewrite the box for the filters it emitted itself", () => {
    const view: ReturnType<typeof render> = renderBar();

    type("/checkout");
    settle();

    view.rerender(
      <SessionReplaySearchBar {...barProps({ filters: emitted() })} />,
    );

    /* The person typed "/checkout"; the box keeps their spelling. */
    expect(input().value).toBe("/checkout");
  });

  it("a chip changed outside drops a typed chip token from the box, and the chip holds the value", () => {
    const view: ReturnType<typeof render> = renderBar();

    type("browser:Chrome jane");
    settle();

    view.rerender(
      <SessionReplaySearchBar
        {...barProps({
          filters: { ...emitted(), countryCode: "DE" },
        })}
      />,
    );

    expect(input().value).toBe("jane");

    type("jane doe");
    settle();

    expect(lastEmitted().browserName).toBe("Chrome");
    expect(lastEmitted().countryCode).toBe("DE");
  });
});

describe("SessionReplaySearchBar facet changes", () => {
  it("cancels pending typing when an external facet replaces the filters", () => {
    const view: ReturnType<typeof render> = renderBar();

    type("browser:Chrome");
    view.rerender(
      <SessionReplaySearchBar
        {...barProps({
          filters: { ...EMPTY_ADVANCED_FILTERS, browserName: "Safari" },
        })}
      />,
    );
    settle();

    expect(input().value).toBe("");
    expect(onFiltersChange).not.toHaveBeenCalled();
  });
});

describe("SessionReplaySearchBar hints", () => {
  it("explains a dropped error: token while the box has the focus", () => {
    renderBar();

    fireEvent.focus(input());
    type("error:TypeError");

    expect(screen.getByTestId("session-search-hint")).toHaveTextContent(
      "error: is not a filter",
    );
    expect(input()).toHaveAttribute(
      "aria-describedby",
      SESSION_REPLAY_SEARCH_HINT_ID,
    );
  });

  /*
   * ux-03: a URL filter that anchors nowhere can only ever return "no
   * sessions match", so the box anchors it and says what it applied
   * instead of leaving the viewer to conclude the page was not recorded.
   */
  it("says what an un-anchored URL filter was applied as", () => {
    renderBar();

    fireEvent.focus(input());
    type("url:checkout");

    expect(screen.getByTestId("session-search-hint")).toHaveTextContent(
      'was applied as "/checkout"',
    );
  });

  it("a path URL filter is applied as typed, with no warning", () => {
    renderBar();

    fireEvent.focus(input());
    type("url:/checkout");

    expect(screen.queryByTestId("session-search-hint")).toBeNull();
    expect(input()).not.toHaveAttribute("aria-describedby");
  });

  it("says when the server ignores the user filter", () => {
    renderBar({
      filters: {
        ...EMPTY_ADVANCED_FILTERS,
        identifiedUserRef: "jane@acme.com",
      },
      isIdentityFilterIgnored: true,
    });

    fireEvent.focus(input());

    expect(screen.getByTestId("session-search-hint")).toHaveTextContent(
      "ignored by the server",
    );
  });

  it("a warning the reader tabbed away from stays on the box as a marked icon", () => {
    renderBar();

    fireEvent.focus(input());
    type("device:car");

    expect(screen.queryByTestId("session-search-warning")).toBeNull();

    fireEvent.blur(input());

    expect(screen.queryByTestId("session-search-hint")).toBeNull();

    const warning: HTMLElement = screen.getByTestId("session-search-warning");

    expect(warning).toHaveAttribute("role", "img");
    expect(warning.getAttribute("aria-label")).toContain(
      'device: takes desktop, mobile, tablet, not "car"',
    );
  });
});

describe("SessionReplaySearchBar syntax help", () => {
  it("drops down while the box is focused and empty, and goes away while typing", () => {
    renderBar();

    expect(screen.queryByTestId(SESSION_REPLAY_SEARCH_HELP_TEST_ID)).toBeNull();

    fireEvent.focus(input());

    const help: HTMLElement = screen.getByTestId(
      SESSION_REPLAY_SEARCH_HELP_TEST_ID,
    );

    expect(help).toHaveTextContent("Search syntax");

    for (const row of SESSION_REPLAY_SEARCH_HELP_ROWS) {
      expect(help).toHaveTextContent(row.syntax);
      expect(help).toHaveTextContent(row.description);
    }

    type("j");

    expect(screen.queryByTestId(SESSION_REPLAY_SEARCH_HELP_TEST_ID)).toBeNull();
  });

  it("hangs from the box's right edge and is never wider than the screen", () => {
    renderBar();

    fireEvent.focus(input());

    const help: HTMLElement = screen.getByTestId(
      SESSION_REPLAY_SEARCH_HELP_TEST_ID,
    );

    expect(help).toHaveClass("right-0", "max-w-[calc(100vw-2rem)]");
    expect(help).not.toHaveClass("left-0");
  });

  it("an example click puts it in the box and applies it", () => {
    renderBar();

    fireEvent.focus(input());

    const help: HTMLElement = screen.getByTestId(
      SESSION_REPLAY_SEARCH_HELP_TEST_ID,
    );

    fireEvent.mouseDown(within(help).getByText("url:/checkout"));

    expect(input().value).toBe("url:/checkout");
    expect(onFiltersChange).toHaveBeenCalledTimes(1);
    expect(emitted().urlPrefix).toBe("/checkout");
  });

  it("Escape puts the help away and folds an empty box", () => {
    renderBar();

    fireEvent.focus(input());

    expect(
      screen.getByTestId(SESSION_REPLAY_SEARCH_HELP_TEST_ID),
    ).toBeInTheDocument();

    fireEvent.keyDown(input(), { key: "Escape" });

    expect(screen.queryByTestId(SESSION_REPLAY_SEARCH_HELP_TEST_ID)).toBeNull();
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("is not offered while the header's search is folded", () => {
    renderBar({ isOpen: false });

    fireEvent.focus(input());

    expect(screen.queryByTestId(SESSION_REPLAY_SEARCH_HELP_TEST_ID)).toBeNull();
  });
});

describe("SessionReplaySearchBar clearing and folding", () => {
  it("Escape on a box with text empties it and applies that at once, chips kept", () => {
    renderBar({
      filters: {
        ...EMPTY_ADVANCED_FILTERS,
        identifiedUserRef: "jane@acme.com",
        browserName: "Chrome",
      },
    });

    expect(input().value).toBe("user:jane@acme.com");

    fireEvent.keyDown(input(), { key: "Escape" });

    expect(input().value).toBe("");
    expect(onFiltersChange).toHaveBeenCalledTimes(1);
    expect(emitted()).toEqual({
      ...EMPTY_ADVANCED_FILTERS,
      browserName: "Chrome",
    });
    expect(onClose).not.toHaveBeenCalled();
  });

  it("the clear button empties the box, applies it and keeps the focus", () => {
    renderBar({
      filters: { ...EMPTY_ADVANCED_FILTERS, search: "checkout" },
    });

    input().focus();

    const clear: HTMLElement = screen.getByRole("button", {
      name: "Clear search",
    });

    fireEvent.mouseDown(clear);
    fireEvent.click(clear);

    expect(input().value).toBe("");
    expect(emitted().search).toBe("");
    expect(document.activeElement).toBe(input());
  });

  it("losing the focus with nothing in the box folds it; with text it stays", () => {
    renderBar();

    fireEvent.focus(input());

    expect(onFocus).toHaveBeenCalledTimes(1);

    fireEvent.blur(input());

    expect(onClose).toHaveBeenCalledTimes(1);

    fireEvent.focus(input());
    type("jane");
    fireEvent.blur(input());

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("is out of the keyboard's way while the header's search is folded", () => {
    const view: ReturnType<typeof render> = renderBar({ isOpen: false });

    expect(input()).toHaveAttribute("tabindex", "-1");

    view.rerender(<SessionReplaySearchBar {...barProps({ isOpen: true })} />);

    expect(input()).toHaveAttribute("tabindex", "0");
  });
});

describe("SessionReplaySearchBar is one control of the header", () => {
  it("is as tall as the header's buttons", () => {
    renderBar();

    const box: HTMLElement = input().parentElement as HTMLElement;

    expect(box).toHaveClass(
      ...TABLE_HEADER_CONTROL_HEIGHT_CLASS_NAME.split(" "),
    );
    expect(box).toHaveClass("rounded-md", "border", "bg-white");
  });

  it("holds the search alone: the sort, the window and the filters live in the header", () => {
    renderBar();

    expect(screen.getByTestId("session-search-input")).toBeInTheDocument();
    expect(
      screen.queryByRole("combobox", { name: "Sort sessions" }),
    ).toBeNull();
    expect(screen.queryByTestId("session-sort")).toBeNull();
    expect(screen.queryByTestId("session-open-filters")).toBeNull();
    expect(
      screen.queryByTestId("telemetry-time-range-picker-button"),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: "Search help" })).toBeNull();
    expect(input()).toHaveAccessibleName("Search sessions");
    expect(input()).toHaveAttribute(
      "placeholder",
      "Search by URL, user, session or trace ID",
    );
  });
});
