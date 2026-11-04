import "@testing-library/jest-dom";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React, { ReactElement, useState } from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";
import AskAiResizeHandle from "../../../../App/FeatureSet/Dashboard/src/Components/AIChat/AskAiResizeHandle";
import { ASK_AI_PANEL_RESIZE_KEY_STEP } from "../../../../App/FeatureSet/Dashboard/src/Components/AIChat/AskAiPanelLayout";

/*
 * Ask AI's edge, between the panel and the page (issue #5597): a window
 * splitter to drag to the width the work needs. The browser's own drag, across
 * the page and in both reading directions, is in packages/E2E/AskAi; what is
 * held here is what it tells the panel, and when: every move to follow, and
 * only the end to keep.
 */

const WIDTH: number = 440;
const MIN_WIDTH: number = 340;
const MAX_WIDTH: number = 800;

const onResize: MockFunction = getJestMockFunction();
const onResizeEnd: MockFunction = getJestMockFunction();
const onReset: MockFunction = getJestMockFunction();

/*
 * As the panel holds it: the width it was given, changed only by what the edge
 * says to keep.
 */
function Edge(): ReactElement {
  const [width, setWidth] = useState<number>(WIDTH);

  return (
    <AskAiResizeHandle
      width={width}
      minWidth={MIN_WIDTH}
      maxWidth={MAX_WIDTH}
      onResize={onResize}
      onResizeEnd={(next: number) => {
        onResizeEnd(next);
        setWidth(next);
      }}
      onReset={onReset}
    />
  );
}

function edge(): HTMLElement {
  return screen.getByRole("separator", { name: "Resize Ask AI" });
}

/*
 * jsdom has no PointerEvent, and React reads a pointer's fields off the native
 * event: a mouse event of the pointer's type, with the id it carries.
 */
function firePointer(
  type: string,
  clientX: number,
  options: { pointerId?: number; button?: number } = {},
): void {
  const event: MouseEvent = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: clientX,
    button: options.button ?? 0,
  });

  Object.defineProperty(event, "pointerId", {
    value: options.pointerId ?? 1,
  });

  fireEvent(edge(), event);
}

function lastCall(mock: MockFunction): unknown {
  const calls: Array<Array<unknown>> = mock.mock.calls as Array<Array<unknown>>;
  return calls[calls.length - 1]?.[0];
}

beforeEach(() => {
  onResize.mockReset();
  onResizeEnd.mockReset();
  onReset.mockReset();
});

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute("dir");
});

describe("what it is", () => {
  test("a vertical splitter that says the width, its ends and how to find it", () => {
    render(<Edge />);

    expect(edge()).toHaveAttribute("aria-orientation", "vertical");
    expect(edge()).toHaveAttribute("aria-valuenow", String(WIDTH));
    expect(edge()).toHaveAttribute("aria-valuemin", String(MIN_WIDTH));
    expect(edge()).toHaveAttribute("aria-valuemax", String(MAX_WIDTH));
    expect(edge()).toHaveAttribute("tabindex", "0");
    expect(edge()).toHaveAttribute("title", "Drag to resize");
  });

  test("it only lights up while it is being used", () => {
    render(<Edge />);

    expect(edge()).not.toHaveAttribute("data-dragging");

    firePointer("pointerdown", 900);
    expect(edge()).toHaveAttribute("data-dragging", "true");

    firePointer("pointerup", 900);
    expect(edge()).not.toHaveAttribute("data-dragging");
  });
});

