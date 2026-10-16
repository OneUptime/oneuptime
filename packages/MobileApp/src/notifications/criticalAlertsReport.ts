import AsyncStorage from "@react-native-async-storage/async-storage";
import { Platform } from "react-native";
import {
  CriticalAlertAvailability,
  type CriticalAlertStatus,
  getCriticalAlertStatus,
} from "./criticalAlerts";
import type { CriticalAlertSoundIdValue } from "./criticalAlertSounds";
import {
  type CriticalAlertsReport,
  clearCriticalAlertsReport,
  getCriticalAlertSound,
  getCriticalAlertsEnabled,
  getCriticalAlertsReport,
  setCriticalAlertsEnabled as storeCriticalAlertsEnabled,
  setCriticalAlertsReport,
} from "../storage/preferences";
import { setCriticalAlertsEnabledOnServer } from "../api/pushDevice";
import { PUSH_TOKEN_KEY } from "../hooks/pushTokenUtils";
import logger from "../utils/logger";

/*
 * What the server is told about this phone's critical alerts, and when.
 *
 * The server decides whether an on-call page goes out as a critical alert
 * (UserPush.isCriticalAlertEnabled), and the Dashboard's device list and its
 * test notification say what it holds. So it is told what this phone will
 * really do with a critical page: ring through silent mode and Do Not
 * Disturb only while the responder has Critical On-Call Alerts on in the app
 * AND the phone's system allows it for the chosen alarm - which is also what
 * the Settings screen's switch shows (useCriticalAlerts).
 *
 * It used to be told only the switch, and only when the responder moved it.
 * Critical alerts turned off in iOS Settings, or Do Not Disturb access taken
 * away on Android, turned the switch off on the phone and nothing else: the
 * Dashboard went on saying "On", and a test sent from it claimed to ring
 * through silent mode while the phone showed an ordinary notification.
 *
 * Now the server is told when the switch moves (saveCriticalAlertsChoice),
 * in every registration (usePushNotifications), and whenever the app starts
 * or comes back to the foreground and what the phone will do has changed
 * since the server was last told (reportCriticalAlerts).
 */

export interface CriticalAlertsReading {
  // The switch as the responder last saved it, whatever the OS says now.
  isChosen: boolean;
  // What the OS allows now, for the alarm the responder chose.
  status: CriticalAlertStatus;
  // Whether a critical page rings through: chosen AND allowed.
  isEffective: boolean;
}

export function isCriticalAlertsEffective(data: {
  isChosen: boolean;
  availability: CriticalAlertAvailability;
}): boolean {
  return (
    data.isChosen && data.availability === CriticalAlertAvailability.Granted
  );
}

/*
 * The responder's choice and the OS's answer, read now. On Android the alarm
 * the responder chose decides which channel has to ring through Do Not
 * Disturb, so it is read first.
 */
export async function readCriticalAlerts(): Promise<CriticalAlertsReading> {
  const sound: CriticalAlertSoundIdValue = await getCriticalAlertSound();

  const [status, isChosen]: [CriticalAlertStatus, boolean] = await Promise.all([
    getCriticalAlertStatus({ sound: sound }),
    getCriticalAlertsEnabled(),
  ]);

  return {
    isChosen: isChosen,
    status: status,
    isEffective: isCriticalAlertsEffective({
      isChosen: isChosen,
      availability: status.availability,
    }),
  };
}

/*
 * What the server says, word for word, about a push token it has no device
 * for (UserPushService): nothing has been registered with it yet, or the
 * device was removed in the Dashboard. The phone's next registration makes
 * the device, with what the phone will do.
 */
export const NO_REGISTERED_DEVICE_MESSAGE: string =
  "No registered device was found for this device token.";

export function isNoRegisteredDeviceError(error: unknown): boolean {
  const response: { status?: unknown; data?: { message?: unknown } } =
    (error as { response?: { status?: unknown; data?: { message?: unknown } } })
      ?.response || {};

  return (
    response.status === 400 &&
    response.data?.message === NO_REGISTERED_DEVICE_MESSAGE
  );
}

/*
 * One change to what the server holds at a time, in the order they were
 * asked for. A report reads what the phone will do only when its turn comes,
 * so one that was waiting behind the responder's switch never tells the
 * server the state from before it - which would leave the switch on and the
 * server off. A failed task does not stop the ones after it.
 */
let lastInOrder: Promise<unknown> = Promise.resolve();

export function inCriticalAlertsOrder<T>(task: () => Promise<T>): Promise<T> {
  const run: Promise<T> = lastInOrder.then(task);

  lastInOrder = run.catch((): void => {
    // Reported by whoever asked; the next task runs regardless.
  });

  return run;
}

export enum CriticalAlertsReportOutcome {
  // The server took what the phone will do.
  Reported = "reported",
  // The server was last told the same, for this token: nothing to say.
  AlreadyReported = "already-reported",
  // No push token yet: the registration that gets one tells the server.
  NoPushToken = "no-push-token",
  // The server has no device for this token: registering makes one.
  NotRegistered = "not-registered",
  // The request failed. The next chance - a start, a return - tries again.
  Failed = "failed",
  // The web build: no phone, and nothing to report.
  NotApplicable = "not-applicable",
}

