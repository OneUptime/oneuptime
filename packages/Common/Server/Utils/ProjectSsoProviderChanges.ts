import BaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import PositiveNumber from "../../Types/PositiveNumber";
import Semaphore, {
  SemaphoreLockTimeoutError,
  SemaphoreMutex,
} from "../Infrastructure/Semaphore";
import DatabaseService from "../Services/DatabaseService";
import Query from "../Types/Database/Query";
import Select from "../Types/Database/Select";
import UpdateBy from "../Types/Database/UpdateBy";
import DeleteBy from "../Types/Database/DeleteBy";
import logger from "./Logger";
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
 *     none can miss a provider another turned on a moment before. One that
 *     may take a provider away also holds the lock on the server's sign-in
 *     rules (lockSignInChange): its check counts the global providers and
 *     reads the server's Require SSO for Login, which global changes write
 *     under that lock.
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
   * server's sign-in rules when it may take a provider away, from before
   * they were read until the write is done (afterUpdate/afterDelete). A
   * write that fails in between leaves them to run out
   * (LOCK_TIMEOUT_IN_MS).
   */
  locks?: Array<SemaphoreMutex> | undefined;
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

// How long a lock is held at most: a read, a check and one write.
const LOCK_TIMEOUT_IN_MS: number = 10_000;

/*
 * How long a write waits for a lock: longer than a lock can be held, so one
 * a failed write never gave back runs out before a write waiting for it
 * gives up.
 */
const LOCK_WAIT_IN_MS: number = 15_000;

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
        query: data.updateBy.query,
        limit: data.updateBy.limit,
        skip: data.updateBy.skip,
        mayTakeAway: isEnabled === false,
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
   * onUpdatePermitted, once every permission check has passed): an update
   * that turns a provider off writes when, in the same write
   * (SsoSignInsEnded.stampWhenTurnedOff), using what beforeUpdate found
   * under the lock, or - for an update that did not pass it - the rows now.
   */
  public static async beforeWrite<TModel extends BaseModel>(data: {
    service: DatabaseService<TModel>;
    updateBy: UpdateBy<TModel>;
  }): Promise<void> {
    const write: ProjectSsoProviderWrite | undefined =
      ProjectSsoProviderChanges.writesByUpdate.get(
        data.updateBy as unknown as UpdateBy<BaseModel>,
      );

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
   * Before a delete (onBeforeDelete, with the rows the caller may delete):
   * the providers it takes away that were on, read under the projects'
   * lock, refused when that would leave a project that requires SSO with
   * no provider to sign in with.
   */
  public static async beforeDelete<TModel extends BaseModel>(data: {
    providerType: ProjectSsoProviderType;
    service: DatabaseService<TModel>;
    deleteBy: DeleteBy<TModel>;
  }): Promise<ProjectSsoProviderWrite> {
    return await ProjectSsoProviderChanges.lockReadAndCheck({
      providerType: data.providerType,
      service: data.service,
      query: data.deleteBy.query,
      limit: data.deleteBy.limit,
      skip: data.deleteBy.skip,
      mayTakeAway: true,
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
  }): Promise<void> {
    const takenAwayByProject: Map<
      string,
      Array<{ providerType: ProjectSsoProviderType; id: string }>
    > = new Map<
      string,
      Array<{ providerType: ProjectSsoProviderType; id: string }>
    >();

    for (const [projectId, ids] of ProjectSsoProviderChanges.groupByProject(
      data.takenAway,
    )) {
      takenAwayByProject.set(
        projectId,
        Array.from(ids).map(
          (id: string): { providerType: ProjectSsoProviderType; id: string } => {
            return { providerType: data.providerType, id };
          },
        ),
      );
    }

    const stranded: StrandedProjects = await SsoSignInWays.findStrandedProjects(
      {
        projectProvidersTakenAway: takenAwayByProject,
      },
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

  // Gives back the locks of a change. Never throws: a lock not given back runs out.
  public static async releaseSignInChange(
    locks: Array<SemaphoreMutex>,
  ): Promise<void> {
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
   * The rows a write names and what it does to them, read under a lock on
   * each of their projects: the rows are read once to learn the projects,
   * the projects are locked, and the rows are read again, so no other turn
   * off, turn on or delete of the projects' providers comes between what
   * this write reads and what it writes. A write that may take a provider
   * away also locks the server's sign-in rules, which its check reads, and
   * is checked under the same locks. They are held until the write is done
   * (afterUpdate, afterDelete), or given back at once when it is refused.
   * Without Valkey the write still reads and checks, unlocked.
   */
  private static async lockReadAndCheck<TModel extends BaseModel>(data: {
    providerType: ProjectSsoProviderType;
    service: DatabaseService<TModel>;
    query: Query<TModel>;
    limit: PositiveNumber | number;
    skip: PositiveNumber | number;
    mayTakeAway: boolean;
    decide: (rows: Array<ProjectSsoProviderRow>) => ProjectSsoProviderWrite;
  }): Promise<ProjectSsoProviderWrite> {
    const rowsToLock: Array<ProjectSsoProviderRow> =
      await ProjectSsoProviderChanges.readRows({
        service: data.service,
        query: data.query,
        limit: data.limit,
        skip: data.skip,
      });

    if (rowsToLock.length === 0) {
      return { takenAway: [], turnedOn: [] };
    }

    const locks: Array<SemaphoreMutex> =
      await ProjectSsoProviderChanges.lockSignInChange({
        projectIds: Array.from(
          ProjectSsoProviderChanges.groupByProject(rowsToLock).keys(),
        ),
        wholeServer: data.mayTakeAway,
      });

    try {
      const write: ProjectSsoProviderWrite = data.decide(
        await ProjectSsoProviderChanges.readRows({
          service: data.service,
          query: data.query,
          limit: data.limit,
          skip: data.skip,
        }),
      );

      write.locks = locks;

      if (write.takenAway.length > 0) {
        await ProjectSsoProviderChanges.assertProjectsKeepASignIn({
          providerType: data.providerType,
          takenAway: write.takenAway,
        });
      }

      return write;
    } catch (err) {
      await ProjectSsoProviderChanges.releaseSignInChange(locks);
      throw err;
    }
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
