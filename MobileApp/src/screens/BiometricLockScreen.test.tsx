import React from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react-native";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import type { MockedFunction } from "jest-mock";
import BiometricLockScreen from "./BiometricLockScreen";

/*
 * The screen standing between a responder and a page they have already been
 * woken by. Everything about it is about not getting in the way twice:
 *
 *   - it must raise the OS prompt ITSELF, on appearing. A responder who has to
 *     find and tap "Unlock" before the phone will even offer Face ID has been
 *     charged an extra step at the worst moment.
 *   - it must raise it ONCE. Re-prompting on every render stacks system sheets
 *     and, on both platforms, an authentication that is cancelled because
 *     another one started counts as a failed attempt.
 *   - a FAILED attempt must not unlock. That is the whole point of the screen,
 *     and it is the one bug here that would never be noticed by the person it
 *     affects.
 *   - a failed attempt must leave the way back in. The prompt is gone at that
 *     point, so the Unlock button is the only thing on screen that can raise
 *     it again, and without it the responder is looking at a locked app with
 *     no control on it.
 *   - the passcode fallback must stay available. A face that will not scan in
 *     the dark, or a wet thumb, is exactly the situation this app is used in.
 *
 * `expo-local-authentication` is native and has no JS implementation off a
 * device, so it is stood in for; the biometric TYPE is a prop, decided by the
 * caller from what the hardware reported, and both of its real values are
 * exercised because the copy is the only place either of them shows up.
 */

interface AuthenticationOptions {
  promptMessage?: string;
  fallbackLabel?: string;
  disableDeviceFallback?: boolean;
}

interface AuthenticationResult {
  success: boolean;
  error?: string;
}

type AuthenticateAsync = (
  options: AuthenticationOptions,
) => Promise<AuthenticationResult>;

/*
 * `render` is async in this version of the testing library, so what it hands
 * back has to be unwrapped before it can be named.
 */
type RenderedScreen = Awaited<ReturnType<typeof render>>;

const mockAuthenticateAsync: MockedFunction<AuthenticateAsync> =
  jest.fn<AuthenticateAsync>();

jest.mock("expo-local-authentication", () => {
  return {
    authenticateAsync: (options: AuthenticationOptions) => {
      return mockAuthenticateAsync(options);
    },
  };
});

/* What the two platforms report, and the only two values ever passed in. */
const FACE_ID: string = "Face ID";
const FINGERPRINT: string = "Fingerprint";

const SUCCEEDED: AuthenticationResult = { success: true };

/* The OS did not recognise the face or finger it was shown. */
const FAILED: AuthenticationResult = {
  success: false,
  error: "authentication_failed",
};

/* The user dismissed the sheet. Not a failure of the sensor, same outcome. */
const CANCELLED: AuthenticationResult = {
  success: false,
  error: "user_cancel",
};

async function renderLockScreen(
  onSuccess: () => void,
  biometricType: string = FACE_ID,
): Promise<RenderedScreen> {
  return await render(
    <BiometricLockScreen onSuccess={onSuccess} biometricType={biometricType} />,
  );
}

/*
 * The prompt is raised from an effect and answered a microtask later, so a
 * macrotask boundary is what makes "it did not unlock" a statement about a
 * finished attempt rather than about one that had not landed yet. The boundary
 * is taken OUTSIDE `act`, with a short act after it to apply anything React
 * queued.
 */
async function settleAuthentication(): Promise<void> {
  await new Promise<void>((resolve: () => void): void => {
    setTimeout(resolve, 0);
  });

  await act(async (): Promise<void> => {
    await Promise.resolve();
  });
}

async function pressUnlock(): Promise<void> {
  await fireEvent.press(screen.getByRole("button", { name: "Unlock" }));
}

beforeEach(() => {
  /*
   * `clearMocks` in jest.config.js clears CALLS but not IMPLEMENTATIONS, so a
   * refusal left behind by an earlier test would otherwise decide this one.
   */
  mockAuthenticateAsync.mockReset();
  mockAuthenticateAsync.mockResolvedValue(SUCCEEDED);
});

describe("What the locked screen says", () => {
  test("it states that the app is locked", async () => {
    await renderLockScreen(jest.fn());

    expect(screen.getByText("OneUptime is Locked")).toBeTruthy();
  });

  test("Face ID reaches the instruction", async () => {
    /*
     * The wording has to name the gesture the responder is about to be asked
     * for. "Use biometrics to unlock" in front of a Face ID sheet is a
     * sentence nobody acts on.
     */
    await renderLockScreen(jest.fn(), FACE_ID);

    expect(screen.getByText("Use face id to unlock")).toBeTruthy();
  });

  test("Fingerprint reaches the instruction", async () => {
    await renderLockScreen(jest.fn(), FINGERPRINT);

    expect(screen.getByText("Use fingerprint to unlock")).toBeTruthy();
  });

  test("the two hardware types do not produce the same instruction", async () => {
    /*
     * Guards against the label being dropped from the copy entirely, which
     * would leave a sentence that still reads perfectly well and tells the
     * responder nothing.
     */
    await renderLockScreen(jest.fn(), FINGERPRINT);

    expect(screen.queryByText("Use face id to unlock")).toBeNull();
  });

  test("an Unlock button is offered as a button to a screen reader", async () => {
    await renderLockScreen(jest.fn());

    expect(screen.getByRole("button", { name: "Unlock" })).toBeTruthy();
  });
});

