/*
 * A workflow's color value - Create One Label's Color, Create One Incident
 * State's - is the product's color field in its compact layout: a button
 * showing the color and its name, the swatches in a popover, Custom color
 * for an exact code. The cell stores the hex as its text, "" for none.
 */

import ColumnValueInput from "../../../../../UI/Components/Workflow/ColumnEditor/ColumnValueInput";
import {
  ColumnValueMode,
  ModelColumnControl,
} from "../../../../../UI/Components/Workflow/ColumnEditor/ColumnRow";
import { COLOR_PICKER_SWATCHES } from "../../../../../UI/Components/ColorPicker/ColorPalette";
import { withPicker } from "../ValuePicker/ValuePickerTestUtils";
import {
  getCheckedSwatch,
  getColorField,
  getSwatch,
  getTrigger,
  openPopover,
  typeColorCode,
} from "../../ColorPicker/ColorPickerDriver";
import getJestMockFunction, { MockFunction } from "../../../../MockType";
import React from "react";
import "@testing-library/jest-dom";
import { act, cleanup, fireEvent, render, within } from "@testing-library/react";
import { afterEach, describe, expect, test } from "@jest/globals";

const hexOf: (name: string) => string = (name: string): string => {
  return COLOR_PICKER_SWATCHES.find((swatch: { name: string }): boolean => {
    return swatch.name === name;
  })!.hex;
};

const renderCell: (text: string) => {
  onChange: MockFunction;
  field: HTMLElement;
} = (text: string): { onChange: MockFunction; field: HTMLElement } => {
  const onChange: MockFunction = getJestMockFunction();

  render(
    withPicker(
      <div>
        <span id="cell-label">Color</span>
        <ColumnValueInput
          control={ModelColumnControl.Color}
          valueMode={ColumnValueMode.Literal}
          text={text}
          values={[]}
          dataTestId="cell"
          ariaLabelledby="cell-label"
          onChange={onChange}
        />
      </div>,
    ),
  );

  return { onChange, field: getColorField("cell") };
};

const last: (onChange: MockFunction) => unknown = (
  onChange: MockFunction,
): unknown => {
  return onChange.mock.calls[onChange.mock.calls.length - 1]![0];
};

afterEach(() => {
  cleanup();
});

describe("a workflow's color value", () => {
  test("is the compact color field, named by its column and showing its color", () => {
    const { field } = renderCell(hexOf("Red"));

    expect(field).toHaveAttribute("data-layout", "compact");
    expect(getTrigger(field)).toHaveAccessibleName("Color Red");
    expect(getTrigger(field)).toHaveTextContent("Red");
  });

  test("with no color it says so", () => {
    const { field } = renderCell("");

    expect(getTrigger(field)).toHaveTextContent("No color");
  });

  test("a swatch is written as its hex", () => {
    const { field, onChange } = renderCell("");
    const popup: HTMLElement = openPopover(field);

    act(() => {
      fireEvent.click(getSwatch(popup, "Teal"));
    });

    expect(last(onChange)).toEqual({ text: hexOf("Teal") });
  });

  test("No color writes nothing", () => {
    const { field, onChange } = renderCell(hexOf("Teal"));
    const popup: HTMLElement = openPopover(field);

    expect(getCheckedSwatch(popup)).toHaveAccessibleName("Teal");

    act(() => {
      fireEvent.click(getSwatch(popup, "No color"));
    });

    expect(last(onChange)).toEqual({ text: "" });
  });

  test("a code typed in Custom color is written as typed, in lowercase", () => {
    const { field, onChange } = renderCell("");
    const popup: HTMLElement = openPopover(field);

    act(() => {
      fireEvent.click(within(popup).getByTestId("color-picker-custom"), {
        detail: 1,
      });
    });

    typeColorCode(popup, "#3E409A");

    expect(last(onChange)).toEqual({ text: "#3e409a" });
  });
});
