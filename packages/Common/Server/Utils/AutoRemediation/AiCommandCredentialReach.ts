import {
  PostgresQueryTimeoutMs,
  PostgresStatementTimeoutMs,
} from "../../EnvironmentConfig";
import { OnCreate, OnUpdate } from "../../Types/Database/Hooks";
import UpdateBy from "../../Types/Database/UpdateBy";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Semaphore, { SemaphoreMutex } from "../../Infrastructure/Semaphore";
import StatementOutcome, {
  StatementContext,
} from "../Database/StatementOutcome";
import logger from "../Logger";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";

/*
 * ONE LOCK FOR THE TWO WRITES THAT PUT AN SSH CREDENTIAL WITHIN REACH OF
 * ONEUPTIME AI'S COMMANDS.
 *
 * OneUptime AI runs an SSH command with one of the SSH credentials assigned
 * to the Runner it runs on, and only on a Runner that runs its commands
 * ("Runs AI Remediation Commands"). A credential comes within its reach from
 * either side:
 *
 *   - turning that switch on for a Runner that holds SSH credentials
 *     (RunnerService), and
 *   - assigning an SSH credential to a Runner that has it on: creating the
 *     credential with that Runner, or adding the Runner to the credential's
 *     Runners (RunbookCredentialService).
 *
 * Either one needs the read of runbook credentials (RunbookCredentialReaders),
 * and each is checked by reading the other side: the switch by the Runner's
 * SSH credentials, the assignment by the Runner's switch. Two such writes at
 * the same moment would each read the other's side before the other is
 * written, and both would pass. So every such write by someone who may not
 * read runbook credentials holds its project's lock from before its check
 * reads until it is written or has failed, and reads what its check decides
 * by (the Runners a credential holds, whether a Runner's switch is on) under
 * that lock, so the write that waits for the lock reads what the other one
 * wrote.
 *
 * A write by someone who may read runbook credentials - OneUptime itself, a
 * server admin, a person or a workflow step answered as one who may - is not
 * checked, and takes no lock. Whichever side it writes, it and a checked
 * write at the same moment end as they would one after the other with the
 * unchecked write second, which it may be whatever the other side holds: the
 * checked write passed on what was there before it, and the unchecked one
 * needs nothing of what is there.
 *
 * A write that cannot have the lock - Valkey cannot be reached, or another
 * write held it for longer than a write waits - is refused, to be saved again
 * in a moment: a check that cannot be sure of what it read never lets a write
 * through. The lock is kept once more right before the write (keepForWrite),
 * which is refused when the lock was lost in between, and given back once the
 * write is done or has failed (giveBack) - unless the database may still
 * apply the failed write (giveBackAfterFailedWrite): it is then left to run
 * out, which it does after the statement could have landed
 * (getLockTimeoutInMs). It is never kept on a timer, so a lock its write
 * never gave back - the server stopped half way - runs out LOCK_TIMEOUT_IN_MS
 * after it was last kept rather than holding up the project's next change.
 *
 * The services' write hooks call it through the hook helpers at the bottom,
 * so each holds and gives back a write's locks the same way.
 */

export const CREDENTIAL_REACH_CHANGE_IN_PROGRESS_MESSAGE: string =
  "Another change to this project's Runners or runbook credentials is being saved. Try again in a moment.";

/*
 * The time, on top of the database's statement timeout, a statement still
 * running when its client stopped waiting for it may take to be cancelled.
 */
export const ABANDONED_WRITE_MARGIN_IN_MS: number = 10_000;

/*
 * How long a lock lasts from when it was taken, or last kept - right before
 * the write. As long as:
 *
 *   - the client waits for any one statement (DATABASE_QUERY_TIMEOUT_MS),
 *     with time to spare for the steps around it, so a write that is still
 *     being written holds it to the end;
 *   - the database may still run a statement whose client stopped waiting
 *     for it (DATABASE_STATEMENT_TIMEOUT_MS, and a margin), so a write left
 *     to land after it was reported as failed (giveBackAfterFailedWrite)
 *     lands while its lock is still held; a statement timeout that is not
 *     set, or not a number, bounds nothing and adds nothing;
 *
 * and a minute at the least.
 */
