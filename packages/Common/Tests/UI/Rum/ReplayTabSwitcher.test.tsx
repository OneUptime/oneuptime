import "@testing-library/jest-dom";
import { fireEvent, render, screen, within } from "@testing-library/react";
/*
 * The Dashboard has its own copy of react; Common's jest moduleNameMapper
 * pins react and react-dom to this project's single copy for every
 * importer (see the note at the top of ReplayStage.test.tsx).
 */
import * as React from "react";
import { describe, expect, it } from "@jest/globals";
import getJestMockFunction, { MockFunction } from "../../MockType";
import {
  LAPTOP_WIDTH_IN_PX,
  PHONE_WIDTH_IN_PX,
  TABLET_WIDTH_IN_PX,
  isVisibleAtWidth,
} from "../../ResponsiveVisibility";
import ReplayTabSwitcher, {
  ReplayTabSwitcherProps,
  buildReplayTabPillTitle,
  describeReplayTabDuration,
  readReplayTabUrl,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/ReplayTabSwitcher";
import {
  REPLAY_TAB_SPAN_MIN_WIDTH_PERCENT,
  REPLAY_TAB_STRIP_MAX_PILLS,
  ReplayTabSummary,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SessionReplay/ReplayTabs";

/*
 * The header's browser-tab switcher.
 *
 * The browser recorder mints a new tab id on every page load, so a
 * multi-page session arrives as a dozen "tabs" that the old strip printed
 * in opened order as "Tab 7 · 12s" - which answered neither "which one is
 * still recording" nor "which page is this". What is pinned here is the
 * answer to both: open tabs lead, each pill names its page and carries a
 * status dot, and past six tabs a searchable picker lists every tab
 * grouped by status with its span drawn against the session.
 *
 * The keyboard is pinned as hard as the copy. The player listens for
 * Space, Enter, Escape, Home, End and the arrows on the WINDOW, so every
 * key this control handles has to be consumed here or watching a
 * recording would seek, pause or leave theater while the viewer was
 * choosing a tab.
 */

const SESSION_DURATION_MS: number = 600000;

function makeTab(overrides: Partial<ReplayTabSummary>): ReplayTabSummary {
  return {
    tabId: "tab-1",
    label: "Tab 1",
    durationMs: 30000,
    openedAtMs: 0,
    hasFootage: true,
    isActive: false,
    status: "closed",
    closedAtMs: 30000,
    firstUrl: "https://app.acme.com/",
    lastUrl: "https://app.acme.com/",
    pageCount: 1,
    errorCount: 0,
    frustrationCount: 0,
    ...overrides,
  };
}

/* Tab 1 open on /checkout (watched), Tab 2 closed on /cart, Tab 3 empty. */
function makeTabs(): Array<ReplayTabSummary> {
  return [
    makeTab({
      tabId: "tab-1",
      label: "Tab 1",
      status: "open",
      isActive: true,
      durationMs: 252000,
      openedAtMs: 0,
      closedAtMs: 252000,
      firstUrl: "https://app.acme.com/checkout",
      lastUrl: "https://app.acme.com/checkout",
    }),
    makeTab({
      tabId: "tab-2",
      label: "Tab 2",
      status: "closed",
      durationMs: 30000,
      openedAtMs: 134000,
      closedAtMs: 164000,
      firstUrl: "https://app.acme.com/cart",
      lastUrl: "https://app.acme.com/cart",
    }),
    makeTab({
      tabId: "tab-3",
      label: "Tab 3",
      status: "empty",
      hasFootage: false,
      durationMs: 0,
      openedAtMs: null,
      closedAtMs: null,
      firstUrl: "",
      lastUrl: "",
      pageCount: 0,
    }),
  ];
}

function makeManyTabs(
  count: number,
  openCount: number,
): Array<ReplayTabSummary> {
  return Array.from(
    { length: count },
    (_unused: unknown, index: number): ReplayTabSummary => {
      return makeTab({
        tabId: `tab-${index + 1}`,
        label: `Tab ${index + 1}`,
        status: index < openCount ? "open" : "closed",
        openedAtMs: index * 20000,
        closedAtMs: index * 20000 + 30000,
        firstUrl: `https://app.acme.com/page-${index + 1}`,
        lastUrl: `https://app.acme.com/page-${index + 1}`,
      });
    },
  );
}

function makeProps(
  overrides?: Partial<ReplayTabSwitcherProps>,
): ReplayTabSwitcherProps {
  return {
    tabs: makeTabs(),
    onSwitchTab: getJestMockFunction(),
    sessionDurationMs: SESSION_DURATION_MS,
    ...overrides,
  };
}

function renderSwitcher(
  overrides?: Partial<ReplayTabSwitcherProps>,
): ReplayTabSwitcherProps {
  const props: ReplayTabSwitcherProps = makeProps(overrides);

  render(<ReplayTabSwitcher {...props} />);

  return props;
}

function pillIds(): Array<string | null> {
  return screen
    .getAllByTestId("replay-tab-pill")
    .map((pill: HTMLElement): string | null => {
      return pill.getAttribute("data-tab-id");
    });
}

function openPicker(): HTMLElement {
  fireEvent.click(screen.getByTestId("replay-tab-picker-button"));

  return screen.getByTestId("replay-tab-picker");
}

function optionIds(): Array<string | null> {
  return screen
    .getAllByTestId("replay-tab-option")
    .map((option: HTMLElement): string | null => {
      return option.getAttribute("data-tab-id");
    });
}

/* "33.33333%" as a number, so geometry is compared as geometry. */
function readPercent(value: string): number {
  return Number(value.replace("%", ""));
}

/* The span bar of one tab, wherever the grouping put its row. */
function spanOf(tabId: string): { left: number; width: number } {
  const option: HTMLElement = screen
    .getAllByTestId("replay-tab-option")
    .find((element: HTMLElement): boolean => {
      return element.getAttribute("data-tab-id") === tabId;
    }) as HTMLElement;

  const span: HTMLElement = within(option).getByTestId(
    "replay-tab-option-span",
  );

  return {
    left: readPercent(span.style.left),
    width: readPercent(span.style.width),
  };
}

describe("ReplayTabSwitcher summary", () => {
  it("renders nothing tab-related for a single-tab recording", () => {
    renderSwitcher({ tabs: [makeTab({ isActive: true })] });

    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    expect(screen.queryByTestId("replay-tab-pill")).not.toBeInTheDocument();
    expect(screen.queryByTestId("replay-tab-summary")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("replay-tab-picker-button"),
    ).not.toBeInTheDocument();
  });

  it("still offers 'Continue in Tab 2' for a single-tab strip", () => {
    const props: ReplayTabSwitcherProps = renderSwitcher({
      tabs: [makeTab({ isActive: true })],
      continueInTab: makeTab({ tabId: "tab-2", label: "Tab 2" }),
    });

    const chip: HTMLElement = screen.getByTestId("replay-continue-in-tab");

    expect(chip).toHaveTextContent("Continue in Tab 2");
    expect(chip).toHaveAttribute(
      "title",
      "This tab has played out; the session continues in another tab",
    );
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();

    fireEvent.click(chip);
    expect(props.onSwitchTab).toHaveBeenCalledWith("tab-2");
  });

  /*
   * Continuing means "keep watching", which the shell turns into a tab
   * switch that RESUMES playback; picking a tab from the strip keeps the
   * intent in force. They are two different requests, so the chip takes
   * its own handler when there is one - otherwise clicking Continue left
   * the next page of the visit paused and needed a Play as well
   * (github.com/OneUptime/oneuptime/issues/3865).
   */
  it("prefers the continue handler over the plain tab switch", () => {
    const props: ReplayTabSwitcherProps = renderSwitcher({
      tabs: [makeTab({ isActive: true })],
      continueInTab: makeTab({ tabId: "tab-2", label: "Tab 2" }),
      onContinueInTab: jest.fn(),
    });

    fireEvent.click(screen.getByTestId("replay-continue-in-tab"));

    expect(props.onContinueInTab).toHaveBeenCalledWith("tab-2");
    expect(props.onSwitchTab).not.toHaveBeenCalled();
  });

  /* The pills are a deliberate jump and keep going through onSwitchTab. */
  it("leaves the tab pills on the plain switch", () => {
    const props: ReplayTabSwitcherProps = renderSwitcher({
      onContinueInTab: jest.fn(),
    });

    fireEvent.click(screen.getAllByTestId("replay-tab-pill")[1] as HTMLElement);

    expect(props.onSwitchTab).toHaveBeenCalledTimes(1);
    expect(props.onContinueInTab).not.toHaveBeenCalled();
  });

  it("counts open, closed and footage-less tabs", () => {
    renderSwitcher();

    expect(screen.getByTestId("replay-tab-summary")).toHaveTextContent(
      "3 tabs · 1 open · 1 closed · 1 without footage",
    );
  });

  it("says only the total when no tab is known to be open", () => {
    renderSwitcher({
      tabs: [
        makeTab({ tabId: "tab-1", label: "Tab 1", isActive: true }),
        makeTab({ tabId: "tab-2", label: "Tab 2" }),
        makeTab({ tabId: "tab-3", label: "Tab 3" }),
      ],
    });

    expect(screen.getByTestId("replay-tab-summary")).toHaveTextContent(
      "3 tabs",
    );
    expect(screen.getByTestId("replay-tab-summary")).not.toHaveTextContent(
      "closed",
    );
  });
});

describe("ReplayTabSwitcher strip", () => {
  it("shows open tabs first, then closed, then the ones without footage", () => {
    renderSwitcher({
      tabs: [
        makeTab({ tabId: "tab-1", label: "Tab 1", status: "closed" }),
        makeTab({
          tabId: "tab-2",
          label: "Tab 2",
          status: "empty",
          hasFootage: false,
        }),
        makeTab({
          tabId: "tab-3",
          label: "Tab 3",
          status: "open",
          isActive: true,
        }),
      ],
    });

    expect(pillIds()).toEqual(["tab-3", "tab-1", "tab-2"]);
  });

  it("labels a pill with its ordinal, its page and its duration", () => {
    renderSwitcher();

    const pills: Array<HTMLElement> = screen.getAllByTestId("replay-tab-pill");

    expect(pills[0]).toHaveTextContent("Tab 1 · /checkout · 4m 12s");
    expect(pills[1]).toHaveTextContent("Tab 2 · /cart · 30s");
    expect(pills[2]).toHaveTextContent("Tab 3 · no footage");
  });

  /*
   * The page is the first thing to go at a phone width: "Tab 2 · 30s" is
   * still a usable pill, a wrapped URL is not.
   */
  it("hides the page below sm rather than wrapping the pill", () => {
    renderSwitcher();

    const page: HTMLElement = within(
      screen.getAllByTestId("replay-tab-pill")[0] as HTMLElement,
    ).getByText("· /checkout");

    expect(page.className).toContain("sm:inline");
    expect(page.className).toContain("truncate");
    expect(isVisibleAtWidth(page, PHONE_WIDTH_IN_PX)).toBe(false);
    expect(isVisibleAtWidth(page, TABLET_WIDTH_IN_PX)).toBe(true);
    /*
     * `max-sm:hidden`, not the bare `hidden`: a foreign
     * `.hidden { display: none !important }` rule would beat `sm:inline` and
     * strip the page from every pill at every width.
     */
    expect(page).not.toHaveClass("hidden");
    expect(
      isVisibleAtWidth(page, LAPTOP_WIDTH_IN_PX, {
        withForeignHiddenRule: true,
      }),
    ).toBe(true);
  });

  it("leaves the page off a pill whose url the recorder never reported", () => {
    renderSwitcher({
      tabs: [
        makeTab({
          tabId: "tab-1",
          label: "Tab 1",
          isActive: true,
          firstUrl: "",
          lastUrl: "",
        }),
        makeTab({ tabId: "tab-2", label: "Tab 2" }),
      ],
    });

    const pill: HTMLElement = screen.getAllByTestId(
      "replay-tab-pill",
    )[0] as HTMLElement;

    expect(pill).toHaveTextContent("Tab 1 · 30s");
    expect(pill).not.toHaveTextContent("Unknown page");
  });

  it("puts the whole story of a tab in its tooltip", () => {
    renderSwitcher({
      tabs: [
        makeTab({
          tabId: "tab-1",
          label: "Tab 1",
          status: "open",
          isActive: true,
        }),
        makeTab({
          tabId: "tab-2",
          label: "Tab 2",
          status: "open",
          durationMs: 30000,
          openedAtMs: 134000,
          lastUrl: "https://app.acme.com/checkout",
        }),
      ],
    });

    expect(screen.getAllByTestId("replay-tab-pill")[1]).toHaveAttribute(
      "title",
      "Tab 2 · Open · /checkout · opened 2:14 · 30s — switch to this tab; the playhead stays where it is",
    );
  });

  it("disables a tab with no footage and says why", () => {
    renderSwitcher();

    const empty: HTMLElement = screen.getAllByTestId(
      "replay-tab-pill",
    )[2] as HTMLElement;

    expect(empty).toBeDisabled();
    expect(empty).toHaveAttribute("title", "No footage stored for this tab");
    expect(empty).toHaveAttribute("data-tab-status", "empty");
  });

  it("reflects the resolved status on every pill", () => {
    renderSwitcher();

    const statuses: Array<string | null> = screen
      .getAllByTestId("replay-tab-pill")
      .map((pill: HTMLElement): string | null => {
        return pill.getAttribute("data-tab-status");
      });

    expect(statuses).toEqual(["open", "closed", "empty"]);
  });

  /*
   * A summary built by an older shell (or from a server that predates the
   * per-tab flag) carries no status at all. It must read as "may still be
   * open", never as closed.
   */
  it("treats a summary without a status as unknown, or empty without footage", () => {
    renderSwitcher({
      tabs: [
        {
          tabId: "tab-1",
          label: "Tab 1",
          durationMs: 30000,
          openedAtMs: 0,
          hasFootage: true,
          isActive: true,
        },
        {
          tabId: "tab-2",
          label: "Tab 2",
          durationMs: 0,
          openedAtMs: null,
          hasFootage: false,
          isActive: false,
        },
      ],
    });

    const statuses: Array<string | null> = screen
      .getAllByTestId("replay-tab-pill")
      .map((pill: HTMLElement): string | null => {
        return pill.getAttribute("data-tab-status");
      });

    expect(statuses).toEqual(["unknown", "empty"]);
  });

  it("marks the tabs that are still recording with a pulsing dot", () => {
    const { container } = render(<ReplayTabSwitcher {...makeProps()} />);
    const pills: Array<HTMLElement> = screen.getAllByTestId("replay-tab-pill");

    const openDot: HTMLElement | null = pills[0]!.querySelector(
      "span[aria-hidden='true']",
    );
    const closedDot: HTMLElement | null = pills[1]!.querySelector(
      "span[aria-hidden='true']",
    );

    expect(openDot?.className).toContain("animate-pulse");
    expect(openDot?.className).toContain("bg-emerald-500");
    expect(closedDot?.className).toContain("bg-gray-400");
    expect(closedDot?.className).not.toContain("animate-pulse");
    expect(container.textContent).not.toContain("undefined");
  });

  /* A row of identical gray dots on a finished session says nothing. */
  it("draws no dots when every tab has closed", () => {
    renderSwitcher({
      tabs: [
        makeTab({ tabId: "tab-1", label: "Tab 1", isActive: true }),
        makeTab({ tabId: "tab-2", label: "Tab 2" }),
      ],
    });

    screen
      .getAllByTestId("replay-tab-pill")
      .forEach((pill: HTMLElement): void => {
        expect(pill.querySelector("span[aria-hidden='true']")).toBeNull();
      });
  });

  it("marks where the open run ends, but only when both are on screen", () => {
    const { rerender } = render(<ReplayTabSwitcher {...makeProps()} />);

    const divider: HTMLElement = screen.getByTestId("replay-tab-strip-divider");

    expect(divider).toHaveTextContent("Closed");
    expect(divider).toHaveAttribute("aria-hidden", "true");

    /* Every tab still open: nothing to divide. */
    rerender(
      <ReplayTabSwitcher
        {...makeProps({
          tabs: [
            makeTab({
              tabId: "tab-1",
              label: "Tab 1",
              status: "open",
              isActive: true,
            }),
            makeTab({ tabId: "tab-2", label: "Tab 2", status: "open" }),
          ],
        })}
      />,
    );

    expect(
      screen.queryByTestId("replay-tab-strip-divider"),
    ).not.toBeInTheDocument();

    /* Every tab closed: the divider would label the whole strip. */
    rerender(
      <ReplayTabSwitcher
        {...makeProps({
          tabs: [
            makeTab({ tabId: "tab-1", label: "Tab 1", isActive: true }),
            makeTab({ tabId: "tab-2", label: "Tab 2" }),
          ],
        })}
      />,
    );

    expect(
      screen.queryByTestId("replay-tab-strip-divider"),
    ).not.toBeInTheDocument();
  });

  it("wraps the strip instead of scrolling it sideways", () => {
    renderSwitcher();

    const tablist: HTMLElement = screen.getByRole("tablist");

    expect(tablist).toHaveAttribute(
      "aria-label",
      "Browser tabs in this recording",
    );
    expect(tablist.className).toContain("flex-wrap");
    expect(tablist.className).not.toContain("overflow-x-auto");
  });

  it("switches only to another tab that has footage", () => {
    const props: ReplayTabSwitcherProps = renderSwitcher();
    const pills: Array<HTMLElement> = screen.getAllByTestId("replay-tab-pill");

    fireEvent.click(pills[0] as HTMLElement);
    expect(props.onSwitchTab).not.toHaveBeenCalled();

    fireEvent.click(pills[2] as HTMLElement);
    expect(props.onSwitchTab).not.toHaveBeenCalled();

    fireEvent.click(pills[1] as HTMLElement);
    expect(props.onSwitchTab).toHaveBeenCalledWith("tab-2");
    expect(props.onSwitchTab).toHaveBeenCalledTimes(1);
  });

  it("carries tab semantics: aria-selected and one focus stop", () => {
    renderSwitcher();

    const pills: Array<HTMLElement> = screen.getAllByTestId("replay-tab-pill");

    expect(pills[0]).toHaveAttribute("aria-selected", "true");
    expect(pills[1]).toHaveAttribute("aria-selected", "false");
    expect(pills[0]).toHaveAttribute("tabindex", "0");
    expect(pills[1]).toHaveAttribute("tabindex", "-1");
    expect(pills[2]).toHaveAttribute("tabindex", "-1");
  });

  it("keeps a playable tab keyboard reachable when the active tab has no footage", () => {
    renderSwitcher({
      tabs: makeTabs().map((tab: ReplayTabSummary): ReplayTabSummary => {
        return { ...tab, isActive: tab.tabId === "tab-3" };
      }),
    });

    const pills: Array<HTMLElement> = screen.getAllByTestId("replay-tab-pill");

    expect(pills[0]).toHaveAttribute("tabindex", "0");
    expect(pills[2]).toHaveAttribute("tabindex", "-1");
  });

  it("moves focus and switches with the arrow keys, skipping empty tabs and wrapping", () => {
    const props: ReplayTabSwitcherProps = renderSwitcher();
    const pills: Array<HTMLElement> = screen.getAllByTestId("replay-tab-pill");

    fireEvent.keyDown(pills[0] as HTMLElement, { key: "ArrowRight" });
    expect(pills[1]).toHaveFocus();
    expect(props.onSwitchTab).toHaveBeenLastCalledWith("tab-2");

    /* Wraps past the footage-less tab back to the first. */
    fireEvent.keyDown(pills[1] as HTMLElement, { key: "ArrowRight" });
    expect(pills[0]).toHaveFocus();
    /* Tab 1 is already the active tab, so nothing is reloaded. */
    expect(props.onSwitchTab).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(pills[0] as HTMLElement, { key: "ArrowLeft" });
    expect(pills[1]).toHaveFocus();
    expect(props.onSwitchTab).toHaveBeenCalledTimes(2);
  });

  it("supports Home and End without leaking them to the playback shortcuts", () => {
    const props: ReplayTabSwitcherProps = renderSwitcher();
    const onWindowKey: MockFunction = getJestMockFunction();

    window.addEventListener("keydown", onWindowKey);

    try {
      const pills: Array<HTMLElement> =
        screen.getAllByTestId("replay-tab-pill");

      fireEvent.keyDown(pills[0] as HTMLElement, { key: "End" });
      expect(pills[1]).toHaveFocus();
      expect(props.onSwitchTab).toHaveBeenCalledWith("tab-2");

      fireEvent.keyDown(pills[1] as HTMLElement, { key: "Home" });
      expect(pills[0]).toHaveFocus();
      expect(onWindowKey).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener("keydown", onWindowKey);
    }
  });

  it("leaves browser shortcuts and unrelated keys alone", () => {
    const props: ReplayTabSwitcherProps = renderSwitcher();
    const first: HTMLElement = screen.getAllByTestId(
      "replay-tab-pill",
    )[0] as HTMLElement;

    fireEvent.keyDown(first, { key: "ArrowLeft", altKey: true });
    fireEvent.keyDown(first, { key: "ArrowRight", ctrlKey: true });
    fireEvent.keyDown(first, { key: "ArrowRight", metaKey: true });
    fireEvent.keyDown(first, { key: "a" });

    expect(props.onSwitchTab).not.toHaveBeenCalled();
  });
});

describe("ReplayTabSwitcher long strips", () => {
  it("shows every pill and no picker up to six tabs", () => {
    renderSwitcher({ tabs: makeManyTabs(REPLAY_TAB_STRIP_MAX_PILLS, 1) });

    expect(screen.getAllByTestId("replay-tab-pill")).toHaveLength(6);
    expect(
      screen.queryByTestId("replay-tab-picker-button"),
    ).not.toBeInTheDocument();
  });

  it("stops listing every tab past six and offers the picker instead", () => {
    const tabs: Array<ReplayTabSummary> = makeManyTabs(11, 2);

    tabs[5] = { ...(tabs[5] as ReplayTabSummary), isActive: true };

    renderSwitcher({ tabs: tabs });

    /* The two open tabs, plus the one being watched. */
    expect(pillIds()).toEqual(["tab-1", "tab-2", "tab-6"]);

    const button: HTMLElement = screen.getByTestId("replay-tab-picker-button");

    expect(button).toHaveTextContent("All 11 tabs");
    expect(button).toHaveAttribute("aria-haspopup", "listbox");
    expect(button).toHaveAttribute("aria-expanded", "false");
  });

  it("keeps the tab being watched on the strip even when the open tabs fill it", () => {
    const tabs: Array<ReplayTabSummary> = makeManyTabs(12, 8);

    tabs[11] = { ...(tabs[11] as ReplayTabSummary), isActive: true };

    renderSwitcher({ tabs: tabs });

    const ids: Array<string | null> = pillIds();

    expect(ids).toHaveLength(REPLAY_TAB_STRIP_MAX_PILLS);
    expect(ids).toContain("tab-12");
  });
});

describe("ReplayTabSwitcher picker", () => {
  function renderManyTabs(
    overrides?: Partial<ReplayTabSwitcherProps>,
  ): ReplayTabSwitcherProps {
    const tabs: Array<ReplayTabSummary> = makeManyTabs(8, 2);

    tabs[3] = { ...(tabs[3] as ReplayTabSummary), isActive: true };
    tabs[7] = {
      ...(tabs[7] as ReplayTabSummary),
      status: "empty",
      hasFootage: false,
      durationMs: 0,
      openedAtMs: null,
      closedAtMs: null,
      firstUrl: "",
      lastUrl: "",
    };

    return renderSwitcher({ tabs: tabs, ...overrides });
  }

  it("opens on click, marks itself expanded, and focuses the filter", () => {
    renderManyTabs();

    const picker: HTMLElement = openPicker();

    expect(picker).toBeInTheDocument();
    expect(screen.getByTestId("replay-tab-picker-button")).toHaveAttribute(
      "aria-expanded",
      "true",
    );

    const search: HTMLElement = screen.getByTestId("replay-tab-picker-search");

    expect(search).toHaveFocus();
    expect(search).toHaveAttribute("aria-label", "Filter tabs");
    expect(search).toHaveAttribute("placeholder", "Filter by page or tab");
    expect(
      within(picker).getByRole("listbox", { name: "Browser tabs" }),
    ).toBeInTheDocument();
  });

  it("lists every tab, grouped and counted by status", () => {
    renderManyTabs();
    openPicker();

    const groups: Array<HTMLElement> =
      screen.getAllByTestId("replay-tab-group");

    expect(
      groups.map((group: HTMLElement): string | null => {
        return group.getAttribute("data-group");
      }),
    ).toEqual(["open", "closed", "empty"]);
    expect(groups[0]).toHaveTextContent("Open · 2");
    expect(groups[1]).toHaveTextContent("Closed · 5");
    expect(groups[2]).toHaveTextContent("No footage · 1");
    expect(screen.getAllByTestId("replay-tab-option")).toHaveLength(8);
  });

  it("drops the heading when one untitled group is the whole list", () => {
    const tabs: Array<ReplayTabSummary> = makeManyTabs(8, 0);

    tabs[0] = { ...(tabs[0] as ReplayTabSummary), isActive: true };

    renderSwitcher({ tabs: tabs });
    openPicker();

    expect(screen.queryByTestId("replay-tab-group")).not.toBeInTheDocument();
    expect(screen.getAllByTestId("replay-tab-option")).toHaveLength(8);
  });

  it("describes each tab: page, when it opened, how long, and what went wrong", () => {
    const tabs: Array<ReplayTabSummary> = makeManyTabs(8, 2);

    tabs[2] = {
      ...(tabs[2] as ReplayTabSummary),
      isActive: true,
      openedAtMs: 134000,
      closedAtMs: 164000,
      errorCount: 3,
      frustrationCount: 2,
      lastUrl: "https://app.acme.com/checkout?step=2",
    };

    renderSwitcher({ tabs: tabs });
    openPicker();

    const option: HTMLElement = screen
      .getAllByTestId("replay-tab-option")
      .find((element: HTMLElement): boolean => {
        return element.getAttribute("data-tab-id") === "tab-3";
      }) as HTMLElement;

    expect(option).toHaveTextContent("Tab 3");
    expect(option).toHaveTextContent("/checkout?step=2");
    expect(option).toHaveTextContent("opened 2:14");
    expect(option).toHaveTextContent("30s");
    expect(option).toHaveTextContent("Watching");
    expect(option).toHaveAttribute("aria-selected", "true");
    expect(
      within(option).getByTestId("replay-tab-option-errors"),
    ).toHaveTextContent("3");
    expect(
      within(option).getByTestId("replay-tab-option-frustrations"),
    ).toHaveTextContent("2");
    expect(within(option).getByText("/checkout?step=2")).toHaveAttribute(
      "title",
      "https://app.acme.com/checkout?step=2",
    );
  });

  it("omits the error and frustration counts when there are none", () => {
    renderManyTabs();
    openPicker();

    expect(
      screen.queryByTestId("replay-tab-option-errors"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("replay-tab-option-frustrations"),
    ).not.toBeInTheDocument();
  });

  it("draws each tab's span against the session clock", () => {
    const tabs: Array<ReplayTabSummary> = makeManyTabs(8, 2);

    tabs[0] = {
      ...(tabs[0] as ReplayTabSummary),
      isActive: true,
      openedAtMs: 60000,
      closedAtMs: 180000,
    };

    renderSwitcher({ tabs: tabs, sessionDurationMs: SESSION_DURATION_MS });
    openPicker();

    const span: HTMLElement = screen.getAllByTestId(
      "replay-tab-option-span",
    )[0] as HTMLElement;

    expect(span.style.left).toBe("10%");
    expect(span.style.width).toBe("20%");
  });

  /*
   * A tab can report footage past the length its caller gave (a clock
   * skew, a chunk flushed after the session was sealed, or simply a
   * caller handing over the watched tab's length). The switcher takes the
   * tabs as the floor for the session, so such a tab stretches the scale
   * rather than being drawn outside the track or piled against its end.
   */
  it("keeps every bar inside the track when a tab runs past the given length", () => {
    const tabs: Array<ReplayTabSummary> = makeManyTabs(8, 2);

    tabs[0] = {
      ...(tabs[0] as ReplayTabSummary),
      isActive: true,
      openedAtMs: 590000,
      closedAtMs: 900000,
    };

    renderSwitcher({ tabs: tabs, sessionDurationMs: SESSION_DURATION_MS });
    openPicker();

    const spans: Array<HTMLElement> = screen.getAllByTestId(
      "replay-tab-option-span",
    );

    spans.forEach((span: HTMLElement): void => {
      const left: number = readPercent(span.style.left);
      const width: number = readPercent(span.style.width);

      expect(left).toBeGreaterThanOrEqual(0);
      expect(width).toBeGreaterThanOrEqual(0);
      expect(left + width).toBeLessThanOrEqual(100.0001);
    });

    /* The overrunning tab ends at the end of the track, not beyond it. */
    const overrun: { left: number; width: number } = spanOf("tab-1");

    expect(overrun.left + overrun.width).toBeCloseTo(100, 6);
    /* And it is not a 2% sliver at the far end: it is the longest tab here. */
    expect(overrun.width).toBeGreaterThan(REPLAY_TAB_SPAN_MIN_WIDTH_PERCENT);
  });

  it("draws no span when neither the caller nor the tabs place anything on a clock", () => {
    const tabs: Array<ReplayTabSummary> = makeManyTabs(8, 2).map(
      (tab: ReplayTabSummary): ReplayTabSummary => {
        return {
          ...tab,
          durationMs: 0,
          openedAtMs: null,
          closedAtMs: null,
        };
      },
    );

    tabs[0] = { ...(tabs[0] as ReplayTabSummary), isActive: true };

    renderSwitcher({ tabs: tabs, sessionDurationMs: 0 });
    openPicker();

    expect(
      screen.queryByTestId("replay-tab-option-span"),
    ).not.toBeInTheDocument();
  });

  /*
   * The whole point of the span bars, and the bug that took it away.
   *
   * The header used to hand the switcher its `durationMs`, which follows
   * the ENGINE - so it is the footage of the tab being WATCHED, not the
   * session. Every other tab was then scaled by one tab's length, and an
   * eight-tab recording came out as three bars at left 0% / width 100%
   * with every later tab pinned at left 98%: a timeline that answered
   * nothing at all. The switcher now floors the scale with the furthest
   * point its own tabs reach, so the same call lays them out correctly.
   *
   * The session below is the shape the recorder actually produces: three
   * 30s windows of a 90s recording, tabs opening as the visitor navigates.
   */
  function makeSessionSpanTabs(): Array<ReplayTabSummary> {
    const windows: Array<[number, number]> = [
      [0, 30000],
      [0, 60000],
      [0, 90000],
      [30000, 60000],
      [30000, 90000],
      [60000, 90000],
      [60000, 90000],
    ];

    const tabs: Array<ReplayTabSummary> = windows.map(
      (window: [number, number], index: number): ReplayTabSummary => {
        return makeTab({
          tabId: `tab-${index + 1}`,
          label: `Tab ${index + 1}`,
          status: "closed",
          isActive: index === 0,
          openedAtMs: window[0],
          closedAtMs: window[1],
          durationMs: window[1] - window[0],
          firstUrl: `https://shop.example.com/page-${index + 1}`,
          lastUrl: `https://shop.example.com/page-${index + 1}`,
        });
      },
    );

    /* The eighth tab minted an id and never flushed: no place on the clock. */
    tabs.push(
      makeTab({
        tabId: "tab-8",
        label: "Tab 8",
        status: "empty",
        hasFootage: false,
        durationMs: 0,
        openedAtMs: null,
        closedAtMs: null,
        firstUrl: "",
        lastUrl: "",
      }),
    );

    return tabs;
  }

  /* Tab 1 is the watched tab, and 30s is the figure the engine reports. */
  const WATCHED_TAB_DURATION_MS: number = 30000;
  const WHOLE_SESSION_MS: number = 90000;

  function expectSessionSpanLayout(): void {
    /*
     * Thirds of the session, which is where these tabs actually sit. The
     * broken layout put tabs 1-3 at left 0% / width 100% and tabs 4-7 at
     * left 98%.
     */
    expect(spanOf("tab-1").left).toBeCloseTo(0, 6);
    expect(spanOf("tab-1").width).toBeCloseTo(100 / 3, 6);
    expect(spanOf("tab-2").left).toBeCloseTo(0, 6);
    expect(spanOf("tab-2").width).toBeCloseTo(200 / 3, 6);
    expect(spanOf("tab-3").left).toBeCloseTo(0, 6);
    expect(spanOf("tab-3").width).toBeCloseTo(100, 6);
    expect(spanOf("tab-4").left).toBeCloseTo(100 / 3, 6);
    expect(spanOf("tab-4").width).toBeCloseTo(100 / 3, 6);
    expect(spanOf("tab-5").left).toBeCloseTo(100 / 3, 6);
    expect(spanOf("tab-5").width).toBeCloseTo(200 / 3, 6);
    expect(spanOf("tab-6").left).toBeCloseTo(200 / 3, 6);
    expect(spanOf("tab-6").width).toBeCloseTo(100 / 3, 6);
    expect(spanOf("tab-7").left).toBeCloseTo(200 / 3, 6);

    /* Seven placeable tabs; the one that stored nothing draws no bar. */
    expect(screen.getAllByTestId("replay-tab-option-span")).toHaveLength(7);
  }

  it("draws the bars against the whole session even when handed the watched tab's length", () => {
    renderSwitcher({
      tabs: makeSessionSpanTabs(),
      sessionDurationMs: WATCHED_TAB_DURATION_MS,
    });
    openPicker();

    expectSessionSpanLayout();

    /* The exact shape of the bug, named so a regression says what it is. */
    expect(spanOf("tab-1").width).not.toBeCloseTo(100, 3);
    expect(spanOf("tab-2").width).not.toBeCloseTo(100, 3);
    expect(spanOf("tab-4").left).not.toBeCloseTo(98, 3);
    expect(spanOf("tab-7").left).not.toBeCloseTo(98, 3);

    /* Later tabs sit further right than earlier ones, which is the point. */
    expect(spanOf("tab-1").left).toBeLessThan(spanOf("tab-4").left);
    expect(spanOf("tab-4").left).toBeLessThan(spanOf("tab-6").left);
    expect(spanOf("tab-1").width).toBeLessThan(spanOf("tab-2").width);
    expect(spanOf("tab-2").width).toBeLessThan(spanOf("tab-3").width);
  });

  it("lays them out identically when the caller does pass the session's length", () => {
    renderSwitcher({
      tabs: makeSessionSpanTabs(),
      sessionDurationMs: WHOLE_SESSION_MS,
    });
    openPicker();

    expectSessionSpanLayout();
  });

  /*
   * A live recording is the case the floor cannot cover on its own: the
   * session has run past every tab's last flushed chunk, and only the
   * caller knows how far. The caller's figure has to win there.
   */
  it("keeps a caller's longer session length over the tabs' own reach", () => {
    renderSwitcher({
      tabs: makeSessionSpanTabs(),
      sessionDurationMs: WHOLE_SESSION_MS * 2,
    });
    openPicker();

    expect(spanOf("tab-3").width).toBeCloseTo(50, 6);
    expect(spanOf("tab-6").left).toBeCloseTo(100 / 3, 6);
  });

  it("filters by page, by tab name and by ordinal", () => {
    renderManyTabs();
    openPicker();

    const search: HTMLElement = screen.getByTestId("replay-tab-picker-search");

    fireEvent.change(search, { target: { value: "page-3" } });
    expect(optionIds()).toEqual(["tab-3"]);

    fireEvent.change(search, { target: { value: "tab 5" } });
    expect(optionIds()).toEqual(["tab-5"]);

    fireEvent.change(search, { target: { value: "#7" } });
    expect(optionIds()).toEqual(["tab-7"]);

    fireEvent.change(search, { target: { value: "   " } });
    expect(screen.getAllByTestId("replay-tab-option")).toHaveLength(8);
  });

  it("says so when nothing matches, naming what was typed", () => {
    renderManyTabs();
    openPicker();

    fireEvent.change(screen.getByTestId("replay-tab-picker-search"), {
      target: { value: "zzz" },
    });

    expect(screen.getByTestId("replay-tab-picker-empty")).toHaveTextContent(
      "No tab matches “zzz”",
    );
    expect(screen.queryByTestId("replay-tab-option")).not.toBeInTheDocument();
  });

  it("switches to the chosen tab and closes", () => {
    const props: ReplayTabSwitcherProps = renderManyTabs();

    openPicker();

    const option: HTMLElement = screen
      .getAllByTestId("replay-tab-option")
      .find((element: HTMLElement): boolean => {
        return element.getAttribute("data-tab-id") === "tab-6";
      }) as HTMLElement;

    fireEvent.click(option);

    expect(props.onSwitchTab).toHaveBeenCalledWith("tab-6");
    expect(screen.queryByTestId("replay-tab-picker")).not.toBeInTheDocument();
    expect(screen.getByTestId("replay-tab-picker-button")).toHaveFocus();
  });

  /* Re-picking the tab on screen would restart it from zero. */
  it("closes without reloading when the watched tab is chosen", () => {
    const props: ReplayTabSwitcherProps = renderManyTabs();

    openPicker();

    const option: HTMLElement = screen
      .getAllByTestId("replay-tab-option")
      .find((element: HTMLElement): boolean => {
        return element.getAttribute("aria-selected") === "true";
      }) as HTMLElement;

    fireEvent.click(option);

    expect(props.onSwitchTab).not.toHaveBeenCalled();
    expect(screen.queryByTestId("replay-tab-picker")).not.toBeInTheDocument();
  });

  it("refuses a tab with no footage without closing", () => {
    const props: ReplayTabSwitcherProps = renderManyTabs();

    openPicker();

    const option: HTMLElement = screen
      .getAllByTestId("replay-tab-option")
      .find((element: HTMLElement): boolean => {
        return element.getAttribute("data-tab-status") === "empty";
      }) as HTMLElement;

    expect(option).toHaveAttribute("aria-disabled", "true");
    expect(option).toBeDisabled();

    fireEvent.click(option);

    expect(props.onSwitchTab).not.toHaveBeenCalled();
    expect(screen.getByTestId("replay-tab-picker")).toBeInTheDocument();
  });

  it("closes on an outside click and on a second press of its button", () => {
    renderManyTabs();

    openPicker();
    fireEvent.mouseDown(document.body);
    fireEvent.click(document.body);

    expect(screen.queryByTestId("replay-tab-picker")).not.toBeInTheDocument();

    openPicker();
    fireEvent.click(screen.getByTestId("replay-tab-picker-button"));

    expect(screen.queryByTestId("replay-tab-picker")).not.toBeInTheDocument();
  });

  it("forgets the filter between openings", () => {
    renderManyTabs();

    openPicker();
    fireEvent.change(screen.getByTestId("replay-tab-picker-search"), {
      target: { value: "page-3" },
    });
    expect(optionIds()).toEqual(["tab-3"]);

    fireEvent.keyDown(screen.getByTestId("replay-tab-picker-search"), {
      key: "Escape",
    });

    openPicker();

    expect(screen.getByTestId("replay-tab-picker-search")).toHaveValue("");
    expect(screen.getAllByTestId("replay-tab-option")).toHaveLength(8);
  });

  /*
   * Escape and choosing a tab go through closePicker, which clears the
   * query. The two commonest ways to dismiss a popover do NOT: an outside
   * click and a second press on the trigger both flip the outside-click
   * hook's own state, and the query used to survive them. A viewer who
   * dismissed the picker that way reopened it to one tab out of eight,
   * under a button that still read "All 8 tabs" - so the picker clears the
   * filter whenever it closes, however it closed.
   */
  it("forgets the filter when an outside click dismissed the picker", () => {
    renderManyTabs();

    openPicker();
    fireEvent.change(screen.getByTestId("replay-tab-picker-search"), {
      target: { value: "page-3" },
    });
    expect(optionIds()).toEqual(["tab-3"]);

    fireEvent.mouseDown(document.body);
    fireEvent.click(document.body);

    expect(screen.queryByTestId("replay-tab-picker")).not.toBeInTheDocument();

    openPicker();

    expect(screen.getByTestId("replay-tab-picker-search")).toHaveValue("");
    expect(screen.getAllByTestId("replay-tab-option")).toHaveLength(8);
  });

  it("forgets the filter when a second press on the trigger dismissed the picker", () => {
    renderManyTabs();

    openPicker();
    fireEvent.change(screen.getByTestId("replay-tab-picker-search"), {
      target: { value: "page-3" },
    });
    expect(optionIds()).toEqual(["tab-3"]);

    fireEvent.click(screen.getByTestId("replay-tab-picker-button"));

    expect(screen.queryByTestId("replay-tab-picker")).not.toBeInTheDocument();

    openPicker();

    expect(screen.getByTestId("replay-tab-picker-search")).toHaveValue("");
    expect(screen.getAllByTestId("replay-tab-option")).toHaveLength(8);
    expect(screen.queryByTestId("replay-tab-picker-empty")).toBeNull();
  });

  /* A filter that found nothing must not survive a dismissal either. */
  it("forgets a filter that matched nothing when the picker is dismissed", () => {
    renderManyTabs();

    openPicker();
    fireEvent.change(screen.getByTestId("replay-tab-picker-search"), {
      target: { value: "zzz" },
    });
    expect(screen.getByTestId("replay-tab-picker-empty")).toBeInTheDocument();

    fireEvent.mouseDown(document.body);
    fireEvent.click(document.body);
    openPicker();

    expect(screen.getByTestId("replay-tab-picker-search")).toHaveValue("");
    expect(screen.queryByTestId("replay-tab-picker-empty")).toBeNull();
    expect(screen.getAllByTestId("replay-tab-option")).toHaveLength(8);
  });
});

describe("ReplayTabSwitcher picker keyboard", () => {
  function renderManyTabs(): ReplayTabSwitcherProps {
    const tabs: Array<ReplayTabSummary> = makeManyTabs(8, 2);

    tabs[0] = { ...(tabs[0] as ReplayTabSummary), isActive: true };
    tabs[7] = {
      ...(tabs[7] as ReplayTabSummary),
      status: "empty",
      hasFootage: false,
      durationMs: 0,
      openedAtMs: null,
    };

    return renderSwitcher({ tabs: tabs });
  }

  it("walks the list with the arrow keys and skips what cannot be played", () => {
    renderManyTabs();
    openPicker();

    const search: HTMLElement = screen.getByTestId("replay-tab-picker-search");
    const options: Array<HTMLElement> =
      screen.getAllByTestId("replay-tab-option");
    const last: HTMLElement = options[options.length - 1] as HTMLElement;

    fireEvent.keyDown(search, { key: "ArrowDown" });
    expect(options[0]).toHaveFocus();

    fireEvent.keyDown(options[0] as HTMLElement, { key: "ArrowDown" });
    expect(options[1]).toHaveFocus();

    fireEvent.keyDown(options[1] as HTMLElement, { key: "End" });
    /* The footage-less tab is last in display order and is skipped. */
    expect(last).not.toHaveFocus();
    expect(options[options.length - 2]).toHaveFocus();

    fireEvent.keyDown(options[options.length - 2] as HTMLElement, {
      key: "Home",
    });
    expect(options[0]).toHaveFocus();
  });

  it("returns to the filter box above the first option", () => {
    renderManyTabs();
    openPicker();

    const search: HTMLElement = screen.getByTestId("replay-tab-picker-search");
    const options: Array<HTMLElement> =
      screen.getAllByTestId("replay-tab-option");

    fireEvent.keyDown(search, { key: "ArrowDown" });
    expect(options[0]).toHaveFocus();

    fireEvent.keyDown(options[0] as HTMLElement, { key: "ArrowUp" });
    expect(search).toHaveFocus();
  });

  it("selects the focused option with Enter and with Space", () => {
    const first: ReplayTabSwitcherProps = renderManyTabs();

    openPicker();

    let options: Array<HTMLElement> =
      screen.getAllByTestId("replay-tab-option");

    fireEvent.keyDown(screen.getByTestId("replay-tab-picker-search"), {
      key: "ArrowDown",
    });
    fireEvent.keyDown(options[0] as HTMLElement, { key: "ArrowDown" });
    fireEvent.keyDown(options[1] as HTMLElement, { key: "Enter" });

    expect(first.onSwitchTab).toHaveBeenCalledWith("tab-2");
    expect(screen.queryByTestId("replay-tab-picker")).not.toBeInTheDocument();

    openPicker();
    options = screen.getAllByTestId("replay-tab-option");
    fireEvent.keyDown(screen.getByTestId("replay-tab-picker-search"), {
      key: "ArrowDown",
    });
    fireEvent.keyDown(options[0] as HTMLElement, { key: "ArrowDown" });
    fireEvent.keyDown(options[1] as HTMLElement, { key: " " });

    expect(first.onSwitchTab).toHaveBeenCalledTimes(2);
    expect(screen.queryByTestId("replay-tab-picker")).not.toBeInTheDocument();
  });

  it("takes the first match when Enter is pressed straight from the filter", () => {
    const props: ReplayTabSwitcherProps = renderManyTabs();

    openPicker();
    fireEvent.change(screen.getByTestId("replay-tab-picker-search"), {
      target: { value: "page-5" },
    });
    fireEvent.keyDown(screen.getByTestId("replay-tab-picker-search"), {
      key: "Enter",
    });

    expect(props.onSwitchTab).toHaveBeenCalledWith("tab-5");
    expect(screen.queryByTestId("replay-tab-picker")).not.toBeInTheDocument();
  });

  it("closes on Escape and hands focus back to the button", () => {
    renderManyTabs();
    openPicker();

    fireEvent.keyDown(screen.getByTestId("replay-tab-picker-search"), {
      key: "ArrowDown",
    });
    fireEvent.keyDown(
      screen.getAllByTestId("replay-tab-option")[0] as HTMLElement,
      {
        key: "Escape",
      },
    );

    expect(screen.queryByTestId("replay-tab-picker")).not.toBeInTheDocument();
    expect(screen.getByTestId("replay-tab-picker-button")).toHaveFocus();
  });

  /*
   * The player reads Space (play/pause), Enter, Escape (leave theater)
   * and the arrows (seek) off the window. Choosing a tab must do none of
   * those.
   */
  it("keeps Space, Enter, Escape and the arrows out of the player's shortcuts", () => {
    renderManyTabs();
    openPicker();

    const onWindowKey: MockFunction = getJestMockFunction();

    window.addEventListener("keydown", onWindowKey);

    try {
      const search: HTMLElement = screen.getByTestId(
        "replay-tab-picker-search",
      );

      fireEvent.keyDown(search, { key: " " });
      fireEvent.keyDown(search, { key: "ArrowDown" });

      const option: HTMLElement = screen.getAllByTestId(
        "replay-tab-option",
      )[0] as HTMLElement;

      fireEvent.keyDown(option, { key: "ArrowDown" });
      fireEvent.keyDown(option, { key: "Escape" });

      expect(onWindowKey).not.toHaveBeenCalled();
    } finally {
      window.removeEventListener("keydown", onWindowKey);
    }
  });
});

describe("ReplayTabSwitcher copy helpers", () => {
  it("readReplayTabUrl prefers the last page the tab reached", () => {
    expect(
      readReplayTabUrl(
        makeTab({
          firstUrl: "https://app.acme.com/cart",
          lastUrl: "https://app.acme.com/checkout",
        }),
      ),
    ).toBe("https://app.acme.com/checkout");
    expect(
      readReplayTabUrl(
        makeTab({ firstUrl: "https://app.acme.com/cart", lastUrl: "" }),
      ),
    ).toBe("https://app.acme.com/cart");
    expect(readReplayTabUrl(makeTab({ firstUrl: "", lastUrl: "" }))).toBe("");
    expect(
      readReplayTabUrl({
        tabId: "tab-1",
        label: "Tab 1",
        durationMs: 0,
        openedAtMs: null,
        hasFootage: false,
        isActive: false,
      }),
    ).toBe("");
  });

  it("describeReplayTabDuration names the empty case instead of printing 0s", () => {
    expect(describeReplayTabDuration(makeTab({ durationMs: 30000 }))).toBe(
      "30s",
    );
    expect(
      describeReplayTabDuration(makeTab({ hasFootage: false, durationMs: 0 })),
    ).toBe("no footage");
  });

  it("buildReplayTabPillTitle omits the parts it does not know", () => {
    expect(
      buildReplayTabPillTitle(
        makeTab({ hasFootage: false, durationMs: 0, openedAtMs: null }),
      ),
    ).toBe("No footage stored for this tab");

    /* No status reported: the tooltip claims neither open nor closed. */
    expect(
      buildReplayTabPillTitle({
        tabId: "tab-2",
        label: "Tab 2",
        durationMs: 30000,
        openedAtMs: 0,
        hasFootage: true,
        isActive: false,
      }),
    ).toBe("Tab 2 · 30s — switch to this tab; the playhead stays where it is");

    /* No url reported: "Unknown page" is not worth a segment. */
    expect(
      buildReplayTabPillTitle(
        makeTab({
          label: "Tab 4",
          status: "closed",
          firstUrl: "",
          lastUrl: "",
          openedAtMs: 0,
        }),
      ),
    ).toBe(
      "Tab 4 · Closed · 30s — switch to this tab; the playhead stays where it is",
    );
  });
});
