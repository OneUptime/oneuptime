import * as Haptics from "expo-haptics";
import { renderHook } from "@testing-library/react-native";
import { useHaptics } from "./useHaptics";
import { describe, expect, test } from "@jest/globals";

/*
 * Every acknowledge and every resolve in this app ends with a buzz from here,
 * and on a phone in a pocket at 3am that buzz is often the ONLY confirmation
 * the responder gets that the page was taken - the screen is face-down, the
 * sound is off, and the toast has already gone.
 *
 * So the thing worth pinning down is not that some haptic fired but that the
 * RIGHT one did: success and error are distinguishable by feel, and a wiring
 * mistake that sends the success pattern on a failed acknowledge tells a
 * responder they have the page when they do not. Hence the assertions below
 * check both the function and the feedback type, and check that the two
 * families - notification patterns and impact taps - are not crossed.
 *
 * The module is mocked with the real enum VALUES rather than with placeholders;
 * a fake whose Success is `undefined` would let a test asserting "called with
 * Success" pass against a call that actually passed nothing.
 */
jest.mock("expo-haptics", () => {
  return {
    NotificationFeedbackType: {
      Success: "success",
      Warning: "warning",
      Error: "error",
    },
    ImpactFeedbackStyle: {
      Light: "light",
      Medium: "medium",
      Heavy: "heavy",
      Soft: "soft",
      Rigid: "rigid",
    },
    notificationAsync: jest.fn(async () => {
      return undefined;
    }),
    impactAsync: jest.fn(async () => {
      return undefined;
    }),
    selectionAsync: jest.fn(async () => {
      return undefined;
    }),
  };
});

type HapticsApi = ReturnType<typeof useHaptics>;

async function renderHaptics(): Promise<HapticsApi> {
  /*
   * renderHook is asynchronous in @testing-library/react-native v14 - it
   * returns a promise, so destructuring it directly yields undefined.
   */
  const rendered: { result: { current: HapticsApi } } = (await renderHook(
    () => {
      return useHaptics();
    },
  )) as unknown as { result: { current: HapticsApi } };

  return rendered.result.current;
}

function notificationSpy(): jest.Mock {
  return Haptics.notificationAsync as unknown as jest.Mock;
}

function impactSpy(): jest.Mock {
  return Haptics.impactAsync as unknown as jest.Mock;
}

function selectionSpy(): jest.Mock {
  return Haptics.selectionAsync as unknown as jest.Mock;
}

describe("useHaptics notification patterns", () => {
  test("successFeedback plays the success notification pattern", async () => {
    const haptics: HapticsApi = await renderHaptics();

    await haptics.successFeedback();

    expect(notificationSpy()).toHaveBeenCalledWith(
      Haptics.NotificationFeedbackType.Success,
    );
  });

  test("errorFeedback plays the error notification pattern", async () => {
    const haptics: HapticsApi = await renderHaptics();

    await haptics.errorFeedback();

    expect(notificationSpy()).toHaveBeenCalledWith(
      Haptics.NotificationFeedbackType.Error,
    );
  });

  test("success and error are not the same pattern", async () => {
    /*
     * The whole point of the pair. If a refactor collapsed them, an
     * acknowledge that failed would feel exactly like one that worked.
     */
    const haptics: HapticsApi = await renderHaptics();

    await haptics.successFeedback();
    await haptics.errorFeedback();

    expect(notificationSpy().mock.calls[0]).not.toEqual(
      notificationSpy().mock.calls[1],
    );
  });

  test("successFeedback does not also fire an impact tap", async () => {
    const haptics: HapticsApi = await renderHaptics();

    await haptics.successFeedback();

    expect(impactSpy()).not.toHaveBeenCalled();
    expect(selectionSpy()).not.toHaveBeenCalled();
  });
});

describe("useHaptics impact taps", () => {
  test("lightImpact plays the light impact style", async () => {
    const haptics: HapticsApi = await renderHaptics();

    await haptics.lightImpact();

    expect(impactSpy()).toHaveBeenCalledWith(Haptics.ImpactFeedbackStyle.Light);
  });

  test("mediumImpact plays the medium impact style", async () => {
    const haptics: HapticsApi = await renderHaptics();

    await haptics.mediumImpact();

    expect(impactSpy()).toHaveBeenCalledWith(
      Haptics.ImpactFeedbackStyle.Medium,
    );
  });

  test("light and medium are not the same weight", async () => {
    const haptics: HapticsApi = await renderHaptics();

    await haptics.lightImpact();
    await haptics.mediumImpact();

    expect(impactSpy().mock.calls[0]).not.toEqual(impactSpy().mock.calls[1]);
  });

  test("an impact tap is not a notification pattern", async () => {
    const haptics: HapticsApi = await renderHaptics();

    await haptics.lightImpact();

    expect(notificationSpy()).not.toHaveBeenCalled();
  });
});

describe("useHaptics selection feedback", () => {
  test("selectionFeedback plays the selection tick", async () => {
    const haptics: HapticsApi = await renderHaptics();

    await haptics.selectionFeedback();

    expect(selectionSpy()).toHaveBeenCalledTimes(1);
  });

  test("the selection tick takes no feedback type", async () => {
    /*
     * expo-haptics' selectionAsync has no argument. Passing one would be
     * harmless today but is a sign the wrong call was reached for.
     */
    const haptics: HapticsApi = await renderHaptics();

    await haptics.selectionFeedback();

    expect(selectionSpy()).toHaveBeenCalledWith();
  });

  test("selectionFeedback is neither an impact nor a notification", async () => {
    const haptics: HapticsApi = await renderHaptics();

    await haptics.selectionFeedback();

    expect(impactSpy()).not.toHaveBeenCalled();
    expect(notificationSpy()).not.toHaveBeenCalled();
  });
});

describe("useHaptics as a whole", () => {
  test("offers all five helpers", async () => {
    /*
     * Screens destructure these by name - `const { lightImpact } =
     * useHaptics()`. A helper that disappeared would be `undefined`, and the
     * call site would throw at the moment a responder pressed the button
     * rather than at build time.
     */
    const haptics: HapticsApi = await renderHaptics();

    expect(typeof haptics.successFeedback).toBe("function");
    expect(typeof haptics.errorFeedback).toBe("function");
    expect(typeof haptics.lightImpact).toBe("function");
    expect(typeof haptics.mediumImpact).toBe("function");
    expect(typeof haptics.selectionFeedback).toBe("function");
  });

  test("firing a helper twice buzzes twice", async () => {
    /*
     * Two pages acknowledged back to back are two separate confirmations. The
     * helpers hold no state that could swallow the second one.
     */
    const haptics: HapticsApi = await renderHaptics();

    await haptics.lightImpact();
    await haptics.lightImpact();

    expect(impactSpy()).toHaveBeenCalledTimes(2);
  });

  test("a native failure surfaces as a rejection rather than an unhandled one", async () => {
    /*
     * Recording what the helpers do today rather than what they ideally would:
     * every helper AWAITS the native call, so a rejecting taptic engine rejects
     * the helper too. That is safe as a promise - nothing goes unhandled - but
     * it does mean a caller that awaits `successFeedback()` inside the same try
     * block as its API request will treat a buzz that failed as a request that
     * failed. If that is ever changed to swallow, this test is the place the
     * decision gets made deliberately instead of by accident.
     */
    notificationSpy().mockRejectedValueOnce(
      new Error("haptics unavailable") as never,
    );

    const haptics: HapticsApi = await renderHaptics();

    await expect(haptics.successFeedback()).rejects.toThrow(
      "haptics unavailable",
    );
  });
});