describe("The prompt is raised without being asked for", () => {
  test("the OS is asked to authenticate as soon as the screen appears", async () => {
    await renderLockScreen(jest.fn());

    await waitFor(() => {
      expect(mockAuthenticateAsync).toHaveBeenCalledTimes(1);
    });
  });

  test("the system sheet names this app, not the SDK", async () => {
    /*
     * `promptMessage` is the line the OS renders above the sensor, and it is
     * the only context the responder gets for a sheet that appeared on its
     * own.
     */
    await renderLockScreen(jest.fn());

    await waitFor(() => {
      expect(mockAuthenticateAsync).toHaveBeenCalledWith(
        expect.objectContaining({ promptMessage: "Unlock OneUptime" }),
      );
    });
  });

  test("the device passcode is left available as a fallback", async () => {
    /*
     * A face that will not scan in the dark and a wet thumb are the conditions
     * this app is actually used in. Disabling the fallback would lock the
     * responder out of the page that woke them with no way through at all.
     */
    await renderLockScreen(jest.fn());

    await waitFor(() => {
      expect(mockAuthenticateAsync).toHaveBeenCalledWith({
        promptMessage: "Unlock OneUptime",
        fallbackLabel: "Use passcode",
        disableDeviceFallback: false,
      });
    });
  });

  test("re-rendering does not raise a second prompt", async () => {
    /*
     * The prompt belongs to the screen appearing, not to any particular
     * render. A second sheet raised over the first cancels it, and a cancelled
     * attempt is a failed attempt on both platforms - so a missing dependency
     * list here would show up as biometrics that "never work".
     */
    const view: RenderedScreen = await renderLockScreen(jest.fn(), FACE_ID);

    await waitFor(() => {
      expect(mockAuthenticateAsync).toHaveBeenCalledTimes(1);
    });

    await view.rerender(
      <BiometricLockScreen onSuccess={jest.fn()} biometricType={FINGERPRINT} />,
    );

    await settleAuthentication();

    expect(screen.getByText("Use fingerprint to unlock")).toBeTruthy();
    expect(mockAuthenticateAsync).toHaveBeenCalledTimes(1);
  });
});

describe("An authentication that succeeds", () => {
  test("unlocks the app", async () => {
    const onSuccess: MockedFunction<() => void> = jest.fn<() => void>();

    await renderLockScreen(onSuccess);

    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledTimes(1);
    });
  });

  test("unlocks it exactly once for one prompt", async () => {
    const onSuccess: MockedFunction<() => void> = jest.fn<() => void>();

    await renderLockScreen(onSuccess);

    await settleAuthentication();

    expect(onSuccess).toHaveBeenCalledTimes(1);
  });
});

describe("An authentication that does not succeed", () => {
  test("a rejected face or finger does not unlock the app", async () => {
    const onSuccess: MockedFunction<() => void> = jest.fn<() => void>();

    mockAuthenticateAsync.mockResolvedValue(FAILED);

    await renderLockScreen(onSuccess);
    await settleAuthentication();

    expect(mockAuthenticateAsync).toHaveBeenCalledTimes(1);
    expect(onSuccess).not.toHaveBeenCalled();
  });

  test("a cancelled prompt does not unlock the app either", async () => {
    /*
     * Dismissing the sheet is not consent. It is also the easiest result to
     * get by accident - the sheet appears unasked-for, and a thumb already on
     * its way to the screen dismisses it.
     */
    const onSuccess: MockedFunction<() => void> = jest.fn<() => void>();

    mockAuthenticateAsync.mockResolvedValue(CANCELLED);

    await renderLockScreen(onSuccess);
    await settleAuthentication();

    expect(onSuccess).not.toHaveBeenCalled();
  });

  test("the screen stays locked and keeps its Unlock button", async () => {
    mockAuthenticateAsync.mockResolvedValue(CANCELLED);

    await renderLockScreen(jest.fn());
    await settleAuthentication();

    expect(screen.getByText("OneUptime is Locked")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Unlock" })).toBeTruthy();
  });

  test("pressing Unlock raises the prompt again", async () => {
    mockAuthenticateAsync.mockResolvedValue(CANCELLED);

    await renderLockScreen(jest.fn());
    await settleAuthentication();

    await pressUnlock();
    await settleAuthentication();

    expect(mockAuthenticateAsync).toHaveBeenCalledTimes(2);
  });

  test("a retry that succeeds unlocks the app", async () => {
    const onSuccess: MockedFunction<() => void> = jest.fn<() => void>();

    mockAuthenticateAsync.mockResolvedValueOnce(CANCELLED);
    mockAuthenticateAsync.mockResolvedValue(SUCCEEDED);

    await renderLockScreen(onSuccess);
    await settleAuthentication();

    expect(onSuccess).not.toHaveBeenCalled();

    await pressUnlock();

    await waitFor(() => {
      expect(onSuccess).toHaveBeenCalledTimes(1);
    });
  });

  test("two refusals in a row still do not unlock the app", async () => {
    /*
     * The retry path is the one that could plausibly be written to "give up"
     * and let the user in. It must not.
     */
    const onSuccess: MockedFunction<() => void> = jest.fn<() => void>();

    mockAuthenticateAsync.mockResolvedValue(FAILED);

    await renderLockScreen(onSuccess);
    await settleAuthentication();

    await pressUnlock();
    await settleAuthentication();

    expect(mockAuthenticateAsync).toHaveBeenCalledTimes(2);
    expect(onSuccess).not.toHaveBeenCalled();
  });
});
