import ColorPicker, {
  ComponentProps as ColorPickerProps,
} from "../../../../UI/Components/Forms/Fields/ColorPicker";
import { COLOR_PICKER_SWATCHES } from "../../../../UI/Components/ColorPicker/ColorPalette";
import Color from "../../../../Types/Color";
import getJestMockFunction, { MockFunction } from "../../../../Tests/MockType";
import {
  colorOf,
  getCheckedSwatch,
  getCodeBox,
  getColorField,
  getCustomButton,
  getSwatch,
  getTrigger,
  openCustomPanel,
  openPopover,
  pickSwatch,
  typeColorCode,
} from "../ColorPicker/ColorPickerDriver";
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
 * The color field everywhere a color is chosen. Inline (in forms) the
 * swatches are the field; compact (a custom field's options, a workflow
 * value) a button opens them in a popover. Either way the picked color is
 * ticked, "Custom color" holds an exact one, and what is stored is a hex.
 */

const hexOf: (name: string) => string = (name: string): string => {
  return COLOR_PICKER_SWATCHES.find((swatch: { name: string }): boolean => {
    return swatch.name === name;
  })!.hex;
};

const lastColor: (onChange: MockFunction) => Color | null = (
  onChange: MockFunction,
): Color | null => {
  return onChange.mock.calls[
    onChange.mock.calls.length - 1
  ]![0] as Color | null;
};

interface Harness {
  onChange: MockFunction;
  field: HTMLElement;
}

/*
 * A field whose value lives in its parent - a form, an options row - the
 * way every caller uses it.
 */
const renderControlled: (
  props?: Partial<ColorPickerProps> & { start?: string },
) => Harness = (
  props: Partial<ColorPickerProps> & { start?: string } = {},
): Harness => {
  const onChange: MockFunction = getJestMockFunction();

  const Parent: () => ReactElement = (): ReactElement => {
    const [value, setValue] = useState<string>(props.start ?? "");

    return (
      <div>
        <span id="field-label">Label Color</span>
        <ColorPicker
          ariaLabelledby="field-label"
          {...props}
          value={value}
          onChange={(color: Color | null) => {
            onChange(color);
            setValue(color ? color.toString() : "");
          }}
        />
        <button type="button">Elsewhere</button>
      </div>
    );
  };

  render(<Parent />);

  return { onChange, field: getColorField(props.dataTestId) };
};

