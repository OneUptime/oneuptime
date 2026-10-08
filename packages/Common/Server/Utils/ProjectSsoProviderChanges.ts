import BaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import PositiveNumber from "../../Types/PositiveNumber";
import Semaphore, {
  SemaphoreLockTimeoutError,
  SemaphoreMutex,
} from "../Infrastructure/Semaphore";
import {
  PostgresQueryTimeoutMs,
  PostgresStatementTimeoutMs,
} from "../EnvironmentConfig";
import DatabaseService from "../Services/DatabaseService";
import Query from "../Types/Database/Query";
import QueryHelper from "../Types/Database/QueryHelper";
import QueryUtil from "../Types/Database/QueryUtil";
import Select from "../Types/Database/Select";
import UpdateBy from "../Types/Database/UpdateBy";
import DeleteBy from "../Types/Database/DeleteBy";
import StatementOutcome from "./Database/StatementOutcome";
import logger from "./Logger";
import { And, Equal, FindOperator } from "typeorm";
import ProjectSsoProviderStanding, {
  PROVIDER_NOT_FOUND,
  ProjectSsoProviderStandingValue,
  ProjectSsoProviderType,
} from "./ProjectSsoProviderStanding";
import RealtimeAccessChanges, {
  RealtimeAccessChangeKind,
} from "./Realtime/RealtimeAccessChanges";
import SsoSignInsEnded from "./SsoSignInsEnded";
import SsoSignInWays, {
  StrandReason,
  StrandedProject,
  StrandedProjects,
} from "./SsoSignInWays";

/*
 * TURNING A PROJECT'S SSO PROVIDER OFF, OR DELETING IT, ENDS THE SIGN-INS IT
 * GAVE.
 *
 * What the project's SAML and OIDC provider services do when a write turns a
 * provider off or on, or deletes it (ProjectSsoService, ProjectOidcService):
 *
 *   - turning one off writes when (signInsEndedAt), in the same write: the
 *     sign-ins it gave before then stop counting, and turning it on again
 *     does not bring them back (ProjectSsoProviderStanding, SsoSignInsEnded);
 *   - every server forgets what it knew about the project's providers and
 *     asks the live updates open in the project again, as their joins were
 *     asked (RealtimeAccessChanges, SignInRulesChanged): a page signed in
 *     with a provider that was turned off or deleted stops hearing, and is
 *     told to sign in again, at once. A provider turned on is announced
 *     too, so no server keeps answering "off" for a minute;
 *   - a project that requires SSO - itself, or because the whole server
 *     does - keeps a way in: the last provider that can sign people in to
 *     it, or the one provider it requires, cannot be turned off or deleted
 *     (SsoSignInWays, the one check every such change asks);
 *   - a write that turns a project's provider off or on, or deletes one,
 *     holds a lock on the project from before it reads the providers until
 *     it is written, so what it read is still true when it lands: two
 *     writes at once cannot each take away what the other counted on, and
 *     none can miss a provider another turned on a moment before. It writes
 *     exactly the providers it read under the lock: one that comes to match
 *     its filter afterwards is left alone, and a delete - a hard delete
 *     included - reaches no other provider that is there, only rows deleted
 *     before, which sign nobody in (lockReadAndCheck, writeOnlyTheRowsRead).
 *     One that leaves a project none of its own providers on, or takes away
 *     the one it requires, also holds the lock on the server's sign-in rules
 *     (lockSignInChange): the project then relies on the global providers
 *     and the server's Require SSO for Login, which global changes write
 *     under that lock. One that leaves the project a provider of its own
 *     keeps a way in whatever those are, and holds only the project's lock
 *     (SsoSignInWays.dependsOnServerRules);
 *   - its locks are kept once more right before the write and kept alive
 *     while it is written, however long that takes, so it never lands once
 *     they could have run out: a lock found gone by then is taken again,
 *     with the others, and the change checked again under them - refused
 *     only when a lock cannot be taken, or the change no longer passes
 *     (holdForWrite);
 *   - a write that fails once it holds a lock gives it back
 *     (afterFailedWrite, the services' error hooks) - unless the database
 *     may still apply it: then its locks are kept until the database would
 *     have cancelled it (giveBackAfterFailedWrite). A lock nobody gives back
 *     runs out (LOCK_TIMEOUT_IN_MS).
 *
 * Any other change - a new certificate or client secret, other addresses,
 * other teams, a new name - leaves the sign-ins the provider gave as they
 * are: they were checked when they were made, and the next sign-in uses
 * the new settings.
 */

// A provider row, as these hooks read it.
export interface ProjectSsoProviderRow {
  id: string;
  projectId: string;
  isOn: boolean;
}

/*
 * What a write does to providers' sign-ins, worked out before it runs and
 * acted on once it has (carryForward).
 */
export interface ProjectSsoProviderWrite {
  // Providers that were on, and that the write turns off or deletes.
  takenAway: Array<ProjectSsoProviderRow>;
  // Providers that were off, and that the write turns on.
  turnedOn: Array<ProjectSsoProviderRow>;
  /*
   * The locks held on the projects of the rows the write names, and on the
   * server's sign-in rules when a project it touches relies on them, from
   * before they were read until the write is done (afterUpdate/afterDelete)
   * or fails (afterFailedWrite).
   */
  locks?: Array<SemaphoreMutex> | undefined;
  /*
   * The write's check, run again from the start should a lock be found gone
   * right before the write (holdForWrite): it reads the rows again, under
   * the locks taken again, and works out the write again in this record.
   */
  recheck?: SignInChangeRecheck | undefined;
}

/*
 * A change's check, run again from the start: its locks taken again - in the
 * order every change takes them - what it names read again under them, and
 * the change checked again. Answers the locks it then holds, none when its
 * rows are gone. Throws - having given back whatever it took - when a lock
 * cannot be taken, or the change is now refused.
 */
export type SignInChangeRecheck = () => Promise<Array<SemaphoreMutex>>;

/*
 * The locks of a change being written, kept alive until it is done
 * (holdForWrite): every WRITE_KEEP_INTERVAL_IN_MS, for at most
 * WRITE_KEEP_LIMIT_IN_MS from its check - or, once its write failed in a way
 * that leaves the database to finish it, until the database would have
 * cancelled it (keepUntilAbandonedWriteEnds).
 */
