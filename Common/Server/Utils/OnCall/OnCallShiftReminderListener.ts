import logger from "../Logger";
import OnCallShiftChangeListeners, {
  OnCallShiftChangeEvent,
} from "./OnCallShiftChangeListeners";
import OnCallShiftReminderRunner, {
  SHIFT_REMINDER_LISTENER_NAME,
} from "./OnCallShiftReminderRunner";

/*
 * Wires the shift-reminder change pass into the on-call configuration hooks.
 *
 * Importing this module is load-bearing: it registers the listener with
 * OnCallShiftChangeListeners as a side effect, the same way a RunCron job
 * file registers itself. The hooks run in whichever process handles the
 * CRUD request — the API tier for a dashboard edit, the worker for a
 * background cleanup — so BOTH App/Index.ts and App/FeatureSet/Workers/
 * Index.ts import it (registration is idempotent by name, so a double import
 * never stacks a second listener).
 *
 * Delivery is best-effort by construction: the hooks do not await notify,
 * notify never rejects, and the listener catches everything itself, so a
 * failed change pass can neither fail nor delay the edit that triggered it.
 */

export type OnCallShiftReminderListenerFunction = (
  event: OnCallShiftChangeEvent,
) => Promise<void>;

export const onCallShiftReminderListener: OnCallShiftReminderListenerFunction =
  async (event: OnCallShiftChangeEvent): Promise<void> => {
    try {
      await OnCallShiftReminderRunner.runChangePass(event);
    } catch (err) {
      logger.error(
        `${SHIFT_REMINDER_LISTENER_NAME}: change pass threw (best-effort, ignored).`,
      );
      logger.error(err);
    }
  };

export function registerOnCallShiftReminderListener(): void {
  OnCallShiftChangeListeners.register(
    onCallShiftReminderListener,
    SHIFT_REMINDER_LISTENER_NAME,
  );
}

registerOnCallShiftReminderListener();

export default registerOnCallShiftReminderListener;
