import AsyncStorage from "@react-native-async-storage/async-storage";
import * as LocalAuthentication from "expo-local-authentication";
import { renderHook, act, waitFor } from "@testing-library/react-native";
import { useBiometric } from "./useBiometric";
import { describe, expect, test, beforeEach } from "@jest/globals";

/*
 * The lock in front of the app. It is not protecting a diary - a handset left
 * on a desk is a handset that can acknowledge someone else's page, read every
 * incident in the account and change on-call state - so the two rules worth
 * pinning down are both about not lying to the responder:
 *
 *   - the setting is only OFFERED where it can actually work. Hardware without
 *     an enrolled face or finger cannot lock anything, and a switch that flips
 *     but never prompts is worse than no switch at all.
 *   - turning it ON requires passing the check FIRST. Otherwise anyone holding
 *     an unlocked phone could arm a lock against the owner's own face, and the
 *     owner would be the one shut out.
 *
 * expo-local-authentication is a native module with no JS implementation off
 * device, so it is mocked here - with the REAL AuthenticationType numbers,
 * because a fake whose FACIAL_RECOGNITION is `undefined` would make
 * `types.includes(...)` answer for the wrong reason.
 */
jest.mock("expo-local-authentication", () => {
  return {
    AuthenticationType: {
      FINGERPRINT: 1,
      FACIAL_RECOGNITION: 2,
      IRIS: 3,
    },
    hasHardwareAsync: jest.fn(async () => {
      return true;
    }),
    isEnrolledAsync: jest.fn(async () => {
      return true;
    }),
    supportedAuthenticationTypesAsync: jest.fn(async () => {
      return [];
    }),
    authenticateAsync: jest.fn(async () => {
      return { success: true };
    }),
  };
});

const BIOMETRIC_KEY: string = "oneuptime_biometric_enabled";

type BiometricState = ReturnType<typeof useBiometric>;

interface RenderedBiometric {
  result: { current: BiometricState };
}

function hasHardwareSpy(): jest.Mock {
  return LocalAuthentication.hasHardwareAsync as unknown as jest.Mock;
}

function isEnrolledSpy(): jest.Mock {
  return LocalAuthentication.isEnrolledAsync as unknown as jest.Mock;
}

function supportedTypesSpy(): jest.Mock {
  return LocalAuthentication.supportedAuthenticationTypesAsync as unknown as jest.Mock;
}

function authenticateSpy(): jest.Mock {
  return LocalAuthentication.authenticateAsync as unknown as jest.Mock;
}

/**
 * Mount the hook and wait for its whole start-up pass to land.
 *
 * The mount effect reads the stored preference LAST - after the hardware check,
 * the enrolment check and the type naming - so `isEnabled` arriving at the
 * seeded value is the one condition that proves every earlier step has already
 * been applied. Without that anchor a test asserting `isAvailable === false`
 * would pass against the hook's initial state, having raced the effect rather
 * than observed it. Seeding `true` is therefore the useful default: it forces a
 * state CHANGE to wait on rather than a value that was already there.
 *
 * renderHook is asynchronous in @testing-library/react-native v14 - it returns
 * a promise, so destructuring the call directly hands back undefined.
 */
async function renderBiometric(
  storedPreference: boolean,
): Promise<RenderedBiometric> {
  await AsyncStorage.setItem(BIOMETRIC_KEY, String(storedPreference));

  const rendered: RenderedBiometric = (await renderHook(() => {
    return useBiometric();
  })) as unknown as RenderedBiometric;

  await waitFor(() => {
    expect(AsyncStorage.getItem).toHaveBeenCalledWith(BIOMETRIC_KEY);
    expect(rendered.result.current.isEnabled).toBe(storedPreference);
  });

  return rendered;
}

beforeEach(async () => {
  await AsyncStorage.clear();
  hasHardwareSpy().mockResolvedValue(true as never);
  isEnrolledSpy().mockResolvedValue(true as never);
  supportedTypesSpy().mockResolvedValue([] as never);
  authenticateSpy().mockResolvedValue({ success: true } as never);
});

