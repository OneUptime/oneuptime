import AsyncStorage from "@react-native-async-storage/async-storage";

const KEYS: {
  readonly BIOMETRIC_ENABLED: "oneuptime_biometric_enabled";
  readonly CRITICAL_ALERTS_ENABLED: "oneuptime_critical_alerts_enabled";
} = {
  BIOMETRIC_ENABLED: "oneuptime_biometric_enabled",
  CRITICAL_ALERTS_ENABLED: "oneuptime_critical_alerts_enabled",
} as const;

export async function getBiometricEnabled(): Promise<boolean> {
  const stored: string | null = await AsyncStorage.getItem(
    KEYS.BIOMETRIC_ENABLED,
  );
  return stored === "true";
}

export async function setBiometricEnabled(enabled: boolean): Promise<void> {
  await AsyncStorage.setItem(KEYS.BIOMETRIC_ENABLED, String(enabled));
}

/*
 * The server is the authority on whether a page goes out as a critical alert -
 * it is what stamps the flag onto the payload. This local copy exists so the
 * toggle can be rendered before the network answers, and so re-registration
 * (a new push token, a project the responder just joined) can restate the
 * choice instead of silently dropping back to off.
 *
 * Absent means off. A device that has never been asked has not opted in.
 */
export async function getCriticalAlertsEnabled(): Promise<boolean> {
  const stored: string | null = await AsyncStorage.getItem(
    KEYS.CRITICAL_ALERTS_ENABLED,
  );
  return stored === "true";
}

export async function setCriticalAlertsEnabled(
  enabled: boolean,
): Promise<void> {
  await AsyncStorage.setItem(KEYS.CRITICAL_ALERTS_ENABLED, String(enabled));
}
