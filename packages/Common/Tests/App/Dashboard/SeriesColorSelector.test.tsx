import SeriesColorSelector, {
  SERIES_COLOR_AUTO_TITLE,
  SERIES_COLOR_SWATCHES,
  Swatch,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/SeriesColorSelector";
import SeriesGroupColorSelector from "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/SeriesGroupColorSelector";
import getJestMockFunction, { MockFunction } from "../../../Tests/MockType";
import {
  colorOf,
  getCheckedSwatch,
  getCustomButton,
  getSwatch,
  typeColorCode,
} from "../../UI/Components/ColorPicker/ColorPickerDriver";
import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import React, { ReactElement, useState } from "react";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * A chart series' color - the metric, formula and trace chart editors - is
 * the product's color field with the chart's own palette, so a picked
 * swatch is drawn exactly as the theme would have drawn it, and "Auto" as
 * its empty choice: follow the theme. It used to be a row of its own
 * buttons, the browser's native color input and a hex text box beside them.
 */

const hexOf: (name: string) => string = (name: string): string => {
  return SERIES_COLOR_SWATCHES.find((swatch: Swatch): boolean => {
    return swatch.name === name;
  })!.hex;
};

const renderSelector: (props?: {
  start?: string;
  hideAuto?: boolean;
  compact?: boolean;
  label?: string;
}) => { onChange: MockFunction; field: HTMLElement } = (
  props: {
    start?: string;
    hideAuto?: boolean;
    compact?: boolean;
    label?: string;
  } = {},
): { onChange: MockFunction; field: HTMLElement } => {
  const onChange: MockFunction = getJestMockFunction();

  const Parent: () => ReactElement = (): ReactElement => {
    const [value, setValue] = useState<string | undefined>(props.start);

    return (
      <SeriesColorSelector
        value={value}
        label={props.label}
        hideAuto={props.hideAuto}
        compact={props.compact}
        onChange={(color: string | undefined) => {
          onChange(color);
          setValue(color);
        }}
      />
    );
  };

  render(<Parent />);

  return { onChange, field: screen.getByTestId("series-color-picker") };
};

describe("a chart series' color", () => {
  afterEach(() => {
    cleanup();
  });

  test("offers Auto first, then the chart's palette by name", () => {
    const { field } = renderSelector();
    const radios: Array<HTMLElement> = within(field).getAllByRole("radio");

    expect(radios[0]).toHaveAccessibleName("Auto");
    expect(radios[0]).toHaveAttribute("title", SERIES_COLOR_AUTO_TITLE);
    expect(
      radios.slice(1).map((radio: HTMLElement): string => {
        return radio.getAttribute("aria-label") || "";
      }),
    ).toEqual(
      SERIES_COLOR_SWATCHES.map((swatch: Swatch): string => {
        return swatch.name;
      }),
    );
  });

  test("with no color of its own it is on Auto", () => {
    const { field } = renderSelector();

    expect(getCheckedSwatch(field)).toHaveAccessibleName("Auto");
    expect(colorOf(field)).toBe("");
  });

  test("a swatch is written as its hex, and Auto clears it", () => {
    const { field, onChange } = renderSelector();

    act(() => {
      fireEvent.click(getSwatch(field, "Rose"));
    });

    expect(onChange).toHaveBeenLastCalledWith(hexOf("Rose"));
    expect(getCheckedSwatch(field)).toHaveAccessibleName("Rose");

    act(() => {
      fireEvent.click(getSwatch(field, "Auto"));
    });

    expect(onChange).toHaveBeenLastCalledWith(undefined);
    expect(getCheckedSwatch(field)).toHaveAccessibleName("Auto");
  });

  test("a brand color typed in Custom color is written as its code", () => {
    const { field, onChange } = renderSelector();

    typeColorCode(field, "#0EA5E9");

    expect(onChange).toHaveBeenLastCalledWith("#0ea5e9");
    expect(getCustomButton(field)).toHaveAttribute("data-picked", "true");
  });

  test("a saved shorthand color reads as its swatch", () => {
    const { field } = renderSelector({ start: "#F43F5E" });

    expect(getCheckedSwatch(field)).toHaveAccessibleName("Rose");
  });

  test("its label and description say what it is for", () => {
    renderSelector({ label: "Default series color" });

    expect(screen.getByText("Default series color")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Pick a color for this series, or leave on Auto to use the theme palette.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("radiogroup")).toHaveAccessibleName(
      "Default series color",
    );
  });

  test("a pinned group's row has no Auto - removing the pin is how it goes - and is named by its value", () => {
    const { field } = renderSelector({
      compact: true,
      hideAuto: true,
      label: "service.name=api",
      start: hexOf("Indigo"),
    });

    expect(within(field).queryByRole("radio", { name: "Auto" })).toBeNull();
    expect(screen.getByRole("radiogroup")).toHaveAccessibleName(
      "service.name=api",
    );
    expect(getCheckedSwatch(field)).toHaveAccessibleName("Indigo");
  });

  test("a group's pins each get the field, and a new pin starts on the palette", () => {
    const onChange: MockFunction = getJestMockFunction();

    render(
      <SeriesGroupColorSelector
        groupByKeys={["service.name"]}
        valueSuggestions={{ "service.name": ["api", "web"] }}
        loadingKeys={[]}
        value={{ "service.name=api": hexOf("Lime") }}
        onChange={onChange}
      />,
    );

    const pin: HTMLElement = screen.getByTestId("series-color-picker");

    expect(getCheckedSwatch(pin)).toHaveAccessibleName("Lime");

    act(() => {
      fireEvent.click(getSwatch(pin, "Amber"));
    });

    expect(onChange).toHaveBeenLastCalledWith({
      "service.name=api": hexOf("Amber"),
    });
  });
});
