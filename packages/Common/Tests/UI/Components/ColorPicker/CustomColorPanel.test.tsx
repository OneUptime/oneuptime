import CustomColorPanel from "../../../../UI/Components/ColorPicker/CustomColorPanel";
import {
  COLOR_CODE_INVALID_CHARACTERS_MESSAGE,
  COLOR_CODE_INVALID_LENGTH_MESSAGE,
} from "../../../../UI/Components/ColorPicker/ColorValue";
import getJestMockFunction, { MockFunction } from "../../../../Tests/MockType";
import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import React, { ReactElement, useState } from "react";
import { afterEach, describe, expect, test } from "@jest/globals";

/*
 * "Custom color": the exact-color picker behind a color field's swatches. A
 * saturation square and a hue strip to find a color by eye - by pointer or
 * by keyboard - and a box for its code, checked as it is typed and
 * explained in words when it is not a color.
 */

// Every box in jsdom is zero by zero; the square and the strip measure.
const SQUARE: { width: number; height: number } = { width: 200, height: 100 };
const STRIP: { width: number; height: number } = { width: 359, height: 12 };

const giveBox: (element: HTMLElement, width: number, height: number) => void = (
  element: HTMLElement,
  width: number,
  height: number,
): void => {
  element.getBoundingClientRect = (): DOMRect => {
    return {
      bottom: height,
      height,
      left: 0,
      right: width,
      top: 0,
      width,
      x: 0,
      y: 0,
      toJSON: (): Record<string, never> => {
        return {};
      },
    } as DOMRect;
  };
};

interface Harness {
  onChange: MockFunction;
  onDone: MockFunction;
  square: HTMLElement;
  strip: HTMLElement;
  codeBox: HTMLInputElement;
  setValue: (value: string) => void;
}

/*
 * The panel inside a field that holds its value, as ColorPicker does: what
 * the panel reports comes back to it as its value.
 */
const renderPanel: (options?: {
  value?: string;
  disabled?: boolean;
  autoFocusCodeInput?: boolean;
}) => Harness = (
  options: {
    value?: string;
    disabled?: boolean;
    autoFocusCodeInput?: boolean;
  } = {},
): Harness => {
  const onChange: MockFunction = getJestMockFunction();
  const onDone: MockFunction = getJestMockFunction();
  let setOuterValue: (value: string) => void = (): void => {};

  const Field: () => ReactElement = (): ReactElement => {
    const [value, setValue] = useState<string>(options.value ?? "#6366f1");
    setOuterValue = setValue;

    return (
      <CustomColorPanel
        id="label-color"
        value={value}
        onChange={(hex: string) => {
          onChange(hex);
          setValue(hex);
        }}
        onDone={onDone}
        disabled={options.disabled}
        autoFocusCodeInput={options.autoFocusCodeInput}
      />
    );
  };

  render(<Field />);

  const square: HTMLElement = screen.getByTestId("color-picker-saturation");
  const strip: HTMLElement = screen.getByTestId("color-picker-hue");

  giveBox(square, SQUARE.width, SQUARE.height);
  giveBox(strip, STRIP.width, STRIP.height);

  return {
    onChange,
    onDone,
    square,
    strip,
    codeBox: screen.getByTestId("color-picker-code") as HTMLInputElement,
    setValue: (value: string): void => {
      act(() => {
        setOuterValue(value);
      });
    },
  };
};

const lastReported: (onChange: MockFunction) => string = (
  onChange: MockFunction,
): string => {
  return onChange.mock.calls[onChange.mock.calls.length - 1]![0] as string;
};

const typeCode: (codeBox: HTMLInputElement, text: string) => void = (
  codeBox: HTMLInputElement,
  text: string,
): void => {
  fireEvent.change(codeBox, { target: { value: text } });
};

