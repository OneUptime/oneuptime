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

/*
 * Deleting or creating a saved view never remounts the sidebar: the host
 * refetches and hands the same mounted section a different array. These cases
 * drive that path — one instance, a list that changes under it — which a fresh
 * render() per state cannot reach.
 */
interface LiveSectionOverrides {
  selectedSavedViewId?: string | null | undefined;
  initialVisibleCount?: number | undefined;
}

interface LiveSection {
  handlers: SectionHandlers;
  update: (
    savedViews: Array<SavedViewListItem>,
    overrides?: LiveSectionOverrides,
  ) => void;
}

function renderLiveSection(
  savedViews: Array<SavedViewListItem>,
  overrides: LiveSectionOverrides = {},
): LiveSection {
  const handlers: SectionHandlers = makeHandlers();

  function sectionFor(
    views: Array<SavedViewListItem>,
    current: LiveSectionOverrides,
  ): React.ReactElement {
    return (
      <SavedViewsFacetSection
        savedViews={views}
        selectedSavedViewId={current.selectedSavedViewId ?? null}
        onSelect={handlers.onSelect}
        onClear={handlers.onClear}
        initialVisibleCount={current.initialVisibleCount}
      />
    );
  }

  const { rerender } = render(sectionFor(savedViews, overrides));

  return {
    handlers: handlers,
    update: (
      views: Array<SavedViewListItem>,
      next: LiveSectionOverrides = overrides,
    ): void => {
      rerender(sectionFor(views, next));
    },
  };
}

function sectionHeader(title: RegExp = /Saved Views/): HTMLElement {
  return screen.getByRole("button", { name: title });
}

describe("SavedViewsFacetSection — the list changes under it", () => {
  afterEach(() => {
    cleanup();
  });

  test("a list that grows under an expanded tail stays whole", () => {
    const section: LiveSection = renderLiveSection(makeViews(12));

    fireEvent.click(screen.getByRole("button", { name: "+7 more" }));

    // A thirteenth view is saved while the sidebar is open.
    section.update(makeViews(13));

    expect(visibleViewNames()).toHaveLength(13);
    expect(
      screen.getByRole("button", { name: "Show less" }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /more$/ })).toBeNull();
  });

  test("deleting the applied view drops the badge and pins nothing", () => {
    const section: LiveSection = renderLiveSection(makeViews(12), {
      selectedSavedViewId: "view-11",
    });

    expect(visibleViewNames()).toHaveLength(6);

    /*
     * Between the delete and the host clearing its own selection there is a
     * render where selectedSavedViewId points at a view that is gone.
     */
    section.update(
      makeViews(12).filter((view: SavedViewListItem): boolean => {
        return view.id !== "view-11";
      }),
    );

    expect(visibleViewNames()).toEqual([
      "View 1",
      "View 2",
      "View 3",
      "View 4",
      "View 5",
    ]);
    expect(within(sectionHeader()).queryByText("1")).toBeNull();
    expect(screen.getByRole("button", { name: "+6 more" })).toBeInTheDocument();
  });

  test("the pinned row follows the applied view in and out of the collapsed slice", () => {
    const section: LiveSection = renderLiveSection(makeViews(12), {
      selectedSavedViewId: "view-3",
    });

    expect(visibleViewNames()).toEqual([
      "View 1",
      "View 2",
      "View 3",
      "View 4",
      "View 5",
    ]);

    section.update(makeViews(12), { selectedSavedViewId: "view-11" });

    expect(visibleViewNames()).toEqual([
      "View 1",
      "View 2",
      "View 3",
      "View 4",
      "View 5",
      "View 11",
    ]);
    expect(screen.getByRole("button", { name: "+6 more" })).toBeInTheDocument();

    section.update(makeViews(12), { selectedSavedViewId: "view-2" });

    expect(visibleViewNames()).toEqual([
      "View 1",
      "View 2",
      "View 3",
      "View 4",
      "View 5",
    ]);
    expect(screen.getByRole("button", { name: "+7 more" })).toBeInTheDocument();
  });

  test("the search box appears mid-session once the list is long enough", () => {
    const section: LiveSection = renderLiveSection(makeViews(5));

    expect(screen.queryByPlaceholderText(SEARCH_LABEL)).toBeNull();

    section.update(makeViews(6));

    // A box that arrives mid-session arrives empty, not carrying a past query.
    expect(searchBox()).toHaveValue("");

    typeSearch("view 6");

    expect(visibleViewNames()).toEqual(["View 6"]);
  });

  test("a search that matched nothing starts matching when the list grows", () => {
    const section: LiveSection = renderLiveSection(makeViews(6));

    typeSearch("view 9");

    expect(screen.getByText(NO_MATCHES)).toBeInTheDocument();

    section.update(makeViews(12));

    expect(visibleViewNames()).toEqual(["View 9"]);
    expect(screen.queryByText(NO_MATCHES)).toBeNull();
  });
});

