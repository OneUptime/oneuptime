import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import {
  getCriticalAlertSoundOption,
  type CriticalAlertSoundIdValue,
  type CriticalAlertSoundOption,
} from "./criticalAlertSounds";
import logger from "../utils/logger";

/*
 * Play an alarm sound for the responder choosing one - as a notification,
 * the way a page plays it, rather than through a media player:
 *
 *   Android - posted on the sound's own critical channel, so it plays exactly
 *             as a page would: that channel's sound, on the alarm stream, at
 *             the alarm volume. A sound that does not play here would not
 *             play for a page either.
 *   iOS     - the bundled file, played by iOS's notification system. A local
 *             notification cannot be a critical alert, so the preview plays
 *             at the ringer volume and is silent while the iPhone is on
 *             silent; a real page rings through at the chosen volume.
 *
 * The notification says what it is, and carries no incident or alert, so
 * tapping it opens the app and goes nowhere (handlers.ts).
 */
export const PREVIEW_DATA_KEY: string = "criticalAlertSoundPreview";

export async function previewCriticalAlertSound(
  sound: CriticalAlertSoundIdValue,
): Promise<string> {
  const option: CriticalAlertSoundOption = getCriticalAlertSoundOption(sound);

  return Notifications.scheduleNotificationAsync({
    content: {
      title: `${option.title} - alarm sound preview`,
      body: "This is how a critical on-call page sounds on this phone.",
      sound: option.fileName ?? "default",
      data: { [PREVIEW_DATA_KEY]: option.id },
    },
    trigger: Platform.OS === "android" ? { channelId: option.channelId } : null,
  });
}

/*
 * Take a preview away, which stops its sound. Best effort: a preview that
 * already finished, or that the responder swiped away, is already gone.
 */
export async function stopCriticalAlertSoundPreview(
  identifier: string,
): Promise<void> {
  try {
    await Notifications.dismissNotificationAsync(identifier);
  } catch (error: unknown) {
    logger.warn(
      "[CriticalAlerts] Could not take the alarm sound preview away:",
      error,
    );
  }
}
