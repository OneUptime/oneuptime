import SavedViewsFacetSection from "../../../UI/Components/SavedViews/SavedViewsFacetSection";
import LogsFacetSidebar from "../../../UI/Components/LogsViewer/components/LogsFacetSidebar";
import { SavedViewListItem } from "../../../UI/Components/SavedViews/SavedViewsList";
import { LogsSavedViewOption } from "../../../UI/Components/LogsViewer/types";
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

/*
 * Issue 3319: the logs sidebar listed every saved view in a bare block that
 * sat directly above facet sections which collapse, search and count. At two
 * views nobody noticed; at twenty the panel was a scroll with no way to find
 * anything. This pins the section's new behaviour — the same chrome as the
 * facets beside it — and the sidebar wiring that mounts it.
 */

const SEARCH_LABEL: string = "Search saved views...";
const NO_MATCHES: string = "No matches found";

function makeViews(count: number): Array<SavedViewListItem> {
  const views: Array<SavedViewListItem> = [];

  for (let index: number = 1; index <= count; index++) {
    views.push({ id: `view-${index}`, name: `View ${index}` });
  }

  return views;
}

const NAMED_VIEWS: Array<SavedViewListItem> = [
  { id: "ims", name: "IMS Logs" },
  { id: "qa", name: "QA-JDE", isDefault: true },
  { id: "checkout", name: "Checkout errors" },
  { id: "staging", name: "Staging checkout" },
  { id: "prod", name: "Prod fatals" },
  { id: "slow", name: "Slow requests" },
];

interface SectionHandlers {
  onSelect: (viewId: string) => void;
  onClear: () => void;
}

function makeHandlers(): SectionHandlers {
  return {
    onSelect: jest.fn(),
    onClear: jest.fn(),
  };
}

function renderSection(
  savedViews: Array<SavedViewListItem>,
  overrides: Partial<{
    selectedSavedViewId: string | null;
    onClear: (() => void) | undefined;
    initialVisibleCount: number;
  }> = {},
  handlers: SectionHandlers = makeHandlers(),
): SectionHandlers {
  render(
    <SavedViewsFacetSection
      savedViews={savedViews}
      selectedSavedViewId={overrides.selectedSavedViewId ?? null}
      onSelect={handlers.onSelect}
      onClear={"onClear" in overrides ? overrides.onClear : handlers.onClear}
      initialVisibleCount={overrides.initialVisibleCount}
    />,
  );

  return handlers;
}

function searchBox(): HTMLElement {
  return screen.getByPlaceholderText(SEARCH_LABEL);
}

function typeSearch(text: string): void {
  fireEvent.change(searchBox(), { target: { value: text } });
}

function rowFor(name: string | RegExp): HTMLElement {
  return screen.getByRole("button", { name: name });
}

/*
 * Saved-view rows are the only buttons that report a pressed state, which
 * makes aria-pressed a sharper handle than the name — the dropdown trigger
 * echoes the applied view's name and would otherwise be counted as a row.
 */
function visibleViewNames(): Array<string> {
  return screen
    .queryAllByRole("button")
    .filter((element: HTMLElement): boolean => {
      return element.hasAttribute("aria-pressed");
    })
    .map((element: HTMLElement): string => {
      return element.getAttribute("aria-label") || element.textContent || "";
    });
}

describe("SavedViewsFacetSection — the search box earns its space", () => {
  afterEach(() => {
    cleanup();
  });

  test("a short list gets no search box", () => {
    renderSection(makeViews(5));

    expect(screen.queryByPlaceholderText(SEARCH_LABEL)).toBeNull();
    expect(visibleViewNames()).toHaveLength(5);
  });

  test("a long enough list gets one", () => {
    renderSection(makeViews(6));

    expect(searchBox()).toBeInTheDocument();
  });

  test("the search box is named for anyone who cannot see the placeholder", () => {
    renderSection(makeViews(6));

    expect(
      screen.getByRole("textbox", { name: SEARCH_LABEL }),
    ).toBeInTheDocument();
  });
});