describe("useBiometric deciding whether the lock is usable at all", () => {
  test("is available on hardware with something enrolled", async () => {
    const { result } = await renderBiometric(true);

    expect(result.current.isAvailable).toBe(true);
  });

  test("is not available when the hardware is there but nothing is enrolled", async () => {
    /*
     * A phone with a Face ID sensor the owner never set up. The sensor exists,
     * so a check of hardware alone would offer the setting - and every prompt
     * would then fail with no face to match.
     */
    isEnrolledSpy().mockResolvedValue(false as never);

    const { result } = await renderBiometric(true);

    expect(result.current.isAvailable).toBe(false);
  });

  test("is not available when there is no sensor, however it was enrolled", async () => {
    hasHardwareSpy().mockResolvedValue(false as never);

    const { result } = await renderBiometric(true);

    expect(result.current.isAvailable).toBe(false);
  });

  test("is not available when there is neither hardware nor enrolment", async () => {
    hasHardwareSpy().mockResolvedValue(false as never);
    isEnrolledSpy().mockResolvedValue(false as never);

    const { result } = await renderBiometric(true);

    expect(result.current.isAvailable).toBe(false);
  });

  test("consults BOTH native checks rather than trusting one of them", async () => {
    /*
     * They answer different questions - "is there a sensor" and "has anyone
     * enrolled on it" - and a handset can pass either one alone. Skipping the
     * second is exactly how a switch gets offered that can never succeed.
     */
    await renderBiometric(true);

    expect(hasHardwareSpy()).toHaveBeenCalledTimes(1);
    expect(isEnrolledSpy()).toHaveBeenCalledTimes(1);
  });
});

describe("useBiometric naming the check the responder will see", () => {
  test("calls it Face ID when the handset does facial recognition", async () => {
    supportedTypesSpy().mockResolvedValue([
      LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION,
    ] as never);

    const { result } = await renderBiometric(false);

    await waitFor(() => {
      expect(result.current.biometricType).toBe("Face ID");
    });
  });

  test("calls it Fingerprint when the handset does fingerprints", async () => {
    supportedTypesSpy().mockResolvedValue([
      LocalAuthentication.AuthenticationType.FINGERPRINT,
    ] as never);

    const { result } = await renderBiometric(false);

    await waitFor(() => {
      expect(result.current.biometricType).toBe("Fingerprint");
    });
  });

  test("prefers Face ID on a handset that reports both", async () => {
    /*
     * Several Android handsets report a fingerprint reader alongside face
     * unlock. Naming has to be deterministic, or the settings row would read
     * differently between two phones of the same model.
     */
    supportedTypesSpy().mockResolvedValue([
      LocalAuthentication.AuthenticationType.FINGERPRINT,
      LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION,
    ] as never);

    const { result } = await renderBiometric(false);

    await waitFor(() => {
      expect(result.current.biometricType).toBe("Face ID");
    });
  });

  test("falls back to the generic word for a check it has no name for", async () => {
    /*
     * Iris scanners are Android-only and rare. There is no wording for them
     * here, and inventing one would be worse than the neutral term.
     */
    supportedTypesSpy().mockResolvedValue([
      LocalAuthentication.AuthenticationType.IRIS,
    ] as never);

    const { result } = await renderBiometric(true);

    expect(result.current.biometricType).toBe("Biometrics");
  });

  test("falls back to the generic word when the OS lists nothing", async () => {
    supportedTypesSpy().mockResolvedValue([] as never);

    const { result } = await renderBiometric(true);

    expect(result.current.biometricType).toBe("Biometrics");
  });

  test("names the check even when nothing is enrolled yet", async () => {
    /*
     * Unavailable but nameable. The settings copy can then tell the responder
     * WHICH thing they have to set up in the OS, rather than pointing them at
     * "Biometrics" and leaving them to find it.
     */
    isEnrolledSpy().mockResolvedValue(false as never);
    supportedTypesSpy().mockResolvedValue([
      LocalAuthentication.AuthenticationType.FACIAL_RECOGNITION,
    ] as never);

    const { result } = await renderBiometric(false);

    await waitFor(() => {
      expect(result.current.biometricType).toBe("Face ID");
    });
    expect(result.current.isAvailable).toBe(false);
  });

  test("does not ask what the sensor is when there is no sensor", async () => {
    hasHardwareSpy().mockResolvedValue(false as never);

    const { result } = await renderBiometric(true);

    expect(supportedTypesSpy()).not.toHaveBeenCalled();
    expect(result.current.biometricType).toBe("Biometrics");
  });
});