describe("CustomColorPanel", () => {
  afterEach(() => {
    cleanup();
  });

  describe("what it shows", () => {
    test("starts on the field's color: its code in the box, the square and the strip on it", () => {
      const { codeBox, square, strip } = renderPanel({ value: "#ff0000" });

      expect(codeBox).toHaveValue("#ff0000");
      expect(square).toHaveAttribute("role", "slider");
      expect(square).toHaveAttribute("aria-valuenow", "100");
      expect(square).toHaveAttribute(
        "aria-valuetext",
        "Saturation 100%, brightness 100%",
      );
      expect(strip).toHaveAttribute("role", "slider");
      expect(strip).toHaveAttribute("aria-valuenow", "0");
    });

    test("is a labelled group with labelled controls, and no format toggle", () => {
      renderPanel();

      expect(
        screen.getByRole("group", { name: "Custom color" }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole("slider", { name: "Saturation and brightness" }),
      ).toBeInTheDocument();
      expect(screen.getByRole("slider", { name: "Hue" })).toBeInTheDocument();
      expect(
        screen.getByRole("textbox", { name: "Color code" }),
      ).toBeInTheDocument();
      expect(screen.getByRole("button", { name: "Done" })).toBeInTheDocument();

      // One box, one notation: no HEX/RGB/HSL switch, no alpha slider.
      expect(screen.getAllByRole("textbox")).toHaveLength(1);
      expect(screen.getAllByRole("slider")).toHaveLength(2);
      expect(screen.queryByText(/^(HEX|RGB|HSL)$/)).toBeNull();
    });

    test("a field with no color starts on an example, with the box left empty", () => {
      const { codeBox, strip } = renderPanel({ value: "" });

      expect(codeBox).toHaveValue("");
      expect(codeBox).toHaveAttribute("placeholder", "#6366f1");
      // Indigo's hue, so the square is not a wall of red.
      expect(Number(strip.getAttribute("aria-valuenow"))).toBeGreaterThan(200);
    });

    test("puts the caret in the box when opened from the keyboard, the code selected to type over", () => {
      const { codeBox } = renderPanel({
        autoFocusCodeInput: true,
        value: "#3e409a",
      });

      expect(document.activeElement).toBe(codeBox);
      expect(codeBox.selectionStart).toBe(0);
      expect(codeBox.selectionEnd).toBe("#3e409a".length);
    });

    test("leaves focus where it was when opened by pointer", () => {
      const { codeBox } = renderPanel();

      expect(document.activeElement).not.toBe(codeBox);
    });
  });

  describe("by pointer", () => {
    test("a press on the square reports the color under it, at once", () => {
      const { onChange, square, codeBox } = renderPanel({ value: "#ff0000" });

      // Top right corner of a red square: red itself; the middle: dark pink.
      fireEvent.mouseDown(square, { button: 0, clientX: 100, clientY: 50 });

      expect(onChange).toHaveBeenCalledTimes(1);
      expect(lastReported(onChange)).toBe("#804040");
      expect(codeBox).toHaveValue("#804040");
    });

    test("a drag reports as it goes, leaves the square, and stops on release", () => {
      const { onChange, square } = renderPanel({ value: "#ff0000" });

      fireEvent.mouseDown(square, { button: 0, clientX: 0, clientY: 0 });
      fireEvent.mouseMove(window, { clientX: 200, clientY: 0 });

      expect(lastReported(onChange)).toBe("#ff0000");

      // Overshooting is the usual way to reach the corner: held to it.
      fireEvent.mouseMove(window, { clientX: 900, clientY: 900 });

      expect(lastReported(onChange)).toBe("#000000");

      fireEvent.mouseUp(window, { clientX: 900, clientY: 900 });

      const calls: number = onChange.mock.calls.length;

      fireEvent.mouseMove(window, { clientX: 0, clientY: 0 });

      expect(onChange).toHaveBeenCalledTimes(calls);
    });

    test("the right button does nothing", () => {
      const { onChange, square } = renderPanel();

      fireEvent.mouseDown(square, { button: 2, clientX: 50, clientY: 50 });

      expect(onChange).not.toHaveBeenCalled();
    });

    test("a touch on the square picks too", () => {
      const { onChange, square } = renderPanel({ value: "#ff0000" });

      fireEvent.touchStart(square, {
        touches: [{ clientX: 200, clientY: 100 }],
      });

      expect(lastReported(onChange)).toBe("#000000");

      fireEvent.touchMove(square, { touches: [{ clientX: 0, clientY: 0 }] });

      expect(lastReported(onChange)).toBe("#ffffff");
    });

    test("a press on the strip changes the hue and keeps the rest", () => {
      const { onChange, strip } = renderPanel({ value: "#ff0000" });

      // A third of the way round: green.
      fireEvent.mouseDown(strip, { button: 0, clientX: 120, clientY: 6 });

      expect(lastReported(onChange)).toBe("#00ff00");
      expect(strip).toHaveAttribute("aria-valuenow", "120");
    });

    test("a press puts focus on the control pressed, so the arrows carry on from there", () => {
      const { square } = renderPanel();

      fireEvent.mouseDown(square, { button: 0, clientX: 10, clientY: 10 });

      expect(document.activeElement).toBe(square);
    });

    test("a grey keeps its hue: the strip does not jump to red at the square's edge", () => {
      const { onChange, square, strip } = renderPanel({ value: "#0000ff" });

      // The left edge is grey; then back into the color.
      fireEvent.mouseDown(square, { button: 0, clientX: 0, clientY: 0 });
      fireEvent.mouseMove(window, { clientX: 200, clientY: 0 });
      fireEvent.mouseUp(window);

      expect(lastReported(onChange)).toBe("#0000ff");
      expect(strip).toHaveAttribute("aria-valuenow", "240");
    });
  });

  describe("by keyboard", () => {
    test("the arrows move the square: right and left saturation, up and down brightness", () => {
      const { onChange, square } = renderPanel({ value: "#808080" });

      square.focus();

      expect(fireEvent.keyDown(square, { key: "ArrowRight" })).toBe(false);
      expect(square).toHaveAttribute("aria-valuenow", "1");

      fireEvent.keyDown(square, { key: "ArrowUp", shiftKey: true });

      expect(square).toHaveAttribute(
        "aria-valuetext",
        "Saturation 1%, brightness 60%",
      );
      expect(lastReported(onChange)).toMatch(/^#[0-9a-f]{6}$/);

      fireEvent.keyDown(square, { key: "End" });
      expect(square).toHaveAttribute("aria-valuenow", "100");

      fireEvent.keyDown(square, { key: "Home" });
      expect(square).toHaveAttribute("aria-valuenow", "0");
    });

    test("the arrows move the strip round the wheel", () => {
      const { onChange, strip } = renderPanel({ value: "#ff0000" });

      fireEvent.keyDown(strip, { key: "ArrowRight", shiftKey: true });

      expect(strip).toHaveAttribute("aria-valuenow", "10");
      expect(lastReported(onChange)).toBe("#ff2a00");

      fireEvent.keyDown(strip, { key: "End" });
      expect(strip).toHaveAttribute("aria-valuenow", "359");
    });

    test("keys the sliders do not use go on to the page", () => {
      const { onChange, square, strip } = renderPanel();

      expect(fireEvent.keyDown(square, { key: "Tab" })).toBe(true);
      expect(fireEvent.keyDown(strip, { key: "a" })).toBe(true);
      expect(onChange).not.toHaveBeenCalled();
    });

    test("Escape puts the panel away, and claims the key so a dialog stays open", () => {
      const { onDone, square } = renderPanel();

      expect(fireEvent.keyDown(square, { key: "Escape" })).toBe(false);
      expect(onDone).toHaveBeenCalledTimes(1);
    });
  });

  describe("the color code box", () => {
    test("a whole six-digit code is taken as it is typed, and the square follows", () => {
      const { onChange, codeBox, strip } = renderPanel({ value: "#ff0000" });

      typeCode(codeBox, "#32A852");

      expect(onChange).toHaveBeenCalledWith("#32a852");
      // The box keeps what was typed until it is left.
      expect(codeBox).toHaveValue("#32A852");
      expect(strip).toHaveAttribute("aria-valuenow", "136");
    });

    test("a code without its # is taken too", () => {
      const { onChange, codeBox } = renderPanel();

      typeCode(codeBox, "32a852");

      expect(onChange).toHaveBeenCalledWith("#32a852");
    });

    test("shorthand waits for Enter, so typing #3e409a never flashes #33ee44", () => {
      const { onChange, codeBox } = renderPanel();

      typeCode(codeBox, "#3e4");

      expect(onChange).not.toHaveBeenCalled();

      fireEvent.keyDown(codeBox, { key: "Enter" });

      expect(onChange).toHaveBeenCalledWith("#33ee44");
      expect(codeBox).toHaveValue("#33ee44");
    });

    test("nothing is called wrong while it is still being typed", () => {
      const { codeBox } = renderPanel();

      typeCode(codeBox, "#3e40");
      typeCode(codeBox, "#3e40z");

      expect(screen.queryByRole("alert")).toBeNull();
      expect(codeBox).not.toHaveAttribute("aria-invalid");
    });

    test("on Enter, a code that is not a color is explained in words", () => {
      const { onChange, codeBox } = renderPanel({ value: "#ff0000" });

      typeCode(codeBox, "#3e40zz");

      expect(fireEvent.keyDown(codeBox, { key: "Enter" })).toBe(false);

      const message: HTMLElement = screen.getByRole("alert");

      expect(message).toHaveTextContent(COLOR_CODE_INVALID_CHARACTERS_MESSAGE);
      expect(codeBox).toHaveAttribute("aria-invalid", "true");
      expect(codeBox).toHaveAttribute("aria-describedby", message.id);
      // Nothing reported: the field keeps the color it had.
      expect(onChange).not.toHaveBeenCalled();
    });

    test("on leaving the box, a code of the wrong length says how long it should be", () => {
      const { codeBox } = renderPanel();

      typeCode(codeBox, "#3e40");
      fireEvent.blur(codeBox);

      expect(screen.getByRole("alert")).toHaveTextContent(
        COLOR_CODE_INVALID_LENGTH_MESSAGE,
      );
    });

    test("fixing the code clears the message", () => {
      const { onChange, codeBox } = renderPanel();

      typeCode(codeBox, "#3e40");
      fireEvent.keyDown(codeBox, { key: "Enter" });

      expect(screen.getByRole("alert")).toBeInTheDocument();

      typeCode(codeBox, "#3e409a");

      expect(screen.queryByRole("alert")).toBeNull();
      expect(codeBox).not.toHaveAttribute("aria-invalid");
      expect(onChange).toHaveBeenLastCalledWith("#3e409a");
    });

    test("an emptied box goes back to the field's color when it is left", () => {
      const { onChange, codeBox } = renderPanel({ value: "#3e409a" });

      typeCode(codeBox, "");
      fireEvent.blur(codeBox);

      expect(codeBox).toHaveValue("#3e409a");
      expect(screen.queryByRole("alert")).toBeNull();
      expect(onChange).not.toHaveBeenCalled();
    });

    test("Done with a code that is not a color stays open and says why", () => {
      const { onDone, codeBox } = renderPanel();

      typeCode(codeBox, "blue");
      fireEvent.click(screen.getByRole("button", { name: "Done" }));

      expect(onDone).not.toHaveBeenCalled();
      expect(screen.getByRole("alert")).toHaveTextContent(
        COLOR_CODE_INVALID_CHARACTERS_MESSAGE,
      );
    });

    test("Done takes a shorthand code and puts the panel away", () => {
      const { onChange, onDone, codeBox } = renderPanel();

      typeCode(codeBox, "f00");
      fireEvent.click(screen.getByRole("button", { name: "Done" }));

      expect(onChange).toHaveBeenCalledWith("#ff0000");
      expect(onDone).toHaveBeenCalledTimes(1);
    });

    test("a color set from outside moves the box, the square and the strip", () => {
      const { codeBox, strip, setValue } = renderPanel({ value: "#ff0000" });

      setValue("#00ff00");

      expect(codeBox).toHaveValue("#00ff00");
      expect(strip).toHaveAttribute("aria-valuenow", "120");
    });

    test("...but not the box while someone is typing in it", () => {
      const { codeBox, setValue } = renderPanel({ value: "#ff0000" });

      codeBox.focus();
      typeCode(codeBox, "#00f");
      setValue("#00ff00");

      expect(codeBox).toHaveValue("#00f");
    });
  });

  describe("disabled", () => {
    test("takes no press, no key and no Tab stop", () => {
      const { onChange, square, strip, codeBox } = renderPanel({
        disabled: true,
      });

      expect(square).toHaveAttribute("tabindex", "-1");
      expect(strip).toHaveAttribute("tabindex", "-1");
      expect(square).toHaveAttribute("aria-disabled", "true");
      expect(codeBox).toBeDisabled();

      fireEvent.mouseDown(square, { button: 0, clientX: 10, clientY: 10 });
      fireEvent.mouseDown(strip, { button: 0, clientX: 10, clientY: 5 });
      fireEvent.keyDown(square, { key: "ArrowRight" });
      fireEvent.keyDown(strip, { key: "ArrowRight" });
      fireEvent.touchStart(square, { touches: [{ clientX: 1, clientY: 1 }] });

      expect(onChange).not.toHaveBeenCalled();
    });
  });
});
