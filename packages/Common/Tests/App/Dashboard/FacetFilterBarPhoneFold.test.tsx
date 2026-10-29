import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React, { ReactElement } from "react";
import FacetFilterBar from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceOwners/FacetFilterBar";
import FilterChipDateRange from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceOwners/FilterChipDateRange";
import FilterChipDropdown from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceOwners/FilterChipDropdown";
import {
  FACET_FILTER_BAR_CLASS_NAME,
  FACET_FILTER_BAR_FOLDED_CLASS_NAME,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceOwners/FilterChipStyles";
import FilterChipValueInput from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceOwners/FilterChipValueInput";
import { PHONE_BELOW_WIDTH_IN_PX } from "../../../UI/Utils/UseIsBelowWidth";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * On a phone a list's filter chips fold away behind "Filter" (FacetFilterBar).
 *
 * An alerts list with two custom fields draws eight chips, and on a 390px
 * screen they took five lines under the search, Saved Views and Create:
 * the first alert started at the foot of the screen someone paged at night
 * opens first. Folded, the row is "Filter" and the chips that hold a
 * filter, so what the list is filtered by stays in sight, with "Clear
 * all"; "Filter" opens every chip and folds them again. From md up (where
 * the table draws rows, not cards) every chip is drawn, as before.
 *
 * jsdom draws no Tailwind, so what the fold hides is read here as the rule
 * says it - a child of the row holding a chip with no filter - and drawn in
 * real Chromium by E2E/ModelTables (the alerts list at 390 and 1280).
 */

type UserEventController = ReturnType<typeof userEvent.setup>;

const PHONE: number = 390;
const LAPTOP: number = 1280;

function setWindowWidth(width: number): void {
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    writable: true,
    value: width,
  });
}

afterEach(() => {
  cleanup();
  setWindowWidth(1024);
  jest.restoreAllMocks();
});

interface Harness {
  onClearAll: MockFunction;
}

/*
 * Three chips, one holding a filter, each in a place of its own as the
 * session and rule lists put them, and a line that is not a chip at all
 * (the rule library's count of rules).
 */
function renderBar(): Harness {
  const onClearAll: MockFunction = getJestMockFunction();

  render(
    <FacetFilterBar
      activeCount={1}
      onClearAll={(): void => {
        onClearAll();
      }}
      ariaLabel="Filters"
    >
      <div data-testid="place-state">
        <FilterChipDropdown
          label="State"
          options={[
            { value: "open", label: "Open" },
            { value: "closed", label: "Closed" },
          ]}
          value="open"
          onChange={(): void => {}}
        />
      </div>
      <div data-testid="place-severity">
        <FilterChipDropdown
          label="Severity"
          options={[{ value: "critical", label: "Critical" }]}
          value={null}
          onChange={(): void => {}}
        />
      </div>
      <FilterChipValueInput
        label="Title"
        values={[]}
        operator="contains"
        valueType="text"
        onChange={(): void => {}}
      />
      <span data-testid="row-count" role="status">
        12 rules
      </span>
    </FacetFilterBar>,
  );

  return { onClearAll };
}

function bar(): HTMLElement {
  return screen.getByTestId("facet-filter-bar");
}

function classesOf(element: Element): Array<string> {
  return (element.getAttribute("class") || "").split(/\s+/).filter(Boolean);
}

/*
 * The children of the row the fold rule hides, read as the rule reads:
 * "[&>*:has([data-filter-chip-set=false])]:hidden" - a child of the row
 * with a chip in it that holds no filter. Empty while the row is unfolded.
 */
function hiddenByFold(row: HTMLElement): Array<HTMLElement> {
  if (!classesOf(row).includes(FACET_FILTER_BAR_FOLDED_CLASS_NAME)) {
    return [];
  }

  return Array.from(row.children).filter((child: Element): boolean => {
    return Boolean(child.querySelector('[data-filter-chip-set="false"]'));
  }) as Array<HTMLElement>;
}

function drawnChipNames(row: HTMLElement): Array<string> {
  const hidden: Array<HTMLElement> = hiddenByFold(row);

  return Array.from(row.querySelectorAll('[data-testid="filter-chip"]'))
    .filter((chip: Element): boolean => {
      return !hidden.some((child: HTMLElement): boolean => {
        return child.contains(chip);
      });
    })
    .map((chip: Element): string => {
      return (chip.querySelector("button")?.textContent || "").trim();
    });
}

function toggle(): HTMLElement {
  return screen.getByTestId("facet-filter-bar-toggle");
}

