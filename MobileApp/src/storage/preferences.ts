import AsyncStorage from "@react-native-async-storage/async-storage";
import type { ThemeMode } from "../theme";

const KEYS = {
  THEME_MODE: "oneuptime_theme_mode",
  BIOMETRIC_ENABLED: "oneuptime_biometric_enabled",
} as const;

export async function getThemeMode(): Promise<ThemeMode> {
  const stored = await AsyncStorage.getItem(KEYS.THEME_MODE);
  if (stored === "dark" || stored === "light" || stored === "system") {
    return stored;
  }
  return "dark";
}

export async function setThemeMode(mode: ThemeMode): Promise<void> {
  await AsyncStorage.setItem(KEYS.THEME_MODE, mode);
}

export async function getBiometricEnabled(): Promise<boolean> {
  const stored = await AsyncStorage.getItem(KEYS.BIOMETRIC_ENABLED);
  return stored === "true";
}

export async function setBiometricEnabled(enabled: boolean): Promise<void> {
  await AsyncStorage.setItem(KEYS.BIOMETRIC_ENABLED, String(enabled));
}
