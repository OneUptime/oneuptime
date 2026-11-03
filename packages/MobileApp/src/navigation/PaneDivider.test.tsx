import React from "react";
import { Platform } from "react-native";
import { fireEvent, render, screen } from "@testing-library/react-native";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { ThemeProvider, lightColors, touchTarget } from "../theme";
import PaneDivider, {
  DIVIDER_HANDLE_TOUCH_HEIGHT,
  DIVIDER_HANDLE_TOUCH_WIDTH,
  DOUBLE_TAP_INTERVAL_MS,
  isKeyboardFocus,
  type PaneDividerProps,
} from "./PaneDivider";
import { DIVIDER_STEP } from "../layout/paneDivider";

/*
 * The handle on the divider, on its own: what a drag, a tap, a double tap and
 * a screen reader each do with it. The unfolded Galaxy Z Fold's numbers: an
 * 804-point area beside the rail, the list on the fold's line at 362, and
 * room to drag it between 320 and 444.
 */

const RANGE: PaneDividerProps["range"] = { min: 320, max: 444 };
const ON_THE_FOLD: number = 362;

interface Handlers {
  onDrag: jest.Mock<(width: number) => void>;
  onCommit: jest.Mock<(width: number | null) => void>;
  onCancel: jest.Mock<() => void>;
}

let now: number = 1_000_000;