interface WriteKeeper {
  // The locks still kept: one found gone is kept no more.
  locks: Array<SemaphoreMutex>;
  timer: ReturnType<typeof setInterval>;
  // Nothing is kept from then on.
  keepUntilMs: number;
  /*
   * Its write failed, and the database may still apply it: the locks are no
   * longer the change's to give back, and run out once nothing keeps them.
   */
  isAbandoned: boolean;
  // Given back, or past the limit: nothing more is kept.
  isStopped: boolean;
  // A keep is under way: the next tick waits for it.
  isKeeping: boolean;
}

export const LAST_SSO_PROVIDER_MESSAGE: string =
  "This project requires SSO, and this is the last SSO provider people can sign in to it with. Turn off Require SSO for Login first, so people can still sign in.";

export const REQUIRED_SSO_PROVIDER_MESSAGE: string =
  "This project requires sign-in with this SSO provider. Turn off Require SSO for Login first, so people can still sign in.";

export const SERVER_LAST_SSO_PROVIDER_MESSAGE: string =
  "This server requires SSO for everyone, and this is the last SSO provider people can sign in to this project with. Turn on another SSO provider first, so people can still sign in.";

export const PROVIDER_CHANGE_IN_PROGRESS_MESSAGE: string =
  "Another change to this project's SSO providers is being saved. Try again in a moment.";

export const SIGN_IN_CHANGE_IN_PROGRESS_MESSAGE: string =
  "Another change to who can sign in with SSO is being saved. Try again in a moment.";

/*
 * How long a lock lasts from when it was taken, or last kept
 * (keepSignInChange): a read and a check. A check that reads many projects
 * keeps its locks page by page, and a write keeps them while it is written
 * (holdForWrite), so neither outlives them; a lock its holder stops keeping
 * - its write failed half way, and nothing gave it back - runs out this
 * long after.
 */
export const LOCK_TIMEOUT_IN_MS: number = 10_000;

/*
 * How long a write waits for a lock: longer than a lock nobody keeps lasts,
 * so one a failed write never gave back runs out before a write waiting for
 * it gives up. A write that waits on a long check another change keeps
 * going, or on another change being written, is refused instead ("try
 * again in a moment").
 */
const LOCK_WAIT_IN_MS: number = 15_000;

/*
 * How often the locks of a change are kept while it is written
 * (holdForWrite): well inside LOCK_TIMEOUT_IN_MS, so a keep that comes a few
 * seconds late - a busy server, a slow Valkey - still lands before the lock
 * would run out.
 */
export const WRITE_KEEP_INTERVAL_IN_MS: number = 2_500;

/*
 * The longest the locks of a change are kept alive while it is written, from
 * its check on: as long as the client waits for any one statement
 * (PostgresQueryTimeoutMs - DATABASE_QUERY_TIMEOUT_MS, by default a little
 * after the database's DATABASE_STATEMENT_TIMEOUT_MS), with time to spare
 * for the steps between the check and the write - and a minute at the
 * least. So a write that is still going is held to the end, whatever the
 * timeouts are set to; one stuck longer than that - a step after its
 * statements that never returns - is no longer kept, and its locks run out
 * LOCK_TIMEOUT_IN_MS later, rather than holding every other change to who
 * can sign in waiting. Every change gives its locks back once it is written
 * or has failed, well before this. A timeout that is not a number counts as
 * none set: a minute.
 */
export const getWriteKeepLimitInMs: (queryTimeoutMs: number) => number = (
  queryTimeoutMs: number,
): number => {
  if (!Number.isFinite(queryTimeoutMs)) {
    return 60_000;
  }

  return Math.max(60_000, queryTimeoutMs + 25_000);
};

export const WRITE_KEEP_LIMIT_IN_MS: number = getWriteKeepLimitInMs(
  PostgresQueryTimeoutMs,
);

/*
 * The time a statement still running when its client stopped waiting for it
 * may need to be cancelled by the database, and the cancel to land, on top
 * of the database's statement timeout.
 */
export const ABANDONED_WRITE_MARGIN_IN_MS: number = 10_000;

/*
 * How long a change keeps its locks once its write failed without the
 * database answering - the client stopped waiting for the statement
 * (DATABASE_QUERY_TIMEOUT_MS) or lost the connection while it ran - from
 * that moment (keepUntilAbandonedWriteEnds): the database may still be
 * running the statement, and only its own statement timeout
 * (DATABASE_STATEMENT_TIMEOUT_MS) ends it. So the locks are kept that long,
 * and a margin, and then left to run out: no other change to who can sign in
 * is checked while the statement could still land. Behind a connection pooler
 * that drops the timeout the app asks for (PgBouncer), that bound holds only
 * when the database role has a statement_timeout of its own (HelmChart/Docs/
 * Postgres.md). A statement timeout that is not set, or not a number, bounds
 * nothing: the locks are kept as long as a write is (getWriteKeepLimitInMs).
 */
export const getAbandonedWriteHoldInMs: (
  statementTimeoutMs: number,
  queryTimeoutMs: number,
) => number = (statementTimeoutMs: number, queryTimeoutMs: number): number => {
  if (!Number.isFinite(statementTimeoutMs) || statementTimeoutMs <= 0) {
    return getWriteKeepLimitInMs(queryTimeoutMs);
  }

  return statementTimeoutMs + ABANDONED_WRITE_MARGIN_IN_MS;
};

export const ABANDONED_WRITE_HOLD_IN_MS: number = getAbandonedWriteHoldInMs(
  PostgresStatementTimeoutMs,
  PostgresQueryTimeoutMs,
);

const LOCK_NAMESPACE: string = "ProjectSsoProviderChanges.keepAWayIn";

/*
 * The key of the lock on the server's sign-in rules - the global providers
 * and their attachments, and Require SSO for Login - held by every change
 * whose check reads them. Project keys are ids, so they never meet it.
 */
export const SERVER_SIGN_IN_LOCK_KEY: string = "server";

export default class ProjectSsoProviderChanges {
  /*
   * The write an update works out in beforeUpdate, for beforeWrite to act on
   * without reading the rows again: keyed by the UpdateBy the service hands
   * back from onBeforeUpdate, which DatabaseService passes on to
   * onUpdatePermitted.
   */
  private static writesByUpdate: WeakMap<
    UpdateBy<BaseModel>,
    ProjectSsoProviderWrite
  > = new WeakMap<UpdateBy<BaseModel>, ProjectSsoProviderWrite>();