describe("the fold's rule", () => {
  test("hides a child of the row that holds a chip with no filter, by the mark every chip carries", () => {
    expect(FACET_FILTER_BAR_FOLDED_CLASS_NAME).toBe(
      "[&>*:has([data-filter-chip-set=false])]:hidden",
    );
    // Not part of the row's own look: it is added only while folded.
    expect(FACET_FILTER_BAR_CLASS_NAME).not.toContain("data-filter-chip-set");
  });

  test("the phone is the table's phone: below md", () => {
    expect(PHONE_BELOW_WIDTH_IN_PX).toBe(768);
  });
});

describe("a chip says whether it holds a filter", () => {
  test.each([
    [
      "a list chip",
      <FilterChipDropdown
        key="a"
        label="State"
        options={[{ value: "open", label: "Open" }]}
        value="open"
        onChange={(): void => {}}
      />,
      <FilterChipDropdown
        key="b"
        label="State"
        options={[{ value: "open", label: "Open" }]}
        value={null}
        onChange={(): void => {}}
      />,
    ],
    [
      "a text chip",
      <FilterChipValueInput
        key="a"
        label="Title"
        values={["db"]}
        operator="contains"
        valueType="text"
        onChange={(): void => {}}
      />,
      <FilterChipValueInput
        key="b"
        label="Title"
        values={[]}
        operator="contains"
        valueType="text"
        onChange={(): void => {}}
      />,
    ],
    [
      "a date chip",
      <FilterChipDateRange
        key="a"
        label="Created"
        values={["2026-09-01T00:00:00.000Z"]}
        operator="before"
        onChange={(): void => {}}
      />,
      <FilterChipDateRange
        key="b"
        label="Created"
        values={[]}
        operator="is"
        onChange={(): void => {}}
      />,
    ],
  ])("%s", (_kind: string, setChip: ReactElement, emptyChip: ReactElement) => {
    render(
      <>
        {setChip}
        {emptyChip}
      </>,
    );

    expect(
      screen.getAllByTestId("filter-chip").map((chip: HTMLElement) => {
        return chip.getAttribute("data-filter-chip-set");
      }),
    ).toEqual(["true", "false"]);
  });
});

describe("from md up", () => {
  test.each([LAPTOP, PHONE_BELOW_WIDTH_IN_PX])(
    "at %ipx Filter is the row's label, every chip is drawn and nothing folds",
    (width: number) => {
      setWindowWidth(width);
      renderBar();

      expect(screen.queryByTestId("facet-filter-bar-toggle")).toBeNull();
      expect(screen.getByTestId("facet-filter-bar-label")).toHaveTextContent(
        /^Filter1$/,
      );
      expect(bar()).toHaveAttribute("data-folded", "false");
      expect(classesOf(bar())).not.toContain(
        FACET_FILTER_BAR_FOLDED_CLASS_NAME,
      );
      expect(drawnChipNames(bar())).toEqual([
        "State · Open",
        "Severity",
        "Title",
      ]);
    },
  );
});

