import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  getAppearancePreference,
  getBiometricEnabled,
  getCriticalAlertsEnabled,
  setAppearancePreference,
  setBiometricEnabled,
  setCriticalAlertsEnabled,
  type AppearancePreference,
} from "./preferences";
import { describe, expect, test, beforeEach } from "@jest/globals";

/*
 * The stored copy of the responder's choice. It is not the authority - the
 * server decides whether a page goes out critical - but it is what the app
 * replays on re-registration, so "absent means off" has to hold exactly.
 */

describe("getCriticalAlertsEnabled", () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  test("a device that has never been asked has not opted in", async () => {
    expect(await getCriticalAlertsEnabled()).toBe(false);
  });

  test("round-trips an opt-in", async () => {
    await setCriticalAlertsEnabled(true);

    expect(await getCriticalAlertsEnabled()).toBe(true);
  });

  test("round-trips an opt-out", async () => {
    await setCriticalAlertsEnabled(true);
    await setCriticalAlertsEnabled(false);

    expect(await getCriticalAlertsEnabled()).toBe(false);
  });

  test('only the exact string "true" counts as opted in', async () => {
    /*
     * Anything else in that slot - a half-written value, a key another build
     * used differently - resolves to off rather than to "loud".
     */
    await AsyncStorage.setItem("oneuptime_critical_alerts_enabled", "yes");

    expect(await getCriticalAlertsEnabled()).toBe(false);
  });

  test("stores under its own key, distinct from the biometric preference", async () => {
    await setCriticalAlertsEnabled(true);

    expect(
      await AsyncStorage.getItem("oneuptime_critical_alerts_enabled"),
    ).toBe("true");
  });

  test("does not disturb the biometric preference", async () => {
    await setBiometricEnabled(true);
    await setCriticalAlertsEnabled(false);

    expect(await getBiometricEnabled()).toBe(true);
    expect(await getCriticalAlertsEnabled()).toBe(false);
  });

  test("the biometric preference does not disturb this one", async () => {
    await setCriticalAlertsEnabled(true);
    await setBiometricEnabled(false);

    expect(await getCriticalAlertsEnabled()).toBe(true);
  });
});

/*
 * Settings -> Appearance. Absent means "follow the device", and so does any
 * value this build does not recognise, so a newer build's value (or a
 * half-written one) can never strand someone on a palette they did not pick.
 */
describe("appearance preference", () => {
  const KEY: string = "oneuptime_appearance";

  beforeEach(async () => {
    await AsyncStorage.clear();
  });

  test("a fresh install follows the system", async () => {
    expect(await getAppearancePreference()).toBe("system");
  });

  test.each(["light", "dark"] as Array<AppearancePreference>)(
    "round-trips an explicit %s choice under its own key",
    async (preference: AppearancePreference) => {
      await setAppearancePreference(preference);

      expect(await getAppearancePreference()).toBe(preference);
      expect(await AsyncStorage.getItem(KEY)).toBe(preference);
    },
  );

  test("the last explicit choice wins", async () => {
    await setAppearancePreference("dark");
    await setAppearancePreference("light");

    expect(await getAppearancePreference()).toBe("light");
  });

  test('choosing "system" removes the stored value instead of saving it', async () => {
    await setAppearancePreference("dark");
    await setAppearancePreference("system");

    expect(await AsyncStorage.getItem(KEY)).toBeNull();
    expect(AsyncStorage.removeItem).toHaveBeenCalledWith(KEY);
    expect(AsyncStorage.setItem).not.toHaveBeenCalledWith(KEY, "system");
    expect(await getAppearancePreference()).toBe("system");
  });

  test('choosing "system" with nothing stored is harmless', async () => {
    await setAppearancePreference("system");

    expect(await getAppearancePreference()).toBe("system");
  });

  test.each(["sepia", "Dark", "LIGHT", "", "true", "system", " dark"])(
    "an unrecognised stored value %p is read as system",
    async (stored: string) => {
      await AsyncStorage.setItem(KEY, stored);

      expect(await getAppearancePreference()).toBe("system");
    },
  );

  test("does not disturb the other preferences", async () => {
    await setBiometricEnabled(true);
    await setCriticalAlertsEnabled(true);
    await setAppearancePreference("dark");
    await setAppearancePreference("system");

    expect(await getBiometricEnabled()).toBe(true);
    expect(await getCriticalAlertsEnabled()).toBe(true);
  });

  test("the other preferences do not disturb it", async () => {
    await setAppearancePreference("light");
    await setBiometricEnabled(false);
    await setCriticalAlertsEnabled(false);

    expect(await getAppearancePreference()).toBe("light");
  });
});
