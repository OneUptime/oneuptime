import {
  FacetData,
  FacetValue,
  LogsSavedViewOption,
} from "../../../UI/Components/LogsViewer/types";
import "@testing-library/jest-dom";
import {
  RenderResult,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React, { ReactElement } from "react";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * Issue 3319 gave the logs sidebar's saved views the chrome its neighbours
 * already had — a search box, a collapsed tail, a collapsible header. The
 * section is covered on its own in SavedViewsFacetSection.test.tsx, but only
 * ever rendered into a sidebar with no facets, so the thing the change is
 * actually arguing for — saved views reading as one more facet section among
 * the real ones — is never rendered.
 *
 * This file renders the panel as it ships: saved views above real facet data,
 * two search boxes and two "+N more" toggles in the same scroll. Everything
 * here is about the seams — which control owns which list, which name resolves
 * to which box, and what the host is told when a row is clicked.
 */

/*
 * Declared before jest.mock but dereferenced inside the factories: ts-jest
 * hoists the jest.mock calls above these initializers, so naming the mocks
 * directly in a factory would capture undefined. Only the LogsViewer cases
 * need them — the container loads services and log attributes on mount.
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

// Imported after the mocks so both components pick the mocked ModelAPI up.
import LogsFacetSidebar from "../../../UI/Components/LogsViewer/components/LogsFacetSidebar";
import LogsViewer from "../../../UI/Components/LogsViewer/LogsViewer";

const SAVED_VIEWS_SEARCH_LABEL: string = "Search saved views...";
const SEVERITY_SEARCH_LABEL: string = "Search severity...";

function makeViews(count: number): Array<LogsSavedViewOption> {
  const views: Array<LogsSavedViewOption> = [];

  for (let index: number = 1; index <= count; index++) {
    views.push({ id: `view-${index}`, name: `View ${index}` });
  }

  return views;
}

/*
 * Severity values are named so nothing in them can accidentally match a saved
 * view's name — the point of half these cases is that one search cannot reach
 * the other list, which is unprovable if "View 7" and the seventh severity
 * share a substring.
 */
function makeSeverities(count: number): Array<FacetValue> {
  const values: Array<FacetValue> = [];

  for (let index: number = 1; index <= count; index++) {
    values.push({ value: `Sev${index}`, count: 100 - index });
  }

  return values;
}

interface SidebarOptions {
  savedViews: Array<LogsSavedViewOption>;
  facetData: FacetData;
  selectedSavedViewId?: string | null | undefined;
  onSavedViewSelect?: ((viewId: string) => void) | undefined;
  onClearSavedView?: (() => void) | undefined;
}

function sidebarElement(options: SidebarOptions): ReactElement {
  return (
    <LogsFacetSidebar
      facetData={options.facetData}
      isLoading={false}
      serviceMap={{}}
      onIncludeFilter={jest.fn()}
      onExcludeFilter={jest.fn()}
      savedViews={options.savedViews}
      selectedSavedViewId={options.selectedSavedViewId ?? null}
      onSavedViewSelect={options.onSavedViewSelect}
      onClearSavedView={options.onClearSavedView}
    />
  );
}

/*
 * Saved-view rows are the only buttons in the panel that report a pressed
 * state — facet rows do not — so aria-pressed tells the two lists apart even
 * when they sit in the same scroll under near-identical chrome.
 */
function savedViewRowNames(
  container: HTMLElement = document.body,
): Array<string> {
  return within(container)
    .queryAllByRole("button")
    .filter((element: HTMLElement): boolean => {
      return element.hasAttribute("aria-pressed");
    })
    .map((element: HTMLElement): string => {
      return element.getAttribute("aria-label") || element.textContent || "";
    });
}

// Facet rows announce their own value; the include button's title names it.
function severityRowNames(
  container: HTMLElement = document.body,
): Array<string> {
  return within(container)
    .queryAllByRole("button")
    .filter((element: HTMLElement): boolean => {
      return (element.getAttribute("title") || "").startsWith("Filter to Sev");
    })
    .map((element: HTMLElement): string => {
      return element.textContent || "";
    });
}

function savedViewsSection(): HTMLElement {
  const header: HTMLElement = screen.getByRole("button", {
    name: "Saved Views",
  });

  return header.parentElement as HTMLElement;
}

function typeInto(box: HTMLElement, text: string): void {
  fireEvent.change(box, { target: { value: text } });
}

describe("the logs sidebar renders saved views beside real facets", () => {
  afterEach(() => {
    cleanup();
  });

  test("saved views sit above the facets they now look like", () => {
    render(
      sidebarElement({
        savedViews: makeViews(8),
        facetData: { severityText: makeSeverities(8) },
      }),
    );

    const savedViewsHeader: HTMLElement = screen.getByRole("button", {
      name: "Saved Views",
    });
    const severityHeader: HTMLElement = screen.getByRole("button", {
      name: "Severity",
    });

    const position: number =
      savedViewsHeader.compareDocumentPosition(severityHeader);

    expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(position & Node.DOCUMENT_POSITION_PRECEDING).toBe(0);
  });

  test("the two search boxes in the sidebar are told apart by name", () => {
    render(
      sidebarElement({
        savedViews: makeViews(8),
        facetData: { severityText: makeSeverities(8) },
      }),
    );

    const savedViewsBox: HTMLElement = screen.getByPlaceholderText(
      SAVED_VIEWS_SEARCH_LABEL,
    );
    const severityBox: HTMLElement = screen.getByPlaceholderText(
      SEVERITY_SEARCH_LABEL,
    );

    expect(savedViewsBox).not.toBe(severityBox);
    expect(screen.getAllByRole("textbox")).toHaveLength(2);

    /*
     * The saved-views box carries an explicit aria-label, so it is the one
     * that can be reached by name rather than by placeholder — the facet's
     * box beside it has no accessible name at all to collide with.
     */
    expect(
      screen.getByRole("textbox", { name: SAVED_VIEWS_SEARCH_LABEL }),
    ).toBe(savedViewsBox);
  });

  test("the two searches do not reach into each other's list", () => {
    render(
      sidebarElement({
        savedViews: makeViews(8),
        facetData: { severityText: makeSeverities(8) },
      }),
    );

    typeInto(screen.getByPlaceholderText(SEVERITY_SEARCH_LABEL), "Sev7");

    expect(severityRowNames()).toEqual(["Sev7"]);
    expect(savedViewRowNames()).toEqual([
      "View 1",
      "View 2",
      "View 3",
      "View 4",
      "View 5",
    ]);

    typeInto(screen.getByPlaceholderText(SAVED_VIEWS_SEARCH_LABEL), "view 7");

    expect(savedViewRowNames()).toEqual(["View 7"]);
    expect(severityRowNames()).toEqual(["Sev7"]);
  });

  test("each collapsed tail expands only its own list", () => {
    render(
      sidebarElement({
        savedViews: makeViews(8),
        facetData: { severityText: makeSeverities(8) },
      }),
    );

    /*
     * Both lists hide three rows, so both toggles read "+3 more" — the reason
     * a getByRole for that name throws here and every assertion below has to
     * say which of the two it means.
     */
    const toggles: Array<HTMLElement> = screen.getAllByRole("button", {
      name: "+3 more",
    });
    expect(toggles).toHaveLength(2);

    // Saved views render first, so theirs is the first match.
    fireEvent.click(toggles[0]!);

    expect(savedViewRowNames()).toHaveLength(8);
    expect(severityRowNames()).toEqual([
      "Sev1",
      "Sev2",
      "Sev3",
      "Sev4",
      "Sev5",
    ]);
    expect(screen.getAllByRole("button", { name: "+3 more" })).toHaveLength(1);
    expect(
      screen.getByRole("button", { name: "Show less" }),
    ).toBeInTheDocument();
  });

  test("a short saved-views list gets no box while a long facet keeps its own", () => {
    render(
      sidebarElement({
        savedViews: makeViews(3),
        facetData: { severityText: makeSeverities(8) },
      }),
    );

    expect(screen.queryByPlaceholderText(SAVED_VIEWS_SEARCH_LABEL)).toBeNull();
    expect(
      screen.getByPlaceholderText(SEVERITY_SEARCH_LABEL),
    ).toBeInTheDocument();
    expect(savedViewRowNames()).toEqual(["View 1", "View 2", "View 3"]);
  });
});

describe("the logs sidebar hands saved-view clicks back to its host", () => {
  afterEach(() => {
    cleanup();
  });

  test("applying a view from the sidebar reaches the host", () => {
    const onSavedViewSelect: (viewId: string) => void = jest.fn();
    const onClearSavedView: () => void = jest.fn();

    render(
      sidebarElement({
        savedViews: makeViews(8),
        facetData: { severityText: makeSeverities(8) },
        onSavedViewSelect: onSavedViewSelect,
        onClearSavedView: onClearSavedView,
      }),
    );

    typeInto(screen.getByPlaceholderText(SAVED_VIEWS_SEARCH_LABEL), "view 7");

    fireEvent.click(screen.getByRole("button", { name: "View 7" }));

    expect(onSavedViewSelect).toHaveBeenCalledWith("view-7");
    expect(onClearSavedView).not.toHaveBeenCalled();
  });

  test("clicking the applied sidebar row clears it through the host", () => {
    const onSavedViewSelect: (viewId: string) => void = jest.fn();
    const onClearSavedView: () => void = jest.fn();

    render(
      sidebarElement({
        savedViews: makeViews(8),
        facetData: { severityText: makeSeverities(8) },
        selectedSavedViewId: "view-2",
        onSavedViewSelect: onSavedViewSelect,
        onClearSavedView: onClearSavedView,
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "View 2" }));

    expect(onClearSavedView).toHaveBeenCalledTimes(1);
    expect(onSavedViewSelect).not.toHaveBeenCalled();
  });

  test("a sidebar with no select handler does not throw when a row is clicked", () => {
    render(
      sidebarElement({
        savedViews: makeViews(8),
        facetData: { severityText: makeSeverities(8) },
      }),
    );

    expect(() => {
      fireEvent.click(screen.getByRole("button", { name: "View 3" }));
    }).not.toThrow();

    expect(savedViewRowNames()).toEqual([
      "View 1",
      "View 2",
      "View 3",
      "View 4",
      "View 5",
    ]);
  });
});

describe("the logs sidebar's two empty states", () => {
  afterEach(() => {
    cleanup();
  });

  test("a sidebar with no saved views still renders its facets", () => {
    render(
      sidebarElement({
        savedViews: [],
        facetData: { severityText: makeSeverities(3) },
      }),
    );

    expect(screen.queryByRole("button", { name: "Saved Views" })).toBeNull();
    expect(screen.queryByText("No saved views yet.")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Severity" }),
    ).toBeInTheDocument();
    expect(severityRowNames()).toEqual(["Sev1", "Sev2", "Sev3"]);
  });

  test("the two empty states in the sidebar read differently", () => {
    render(
      sidebarElement({
        savedViews: makeViews(8),
        facetData: { severityText: [] },
      }),
    );

    typeInto(screen.getByPlaceholderText(SAVED_VIEWS_SEARCH_LABEL), "zzz");

    const searchedEmpty: HTMLElement = screen.getByText("No matches found");
    const genuinelyEmpty: HTMLElement = screen.getByText("No values found");

    expect(searchedEmpty).not.toBe(genuinelyEmpty);
    expect(savedViewRowNames()).toEqual([]);
  });
});

describe("LogsViewer feeds both saved-view surfaces at once", () => {
  afterEach(() => {
    cleanup();
  });

  async function renderViewer(
    savedViews: Array<LogsSavedViewOption>,
  ): Promise<void> {
    render(
      <LogsViewer
        logs={[]}
        isLoading={false}
        filterData={{}}
        onFilterChanged={jest.fn()}
        facetData={{}}
        savedViews={savedViews}
        selectedSavedViewId={null}
        onSavedViewSelect={jest.fn()}
        onClearSavedView={jest.fn()}
      />,
    );

    // The container renders a loader until its service lookup resolves.
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Saved Views" }),
      ).toBeInTheDocument();
    });
  }

  /*
   * The toolbar's trigger echoes the applied view's name, or "Saved Views"
   * plus the total when nothing is applied — which is how it is told apart
   * from the sidebar's section header of the same words.
   */
  function toolbarDropdown(): HTMLElement {
    const trigger: HTMLElement = screen.getByRole("button", {
      name: /^Saved Views \d+$/,
    });

    return trigger.parentElement as HTMLElement;
  }

  test("LogsViewer feeds the same saved views to the sidebar and the toolbar", async () => {
    await renderViewer(makeViews(8));

    const section: HTMLElement = savedViewsSection();

    expect(savedViewRowNames(section)).toEqual([
      "View 1",
      "View 2",
      "View 3",
      "View 4",
      "View 5",
    ]);
    expect(
      within(section).getByRole("button", { name: "+3 more" }),
    ).toBeInTheDocument();

    const trigger: HTMLElement = screen.getByRole("button", {
      name: "Saved Views 8",
    });
    expect(within(trigger).getByText("8")).toBeInTheDocument();

    fireEvent.click(trigger);

    const dropdown: HTMLElement = toolbarDropdown();

    expect(savedViewRowNames(dropdown)).toEqual([
      "View 1",
      "View 2",
      "View 3",
      "View 4",
      "View 5",
    ]);
    expect(
      within(dropdown).getByRole("button", { name: "+3 more" }),
    ).toBeInTheDocument();
  });

  test("the two saved-view search boxes are told apart by their container", async () => {
    await renderViewer(makeViews(8));

    fireEvent.click(screen.getByRole("button", { name: /^Saved Views \d+$/ }));

    /*
     * Both boxes carry the identical accessible name — they search the same
     * views, and renaming one of them would only make the product read
     * strangely. What tells them apart is the panel: the toolbar's box lives
     * inside a dialog that names itself, the sidebar's does not.
     */
    const panel: HTMLElement = screen.getByRole("dialog", {
      name: "Saved views",
    });

    expect(
      within(panel).getByRole("textbox", { name: SAVED_VIEWS_SEARCH_LABEL }),
    ).toBeInTheDocument();

    const sidebarBox: HTMLElement = within(savedViewsSection()).getByRole(
      "textbox",
      { name: SAVED_VIEWS_SEARCH_LABEL },
    );

    expect(panel.contains(sidebarBox)).toBe(false);
  });

  test("a sidebar search does not narrow the toolbar's list", async () => {
    await renderViewer(makeViews(8));

    // The dropdown is closed, so the sidebar owns the only box on screen.
    typeInto(screen.getByPlaceholderText(SAVED_VIEWS_SEARCH_LABEL), "view 7");

    expect(savedViewRowNames(savedViewsSection())).toEqual(["View 7"]);

    fireEvent.click(screen.getByRole("button", { name: /^Saved Views \d+$/ }));

    const dropdown: HTMLElement = toolbarDropdown();

    expect(savedViewRowNames(dropdown)).toEqual([
      "View 1",
      "View 2",
      "View 3",
      "View 4",
      "View 5",
    ]);
    expect(
      within(dropdown).getByRole("button", { name: "+3 more" }),
    ).toBeInTheDocument();
  });
});

