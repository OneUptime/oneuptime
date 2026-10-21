import { AccessibilityInfo } from "react-native";
import { act, renderHook, waitFor } from "@testing-library/react-native";
import { afterEach, describe, expect, test } from "@jest/globals";
import { useReduceMotion } from "./useReduceMotion";

/*
 * Whether to animate at all. The answer comes from the OS asynchronously, so
 * the hook has three states - unknown, yes, no - and the rule that matters is
 * that nothing may treat "unknown" as permission to move.
 */

interface RenderedReduceMotion {
  result: { current: boolean | null };
  unmount: () => void;
}

type ReduceMotionListener = (enabled: boolean) => void;

// renderHook is asynchronous in @testing-library/react-native v14.
async function renderReduceMotion(): Promise<RenderedReduceMotion> {
  return (await renderHook(() => {
    return useReduceMotion();
  })) as unknown as RenderedReduceMotion;
}

function answerWith(enabled: boolean): void {
  jest
    .spyOn(AccessibilityInfo, "isReduceMotionEnabled")
    .mockResolvedValue(enabled);
}

/*
 * Captures the listener the hook registers, so a test can play the part of
 * the OS when the reader flips the setting.
 */
function captureListener(): {
  listener: () => ReduceMotionListener | null;
  remove: jest.Mock;
} {
  let captured: ReduceMotionListener | null = null;
  const remove: jest.Mock = jest.fn();

  jest.spyOn(AccessibilityInfo, "addEventListener").mockImplementation(((
    _event: string,
    handler: ReduceMotionListener,
  ): { remove: jest.Mock } => {
    captured = handler;
    return { remove };
  }) as unknown as typeof AccessibilityInfo.addEventListener);

  return {
    listener: (): ReduceMotionListener | null => {
      return captured;
    },
    remove,
  };
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("useReduceMotion", () => {
  test("is unknown (null) until the OS answers", async () => {
    jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockReturnValue(
      new Promise<boolean>(() => {
        /* Never settles: the window before the answer. */
      }),
    );

    const { result } = await renderReduceMotion();

    expect(result.current).toBeNull();
  });

  test("is false once the OS says the reader has not asked for less motion", async () => {
    answerWith(false);

    const { result } = await renderReduceMotion();

    await waitFor(() => {
      expect(result.current).toBe(false);
    });
  });

  test("is true once the OS says the reader has", async () => {
    answerWith(true);

    const { result } = await renderReduceMotion();

    await waitFor(() => {
      expect(result.current).toBe(true);
    });
  });

  test("a question the OS refuses to answer is taken as reduce motion", async () => {
    jest
      .spyOn(AccessibilityInfo, "isReduceMotionEnabled")
      .mockRejectedValue(new Error("unavailable"));

    const { result } = await renderReduceMotion();

    await waitFor(() => {
      expect(result.current).toBe(true);
    });
  });

  test("follows the setting when the reader changes it with the screen open", async () => {
    answerWith(false);
    const subscription: ReturnType<typeof captureListener> = captureListener();

    const { result } = await renderReduceMotion();

    await waitFor(() => {
      expect(result.current).toBe(false);
    });

    expect(AccessibilityInfo.addEventListener).toHaveBeenCalledWith(
      "reduceMotionChanged",
      expect.any(Function),
    );

    await act(async () => {
      subscription.listener()!(true);
    });

    expect(result.current).toBe(true);

    await act(async () => {
      subscription.listener()!(false);
    });

    expect(result.current).toBe(false);
  });

  test("stops listening when it unmounts", async () => {
    answerWith(false);
    const subscription: ReturnType<typeof captureListener> = captureListener();

    const { unmount } = await renderReduceMotion();

    expect(subscription.remove).not.toHaveBeenCalled();

    await act(async () => {
      unmount();
    });

    expect(subscription.remove).toHaveBeenCalledTimes(1);
  });

  test("an answer that lands after unmounting is ignored", async () => {
    let answer: (enabled: boolean) => void = (): void => {
      // Replaced below, once the promise exists.
    };

    jest.spyOn(AccessibilityInfo, "isReduceMotionEnabled").mockReturnValue(
      new Promise<boolean>((resolve: (enabled: boolean) => void) => {
        answer = resolve;
      }),
    );
    const errors: jest.SpyInstance = jest.spyOn(console, "error");

    const { result, unmount } = await renderReduceMotion();

    await act(async () => {
      unmount();
    });

    await act(async () => {
      answer(false);
    });

    expect(result.current).toBeNull();
    expect(errors).not.toHaveBeenCalled();
  });
});