describe("ColorPicker, inline (a form's color field)", () => {
  afterEach(() => {
    cleanup();
  });

  test("leads with the palette's swatches, named, and ticks the color it holds", () => {
    const { field } = renderControlled({
      isClearable: false,
      start: hexOf("Teal"),
    });

    expect(within(field).getAllByRole("radio")).toHaveLength(
      COLOR_PICKER_SWATCHES.length,
    );
    expect(getCheckedSwatch(field)).toHaveAccessibleName("Teal");
    expect(colorOf(field)).toBe(hexOf("Teal"));
    expect(field).toHaveAttribute("data-layout", "inline");
    expect(within(field).getByRole("radiogroup")).toHaveAccessibleName(
      "Label Color",
    );
  });

  test("a click on a swatch picks it: a Color, in lowercase hex, and the tick moves", () => {
    const { field, onChange } = renderControlled({ start: hexOf("Teal") });

    pickSwatch(field, "Orange");

    const picked: Color | null = lastColor(onChange);

    expect(picked).toBeInstanceOf(Color);
    expect(picked!.toString()).toBe(hexOf("Orange"));
    expect(getCheckedSwatch(field)).toHaveAccessibleName("Orange");
    expect(colorOf(field)).toBe(hexOf("Orange"));
  });

  test("the arrow keys pick as they move, as a radio group does", () => {
    const { field, onChange } = renderControlled({ start: hexOf("Red") });

    const red: HTMLElement = getSwatch(field, "Red");

    red.focus();
    fireEvent.keyDown(red, { key: "ArrowRight" });

    expect(lastColor(onChange)!.toString()).toBe(hexOf("Orange"));
    expect(document.activeElement).toBe(getSwatch(field, "Orange"));
  });

  test("a stored color written another way still ticks its swatch, and is not rewritten", () => {
    const { field, onChange } = renderControlled({
      start: hexOf("Green").toUpperCase(),
    });

    expect(getCheckedSwatch(field)).toHaveAccessibleName("Green");
    expect(onChange).not.toHaveBeenCalled();
  });

  test("an optional field starts with No color, first and ticked, and can go back to it", () => {
    const { field, onChange } = renderControlled({ isClearable: true });

    const radios: Array<HTMLElement> = within(field).getAllByRole("radio");

    expect(radios[0]).toHaveAccessibleName("No color");
    expect(getCheckedSwatch(field)).toBe(radios[0]);
    expect(colorOf(field)).toBe("");

    pickSwatch(field, "Blue");
    expect(colorOf(field)).toBe(hexOf("Blue"));

    pickSwatch(field, "No color");
    expect(lastColor(onChange)).toBeNull();
    expect(colorOf(field)).toBe("");
  });

  test("a chart's Auto is the same choice under its own words", () => {
    const { field } = renderControlled({
      clearLabel: "Auto",
      clearTitle: "Auto — use the theme palette",
    });

    const auto: HTMLElement = getSwatch(field, "Auto");

    expect(auto).toHaveAttribute("title", "Auto — use the theme palette");
    expect(auto).toHaveAttribute("aria-checked", "true");
  });

  test("a required field has one color picked always: no No color", () => {
    const { field } = renderControlled({
      isClearable: false,
      start: hexOf("Indigo"),
    });

    expect(within(field).queryByRole("radio", { name: "No color" })).toBeNull();
    expect(within(field).getByRole("radiogroup")).toHaveAttribute(
      "aria-required",
      "true",
    );
  });

  test("a caller's own palette replaces the shared one", () => {
    const { field } = renderControlled({
      swatches: [
        { name: "Brand", hex: "#123456" },
        { name: "Accent", hex: "#abcdef" },
      ],
      start: "#123456",
    });

    expect(within(field).getAllByRole("radio")).toHaveLength(3);
    expect(getCheckedSwatch(field)).toHaveAccessibleName("Brand");
  });

  describe("Custom color", () => {
    test("is a button after the swatches that opens the fine picker under them", () => {
      const { field } = renderControlled({ start: hexOf("Teal") });
      const custom: HTMLElement = getCustomButton(field);

      expect(custom).toHaveAccessibleName("Custom color");
      expect(custom).toHaveTextContent("Custom color");
      expect(custom).toHaveAttribute("aria-expanded", "false");
      expect(custom).not.toHaveAttribute("aria-controls");
      expect(custom).toHaveAttribute("data-picked", "false");

      const panel: HTMLElement = openCustomPanel(field);

      expect(custom).toHaveAttribute("aria-expanded", "true");
      expect(custom.getAttribute("aria-controls")).toBe(panel.id);
      // Inside the field - not floating over the dialog around it.
      expect(field.contains(panel)).toBe(true);
      expect(getCodeBox(panel)).toHaveValue(hexOf("Teal"));
    });

    test("a typed code becomes the field's color, and Custom color shows it", () => {
      const { field, onChange } = renderControlled({ start: hexOf("Teal") });

      typeColorCode(field, "#3E409A");

      expect(lastColor(onChange)!.toString()).toBe("#3e409a");
      expect(colorOf(field)).toBe("#3e409a");
      expect(getCheckedSwatch(field)).toBeNull();

      const custom: HTMLElement = getCustomButton(field);

      expect(custom).toHaveAttribute("data-picked", "true");
      expect(custom).toHaveAccessibleName("Custom color, #3e409a");
      expect(custom).toHaveAttribute("title", "Custom color, #3e409a");
      // Its words stay the same; the dot inside it is the color, ticked.
      expect(custom).toHaveTextContent("Custom color");

      const dot: HTMLElement = within(custom).getByTestId(
        "color-picker-custom-dot",
      );

      expect(dot.style.backgroundColor).toBe("rgb(62, 64, 154)");
      expect(dot.querySelector("svg")).not.toBeNull();
      expect(dot.querySelector("svg")!.style.color).toBe("rgb(255, 255, 255)");
    });

    test("a pale custom color takes a dark tick, so the tick still shows", () => {
      const { field } = renderControlled({ start: "#fef08a" });
      const dot: HTMLElement = within(getCustomButton(field)).getByTestId(
        "color-picker-custom-dot",
      );

      expect(dot.querySelector("svg")!.style.color).toBe("rgb(17, 24, 39)");
    });

    test("with no custom color the button shows the color wheel, and no tick", () => {
      const { field } = renderControlled({ start: hexOf("Teal") });
      const dot: HTMLElement = within(getCustomButton(field)).getByTestId(
        "color-picker-custom-dot",
      );

      // Not painted with a color of its own: the wheel is its background.
      expect(dot.style.backgroundColor).toBe("");
      expect(dot.querySelector("svg")).toBeNull();
    });

    test("a color that is not a swatch arrives as a custom one", () => {
      const { field } = renderControlled({ start: "#3e409a" });

      expect(getCheckedSwatch(field)).toBeNull();
      expect(getCustomButton(field)).toHaveAttribute("data-picked", "true");
    });

    test("a code that is not a color is explained and changes nothing", () => {
      const { field, onChange } = renderControlled({ start: hexOf("Teal") });

      typeColorCode(field, "#12345g");

      expect(within(field).getByRole("alert")).toHaveTextContent(
        "Color codes use only the numbers 0-9 and the letters a-f, like #6366f1.",
      );
      expect(onChange).not.toHaveBeenCalled();
      expect(colorOf(field)).toBe(hexOf("Teal"));
    });

    test("picking a swatch with the panel open keeps it open, on the swatch's code", () => {
      const { field } = renderControlled({ start: "#3e409a" });
      const panel: HTMLElement = openCustomPanel(field);

      pickSwatch(field, "Purple");

      expect(within(field).getByTestId("color-picker-custom-panel")).toBe(
        panel,
      );
      expect(getCodeBox(panel)).toHaveValue(hexOf("Purple"));
      expect(getCustomButton(field)).toHaveAttribute("data-picked", "false");
    });

    test("Done puts it away and gives focus back to Custom color", () => {
      const { field } = renderControlled({ start: hexOf("Teal") });
      const panel: HTMLElement = openCustomPanel(field);

      act(() => {
        fireEvent.click(within(panel).getByRole("button", { name: "Done" }));
      });

      expect(
        within(field).queryByTestId("color-picker-custom-panel"),
      ).toBeNull();
      expect(document.activeElement).toBe(getCustomButton(field));
    });

    test("Escape puts it away too, and claims the key", () => {
      const { field } = renderControlled({ start: hexOf("Teal") });
      const panel: HTMLElement = openCustomPanel(field);
      let notClaimed: boolean = true;

      act(() => {
        notClaimed = fireEvent.keyDown(getCodeBox(panel), { key: "Escape" });
      });

      expect(notClaimed).toBe(false);
      expect(
        within(field).queryByTestId("color-picker-custom-panel"),
      ).toBeNull();
    });

    test("a second click on Custom color closes it", () => {
      const { field } = renderControlled({ start: hexOf("Teal") });

      openCustomPanel(field);

      act(() => {
        fireEvent.click(getCustomButton(field), { detail: 1 });
      });

      expect(
        within(field).queryByTestId("color-picker-custom-panel"),
      ).toBeNull();
    });

    test("opened from the keyboard, the caret goes to the code box; by pointer it stays put", () => {
      const { field } = renderControlled({ start: hexOf("Teal") });

      // Enter or Space on a button is a click with no pointer (detail 0).
      act(() => {
        fireEvent.click(getCustomButton(field), { detail: 0 });
      });

      expect(document.activeElement).toBe(
        within(field).getByTestId("color-picker-code"),
      );

      act(() => {
        fireEvent.click(getCustomButton(field), { detail: 1 });
      });
      act(() => {
        fireEvent.click(getCustomButton(field), { detail: 1 });
      });

      expect(document.activeElement).not.toBe(
        within(field).getByTestId("color-picker-code"),
      );
    });
  });

  test("an error is tied to the swatches for a screen reader", () => {
    const { field } = renderControlled({ error: "Label Color is required." });
    const group: HTMLElement = within(field).getByRole("radiogroup");
    const message: HTMLElement = within(field).getByRole("alert");

    expect(message).toHaveTextContent("Label Color is required.");
    expect(group).toHaveAttribute("aria-invalid", "true");
    expect(group.getAttribute("aria-describedby")).toBe(message.id);
  });

  test("a field with no error claims none", () => {
    const { field } = renderControlled();
    const group: HTMLElement = within(field).getByRole("radiogroup");

    expect(group).not.toHaveAttribute("aria-invalid");
    expect(group).not.toHaveAttribute("aria-describedby");
  });

  test.each([
    ["disabled", { disabled: true }],
    ["read-only", { readOnly: true }],
  ])(
    "a %s field changes nothing",
    (_name: string, flags: Partial<ColorPickerProps>) => {
      const { field, onChange } = renderControlled({
        ...flags,
        start: hexOf("Teal"),
      });

      for (const radio of within(field).getAllByRole("radio")) {
        expect(radio).toBeDisabled();
      }

      expect(getCustomButton(field)).toBeDisabled();

      fireEvent.click(getSwatch(field, "Red"));
      fireEvent.click(getCustomButton(field));

      expect(onChange).not.toHaveBeenCalled();
      expect(
        within(field).queryByTestId("color-picker-custom-panel"),
      ).toBeNull();
    },
  );

  test("tells its caller when focus arrives and leaves, not as it moves inside", () => {
    const onFocus: MockFunction = getJestMockFunction();
    const onBlur: MockFunction = getJestMockFunction();
    const { field } = renderControlled({
      start: hexOf("Teal"),
      onFocus,
      onBlur,
    });
    const teal: HTMLElement = getSwatch(field, "Teal");

    act(() => {
      teal.focus();
    });
    expect(onFocus).toHaveBeenCalledTimes(1);

    act(() => {
      getCustomButton(field).focus();
    });
    expect(onFocus).toHaveBeenCalledTimes(1);
    expect(onBlur).not.toHaveBeenCalled();

    act(() => {
      screen.getByRole("button", { name: "Elsewhere" }).focus();
    });
    expect(onBlur).toHaveBeenCalledTimes(1);
  });
});