  /*
   * The changes being written now whose locks are kept alive until they are
   * given back (holdForWrite), by each lock they keep.
   */
  private static writeKeepers: WeakMap<SemaphoreMutex, WriteKeeper> =
    new WeakMap<SemaphoreMutex, WriteKeeper>();

  /*
   * Whether a project SAML or OIDC provider vouches for the sign-ins it gave
   * in a project (ProjectSsoProviderStanding): it is there, it is the
   * project's, whether it is on, and when it was last turned off. One
   * database read per server per minute, shared by every request that asks
   * at once. Throws when the database cannot be read.
   */
  public static async getStanding<TModel extends BaseModel>(data: {
    service: DatabaseService<TModel>;
    providerType: ProjectSsoProviderType;
    providerId: ObjectID;
    projectId: ObjectID;
  }): Promise<ProjectSsoProviderStandingValue> {
    return await ProjectSsoProviderStanding.get({
      projectId: data.projectId,
      providerType: data.providerType,
      providerId: data.providerId,
      load: async (): Promise<ProjectSsoProviderStandingValue> => {
        const provider: TModel | null = await data.service.findOneBy({
          query: {
            _id: data.providerId.toString(),
            projectId: data.projectId,
          } as unknown as Query<TModel>,
          select: {
            _id: true,
            isEnabled: true,
            signInsEndedAt: true,
          } as unknown as Select<TModel>,
          props: {
            isRoot: true,
          },
        });

        if (!provider) {
          return PROVIDER_NOT_FOUND;
        }

        const record: Record<string, unknown> = provider as unknown as Record<
          string,
          unknown
        >;

        return {
          isOn: record["isEnabled"] === true,
          signInsEndedAtMs: SsoSignInsEnded.toSignInsEndedAtMs(
            record["signInsEndedAt"],
          ),
        };
      },
    });
  }

  /*
   * Before an update (the service's onBeforeUpdate, after the caller's
   * write permission has narrowed the rows): which providers it turns off
   * or on, read under the projects' lock, refused when it would leave a
   * project that requires SSO with no provider to sign in with. Null for an
   * update that leaves Enabled alone - a new certificate or secret included
   * - which changes nobody's sign-in and takes no lock.
   */
  public static async beforeUpdate<TModel extends BaseModel>(data: {
    providerType: ProjectSsoProviderType;
    service: DatabaseService<TModel>;
    updateBy: UpdateBy<TModel>;
  }): Promise<ProjectSsoProviderWrite | null> {
    const isEnabled: boolean | undefined = SsoSignInsEnded.getWrittenIsEnabled(
      data.updateBy.data,
    );

    if (isEnabled === undefined) {
      return null;
    }

    const write: ProjectSsoProviderWrite =
      await ProjectSsoProviderChanges.lockReadAndCheck({
        providerType: data.providerType,
        service: data.service,
        write: data.updateBy,
        isDelete: false,
        decide: (
          rows: Array<ProjectSsoProviderRow>,
        ): ProjectSsoProviderWrite => {
          return {
            takenAway: rows.filter((row: ProjectSsoProviderRow): boolean => {
              return isEnabled === false && row.isOn;
            }),
            turnedOn: rows.filter((row: ProjectSsoProviderRow): boolean => {
              return isEnabled === true && !row.isOn;
            }),
          };
        },
      });

    ProjectSsoProviderChanges.writesByUpdate.set(
      data.updateBy as unknown as UpdateBy<BaseModel>,
      write,
    );

    return write;
  }

  /*
   * The last step before an update is written (the service's
   * onUpdatePermitted, once every permission check has passed): the locks
   * beforeUpdate took are kept for the write (holdForWrite) - one found gone
   * by now is taken again, with the others, and the rows read and checked
   * again under them - and then an update that turns a provider off writes
   * when, in the same write (SsoSignInsEnded.stampWhenTurnedOff), using what
   * was found under the locks, or - for an update that did not pass
   * beforeUpdate - the rows now.
   */
  public static async beforeWrite<TModel extends BaseModel>(data: {
    service: DatabaseService<TModel>;
    updateBy: UpdateBy<TModel>;
  }): Promise<void> {
    const write: ProjectSsoProviderWrite | undefined =
      ProjectSsoProviderChanges.writesByUpdate.get(
        data.updateBy as unknown as UpdateBy<BaseModel>,
      );

    if (write?.locks) {
      await ProjectSsoProviderChanges.holdForWrite(write.locks, write.recheck);
    }

    await SsoSignInsEnded.stampWhenTurnedOff({
      service: data.service,
      updateBy: data.updateBy,
      turnsOneOff: write ? write.takenAway.length > 0 : undefined,
    });
  }

  // After an update (onUpdateSuccess): the providers' projects, announced.
  public static async afterUpdate(data: {
    write: ProjectSsoProviderWrite | null | undefined;
    updatedItemIds: Array<ObjectID>;
  }): Promise<void> {
    if (!data.write) {
      return;
    }

    ProjectSsoProviderChanges.announce(
      ProjectSsoProviderChanges.getProjectsOfWritten(
        [...data.write.takenAway, ...data.write.turnedOn],
        data.updatedItemIds,
      ),
    );

    await ProjectSsoProviderChanges.release(data.write);
  }

  /*
   * Before a delete (onBeforeDelete, with the rows the caller may delete -
   * its last step, so its locks are kept for the write here): the providers
   * it takes away that were on, read under the projects' lock, refused when
   * that would leave a project that requires SSO with no provider to sign
   * in with.
   */
  public static async beforeDelete<TModel extends BaseModel>(data: {
    providerType: ProjectSsoProviderType;
    service: DatabaseService<TModel>;
    deleteBy: DeleteBy<TModel>;
  }): Promise<ProjectSsoProviderWrite> {
    return await ProjectSsoProviderChanges.lockReadAndCheck({
      providerType: data.providerType,
      service: data.service,
      write: data.deleteBy,
      isDelete: true,
      decide: (rows: Array<ProjectSsoProviderRow>): ProjectSsoProviderWrite => {
        return {
          takenAway: rows.filter((row: ProjectSsoProviderRow): boolean => {
            return row.isOn;
          }),
          turnedOn: [],
        };
      },
    });
  }

