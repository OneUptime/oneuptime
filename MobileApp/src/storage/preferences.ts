import AsyncStorage from "@react-native-async-storage/async-storage";
import type { ThemeMode } from "../theme";

const KEYS: {
  readonly THEME_MODE: "oneuptime_theme_mode";
  readonly BIOMETRIC_ENABLED: "oneuptime_biometric_enabled";
  readonly NOTIFICATION_PREFS: "oneuptime_notification_prefs";
} = {
  THEME_MODE: "oneuptime_theme_mode",
  BIOMETRIC_ENABLED: "oneuptime_biometric_enabled",
  NOTIFICATION_PREFS: "oneuptime_notification_prefs",
} as const;

export interface NotificationPreferences {
  incidents: boolean;
  alerts: boolean;
  incidentEpisodes: boolean;
  alertEpisodes: boolean;
  criticalOnly: boolean;
}

const DEFAULT_NOTIFICATION_PREFS: NotificationPreferences = {
  incidents: true,
  alerts: true,
  incidentEpisodes: true,
  alertEpisodes: true,
  criticalOnly: false,
};

export async function getThemeMode(): Promise<ThemeMode> {
  const stored: string | null = await AsyncStorage.getItem(KEYS.THEME_MODE);
  if (stored === "dark" || stored === "light" || stored === "system") {
    return stored;
  }
  return "dark";
}

export async function setThemeMode(mode: ThemeMode): Promise<void> {
  await AsyncStorage.setItem(KEYS.THEME_MODE, mode);
}

export async function getBiometricEnabled(): Promise<boolean> {
  const stored: string | null = await AsyncStorage.getItem(
    KEYS.BIOMETRIC_ENABLED,
  );
  return stored === "true";
}

export async function setBiometricEnabled(enabled: boolean): Promise<void> {
  await AsyncStorage.setItem(KEYS.BIOMETRIC_ENABLED, String(enabled));
}

export async function getNotificationPreferences(): Promise<NotificationPreferences> {
  const stored: string | null = await AsyncStorage.getItem(
    KEYS.NOTIFICATION_PREFS,
  );
  if (stored) {
    try {
      return { ...DEFAULT_NOTIFICATION_PREFS, ...JSON.parse(stored) };
    } catch {
      return DEFAULT_NOTIFICATION_PREFS;
    }
  }
  return DEFAULT_NOTIFICATION_PREFS;
}

export async function setNotificationPreferences(
  prefs: NotificationPreferences,
): Promise<void> {
  await AsyncStorage.setItem(KEYS.NOTIFICATION_PREFS, JSON.stringify(prefs));
}
