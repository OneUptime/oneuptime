import BaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import ObjectID from "../../Types/ObjectID";
import Semaphore, { SemaphoreMutex } from "../Infrastructure/Semaphore";
import { OnCreate } from "../Types/Database/Hooks";
import logger, { LogAttributes } from "./Logger";

/*
 * THE LOCK A STATE CHANGE HOLDS ON ITS EVENT, GIVEN BACK HOWEVER THE CHANGE
 * ENDS.
 *
 * Moving an incident, an alert, an alert or incident episode or a scheduled
 * maintenance event to another state creates a row in its state timeline.
 * The change reads the rows on either side of it and closes the one before,
 * so two changes to one event at the same moment would both read the same
 * row before them and both close it. A change therefore takes its event's
 * lock in onBeforeCreate, before it reads the timeline, and gives it back
 * once it is saved and the event's current state written (onCreateSuccess) -
 * or once it is refused or fails anywhere after the hook: a check
 * DatabaseService.create runs after it, the INSERT, the event's own write
 * (onCreateError, which DatabaseService hands what onBeforeCreate handed
 * back). The lock travels between the hooks as the create's carryForward
 * `mutex`.
 *
 * A lock never given back is not one that runs out: redis-semaphore keeps
 * refreshing it for as long as the process lives, so every later change to
 * the event would wait out the lock and then go ahead without it.
 *
 * Without Valkey a change goes ahead unlocked, as it always has. (The
 * monitor status timeline, written by every probe result, refuses instead:
 * MonitorStatusTimelineService.)
 */
export default class StateChangeLock {
  /*
   * Takes the event's lock for a state change, before it reads the event's
   * timeline. Null when it cannot be had - Valkey is unreachable, or another
   * change held it for longer than a change waits - and the change goes
   * ahead without it.
   */
  public static async take(data: {
    namespace: string;
    eventId: ObjectID;
    logAttributes: LogAttributes;
  }): Promise<SemaphoreMutex | null> {
    try {
      return await Semaphore.lock({
        key: data.eventId.toString(),
        namespace: data.namespace,
      });
    } catch (err) {
      logger.error(err, data.logAttributes);
      return null;
    }
  }

  /*
   * Gives back a lock take() returned. Never throws: a release that fails
   * must neither hide the error a failed change is unwinding nor fail a
   * change that was saved (redis-semaphore stops refreshing the lock before
   * it asks Valkey, so the lock runs out on its own). Giving back a lock
   * given back already does nothing.
   */
  public static async giveBack(
    mutex: SemaphoreMutex | null | undefined,
    logAttributes: LogAttributes,
  ): Promise<void> {
    if (!mutex) {
      return;
    }

    try {
      await Semaphore.release(mutex);
    } catch (err) {
      logger.error(err, logAttributes);
    }
  }

  /*
   * The lock a state change's create carried forward from onBeforeCreate,
   * given back: for onCreateError, which is handed no create when the
   * change failed before the hook ran (nothing was locked then).
   */
  public static async giveBackFor<TBaseModel extends BaseModel>(
    onCreate: OnCreate<TBaseModel> | undefined,
    logAttributes: LogAttributes,
  ): Promise<void> {
    await StateChangeLock.giveBack(
      StateChangeLock.carriedForward(onCreate),
      logAttributes,
    );
  }

  // The lock in a create's carryForward, if it carries one.
  public static carriedForward<TBaseModel extends BaseModel>(
    onCreate: OnCreate<TBaseModel> | undefined,
  ): SemaphoreMutex | null {
    const carryForward: unknown = onCreate?.carryForward;

    if (!carryForward || typeof carryForward !== "object") {
      return null;
    }

    return (carryForward as { mutex?: SemaphoreMutex | null }).mutex || null;
  }
}