  // After a delete (onDeleteSuccess): the deleted providers' projects, announced.
  public static async afterDelete(data: {
    write: ProjectSsoProviderWrite | null | undefined;
    deletedItemIds: Array<ObjectID>;
  }): Promise<void> {
    if (!data.write) {
      return;
    }

    ProjectSsoProviderChanges.announce(
      ProjectSsoProviderChanges.getProjectsOfWritten(
        data.write.takenAway,
        data.deletedItemIds,
      ),
    );

    await ProjectSsoProviderChanges.release(data.write);
  }

  /*
   * After an update or delete that failed once its before-hook had run
   * (onUpdateError, onDeleteError, with what failed): nothing was written,
   * so nobody is told, and its locks are given back at once rather than left
   * to run out - unless the database may still apply the write, when they
   * are kept until it would have cancelled it (giveBackAfterFailedWrite).
   */
  public static async afterFailedWrite(
    write: ProjectSsoProviderWrite | null | undefined,
    error: unknown,
  ): Promise<void> {
    if (!write) {
      return;
    }

    const locks: Array<SemaphoreMutex> = write.locks || [];
    write.locks = undefined;

    await ProjectSsoProviderChanges.giveBackAfterFailedWrite(locks, error);
  }

  /*
   * A project that requires SSO keeps a provider to sign in with: one it
   * requires by id (requireSsoWithSsoProviderId) cannot go, and without one
   * the last provider that is on - the project's SAML and OIDC providers
   * and the instance's global providers that sign people in to it - cannot
   * either. A project requires SSO when it says so or when the whole server
   * does (Require SSO for Login in the Admin Dashboard), as UserMiddleware
   * enforces it. Read from the database, not a cache, by the one check every
   * such change asks (SsoSignInWays): the requirement may have changed on
   * another server a moment ago.
   */
  public static async assertProjectsKeepASignIn(data: {
    providerType: ProjectSsoProviderType;
    takenAway: Array<ProjectSsoProviderRow>;
    // Keeps the change's locks while the check reads (keepSignInChange).
    keepLocks?: (() => Promise<void>) | undefined;
  }): Promise<void> {
    const stranded: StrandedProjects = await SsoSignInWays.findStrandedProjects(
      {
        projectProvidersTakenAway:
          ProjectSsoProviderChanges.toTakenAwayByProject(
            data.providerType,
            data.takenAway,
          ),
      },
      { keepLocks: data.keepLocks },
    );

    const first: StrandedProject | undefined = stranded.firstProjects[0];

    if (!first) {
      return;
    }

    if (first.reason === StrandReason.RequiredProvider) {
      throw new BadDataException(REQUIRED_SSO_PROVIDER_MESSAGE);
    }

    throw new BadDataException(
      first.requiresSsoItself
        ? LAST_SSO_PROVIDER_MESSAGE
        : SERVER_LAST_SSO_PROVIDER_MESSAGE,
    );
  }

  /*
   * Locks a change to who can sign in: each project it names, one after
   * another, always in the same order, then - when its check reads the
   * server's sign-in rules - the lock on those (SERVER_SIGN_IN_LOCK_KEY),
   * last. Every writer takes them in that order, and a change to the
   * server's rules takes only that one, so no two ever wait on each other.
   *
   * A lock another change holds for longer than any write takes refuses
   * this one: it is never checked unlocked while another change is under
   * way. When Valkey cannot be reached, the change goes on unlocked, and is
   * still checked.
   */
  public static async lockSignInChange(data: {
    projectIds: Array<string>;
    wholeServer: boolean;
  }): Promise<Array<SemaphoreMutex>> {
    const locks: Array<SemaphoreMutex> = [];

    const keys: Array<{ key: string; busyMessage: string }> = [
      ...Array.from(new Set<string>(data.projectIds))
        .sort()
        .map((projectId: string): { key: string; busyMessage: string } => {
          return {
            key: projectId,
            busyMessage: PROVIDER_CHANGE_IN_PROGRESS_MESSAGE,
          };
        }),
    ];

    if (data.wholeServer) {
      keys.push({
        key: SERVER_SIGN_IN_LOCK_KEY,
        busyMessage: SIGN_IN_CHANGE_IN_PROGRESS_MESSAGE,
      });
    }

    for (const { key, busyMessage } of keys) {
      try {
        locks.push(
          await Semaphore.lock({
            key: key,
            namespace: LOCK_NAMESPACE,
            lockTimeout: LOCK_TIMEOUT_IN_MS,
            acquireTimeout: LOCK_WAIT_IN_MS,
            // Never re-asserted: a write that fails half way leaves it to run out.
            refreshInterval: 0,
          }),
        );
      } catch (err) {
        if (err instanceof SemaphoreLockTimeoutError) {
          await ProjectSsoProviderChanges.releaseSignInChange(locks);
          throw new BadDataException(busyMessage);
        }

        logger.warn(
          `SSO sign-in change: could not lock ${key}; checking it unlocked.`,
        );
        logger.warn(err);
      }
    }

    return locks;
  }

  /*
   * Keeps a change's locks: each lasts another LOCK_TIMEOUT_IN_MS from now.
   * A check keeps them between the pages it reads and once more when it is
   * done, just before the write: so a check that reads many projects never
   * outlives its locks, and the write that follows has the whole time. A
   * lock found gone - it ran out, or Valkey lost it - refuses the change, as
   * a busy one does: another change may hold it now, and what this one read
   * may no longer be true. When Valkey cannot be reached the change goes
   * on, as it does when it could not lock.
   */
  public static async keepSignInChange(
    locks: Array<SemaphoreMutex>,
  ): Promise<void> {
    for (const lock of locks) {
      let isKept: boolean = true;

      try {
        isKept = await Semaphore.keepLock(lock);
      } catch (err) {
        logger.warn(
          "SSO sign-in change: could not keep a lock; checking it as it is.",
        );
        logger.warn(err);
        continue;
      }

      if (!isKept) {
        throw new BadDataException(SIGN_IN_CHANGE_IN_PROGRESS_MESSAGE);
      }
    }
  }

