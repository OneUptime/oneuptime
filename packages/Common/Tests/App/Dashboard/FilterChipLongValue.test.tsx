import "@testing-library/jest-dom";
import { afterEach, describe, expect, test } from "@jest/globals";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React, { ReactElement } from "react";
import FilterChipDropdown from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceOwners/FilterChipDropdown";
import {
  FILTER_CHIP_BOX_CLASSES,
  FILTER_CHIP_CLEAR_PLACE_CLASSES,
  FILTER_CHIP_PLACE_CLASSES,
  FILTER_CHIP_TEXT_CLASSES,
  FILTER_CHIP_TRIGGER_CLASSES,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceOwners/FilterChipStyles";
import { FilterChipDropdownOption } from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceOwners/FilterChipDropdownTypes";
import IconProp from "../../../Types/Icon/IconProp";

/*
 * A facet chip with a long value picked (FilterChipDropdown).
 *
 * The alerts list has no Monitor column: Affected Resources names an
 * alert's monitor, and the Monitor chip is how a list of one monitor's
 * alerts is asked for. Monitors are named "oneuptime-test - High Node
 * Memory Utilization" and longer, and a chip said all of it on one line
 * that could not shrink: on a phone it ran past the card's edge and the
 * whole page scrolled sideways. In the chip's list the names were cut at
 * the list's edge - "oneuptime-test - Pod CPU Satu..." - with no way to
 * read the rest.
 *
 * Now a chip is never wider than the bar: its words end in "..." where the
 * bar ends, the whole of them under the pointer, and a name cut short in
 * the list shows in full under the pointer too. jsdom lays nothing out, so
 * the classes that do it are read here and the browser suite (ModelTables)
 * measures them.
 */

afterEach(() => {
  cleanup();
});

const MONITOR: string = "oneuptime-test - High Node Memory Utilization";
const OTHER_MONITOR: string = "oneuptime-test - Pod CPU Saturating Containers";

const MONITOR_OPTIONS: Array<FilterChipDropdownOption> = [
  { value: "monitor-1", label: MONITOR, icon: IconProp.AltGlobe },
  { value: "monitor-2", label: OTHER_MONITOR, icon: IconProp.AltGlobe },
];

function tokens(classNames: string): Array<string> {
  return classNames.split(" ").filter(Boolean);
}

function classesOf(element: Element): Array<string> {
  return Array.from(element.classList);
}

// Pretend the element is narrower than its words, as on a phone.
function makeCutShort(element: HTMLElement): void {
  Object.defineProperty(element, "scrollWidth", {
    value: 360,
    configurable: true,
  });
  Object.defineProperty(element, "clientWidth", {
    value: 220,
    configurable: true,
  });
}

function monitorChip(value: Array<string>): ReactElement {
  return (
    <FilterChipDropdown
      label="Monitor"
      emptyIcon={IconProp.AltGlobe}
      options={MONITOR_OPTIONS}
      isMultiSelect={true}
      value={value}
      onChange={(): void => {}}
    />
  );
}

function chipButton(): HTMLElement {
  return screen.getAllByRole("button")[0] as HTMLElement;
}

// The chip's words: its name and the value picked.
function chipWords(): HTMLElement {
  const words: HTMLElement | undefined = Array.from(
    chipButton().querySelectorAll("span"),
  ).find((span: HTMLSpanElement): boolean => {
    return span.className === FILTER_CHIP_TEXT_CLASSES;
  });

  expect(words).toBeDefined();

  return words as HTMLElement;
}

describe("a chip with a long value picked", () => {
  test("is never wider than the bar: its place, its pill and its button may all shrink", () => {
    render(monitorChip(["monitor-1"]));

    const pill: HTMLElement = screen.getByTestId("filter-chip");
    const place: HTMLElement = pill.parentElement as HTMLElement;

    expect(classesOf(place)).toEqual(tokens(FILTER_CHIP_PLACE_CLASSES));
    expect(classesOf(place)).toEqual(
      expect.arrayContaining(["min-w-0", "max-w-full"]),
    );
    expect(classesOf(pill)).toEqual(
      expect.arrayContaining(tokens(FILTER_CHIP_BOX_CLASSES)),
    );
    expect(classesOf(pill)).toContain("max-w-full");
    expect(classesOf(chipButton())).toEqual(
      tokens(FILTER_CHIP_TRIGGER_CLASSES),
    );
    expect(classesOf(chipButton())).toContain("min-w-0");
  });

  test("says its name and the value on one line that ends in '...' where the bar ends", () => {
    render(monitorChip(["monitor-1"]));

    const words: HTMLElement = chipWords();

    expect(words.textContent).toBe(`Monitor · ${MONITOR}`);
    expect(tokens(FILTER_CHIP_TEXT_CLASSES)).toEqual(["min-w-0", "truncate"]);
  });

  test("shows the whole of its words under the pointer when they are cut short", () => {
    render(monitorChip(["monitor-1"]));

    const words: HTMLElement = chipWords();

    makeCutShort(words);
    fireEvent.mouseEnter(words);

    expect(words).toHaveAttribute("title", `Monitor · ${MONITOR}`);
  });

  test("repeats nothing under the pointer when they fit", () => {
    render(monitorChip(["monitor-1"]));

    const words: HTMLElement = chipWords();

    fireEvent.mouseEnter(words);

    expect(words).not.toHaveAttribute("title");
  });

  test("its button is still named by the whole value, and its clear button keeps its place", () => {
    render(monitorChip(["monitor-1"]));

    expect(chipButton()).toHaveAccessibleName(`Monitor · ${MONITOR}`);
    expect(
      screen.getByRole("button", { name: "Clear Monitor filter" }),
    ).toBeInTheDocument();

    const place: HTMLElement = screen.getByTestId("filter-chip-clear-place");

    expect(classesOf(place)).toEqual(tokens(FILTER_CHIP_CLEAR_PLACE_CLASSES));
    // The words give way first: the clear button's place never does.
    expect(classesOf(place)).toContain("shrink-0");
  });

  test("a chip with nothing picked says its name the same way", () => {
    render(monitorChip([]));

    const words: HTMLElement = chipWords();

    expect(words).toHaveTextContent("Monitor");
    expect(screen.queryByTestId("filter-chip-clear-place")).toBeNull();
  });

  test("stands where an empty chip stands: its pill hangs from the top of its line", () => {
    /*
     * On the line's baseline, a chip whose words are cut short (truncate)
     * sat 1px below its empty neighbours and made the chips row 1px
     * taller the moment a value was picked. Both pills hang from the top.
     */
    expect(tokens(FILTER_CHIP_BOX_CLASSES)).toContain("align-top");

    render(
      <div>
        {monitorChip(["monitor-1"])}
        {monitorChip([])}
      </div>,
    );

    for (const pill of screen.getAllByTestId("filter-chip")) {
      expect(classesOf(pill)).toContain("align-top");
    }
  });
});

describe("a long name in the chip's list", () => {
  test("ends in '...' at the list's edge, the whole of it under the pointer", async () => {
    render(monitorChip([]));

    await userEvent.setup().click(chipButton());

    const option: HTMLElement = screen.getByRole("option", {
      name: OTHER_MONITOR,
    });
    const name: HTMLElement = Array.from(option.querySelectorAll("span")).find(
      (span: HTMLSpanElement): boolean => {
        return span.textContent === OTHER_MONITOR && span.children.length === 0;
      },
    ) as HTMLElement;

    expect(name).toBeDefined();
    expect(classesOf(name)).toContain("truncate");

    // Fits: no tooltip repeating it.
    fireEvent.mouseEnter(name);
    expect(name).not.toHaveAttribute("title");

    makeCutShort(name);
    fireEvent.mouseEnter(name);
    expect(name).toHaveAttribute("title", OTHER_MONITOR);
  });
});
