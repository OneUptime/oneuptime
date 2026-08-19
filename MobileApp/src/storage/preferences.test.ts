import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  getBiometricEnabled,
  getCriticalAlertsEnabled,
  setBiometricEnabled,
  setCriticalAlertsEnabled,
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