describe("ColorPicker, uncontrolled", () => {
  afterEach(() => {
    cleanup();
  });

  test("keeps its own color, starting from initialValue", () => {
    const onChange: MockFunction = getJestMockFunction();

    render(
      <ColorPicker
        initialValue={new Color("#EF4444")}
        onChange={onChange}
        dataTestId="own"
      />,
    );

    const field: HTMLElement = getColorField("own");

    expect(colorOf(field)).toBe("#ef4444");
    expect(getCheckedSwatch(field)).toHaveAccessibleName("Red");

    pickSwatch(field, "No color");

    expect(lastColor(onChange)).toBeNull();
    expect(colorOf(field)).toBe("");
  });

  test("adopts an initial color that arrives late, until someone picks", () => {
    const onChange: MockFunction = getJestMockFunction();
    const { rerender } = render(
      <ColorPicker onChange={onChange} dataTestId="own" />,
    );

    expect(colorOf(getColorField("own"))).toBe("");

    rerender(
      <ColorPicker
        onChange={onChange}
        dataTestId="own"
        initialValue={new Color("#16a34a")}
      />,
    );

    expect(colorOf(getColorField("own"))).toBe("#16a34a");

    pickSwatch(getColorField("own"), "Red");
    rerender(
      <ColorPicker
        onChange={onChange}
        dataTestId="own"
        initialValue={new Color("#0284c7")}
      />,
    );

    expect(colorOf(getColorField("own"))).toBe(hexOf("Red"));
  });
});