  /*
   * The last step before a checked change is written: its locks are kept
   * once more, and then kept alive while the write runs, until they are
   * given back once it is done or has failed (releaseSignInChange). So the
   * write never lands once its locks could have run out - however long the
   * database takes over it, or whatever runs between the check and the
   * write (a charge to the payment provider, another read) - and no other
   * change to the same projects or rules comes between: one that wants them
   * meanwhile waits, and is refused if it waits too long.
   *
   * A lock found gone by now - it ran out after a slow step, or Valkey lost
   * it - means another change may have come between, and what this one read
   * may no longer be true. So, with `recheck`, every lock the change holds is
   * given back and taken again, in the order every change takes them, and
   * the change is checked again under them (retakeAndRecheck): the write
   * goes on when the check still passes, and is refused only when a lock
   * cannot be taken - another change holds it longer than a change waits -
   * or the change no longer passes, or a lock is gone again by the time it
   * is checked. `locks` then holds the locks taken again - none, when the
   * change is refused - for whoever gives them back. A step between the
   * check and the write that has done something already - a card charged for
   * auto recharge - is not undone by a refusal, and never causes one on its
   * own. Without `recheck`, a lock found gone refuses the write. When Valkey
   * cannot be reached the write goes on, as a change does when it could not
   * lock at all.
   *
   * Called again for the same locks - right before the write, after an
   * earlier step held them - it keeps them once more, and they are kept
   * alive only once.
   */
  public static async holdForWrite(
    locks: Array<SemaphoreMutex>,
    recheck?: SignInChangeRecheck | undefined,
  ): Promise<void> {
    try {
      await ProjectSsoProviderChanges.keepSignInChange(locks);
    } catch (err) {
      // Gone: none of its locks is kept alive any more.
      ProjectSsoProviderChanges.stopKeepingLocks(locks);

      if (!recheck) {
        throw err;
      }

      await ProjectSsoProviderChanges.retakeAndRecheck(locks, recheck);
    }

    const unkept: Array<SemaphoreMutex> = locks.filter(
      (lock: SemaphoreMutex): boolean => {
        return !ProjectSsoProviderChanges.writeKeepers.has(lock);
      },
    );

    if (unkept.length === 0) {
      return;
    }

    /*
     * Kept alive from here - the check - through the write's statements,
     * until they are given back. What no keeping prevents is Valkey itself
     * losing a lock it keeps: a restart that keeps no data, a failover to a
     * replica the lock had not reached yet, an eviction. A lock lost that
     * way before the write is found by the keep right before it, and taken
     * again with the change checked again (retakeAndRecheck); one lost once
     * the write is under way can only be said (keepWhileWritten): no step
     * runs between the last keep and the statement that could stop Valkey
     * losing it then, so DatabaseService needs no hook of its own there.
     */
    ProjectSsoProviderChanges.startKeeping(unkept, {
      keepUntilMs: Date.now() + WRITE_KEEP_LIMIT_IN_MS,
      isAbandoned: false,
    });
  }

  /*
   * Gives back the locks of a change, and stops keeping them first. Never
   * throws: a lock not given back runs out.
   */
  public static async releaseSignInChange(
    locks: Array<SemaphoreMutex>,
  ): Promise<void> {
    ProjectSsoProviderChanges.stopKeepingLocks(locks);

    for (const lock of locks) {
      try {
        await Semaphore.release(lock);
      } catch (err) {
        logger.warn("SSO sign-in change: could not give a lock back.");
        logger.warn(err);
      }
    }
  }

  /*
   * Once the write of a checked change failed (the services' error hooks,
   * with what failed): its locks are given back at once - unless the
   * database may still apply the write. A statement whose client stopped
   * waiting for it (DATABASE_QUERY_TIMEOUT_MS), or lost the connection while
   * it ran, may still be running, and land, after it was reported as failed
   * (StatementOutcome). Its locks are then kept until the database would
   * have cancelled it (keepUntilAbandonedWriteEnds), so no other change to
   * who can sign in is checked against rows it may still change. Never
   * throws.
   */
  public static async giveBackAfterFailedWrite(
    locks: Array<SemaphoreMutex>,
    error: unknown,
  ): Promise<void> {
    if (locks.length > 0 && StatementOutcome.isUnknown(error)) {
      ProjectSsoProviderChanges.keepUntilAbandonedWriteEnds(locks);
      return;
    }

    await ProjectSsoProviderChanges.releaseSignInChange(locks);
  }

  /*
   * The locks of a change whose write the database may still apply, after
   * the client was told it failed: never given back, they are kept alive
   * ABANDONED_WRITE_HOLD_IN_MS from now - the database's statement timeout,
   * and a margin - and then left to run out (LOCK_TIMEOUT_IN_MS later).
   * Never throws.
   */
  public static keepUntilAbandonedWriteEnds(
    locks: Array<SemaphoreMutex>,
  ): void {
    const keepUntilMs: number = Date.now() + ABANDONED_WRITE_HOLD_IN_MS;

    logger.warn(
      `SSO sign-in change: its write failed without an answer from the database, which may still apply it; its locks are kept ${Math.round(
        ABANDONED_WRITE_HOLD_IN_MS / 1000,
      )} seconds, until the database would have cancelled it, and then run out.`,
    );

    const unkept: Array<SemaphoreMutex> = [];

    for (const lock of locks) {
      const keeper: WriteKeeper | undefined =
        ProjectSsoProviderChanges.writeKeepers.get(lock);

      if (!keeper || keeper.isStopped) {
        unkept.push(lock);
        continue;
      }

      keeper.isAbandoned = true;
      keeper.keepUntilMs = Math.max(keeper.keepUntilMs, keepUntilMs);
    }

    if (unkept.length > 0) {
      ProjectSsoProviderChanges.startKeeping(unkept, {
        keepUntilMs,
        isAbandoned: true,
      });
    }
  }

  // Whether a lock is being kept alive for a change that is being written (holdForWrite).
  public static isKeptForWrite(lock: SemaphoreMutex): boolean {
    return ProjectSsoProviderChanges.writeKeepers.has(lock);
  }

  /*
   * A lock of a checked change found gone right before its write
   * (holdForWrite): every lock the change still holds is given back, so that
   * all of them are taken again in the order every change takes them - the
   * projects', then the one on the server's sign-in rules - and none waits
   * for another while holding one; the change is then checked again from the
   * start under them (`recheck`), and its locks kept once more. `locks` ends
   * holding the locks taken again. Throws when a lock cannot be taken, the
   * change no longer passes, or a lock taken again is gone already: then
   * `locks` holds none, and nothing is held.
   */
  private static async retakeAndRecheck(
    locks: Array<SemaphoreMutex>,
    recheck: SignInChangeRecheck,
  ): Promise<void> {
    logger.warn(
      "SSO sign-in change: a lock was gone right before the change was written; it is taken again, and the change checked again.",
    );

    const given: Array<SemaphoreMutex> = locks.splice(0, locks.length);
    await ProjectSsoProviderChanges.releaseSignInChange(given);

    // Taken again, and checked again under them: refused, it has given back what it took.
    const retaken: Array<SemaphoreMutex> = await recheck();

    try {
      await ProjectSsoProviderChanges.keepSignInChange(retaken);
    } catch (err) {
      await ProjectSsoProviderChanges.releaseSignInChange(retaken);
      throw err;
    }

    locks.push(...retaken);
  }