describe("on a phone", () => {
  test("Filter is a button that says the row is folded, and which row", () => {
    setWindowWidth(PHONE);
    renderBar();

    const button: HTMLElement = screen.getByRole("button", {
      name: /^Filter/,
    });

    expect(button).toBe(toggle());
    expect(button).toHaveAttribute("type", "button");
    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(button).toHaveAttribute("aria-controls", bar().id);
    expect(bar().id).not.toBe("");
    // How many chips hold a filter, in its name.
    expect(button).toHaveAccessibleName("Filter 1");
    expect(screen.queryByTestId("facet-filter-bar-label")).toBeNull();
    expect(bar()).toHaveAttribute("data-folded", "true");
  });

  test("folded, the row draws the chips that hold a filter, and everything that is not a chip", () => {
    setWindowWidth(PHONE);
    renderBar();

    expect(drawnChipNames(bar())).toEqual(["State · Open"]);
    // The Severity chip goes with its place; the Title chip is its own.
    expect(hiddenByFold(bar())).toEqual([
      screen.getByTestId("place-severity"),
      screen
        .getByRole("button", { name: /^Title/ })
        .closest('[data-testid="filter-chip"]')!.parentElement,
    ]);

    for (const kept of [
      toggle(),
      screen.getByTestId("place-state"),
      screen.getByTestId("row-count"),
      screen.getByTestId("facet-filter-bar-clear-all"),
    ]) {
      expect(hiddenByFold(bar())).not.toContain(kept);
    }
  });

  test("pressing Filter draws every chip; pressing it again folds them", async () => {
    const user: UserEventController = userEvent.setup();
    setWindowWidth(PHONE);
    renderBar();

    await user.click(toggle());

    expect(toggle()).toHaveAttribute("aria-expanded", "true");
    expect(bar()).toHaveAttribute("data-folded", "false");
    expect(classesOf(bar())).not.toContain(FACET_FILTER_BAR_FOLDED_CLASS_NAME);
    expect(drawnChipNames(bar())).toEqual([
      "State · Open",
      "Severity",
      "Title",
    ]);

    await user.click(toggle());

    expect(toggle()).toHaveAttribute("aria-expanded", "false");
    expect(bar()).toHaveAttribute("data-folded", "true");
    expect(drawnChipNames(bar())).toEqual(["State · Open"]);
  });

  test("Enter and Space press it too", async () => {
    const user: UserEventController = userEvent.setup();
    setWindowWidth(PHONE);
    renderBar();

    toggle().focus();
    await user.keyboard("{Enter}");
    expect(toggle()).toHaveAttribute("aria-expanded", "true");

    await user.keyboard(" ");
    expect(toggle()).toHaveAttribute("aria-expanded", "false");
  });

  test("folded, Clear all is offered and empties the chips", async () => {
    const user: UserEventController = userEvent.setup();
    setWindowWidth(PHONE);
    const harness: Harness = renderBar();

    await user.click(screen.getByTestId("facet-filter-bar-clear-all"));

    expect(harness.onClearAll).toHaveBeenCalledTimes(1);
  });

  test("with nothing set, the folded row is Filter alone, with no count", () => {
    setWindowWidth(PHONE);
    render(
      <FacetFilterBar activeCount={0}>
        <FilterChipDropdown
          label="Severity"
          options={[{ value: "critical", label: "Critical" }]}
          value={null}
          onChange={(): void => {}}
        />
      </FacetFilterBar>,
    );

    expect(toggle()).toHaveAccessibleName("Filter");
    expect(screen.queryByTestId("facet-filter-bar-count")).toBeNull();
    expect(screen.queryByTestId("facet-filter-bar-clear-all")).toBeNull();
    expect(drawnChipNames(bar())).toEqual([]);
  });

  test("a window that turns wide unfolds, and folds again as a phone's", () => {
    setWindowWidth(PHONE);
    renderBar();

    expect(bar()).toHaveAttribute("data-folded", "true");

    act(() => {
      setWindowWidth(LAPTOP);
      window.dispatchEvent(new Event("resize"));
    });

    expect(screen.queryByTestId("facet-filter-bar-toggle")).toBeNull();
    expect(bar()).toHaveAttribute("data-folded", "false");
    expect(drawnChipNames(bar())).toHaveLength(3);

    act(() => {
      setWindowWidth(PHONE);
      window.dispatchEvent(new Event("resize"));
    });

    expect(toggle()).toHaveAttribute("aria-expanded", "false");
    expect(bar()).toHaveAttribute("data-folded", "true");
  });

  test("each row folds and opens on its own", async () => {
    const user: UserEventController = userEvent.setup();
    setWindowWidth(PHONE);
    render(
      <>
        <FacetFilterBar activeCount={0} dataTestId="first-row">
          <FilterChipDropdown
            label="Severity"
            options={[{ value: "critical", label: "Critical" }]}
            value={null}
            onChange={(): void => {}}
          />
        </FacetFilterBar>
        <FacetFilterBar activeCount={0} dataTestId="second-row">
          <FilterChipDropdown
            label="State"
            options={[{ value: "open", label: "Open" }]}
            value={null}
            onChange={(): void => {}}
          />
        </FacetFilterBar>
      </>,
    );

    const toggles: Array<HTMLElement> = screen.getAllByTestId(
      "facet-filter-bar-toggle",
    );

    expect(toggles[0]!.getAttribute("aria-controls")).toBe(
      screen.getByTestId("first-row").id,
    );
    expect(toggles[1]!.getAttribute("aria-controls")).toBe(
      screen.getByTestId("second-row").id,
    );
    expect(screen.getByTestId("first-row").id).not.toBe(
      screen.getByTestId("second-row").id,
    );

    await user.click(toggles[0]!);

    expect(screen.getByTestId("first-row")).toHaveAttribute(
      "data-folded",
      "false",
    );
    expect(screen.getByTestId("second-row")).toHaveAttribute(
      "data-folded",
      "true",
    );
  });
});
