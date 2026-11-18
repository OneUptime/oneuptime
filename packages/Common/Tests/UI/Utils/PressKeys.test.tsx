import "@testing-library/jest-dom";
import { afterEach, describe, expect, test } from "@jest/globals";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";
import { isPressKey, onPressKeys } from "../../../UI/Utils/PressKeys";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * Enter and Space press a control drawn with role="button" because a
 * `<button>` cannot hold its layout (an SVG diagram's band), as they press a
 * button (#9222).
 */

afterEach(() => {
  cleanup();
});

describe("isPressKey", () => {
  test.each([
    ["Enter", true],
    [" ", true],
    ["Spacebar", true],
    ["a", false],
    ["Escape", false],
    ["Tab", false],
  ])("%j presses: %s", (key: string, presses: boolean) => {
    expect(isPressKey(key)).toBe(presses);
  });
});

describe("onPressKeys", () => {
  function renderControl(press: () => void): HTMLElement {
    render(
      <svg>
        <path
          role="button"
          tabIndex={0}
          aria-label="Band"
          onKeyDown={onPressKeys<SVGPathElement>(press)}
        />
      </svg>,
    );

    return screen.getByRole("button", { name: "Band" });
  }

  test.each([["Enter"], [" "]])(
    "%j presses it once, and keeps the page from scrolling",
    (key: string) => {
      const press: MockFunction = getJestMockFunction();
      const control: HTMLElement = renderControl(press);

      const notCancelled: boolean = fireEvent.keyDown(control, { key });

      expect(press).toHaveBeenCalledTimes(1);
      expect(notCancelled).toBe(false);
    },
  );

  test("another key passes by, untouched", () => {
    const press: MockFunction = getJestMockFunction();
    const control: HTMLElement = renderControl(press);

    expect(fireEvent.keyDown(control, { key: "ArrowDown" })).toBe(true);
    expect(press).not.toHaveBeenCalled();
  });

  test("a key held down presses it once, not again with each repeat", () => {
    const press: MockFunction = getJestMockFunction();
    const control: HTMLElement = renderControl(press);

    fireEvent.keyDown(control, { key: "Enter" });
    fireEvent.keyDown(control, { key: "Enter", repeat: true });

    expect(press).toHaveBeenCalledTimes(1);
  });
});