/*
 * The shipped delete path: LogsViewer awaits fetchSavedViews() and calls
 * setSavedViews on the mounted tree, so the sidebar's list can shrink under a
 * live search. Below the search threshold the box unmounts with it, and for a
 * while the query stayed behind — a project with saved views reading as having
 * none, with nothing on screen able to undo it.
 */
describe("the logs sidebar survives its saved views changing underneath", () => {
  afterEach(() => {
    cleanup();
  });

  function renderLiveSidebar(
    savedViews: Array<LogsSavedViewOption>,
  ): (next: Array<LogsSavedViewOption>) => void {
    const options: SidebarOptions = {
      // Eight, so the severity facet renders a search box of its own.
      facetData: { severityText: makeSeverities(8) },
      savedViews: savedViews,
    };

    const rendered: RenderResult = render(sidebarElement(options));

    return (next: Array<LogsSavedViewOption>): void => {
      rendered.rerender(sidebarElement({ ...options, savedViews: next }));
    };
  }

  test("a saved view deleted out from under the sidebar does not strand its search", () => {
    const update: (next: Array<LogsSavedViewOption>) => void =
      renderLiveSidebar(makeViews(6));

    typeInto(screen.getByPlaceholderText(SAVED_VIEWS_SEARCH_LABEL), "view 6");
    expect(savedViewRowNames(savedViewsSection())).toEqual(["View 6"]);

    update(makeViews(5));

    expect(savedViewRowNames(savedViewsSection())).toEqual([
      "View 1",
      "View 2",
      "View 3",
      "View 4",
      "View 5",
    ]);

    // Collapse and re-expand: still right, and for the same reason.
    fireEvent.click(screen.getByRole("button", { name: "Saved Views" }));
    fireEvent.click(screen.getByRole("button", { name: "Saved Views" }));

    expect(savedViewRowNames(savedViewsSection())).toHaveLength(5);
  });

  test("the severity facet keeps its own search while the saved views lose theirs", () => {
    const update: (next: Array<LogsSavedViewOption>) => void =
      renderLiveSidebar(makeViews(6));

    typeInto(screen.getByPlaceholderText(SAVED_VIEWS_SEARCH_LABEL), "view 6");
    typeInto(screen.getByPlaceholderText(SEVERITY_SEARCH_LABEL), "Sev2");

    update(makeViews(5));

    /*
     * Only the saved-views box unmounted, so only its query should have gone.
     * The facet beside it is a separate section with separate state and must
     * not be swept up in the reset.
     */
    expect(screen.getByPlaceholderText(SEVERITY_SEARCH_LABEL)).toHaveValue(
      "Sev2",
    );
    expect(severityRowNames()).toEqual(["Sev2"]);
    expect(savedViewRowNames(savedViewsSection())).toHaveLength(5);
  });

  test("an expanded sidebar list that shrinks to fit drops its toggle", () => {
    const update: (next: Array<LogsSavedViewOption>) => void =
      renderLiveSidebar(makeViews(9));

    fireEvent.click(screen.getByRole("button", { name: "+4 more" }));
    expect(savedViewRowNames(savedViewsSection())).toHaveLength(9);

    update(makeViews(3));

    expect(savedViewRowNames(savedViewsSection())).toHaveLength(3);
    expect(screen.queryByRole("button", { name: "Show less" })).toBeNull();
  });
});