export const getLockTimeoutInMs: (
  queryTimeoutMs: number,
  statementTimeoutMs?: number | undefined,
) => number = (
  queryTimeoutMs: number,
  statementTimeoutMs?: number | undefined,
): number => {
  let timeout: number = 60_000;

  if (Number.isFinite(queryTimeoutMs)) {
    timeout = Math.max(timeout, queryTimeoutMs + 25_000);
  }

  if (
    statementTimeoutMs !== undefined &&
    Number.isFinite(statementTimeoutMs) &&
    statementTimeoutMs > 0
  ) {
    timeout = Math.max(
      timeout,
      statementTimeoutMs + ABANDONED_WRITE_MARGIN_IN_MS,
    );
  }

  return timeout;
};

export const LOCK_TIMEOUT_IN_MS: number = getLockTimeoutInMs(
  PostgresQueryTimeoutMs,
  PostgresStatementTimeoutMs,
);

/*
 * How long a write waits for the lock before it is refused. Another write
 * holds it for the moment its check and its write take.
 */
export const LOCK_WAIT_IN_MS: number = 15_000;

const LOCK_NAMESPACE: string = "AiCommandCredentialReach";

// The locks one write holds while it is checked and written.
export interface CredentialReachHold {
  locks: Array<SemaphoreMutex>;
}

export default class AiCommandCredentialReach {
  /*
   * The hold of each update being checked, by the UpdateBy a service's
   * onBeforeUpdate hands back - the one DatabaseService passes on to
   * onUpdatePermitted, which is handed nothing else - so that hook can keep
   * it right before the write.
   */
  private static holds: WeakMap<UpdateBy<BaseModel>, CredentialReachHold> =
    new WeakMap<UpdateBy<BaseModel>, CredentialReachHold>();

  /*
   * The keys of the projects' locks: each project once, lowercased, in one
   * order, so two writes that lock the same projects never wait on each
   * other's second lock.
   */
  public static getLockKeys(
    projectIds: Array<ObjectID | string | null | undefined>,
  ): Array<string> {
    const keys: Set<string> = new Set<string>();

    for (const projectId of projectIds) {
      const key: string = projectId ? projectId.toString().toLowerCase() : "";

      if (key) {
        keys.add(key);
      }
    }

    return [...keys].sort();
  }

  /*
   * Takes the lock of each of `projectIds`, before the write's check reads
   * anything, or refuses the write when one cannot be had: the locks taken
   * already are given back.
   */
  public static async take(
    projectIds: Array<ObjectID | string | null | undefined>,
  ): Promise<CredentialReachHold> {
    const keys: Array<string> =
      AiCommandCredentialReach.getLockKeys(projectIds);

    if (keys.length === 0) {
      throw new BadDataException(
        "This change names no project, so who may make it cannot be checked.",
      );
    }

    const hold: CredentialReachHold = { locks: [] };

    try {
      for (const key of keys) {
        hold.locks.push(
          await Semaphore.lock({
            key: key,
            namespace: LOCK_NAMESPACE,
            lockTimeout: LOCK_TIMEOUT_IN_MS,
            acquireTimeout: LOCK_WAIT_IN_MS,
            refreshInterval: 0,
          }),
        );
      }
    } catch (error) {
      logger.error(error);
      await AiCommandCredentialReach.giveBack(hold);
      throw new BadDataException(CREDENTIAL_REACH_CHANGE_IN_PROGRESS_MESSAGE);
    }

    return hold;
  }

