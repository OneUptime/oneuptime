import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  getCriticalAlertSoundOption,
  getCriticalAlertVolume as toCriticalAlertVolume,
  type CriticalAlertSoundIdValue,
} from "../notifications/criticalAlertSounds";

const KEYS: {
  readonly BIOMETRIC_ENABLED: "oneuptime_biometric_enabled";
  readonly CRITICAL_ALERTS_ENABLED: "oneuptime_critical_alerts_enabled";
  readonly CRITICAL_ALERTS_REPORTED: "oneuptime_critical_alerts_reported";
  readonly CRITICAL_ALERT_SOUND: "oneuptime_critical_alert_sound";
  readonly CRITICAL_ALERT_VOLUME: "oneuptime_critical_alert_volume";
} = {
  BIOMETRIC_ENABLED: "oneuptime_biometric_enabled",
  CRITICAL_ALERTS_ENABLED: "oneuptime_critical_alerts_enabled",
  CRITICAL_ALERTS_REPORTED: "oneuptime_critical_alerts_reported",
  CRITICAL_ALERT_SOUND: "oneuptime_critical_alert_sound",
  CRITICAL_ALERT_VOLUME: "oneuptime_critical_alert_volume",
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

/*
 * What the server last took from this phone about its critical alerts
 * (notifications/criticalAlertsReport.ts): whether a critical page rings
 * through, for the push token it was told with. Kept so the phone tells the
 * server again only when that changes, not every time the app is opened.
 *
 * Absent - nothing told yet, or storage holding something this build cannot
 * read - means the server is told at the next chance.
 */
export interface CriticalAlertsReport {
  deviceToken: string;
  isEnabled: boolean;
}

export async function getCriticalAlertsReport(): Promise<CriticalAlertsReport | null> {
  const stored: string | null = await AsyncStorage.getItem(
    KEYS.CRITICAL_ALERTS_REPORTED,
  );

  if (!stored) {
    return null;
  }

  try {
    const report: unknown = JSON.parse(stored);

    if (
      report &&
      typeof report === "object" &&
      typeof (report as CriticalAlertsReport).deviceToken === "string" &&
      (report as CriticalAlertsReport).deviceToken &&
      typeof (report as CriticalAlertsReport).isEnabled === "boolean"
    ) {
      return {
        deviceToken: (report as CriticalAlertsReport).deviceToken,
        isEnabled: (report as CriticalAlertsReport).isEnabled,
      };
    }
  } catch {
    // Not one this build wrote: as good as nothing told.
  }

  return null;
}

export async function setCriticalAlertsReport(
  report: CriticalAlertsReport,
): Promise<void> {
  await AsyncStorage.setItem(
    KEYS.CRITICAL_ALERTS_REPORTED,
    JSON.stringify({
      deviceToken: report.deviceToken,
      isEnabled: report.isEnabled,
    }),
  );
}

// Forgets what the server was told. Storage is touched only when there is one.
export async function clearCriticalAlertsReport(): Promise<void> {
  if (await AsyncStorage.getItem(KEYS.CRITICAL_ALERTS_REPORTED)) {
    await AsyncStorage.removeItem(KEYS.CRITICAL_ALERTS_REPORTED);
  }
}

/*
 * The alarm this device's critical pages play, and on an iPhone how loud.
 * Like the toggle above, the server holds the choice that matters (it names
 * the sound in every critical page); this copy draws the setting before the
 * network answers and is restated on every registration, so a new project or
 * a new push token keeps the alarm the responder chose.
 *
 * Absent - or anything this build does not offer - means the system's own
 * sound at full volume, which is how every critical page played before there
 * was a choice.
 */
export async function getCriticalAlertSound(): Promise<CriticalAlertSoundIdValue> {
  const stored: string | null = await AsyncStorage.getItem(
    KEYS.CRITICAL_ALERT_SOUND,
  );
  return getCriticalAlertSoundOption(stored).id;
}

export async function setCriticalAlertSound(
  sound: CriticalAlertSoundIdValue,
): Promise<void> {
  await AsyncStorage.setItem(KEYS.CRITICAL_ALERT_SOUND, sound);
  await announceCriticalAlertSoundChoice();
}

export async function getCriticalAlertVolume(): Promise<number> {
  const stored: string | null = await AsyncStorage.getItem(
    KEYS.CRITICAL_ALERT_VOLUME,
  );
  return toCriticalAlertVolume(stored === null ? null : Number(stored));
}

export async function setCriticalAlertVolume(volume: number): Promise<void> {
  await AsyncStorage.setItem(KEYS.CRITICAL_ALERT_VOLUME, String(volume));
  await announceCriticalAlertSoundChoice();
}

export interface CriticalAlertSoundChoice {
  sound: CriticalAlertSoundIdValue;
  volume: number;
}

type CriticalAlertSoundChoiceListener = (
  choice: CriticalAlertSoundChoice,
) => void;

const criticalAlertSoundChoiceListeners: Set<CriticalAlertSoundChoiceListener> =
  new Set<CriticalAlertSoundChoiceListener>();

/*
 * Told whenever the stored alarm or volume changes, so a screen showing the
 * choice (the Settings row) follows a change made on another screen without
 * reading storage again on every visit.
 */
export function subscribeToCriticalAlertSoundChoice(
  listener: CriticalAlertSoundChoiceListener,
): () => void {
  criticalAlertSoundChoiceListeners.add(listener);

  return (): void => {
    criticalAlertSoundChoiceListeners.delete(listener);
  };
}

async function announceCriticalAlertSoundChoice(): Promise<void> {
  if (criticalAlertSoundChoiceListeners.size === 0) {
    return;
  }

  const choice: CriticalAlertSoundChoice = {
    sound: await getCriticalAlertSound(),
    volume: await getCriticalAlertVolume(),
  };

  for (const listener of Array.from(criticalAlertSoundChoiceListeners)) {
    listener(choice);
  }
}

export type AppearancePreference = "system" | "light" | "dark";

const APPEARANCE_KEY: string = "oneuptime_appearance";

/*
 * Absent - or anything this build does not recognise, such as a value written
 * by a newer version - means "follow the system", which is what a fresh
 * install does.
 */
export async function getAppearancePreference(): Promise<AppearancePreference> {
  const stored: string | null = await AsyncStorage.getItem(APPEARANCE_KEY);
  return stored === "light" || stored === "dark" ? stored : "system";
}

export async function setAppearancePreference(
  preference: AppearancePreference,
): Promise<void> {
  if (preference === "system") {
    await AsyncStorage.removeItem(APPEARANCE_KEY);
    return;
  }
  await AsyncStorage.setItem(APPEARANCE_KEY, preference);
}
