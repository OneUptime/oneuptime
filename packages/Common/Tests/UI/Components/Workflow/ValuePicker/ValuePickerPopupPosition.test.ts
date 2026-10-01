/*
 * Where the list of values opens: under its field, as wide as the field
 * within reason, kept inside the window, and above the field when there is
 * no room below.
 */

import {
  VALUE_PICKER_MAX_HEIGHT_PX,
  VALUE_PICKER_MAX_WIDTH_PX,
  VALUE_PICKER_MIN_WIDTH_PX,
  ValuePickerPosition,
  getValuePickerPosition,
} from "../../../../../UI/Components/Workflow/ValuePicker/ValuePickerPopup";
import { describe, expect, test } from "@jest/globals";

type RectFunction = (
  left: number,
  top: number,
  width: number,
  height: number,
) => DOMRect;

const rect: RectFunction = (
  left: number,
  top: number,
  width: number,
  height: number,
): DOMRect => {
  return {
    left: left,
    top: top,
    width: width,
    height: height,
    right: left + width,
    bottom: top + height,
    x: left,
    y: top,
    toJSON: () => {
      return {};
    },
  } as DOMRect;
};

describe("getValuePickerPosition", () => {
  test("under the field, lined up with it", () => {
    const position: ValuePickerPosition = getValuePickerPosition(
      rect(100, 200, 400, 40),
      1280,
      900,
    );

    expect(position.top).toBe(244);
    expect(position.bottom).toBeUndefined();
    expect(position.left).toBe(100);
    expect(position.width).toBe(400);
    expect(position.maxHeight).toBe(VALUE_PICKER_MAX_HEIGHT_PX);
  });

  test("never narrower than a name fits in, nor wider than reads well", () => {
    expect(
      getValuePickerPosition(rect(100, 200, 120, 40), 1280, 900).width,
    ).toBe(VALUE_PICKER_MIN_WIDTH_PX);
    expect(
      getValuePickerPosition(rect(100, 200, 1100, 40), 1280, 900).width,
    ).toBe(VALUE_PICKER_MAX_WIDTH_PX);
  });

  test("kept inside the window on a narrow screen", () => {
    const position: ValuePickerPosition = getValuePickerPosition(
      rect(200, 200, 300, 40),
      375,
      700,
    );

    // Its usual width, moved left so its right edge is on screen.
    expect(position.width).toBe(VALUE_PICKER_MIN_WIDTH_PX);
    expect(position.left).toBe(375 - 8 - VALUE_PICKER_MIN_WIDTH_PX);
  });

  test("narrower than that, as wide as the window allows", () => {
    const position: ValuePickerPosition = getValuePickerPosition(
      rect(200, 200, 300, 40),
      320,
      700,
    );

    expect(position.width).toBe(320 - 16);
    expect(position.left).toBe(8);
  });

  test("above the field when there is no room below", () => {
    const position: ValuePickerPosition = getValuePickerPosition(
      rect(100, 800, 400, 40),
      1280,
      900,
    );

    expect(position.top).toBeUndefined();
    expect(position.bottom).toBe(900 - 800 + 4);
    expect(position.maxHeight).toBe(VALUE_PICKER_MAX_HEIGHT_PX);
  });

  test("under the field with the room there is, when above is no better", () => {
    const position: ValuePickerPosition = getValuePickerPosition(
      rect(100, 60, 400, 40),
      1280,
      260,
    );

    expect(position.top).toBe(104);
    expect(position.maxHeight).toBe(260 - 100 - 4 - 8);
  });
});