  /*
   * Keeps every lock of `hold` for another LOCK_TIMEOUT_IN_MS, right before
   * the write. A lock that is no longer the write's - it ran out, or Valkey
   * lost it - may have let another write check in the meantime, so the write
   * is refused, to be saved again.
   */
  public static async keepForWrite(
    hold: CredentialReachHold | null | undefined,
  ): Promise<void> {
    if (!hold) {
      return;
    }

    for (const lock of hold.locks) {
      let isKept: boolean = false;

      try {
        isKept = await Semaphore.keepLock(lock);
      } catch (error) {
        logger.error(error);
      }

      if (!isKept) {
        throw new BadDataException(CREDENTIAL_REACH_CHANGE_IN_PROGRESS_MESSAGE);
      }
    }
  }

  /*
   * Gives back every lock of `hold`. Never throws: a release that fails must
   * neither hide the error a failed write is unwinding nor fail a write that
   * was saved - the lock then runs out on its own. Giving back a hold given
   * back already does nothing.
   */
  public static async giveBack(
    hold: CredentialReachHold | null | undefined,
  ): Promise<void> {
    if (!hold) {
      return;
    }

    const locks: Array<SemaphoreMutex> = hold.locks.splice(
      0,
      hold.locks.length,
    );

    for (const lock of locks) {
      try {
        await Semaphore.release(lock);
      } catch (error) {
        logger.error(error);
      }
    }
  }

  /*
   * Once the write of a checked change failed, with what failed: its locks
   * are given back at once - unless the database may still apply the write
   * (StatementOutcome.mayStillApply: a statement that writes, or in a write
   * of its own transaction its COMMIT, whose answer never came). They are
   * then left to run out, which they do LOCK_TIMEOUT_IN_MS after they were
   * last kept - right before the write - once the statement could no longer
   * land (getLockTimeoutInMs): no other change's check reads around a write
   * that may still be written. Never throws.
   */
  public static async giveBackAfterFailedWrite(
    hold: CredentialReachHold | null | undefined,
    error: unknown,
    context?: StatementContext | undefined,
  ): Promise<void> {
    if (!hold) {
      return;
    }

    let mayStillApply: boolean = false;

    try {
      mayStillApply = StatementOutcome.mayStillApply(error, context);
    } catch (err) {
      logger.error(err);
    }

    if (mayStillApply && hold.locks.length > 0) {
      // No longer this write's to give back: they run out on their own.
      hold.locks.splice(0, hold.locks.length);

      logger.warn(
        "A change to a project's Runners or runbook credentials failed without the database answering; its lock is left to run out, as the write may still land.",
      );

      return;
    }

    await AiCommandCredentialReach.giveBack(hold);
  }

  // Remembers the hold of the update `updateBy` is, for heldFor.
  public static holdFor<TModel extends BaseModel>(
    updateBy: UpdateBy<TModel>,
    hold: CredentialReachHold,
  ): void {
    AiCommandCredentialReach.holds.set(
      updateBy as unknown as UpdateBy<BaseModel>,
      hold,
    );
  }

  // The hold of the update `updateBy` is, if it holds one.
  public static heldFor<TModel extends BaseModel>(
    updateBy: UpdateBy<TModel>,
  ): CredentialReachHold | null {
    return (
      AiCommandCredentialReach.holds.get(
        updateBy as unknown as UpdateBy<BaseModel>,
      ) || null
    );
  }

  /*
   * The hold a write's hooks carried forward from its before hook
   * (carryForward: { credentialReachHold }), if it carries one.
   */
  public static carriedForward(
    carryForward: unknown,
  ): CredentialReachHold | null {
    if (!carryForward || typeof carryForward !== "object") {
      return null;
    }

    return (
      (carryForward as { credentialReachHold?: CredentialReachHold | null })
        .credentialReachHold || null
    );
  }