export interface ReportCriticalAlertsOptions {
  /*
   * Tell the server even when it was last told the same: after a
   * registration an older server may not have applied to the devices the
   * phone already had.
   */
  force?: boolean | undefined;
  /*
   * What the server said every device of this phone holds, when a
   * registration has just told each project: if that is still what the
   * phone will do, there is nothing to tell it, only to note.
   */
  serverHolds?: boolean | undefined;
}

/*
 * Tell the server what this phone will do with a critical page, when that is
 * not what it was last told: on coming back to the app, after every
 * registration, and on the Settings screen's every look at the OS.
 *
 * Never throws: it runs on its own, with nobody to show a failure to, and a
 * failure leaves the record of what the server holds as it was, so the next
 * chance tries again.
 */
export async function reportCriticalAlerts(
  options: ReportCriticalAlertsOptions = {},
): Promise<CriticalAlertsReportOutcome> {
  if (Platform.OS === "web") {
    return CriticalAlertsReportOutcome.NotApplicable;
  }

  return inCriticalAlertsOrder(
    async (): Promise<CriticalAlertsReportOutcome> => {
      try {
        const deviceToken: string | null =
          await AsyncStorage.getItem(PUSH_TOKEN_KEY);

        if (!deviceToken) {
          return CriticalAlertsReportOutcome.NoPushToken;
        }

        const isEnabled: boolean = (await readCriticalAlerts()).isEffective;

        if (options.serverHolds === isEnabled) {
          await setCriticalAlertsReport({
            deviceToken: deviceToken,
            isEnabled: isEnabled,
          });

          return CriticalAlertsReportOutcome.AlreadyReported;
        }

        if (!options.force && options.serverHolds === undefined) {
          const last: CriticalAlertsReport | null =
            await getCriticalAlertsReport();

          if (
            last &&
            last.deviceToken === deviceToken &&
            last.isEnabled === isEnabled
          ) {
            return CriticalAlertsReportOutcome.AlreadyReported;
          }
        }

        try {
          await setCriticalAlertsEnabledOnServer({
            deviceToken: deviceToken,
            isEnabled: isEnabled,
          });
        } catch (error: unknown) {
          if (isNoRegisteredDeviceError(error)) {
            await clearCriticalAlertsReport();
            return CriticalAlertsReportOutcome.NotRegistered;
          }

          throw error;
        }

        await setCriticalAlertsReport({
          deviceToken: deviceToken,
          isEnabled: isEnabled,
        });

        return CriticalAlertsReportOutcome.Reported;
      } catch (error: unknown) {
        logger.warn(
          "[CriticalAlerts] Could not tell the server what this phone does with critical pages; it is told again next time:",
          error,
        );

        return CriticalAlertsReportOutcome.Failed;
      }
    },
  );
}

export enum CriticalAlertsChoiceOutcome {
  // The server took it, and the phone keeps it.
  Saved = "saved",
  /*
   * Off, kept on the phone alone: the server has no device for this phone
   * to turn off - no push token yet, or none registered with it - and the
   * registration that makes one carries it.
   */
  SavedOnThisPhone = "saved-on-this-phone",
  // On, but the server has no device for this phone to turn it on for.
  NotRegistered = "not-registered",
}

/*
 * The responder moved the switch: the server is told first, and the phone
 * keeps the choice only once the server took it. The phone's copy is what
 * every registration restates, so keeping an "on" the server never heard
 * would go on telling the server something the responder was told had
 * failed.
 *
 * Turning it off is kept on the phone even when there is no device on the
 * server to turn off: nothing there disagrees, and the registration that
 * makes the device says off. Any other failure is thrown, for the switch to
 * go back to what is still in force.
 */
export async function saveCriticalAlertsChoice(
  isEnabled: boolean,
): Promise<CriticalAlertsChoiceOutcome> {
  return inCriticalAlertsOrder(
    async (): Promise<CriticalAlertsChoiceOutcome> => {
      const deviceToken: string | null =
        await AsyncStorage.getItem(PUSH_TOKEN_KEY);

      if (!deviceToken) {
        if (isEnabled) {
          return CriticalAlertsChoiceOutcome.NotRegistered;
        }

        await storeCriticalAlertsEnabled(false);
        return CriticalAlertsChoiceOutcome.SavedOnThisPhone;
      }

      try {
        await setCriticalAlertsEnabledOnServer({
          deviceToken: deviceToken,
          isEnabled: isEnabled,
        });
      } catch (error: unknown) {
        if (!isNoRegisteredDeviceError(error)) {
          throw error;
        }

        await clearCriticalAlertsReport();

        if (isEnabled) {
          return CriticalAlertsChoiceOutcome.NotRegistered;
        }

        await storeCriticalAlertsEnabled(false);
        return CriticalAlertsChoiceOutcome.SavedOnThisPhone;
      }

      await storeCriticalAlertsEnabled(isEnabled);
      await setCriticalAlertsReport({
        deviceToken: deviceToken,
        isEnabled: isEnabled,
      });

      return CriticalAlertsChoiceOutcome.Saved;
    },
  );
}
