import React from "react";
import { Keyboard, Platform, type EmitterSubscription } from "react-native";
import { SafeAreaInsetsContext } from "react-native-safe-area-context";
import { act, renderHook } from "@testing-library/react-native";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { useKeyboardShown, useSheetPlacement } from "./useSheetPlacement";
import { WindowLayoutProvider } from "./WindowLayout";
import type { SheetPlacement } from "./sheetPlacement";
import {
  TEST_WINDOWS,
  resetWindowSize,
  setWindowSize,
} from "../__tests__/windowSize";
import {
  createTestPostureSource,
  flatReport,
  tabletopReport,
  type TestPostureSource,
} from "../__tests__/postureTestSource";

/*
 * Whether the keyboard is up, read only where a sheet needs it - half open
 * on a table - and on each platform's own events: iOS says before the
 * keyboard moves, Android once it has.
 */

type Listener = () => void;
let listeners: Map<string, Set<Listener>>;
let addListener: jest.SpiedFunction<typeof Keyboard.addListener>;
let removed: Array<string>;

beforeEach(() => {
  listeners = new Map();
  removed = [];
  addListener = jest.spyOn(Keyboard, "addListener").mockImplementation(((
    eventName: string,
    listener: Listener,
  ) => {
    const set: Set<Listener> = listeners.get(eventName) ?? new Set();
    set.add(listener);
    listeners.set(eventName, set);
    return {
      remove: (): void => {
        set.delete(listener);
        removed.push(eventName);
      },
    } as unknown as EmitterSubscription;
  }) as unknown as typeof Keyboard.addListener);
  jest.spyOn(Keyboard, "isVisible").mockReturnValue(false);
});

afterEach(() => {
  jest.restoreAllMocks();
  resetWindowSize();
});

function fire(eventName: string): void {
  for (const listener of Array.from(listeners.get(eventName) ?? [])) {
    listener();
  }
}

const SHOW: string =
  Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
const HIDE: string =
  Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";

describe("useKeyboardShown", () => {
  test("listens on the platform's own events, and follows the keyboard up and down", async () => {
    const rendered: { result: { current: boolean } } = await renderHook(() => {
      return useKeyboardShown(true);
    });

    expect(
      addListener.mock.calls.map((call: Array<unknown>) => {
        return call[0];
      }),
    ).toEqual([SHOW, HIDE]);
    expect(rendered.result.current).toBe(false);

    await act(async () => {
      fire(SHOW);
    });
    expect(rendered.result.current).toBe(true);

    await act(async () => {
      fire(HIDE);
    });
    expect(rendered.result.current).toBe(false);
  });

  test("a keyboard already up when it starts listening counts", async () => {
    (Keyboard.isVisible as unknown as jest.Mock).mockReturnValue(true);

    const rendered: { result: { current: boolean } } = await renderHook(() => {
      return useKeyboardShown(true);
    });

    expect(rendered.result.current).toBe(true);
  });

  test("off, it listens to nothing and says the keyboard is down", async () => {
    const rendered: { result: { current: boolean } } = await renderHook(() => {
      return useKeyboardShown(false);
    });

    expect(addListener).not.toHaveBeenCalled();
    expect(rendered.result.current).toBe(false);
  });

  test("turned off, it stops listening - and turned on again, starts afresh", async () => {
    const rendered: {
      result: { current: boolean };
      rerender: (props: { enabled: boolean }) => Promise<void> | void;
    } = await renderHook(
      ({ enabled }: { enabled: boolean }) => {
        return useKeyboardShown(enabled);
      },
      { initialProps: { enabled: true } },
    );
    await act(async () => {
      fire(SHOW);
    });
    expect(rendered.result.current).toBe(true);

    await rendered.rerender({ enabled: false });
    expect(removed.sort()).toEqual([HIDE, SHOW].sort());
    expect(rendered.result.current).toBe(false);

    await rendered.rerender({ enabled: true });
    expect(rendered.result.current).toBe(false);
  });
});

describe("useSheetPlacement", () => {
  const SIZE: { width: number; height: number } =
    TEST_WINDOWS.innerScreenOnItsSide;

  async function renderPlacement(source: TestPostureSource): Promise<{
    result: { current: SheetPlacement };
  }> {
    setWindowSize(SIZE);
    return renderHook(useSheetPlacement, {
      wrapper: ({ children }: { children: React.ReactNode }) => {
        return (
          <SafeAreaInsetsContext.Provider
            value={{ top: 24, right: 0, bottom: 16, left: 0 }}
          >
            <WindowLayoutProvider postureSource={source}>
              {children}
            </WindowLayoutProvider>
          </SafeAreaInsetsContext.Provider>
        );
      },
    });
  }

  test("lying flat: the sheet's own placement, and no keyboard listening at all", async () => {
    const rendered: { result: { current: SheetPlacement } } =
      await renderPlacement(createTestPostureSource(flatReport(SIZE)));

    expect(rendered.result.current.anchor).toBe("bottom");
    expect(rendered.result.current.maxHeight).toBeUndefined();
    expect(addListener).not.toHaveBeenCalled();
  });

  test("half open on a table: over the half on the table, then above the fold while the keyboard is up", async () => {
    const source: TestPostureSource = createTestPostureSource(
      tabletopReport(SIZE, 442),
    );
    const rendered: { result: { current: SheetPlacement } } =
      await renderPlacement(source);

    expect(rendered.result.current).toMatchObject({
      anchor: "bottom",
      maxHeight: 430,
    });

    await act(async () => {
      fire(SHOW);
    });
    expect(rendered.result.current).toMatchObject({
      anchor: "top",
      maxHeight: 430 - 24,
      paddingTop: 24,
    });

    // Opened flat with the keyboard still up: back to the sheet's own placement.
    await act(async () => {
      source.emit(flatReport(SIZE));
    });
    expect(rendered.result.current.anchor).toBe("bottom");
    expect(rendered.result.current.avoidsKeyboard).toBe(true);
  });
});
