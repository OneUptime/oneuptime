import BaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import GlobalConfig from "../../Models/DatabaseModels/GlobalConfig";
import GlobalOidc from "../../Models/DatabaseModels/GlobalOidc";
import GlobalSso from "../../Models/DatabaseModels/GlobalSso";
import Project from "../../Models/DatabaseModels/Project";
import { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import OneUptimeDate from "../../Types/Date";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import PositiveNumber from "../../Types/PositiveNumber";
import SsoProviderType from "../../Types/SSO/SsoProviderType";
import Semaphore, {
  SemaphoreLockTimeoutError,
  SemaphoreMutex,
} from "../Infrastructure/Semaphore";
import DatabaseService from "../Services/DatabaseService";
import GlobalConfigService from "../Services/GlobalConfigService";
import GlobalOidcProjectService from "../Services/GlobalOidcProjectService";
import GlobalOidcService from "../Services/GlobalOidcService";
import GlobalSsoProjectService from "../Services/GlobalSsoProjectService";
import GlobalSsoService from "../Services/GlobalSsoService";
import ProjectOidcService from "../Services/ProjectOidcService";
import ProjectService from "../Services/ProjectService";
import ProjectSsoService from "../Services/ProjectSsoService";
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

/*
 * TURNING A PROJECT'S SSO PROVIDER OFF, OR DELETING IT, ENDS THE SIGN-INS IT
 * GAVE.
 *
 * What the project's SAML and OIDC provider services do when a write turns a
 * provider off or on, or deletes it (ProjectSsoService, ProjectOidcService):
 *
 *   - turning one off writes when (signInsEndedAt), in the same write: the
 *     sign-ins it gave before then stop counting, and turning it on again
 *     does not bring them back (ProjectSsoProviderStanding);
 *   - every server forgets what it knew about the project's providers and
 *     asks the live updates open in the project again, as their joins were
 *     asked (RealtimeAccessChanges, SignInRulesChanged): a page signed in
 *     with a provider that was turned off or deleted stops hearing, and is
 *     told to sign in again, at once. A provider turned on is announced
 *     too, so no server keeps answering "off" for a minute;
 *   - a project that requires SSO - itself, or because the whole server
 *     does - keeps a way in: the last provider that can sign people in to
 *     it, or the one provider it requires, cannot be turned off or deleted;
 *   - a write that turns a project's provider off or on, or deletes one,
 *     holds a lock on the project from before it reads the providers until
 *     it is written, so what it read is still true when it lands: two
 *     writes at once cannot each take away what the other counted on, and
 *     none can miss a provider another turned on a moment before.
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
   * The locks held on the projects of the rows the write names, from before
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

// How long a project's lock is held at most: a read, a check and one write.
const LOCK_TIMEOUT_IN_MS: number = 10_000;

/*
 * How long a write waits for a project's lock: longer than a lock can be
 * held, so one a failed write never gave back runs out before a write
 * waiting for it gives up.
 */
const LOCK_WAIT_IN_MS: number = 15_000;

const LOCK_NAMESPACE: string = "ProjectSsoProviderChanges.keepAWayIn";

interface GlobalProviderRow {
  id: ObjectID;
  restrictToAttachedProjects: boolean;
}

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
        const signInsEndedAt: unknown = record["signInsEndedAt"];

        return {
          isOn: record["isEnabled"] === true,
          signInsEndedAtMs: signInsEndedAt
            ? new Date(signInsEndedAt as Date).getTime()
            : null,
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
    const isEnabled: unknown = ProjectSsoProviderChanges.getWrittenIsEnabled(
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
   * that turns a provider off writes when, in the same write, so a provider
   * is never off without the time its sign-ins ended. An update that turns
   * none off - every provider it names is off already - keeps the times
   * they have. One that turns several off gives each the same time, one
   * that was off already included: a provider that is off gives no
   * sign-ins, so a later time ends none that an earlier one did not.
   */
  public static async beforeWrite<TModel extends BaseModel>(data: {
    service: DatabaseService<TModel>;
    updateBy: UpdateBy<TModel>;
  }): Promise<void> {
    if (
      ProjectSsoProviderChanges.getWrittenIsEnabled(data.updateBy.data) !==
      false
    ) {
      return;
    }

    // What beforeUpdate found, or - for an update that did not pass it - the rows now.
    const write: ProjectSsoProviderWrite | undefined =
      ProjectSsoProviderChanges.writesByUpdate.get(
        data.updateBy as unknown as UpdateBy<BaseModel>,
      );

    const turnsOneOff: boolean = write
      ? write.takenAway.length > 0
      : (
          await ProjectSsoProviderChanges.readRows({
            service: data.service,
            query: data.updateBy.query,
            limit: data.updateBy.limit,
            skip: data.updateBy.skip,
          })
        ).some((row: ProjectSsoProviderRow): boolean => {
          return row.isOn;
        });

    if (!turnsOneOff) {
      return;
    }

    (data.updateBy.data as unknown as Record<string, unknown>)[
      "signInsEndedAt"
    ] = OneUptimeDate.getCurrentDate();
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
   * enforces it. Read from the database, not a cache: the requirement may
   * have changed on another server a moment ago.
   */
  public static async assertProjectsKeepASignIn(data: {
    providerType: ProjectSsoProviderType;
    takenAway: Array<ProjectSsoProviderRow>;
  }): Promise<void> {
    const takenAwayByProject: Map<
      string,
      Set<string>
    > = ProjectSsoProviderChanges.groupByProject(data.takenAway);

    let serverRequiresSso: boolean | null = null;

    for (const [projectId, takenAwayIds] of takenAwayByProject) {
      const project: Project | null = await ProjectService.findOneById({
        id: new ObjectID(projectId),
        select: {
          _id: true,
          requireSsoForLogin: true,
          requireSsoWithSsoProviderId: true,
        },
        props: {
          isRoot: true,
        },
      });

      if (!project) {
        continue;
      }

      const projectRequiresSso: boolean = Boolean(project.requireSsoForLogin);

      if (!projectRequiresSso) {
        if (serverRequiresSso === null) {
          serverRequiresSso =
            await ProjectSsoProviderChanges.doesServerRequireSso();
        }

        if (!serverRequiresSso) {
          continue;
        }
      }

      const requiredProviderId: string | null =
        project.requireSsoWithSsoProviderId
          ? project.requireSsoWithSsoProviderId.toString().toLowerCase()
          : null;

      if (requiredProviderId) {
        if (takenAwayIds.has(requiredProviderId)) {
          throw new BadDataException(REQUIRED_SSO_PROVIDER_MESSAGE);
        }

        // Only that provider lets anyone in: this one never did.
        continue;
      }

      if (
        await ProjectSsoProviderChanges.hasAnotherProviderOn({
          projectId: new ObjectID(projectId),
          providerType: data.providerType,
          takenAwayIds: takenAwayIds,
        })
      ) {
        continue;
      }

      throw new BadDataException(
        projectRequiresSso
          ? LAST_SSO_PROVIDER_MESSAGE
          : SERVER_LAST_SSO_PROVIDER_MESSAGE,
      );
    }
  }

  /*
   * The rows a write names and what it does to them, read under a lock on
   * each of their projects: the rows are read once to learn the projects,
   * the projects are locked, and the rows are read again, so no other turn
   * off, turn on or delete of the projects' providers comes between what
   * this write reads and what it writes. A write that takes a provider away
   * is checked under the same lock. The lock is held until the write is
   * done (afterUpdate, afterDelete), or given back at once when it is
   * refused. Without Valkey the write still reads and checks, unlocked.
   */
  private static async lockReadAndCheck<TModel extends BaseModel>(data: {
    providerType: ProjectSsoProviderType;
    service: DatabaseService<TModel>;
    query: Query<TModel>;
    limit: PositiveNumber | number;
    skip: PositiveNumber | number;
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
      await ProjectSsoProviderChanges.lockProjects(
        Array.from(ProjectSsoProviderChanges.groupByProject(rowsToLock).keys()),
      );

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
      await ProjectSsoProviderChanges.releaseLocks(locks);
      throw err;
    }
  }

  /*
   * One project after another, always in the same order, so two writes
   * never wait on each other. A lock another write holds for longer than
   * any write takes refuses this one: it is never checked unlocked while
   * another change is under way. When Valkey cannot be reached, the write
   * goes on unlocked.
   */
  private static async lockProjects(
    projectIds: Array<string>,
  ): Promise<Array<SemaphoreMutex>> {
    const locks: Array<SemaphoreMutex> = [];

    for (const projectId of [...projectIds].sort()) {
      try {
        locks.push(
          await Semaphore.lock({
            key: projectId,
            namespace: LOCK_NAMESPACE,
            lockTimeout: LOCK_TIMEOUT_IN_MS,
            acquireTimeout: LOCK_WAIT_IN_MS,
            // Never re-asserted: a write that fails half way leaves it to run out.
            refreshInterval: 0,
          }),
        );
      } catch (err) {
        if (err instanceof SemaphoreLockTimeoutError) {
          await ProjectSsoProviderChanges.releaseLocks(locks);
          throw new BadDataException(PROVIDER_CHANGE_IN_PROGRESS_MESSAGE);
        }

        logger.warn(
          `SSO provider change: could not lock project ${projectId}; checking it unlocked.`,
        );
        logger.warn(err);
      }
    }

    return locks;
  }

  // Gives back the write's locks, once.
  private static async release(write: ProjectSsoProviderWrite): Promise<void> {
    const locks: Array<SemaphoreMutex> = write.locks || [];
    write.locks = undefined;

    await ProjectSsoProviderChanges.releaseLocks(locks);
  }

  // Never throws: a lock not given back runs out.
  private static async releaseLocks(
    locks: Array<SemaphoreMutex>,
  ): Promise<void> {
    for (const lock of locks) {
      try {
        await Semaphore.release(lock);
      } catch (err) {
        logger.warn("SSO provider change: could not give a project lock back.");
        logger.warn(err);
      }
    }
  }

  // Whether the whole server requires SSO, read from the database.
  private static async doesServerRequireSso(): Promise<boolean> {
    const config: GlobalConfig | null = await GlobalConfigService.findOneBy({
      query: {},
      select: {
        requireSsoForLogin: true,
      },
      props: {
        isRoot: true,
      },
    });

    return Boolean(config?.requireSsoForLogin);
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
   * Whether anything but the providers a write takes away still signs
   * people in to the project: another of its SAML or OIDC providers that is
   * on, or a global provider that is on and signs people in to it.
   */
  private static async hasAnotherProviderOn(data: {
    projectId: ObjectID;
    providerType: ProjectSsoProviderType;
    takenAwayIds: Set<string>;
  }): Promise<boolean> {
    /*
     * Of the write's own kind, one row more than it takes away is enough:
     * if that many are on, one of them stays. Of the other kind, one.
     */
    const limitFor: (providerType: ProjectSsoProviderType) => number = (
      providerType: ProjectSsoProviderType,
    ): number => {
      return providerType === data.providerType
        ? data.takenAwayIds.size + 1
        : 1;
    };

    const [samlRows, oidcRows]: [Array<BaseModel>, Array<BaseModel>] =
      await Promise.all([
        ProjectSsoService.findBy({
          query: {
            projectId: data.projectId,
            isEnabled: true,
          },
          select: {
            _id: true,
          },
          limit: limitFor(SsoProviderType.ProjectSSO),
          skip: 0,
          props: {
            isRoot: true,
          },
        }),
        ProjectOidcService.findBy({
          query: {
            projectId: data.projectId,
            isEnabled: true,
          },
          select: {
            _id: true,
          },
          limit: limitFor(SsoProviderType.ProjectOIDC),
          skip: 0,
          props: {
            isRoot: true,
          },
        }),
      ]);

    const projectProviders: Array<{
      providerType: ProjectSsoProviderType;
      rows: Array<BaseModel>;
    }> = [
      { providerType: SsoProviderType.ProjectSSO, rows: samlRows },
      { providerType: SsoProviderType.ProjectOIDC, rows: oidcRows },
    ];

    for (const providers of projectProviders) {
      for (const row of providers.rows) {
        const id: string | undefined = row.id?.toString().toLowerCase();

        if (!id) {
          continue;
        }

        if (
          providers.providerType === data.providerType &&
          data.takenAwayIds.has(id)
        ) {
          continue;
        }

        return true;
      }
    }

    return await ProjectSsoProviderChanges.hasGlobalProviderOn(data.projectId);
  }

  /*
   * Whether a global SSO or OIDC provider that is on signs people in to the
   * project: every project, unless the instance restricted it to the
   * projects attached to it (UserMiddleware.isGlobalSsoTokenAuthorizedForProject).
   */
  private static async hasGlobalProviderOn(
    projectId: ObjectID,
  ): Promise<boolean> {
    const globalSsoProviders: Array<GlobalSso> = await GlobalSsoService.findBy({
      query: {
        isEnabled: true,
      },
      select: {
        _id: true,
        restrictToAttachedProjects: true,
      },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    for (const provider of ProjectSsoProviderChanges.toGlobalRows(
      globalSsoProviders,
    )) {
      if (
        !provider.restrictToAttachedProjects ||
        (await GlobalSsoProjectService.doesProviderGovernProject({
          globalSsoId: provider.id,
          projectId: projectId,
        }))
      ) {
        return true;
      }
    }

    const globalOidcProviders: Array<GlobalOidc> =
      await GlobalOidcService.findBy({
        query: {
          isEnabled: true,
        },
        select: {
          _id: true,
          restrictToAttachedProjects: true,
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        props: {
          isRoot: true,
        },
      });

    for (const provider of ProjectSsoProviderChanges.toGlobalRows(
      globalOidcProviders,
    )) {
      if (
        !provider.restrictToAttachedProjects ||
        (await GlobalOidcProjectService.doesProviderGovernProject({
          globalOidcId: provider.id,
          projectId: projectId,
        }))
      ) {
        return true;
      }
    }

    return false;
  }

  private static toGlobalRows(
    providers: Array<GlobalSso | GlobalOidc>,
  ): Array<GlobalProviderRow> {
    const rows: Array<GlobalProviderRow> = [];

    for (const provider of providers) {
      if (!provider.id) {
        continue;
      }

      rows.push({
        id: provider.id,
        restrictToAttachedProjects: Boolean(
          provider.restrictToAttachedProjects,
        ),
      });
    }

    return rows;
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

  /*
   * The Enabled switch an update writes - true or false, as DatabaseService
   * stores it by the time the hooks run - or undefined when it leaves it
   * alone. Only the write's own field counts, never one it inherits.
   */
  private static getWrittenIsEnabled(data: unknown): boolean | undefined {
    if (
      !data ||
      typeof data !== "object" ||
      !Object.prototype.hasOwnProperty.call(data, "isEnabled")
    ) {
      return undefined;
    }

    const isEnabled: unknown = (data as Record<string, unknown>)["isEnabled"];

    return typeof isEnabled === "boolean" ? isEnabled : undefined;
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
