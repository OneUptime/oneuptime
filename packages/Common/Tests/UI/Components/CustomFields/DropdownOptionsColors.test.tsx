import DropdownOptionsInput from "../../../../UI/Components/CustomFields/DropdownOptionsInput";
import { COLOR_PICKER_SWATCHES } from "../../../../UI/Components/ColorPicker/ColorPalette";
import getJestMockFunction, { MockFunction } from "../../../../Tests/MockType";
import {
  getCheckedSwatch,
  getColorField,
  getSwatch,
  getTrigger,
  openPopover,
  typeColorCode,
} from "../ColorPicker/ColorPickerDriver";
import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React from "react";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * A custom field's options (and a form question's), each with an optional
 * color, through the real color field: one small button per option showing
 * its color and its name, the swatches in a popover. What is stored is
 * unchanged - newline text until a color is set, then JSON with hex codes.
 *
 * DropdownOptionsInput.test.tsx pins the serialization with the picker
 * mocked; this drives the picker itself.
 */

const hexOf: (name: string) => string = (name: string): string => {
  return COLOR_PICKER_SWATCHES.find((swatch: { name: string }): boolean => {
    return swatch.name === name;
  })!.hex;
};

const optionColor: (index: number) => HTMLElement = (
  index: number,
): HTMLElement => {
  return getColorField(`dropdown-option-color-${index}`);
};

describe("a custom field's option colors", () => {
  afterEach(() => {
    cleanup();
  });

  test("each option has a small color button, named for its option, showing its color", () => {
    render(
      <DropdownOptionsInput
        initialValue={'[{"value":"Low","color":"#16a34a"},{"value":"High"}]'}
      />,
    );

    const low: HTMLElement = getTrigger(optionColor(0));
    const high: HTMLElement = getTrigger(optionColor(1));

    expect(optionColor(0)).toHaveAttribute("data-layout", "compact");
    expect(low).toHaveAccessibleName("Color for Low Green");
    expect(low).toHaveTextContent("Green");
    expect(high).toHaveAccessibleName("Color for High No color");
    expect(high).toHaveTextContent("No color");
  });

  test("picking a swatch colors the option and stores it", async () => {
    const onChange: MockFunction = getJestMockFunction();

    render(
      <DropdownOptionsInput initialValue={"Low\nHigh"} onChange={onChange} />,
    );

    const popup: HTMLElement = openPopover(optionColor(1));

    act(() => {
      fireEvent.click(getSwatch(popup, "Red"));
    });

    await waitFor(() => {
      expect(onChange).toHaveBeenLastCalledWith(
        `[{"value":"Low"},{"value":"High","color":"${hexOf("Red")}"}]`,
      );
    });

    expect(screen.queryByTestId("color-picker-popup")).toBeNull();
    expect(getTrigger(optionColor(1))).toHaveTextContent("Red");
  });

  test("a brand color typed as a code is stored as the code", async () => {
    const onChange: MockFunction = getJestMockFunction();

    render(
      <DropdownOptionsInput initialValue={"Low\nHigh"} onChange={onChange} />,
    );

    const popup: HTMLElement = openPopover(optionColor(0));

    act(() => {
      fireEvent.click(within(popup).getByTestId("color-picker-custom"), {
        detail: 1,
      });
    });

    typeColorCode(popup, "#3E409A");

    await waitFor(() => {
      expect(onChange).toHaveBeenLastCalledWith(
        '[{"value":"Low","color":"#3e409a"},{"value":"High"}]',
      );
    });
  });

  test("No color takes the color off, and the last one off goes back to plain lines", async () => {
    const onChange: MockFunction = getJestMockFunction();

    render(
      <DropdownOptionsInput
        initialValue={'[{"value":"Low"},{"value":"High","color":"#ef4444"}]'}
        onChange={onChange}
      />,
    );

    const popup: HTMLElement = openPopover(optionColor(1));

    expect(getCheckedSwatch(popup)).toHaveAccessibleName("Red");

    act(() => {
      fireEvent.click(getSwatch(popup, "No color"));
    });

    await waitFor(() => {
      expect(onChange).toHaveBeenLastCalledWith("Low\nHigh");
    });
  });

  test("the option's popover opens on its own color, ticked", () => {
    render(
      <DropdownOptionsInput
        initialValue={'[{"value":"Low","color":"#0d9488"},{"value":"High"}]'}
      />,
    );

    const popup: HTMLElement = openPopover(optionColor(0));

    expect(getCheckedSwatch(popup)).toHaveAccessibleName("Teal");
  });

  test("an option colored before the palette existed keeps its color, as a custom one", () => {
    render(
      <DropdownOptionsInput
        initialValue={'[{"value":"Low","color":"#22c55e"}]'}
      />,
    );

    expect(getTrigger(optionColor(0))).toHaveTextContent("#22c55e");

    const popup: HTMLElement = openPopover(optionColor(0));

    expect(getCheckedSwatch(popup)).toBeNull();
    expect(
      within(popup).getByTestId("color-picker-custom-panel"),
    ).toBeInTheDocument();
  });
});