describe("dragged", () => {
  test("every move tells the panel, and says the width it reached", () => {
    render(<Edge />);

    firePointer("pointerdown", 900);
    firePointer("pointermove", 880);
    firePointer("pointermove", 850);

    expect(onResize.mock.calls).toEqual([[460], [490]]);
    expect(edge()).toHaveAttribute("aria-valuenow", "490");
    // Nothing is kept until the button is let go.
    expect(onResizeEnd).not.toHaveBeenCalled();
  });

  test("the width is kept once, when the button is let go", () => {
    render(<Edge />);

    firePointer("pointerdown", 900);
    firePointer("pointermove", 800);
    firePointer("pointermove", 760);
    firePointer("pointerup", 760);

    expect(onResizeEnd.mock.calls).toEqual([[580]]);
    expect(edge()).toHaveAttribute("aria-valuenow", "580");
  });

  test("a move away from the panel narrows it", () => {
    render(<Edge />);

    firePointer("pointerdown", 900);
    firePointer("pointermove", 950);
    firePointer("pointerup", 950);

    expect(onResizeEnd.mock.calls).toEqual([[390]]);
  });

  test("right to left, where it sits at the left, a move to the right widens it", () => {
    render(<Edge />);
    edge().style.direction = "rtl";

    firePointer("pointerdown", 440);
    firePointer("pointermove", 500);
    firePointer("pointerup", 500);

    expect(onResizeEnd.mock.calls).toEqual([[500]]);
  });

  test("it stops at its ends, however far the pointer goes", () => {
    render(<Edge />);

    firePointer("pointerdown", 900);
    firePointer("pointermove", -5000);
    expect(lastCall(onResize)).toBe(MAX_WIDTH);

    firePointer("pointermove", 9000);
    expect(lastCall(onResize)).toBe(MIN_WIDTH);
  });

  test("a whole number of pixels, on a screen that reports fractions", () => {
    render(<Edge />);

    firePointer("pointerdown", 900.25);
    firePointer("pointermove", 880.5);

    expect(lastCall(onResize)).toBe(460);
  });

  test("a second drag starts from where the first ended", () => {
    render(<Edge />);

    firePointer("pointerdown", 900);
    firePointer("pointermove", 800);
    firePointer("pointerup", 800);
    onResize.mockReset();

    firePointer("pointerdown", 800);
    firePointer("pointermove", 790);

    expect(lastCall(onResize)).toBe(550);
  });

  test("a press that moved nothing keeps nothing: a window's clamp stays a clamp", () => {
    render(<Edge />);

    firePointer("pointerdown", 900);
    firePointer("pointerup", 900);

    expect(onResizeEnd).not.toHaveBeenCalled();
  });

  test("a drag that came back to where it started keeps nothing either", () => {
    render(<Edge />);

    firePointer("pointerdown", 900);
    firePointer("pointermove", 800);
    firePointer("pointermove", 900);
    firePointer("pointerup", 900);

    expect(onResizeEnd).not.toHaveBeenCalled();
    // And the panel was told it is back where it was.
    expect(lastCall(onResize)).toBe(WIDTH);
  });

  test("a drag the browser cancelled puts the panel back, and keeps nothing", () => {
    render(<Edge />);

    firePointer("pointerdown", 900);
    firePointer("pointermove", 700);
    firePointer("pointercancel", 700);

    expect(lastCall(onResize)).toBe(WIDTH);
    expect(onResizeEnd).not.toHaveBeenCalled();
    expect(edge()).toHaveAttribute("aria-valuenow", String(WIDTH));
    expect(edge()).not.toHaveAttribute("data-dragging");
  });

  test("a move with no press before it moves nothing", () => {
    render(<Edge />);

    firePointer("pointermove", 700);
    firePointer("pointerup", 700);

    expect(onResize).not.toHaveBeenCalled();
    expect(onResizeEnd).not.toHaveBeenCalled();
  });

  test("the other buttons do not start a drag", () => {
    render(<Edge />);

    firePointer("pointerdown", 900, { button: 2 });
    firePointer("pointermove", 700);

    expect(onResize).not.toHaveBeenCalled();
  });

  test("a second finger does not move what the first is dragging", () => {
    render(<Edge />);

    firePointer("pointerdown", 900, { pointerId: 1 });
    firePointer("pointermove", 500, { pointerId: 2 });
    firePointer("pointerup", 500, { pointerId: 2 });

    expect(onResize).not.toHaveBeenCalled();
    expect(onResizeEnd).not.toHaveBeenCalled();
    expect(edge()).toHaveAttribute("data-dragging", "true");
  });

  test("it keeps the pointer until it is let go, wherever the pointer wanders", () => {
    render(<Edge />);
    const capture: MockFunction = getJestMockFunction();
    Object.defineProperty(edge(), "setPointerCapture", {
      configurable: true,
      value: capture,
    });

    firePointer("pointerdown", 900, { pointerId: 7 });

    expect(capture).toHaveBeenCalledWith(7);
  });

  test("the press starts a drag, not a text selection across the page", () => {
    render(<Edge />);

    // fireEvent says whether anything called preventDefault on the event.
    expect(fireEvent.mouseDown(edge())).toBe(false);
  });
});

describe("by keyboard", () => {
  test("the arrow keys move it the way they point, and each move is kept", () => {
    render(<Edge />);
    const wider: number = WIDTH + ASK_AI_PANEL_RESIZE_KEY_STEP;

    expect(fireEvent.keyDown(edge(), { key: "ArrowLeft" })).toBe(false);

    expect(onResize.mock.calls).toEqual([[wider]]);
    expect(onResizeEnd.mock.calls).toEqual([[wider]]);
    expect(edge()).toHaveAttribute("aria-valuenow", String(wider));

    expect(fireEvent.keyDown(edge(), { key: "ArrowRight" })).toBe(false);

    expect(edge()).toHaveAttribute("aria-valuenow", String(WIDTH));
  });

  test("right to left they still move it the way they point", () => {
    render(<Edge />);
    edge().style.direction = "rtl";

    fireEvent.keyDown(edge(), { key: "ArrowRight" });

    expect(edge()).toHaveAttribute(
      "aria-valuenow",
      String(WIDTH + ASK_AI_PANEL_RESIZE_KEY_STEP),
    );

    fireEvent.keyDown(edge(), { key: "ArrowLeft" });

    expect(edge()).toHaveAttribute("aria-valuenow", String(WIDTH));
  });

  test("Home and End take it to its ends", () => {
    render(<Edge />);

    expect(fireEvent.keyDown(edge(), { key: "Home" })).toBe(false);
    expect(edge()).toHaveAttribute("aria-valuenow", String(MIN_WIDTH));

    expect(fireEvent.keyDown(edge(), { key: "End" })).toBe(false);
    expect(edge()).toHaveAttribute("aria-valuenow", String(MAX_WIDTH));
  });

  test("it never goes past its ends", () => {
    render(<Edge />);

    fireEvent.keyDown(edge(), { key: "End" });
    fireEvent.keyDown(edge(), { key: "ArrowLeft" });
    expect(edge()).toHaveAttribute("aria-valuenow", String(MAX_WIDTH));

    fireEvent.keyDown(edge(), { key: "Home" });
    fireEvent.keyDown(edge(), { key: "ArrowRight" });
    expect(edge()).toHaveAttribute("aria-valuenow", String(MIN_WIDTH));
  });

  test("every other key is left to whoever wants it: Tab leaves, Esc closes the panel", () => {
    render(<Edge />);

    for (const key of ["Tab", "Escape", "Enter", "a", "ArrowUp"]) {
      expect({ key, passed: fireEvent.keyDown(edge(), { key }) }).toEqual({
        key,
        passed: true,
      });
    }

    expect(onResize).not.toHaveBeenCalled();
  });
});

describe("a double click", () => {
  test("asks for the width it opens at", () => {
    render(<Edge />);

    fireEvent.doubleClick(edge());

    expect(onReset).toHaveBeenCalledTimes(1);
  });
});
