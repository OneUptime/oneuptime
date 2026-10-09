import { PostgresQueryTimeoutMs } from "../../EnvironmentConfig";
import Semaphore, { SemaphoreMutex } from "../../Infrastructure/Semaphore";
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
 * written, and both would pass. So every write that may bring the two
 * together holds its project's lock from before its check reads until it is
 * written or has failed - whoever makes it, since the other write's check
 * must see it too - and the write that waits for the lock reads what the
 * other one wrote.
 *
 * A write that cannot have the lock - Valkey cannot be reached, or another
 * write held it for longer than a write waits - is refused, to be saved again
 * in a moment: a check that cannot be sure of what it read never lets a write
 * through. The lock is kept once more right before the write (keepForWrite),
 * which is refused when the lock was lost in between, and given back once the
 * write is done or has failed (giveBack). It is never kept on a timer, so a
 * lock its write never gave back - the server stopped half way - runs out
 * LOCK_TIMEOUT_IN_MS after it was last kept rather than holding up the
 * project's next change.
 */

export const CREDENTIAL_REACH_CHANGE_IN_PROGRESS_MESSAGE: string =
  "Another change to this project's Runners or runbook credentials is being saved. Try again in a moment.";

/*
 * How long a lock lasts from when it was taken, or last kept: as long as the
 * client waits for any one statement (DATABASE_QUERY_TIMEOUT_MS), with time to
 * spare for the steps around it, and a minute at the least - so a write that
 * is still being written holds it to the end.
 */
export const getLockTimeoutInMs: (queryTimeoutMs: number) => number = (
  queryTimeoutMs: number,
): number => {
  if (!Number.isFinite(queryTimeoutMs)) {
    return 60_000;
  }

  return Math.max(60_000, queryTimeoutMs + 25_000);
};

export const LOCK_TIMEOUT_IN_MS: number = getLockTimeoutInMs(
  PostgresQueryTimeoutMs,
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
   * The hold of each write being checked, by the write object a service's
   * onBeforeUpdate hands back - the one DatabaseService passes on to
   * onUpdatePermitted - so that hook can keep it right before the write.
   */
  private static holds: WeakMap<object, CredentialReachHold> = new WeakMap<
    object,
    CredentialReachHold
  >();

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
    const keys: Array<string> = AiCommandCredentialReach.getLockKeys(projectIds);

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

  // Remembers the hold of the write `write` is, for heldFor.
  public static holdFor(write: object, hold: CredentialReachHold): void {
    AiCommandCredentialReach.holds.set(write, hold);
  }

  // The hold of the write `write` is, if it holds one.
  public static heldFor(write: object): CredentialReachHold | null {
    return AiCommandCredentialReach.holds.get(write) || null;
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
}