describe("useBiometric reading the stored preference on mount", () => {
  test("comes up on for a responder who had already turned it on", async () => {
    /*
     * This is what RootNavigator gates the app behind. If it came up off, the
     * lock would simply not happen on the launch after it was armed.
     */
    const { result } = await renderBiometric(true);

    expect(result.current.isEnabled).toBe(true);
  });

  test("comes up off for a device that has never been asked", async () => {
    const rendered: RenderedBiometric = (await renderHook(() => {
      return useBiometric();
    })) as unknown as RenderedBiometric;

    await waitFor(() => {
      expect(AsyncStorage.getItem).toHaveBeenCalledWith(BIOMETRIC_KEY);
    });

    expect(rendered.result.current.isEnabled).toBe(false);
  });

  test("comes up off when the stored value is anything but the exact word true", async () => {
    /*
     * A half-written value, or a key an older build used differently, resolves
     * to off. Failing open on an unrecognised value is the safe direction: the
     * responder is asked to arm the lock again rather than being locked out by
     * a check the app cannot honour.
     */
    await AsyncStorage.setItem(BIOMETRIC_KEY, "yes");

    const rendered: RenderedBiometric = (await renderHook(() => {
      return useBiometric();
    })) as unknown as RenderedBiometric;

    await waitFor(() => {
      expect(AsyncStorage.getItem).toHaveBeenCalledWith(BIOMETRIC_KEY);
    });

    expect(rendered.result.current.isEnabled).toBe(false);
  });

  test("reports the preference even on a handset that cannot honour it", async () => {
    /*
     * A responder who armed the lock and then removed their fingerprints. The
     * stored choice is still theirs; it is `isAvailable` that has changed, and
     * the screen needs both facts to explain what happened.
     */
    hasHardwareSpy().mockResolvedValue(false as never);

    const { result } = await renderBiometric(true);

    expect(result.current.isEnabled).toBe(true);
    expect(result.current.isAvailable).toBe(false);
  });
});

describe("useBiometric authenticate()", () => {
  test("reports success when the OS says the check passed", async () => {
    authenticateSpy().mockResolvedValue({ success: true } as never);

    const { result } = await renderBiometric(true);

    await expect(result.current.authenticate()).resolves.toBe(true);
  });

  test("reports failure when the OS says the check did not pass", async () => {
    /*
     * The unlock screen keeps the app locked on false. Anything other than an
     * explicit success has to come back false, or a cancelled prompt would let
     * a stranger straight in.
     */
    authenticateSpy().mockResolvedValue({
      success: false,
      error: "user_cancel",
    } as never);

    const { result } = await renderBiometric(true);

    await expect(result.current.authenticate()).resolves.toBe(false);
  });

  test("prompts with wording that names the app being unlocked", async () => {
    /*
     * The system sheet is chrome-less. Without the app named in the prompt, a
     * responder cannot tell which app just asked for their face.
     */
    const { result } = await renderBiometric(true);

    await result.current.authenticate();

    expect(authenticateSpy()).toHaveBeenCalledWith(
      expect.objectContaining({
        promptMessage: expect.stringContaining("OneUptime"),
      }),
    );
  });

  test("leaves the device passcode available as a fallback", async () => {
    /*
     * A wet finger or a mask defeats the sensor. Disabling the fallback would
     * lock a responder out of their own pages with no way back in.
     */
    const { result } = await renderBiometric(true);

    await result.current.authenticate();

    expect(authenticateSpy()).toHaveBeenCalledWith(
      expect.objectContaining({ disableDeviceFallback: false }),
    );
  });

  test("does not change the stored preference either way", async () => {
    /*
     * Unlocking is not the same act as arming. A failed unlock must not quietly
     * disarm the lock, which would leave the app open on the next launch.
     */
    authenticateSpy().mockResolvedValue({ success: false } as never);

    const { result } = await renderBiometric(true);

    await result.current.authenticate();

    expect(result.current.isEnabled).toBe(true);
    expect(await AsyncStorage.getItem(BIOMETRIC_KEY)).toBe("true");
  });

  test("can be retried after a failure", async () => {
    authenticateSpy()
      .mockResolvedValueOnce({ success: false } as never)
      .mockResolvedValueOnce({ success: true } as never);

    const { result } = await renderBiometric(true);

    await expect(result.current.authenticate()).resolves.toBe(false);
    await expect(result.current.authenticate()).resolves.toBe(true);
  });
});

