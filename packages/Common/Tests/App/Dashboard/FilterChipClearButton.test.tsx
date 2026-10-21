import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import {
  act,
  cleanup,
  render,
  RenderResult,
  screen,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React, { ReactElement } from "react";
import FilterChipDateRange from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceOwners/FilterChipDateRange";
import FilterChipDropdown from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceOwners/FilterChipDropdown";
import {
  FILTER_CHIP_ACTIVE_CLASSES,
  FILTER_CHIP_BOX_CLASSES,
  FILTER_CHIP_CLEAR_CLASSES,
  FILTER_CHIP_CLEAR_PLACE_CLASSES,
  FILTER_CHIP_INACTIVE_CLASSES,
  FILTER_CHIP_TRIGGER_CLASSES,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceOwners/FilterChipStyles";
import FilterChipValueInput from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceOwners/FilterChipValueInput";
import getJestMockFunction, { MockFunction } from "../../MockType";
import {
  describeNestedControls,
  findNestedControls,
} from "../../Helpers/NestedControls";

/*
 * The facet bar's chips (every list with filter chips: incidents, alerts,
 * monitors, inventory, session replays ...) clear themselves with an "x".
 * That "x" used to be a span acting as a button inside the chip's own
 * button, so a screen reader heard one button ("Status · Open Clear Status
 * filter") and the clear control was lost to it.
 *
 * Now the chip is two buttons in one pill (FilterChipButton): the chip's
 * button, which opens its popover, and a real clear button beside it. The
 * pill draws the border, fill and hover around both, the chip's button lies
 * over the pill's border, and the clear button sits where the "x" sat.
 */

type UserEventController = ReturnType<typeof userEvent.setup>;

interface ChipHarness {
  onChange: MockFunction;
  view: RenderResult;
}

type RenderChipFunction = () => ChipHarness;

const renderOptionChip: RenderChipFunction = (): ChipHarness => {
  const onChange: MockFunction = getJestMockFunction();
  const view: RenderResult = render(
    <FilterChipDropdown
      label="Status"
      options={[
        { value: "open", label: "Open" },
        { value: "closed", label: "Closed" },
      ]}
      value="open"
      onChange={(value: string | Array<string> | null): void => {
        onChange(value);
      }}
    />,
  );
  return { onChange, view };
};

const renderTextChip: RenderChipFunction = (): ChipHarness => {
  const onChange: MockFunction = getJestMockFunction();
  const view: RenderResult = render(
    <FilterChipValueInput
      label="Status"
      values={["JIRA-12"]}
      operator="contains"
      valueType="text"
      onChange={(values: Array<string>, operator: string): void => {
        onChange(values, operator);
      }}
    />,
  );
  return { onChange, view };
};

const renderDateChip: RenderChipFunction = (): ChipHarness => {
  const onChange: MockFunction = getJestMockFunction();
  const view: RenderResult = render(
    <FilterChipDateRange
      label="Status"
      values={["2026-09-01T00:00:00.000Z"]}
      operator="before"
      onChange={(values: Array<string>, operator: string): void => {
        onChange(values, operator);
      }}
    />,
  );
  return { onChange, view };
};

// What each chip hands back when it is cleared.
const CLEARED: Record<string, Array<unknown>> = {
  FilterChipDropdown: [null],
  FilterChipValueInput: [[], "is"],
  FilterChipDateRange: [[], "is"],
};

const getChipButton: () => HTMLElement = (): HTMLElement => {
  return screen.getByRole("button", { name: /^Status( ·|$)/ });
};

const getClearButton: () => HTMLElement = (): HTMLElement => {
  return screen.getByRole("button", { name: "Clear Status filter" });
};

const getPill: () => HTMLElement = (): HTMLElement => {
  return screen.getByTestId("filter-chip");
};

const classesOf: (element: Element) => Array<string> = (
  element: Element,
): Array<string> => {
  return (element.getAttribute("class") || "").split(/\s+/).filter(Boolean);
};

const tokens: (classes: string) => Array<string> = (
  classes: string,
): Array<string> => {
  return classes.split(/\s+/).filter(Boolean);
};

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe.each([
  ["FilterChipDropdown", renderOptionChip],
  ["FilterChipValueInput", renderTextChip],
  ["FilterChipDateRange", renderDateChip],
])(
  "%s with a filter applied",
  (name: string, renderChip: RenderChipFunction) => {
    test("its clear button is a real button beside the chip's own, in one pill", () => {
      const harness: ChipHarness = renderChip();

      const chip: HTMLElement = getChipButton();
      const clear: HTMLElement = getClearButton();

      expect(clear.tagName).toBe("BUTTON");
      expect(clear).toHaveAttribute("type", "button");
      expect(chip.contains(clear)).toBe(false);
      expect(chip.parentElement).toBe(getPill());
      expect(clear.parentElement).toBe(getPill());
      // The chip first: Tab reaches it, then its clear button.
      expect(
        chip.compareDocumentPosition(clear) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
      // The chip's name is what it says; the clear button is not part of it.
      expect(chip).not.toHaveAccessibleName(/Clear/);
      expect(
        describeNestedControls(findNestedControls(harness.view.container)),
      ).toEqual([]);
    });

    test("a click on it clears the chip and leaves its popover shut", async () => {
      const user: UserEventController = userEvent.setup();
      const harness: ChipHarness = renderChip();

      await user.click(getClearButton());

      expect(harness.onChange).toHaveBeenCalledTimes(1);
      expect(harness.onChange).toHaveBeenCalledWith(...CLEARED[name]!);
      expect(getChipButton()).toHaveAttribute("aria-expanded", "false");
      expect(screen.queryByRole("dialog")).toBeNull();
    });

    test.each(["{Enter}", " "])(
      "Tab reaches the chip, then its clear button, and %p clears it",
      async (key: string) => {
        const user: UserEventController = userEvent.setup();
        const harness: ChipHarness = renderChip();

        await user.tab();
        expect(getChipButton()).toHaveFocus();
        await user.tab();
        expect(getClearButton()).toHaveFocus();

        await user.keyboard(key);

        expect(harness.onChange).toHaveBeenCalledWith(...CLEARED[name]!);
        expect(screen.queryByRole("dialog")).toBeNull();
      },
    );

    test("the chip's button still opens its popover", async () => {
      const user: UserEventController = userEvent.setup();
      const harness: ChipHarness = renderChip();

      await user.click(getChipButton());

      expect(getChipButton()).toHaveAttribute("aria-expanded", "true");
      expect(screen.getByRole("dialog")).toBeInTheDocument();
      expect(harness.onChange).not.toHaveBeenCalled();
    });

    /*
     * The look of the one button it used to be: the pill draws the border, the
     * fill and the hover around both buttons, so pointing at the clear button
     * lights the pill as pointing at the chip does; the chip's button lies over
     * the pill's border and draws the focus ring; it keeps the clear button's
     * place, and the clear button is laid over that place.
     */
    test("the pill draws the border, fill and hover around both buttons", () => {
      renderChip();

      const pill: HTMLElement = getPill();
      const chip: HTMLElement = getChipButton();
      const clear: HTMLElement = getClearButton();

      expect(classesOf(pill)).toEqual(
        expect.arrayContaining([
          ...tokens(FILTER_CHIP_BOX_CLASSES),
          ...tokens(FILTER_CHIP_ACTIVE_CLASSES),
        ]),
      );
      expect(classesOf(pill)).toEqual(
        expect.arrayContaining([
          "hover:bg-indigo-100",
          "hover:border-indigo-300",
        ]),
      );
      expect(classesOf(chip)).toEqual(tokens(FILTER_CHIP_TRIGGER_CLASSES));
      expect(classesOf(chip)).toEqual(
        expect.arrayContaining([
          "-m-px",
          "border",
          "border-transparent",
          "focus-visible:ring-2",
        ]),
      );
      expect(classesOf(chip)).not.toContain("hover:bg-indigo-100");

      const place: HTMLElement = screen.getByTestId("filter-chip-clear-place");
      expect(chip.contains(place)).toBe(true);
      expect(place).toHaveAttribute("aria-hidden", "true");
      expect(classesOf(place)).toEqual(tokens(FILTER_CHIP_CLEAR_PLACE_CLASSES));
      expect(clear).toBe(screen.getByTestId("filter-chip-clear"));

      expect(classesOf(clear)).toEqual(tokens(FILTER_CHIP_CLEAR_CLASSES));
      expect(classesOf(clear)).toEqual(
        expect.arrayContaining([
          "absolute",
          "right-2.5",
          "top-1/2",
          "-translate-y-1/2",
          "h-4",
          "w-4",
          // A keyboard user sees where they are; the old span showed nothing.
          "focus-visible:ring-2",
        ]),
      );
    });
  },
);

describe("a chip with nothing applied", () => {
  test.each([
    [
      "FilterChipDropdown",
      (): ReactElement => {
        return (
          <FilterChipDropdown
            label="Status"
            options={[{ value: "open", label: "Open" }]}
            value={null}
            onChange={(): void => {}}
          />
        );
      },
    ],
    [
      "FilterChipValueInput",
      (): ReactElement => {
        return (
          <FilterChipValueInput
            label="Status"
            values={[]}
            operator="is"
            valueType="text"
            onChange={(): void => {}}
          />
        );
      },
    ],
    [
      "FilterChipDateRange",
      (): ReactElement => {
        return (
          <FilterChipDateRange
            label="Status"
            values={[]}
            operator="is"
            onChange={(): void => {}}
          />
        );
      },
    ],
  ])(
    "%s is one button in a white pill, with no clear button",
    (_name: string, chip: () => ReactElement) => {
      const view: RenderResult = render(chip());

      expect(getChipButton()).toHaveAccessibleName("Status");
      expect(
        screen.queryByRole("button", { name: "Clear Status filter" }),
      ).toBeNull();
      expect(screen.queryByTestId("filter-chip-clear-place")).toBeNull();
      expect(screen.queryByTestId("filter-chip-clear")).toBeNull();
      expect(classesOf(getPill())).toEqual(
        expect.arrayContaining(tokens(FILTER_CHIP_INACTIVE_CLASSES)),
      );
      expect(
        describeNestedControls(findNestedControls(view.container)),
      ).toEqual([]);
    },
  );
});

describe("a date chip with half a range", () => {
  test("reads as unfinished (a white pill) and can still be cleared", async () => {
    const user: UserEventController = userEvent.setup();
    const onChange: MockFunction = getJestMockFunction();

    render(
      <FilterChipDateRange
        label="Status"
        values={["2026-09-01T00:00:00.000Z/"]}
        operator="between"
        onChange={(values: Array<string>, operator: string): void => {
          onChange(values, operator);
        }}
      />,
    );

    expect(classesOf(getPill())).toEqual(
      expect.arrayContaining(tokens(FILTER_CHIP_INACTIVE_CLASSES)),
    );

    act(() => {
      getClearButton().focus();
    });
    await user.keyboard("{Enter}");

    expect(onChange).toHaveBeenCalledWith([], "is");
  });
});
