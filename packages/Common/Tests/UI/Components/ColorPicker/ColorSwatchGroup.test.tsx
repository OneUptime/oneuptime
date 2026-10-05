import { COLOR_PICKER_SWATCHES } from "../../../../UI/Components/ColorPicker/ColorPalette";
import ColorSwatchGroup, {
  ColorSwatchGroupLayout,
  ColorSwatchPickDetails,
  getSwatchShadow,
  splitSwatchRuns,
} from "../../../../UI/Components/ColorPicker/ColorSwatchGroup";
import getJestMockFunction, { MockFunction } from "../../../../Tests/MockType";
import "@testing-library/jest-dom";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * The swatches of a color field, as one radio group: one Tab stop, arrows
 * move and pick as they go, Space or Enter (a button's click) picks, and an
 * optional field's way back to no color is the first radio of the group.
 */

interface Harness {
  onPick: MockFunction;
  group: HTMLElement;
}

const renderGroup: (props?: {
  value?: string;
  clearable?: boolean;
  disabled?: boolean;
  layout?: ColorSwatchGroupLayout;
}) => Harness = (
  props: {
    value?: string;
    clearable?: boolean;
    disabled?: boolean;
    layout?: ColorSwatchGroupLayout;
  } = {},
): Harness => {
  const onPick: MockFunction = getJestMockFunction();

  render(
    <ColorSwatchGroup
      swatches={COLOR_PICKER_SWATCHES}
      value={props.value ?? ""}
      onPick={onPick}
      layout={props.layout || "row"}
      ariaLabel="Label Color"
      clearOption={props.clearable ? { label: "No color" } : undefined}
      disabled={props.disabled}
    />,
  );

  return { onPick, group: screen.getByRole("radiogroup") };
};

const radios: (group: HTMLElement) => Array<HTMLElement> = (
  group: HTMLElement,
): Array<HTMLElement> => {
  return within(group).getAllByRole("radio");
};

const lastPick: (
  onPick: MockFunction,
) => [string | null, ColorSwatchPickDetails] = (
  onPick: MockFunction,
): [string | null, ColorSwatchPickDetails] => {
  return onPick.mock.calls[onPick.mock.calls.length - 1] as [
    string | null,
    ColorSwatchPickDetails,
  ];
};

describe("ColorSwatchGroup", () => {
  afterEach(() => {
    cleanup();
  });

  test("is one labelled radio group with a named radio per color, in the palette's order", () => {
    const { group } = renderGroup();

    expect(group).toHaveAccessibleName("Label Color");
    expect(
      radios(group).map((radio: HTMLElement): string => {
        return radio.getAttribute("aria-label") || "";
      }),
    ).toEqual(
      COLOR_PICKER_SWATCHES.map((swatch: { name: string }): string => {
        return swatch.name;
      }),
    );

    // Each says its name on hover too, for a colorblind reader.
    for (const radio of radios(group)) {
      expect(radio).toHaveAttribute("title", radio.getAttribute("aria-label"));
    }
  });

  test("ticks the picked color, however its code is written, and only that one", () => {
    const teal: string = COLOR_PICKER_SWATCHES.find(
      (swatch: { name: string }): boolean => {
        return swatch.name === "Teal";
      },
    )!.hex;
    const { group } = renderGroup({ value: teal.toUpperCase() });

    const checked: Array<HTMLElement> = radios(group).filter(
      (radio: HTMLElement): boolean => {
        return radio.getAttribute("aria-checked") === "true";
      },
    );

    expect(checked).toHaveLength(1);
    expect(checked[0]).toHaveAccessibleName("Teal");
    // A tick, and a ring in the swatch's own color.
    expect(checked[0]!.querySelector("svg")).not.toBeNull();
    expect(checked[0]!.style.boxShadow).toBe(getSwatchShadow(teal, true));
  });

  test("a custom color ticks no swatch, and the first one keeps the Tab stop", () => {
    const { group } = renderGroup({ value: "#3e409a" });

    for (const radio of radios(group)) {
      expect(radio).toHaveAttribute("aria-checked", "false");
    }

    expect(radios(group)[0]).toHaveAttribute("tabindex", "0");
    expect(
      radios(group).filter((radio: HTMLElement): boolean => {
        return radio.getAttribute("tabindex") === "0";
      }),
    ).toHaveLength(1);
  });

  test("the picked color is the group's one Tab stop", () => {
    const { group } = renderGroup({ value: COLOR_PICKER_SWATCHES[4]!.hex });

    radios(group).forEach((radio: HTMLElement, index: number) => {
      expect(radio).toHaveAttribute("tabindex", index === 4 ? "0" : "-1");
    });
  });

  test("a click picks a color, as a choice made (not an arrow passing by)", () => {
    const { group, onPick } = renderGroup();

    fireEvent.click(within(group).getByRole("radio", { name: "Green" }));

    expect(onPick).toHaveBeenCalledTimes(1);
    expect(lastPick(onPick)).toEqual([
      COLOR_PICKER_SWATCHES.find((swatch: { name: string }): boolean => {
        return swatch.name === "Green";
      })!.hex,
      { isArrowKey: false },
    ]);
  });

  test("the arrow keys move focus and pick as they go, wrapping round the ends", () => {
    const { group, onPick } = renderGroup({
      value: COLOR_PICKER_SWATCHES[0]!.hex,
    });
    const all: Array<HTMLElement> = radios(group);

    all[0]!.focus();
    expect(fireEvent.keyDown(all[0]!, { key: "ArrowRight" })).toBe(false);
    expect(document.activeElement).toBe(all[1]);
    expect(lastPick(onPick)).toEqual([
      COLOR_PICKER_SWATCHES[1]!.hex,
      { isArrowKey: true },
    ]);

    fireEvent.keyDown(all[0]!, { key: "ArrowLeft" });
    expect(document.activeElement).toBe(all[all.length - 1]);
    expect(lastPick(onPick)[0]).toBe(
      COLOR_PICKER_SWATCHES[COLOR_PICKER_SWATCHES.length - 1]!.hex,
    );

    fireEvent.keyDown(all[all.length - 1]!, { key: "ArrowDown" });
    expect(document.activeElement).toBe(all[0]);

    fireEvent.keyDown(all[3]!, { key: "ArrowUp" });
    expect(document.activeElement).toBe(all[2]);

    fireEvent.keyDown(all[3]!, { key: "End" });
    expect(document.activeElement).toBe(all[all.length - 1]);

    fireEvent.keyDown(all[3]!, { key: "Home" });
    expect(document.activeElement).toBe(all[0]);
  });

  test("other keys are left alone", () => {
    const { group, onPick } = renderGroup();
    const first: HTMLElement = radios(group)[0]!;

    expect(fireEvent.keyDown(first, { key: "Tab" })).toBe(true);
    expect(fireEvent.keyDown(first, { key: "a" })).toBe(true);
    expect(onPick).not.toHaveBeenCalled();
  });

  test("an optional field's way back to no color is the group's first radio", () => {
    const { group, onPick } = renderGroup({
      clearable: true,
      value: COLOR_PICKER_SWATCHES[2]!.hex,
    });
    const clear: HTMLElement = radios(group)[0]!;

    expect(clear).toHaveAccessibleName("No color");
    expect(clear).toHaveAttribute("data-testid", "color-picker-clear");
    expect(clear).toHaveAttribute("aria-checked", "false");

    fireEvent.click(clear);

    expect(lastPick(onPick)).toEqual([null, { isArrowKey: false }]);
  });

  test("with no color, the way back to none is the one ticked", () => {
    const { group } = renderGroup({ clearable: true, value: "" });

    expect(radios(group)[0]).toHaveAttribute("aria-checked", "true");
    expect(radios(group)[0]).toHaveAttribute("tabindex", "0");
  });

  test("a required field has no way back to no color", () => {
    const { group } = renderGroup({ clearable: false });

    expect(
      within(group).queryByRole("radio", { name: "No color" }),
    ).toBeNull();
  });

  test("a disabled group picks nothing, by click or by key", () => {
    const { group, onPick } = renderGroup({ disabled: true });

    expect(group).toHaveAttribute("aria-disabled", "true");

    for (const radio of radios(group)) {
      expect(radio).toBeDisabled();
    }

    fireEvent.click(radios(group)[1]!);
    fireEvent.keyDown(radios(group)[1]!, { key: "ArrowRight" });

    expect(onPick).not.toHaveBeenCalled();
  });

  test("in a row the colors wrap as two runs of five, never nine and one", () => {
    const { group } = renderGroup({ clearable: true });
    const runs: Array<HTMLElement> = within(group).getAllByTestId(
      "color-picker-swatch-run",
    );

    expect(runs).toHaveLength(2);
    expect(within(runs[0]!).getAllByRole("radio")).toHaveLength(5);
    expect(within(runs[1]!).getAllByRole("radio")).toHaveLength(5);
    // "No color" sits before the runs, not inside one.
    expect(runs[0]!.contains(radios(group)[0]!)).toBe(false);
  });

  test("in a grid the colors sit five to a line", () => {
    const { group } = renderGroup({ layout: "grid" });

    expect(group.querySelector(".grid-cols-5")).not.toBeNull();
    expect(within(group).queryAllByTestId("color-picker-swatch-run")).toEqual(
      [],
    );
  });
});

describe("splitSwatchRuns", () => {
  test.each([
    [0, []],
    [3, [3]],
    [5, [5]],
    [6, [3, 3]],
    [10, [5, 5]],
    [11, [6, 5]],
  ])("%i swatches wrap as runs of %p", (count: number, lengths: Array<number>) => {
    const items: Array<number> = Array.from(
      { length: count },
      (_value: unknown, index: number): number => {
        return index;
      },
    );
    const runs: Array<Array<number>> = splitSwatchRuns(items);

    expect(
      runs.map((run: Array<number>): number => {
        return run.length;
      }),
    ).toEqual(lengths);
    // Nothing lost, nothing reordered.
    expect(runs.flat()).toEqual(items);
  });
});