describe("useBiometric arming the lock", () => {
  test("asks for the check before turning it on", async () => {
    /*
     * The whole point of the confirmation. Arming without it lets whoever is
     * holding the unlocked phone lock the owner out behind their own face.
     */
    const { result } = await renderBiometric(false);

    await act(async (): Promise<void> => {
      await result.current.setEnabled(true);
    });

    expect(authenticateSpy()).toHaveBeenCalledTimes(1);
  });

  test("stores the choice once the check passes", async () => {
    const { result } = await renderBiometric(false);

    await act(async (): Promise<void> => {
      await result.current.setEnabled(true);
    });

    expect(await AsyncStorage.getItem(BIOMETRIC_KEY)).toBe("true");
  });

  test("the switch reads as on afterwards", async () => {
    const { result } = await renderBiometric(false);

    await act(async (): Promise<void> => {
      await result.current.setEnabled(true);
    });

    expect(result.current.isEnabled).toBe(true);
  });

  test("a failed check does not store the choice", async () => {
    /*
     * The regression that matters most. Persisting on a failed confirmation
     * arms the lock on the next launch for someone who never proved they can
     * open it.
     */
    authenticateSpy().mockResolvedValue({
      success: false,
      error: "user_cancel",
    } as never);

    const { result } = await renderBiometric(false);

    await act(async (): Promise<void> => {
      await result.current.setEnabled(true);
    });

    expect(await AsyncStorage.getItem(BIOMETRIC_KEY)).toBe("false");
  });

  test("a failed check leaves the switch reading as off", async () => {
    authenticateSpy().mockResolvedValue({ success: false } as never);

    const { result } = await renderBiometric(false);

    await act(async (): Promise<void> => {
      await result.current.setEnabled(true);
    });

    expect(result.current.isEnabled).toBe(false);
  });

  test("a cancelled attempt can be followed by a successful one", async () => {
    /*
     * A responder whose first prompt timed out presses the switch again. The
     * hook holds no state from the refusal that could block the retry.
     */
    authenticateSpy()
      .mockResolvedValueOnce({ success: false } as never)
      .mockResolvedValueOnce({ success: true } as never);

    const { result } = await renderBiometric(false);

    await act(async (): Promise<void> => {
      await result.current.setEnabled(true);
    });
    await act(async (): Promise<void> => {
      await result.current.setEnabled(true);
    });

    expect(result.current.isEnabled).toBe(true);
    expect(await AsyncStorage.getItem(BIOMETRIC_KEY)).toBe("true");
  });

  test("prompts with wording about enabling, not about unlocking", async () => {
    /*
     * Same system sheet, different reason for it. A responder being asked to
     * confirm a setting should not be told the app is being unlocked.
     */
    const { result } = await renderBiometric(false);

    await act(async (): Promise<void> => {
      await result.current.setEnabled(true);
    });

    expect(authenticateSpy()).toHaveBeenCalledWith(
      expect.objectContaining({
        promptMessage: expect.stringContaining("enable"),
        disableDeviceFallback: false,
      }),
    );
  });
});

describe("useBiometric disarming the lock", () => {
  test("does not demand a check to turn it off", async () => {
    /*
     * Deliberately asymmetric. The responder is already past the lock - the app
     * is open - so requiring a second check to switch it off only adds a way to
     * get stuck behind a sensor that has stopped recognising them.
     */
    const { result } = await renderBiometric(true);

    await act(async (): Promise<void> => {
      await result.current.setEnabled(false);
    });

    expect(authenticateSpy()).not.toHaveBeenCalled();
  });

  test("stores the choice", async () => {
    const { result } = await renderBiometric(true);

    await act(async (): Promise<void> => {
      await result.current.setEnabled(false);
    });

    expect(await AsyncStorage.getItem(BIOMETRIC_KEY)).toBe("false");
  });

  test("the switch reads as off afterwards", async () => {
    const { result } = await renderBiometric(true);

    await act(async (): Promise<void> => {
      await result.current.setEnabled(false);
    });

    expect(result.current.isEnabled).toBe(false);
  });

  test("turns off even on a handset whose sensor has stopped working", async () => {
    /*
     * The way out of being locked out. If disarming needed the sensor, a
     * responder whose face no longer matches could never clear the setting.
     */
    hasHardwareSpy().mockResolvedValue(false as never);
    authenticateSpy().mockResolvedValue({ success: false } as never);

    const { result } = await renderBiometric(true);

    await act(async (): Promise<void> => {
      await result.current.setEnabled(false);
    });

    expect(result.current.isEnabled).toBe(false);
    expect(await AsyncStorage.getItem(BIOMETRIC_KEY)).toBe("false");
  });

  test("switching off and back on asks for the check exactly once", async () => {
    const { result } = await renderBiometric(true);

    await act(async (): Promise<void> => {
      await result.current.setEnabled(false);
    });
    await act(async (): Promise<void> => {
      await result.current.setEnabled(true);
    });

    expect(authenticateSpy()).toHaveBeenCalledTimes(1);
    expect(result.current.isEnabled).toBe(true);
  });
});
