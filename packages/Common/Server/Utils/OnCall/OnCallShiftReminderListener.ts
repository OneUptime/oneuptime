import ObjectID from "../../../Types/ObjectID";
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
 *
 * COALESCING. A change pass re-materializes every affected schedule, which
 * is a synchronous engine expansion — on the API tier that runs on the event
 * loop serving other requests. Routine edits arrive in bursts: adding ten
 * people to a layer is ten create hooks, and each hook publishes its own
 * event. So at most ONE pass per project runs at a time here; events that
 * arrive while it runs are merged into a single follow-up that runs once,
 * right after. Ten hooks then cost two passes instead of ten, and the
 * follow-up sees the final state of all ten edits anyway. The promise this
 * listener returns still settles only when the pass covering the caller's
 * event has finished, so a caller that wants to wait (a test, notify's
 * Promise.all) gets the same guarantee it had before.
 */

export type OnCallShiftReminderListenerFunction = (
  event: OnCallShiftChangeEvent,
) => Promise<void>;

/*
 * projectId -> the pass chain currently running for it. The chain drains
 * everything queued for that project before it clears this entry, so a
 * caller that sees an entry can safely queue and wait on it.
 */
const inFlightByProject: Map<string, Promise<void>> = new Map<
  string,
  Promise<void>
>();

// projectId -> the merged event the running chain will pick up next.
const queuedByProject: Map<string, OnCallShiftChangeEvent> = new Map<
  string,
  OnCallShiftChangeEvent
>();

/** The union of two events for the same project. */
export function mergeOnCallShiftChangeEvents(
  base: OnCallShiftChangeEvent,
  next: OnCallShiftChangeEvent,
): OnCallShiftChangeEvent {
  const occurredAt: Date =
    next.occurredAt.getTime() >= base.occurredAt.getTime()
      ? next.occurredAt
      : base.occurredAt;

  return OnCallShiftChangeListeners.buildEvent({
    projectId: base.projectId || next.projectId,
    scheduleIds: [...base.scheduleIds, ...next.scheduleIds],
    userIds: [...base.userIds, ...next.userIds],
    // The newest reason: it only ever reaches a log line.
    reason: next.reason,
    occurredAt,
  });
}

/** One pass. Never rejects — the hook that published must not be affected. */
async function runOneChangePass(event: OnCallShiftChangeEvent): Promise<void> {
  try {
    await OnCallShiftReminderRunner.runChangePass(event);
  } catch (err) {
    logger.error(
      `${SHIFT_REMINDER_LISTENER_NAME}: change pass threw (best-effort, ignored).`,
    );
    logger.error(err);
  }
}

/**
 * Run `event` and then everything that queued up for the same project while
 * it ran, one pass at a time. The in-flight entry is cleared in the same
 * synchronous step that finds the queue empty, so an event published between
 * the two can never be dropped.
 */
function startChangePassChain(
  projectKey: string,
  event: OnCallShiftChangeEvent,
): Promise<void> {
  const chain: Promise<void> = (async (): Promise<void> => {
    let current: OnCallShiftChangeEvent = event;

    for (;;) {
      try {
        await runOneChangePass(current);
      } catch {
        // runOneChangePass never throws; belt and braces.
      }

      const next: OnCallShiftChangeEvent | undefined =
        queuedByProject.get(projectKey);

      if (!next) {
        inFlightByProject.delete(projectKey);
        return;
      }

      queuedByProject.delete(projectKey);
      current = next;
    }
  })();

  inFlightByProject.set(projectKey, chain);

  return chain;
}

export const onCallShiftReminderListener: OnCallShiftReminderListenerFunction =
  async (event: OnCallShiftChangeEvent): Promise<void> => {
    const projectId: ObjectID | null = event.projectId;

    // No project to coalesce on (the pass resolves it from the schedules).
    if (!projectId) {
      await runOneChangePass(event);
      return;
    }

    const projectKey: string = projectId.toString();
    const running: Promise<void> | undefined =
      inFlightByProject.get(projectKey);

    if (running) {
      const queued: OnCallShiftChangeEvent | undefined =
        queuedByProject.get(projectKey);

      queuedByProject.set(
        projectKey,
        queued ? mergeOnCallShiftChangeEvents(queued, event) : event,
      );

      // Resolves only once the chain has drained what we just queued.
      await running;
      return;
    }

    await startChangePassChain(projectKey, event);
  };

/** For tests: forget every in-flight/queued change pass. */
export function resetOnCallShiftReminderCoalescing(): void {
  inFlightByProject.clear();
  queuedByProject.clear();
}

export function registerOnCallShiftReminderListener(): void {
  OnCallShiftChangeListeners.register(
    onCallShiftReminderListener,
    SHIFT_REMINDER_LISTENER_NAME,
  );
}

registerOnCallShiftReminderListener();

export default registerOnCallShiftReminderListener;
