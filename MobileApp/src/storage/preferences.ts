import AsyncStorage from "@react-native-async-storage/async-storage";

const KEYS: {
  readonly BIOMETRIC_ENABLED: "oneuptime_biometric_enabled";
} = {
  BIOMETRIC_ENABLED: "oneuptime_biometric_enabled",
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