  // Keeps these locks alive, every WRITE_KEEP_INTERVAL_IN_MS, until the time given.
  private static startKeeping(
    locks: Array<SemaphoreMutex>,
    data: { keepUntilMs: number; isAbandoned: boolean },
  ): void {
    const keeper: WriteKeeper = {
      locks: locks,
      keepUntilMs: data.keepUntilMs,
      isAbandoned: data.isAbandoned,
      isStopped: false,
      isKeeping: false,
      timer: setInterval((): void => {
        ProjectSsoProviderChanges.keepWhileWritten(keeper).catch(
          (err: unknown): void => {
            logger.warn(err);
          },
        );
      }, WRITE_KEEP_INTERVAL_IN_MS),
    };

    // Never keeps the process alive on its own.
    keeper.timer.unref?.();

    for (const lock of locks) {
      ProjectSsoProviderChanges.writeKeepers.set(lock, keeper);
    }
  }

  // Keeps these locks alive no more, whichever keeper keeps them.
  private static stopKeepingLocks(locks: Array<SemaphoreMutex>): void {
    for (const lock of locks) {
      const keeper: WriteKeeper | undefined =
        ProjectSsoProviderChanges.writeKeepers.get(lock);

      if (keeper) {
        ProjectSsoProviderChanges.stopKeeping(keeper);
      }
    }
  }

  /*
   * One round of keeping the locks of a change being written: each lasts
   * another LOCK_TIMEOUT_IN_MS. Never throws. A lock found gone can no
   * longer refuse the write, which may already be under way: it is said
   * loudly, and kept no more. One that cannot be kept for want of Valkey
   * is tried again next round, and a round still waiting on Valkey is not
   * started again. Past the time the keeper keeps them until - its check's
   * WRITE_KEEP_LIMIT_IN_MS, or, for a write the database may still apply,
   * the end of ABANDONED_WRITE_HOLD_IN_MS - nothing more is kept, a round
   * that never came back included.
   */
  private static async keepWhileWritten(keeper: WriteKeeper): Promise<void> {
    if (keeper.isStopped) {
      return;
    }

    if (Date.now() >= keeper.keepUntilMs) {
      ProjectSsoProviderChanges.stopKeeping(keeper);

      if (keeper.isAbandoned) {
        logger.warn(
          "SSO sign-in change: the write that failed without an answer from the database can no longer land; its locks are no longer kept, and run out.",
        );
        return;
      }

      logger.error(
        `SSO sign-in change: still being written ${Math.round(
          WRITE_KEEP_LIMIT_IN_MS / 1000,
        )} seconds after its check; its locks are no longer kept, and run out.`,
      );
      return;
    }

    if (keeper.isKeeping) {
      return;
    }

    keeper.isKeeping = true;

    try {
      for (const lock of [...keeper.locks]) {
        if (keeper.isStopped) {
          return;
        }

        let isKept: boolean = true;

        try {
          isKept = await Semaphore.keepLock(lock);
        } catch (err) {
          logger.warn(
            "SSO sign-in change: could not keep a lock while its change was written; trying again.",
          );
          logger.warn(err);
          continue;
        }

        // Given back while this round ran: the change is done.
        if (isKept || keeper.isStopped) {
          continue;
        }

        keeper.locks = keeper.locks.filter((kept: SemaphoreMutex): boolean => {
          return kept !== lock;
        });
        ProjectSsoProviderChanges.writeKeepers.delete(lock);

        logger.error(
          "SSO sign-in change: a lock was lost while its change was being written; another change to who can sign in may have been written at the same time.",
        );
      }

      if (keeper.locks.length === 0) {
        ProjectSsoProviderChanges.stopKeeping(keeper);
      }
    } finally {
      keeper.isKeeping = false;
    }
  }

  // Keeps a change's locks no more: given back, or past the limit.
  private static stopKeeping(keeper: WriteKeeper): void {
    keeper.isStopped = true;
    clearInterval(keeper.timer);

    for (const lock of keeper.locks) {
      if (ProjectSsoProviderChanges.writeKeepers.get(lock) === keeper) {
        ProjectSsoProviderChanges.writeKeepers.delete(lock);
      }
    }
  }

  /*
   * The rows a write names and what it does to them, read under a lock on
   * each project they are in, so no other turn off, turn on or delete of
   * those projects' providers comes between what this write reads and what
   * it writes. The rows are read once to learn their projects - a write
   * that reaches no provider takes no lock, and writes nothing - the
   * projects are locked, and the rows are read again. Read again, they must
   * stay within the projects locked: a write whose filter now reaches
   * another project - a provider created, or moved, there in between - is
   * refused, to be saved again.
   *
   * The write then goes to exactly the rows read under the locks
   * (writeOnlyTheRowsRead): a row that comes to match its filter later - a
   * provider created, renamed or turned on a moment after - was never
   * checked, and is left alone; a write whose rows read under the locks are
   * none writes nothing that is there, a hard delete included, which may
   * only purge rows deleted before. No write turns off or deletes a
   * provider its check did not read under a lock.
   *
   * A write that takes a provider away is checked. When a project it
   * touches would be left none of its own providers on, or loses the one it
   * requires, the project relies on the server's sign-in rules - the global
   * providers, the server's Require SSO for Login - so the write locks
   * those too, after the projects, and is checked under every lock, kept
   * while the check reads. Otherwise each project keeps a provider of its
   * own whatever the server's rules are, and the write needs no check and
   * no other lock (SsoSignInWays.dependsOnServerRules).
   *
   * The locks are kept for the write from here (holdForWrite) - again
   * right before an update, which has a later hook (beforeWrite) - and held
   * until it is done (afterUpdate, afterDelete) or fails
   * (afterFailedWrite), or given back at once when it is refused or reaches
   * no row. A lock found gone by then is taken again, and the rows read and
   * checked again under the locks, into the same write (`recheck`). Without
   * Valkey the write still reads and checks, unlocked.
   */
  private static async lockReadAndCheck<TModel extends BaseModel>(data: {
    providerType: ProjectSsoProviderType;
    service: DatabaseService<TModel>;
    // The update or delete, narrowed here to the rows it read under the locks.
    write: UpdateBy<TModel> | DeleteBy<TModel>;
    // A delete, which - as a hard delete - also reaches rows deleted before.
    isDelete: boolean;
    decide: (rows: Array<ProjectSsoProviderRow>) => ProjectSsoProviderWrite;
  }): Promise<ProjectSsoProviderWrite> {
    const write: ProjectSsoProviderWrite =
      await ProjectSsoProviderChanges.lockReadAndCheckRows(data);

    const locks: Array<SemaphoreMutex> | undefined = write.locks;

    // Nothing it writes is there: nothing to hold.
    if (!locks) {
      return write;
    }

    // The same check, from the start: what the write does is worked out again, here.
    write.recheck = async (): Promise<Array<SemaphoreMutex>> => {
      const again: ProjectSsoProviderWrite =
        await ProjectSsoProviderChanges.lockReadAndCheckRows(data);

      write.takenAway = again.takenAway;
      write.turnedOn = again.turnedOn;

      return again.locks || [];
    };

    try {
      // Checked: its locks are kept for the write until it is done.
      await ProjectSsoProviderChanges.holdForWrite(locks, write.recheck);
    } catch (err) {
      await ProjectSsoProviderChanges.releaseSignInChange(locks);
      throw err;
    }

    return write;
  }