describe("ColorPicker, compact (one control in a row)", () => {
  afterEach(() => {
    cleanup();
  });

  test("a button shows the color and its name, and says both to a screen reader", () => {
    const { field } = renderControlled({
      layout: "compact",
      start: hexOf("Red"),
    });
    const trigger: HTMLElement = getTrigger(field);

    expect(field).toHaveAttribute("data-layout", "compact");
    expect(trigger).toHaveTextContent("Red");
    expect(trigger).toHaveAccessibleName("Label Color Red");
    expect(trigger).toHaveAttribute("aria-haspopup", "dialog");
    expect(trigger).toHaveAttribute("aria-expanded", "false");
    expect(
      within(trigger).getByTestId("color-picker-trigger-swatch").style
        .backgroundColor,
    ).toBe("rgb(239, 68, 68)");
    // Nothing drawn until it is opened.
    expect(within(field).queryAllByRole("radio")).toHaveLength(0);
  });

  test("a custom color shows its code; no color shows the placeholder", () => {
    const custom: Harness = renderControlled({
      layout: "compact",
      start: "#3e409a",
      dataTestId: "custom",
    });

    expect(getTrigger(custom.field)).toHaveTextContent("#3e409a");

    cleanup();

    const none: Harness = renderControlled({
      layout: "compact",
      placeholder: "No color",
      dataTestId: "none",
    });

    expect(getTrigger(none.field)).toHaveTextContent("No color");
  });

  test("a click opens the swatches in a popover; a pick closes it and returns focus", () => {
    const { field, onChange } = renderControlled({
      layout: "compact",
      start: hexOf("Red"),
    });
    const trigger: HTMLElement = getTrigger(field);
    const popup: HTMLElement = openPopover(field);

    expect(popup).toHaveAttribute("role", "dialog");
    expect(popup).toHaveAccessibleName("Color picker");
    expect(popup.parentElement).toBe(document.body);
    expect(trigger).toHaveAttribute("aria-expanded", "true");
    expect(trigger.getAttribute("aria-controls")).toBe(popup.id);
    expect(getCheckedSwatch(popup)).toHaveAccessibleName("Red");

    act(() => {
      fireEvent.click(getSwatch(popup, "Teal"));
    });

    expect(lastColor(onChange)!.toString()).toBe(hexOf("Teal"));
    expect(screen.queryByTestId("color-picker-popup")).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(trigger).toHaveTextContent("Teal");
  });

  test("the arrows pick without closing, so the reader can keep going", () => {
    const { field, onChange } = renderControlled({
      layout: "compact",
      start: hexOf("Red"),
    });
    const popup: HTMLElement = openPopover(field);
    const red: HTMLElement = getSwatch(popup, "Red");

    act(() => {
      fireEvent.keyDown(red, { key: "ArrowRight" });
    });

    expect(lastColor(onChange)!.toString()).toBe(hexOf("Orange"));
    expect(screen.getByTestId("color-picker-popup")).toBeInTheDocument();
  });

  test.each(["Enter", " ", "ArrowDown", "ArrowUp"])(
    "%p on the button opens it with focus on the picked color",
    (key: string) => {
      const { field } = renderControlled({
        layout: "compact",
        start: hexOf("Lime"),
      });
      const trigger: HTMLElement = getTrigger(field);

      trigger.focus();

      let notClaimed: boolean = true;

      act(() => {
        notClaimed = fireEvent.keyDown(trigger, { key });
      });

      expect(notClaimed).toBe(false);

      const popup: HTMLElement = screen.getByTestId("color-picker-popup");

      expect(document.activeElement).toBe(getSwatch(popup, "Lime"));
    },
  );

  test("Escape closes it, keeps the color and returns focus to the button", () => {
    const { field, onChange } = renderControlled({
      layout: "compact",
      start: hexOf("Lime"),
    });
    const popup: HTMLElement = openPopover(field);

    act(() => {
      fireEvent.keyDown(getSwatch(popup, "Lime"), { key: "Escape" });
    });

    expect(screen.queryByTestId("color-picker-popup")).toBeNull();
    expect(document.activeElement).toBe(getTrigger(field));
    expect(onChange).not.toHaveBeenCalled();
  });

  test("a press anywhere else closes it", () => {
    const { field } = renderControlled({ layout: "compact" });

    openPopover(field);

    act(() => {
      fireEvent.mouseDown(screen.getByRole("button", { name: "Elsewhere" }));
    });

    expect(screen.queryByTestId("color-picker-popup")).toBeNull();
  });

  test("No color, in an optional row, clears it", () => {
    const { field, onChange } = renderControlled({
      layout: "compact",
      start: hexOf("Lime"),
    });
    const popup: HTMLElement = openPopover(field);

    act(() => {
      fireEvent.click(getSwatch(popup, "No color"));
    });

    expect(lastColor(onChange)).toBeNull();
    expect(getTrigger(field)).toHaveTextContent("No color");
  });

  test("Custom color opens inside the popover; a typed code sets it and Done closes it", () => {
    const { field, onChange } = renderControlled({
      layout: "compact",
      start: hexOf("Lime"),
    });
    const popup: HTMLElement = openPopover(field);
    const custom: HTMLElement = within(popup).getByTestId(
      "color-picker-custom",
    );

    expect(custom).toHaveAttribute("aria-expanded", "false");

    act(() => {
      fireEvent.click(custom, { detail: 1 });
    });

    const panel: HTMLElement = within(popup).getByTestId(
      "color-picker-custom-panel",
    );

    expect(custom).toHaveAttribute("aria-expanded", "true");

    typeColorCode(panel, "#3e409a");

    expect(lastColor(onChange)!.toString()).toBe("#3e409a");
    expect(screen.getByTestId("color-picker-popup")).toBeInTheDocument();

    act(() => {
      fireEvent.click(within(panel).getByRole("button", { name: "Done" }));
    });

    expect(screen.queryByTestId("color-picker-popup")).toBeNull();
    expect(getTrigger(field)).toHaveTextContent("#3e409a");
    expect(document.activeElement).toBe(getTrigger(field));
  });

  test("a custom color opens the popover on the custom picker, showing its code", () => {
    const { field } = renderControlled({
      layout: "compact",
      start: "#3e409a",
    });
    const popup: HTMLElement = openPopover(field);
    const panel: HTMLElement = within(popup).getByTestId(
      "color-picker-custom-panel",
    );

    expect(getCodeBox(panel)).toHaveValue("#3e409a");
    expect(getCheckedSwatch(popup)).toBeNull();
  });

  test("a palette color opens it on the swatches alone", () => {
    const { field } = renderControlled({
      layout: "compact",
      start: hexOf("Teal"),
    });
    const popup: HTMLElement = openPopover(field);

    expect(within(popup).queryByTestId("color-picker-custom-panel")).toBeNull();
  });

  test("Tab stays inside the open popover", () => {
    const { field } = renderControlled({
      layout: "compact",
      start: hexOf("Teal"),
    });
    const popup: HTMLElement = openPopover(field);
    const custom: HTMLElement = within(popup).getByTestId(
      "color-picker-custom",
    );

    custom.focus();

    act(() => {
      fireEvent.keyDown(custom, { key: "Tab" });
    });

    expect(popup.contains(document.activeElement)).toBe(true);
  });

  test("a disabled row opens for neither pointer nor keyboard", () => {
    const { field } = renderControlled({
      layout: "compact",
      disabled: true,
      start: hexOf("Teal"),
    });
    const trigger: HTMLElement = getTrigger(field);

    expect(trigger).toBeDisabled();

    fireEvent.click(trigger);
    fireEvent.keyDown(trigger, { key: "Enter" });

    expect(screen.queryByTestId("color-picker-popup")).toBeNull();
  });

  test("an error is tied to the button", () => {
    const { field } = renderControlled({
      layout: "compact",
      error: "Pick a color for this option.",
    });
    const trigger: HTMLElement = getTrigger(field);
    const message: HTMLElement = within(field).getByRole("alert");

    expect(trigger).toHaveAttribute("aria-invalid", "true");
    expect(trigger.getAttribute("aria-describedby")).toBe(message.id);
  });

  test("with no label of its own it is still named", () => {
    render(
      <ColorPicker
        layout="compact"
        value="#ef4444"
        onChange={getJestMockFunction()}
      />,
    );

    expect(getTrigger(getColorField())).toHaveAccessibleName("Color Red");
  });
});
