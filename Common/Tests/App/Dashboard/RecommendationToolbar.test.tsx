import "@testing-library/jest-dom";
import { beforeEach, describe, expect, test } from "@jest/globals";
import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as React from "react";
import RecommendationToolbar from "../../../../App/FeatureSet/Dashboard/src/Components/Recommendations/RecommendationToolbar";
import {
  RecommendationCounts,
  RecommendationFilterState,
  RecommendationSeverityFilter,
  RecommendationStatusFilter,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Recommendations/RecommendationViewModel";

/*
 * The header of the recommendations page: a coverage bar, four stat tiles and
 * the search/severity row.
 *
 * Everything here is a control that reports state back to the page, and every
 * way of breaking it is silent. A tile that hands back a filter state missing
 * one field drops the user's search text on the floor the moment they click a
 * number. A tile that never clears itself traps them in a filtered view. And
 * the coverage bar divides by the total, so on a project with an empty catalog
 * it paints a NaN-wide bar and reads "0 of 0" — the page renders, nothing
 * throws, and the first thing the user sees is broken.
 *
 * So these assert what a person can see and press, and pin the exact object
 * handed back on every press.
 */

/*
 * Every count is deliberately above one. The tile labels are built by
 * interpolation with a hardcoded plural ("Show the ${n} dismissed
 * recommendations"), so a fixture with a count of one would bake
 * "Show the 1 dismissed recommendations" into this suite and stand in the way
 * of ever fixing that copy.
 */
const DEFAULT_COUNTS: RecommendationCounts = {
  total: 13,
  available: 7,
  created: 4,
  dismissed: 2,
  availableCritical: 3,
  availableWarning: 4,
};

const DEFAULT_FILTER_STATE: RecommendationFilterState = {
  searchText: "",
  status: RecommendationStatusFilter.All,
  severity: RecommendationSeverityFilter.All,
};

const SEARCH_PLACEHOLDER: string = "Search recommendations...";

let filterStateChanges: Array<RecommendationFilterState> = [];

interface RenderToolbarOptions {
  counts?: Partial<RecommendationCounts> | undefined;
  filterState?: Partial<RecommendationFilterState> | undefined;
  isDisabled?: boolean | undefined;
}

type RenderToolbarFunction = (options?: RenderToolbarOptions) => void;

const renderToolbar: RenderToolbarFunction = (
  options: RenderToolbarOptions = {},
): void => {
  render(
    <RecommendationToolbar
      counts={{ ...DEFAULT_COUNTS, ...(options.counts || {}) }}
      filterState={{ ...DEFAULT_FILTER_STATE, ...(options.filterState || {}) }}
      isDisabled={options.isDisabled}
      onFilterStateChange={(filterState: RecommendationFilterState) => {
        filterStateChanges.push(filterState);
      }}
    />,
  );
};

type LatestFilterStateFunction = () => RecommendationFilterState;

const latestFilterState: LatestFilterStateFunction =
  (): RecommendationFilterState => {
    const latest: RecommendationFilterState | undefined =
      filterStateChanges[filterStateChanges.length - 1];

    if (!latest) {
      throw new Error("onFilterStateChange was never called");
    }

    return latest;
  };

/*
 * The tiles carry no visible label a query can hold onto other than a bare
 * number, so the aria-label is the handle — which is the point: it is also the
 * only thing a screen reader user gets to tell four numbers apart.
 */
type TileFunction = (accessibleName: string) => HTMLElement;

const tile: TileFunction = (accessibleName: string): HTMLElement => {
  return screen.getByRole("button", { name: accessibleName });
};

const ALL_TILE_LABEL: string = "Show all 13 recommendations";
const AVAILABLE_TILE_LABEL: string =
  "Show the 7 recommendations that are not set up yet";
const CREATED_TILE_LABEL: string =
  "Show the 4 recommendations that are already created";
const DISMISSED_TILE_LABEL: string = "Show the 2 dismissed recommendations";

beforeEach(() => {
  filterStateChanges = [];
});

describe("RecommendationToolbar", () => {
  describe("coverage bar", () => {
    /*
     * The one line that answers "how much of this is actually watched". The
     * four tiles below have always carried the raw numbers; reading
     * "13 / 7 / 4 / 2" and working out the fraction is arithmetic the page can
     * do, so if this disappears the page gets meaningfully harder to read
     * without failing anywhere else.
     */
    test("reports created out of total", () => {
      renderToolbar();

      expect(
        screen.getByText("4 of 13 recommended monitors created"),
      ).toBeInTheDocument();
      expect(screen.getByRole("progressbar")).toBeInTheDocument();
    });

    /*
     * created/total, not total/created. Swapped, the ratio is 300%, clamps to
     * a full bar, and tells every project that everything is already set up.
     */
    test("the bar fills to the created share, not the other way round", () => {
      renderToolbar();

      expect(screen.getByRole("progressbar")).toHaveAttribute(
        "aria-valuenow",
        "31",
      );
    });

    /*
     * The whole reason the bar is guarded. ProgressBar divides by totalCount,
     * so a project whose catalog produced nothing gets NaN% and a bar with
     * style="width: NaN%" — visibly broken on a page that is otherwise
     * correctly saying there is nothing to do.
     */
    test("it does not render at all when there is nothing to cover", () => {
      renderToolbar({
        counts: {
          total: 0,
          available: 0,
          created: 0,
          dismissed: 0,
          availableCritical: 0,
          availableWarning: 0,
        },
      });

      expect(screen.queryByRole("progressbar")).not.toBeInTheDocument();
      expect(
        screen.queryByTestId("recommendation-coverage"),
      ).not.toBeInTheDocument();
    });

    test("a zero total paints no NaN anywhere", () => {
      const { container } = render(
        <RecommendationToolbar
          counts={{
            total: 0,
            available: 0,
            created: 0,
            dismissed: 0,
            availableCritical: 0,
            availableWarning: 0,
          }}
          filterState={DEFAULT_FILTER_STATE}
          onFilterStateChange={() => {}}
        />,
      );

      expect(container.innerHTML).not.toContain("NaN");
    });

    // The tiles are the page's only summary once the bar is gone.
    test("the tiles still render when the bar is suppressed", () => {
      renderToolbar({
        counts: {
          total: 0,
          available: 0,
          created: 0,
          dismissed: 0,
          availableCritical: 0,
          availableWarning: 0,
        },
      });

      expect(screen.getAllByRole("button")).toHaveLength(4);
      expect(
        screen.getByRole("button", { name: "Show all 0 recommendations" }),
      ).toBeInTheDocument();
    });
  });

  describe("stat tiles", () => {
    test("all four counts render", () => {
      renderToolbar();

      expect(within(tile(ALL_TILE_LABEL)).getByText("13")).toBeInTheDocument();
      expect(
        within(tile(AVAILABLE_TILE_LABEL)).getByText("7"),
      ).toBeInTheDocument();
      expect(
        within(tile(CREATED_TILE_LABEL)).getByText("4"),
      ).toBeInTheDocument();
      expect(
        within(tile(DISMISSED_TILE_LABEL)).getByText("2"),
      ).toBeInTheDocument();
    });

    test("each tile is labelled with what pressing it does", () => {
      renderToolbar();

      expect(tile(ALL_TILE_LABEL)).toBeInTheDocument();
      expect(tile(AVAILABLE_TILE_LABEL)).toBeInTheDocument();
      expect(tile(CREATED_TILE_LABEL)).toBeInTheDocument();
      expect(tile(DISMISSED_TILE_LABEL)).toBeInTheDocument();
    });

    /*
     * Real toggle buttons rather than decorated divs. Summary numbers you
     * cannot act on are decoration, and a div with an onClick is unreachable
     * by keyboard and announces neither its role nor its pressed state.
     */
    test("the tiles are toggle buttons carrying their own pressed state", () => {
      renderToolbar({
        filterState: { status: RecommendationStatusFilter.Created },
      });

      expect(tile(CREATED_TILE_LABEL).tagName).toBe("BUTTON");
      expect(tile(CREATED_TILE_LABEL)).toHaveAttribute("aria-pressed", "true");
      expect(tile(ALL_TILE_LABEL)).toHaveAttribute("aria-pressed", "false");
    });

    /*
     * The filter state is one object, and every control rebuilds it. A tile
     * that spreads the wrong thing silently clears the search box the user is
     * halfway through typing into, or resets the severity they just picked —
     * with the list underneath quietly widening at the same moment.
     */
    test("pressing a tile sets its status and preserves the rest of the filter", () => {
      renderToolbar({
        filterState: {
          searchText: "cpu",
          status: RecommendationStatusFilter.All,
          severity: RecommendationSeverityFilter.Critical,
        },
      });

      fireEvent.click(tile(AVAILABLE_TILE_LABEL));

      expect(filterStateChanges).toHaveLength(1);
      expect(latestFilterState()).toEqual({
        searchText: "cpu",
        status: RecommendationStatusFilter.Available,
        severity: RecommendationSeverityFilter.Critical,
      });
    });

    test("each tile hands back its own status", () => {
      renderToolbar();

      fireEvent.click(tile(CREATED_TILE_LABEL));
      expect(latestFilterState().status).toBe(
        RecommendationStatusFilter.Created,
      );

      fireEvent.click(tile(DISMISSED_TILE_LABEL));
      expect(latestFilterState().status).toBe(
        RecommendationStatusFilter.Dismissed,
      );
    });

    /*
     * Pressing the tile that is already pressed clears the filter instead of
     * doing nothing. A pressed toggle that ignores a press reads as broken,
     * and "show me everything again" would otherwise be a trip back to a
     * different control.
     */
    test("pressing the active tile clears the filter back to All", () => {
      renderToolbar({
        filterState: {
          searchText: "cpu",
          status: RecommendationStatusFilter.Available,
          severity: RecommendationSeverityFilter.Warning,
        },
      });

      fireEvent.click(tile(AVAILABLE_TILE_LABEL));

      expect(latestFilterState()).toEqual({
        searchText: "cpu",
        status: RecommendationStatusFilter.All,
        severity: RecommendationSeverityFilter.Warning,
      });
    });

    /*
     * "All" is itself a tile, so pressing it while it is active is the one
     * case where the toggle-off lands on the value that is already set. It
     * must stay All rather than flipping to something else.
     */
    test("pressing the active All tile leaves the filter on All", () => {
      renderToolbar({
        filterState: { status: RecommendationStatusFilter.All },
      });

      fireEvent.click(tile(ALL_TILE_LABEL));

      expect(latestFilterState().status).toBe(RecommendationStatusFilter.All);
    });

    /*
     * Two tiles lit at once would describe a filter state that cannot exist,
     * and the user would have no way to tell which one the list below is
     * obeying.
     */
    test("exactly one tile is pressed, and it is the one matching the filter", () => {
      renderToolbar({
        filterState: { status: RecommendationStatusFilter.Dismissed },
      });

      const pressed: Array<HTMLElement> = screen.getAllByRole("button", {
        pressed: true,
      });

      expect(pressed).toHaveLength(1);
      expect(pressed[0]).toHaveAttribute("aria-label", DISMISSED_TILE_LABEL);
    });

    test("the All tile is the pressed one on an unfiltered page", () => {
      renderToolbar();

      const pressed: Array<HTMLElement> = screen.getAllByRole("button", {
        pressed: true,
      });

      expect(pressed).toHaveLength(1);
      expect(pressed[0]).toHaveAttribute("aria-label", ALL_TILE_LABEL);
    });

    test("the Created tile is the pressed one when the filter is Created", () => {
      renderToolbar({
        filterState: { status: RecommendationStatusFilter.Created },
      });

      const pressed: Array<HTMLElement> = screen.getAllByRole("button", {
        pressed: true,
      });

      expect(pressed).toHaveLength(1);
      expect(pressed[0]).toHaveAttribute("aria-label", CREATED_TILE_LABEL);
    });
  });

  describe("severity filter", () => {
    test("all three severity choices render", () => {
      renderToolbar();

      expect(
        screen.getByRole("radio", { name: /All severities/ }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("radio", { name: /Critical/ }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("radio", { name: /Warning/ }),
      ).toBeInTheDocument();
    });

    /*
     * The badges count AVAILABLE recommendations only — see
     * RecommendationFilterUtil.getCounts. A badge that counted created and
     * dismissed ones too would promise work that filtering cannot produce:
     * click Critical, get fewer cards than the badge said.
     */
    test("the badges carry the available Critical and Warning counts", () => {
      renderToolbar();

      expect(
        within(screen.getByRole("radio", { name: /Critical/ })).getByText("3"),
      ).toBeInTheDocument();
      expect(
        within(screen.getByRole("radio", { name: /Warning/ })).getByText("4"),
      ).toBeInTheDocument();
    });

    test("the active severity is the checked one", () => {
      renderToolbar({
        filterState: { severity: RecommendationSeverityFilter.Warning },
      });

      expect(screen.getByRole("radio", { name: /Warning/ })).toBeChecked();
      expect(screen.getByRole("radio", { name: /Critical/ })).not.toBeChecked();
    });

    test("choosing a severity changes only the severity", () => {
      renderToolbar({
        filterState: {
          searchText: "memory",
          status: RecommendationStatusFilter.Available,
          severity: RecommendationSeverityFilter.All,
        },
      });

      fireEvent.click(screen.getByRole("radio", { name: /Critical/ }));

      expect(filterStateChanges).toHaveLength(1);
      expect(latestFilterState()).toEqual({
        searchText: "memory",
        status: RecommendationStatusFilter.Available,
        severity: RecommendationSeverityFilter.Critical,
      });
    });

    test("choosing All severities clears the severity and nothing else", () => {
      renderToolbar({
        filterState: {
          searchText: "memory",
          status: RecommendationStatusFilter.Available,
          severity: RecommendationSeverityFilter.Critical,
        },
      });

      fireEvent.click(screen.getByRole("radio", { name: /All severities/ }));

      expect(latestFilterState()).toEqual({
        searchText: "memory",
        status: RecommendationStatusFilter.Available,
        severity: RecommendationSeverityFilter.All,
      });
    });
  });

  describe("search", () => {
    test("typing hands back the text and leaves the rest of the filter alone", async () => {
      const user: ReturnType<typeof userEvent.setup> = userEvent.setup();

      renderToolbar({
        filterState: {
          searchText: "",
          status: RecommendationStatusFilter.Created,
          severity: RecommendationSeverityFilter.Warning,
        },
      });

      await user.type(screen.getByPlaceholderText(SEARCH_PLACEHOLDER), "cpu");

      expect(
        filterStateChanges.map((filterState: RecommendationFilterState) => {
          return filterState.searchText;
        }),
      ).toEqual(["c", "cp", "cpu"]);

      expect(latestFilterState()).toEqual({
        searchText: "cpu",
        status: RecommendationStatusFilter.Created,
        severity: RecommendationSeverityFilter.Warning,
      });
    });

    test("the search box shows the search text it was given", () => {
      renderToolbar({ filterState: { searchText: "etcd" } });

      expect(screen.getByPlaceholderText(SEARCH_PLACEHOLDER)).toHaveValue(
        "etcd",
      );
    });

    /*
     * isDisabled is set while a bulk create is in flight. Re-filtering
     * mid-create would move cards out from under a selection that is already
     * being POSTed.
     *
     * Common's Input renders `disabled` as a read-only field (it stays
     * focusable and copyable rather than being skipped by the tab order), so
     * what is pinned here is the effect the user feels: keystrokes produce no
     * filter change at all, and the field is painted as unavailable.
     */
    test("isDisabled stops the search box accepting input", async () => {
      const user: ReturnType<typeof userEvent.setup> = userEvent.setup();

      renderToolbar({ isDisabled: true });

      const searchInput: HTMLElement =
        screen.getByPlaceholderText(SEARCH_PLACEHOLDER);

      await user.type(searchInput, "cpu");

      expect(filterStateChanges).toHaveLength(0);
      expect(searchInput).toHaveAttribute("readonly");
      expect(searchInput.className).toContain("cursor-not-allowed");
    });

    test("the search box is editable when nothing is in flight", async () => {
      const user: ReturnType<typeof userEvent.setup> = userEvent.setup();

      renderToolbar({ isDisabled: false });

      await user.type(screen.getByPlaceholderText(SEARCH_PLACEHOLDER), "c");

      expect(latestFilterState().searchText).toBe("c");
    });
  });
});