describe("SavedViewsFacetSection — searching narrows the list", () => {
  afterEach(() => {
    cleanup();
  });

  test("typing filters views by name, ignoring case", () => {
    renderSection(NAMED_VIEWS);

    typeSearch("CHECKOUT");

    expect(rowFor("Checkout errors")).toBeInTheDocument();
    expect(rowFor("Staging checkout")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "IMS Logs" })).toBeNull();
  });

  test("a search that matches nothing says so", () => {
    renderSection(NAMED_VIEWS);

    typeSearch("nothing here");

    expect(screen.getByText(NO_MATCHES)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "IMS Logs" })).toBeNull();
  });

  test("clearing the search puts every view back", () => {
    renderSection(NAMED_VIEWS);

    typeSearch("checkout");
    typeSearch("");

    expect(rowFor("IMS Logs")).toBeInTheDocument();
    expect(rowFor(/QA-JDE/)).toBeInTheDocument();
  });

  test("a matched view can still be applied", () => {
    const handlers: SectionHandlers = renderSection(NAMED_VIEWS);

    typeSearch("slow");
    fireEvent.click(rowFor("Slow requests"));

    expect(handlers.onSelect).toHaveBeenCalledWith("slow");
  });
});

describe("SavedViewsFacetSection — the tail collapses behind +N more", () => {
  afterEach(() => {
    cleanup();
  });

  test("only the first few views show, with the rest counted", () => {
    renderSection(makeViews(12));

    expect(visibleViewNames()).toEqual([
      "View 1",
      "View 2",
      "View 3",
      "View 4",
      "View 5",
    ]);
    expect(screen.getByRole("button", { name: "+7 more" })).toBeInTheDocument();
  });

  test("expanding shows the rest and offers to collapse again", () => {
    renderSection(makeViews(12));

    fireEvent.click(screen.getByRole("button", { name: "+7 more" }));

    expect(visibleViewNames()).toHaveLength(12);
    expect(
      screen.getByRole("button", { name: "Show less" }),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Show less" }));

    expect(visibleViewNames()).toHaveLength(5);
  });

  test("a list that already fits offers no toggle", () => {
    renderSection(makeViews(5));

    expect(screen.queryByRole("button", { name: /more$/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Show less" })).toBeNull();
  });

  test("neither half of the toggle sits beside a search result", () => {
    renderSection(makeViews(12));

    typeSearch("view 1");

    // View 1 and View 10-12 all match, and all four are shown.
    expect(visibleViewNames()).toEqual([
      "View 1",
      "View 10",
      "View 11",
      "View 12",
    ]);
    expect(screen.queryByRole("button", { name: /more$/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Show less" })).toBeNull();
  });

  test("expanding, then searching, does not leave a stray Show less behind", () => {
    renderSection(makeViews(12));

    fireEvent.click(screen.getByRole("button", { name: "+7 more" }));
    typeSearch("view 2");

    expect(screen.queryByRole("button", { name: "Show less" })).toBeNull();
  });

  test("the applied view stays in sight even when it sorts past the cut", () => {
    renderSection(makeViews(12), { selectedSavedViewId: "view-11" });

    expect(visibleViewNames()).toEqual([
      "View 1",
      "View 2",
      "View 3",
      "View 4",
      "View 5",
      "View 11",
    ]);
    // The pinned row is no longer hidden, so it is not counted as hidden.
    expect(screen.getByRole("button", { name: "+6 more" })).toBeInTheDocument();
  });
});

describe("SavedViewsFacetSection — applying and clearing", () => {
  afterEach(() => {
    cleanup();
  });

  test("clicking an unapplied view applies it", () => {
    const handlers: SectionHandlers = renderSection(NAMED_VIEWS);

    fireEvent.click(rowFor("IMS Logs"));

    expect(handlers.onSelect).toHaveBeenCalledWith("ims");
    expect(handlers.onClear).not.toHaveBeenCalled();
  });

  test("clicking the applied view clears it instead of re-applying it", () => {
    const handlers: SectionHandlers = renderSection(NAMED_VIEWS, {
      selectedSavedViewId: "ims",
    });

    fireEvent.click(rowFor("IMS Logs"));

    expect(handlers.onClear).toHaveBeenCalledTimes(1);
    expect(handlers.onSelect).not.toHaveBeenCalled();
  });

  test("without a clear handler the applied view re-applies, as before", () => {
    const handlers: SectionHandlers = renderSection(NAMED_VIEWS, {
      selectedSavedViewId: "ims",
      onClear: undefined,
    });

    fireEvent.click(rowFor("IMS Logs"));

    expect(handlers.onSelect).toHaveBeenCalledWith("ims");
  });

  test("the row reports its own applied state", () => {
    renderSection(NAMED_VIEWS, { selectedSavedViewId: "ims" });

    expect(rowFor("IMS Logs")).toHaveAttribute("aria-pressed", "true");
    expect(rowFor("Checkout errors")).toHaveAttribute("aria-pressed", "false");
  });

  test("a default view announces the word, not a stray badge", () => {
    renderSection(NAMED_VIEWS);

    expect(
      screen.getByRole("button", { name: "QA-JDE (default)" }),
    ).toBeInTheDocument();
  });

  test("the header counts the applied view, like a facet counts its selections", () => {
    const { rerender } = render(
      <SavedViewsFacetSection savedViews={NAMED_VIEWS} onSelect={jest.fn()} />,
    );

    const header: HTMLElement = screen.getByRole("button", {
      name: /Saved Views/,
    });
    expect(within(header).queryByText("1")).toBeNull();

    rerender(
      <SavedViewsFacetSection
        savedViews={NAMED_VIEWS}
        selectedSavedViewId="ims"
        onSelect={jest.fn()}
      />,
    );

    expect(
      within(screen.getByRole("button", { name: /Saved Views/ })).getByText(
        "1",
      ),
    ).toBeInTheDocument();
  });
});

describe("SavedViewsFacetSection — collapsing the section", () => {
  afterEach(() => {
    cleanup();
  });

  test("the section starts open", () => {
    renderSection(NAMED_VIEWS);

    expect(screen.getByRole("button", { name: /Saved Views/ })).toHaveAttribute(
      "aria-expanded",
      "true",
    );
  });

  test("collapsing hides the rows, the search box and the toggle", () => {
    renderSection(makeViews(12));

    fireEvent.click(screen.getByRole("button", { name: /Saved Views/ }));

    expect(screen.getByRole("button", { name: /Saved Views/ })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    expect(visibleViewNames()).toHaveLength(0);
    expect(screen.queryByPlaceholderText(SEARCH_LABEL)).toBeNull();
    expect(screen.queryByRole("button", { name: /more$/ })).toBeNull();
  });

  test("re-opening brings the list back", () => {
    renderSection(makeViews(12));

    const header: HTMLElement = screen.getByRole("button", {
      name: /Saved Views/,
    });
    fireEvent.click(header);
    fireEvent.click(header);

    expect(visibleViewNames()).toHaveLength(5);
  });
});

describe("LogsFacetSidebar mounts the saved views section", () => {
  afterEach(() => {
    cleanup();
  });

  function renderSidebar(savedViews: Array<LogsSavedViewOption>): void {
    render(
      <LogsFacetSidebar
        facetData={{}}
        isLoading={false}
        serviceMap={{}}
        onIncludeFilter={jest.fn()}
        onExcludeFilter={jest.fn()}
        savedViews={savedViews}
        selectedSavedViewId={null}
        onSavedViewSelect={jest.fn()}
        onClearSavedView={jest.fn()}
      />,
    );
  }

  test("the sidebar's saved views can be searched once there are enough of them", () => {
    renderSidebar(makeViews(8));

    expect(searchBox()).toBeInTheDocument();

    typeSearch("view 7");

    expect(visibleViewNames()).toEqual(["View 7"]);
  });

  test("the sidebar collapses its saved views tail like every facet below it", () => {
    renderSidebar(makeViews(8));

    expect(visibleViewNames()).toHaveLength(5);
    expect(screen.getByRole("button", { name: "+3 more" })).toBeInTheDocument();
  });

  test("a sidebar with no saved views renders no section at all", () => {
    renderSidebar([]);

    expect(screen.queryByRole("button", { name: /Saved Views/ })).toBeNull();
  });
});