  /*
   * The carryForward a before hook hands on with the hold it took - and, for
   * an update, the hold remembered for its onUpdatePermitted (holdFor). An
   * update's hold is found from either, whichever its hook is handed
   * (holdOfUpdate): giving back a hold twice gives it back once.
   */
  public static carryForwardOf(hold: CredentialReachHold): {
    credentialReachHold: CredentialReachHold;
  } {
    return { credentialReachHold: hold };
  }

  /*
   * What an update's onBeforeUpdate hands back once it holds `hold`: the
   * hold remembered for its onUpdatePermitted (holdFor) and carried forward
   * to its success and error hooks (carryForwardOf), both at once, so no
   * hook of the update is left without it.
   */
  public static heldUpdate<TModel extends BaseModel>(
    updateBy: UpdateBy<TModel>,
    hold: CredentialReachHold,
  ): OnUpdate<TModel> {
    AiCommandCredentialReach.holdFor(updateBy, hold);

    return {
      updateBy: updateBy,
      carryForward: AiCommandCredentialReach.carryForwardOf(hold),
    };
  }

  // The hold of the update an update hook is handed, if it holds one.
  public static holdOfUpdate<TModel extends BaseModel>(
    onUpdate: OnUpdate<TModel> | null | undefined,
  ): CredentialReachHold | null {
    if (!onUpdate) {
      return null;
    }

    return (
      AiCommandCredentialReach.carriedForward(onUpdate.carryForward) ||
      (onUpdate.updateBy
        ? AiCommandCredentialReach.heldFor(onUpdate.updateBy)
        : null)
    );
  }

  /*
   * THE WRITE HOOKS (RunnerService, RunbookCredentialService).
   *
   * onUpdatePermitted / onCreatePermitted: the lock its check was made under
   * is still the write's, right before it (keepForWrite), or it is refused.
   * onUpdateSuccess / onCreateSuccess: the write is done, its lock is given
   * back. onUpdateError / onCreateError: the write failed after its check,
   * its lock is given back unless the write may still land
   * (giveBackAfterFailedWrite). A create is written in a transaction of its
   * own (TypeORM's save()).
   */
  public static async keepForUpdate<TModel extends BaseModel>(
    updateBy: UpdateBy<TModel>,
  ): Promise<void> {
    await AiCommandCredentialReach.keepForWrite(
      AiCommandCredentialReach.heldFor(updateBy),
    );
  }

  public static async giveBackAfterUpdate<TModel extends BaseModel>(
    onUpdate: OnUpdate<TModel> | null | undefined,
  ): Promise<void> {
    await AiCommandCredentialReach.giveBack(
      AiCommandCredentialReach.holdOfUpdate(onUpdate),
    );
  }

  public static async giveBackAfterFailedUpdate<TModel extends BaseModel>(
    error: unknown,
    onUpdate: OnUpdate<TModel> | null | undefined,
  ): Promise<void> {
    await AiCommandCredentialReach.giveBackAfterFailedWrite(
      AiCommandCredentialReach.holdOfUpdate(onUpdate),
      error,
    );
  }

  public static async keepForCreate<TModel extends BaseModel>(
    onCreate: OnCreate<TModel>,
  ): Promise<void> {
    await AiCommandCredentialReach.keepForWrite(
      AiCommandCredentialReach.carriedForward(onCreate.carryForward),
    );
  }

  public static async giveBackAfterCreate<TModel extends BaseModel>(
    onCreate: OnCreate<TModel> | null | undefined,
  ): Promise<void> {
    await AiCommandCredentialReach.giveBack(
      AiCommandCredentialReach.carriedForward(onCreate?.carryForward),
    );
  }

  public static async giveBackAfterFailedCreate<TModel extends BaseModel>(
    error: unknown,
    onCreate: OnCreate<TModel> | null | undefined,
  ): Promise<void> {
    await AiCommandCredentialReach.giveBackAfterFailedWrite(
      AiCommandCredentialReach.carriedForward(onCreate?.carryForward),
      error,
      { inOwnTransaction: true },
    );
  }
}