beforeEach(() => {
  now = 1_000_000;
  jest.spyOn(Date, "now").mockImplementation((): number => {
    return now;
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function renderDivider(width: number = ON_THE_FOLD): Promise<Handlers> {
  const handlers: Handlers = {
    onDrag: jest.fn(),
    onCommit: jest.fn(),
    onCancel: jest.fn(),
  };
  await render(
    <ThemeProvider>
      <PaneDivider
        width={width}
        defaultWidth={ON_THE_FOLD}
        range={RANGE}
        contentWidth={804}
        {...handlers}
      />
    </ThemeProvider>,
  );
  return handlers;
}

async function press(pageX: number): Promise<void> {
  await fireEvent(screen.getByTestId("pane-divider"), "responderGrant", {
    nativeEvent: { pageX },
  });
}

async function move(pageX: number): Promise<void> {
  await fireEvent(screen.getByTestId("pane-divider"), "responderMove", {
    nativeEvent: { pageX },
  });
}

async function release(pageX: number): Promise<void> {
  await fireEvent(screen.getByTestId("pane-divider"), "responderRelease", {
    nativeEvent: { pageX },
  });
}

describe("The divider's handle", () => {
  test("sits on the divider, a touch target centred on the list's edge", async () => {
    await renderDivider();

    expect(screen.getByTestId("pane-divider")).toHaveStyle({
      position: "absolute",
      left: ON_THE_FOLD - DIVIDER_HANDLE_TOUCH_WIDTH / 2,
      width: DIVIDER_HANDLE_TOUCH_WIDTH,
      height: DIVIDER_HANDLE_TOUCH_HEIGHT,
      top: "50%",
    });
    expect(screen.getByTestId("pane-divider-pill")).toBeTruthy();
  });

  test("its touch target is at least every control's minimum wide, and taller than that", () => {
    expect(DIVIDER_HANDLE_TOUCH_WIDTH).toBeGreaterThanOrEqual(touchTarget);
    expect(DIVIDER_HANDLE_TOUCH_HEIGHT).toBeGreaterThan(touchTarget);
  });

  test("claims the touch, and keeps it from a list scrolling underneath", async () => {
    await renderDivider();
    const handle: ReturnType<typeof screen.getByTestId> =
      screen.getByTestId("pane-divider");

    expect(handle.props.onStartShouldSetResponder()).toBe(true);
    expect(handle.props.onResponderTerminationRequest()).toBe(false);
  });

  test("dragging moves the divider with the finger, within the range", async () => {
    const { onDrag, onCommit } = await renderDivider();

    await press(442);
    await move(472);
    await move(600);
    await move(300);

    expect(
      onDrag.mock.calls.map((call: [number]): number => {
        return call[0];
      }),
    ).toEqual([ON_THE_FOLD + 30, 444, 320]);
    expect(onCommit).not.toHaveBeenCalled();
  });

  test("a line marks the divider while it is held", async () => {
    await renderDivider();
    expect(screen.queryByTestId("pane-divider-line")).toBeNull();

    await press(442);
    expect(screen.getByTestId("pane-divider-line")).toHaveStyle({
      left: ON_THE_FOLD - 1,
      width: 2,
    });

    await release(442);
    expect(screen.queryByTestId("pane-divider-line")).toBeNull();
  });

  test("letting go keeps the width it was let go at", async () => {
    const { onCommit } = await renderDivider();

    await press(442);
    await move(492);
    await release(492);

    expect(onCommit).toHaveBeenCalledWith(ON_THE_FOLD + 50);
  });

  test("letting go near the fold's line settles on it, and remembers nothing", async () => {
    const { onCommit } = await renderDivider(400);

    await press(480);
    await move(450);
    await release(450);

    // 370 is within the snap distance of 362.
    expect(onCommit).toHaveBeenCalledWith(null);
  });

  test("let go past either end, it rests at that end", async () => {
    const { onCommit } = await renderDivider();

    await press(442);
    await move(1000);
    await release(1000);

    expect(onCommit).toHaveBeenCalledWith(444);
  });

  test("a press that hardly moves is not a drag", async () => {
    const { onDrag, onCommit, onCancel } = await renderDivider();

    await press(442);
    await move(444);
    await release(444);

    expect(onDrag).not.toHaveBeenCalled();
    expect(onCommit).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  test("a double tap puts the divider back where the layout has it", async () => {
    const { onCommit } = await renderDivider(410);

    await press(490);
    await release(490);
    now += DOUBLE_TAP_INTERVAL_MS - 50;
    await press(490);
    await release(490);

    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith(null);
  });

  test("two taps further apart are two taps", async () => {
    const { onCommit, onCancel } = await renderDivider(410);

    await press(490);
    await release(490);
    now += DOUBLE_TAP_INTERVAL_MS + 1;
    await press(490);
    await release(490);

    expect(onCommit).not.toHaveBeenCalled();
    expect(onCancel).toHaveBeenCalledTimes(2);
  });

  test("a drag between two taps is not a double tap", async () => {
    const { onCommit } = await renderDivider(410);

    await press(490);
    await release(490);
    await press(490);
    await move(530);
    await release(530);
    now += 10;
    await press(530);
    await release(530);

    expect(onCommit).toHaveBeenCalledTimes(1);
    expect(onCommit).toHaveBeenCalledWith(444);
  });

  test("a drag the system takes over is cancelled, and changes nothing", async () => {
    const { onCommit, onCancel } = await renderDivider();

    await press(442);
    await move(480);
    await fireEvent(screen.getByTestId("pane-divider"), "responderTerminate", {
      nativeEvent: { pageX: 480 },
    });

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onCommit).not.toHaveBeenCalled();
    expect(screen.queryByTestId("pane-divider-line")).toBeNull();
  });
});

describe("The divider with a screen reader", () => {
  test("is an adjustable control that says what it is and how far it is set", async () => {
    await renderDivider();
    const handle: ReturnType<typeof screen.getByTestId> =
      screen.getByTestId("pane-divider");

    expect(handle.props.accessible).toBe(true);
    expect(handle.props.accessibilityRole).toBe("adjustable");
    expect(handle.props.accessibilityLabel).toBe("List width");
    // Swiping up or down is the screen reader's own slider gesture, which it names itself.
    expect(handle.props.accessibilityHint).toBe(
      "Double tap to put the divider back.",
    );
    expect(handle.props.accessibilityValue).toEqual({
      min: 320,
      max: 444,
      now: ON_THE_FOLD,
      text: "45%",
    });
    expect(
      handle.props.accessibilityActions.map(
        (action: { name: string }): string => {
          return action.name;
        },
      ),
    ).toEqual(["increment", "decrement", "activate"]);
  });

  test("increment and decrement move it a step, stopping on the fold's line", async () => {
    const { onCommit } = await renderDivider(330);
    const handle: ReturnType<typeof screen.getByTestId> =
      screen.getByTestId("pane-divider");

    await fireEvent(handle, "accessibilityAction", {
      nativeEvent: { actionName: "increment" },
    });
    expect(onCommit).toHaveBeenLastCalledWith(null);

    await fireEvent(handle, "accessibilityAction", {
      nativeEvent: { actionName: "decrement" },
    });
    expect(onCommit).toHaveBeenLastCalledWith(320);
  });

  test("from the fold's line, a step moves it on", async () => {
    const { onCommit } = await renderDivider();

    await fireEvent(screen.getByTestId("pane-divider"), "accessibilityAction", {
      nativeEvent: { actionName: "increment" },
    });

    expect(onCommit).toHaveBeenCalledWith(ON_THE_FOLD + DIVIDER_STEP);
  });

  test("a screen reader's double tap puts it back", async () => {
    const { onCommit } = await renderDivider(420);

    await fireEvent(screen.getByTestId("pane-divider"), "accessibilityAction", {
      nativeEvent: { actionName: "activate" },
    });

    expect(onCommit).toHaveBeenCalledWith(null);
  });

  test("an action it does not know does nothing", async () => {
    const { onCommit, onCancel } = await renderDivider(420);

    await fireEvent(screen.getByTestId("pane-divider"), "accessibilityAction", {
      nativeEvent: { actionName: "magicTap" },
    });

    expect(onCommit).not.toHaveBeenCalled();
    expect(onCancel).not.toHaveBeenCalled();
  });
});
describe("The divider from a keyboard", () => {
  /*
   * A Chromebook's, a tablet's or the web build's keyboard: the handle is a
   * tab stop, the arrow keys move it a step at a time, Home and End take it
   * to either end, Enter puts it back - and while the keys move it, a ring
   * and the divider's line show what they move.
   */
  async function key(name: string): Promise<jest.Mock<() => void>> {
    const preventDefault: jest.Mock<() => void> = jest.fn();
    await fireEvent(screen.getByTestId("pane-divider"), "keyDown", {
      nativeEvent: { key: name },
      preventDefault,
    });
    return preventDefault;
  }

  test("is a tab stop", async () => {
    await renderDivider();

    expect(screen.getByTestId("pane-divider").props.focusable).toBe(true);
  });

  test("an arrow moves it one step, stopping on the fold's line, and keeps the page from scrolling", async () => {
    const handlers: Handlers = await renderDivider(400);

    const right: jest.Mock<() => void> = await key("ArrowRight");
    expect(handlers.onCommit).toHaveBeenLastCalledWith(400 + DIVIDER_STEP);
    expect(right).toHaveBeenCalledTimes(1);

    await key("ArrowLeft");
    expect(handlers.onCommit).toHaveBeenLastCalledWith(null);
  });

  test("up and down do what right and left do", async () => {
    const handlers: Handlers = await renderDivider(380);

    await key("ArrowUp");
    expect(handlers.onCommit).toHaveBeenLastCalledWith(380 + DIVIDER_STEP);
    await key("ArrowDown");
    expect(handlers.onCommit).toHaveBeenLastCalledWith(null);
  });

  test("Home and End take it to the narrowest and widest list; Enter puts it back", async () => {
    const handlers: Handlers = await renderDivider(400);

    await key("Home");
    expect(handlers.onCommit).toHaveBeenLastCalledWith(RANGE.min);
    await key("End");
    expect(handlers.onCommit).toHaveBeenLastCalledWith(RANGE.max);
    await key("Enter");
    expect(handlers.onCommit).toHaveBeenLastCalledWith(null);
  });

  test("every other key is left to do what it does: Tab moves on, nothing is committed", async () => {
    const handlers: Handlers = await renderDivider(400);

    for (const name of ["Tab", "a", " ", "Escape"]) {
      const preventDefault: jest.Mock<() => void> = await key(name);
      expect(preventDefault).not.toHaveBeenCalled();
    }
    expect(handlers.onCommit).not.toHaveBeenCalled();
  });

  test("a key with no name - an event from elsewhere - does nothing", async () => {
    const handlers: Handlers = await renderDivider(400);

    await fireEvent(screen.getByTestId("pane-divider"), "keyDown", {});
    expect(handlers.onCommit).not.toHaveBeenCalled();
  });

  test("focused from the keyboard, a ring surrounds it and the divider's line shows", async () => {
    await renderDivider();
    expect(screen.queryByTestId("pane-divider-line")).toBeNull();

    await fireEvent(screen.getByTestId("pane-divider"), "focus", {});

    expect(screen.getByTestId("pane-divider-line")).toBeTruthy();
    expect(screen.getByTestId("pane-divider")).toHaveStyle({
      borderColor: lightColors.actionPrimary,
    });
    expect(screen.getByTestId("pane-divider-pill")).toHaveStyle({
      backgroundColor: lightColors.actionPrimary,
    });

    await fireEvent(screen.getByTestId("pane-divider"), "blur", {});

    expect(screen.queryByTestId("pane-divider-line")).toBeNull();
    expect(screen.getByTestId("pane-divider")).toHaveStyle({
      borderColor: "transparent",
    });
  });

  test("a key pressed with the handle focused some other way shows the ring all the same", async () => {
    await renderDivider(400);

    await key("ArrowRight");

    expect(screen.getByTestId("pane-divider-line")).toBeTruthy();
  });
});

describe("Whether the handle took focus from a keyboard", () => {
  /*
   * On a phone or a tablet a touch never focuses it - only a keyboard does.
   * A browser focuses it on a click too, so there the browser's own rule for
   * showing focus decides.
   */
  const realOS: string = Platform.OS;

  afterEach(() => {
    (Platform as unknown as { OS: string }).OS = realOS;
  });

  test("on a phone, any focus is the keyboard's", () => {
    (Platform as unknown as { OS: string }).OS = "android";
    expect(isKeyboardFocus({})).toBe(true);
    expect(isKeyboardFocus(null)).toBe(true);
  });

  test("in a browser, :focus-visible says", () => {
    (Platform as unknown as { OS: string }).OS = "web";
    const matches: jest.Mock<(selector: string) => boolean> = jest.fn(
      (selector: string): boolean => {
        return selector === ":focus-visible";
      },
    );

    expect(isKeyboardFocus({ target: { matches } })).toBe(true);
    expect(
      isKeyboardFocus({
        target: {
          matches: (): boolean => {
            return false;
          },
        },
      }),
    ).toBe(false);
  });

  test("in a browser that cannot say, the ring shows rather than hides", () => {
    (Platform as unknown as { OS: string }).OS = "web";

    expect(isKeyboardFocus({ target: {} })).toBe(true);
    expect(
      isKeyboardFocus({
        target: {
          matches: (): boolean => {
            throw new Error("unsupported selector");
          },
        },
      }),
    ).toBe(true);
  });
});
