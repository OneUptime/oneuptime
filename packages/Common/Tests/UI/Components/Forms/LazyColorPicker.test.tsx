import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen } from "@testing-library/react";
import * as React from "react";
import { COLOR_PICKER_SWATCHES } from "../../../../UI/Components/ColorPicker/ColorPalette";
import {
  COLOR_PILL_CLASS,
  COLOR_SWATCH_CLASS,
  splitSwatchRuns,
} from "../../../../UI/Components/ColorPicker/ColorSwatchGroup";
import ColorPicker, {
  CUSTOM_COLOR_LABEL,
  NO_COLOR_LABEL,
} from "../../../../UI/Components/Forms/Fields/ColorPicker";
import LazyColorPicker, {
  COLOR_PLACEHOLDER_CUSTOM_COLOR_LABEL,
  COLOR_PLACEHOLDER_NO_COLOR_LABEL,
  COLOR_PLACEHOLDER_PILL_CLASS,
  COLOR_PLACEHOLDER_SWATCH_CLASS,
} from "../../../../UI/Components/Forms/Fields/LazyColorPicker";
import { LazyLibrary } from "../../../../UI/Utils/LazyLibrary";

/*
 * THE COLOR FIELD IS A FILE OF ITS OWN (LazyColorPicker): every page with a
 * form reaches FormField, and the public pages' forms - the sign-in pages',
 * a status page's, a public dashboard's - pick no color
 * (packages/Common/Scripts/first-load-budgets.js). Until the field arrives,
 * its place draws its row of choices - "No color", a round swatch for each
 * ready color, "Custom color" - by the field's own words and sizes, so
 * nothing moves when it does. These hold the field's file back until the
 * test lets it arrive.
 */

interface HeldLoad {
  library: LazyLibrary<unknown>;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
}

const realLoad: () => Promise<unknown> = LazyLibrary.prototype.load;

let held: Array<HeldLoad> = [];

const arrive: () => Promise<void> = async (): Promise<void> => {
  await act(async () => {
    while (held.length > 0) {
      const load: HeldLoad = held.shift() as HeldLoad;

      realLoad.call(load.library).then(load.resolve, load.reject);

      await new Promise((resolve: (value: unknown) => void) => {
        setTimeout(resolve, 0);
      });
    }
  });
};

// A class a pill or a swatch takes its size from.
const SIZE_CLASS: RegExp =
  /^(inline-flex|shrink-0|items-center|rounded-full|border|text-xs|font-medium|h-\d+|w-\d+|gap-[\d.]+)$/;

// The classes a pill or a swatch takes its size from, out of the field's.
const sizeClassesOf: (className: string) => Array<string> = (
  className: string,
): Array<string> => {
  return className.split(/\s+/).filter((name: string): boolean => {
    return SIZE_CLASS.test(name);
  });
};

beforeEach(() => {
  held = [];

  jest.spyOn(LazyLibrary.prototype, "getLoaded").mockReturnValue(null);

  jest.spyOn(LazyLibrary.prototype, "load").mockImplementation(function (
    this: LazyLibrary<unknown>,
  ): Promise<unknown> {
    return new Promise(
      (
        resolve: (value: unknown) => void,
        reject: (error: unknown) => void,
      ): void => {
        held.push({ library: this, resolve, reject });
      },
    );
  });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("a form's color field, until its file arrives", () => {
  test("draws its row of choices: No color, ticked while nothing is picked, a circle per ready color, and Custom color", () => {
    render(<LazyColorPicker onChange={(): void => {}} value="" />);

    expect(screen.getByTestId("color-picker-placeholder")).toHaveAttribute(
      "data-load-state",
      "loading",
    );
    expect(screen.queryByTestId("color-picker")).not.toBeInTheDocument();

    const clear: HTMLElement = screen.getByTestId(
      "color-picker-placeholder-clear",
    );

    expect(clear).toHaveTextContent(NO_COLOR_LABEL);
    // Ticked, as the field ticks it: the tick takes its room in the pill.
    expect(clear.querySelector("svg")).not.toBeNull();
    expect(
      screen.getAllByTestId("color-picker-placeholder-swatch"),
    ).toHaveLength(COLOR_PICKER_SWATCHES.length);
    expect(
      screen.getByTestId("color-picker-placeholder-custom"),
    ).toHaveTextContent(CUSTOM_COLOR_LABEL);
  });

  test("lays the circles out in the field's runs, which wrap as wholes", () => {
    render(<LazyColorPicker onChange={(): void => {}} value="" />);

    const runs: Array<number> = Array.from(
      screen
        .getAllByTestId("color-picker-placeholder-swatch")
        .reduce((counts: Map<Element, number>, swatch: HTMLElement) => {
          const run: Element = swatch.parentElement as Element;
          counts.set(run, (counts.get(run) || 0) + 1);
          return counts;
        }, new Map<Element, number>())
        .values(),
    );

    expect(runs).toEqual(
      splitSwatchRuns(COLOR_PICKER_SWATCHES).map(
        (run: ReadonlyArray<unknown>): number => {
          return run.length;
        },
      ),
    );
  });

  test("says the field's words and takes the field's sizes", () => {
    expect(COLOR_PLACEHOLDER_NO_COLOR_LABEL).toBe(NO_COLOR_LABEL);
    expect(COLOR_PLACEHOLDER_CUSTOM_COLOR_LABEL).toBe(CUSTOM_COLOR_LABEL);
    expect(sizeClassesOf(COLOR_PLACEHOLDER_PILL_CLASS).sort()).toEqual(
      sizeClassesOf(COLOR_PILL_CLASS).sort(),
    );
    expect(sizeClassesOf(COLOR_PLACEHOLDER_SWATCH_CLASS).sort()).toEqual(
      sizeClassesOf(COLOR_SWATCH_CLASS).sort(),
    );
  });

  test("leaves No color out, and its tick, as the field does", () => {
    render(
      <LazyColorPicker
        onChange={(): void => {}}
        value="#6366f1"
        isClearable={false}
      />,
    );

    expect(
      screen.queryByTestId("color-picker-placeholder-clear"),
    ).not.toBeInTheDocument();
  });

  test("with as many circles as the field it stands in for", () => {
    render(<LazyColorPicker onChange={(): void => {}} value="" />);

    const placeholderSwatches: number = screen.getAllByTestId(
      "color-picker-placeholder-swatch",
    ).length;

    cleanup();
    render(<ColorPicker onChange={(): void => {}} value="" />);

    expect(screen.getAllByTestId("color-picker-swatch")).toHaveLength(
      placeholderSwatches,
    );
  });
});

describe("once its file arrives", () => {
  test("is the field, with what the form hands it", async () => {
    const onChange: (value: unknown) => void = jest.fn();

    render(
      <LazyColorPicker
        onChange={onChange}
        value="#6366f1"
        dataTestId="label-color"
      />,
    );

    expect(held).toHaveLength(1);

    await arrive();

    expect(screen.getByTestId("label-color")).toHaveAttribute(
      "data-value",
      "#6366f1",
    );
    expect(
      screen.queryByTestId("color-picker-placeholder"),
    ).not.toBeInTheDocument();
  });

  test("a file that does not arrive is said in the field's place", async () => {
    render(<LazyColorPicker onChange={(): void => {}} value="" />);

    await act(async () => {
      held.shift()!.reject(new Error("Loading chunk 12 failed."));
      await new Promise((resolve: (value: unknown) => void) => {
        setTimeout(resolve, 0);
      });
    });

    expect(screen.getByTestId("color-picker-placeholder")).toHaveAttribute(
      "data-load-state",
      "failed",
    );
  });
});