  /*
   * The check of lockReadAndCheck, run once more should a lock be found
   * gone before the write: the rows read, their projects locked, the rows
   * read again under the locks and checked, the write held to them. What it
   * answers holds the locks it took - none when nothing it names is there -
   * which it gives back when it throws.
   */
  private static async lockReadAndCheckRows<TModel extends BaseModel>(data: {
    providerType: ProjectSsoProviderType;
    service: DatabaseService<TModel>;
    write: UpdateBy<TModel> | DeleteBy<TModel>;
    isDelete: boolean;
    decide: (rows: Array<ProjectSsoProviderRow>) => ProjectSsoProviderWrite;
  }): Promise<ProjectSsoProviderWrite> {
    const readNow: () => Promise<
      Array<ProjectSsoProviderRow>
    > = async (): Promise<Array<ProjectSsoProviderRow>> => {
      return await ProjectSsoProviderChanges.readRows({
        service: data.service,
        query: data.write.query,
        limit: data.write.limit,
        skip: data.write.skip,
      });
    };

    // Read once, unlocked, only to learn which projects to lock.
    const lockedProjectIds: Array<string> = Array.from(
      ProjectSsoProviderChanges.groupByProject(await readNow()).keys(),
    );

    // It reaches no provider: nothing to lock or check, and nothing to write.
    if (lockedProjectIds.length === 0) {
      ProjectSsoProviderChanges.writeOnlyTheRowsRead({
        service: data.service,
        write: data.write,
        rowIds: [],
        isDelete: data.isDelete,
      });

      return { takenAway: [], turnedOn: [] };
    }

    const locks: Array<SemaphoreMutex> =
      await ProjectSsoProviderChanges.lockSignInChange({
        projectIds: lockedProjectIds,
        wholeServer: false,
      });

    try {
      const rows: Array<ProjectSsoProviderRow> = await readNow();

      /*
       * Read under the projects' locks, a write that names its rows by a
       * filter may now reach a project it did not lock - a provider
       * created, or moved, there in between - whose own changes it could
       * then overtake. It is refused, to be saved again.
       */
      const locked: Set<string> = new Set<string>(lockedProjectIds);

      if (
        rows.some((row: ProjectSsoProviderRow): boolean => {
          return !locked.has(row.projectId);
        })
      ) {
        throw new BadDataException(PROVIDER_CHANGE_IN_PROGRESS_MESSAGE);
      }

      ProjectSsoProviderChanges.writeOnlyTheRowsRead({
        service: data.service,
        write: data.write,
        rowIds: ProjectSsoProviderChanges.idsOf(rows),
        isDelete: data.isDelete,
      });

      // Nothing it writes is there: nothing to check, and nothing to hold.
      if (rows.length === 0) {
        await ProjectSsoProviderChanges.releaseSignInChange(locks);
        return { takenAway: [], turnedOn: [] };
      }

      const write: ProjectSsoProviderWrite = data.decide(rows);

      write.locks = locks;

      if (
        write.takenAway.length > 0 &&
        (await SsoSignInWays.dependsOnServerRules({
          projectProvidersTakenAway:
            ProjectSsoProviderChanges.toTakenAwayByProject(
              data.providerType,
              write.takenAway,
            ),
        }))
      ) {
        // Taken after the projects' locks, as every writer takes them.
        locks.push(
          ...(await ProjectSsoProviderChanges.lockSignInChange({
            projectIds: [],
            wholeServer: true,
          })),
        );

        await ProjectSsoProviderChanges.assertProjectsKeepASignIn({
          providerType: data.providerType,
          takenAway: write.takenAway,
          keepLocks: async (): Promise<void> => {
            await ProjectSsoProviderChanges.keepSignInChange(locks);
          },
        });
      }

      return write;
    } catch (err) {
      await ProjectSsoProviderChanges.releaseSignInChange(locks);
      throw err;
    }
  }

