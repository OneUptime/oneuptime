import ObjectID from "../../../Types/ObjectID";
import logger from "../Logger";

/*
 * A tiny in-process registry of "somebody's on-call shifts may have changed"
 * listeners.
 *
 * The on-call CRUD hooks (layer, layer user, override, policy attachment,
 * schedule rename/timezone, member leaving the project) already know exactly
 * which schedules and users an edit touched. Several consumers want that
 * signal — the shift-reminder change pass (catch-up and reassigned notices),
 * and later a push-sync engine — but the services must not import them: the
 * reminder runner lives next to the Workers and imports the materializer,
 * which imports the services, so a static import back would be a cycle, and
 * the hooks must keep working in processes (the API tier, tests) where those
 * consumers are never loaded.
 *
 * So the hooks publish here and the consumers subscribe at boot. Delivery is
 * best-effort by construction: a listener that throws is logged and never
 * fails the edit that triggered it, and a slow listener never delays the
 * response because the hooks do not await `notify`.
 *
 * Registration is idempotent. Re-registering under the same name replaces the
 * listener (so a module that is re-imported by a test harness does not stack
 * duplicates), and registering the very same function twice without a name
 * is a no-op.
 */

export enum OnCallShiftChangeReason {
  LayerChanged = "LayerChanged",
  LayerUserChanged = "LayerUserChanged",
  OverrideChanged = "OverrideChanged",
  PolicyAttachmentChanged = "PolicyAttachmentChanged",
  ScheduleChanged = "ScheduleChanged",
  ScheduleDeleted = "ScheduleDeleted",
  MemberLeftProject = "MemberLeftProject",
}

export interface OnCallShiftChangeEvent {
  /*
   * Project the change happened in. Null only when the hook could not
   * determine it (a root write with no project on the row) — listeners
   * should then fall back to resolving it from the schedules.
   */
  projectId: ObjectID | null;
  /*
   * Schedules whose resolved shifts may differ from what they were. Empty
   * when the change touched no schedule (e.g. an override for a user who is
   * on no schedule), in which case only `userIds` is meaningful.
   */
  scheduleIds: Array<ObjectID>;
  /*
   * Users whose personal shift list may differ: the members of the affected
   * schedules plus anyone named directly by the change (an override's
   * original user and substitute, the user added to / removed from a layer,
   * the member who left). Best-effort — a listener that needs certainty
   * should re-materialize the schedules.
   */
  userIds: Array<ObjectID>;
  reason: OnCallShiftChangeReason;
  /*
   * When the change was observed. Listeners that keep a watermark compare
   * against it instead of reading the clock again.
   */
  occurredAt: Date;
}

export type OnCallShiftChangeListener = (
  event: OnCallShiftChangeEvent,
) => Promise<void> | void;

interface RegisteredListener {
  name: string | undefined;
  listener: OnCallShiftChangeListener;
}

export default class OnCallShiftChangeListeners {
  private static listeners: Array<RegisteredListener> = [];

  /**
   * Register a listener. With a name, a later registration under the same
   * name REPLACES the earlier one; without a name, registering the same
   * function reference twice is a no-op. Either way a listener is never
   * invoked twice for one event.
   */
  public static register(
    listener: OnCallShiftChangeListener,
    name?: string | undefined,
  ): void {
    if (typeof listener !== "function") {
      throw new Error("OnCallShiftChangeListeners.register expects a function");
    }

    if (name) {
      const existing: RegisteredListener | undefined =
        OnCallShiftChangeListeners.listeners.find(
          (entry: RegisteredListener) => {
            return entry.name === name;
          },
        );

      if (existing) {
        existing.listener = listener;
        return;
      }

      OnCallShiftChangeListeners.listeners.push({ name, listener });
      return;
    }

    const alreadyRegistered: boolean =
      OnCallShiftChangeListeners.listeners.some((entry: RegisteredListener) => {
        return entry.listener === listener;
      });

    if (alreadyRegistered) {
      return;
    }

    OnCallShiftChangeListeners.listeners.push({ name: undefined, listener });
  }

  /**
   * Remove a listener by name or by function reference. Unknown names /
   * functions are ignored.
   */
  public static unregister(
    listenerOrName: OnCallShiftChangeListener | string,
  ): void {
    OnCallShiftChangeListeners.listeners =
      OnCallShiftChangeListeners.listeners.filter(
        (entry: RegisteredListener) => {
          if (typeof listenerOrName === "string") {
            return entry.name !== listenerOrName;
          }
          return entry.listener !== listenerOrName;
        },
      );
  }

  /** Drop every listener. For tests. */
  public static clear(): void {
    OnCallShiftChangeListeners.listeners = [];
  }

  public static getRegisteredNames(): Array<string | undefined> {
    return OnCallShiftChangeListeners.listeners.map(
      (entry: RegisteredListener) => {
        return entry.name;
      },
    );
  }

  public static getCount(): number {
    return OnCallShiftChangeListeners.listeners.length;
  }

  /**
   * Deliver one event to every listener. Never rejects: each listener runs
   * inside its own try/catch, synchronous throws and rejected promises alike
   * are logged and swallowed, and the remaining listeners still run. The
   * returned promise settles when every listener has settled, so a caller
   * that wants to wait can; the CRUD hooks deliberately do not.
   */
  public static async notify(event: OnCallShiftChangeEvent): Promise<void> {
    // Snapshot so a listener that (un)registers during delivery is safe.
    const snapshot: Array<RegisteredListener> = [
      ...OnCallShiftChangeListeners.listeners,
    ];

    const deliveries: Array<Promise<void>> = snapshot.map(
      async (entry: RegisteredListener): Promise<void> => {
        try {
          await entry.listener(event);
        } catch (err) {
          logger.error(
            `On-call shift change listener${entry.name ? ` "${entry.name}"` : ""} failed (best-effort, ignored).`,
          );
          logger.error(err);
        }
      },
    );

    await Promise.all(deliveries);
  }

  /**
   * Build an event with defaults: ids deduplicated, `occurredAt` = now.
   */
  public static buildEvent(data: {
    projectId: ObjectID | null | undefined;
    scheduleIds: Array<ObjectID>;
    userIds?: Array<ObjectID> | undefined;
    reason: OnCallShiftChangeReason;
    occurredAt?: Date | undefined;
  }): OnCallShiftChangeEvent {
    return {
      projectId: data.projectId || null,
      scheduleIds: OnCallShiftChangeListeners.dedupe(data.scheduleIds),
      userIds: OnCallShiftChangeListeners.dedupe(data.userIds || []),
      reason: data.reason,
      occurredAt: data.occurredAt || new Date(),
    };
  }

  public static dedupe(ids: Array<ObjectID>): Array<ObjectID> {
    const seen: Set<string> = new Set<string>();
    const result: Array<ObjectID> = [];

    for (const id of ids) {
      if (!id) {
        continue;
      }

      const key: string = id.toString();

      if (!key || seen.has(key)) {
        continue;
      }

      seen.add(key);
      result.push(id);
    }

    return result;
  }
}