describe("SavedViewsFacetSection — search and expansion round-trip", () => {
  afterEach(() => {
    cleanup();
  });

  test("clearing the search collapses the tail back rather than showing everything", () => {
    renderSection(NAMED_VIEWS);

    typeSearch("checkout");
    typeSearch("");

    expect(visibleViewNames()).toEqual([
      "IMS Logs",
      "QA-JDE (default)",
      "Checkout errors",
      "Staging checkout",
      "Prod fatals",
    ]);
    expect(screen.getByRole("button", { name: "+1 more" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Slow requests" })).toBeNull();
  });

  test("clearing a search inside an expanded list returns the whole list", () => {
    renderSection(makeViews(12));

    fireEvent.click(screen.getByRole("button", { name: "+7 more" }));
    typeSearch("view 2");
    typeSearch("");

    // Searching is a lens over the list, not an action that collapses it.
    expect(visibleViewNames()).toHaveLength(12);
    expect(
      screen.getByRole("button", { name: "Show less" }),
    ).toBeInTheDocument();
  });

  test("searching again after clearing filters again", () => {
    renderSection(makeViews(12));

    fireEvent.click(screen.getByRole("button", { name: "+7 more" }));
    typeSearch("view 2");
    typeSearch("");
    typeSearch("view 2");

    expect(visibleViewNames()).toEqual(["View 2"]);
    expect(screen.queryByRole("button", { name: "Show less" })).toBeNull();
    expect(screen.queryByRole("button", { name: /more$/ })).toBeNull();
  });

  test("collapsing and re-opening the section keeps the tail expanded", () => {
    renderSection(makeViews(12));

    fireEvent.click(screen.getByRole("button", { name: "+7 more" }));
    expect(visibleViewNames()).toHaveLength(12);

    fireEvent.click(sectionHeader());
    fireEvent.click(sectionHeader());

    expect(visibleViewNames()).toHaveLength(12);
    expect(
      screen.getByRole("button", { name: "Show less" }),
    ).toBeInTheDocument();
  });

  test("collapsing and re-opening the section keeps the typed query", () => {
    renderSection(makeViews(6));

    typeSearch("view 3");

    fireEvent.click(sectionHeader());
    fireEvent.click(sectionHeader());

    expect(searchBox()).toHaveValue("view 3");
    expect(visibleViewNames()).toEqual(["View 3"]);
  });
});

describe("SavedViewsFacetSection — what the caller can configure", () => {
  afterEach(() => {
    cleanup();
  });

  test("the caller can pick how many rows the collapsed list shows", () => {
    renderSection(makeViews(12), { initialVisibleCount: 3 });

    expect(visibleViewNames()).toEqual(["View 1", "View 2", "View 3"]);
    expect(screen.getByRole("button", { name: "+9 more" })).toBeInTheDocument();
  });

  test("a caller's row count survives expanding and collapsing again", () => {
    renderSection(makeViews(12), { initialVisibleCount: 3 });

    fireEvent.click(screen.getByRole("button", { name: "+9 more" }));
    expect(visibleViewNames()).toHaveLength(12);

    fireEvent.click(screen.getByRole("button", { name: "Show less" }));

    expect(visibleViewNames()).toEqual(["View 1", "View 2", "View 3"]);
    expect(screen.getByRole("button", { name: "+9 more" })).toBeInTheDocument();
  });

  test("a caller can rename the section, and the search box takes the new name", () => {
    render(
      <SavedViewsFacetSection
        savedViews={makeViews(6)}
        title="Team Views"
        onSelect={jest.fn()}
      />,
    );

    expect(sectionHeader(/Team Views/)).toHaveAttribute(
      "aria-expanded",
      "true",
    );
    expect(
      screen.getByRole("textbox", { name: "Search team views..." }),
    ).toHaveAttribute("placeholder", "Search team views...");
    expect(screen.queryByPlaceholderText(SEARCH_LABEL)).toBeNull();
  });

  test("a section with no select handler does not throw when a row is clicked", () => {
    render(<SavedViewsFacetSection savedViews={NAMED_VIEWS} />);

    // LogsFacetSidebar forwards a possibly-undefined onSavedViewSelect.
    expect(() => {
      fireEvent.click(rowFor("IMS Logs"));
    }).not.toThrow();
    expect(rowFor("IMS Logs")).toHaveAttribute("aria-pressed", "false");
  });

  test("a section with no saved views says so and offers no chrome", () => {
    render(<SavedViewsFacetSection savedViews={[]} onSelect={jest.fn()} />);

    expect(screen.getByText("No saved views yet.")).toBeInTheDocument();
    expect(screen.queryByText(NO_MATCHES)).toBeNull();
    expect(visibleViewNames()).toEqual([]);
    expect(screen.queryByPlaceholderText(SEARCH_LABEL)).toBeNull();
    expect(screen.queryByRole("button", { name: /more$/ })).toBeNull();
    expect(screen.queryByRole("button", { name: "Show less" })).toBeNull();
  });
});

describe("SavedViewsFacetSection — what a row shows and says", () => {
  afterEach(() => {
    cleanup();
  });

  test("a row shows the view's name, not only announces it", () => {
    renderSection(NAMED_VIEWS);

    // Every other assertion in this file reads the row through aria-label.
    expect(rowFor("IMS Logs").textContent).toBe("IMS Logs");
    expect(rowFor(/QA-JDE/).textContent).toBe("QA-JDE");
  });

  test("the Default pill is drawn for sighted users and hidden from assistive tech", () => {
    renderSection(NAMED_VIEWS);

    const pills: Array<HTMLElement> = screen.getAllByText("Default");

    expect(pills).toHaveLength(1);
    expect(pills[0]).toHaveAttribute("aria-hidden", "true");
  });

  test("the pill sits outside the row's accessible name", () => {
    renderSection(NAMED_VIEWS);

    const row: HTMLElement = screen.getByRole("button", {
      name: "QA-JDE (default)",
    });

    expect(within(row).queryByText("Default")).toBeNull();
  });

  test("a row says whether clicking it will apply or clear the view", () => {
    renderSection(NAMED_VIEWS, { selectedSavedViewId: "ims" });

    // aria-pressed reports the state; only the tooltip says what a click does.
    expect(rowFor("IMS Logs")).toHaveAttribute(
      "title",
      "Clear saved view: IMS Logs",
    );
    expect(rowFor("Checkout errors")).toHaveAttribute(
      "title",
      "Apply saved view: Checkout errors",
    );
  });
});

/*
 * The list can change under a mounted section — deleting a saved view refetches
 * and re-renders it in place — and for a while that could strand a filter with
 * nothing on screen to cancel it, or leave a toggle that toggled nothing. These
 * are the cases that pin the fix.
 */
describe("SavedViewsFacetSection — the list shrinking under a live search", () => {
  afterEach(() => {
    cleanup();
  });

  test("a list that shrinks below the search threshold does not strand its own filter", () => {
    const live: LiveSection = renderLiveSection(makeViews(6));

    typeSearch("View 6");
    expect(visibleViewNames()).toEqual(["View 6"]);

    // View 6 deleted: six views become five, and the search box goes with it.
    live.update(makeViews(5));

    expect(screen.queryByPlaceholderText(SEARCH_LABEL)).toBeNull();
    expect(visibleViewNames()).toEqual([
      "View 1",
      "View 2",
      "View 3",
      "View 4",
      "View 5",
    ]);
    expect(screen.queryByText(NO_MATCHES)).toBeNull();
  });

  test("the search box is on screen whenever a search is what emptied the list", () => {
    const live: LiveSection = renderLiveSection(makeViews(6));

    typeSearch("zzz");

    // A search the user can see is a search the user can undo.
    expect(screen.getByText(NO_MATCHES)).toBeInTheDocument();
    expect(searchBox()).toBeInTheDocument();

    live.update(makeViews(5));

    expect(screen.queryByText(NO_MATCHES)).toBeNull();
    expect(visibleViewNames()).toHaveLength(5);
  });

  test("collapsing the section is not a way out of a stranded filter, because there is none", () => {
    const live: LiveSection = renderLiveSection(makeViews(6));

    typeSearch("View 6");
    live.update(makeViews(5));

    fireEvent.click(sectionHeader());
    fireEvent.click(sectionHeader());

    /*
     * isExpanded and searchText are independent state, so collapse/expand was
     * never the escape hatch. The list is right because the query went with
     * the box, not because re-opening reset anything.
     */
    expect(visibleViewNames()).toHaveLength(5);
  });

  test("a query the shrinking list threw away does not come back when it grows again", () => {
    const live: LiveSection = renderLiveSection(makeViews(6));

    typeSearch("View 6");
    live.update(makeViews(5));
    live.update(makeViews(7));

    expect(searchBox()).toHaveValue("");
    expect(visibleViewNames()).toEqual([
      "View 1",
      "View 2",
      "View 3",
      "View 4",
      "View 5",
    ]);
    expect(screen.getByRole("button", { name: "+2 more" })).toBeInTheDocument();
  });

  test("a list that shrinks under an expanded tail offers no toggle at all", () => {
    const live: LiveSection = renderLiveSection(makeViews(8));

    fireEvent.click(screen.getByRole("button", { name: "+3 more" }));
    expect(visibleViewNames()).toHaveLength(8);

    live.update(makeViews(4));

    expect(visibleViewNames()).toEqual([
      "View 1",
      "View 2",
      "View 3",
      "View 4",
    ]);
    expect(screen.queryByRole("button", { name: "Show less" })).toBeNull();
    expect(screen.queryByRole("button", { name: /more$/ })).toBeNull();
  });

  test("a list that shrinks but still has a tail keeps the toggle honest", () => {
    const live: LiveSection = renderLiveSection(makeViews(12));

    fireEvent.click(screen.getByRole("button", { name: "+7 more" }));
    live.update(makeViews(7));

    /*
     * Still expanded, and there is still something to collapse to — so the
     * control stays, and says the right thing when it is used.
     */
    expect(visibleViewNames()).toHaveLength(7);

    fireEvent.click(screen.getByRole("button", { name: "Show less" }));

    expect(visibleViewNames()).toHaveLength(5);
    expect(screen.getByRole("button", { name: "+2 more" })).toBeInTheDocument();
  });
});

/*
 * The stale-search fix has two halves. The clearing effect is a passive one, so
 * every shrink case above is satisfied by it alone — React Testing Library
 * wraps rerender in act(), which flushes effects before the first assertion can
 * look. The other half, the derived activeSearchText, is what keeps the frame
 * React actually commits honest in the gap between the two, and the shipped
 * path is a fetch callback where the browser can paint in that gap.
 *
 * Deleting the derived value leaves every other test in the suite green, so
 * this one watches the DOM itself rather than its final state.
 */
describe("SavedViewsFacetSection — the frame committed mid-shrink", () => {
  afterEach(() => {
    cleanup();
  });

  test("the list never flashes No matches found on its way to being right", () => {
    const live: LiveSection = renderLiveSection(makeViews(6));

    typeSearch("View 6");
    expect(visibleViewNames()).toEqual(["View 6"]);

    const seen: Array<string> = [];
    const observer: MutationObserver = new MutationObserver(() => {
      // Records are drained synchronously below; this never has to fire.
    });
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
    });

    live.update(makeViews(5));

    for (const record of observer.takeRecords()) {
      record.addedNodes.forEach((node: Node) => {
        seen.push(node.textContent || "");
      });

      if (record.type === "characterData") {
        seen.push(record.target.textContent || "");
      }
    }

    observer.disconnect();

    /*
     * Not one of the frames between "six views, filtered to one" and "five
     * views, unfiltered" is allowed to claim the project has no saved views.
     */
    expect(
      seen.filter((text: string) => {
        return text.includes(NO_MATCHES);
      }),
    ).toEqual([]);
    expect(visibleViewNames()).toHaveLength(5);
  });
});