  /*
   * Holds a write to the rows its check read under its locks, by their ids,
   * on top of its own filter: a row that matches the filter only later was
   * never checked, and one that stops matching it is left alone too. Its
   * window becomes those rows. A write that read none under its locks
   * writes nothing.
   *
   * A delete that read none may still reach rows deleted before - only a
   * hard delete does: the retention job's purge removes them a month on -
   * which no read here sees and which sign nobody in, but no other row: its
   * filter is held to rows deleted before (deletedAt set), together with
   * whatever it asks of deletedAt itself. One that read rows is held to
   * them like any other write; rows deleted before that it also matched are
   * purged on its next pass.
   *
   * Every sign-in change that names its rows by a filter writes through
   * here: a project's providers (lockReadAndCheck), the global providers
   * and their attachments (GlobalSsoProviderChanges), and the projects
   * whose Require SSO for Login is turned on (SsoRequirementChanges).
   */
  public static writeOnlyTheRowsRead<TModel extends BaseModel>(data: {
    service: DatabaseService<TModel>;
    write: UpdateBy<TModel> | DeleteBy<TModel>;
    // The rows the change read under its locks, and checked.
    rowIds: Array<string>;
    isDelete: boolean;
  }): void {
    const ids: Array<string> = data.rowIds;

    const toTheRowsRead: (query: Query<TModel>) => Query<TModel> = (
      query: Query<TModel>,
    ): Query<TModel> => {
      if (ids.length === 0 && data.isDelete) {
        return {
          ...query,
          deletedAt: ProjectSsoProviderChanges.onlyRowsDeletedBefore(
            data.service,
            query,
          ),
        } as Query<TModel>;
      }

      return {
        ...query,
        _id: QueryHelper.any(ids),
      } as Query<TModel>;
    };

    // A query per project (several filters, any of which may match) is held branch by branch.
    const query: unknown = data.write.query;

    data.write.query = Array.isArray(query)
      ? (query.map((branch: Query<TModel>): Query<TModel> => {
          return toTheRowsRead(branch);
        }) as unknown as Query<TModel>)
      : toTheRowsRead(data.write.query);

    if (ids.length > 0) {
      data.write.skip = 0;
      data.write.limit = ids.length;
    }
  }

  // The ids of the rows a check read, to hold its write to (writeOnlyTheRowsRead).
  public static idsOf(rows: Array<{ id: string }>): Array<string> {
    return rows.map((row: { id: string }): string => {
      return row.id;
    });
  }

  /*
   * A delete's condition on deletedAt that reaches only rows deleted before:
   * deletedAt is set, and - when the delete asks something of deletedAt
   * itself, as the retention job's purge asks for rows deleted a month ago
   * - that too.
   */
  private static onlyRowsDeletedBefore<TModel extends BaseModel>(
    service: DatabaseService<TModel>,
    query: Query<TModel>,
  ): FindOperator<unknown> {
    const deletedBefore: FindOperator<unknown> = QueryHelper.notNull();
    const asked: unknown = (query as Record<string, unknown>)["deletedAt"];

    if (asked === undefined) {
      return deletedBefore;
    }

    // What it asks, as the database is asked it: a value, or one of the query types.
    const askedOfDatabase: unknown =
      asked instanceof FindOperator
        ? asked
        : (
            QueryUtil.serializeQuery(service.modelType, {
              deletedAt: asked,
            } as Query<TModel>) as Record<string, unknown>
          )["deletedAt"];

    return And(
      askedOfDatabase instanceof FindOperator
        ? (askedOfDatabase as FindOperator<unknown>)
        : Equal(askedOfDatabase),
      deletedBefore,
    );
  }

  // The providers a write takes away, by project, as the check reads them.
  private static toTakenAwayByProject(
    providerType: ProjectSsoProviderType,
    takenAway: Array<ProjectSsoProviderRow>,
  ): Map<string, Array<{ providerType: ProjectSsoProviderType; id: string }>> {
    const byProject: Map<
      string,
      Array<{ providerType: ProjectSsoProviderType; id: string }>
    > = new Map<
      string,
      Array<{ providerType: ProjectSsoProviderType; id: string }>
    >();

    for (const [projectId, ids] of ProjectSsoProviderChanges.groupByProject(
      takenAway,
    )) {
      byProject.set(
        projectId,
        Array.from(ids).map(
          (
            id: string,
          ): { providerType: ProjectSsoProviderType; id: string } => {
            return { providerType: providerType, id };
          },
        ),
      );
    }

    return byProject;
  }

  // Gives back the write's locks, once.
  private static async release(write: ProjectSsoProviderWrite): Promise<void> {
    const locks: Array<SemaphoreMutex> = write.locks || [];
    write.locks = undefined;

    await ProjectSsoProviderChanges.releaseSignInChange(locks);
  }

  private static groupByProject(
    rows: Array<ProjectSsoProviderRow>,
  ): Map<string, Set<string>> {
    const byProject: Map<string, Set<string>> = new Map<string, Set<string>>();

    for (const row of rows) {
      const ids: Set<string> =
        byProject.get(row.projectId) || new Set<string>();
      ids.add(row.id);
      byProject.set(row.projectId, ids);
    }

    return byProject;
  }

  /*
   * Every server forgets what it knew about the projects' providers and
   * asks the live updates open in them again (RealtimeAccessChanges). This
   * server forgets here, at once, whatever the announcement does.
   */
  private static announce(projectIds: Array<string>): void {
    for (const projectId of new Set<string>(projectIds)) {
      ProjectSsoProviderStanding.forget(projectId);

      RealtimeAccessChanges.announce({
        kind: RealtimeAccessChangeKind.SignInRulesChanged,
        projectId: projectId,
      });
    }
  }

  // The projects of the rows the write actually wrote.
  private static getProjectsOfWritten(
    rows: Array<ProjectSsoProviderRow>,
    writtenIds: Array<ObjectID>,
  ): Array<string> {
    const written: Set<string> = new Set<string>(
      writtenIds.map((id: ObjectID): string => {
        return id.toString().toLowerCase();
      }),
    );

    return rows
      .filter((row: ProjectSsoProviderRow): boolean => {
        return written.has(row.id);
      })
      .map((row: ProjectSsoProviderRow): string => {
        return row.projectId;
      });
  }

  // The rows a write names: their ids, projects, and whether they are on.
  private static async readRows<TModel extends BaseModel>(data: {
    service: DatabaseService<TModel>;
    query: Query<TModel>;
    limit: PositiveNumber | number;
    skip: PositiveNumber | number;
  }): Promise<Array<ProjectSsoProviderRow>> {
    const rows: Array<TModel> = await data.service.findAllBy({
      query: data.query,
      select: {
        _id: true,
        projectId: true,
        isEnabled: true,
      } as unknown as Select<TModel>,
      limit: data.limit,
      skip: data.skip,
      props: {
        isRoot: true,
      },
    });

    const providerRows: Array<ProjectSsoProviderRow> = [];

    for (const row of rows) {
      const record: Record<string, unknown> = row as unknown as Record<
        string,
        unknown
      >;
      const id: string | undefined = row.id?.toString().toLowerCase();
      const projectId: string | undefined = record["projectId"]
        ? String(record["projectId"]).toLowerCase()
        : undefined;

      if (!id || !projectId) {
        continue;
      }

      providerRows.push({
        id: id,
        projectId: projectId,
        isOn: record["isEnabled"] === true,
      });
    }

    return providerRows;
  }
}
