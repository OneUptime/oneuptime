import { useEffect, useState } from "react";
import {
  getCriticalAlertSound,
  getCriticalAlertVolume,
  subscribeToCriticalAlertSoundChoice,
  type CriticalAlertSoundChoice,
} from "../storage/preferences";
import type { CriticalAlertSoundIdValue } from "../notifications/criticalAlertSounds";
import logger from "../utils/logger";

/*
 * The alarm and volume this phone's critical pages play, as stored on the
 * phone, kept current as they change - for showing the choice, not making it
 * (useCriticalAlertSound makes it). Null until storage has answered.
 */
export function useCriticalAlertSoundChoice(): CriticalAlertSoundChoice | null {
  const [choice, setChoice] = useState<CriticalAlertSoundChoice | null>(null);

  useEffect((): (() => void) => {
    let isActive: boolean = true;

    const unsubscribe: () => void = subscribeToCriticalAlertSoundChoice(
      (next: CriticalAlertSoundChoice): void => {
        if (isActive) {
          setChoice(next);
        }
      },
    );

    Promise.all([getCriticalAlertSound(), getCriticalAlertVolume()])
      .then(([sound, volume]: [CriticalAlertSoundIdValue, number]): void => {
        if (isActive) {
          setChoice((current: CriticalAlertSoundChoice | null) => {
            // A change announced while storage was being read is newer.
            return current ?? { sound: sound, volume: volume };
          });
        }
      })
      .catch((error: unknown): void => {
        logger.warn(
          "[CriticalAlerts] Could not read the alarm sound settings:",
          error,
        );
      });

    return (): void => {
      isActive = false;
      unsubscribe();
    };
  }, []);

  return choice;
}
