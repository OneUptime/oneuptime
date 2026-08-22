import SavedViewsSearchInput from "../../../UI/Components/SavedViews/SavedViewsSearchInput";
import SavedViewsShowMoreButton from "../../../UI/Components/SavedViews/SavedViewsShowMoreButton";
import SavedViewsFacetSection from "../../../UI/Components/SavedViews/SavedViewsFacetSection";
import LogsSavedViewsDropdown, {
  SavedViewsDropdownProps,
} from "../../../UI/Components/LogsViewer/components/SavedViewsDropdown";
import TelemetrySavedViewsDropdown from "../../../UI/Components/TelemetryViewer/components/SavedViewsDropdown";
import { LogsSavedViewOption } from "../../../UI/Components/LogsViewer/types";
import "@testing-library/jest-dom";
import {
  RenderResult,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import React, { FunctionComponent } from "react";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * Issue 3319 shipped the same behaviour into three places: the logs facet
 * sidebar's section, the logs toolbar dropdown, and the shared telemetry
 * dropdown. Each of those files owns its own tests, and each is happy on its
 * own — which is exactly how three copies drift apart without anyone noticing.
 *
 * Two jobs here. First, the two leaf components are exercised directly, so
 * their fallbacks and guards are pinned from their own side rather than only
 * through whichever caller happens to reach them today. Second, the rules that
 * must be IDENTICAL everywhere — when a search box appears, where the collapsed
 * list is cut, what "+N more" counts, how the applied view is pinned — run
 * through one table across all three surfaces, so a change to any single copy
 * fails here even if that copy's own tests are updated to match.
 */

const SEARCH_LABEL: string = "Search saved views...";

function makeViews(count: number): Array<LogsSavedViewOption> {
  const views: Array<LogsSavedViewOption> = [];

  for (let index: number = 1; index <= count; index++) {
    views.push({ id: `view-${index}`, name: `View ${index}` });
  }

  return views;
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

describe("SavedViewsSearchInput — the box names itself", () => {
  afterEach(() => {
    cleanup();
  });

  test("the search box names itself when the caller says nothing", () => {
    const onChange: (searchText: string) => void = jest.fn();

    render(<SavedViewsSearchInput value="" onChange={onChange} />);

    /*
     * Both dropdowns pass no label, so this default is the only name their
     * boxes ever get. Their own tests reach the box through the placeholder,
     * which comes from the same variable — so deleting the fallback would
     * leave them unnamed without failing anything over there.
     */
    const box: HTMLElement = screen.getByRole("textbox", {
      name: SEARCH_LABEL,
    });

    expect(box).toHaveAttribute("placeholder", SEARCH_LABEL);
  });

  test("an empty label falls back rather than rendering a nameless box", () => {
    const onChange: (searchText: string) => void = jest.fn();

    render(<SavedViewsSearchInput value="" label="" onChange={onChange} />);

    /*
     * The fallback is a `||` and not a `??` on purpose: a host that builds its
     * label from a title which is itself empty would otherwise get an unnamed,
     * unplaceheld text field indistinguishable from any other on the page.
     */
    expect(screen.getByRole("textbox", { name: SEARCH_LABEL })).toHaveAttribute(
      "placeholder",
      SEARCH_LABEL,
    );
  });

  test("a caller's label becomes both the placeholder and the accessible name", () => {
    const onChange: (searchText: string) => void = jest.fn();

    render(
      <SavedViewsSearchInput
        value=""
        label="Search team views..."
        onChange={onChange}
      />,
    );

    /*
     * The component exists because a placeholder is not a label — it vanishes
     * the moment the user types. The two must therefore be the same element
     * carrying the same words, or sighted and non-sighted users are told
     * different things about the same field.
     */
    expect(screen.getByPlaceholderText("Search team views...")).toBe(
      screen.getByRole("textbox", { name: "Search team views..." }),
    );
  });

  test("the box wears the shared styling unless the caller replaces it", () => {
    const onChange: (searchText: string) => void = jest.fn();

    render(<SavedViewsSearchInput value="" onChange={onChange} />);

    const shared: HTMLElement = screen.getByRole("textbox");

    expect(shared.className).toContain("w-full");
    expect(shared.className).toContain("focus:ring-indigo-200");

    cleanup();

    render(
      <SavedViewsSearchInput
        value=""
        className="custom-class"
        onChange={onChange}
      />,
    );

    /*
     * A full replacement, not a merge. Pinned because the section only ever
     * takes the default and the dropdowns only ever override, so neither side
     * would notice a caller quietly losing the width, background and focus
     * ring by passing a single utility class.
     */
    expect(screen.getByRole("textbox").className).toBe("custom-class");
  });

  test("the box reports exactly what was typed, whitespace and all", () => {
    const onChange: (searchText: string) => void = jest.fn();

    render(<SavedViewsSearchInput value="" onChange={onChange} />);

    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "  Checkout  " },
    });

    /*
     * Trimming belongs to filterSavedViewsByName, not to the box. If the box
     * trimmed, a two-word query would be untypeable — the space would vanish
     * under the user's fingers as they reached for the second word.
     */
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange).toHaveBeenCalledWith("  Checkout  ");
  });
});

describe("SavedViewsShowMoreButton — a toggle with nothing to toggle", () => {
  afterEach(() => {
    cleanup();
  });

  test("the toggle renders nothing when the list has no tail", () => {
    const onToggle: () => void = jest.fn();

    const rendered: RenderResult = render(
      <SavedViewsShowMoreButton
        hasMore={false}
        hiddenCount={0}
        isShowingAll={false}
        onToggle={onToggle}
      />,
    );

    expect(screen.queryAllByRole("button")).toHaveLength(0);
    expect(rendered.container).toBeEmptyDOMElement();
  });

  test("an expanded list whose tail has gone renders nothing either", () => {
    const onToggle: () => void = jest.fn();

    const rendered: RenderResult = render(
      <SavedViewsShowMoreButton
        hasMore={false}
        hiddenCount={0}
        isShowingAll={true}
        onToggle={onToggle}
      />,
    );

    /*
     * The case that used to print a dead "Show less": expand a long list, then
     * let it shrink until it fits. hasMore is the whole gate precisely so the
     * expanded flag surviving the shrink cannot keep a no-op control on screen.
     */
    expect(rendered.container).toBeEmptyDOMElement();
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  test("a collapsed toggle prints the exact number it is holding back", () => {
    const onToggle: () => void = jest.fn();

    render(
      <SavedViewsShowMoreButton
        hasMore={true}
        hiddenCount={7}
        isShowingAll={false}
        onToggle={onToggle}
      />,
    );

    expect(screen.getByRole("button", { name: "+7 more" })).toBeInTheDocument();

    cleanup();

    render(
      <SavedViewsShowMoreButton
        hasMore={true}
        hiddenCount={1}
        isShowingAll={false}
        onToggle={onToggle}
      />,
    );

    // The label is the promise the control makes; both callers derive it here.
    expect(screen.getByRole("button", { name: "+1 more" })).toBeInTheDocument();
  });

  test("an expanded toggle says Show less, with nothing hidden to count", () => {
    const onToggle: () => void = jest.fn();

    render(
      <SavedViewsShowMoreButton
        hasMore={true}
        hiddenCount={0}
        isShowingAll={true}
        onToggle={onToggle}
      />,
    );

    /*
     * hiddenCount is what a collapse would hide, so it is zero while expanded.
     * The label must come from isShowingAll rather than from the count, or an
     * expanded list would advertise "+0 more".
     */
    expect(
      screen.getByRole("button", { name: "Show less" }),
    ).toBeInTheDocument();
  });

  test("the toggle reports one click and never submits a form", () => {
    const onToggle: () => void = jest.fn();
    const onSubmit: () => void = jest.fn();

    render(
      <form
        onSubmit={(event: React.FormEvent<HTMLFormElement>) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <SavedViewsShowMoreButton
          hasMore={true}
          hiddenCount={3}
          isShowingAll={false}
          onToggle={onToggle}
        />
      </form>,
    );

    fireEvent.click(screen.getByRole("button", { name: "+3 more" }));

    /*
     * All three surfaces can sit inside a host page's form. Without the
     * explicit type="button" the default is "submit", and "show more" quietly
     * becomes "submit the page" — invisible until it happens to someone.
     */
    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

/*
 * One surface, mounted the same way whichever of the three it is, so the cases
 * below can be written once and read as claims about all of them. The dropdowns
 * need their menu opened before there is a list to look at; the sidebar section
 * is already open, so that difference is absorbed here and nowhere else.
 */
interface SurfaceUnderTest {
  label: string;
  mount: (
    savedViews: Array<LogsSavedViewOption>,
    selectedSavedViewId?: string | null,
  ) => void;
}

function mountSection(
  savedViews: Array<LogsSavedViewOption>,
  selectedSavedViewId?: string | null,
): void {
  const onSelect: (viewId: string) => void = jest.fn();

  render(
    <SavedViewsFacetSection
      savedViews={savedViews}
      selectedSavedViewId={selectedSavedViewId ?? null}
      onSelect={onSelect}
    />,
  );
}

function makeDropdownSurface(
  label: string,
  Component: FunctionComponent<SavedViewsDropdownProps>,
): SurfaceUnderTest {
  return {
    label: label,
    mount: (
      savedViews: Array<LogsSavedViewOption>,
      selectedSavedViewId?: string | null,
    ): void => {
      const onSelect: (viewId: string) => void = jest.fn();

      render(
        <Component
          savedViews={savedViews}
          selectedSavedViewId={selectedSavedViewId ?? null}
          onSelect={onSelect}
        />,
      );

      // Closed, the only button on screen is the trigger.
      fireEvent.click(screen.getAllByRole("button")[0]!);
    },
  };
}

/*
 * The telemetry dropdown's props are the logs ones plus a few optional
 * presentation flags, so a component typed for the logs props stands in for
 * both and every case below runs three times.
 */
const SURFACES: Array<SurfaceUnderTest> = [
  { label: "sidebar section", mount: mountSection },
  makeDropdownSurface("logs dropdown", LogsSavedViewsDropdown),
  makeDropdownSurface("telemetry dropdown", TelemetrySavedViewsDropdown),
];

function typeSearch(text: string): void {
  fireEvent.change(screen.getByPlaceholderText(SEARCH_LABEL), {
    target: { value: text },
  });
}

describe.each(SURFACES)(
  "$label — the same saved-views rules as its two siblings",
  (surface: SurfaceUnderTest) => {
    afterEach(() => {
      cleanup();
    });

    test("all three surfaces name their search box identically", () => {
      surface.mount(makeViews(6));

      /*
       * The dropdowns take the string from the component's default; the
       * section builds it from its own title constant. They agree today by
       * coincidence of wording, and nothing else notices the day one moves.
       */
      expect(
        screen.getByRole("textbox", { name: SEARCH_LABEL }),
      ).toBeInTheDocument();
    });

    test("all three surfaces show the search box at the same list length", () => {
      surface.mount(makeViews(5));

      expect(screen.queryByRole("textbox")).toBeNull();

      cleanup();
      surface.mount(makeViews(6));

      /*
       * Three separate calls to shouldShowSavedViewsSearch. Inline one, or
       * give it its own number, and a user gets a search box in the sidebar
       * and none in the toolbar for the very same list.
       */
      expect(
        screen.getByRole("textbox", { name: SEARCH_LABEL }),
      ).toBeInTheDocument();
    });

    test("all three surfaces cut the collapsed list at the same row", () => {
      surface.mount(makeViews(12));

      /*
       * The dropdowns pass no visibleCount and lean on the module default
       * while the section forwards a prop — so this is where the two paths
       * are held to the same answer.
       */
      expect(visibleViewNames()).toEqual([
        "View 1",
        "View 2",
        "View 3",
        "View 4",
        "View 5",
      ]);
      expect(
        screen.getByRole("button", { name: "+7 more" }),
      ).toBeInTheDocument();
    });

    test("all three surfaces pin the applied view into the collapsed slice", () => {
      surface.mount(makeViews(12), "view-11");

      /*
       * Pinning is the one rule that changes what a user can see without
       * expanding. A surface that stopped forwarding selectedSavedViewId
       * would drop the applied view out of sight on that surface alone.
       */
      expect(visibleViewNames()).toEqual([
        "View 1",
        "View 2",
        "View 3",
        "View 4",
        "View 5",
        "View 11",
      ]);
      expect(screen.getByRole("button", { name: "View 11" })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
    });

    test("no surface puts a toggle beside a search result", () => {
      surface.mount(makeViews(12));

      typeSearch("view 1");

      expect(visibleViewNames()).toEqual([
        "View 1",
        "View 10",
        "View 11",
        "View 12",
      ]);
      expect(screen.queryByRole("button", { name: /more$/ })).toBeNull();
      expect(screen.queryByRole("button", { name: "Show less" })).toBeNull();

      cleanup();

      /*
       * Expanding first is the order that leaves showAll true underneath the
       * search, so it is where a surface gating the button on the wrong flag
       * would leak a "Show less" over rows the user explicitly asked for.
       */
      surface.mount(makeViews(12));
      fireEvent.click(screen.getByRole("button", { name: "+7 more" }));
      typeSearch("view 1");

      expect(visibleViewNames()).toEqual([
        "View 1",
        "View 10",
        "View 11",
        "View 12",
      ]);
      expect(screen.queryByRole("button", { name: /more$/ })).toBeNull();
      expect(screen.queryByRole("button", { name: "Show less" })).toBeNull();
    });
  },
);

/*
 * The list can change under any of the three while it is on screen: deleting a
 * saved view refetches and re-renders in place. These surfaces keep their
 * expanded flag across that, so the only thing that can retire a "Show less" is
 * the list itself reporting that it has no tail left. Proving it once, across
 * the table, is what makes the fix belong in SavedViewsList.ts rather than in
 * three renderers.
 */
type UpdateSurface = (savedViews: Array<LogsSavedViewOption>) => void;

interface ShrinkableSurface {
  label: string;
  mount: (savedViews: Array<LogsSavedViewOption>) => UpdateSurface;
}

const SHRINKABLE_SURFACES: Array<ShrinkableSurface> = [
  {
    label: "sidebar section",
    mount: (savedViews: Array<LogsSavedViewOption>): UpdateSurface => {
      const onSelect: (viewId: string) => void = jest.fn();

      const element: (
        views: Array<LogsSavedViewOption>,
      ) => React.ReactElement = (views: Array<LogsSavedViewOption>) => {
        return (
          <SavedViewsFacetSection
            savedViews={views}
            selectedSavedViewId={null}
            onSelect={onSelect}
          />
        );
      };

      const rendered: RenderResult = render(element(savedViews));

      return (next: Array<LogsSavedViewOption>): void => {
        rendered.rerender(element(next));
      };
    },
  },
  {
    label: "logs dropdown",
    mount: (savedViews: Array<LogsSavedViewOption>): UpdateSurface => {
      return mountOpenDropdown(LogsSavedViewsDropdown, savedViews);
    },
  },
  {
    label: "telemetry dropdown",
    mount: (savedViews: Array<LogsSavedViewOption>): UpdateSurface => {
      return mountOpenDropdown(TelemetrySavedViewsDropdown, savedViews);
    },
  },
];

function mountOpenDropdown(
  Component: FunctionComponent<SavedViewsDropdownProps>,
  savedViews: Array<LogsSavedViewOption>,
): UpdateSurface {
  const onSelect: (viewId: string) => void = jest.fn();

  const element: (views: Array<LogsSavedViewOption>) => React.ReactElement = (
    views: Array<LogsSavedViewOption>,
  ) => {
    return (
      <Component
        savedViews={views}
        selectedSavedViewId={null}
        onSelect={onSelect}
      />
    );
  };

  const rendered: RenderResult = render(element(savedViews));

  // Closed, the only button on screen is the trigger.
  fireEvent.click(screen.getAllByRole("button")[0]!);

  return (next: Array<LogsSavedViewOption>): void => {
    rendered.rerender(element(next));
  };
}

describe.each(SHRINKABLE_SURFACES)(
  "$label — a list that changes size under it",
  (surface: ShrinkableSurface) => {
    afterEach(() => {
      cleanup();
    });

    test("no surface leaves a Show less over a list that is already whole", () => {
      const update: UpdateSurface = surface.mount(makeViews(12));

      fireEvent.click(screen.getByRole("button", { name: "+7 more" }));

      update(makeViews(4));

      expect(screen.queryByRole("button", { name: "Show less" })).toBeNull();
      expect(screen.queryByRole("button", { name: /more$/ })).toBeNull();
    });

    test("no surface keeps filtering by a query whose box has gone", () => {
      const update: UpdateSurface = surface.mount(makeViews(6));

      fireEvent.change(screen.getByPlaceholderText(SEARCH_LABEL), {
        target: { value: "zzz" },
      });
      expect(screen.getByText("No matches found")).toBeInTheDocument();

      update(makeViews(3));

      expect(screen.queryByPlaceholderText(SEARCH_LABEL)).toBeNull();
      expect(screen.queryByText("No matches found")).toBeNull();
    });

    test("every surface still collapses a list that kept its tail", () => {
      const update: UpdateSurface = surface.mount(makeViews(12));

      fireEvent.click(screen.getByRole("button", { name: "+7 more" }));
      update(makeViews(8));

      fireEvent.click(screen.getByRole("button", { name: "Show less" }));

      expect(
        screen.getByRole("button", { name: "+3 more" }),
      ).toBeInTheDocument();
    });
  },
);
