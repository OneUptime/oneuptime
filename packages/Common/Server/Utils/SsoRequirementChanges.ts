import BaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import GlobalConfig from "../../Models/DatabaseModels/GlobalConfig";
import Project from "../../Models/DatabaseModels/Project";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import { SemaphoreMutex } from "../Infrastructure/Semaphore";
import GlobalConfigService from "../Services/GlobalConfigService";
import ProjectService from "../Services/ProjectService";
import CreateBy from "../Types/Database/CreateBy";
import UpdateBy from "../Types/Database/UpdateBy";
import ProjectSsoProviderChanges, {
  SIGN_IN_CHANGE_IN_PROGRESS_MESSAGE,
} from "./ProjectSsoProviderChanges";
import logger from "./Logger";
import SsoSignInsEnded from "./SsoSignInsEnded";
import SsoSignInWays, {
  ProjectSignInRule,
  StrandReason,
  StrandedProject,
  StrandedProjectList,
  StrandedProjects,
  describeStrandedProjects,
  toIdString,
} from "./SsoSignInWays";

/*
 * REQUIRING SSO NEEDS A PROVIDER THAT SIGNS PEOPLE IN.
 *
 * Turning Require SSO for Login on - for a project, or for the whole server
 * - locks out everyone who cannot sign in with an SSO provider that signs
 * people in there. So it is refused when none would:
 *
 *   - a project that turns it on, or that requires another provider by id
 *     (requireSsoWithSsoProviderId) while SSO is required, needs one of its
 *     own SAML or OIDC providers that is on, or a global provider that is on
 *     and reaches it; and the provider it requires, when it requires one,
 *     must be one of those;
 *   - the server that turns it on needs that for every project that does
 *     not require SSO itself: the refusal names the projects that have no
 *     way in. Master admins stay exempt from the server's rule, as they
 *     always were (UserMiddleware), so they can always turn it off again;
 *   - a project created with Require SSO for Login on, or requiring a
 *     provider, is held to the same rule as one updated to it - and a new
 *     project has no provider of its own yet, so only a global provider
 *     that signs people in to every project can be its way in. One created
 *     while the whole server requires SSO needs such a provider too, or its
 *     creator could not open it, unless the creator is a master admin, whom
 *     the server's rule does not hold (beforeProjectCreate).
 *
 * The check is the one every change to who can sign in asks (SsoSignInWays),
 * under the locks those changes hold (ProjectSsoProviderChanges.
 * lockSignInChange), held until the write is done or fails: the project's
 * own lock, and - when the project would rely on the global providers or
 * the provider it requires is not one of its own that is on - the one on
 * the server's sign-in rules, kept while the check reads. A project with a
 * provider of its own that is on needs neither the check nor that lock
 * (SsoSignInWays.dependsOnServerRules). Turning Require SSO off, or
 * clearing the provider a project requires, asks for less and is never
 * refused or locked.
 */

export const NO_SSO_PROVIDER_TO_REQUIRE_MESSAGE: string =
  "No SSO provider can sign people in to this project yet, so requiring SSO would lock everyone out of it, you included. Turn on an SSO provider for it and test it first.";

export const REQUIRED_PROVIDER_CANNOT_SIGN_IN_MESSAGE: string =
  "The SSO provider this project would require cannot sign people in to it: it is off, it was deleted, or it does not sign people in to this project. Turn it on first, or require another provider.";

/*
 * Why a project cannot be created while the whole server requires SSO and
 * no provider would sign anyone in to a new project, and who can change
 * that: a server admin, who sets up the global providers.
 */
export const SERVER_REQUIRES_SSO_FOR_NEW_PROJECT_MESSAGE: string =
  "This server requires SSO for everyone, and no SSO provider would sign people in to a new project, so you would be locked out of the project you create. Ask a server admin to turn on a global SSO provider that signs people in to every project, then try again.";

/*
 * Why a project cannot be created at this moment: a change to who can sign
 * in with SSO on the server - its Require SSO for Login, or a global
 * provider - is being saved, and holds the lock a create's check waits for
 * longer than it waits. Said in a creator's terms; the change itself is
 * refused in SIGN_IN_CHANGE_IN_PROGRESS_MESSAGE's.
 */
export const PROJECT_CREATE_WAITS_FOR_SIGN_IN_CHANGE_MESSAGE: string =
  "The server's SSO settings are being changed. Create the project again in a moment.";

/*
 * Why the server's Require SSO for Login is refused, naming the projects it
 * would lock out and saying what to do about each: those with no provider
 * to sign in with, and those that require a provider by id that cannot
 * sign anyone in to them.
 */
export function getServerRuleRefusalMessage(
  stranded: StrandedProjects,
): string {
  const sentences: Array<string> = [];

  const noProvider: StrandedProjectList =
    stranded.byReason[StrandReason.NoProvider];

  if (noProvider.count > 0) {
    const isOne: boolean = noProvider.count === 1;

    sentences.push(
      `${capitalize(describeStrandedProjects(noProvider))} ${
        isOne ? "has" : "have"
      } no SSO provider people can sign in with, so requiring SSO for everyone would lock ${
        isOne ? "its" : "their"
      } members out. Turn on a global SSO provider, or an SSO provider in ${
        isOne ? "that project" : "each of them"
      }, first.`,
    );
  }

  const required: StrandedProjectList =
    stranded.byReason[StrandReason.RequiredProvider];

  if (required.count > 0) {
    const isOne: boolean = required.count === 1;

    sentences.push(
      `${capitalize(describeStrandedProjects(required))} ${
        isOne ? "requires" : "require"
      } sign-in with an SSO provider that cannot sign people in to ${
        isOne ? "it" : "them"
      } - it is off, it was deleted, or it does not sign people in there - so requiring SSO for everyone would lock ${
        isOne ? "its" : "their"
      } members out. Turn that provider on, or require another provider there, first.`,
    );
  }

  return sentences.join(" ");
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// A write that asks for more, worked out before it runs: the locks it holds.
export interface SsoRequirementWrite {
  locks: Array<SemaphoreMutex>;
}

export default class SsoRequirementChanges {
  /*
   * The writes worked out before they run, for the success and error hooks
   * to give the locks back: keyed by the UpdateBy the services hand back
   * from onBeforeUpdate, which DatabaseService passes on to
   * onUpdatePermitted. ProjectService and GlobalConfigService hand back the
   * very object they were given, so it is also the one the success hook is
   * handed (the caller's); the suites that give the locks back after each
   * write (SsoRequirementChanges.test, GlobalSsoProviderChanges.test) fail
   * if one ever does not.
   */
  private static writes: WeakMap<
    UpdateBy<BaseModel> | CreateBy<BaseModel>,
    SsoRequirementWrite
  > = new WeakMap<
    UpdateBy<BaseModel> | CreateBy<BaseModel>,
    SsoRequirementWrite
  >();

  /*
   * Before an update to projects is written (ProjectService.
   * onUpdatePermitted, once every permission check has passed, with the
   * rows the caller may write): one that turns Require SSO for Login on, or
   * names the provider a project requires, is read under the projects'
   * lock. Only a project whose rule the write actually changes is checked:
   * one that already requires SSO and has it saved again is not, and a
   * write that changes no project's rule gives its locks back at once.
   * When a project would rely on more than its own providers that are on,
   * the lock on the server's sign-in rules is taken too, after the
   * projects', and the check runs under both.
   */
  public static async beforeProjectUpdate(data: {
    updateBy: UpdateBy<Project>;
  }): Promise<SsoRequirementWrite | null> {
    const written: Record<string, unknown> = data.updateBy
      .data as unknown as Record<string, unknown>;

    const requireSsoForLogin: boolean | undefined =
      SsoSignInsEnded.getWrittenBoolean(written, "requireSsoForLogin");

    const writesRequiredProvider: boolean =
      written["requireSsoWithSsoProviderId"] !== undefined;
    const requiredProviderId: string | null = writesRequiredProvider
      ? toIdString(written["requireSsoWithSsoProviderId"])
      : null;

    /*
     * Asks for less, or the same: nothing to check. A provider required by
     * a project that does not require SSO itself is checked all the same:
     * the server's Require SSO for Login holds the project to it too, and a
     * server turning that on at this moment reads the project's rule under
     * the lock on the server's sign-in rules, which this write then holds
     * (SsoSignInWays.dependsOnServerRules).
     */
    if (requireSsoForLogin !== true && !requiredProviderId) {
      return null;
    }

    const projectIdsToLock: Array<string> =
      await SsoRequirementChanges.readProjectIds(data.updateBy);

    if (projectIdsToLock.length === 0) {
      return null;
    }

    const locks: Array<SemaphoreMutex> =
      await ProjectSsoProviderChanges.lockSignInChange({
        projectIds: projectIdsToLock,
        wholeServer: false,
      });

    try {
      // Read again under the lock: the rules as they are now.
      const projects: Array<Project> = await ProjectService.findAllBy({
        query: data.updateBy.query,
        select: {
          _id: true,
          requireSsoForLogin: true,
          requireSsoWithSsoProviderId: true,
        },
        limit: data.updateBy.limit,
        skip: data.updateBy.skip,
        props: {
          isRoot: true,
        },
      });

      const tightened: Map<string, ProjectSignInRule> = new Map<
        string,
        ProjectSignInRule
      >();

      for (const project of projects) {
        const projectId: string | null = toIdString(project.id);

        if (!projectId) {
          continue;
        }

        const storedRequired: string | null = toIdString(
          project.requireSsoWithSsoProviderId,
        );

        const rule: ProjectSignInRule = {
          requireSsoForLogin:
            requireSsoForLogin !== undefined
              ? requireSsoForLogin
              : project.requireSsoForLogin === true,
          requiredProviderId: writesRequiredProvider
            ? requiredProviderId
            : storedRequired,
        };

        const turnsOn: boolean =
          rule.requireSsoForLogin && project.requireSsoForLogin !== true;
        const requiresAnother: boolean = Boolean(
          rule.requiredProviderId && rule.requiredProviderId !== storedRequired,
        );

        if (turnsOn || requiresAnother) {
          tightened.set(projectId, rule);
        }
      }

      // Asks no more of any project: nothing to check, nothing to hold.
      if (tightened.size === 0) {
        await ProjectSsoProviderChanges.releaseSignInChange(locks);
        return null;
      }

      if (
        await SsoSignInWays.dependsOnServerRules({
          projectRules: tightened,
        })
      ) {
        // Taken after the projects' locks, as every writer takes them.
        locks.push(
          ...(await ProjectSsoProviderChanges.lockSignInChange({
            projectIds: [],
            wholeServer: true,
          })),
        );

        const stranded: StrandedProjects =
          await SsoSignInWays.findStrandedProjects(
            {
              projectRules: tightened,
            },
            {
              keepLocks: async (): Promise<void> => {
                await ProjectSsoProviderChanges.keepSignInChange(locks);
              },
            },
          );

        const first: StrandedProject | undefined = stranded.firstProjects[0];

        if (first) {
          throw new BadDataException(
            first.reason === StrandReason.RequiredProvider
              ? REQUIRED_PROVIDER_CANNOT_SIGN_IN_MESSAGE
              : NO_SSO_PROVIDER_TO_REQUIRE_MESSAGE,
          );
        }

        await ProjectSsoProviderChanges.keepSignInChange(locks);
      }

      const write: SsoRequirementWrite = { locks };
      SsoRequirementChanges.writes.set(
        data.updateBy as unknown as UpdateBy<BaseModel>,
        write,
      );
      return write;
    } catch (err) {
      await ProjectSsoProviderChanges.releaseSignInChange(locks);
      throw err;
    }
  }

  /*
   * Before an update to the server's settings is written
   * (GlobalConfigService.onUpdatePermitted): one that turns the server's
   * Require SSO for Login on, from off, is checked under the lock on the
   * server's sign-in rules - kept while the check reads every project, page
   * by page - against every project that does not require SSO itself.
   */
  public static async beforeServerUpdate(data: {
    updateBy: UpdateBy<GlobalConfig>;
  }): Promise<SsoRequirementWrite | null> {
    if (
      SsoSignInsEnded.getWrittenBoolean(
        data.updateBy.data,
        "requireSsoForLogin",
      ) !== true
    ) {
      return null;
    }

    const locks: Array<SemaphoreMutex> =
      await ProjectSsoProviderChanges.lockSignInChange({
        projectIds: [],
        wholeServer: true,
      });

    try {
      const config: GlobalConfig | null = await GlobalConfigService.findOneBy({
        query: data.updateBy.query,
        select: {
          _id: true,
          requireSsoForLogin: true,
        },
        props: {
          isRoot: true,
        },
      });

      // On already: it asks no more of anyone.
      if (!config || !config.requireSsoForLogin) {
        const stranded: StrandedProjects =
          await SsoSignInWays.findStrandedProjects(
            {
              turnsOnServerRule: true,
            },
            {
              keepLocks: async (): Promise<void> => {
                await ProjectSsoProviderChanges.keepSignInChange(locks);
              },
            },
          );

        if (stranded.count > 0) {
          throw new BadDataException(getServerRuleRefusalMessage(stranded));
        }

        await ProjectSsoProviderChanges.keepSignInChange(locks);
      }

      const write: SsoRequirementWrite = { locks };
      SsoRequirementChanges.writes.set(
        data.updateBy as unknown as UpdateBy<BaseModel>,
        write,
      );
      return write;
    } catch (err) {
      await ProjectSsoProviderChanges.releaseSignInChange(locks);
      throw err;
    }
  }

  /*
   * Before a project is created (ProjectService.onCreatePermitted, once
   * every permission and plan check has passed): a project that would
   * require SSO - itself, or because the whole server does - needs a
   * provider that signs people in to it, and a new one has none of its own
   * yet, so only a global provider that signs people in to every project
   * counts (SsoSignInWays.findNewProjectStrandReason).
   *
   *   - Require SSO for Login on, or a provider required, is held to the
   *     rule an update to them is held to (beforeProjectUpdate), the
   *     server's Require SSO for Login included, and refused in the same
   *     words, whoever creates it.
   *   - Created while the whole server requires SSO, it needs such a
   *     provider as well, or its creator could not open it; the refusal says
   *     a server admin can turn one on. A master admin, whom the server's
   *     rule does not hold, is not refused for it: a create of theirs that
   *     asks nothing of SSO itself needs no check, and takes no lock.
   *
   * Read under the lock on the server's sign-in rules, held until the
   * project is written (afterProjectCreate, first in onCreateSuccess, or
   * once the create fails): a server turning its Require SSO for Login on,
   * or a global provider being turned off, at the same moment either reads
   * the new project or is read by its check.
   */
  public static async beforeProjectCreate(data: {
    createBy: CreateBy<Project>;
    // The creator is a master admin: the server's Require SSO for Login does not hold them.
    isCreatorExemptFromServerRule: boolean;
  }): Promise<SsoRequirementWrite | null> {
    const written: Record<string, unknown> = data.createBy
      .data as unknown as Record<string, unknown>;

    const rule: ProjectSignInRule = {
      requireSsoForLogin:
        SsoSignInsEnded.getWrittenBoolean(written, "requireSsoForLogin") ===
        true,
      requiredProviderId: toIdString(written["requireSsoWithSsoProviderId"]),
    };

    const asksForSso: boolean =
      rule.requireSsoForLogin || Boolean(rule.requiredProviderId);

    // Neither the project's own rule nor the server's holds its creator.
    if (!asksForSso && data.isCreatorExemptFromServerRule) {
      return null;
    }

    let locks: Array<SemaphoreMutex> = [];

    try {
      locks = await ProjectSsoProviderChanges.lockSignInChange({
        projectIds: [],
        wholeServer: true,
      });

      const reason: StrandReason | null =
        await SsoSignInWays.findNewProjectStrandReason({ rule });

      if (reason === StrandReason.RequiredProvider) {
        throw new BadDataException(REQUIRED_PROVIDER_CANNOT_SIGN_IN_MESSAGE);
      }

      if (reason === StrandReason.NoProvider) {
        throw new BadDataException(
          rule.requireSsoForLogin
            ? NO_SSO_PROVIDER_TO_REQUIRE_MESSAGE
            : SERVER_REQUIRES_SSO_FOR_NEW_PROJECT_MESSAGE,
        );
      }

      // The lock lasts another while, for the write that follows.
      await ProjectSsoProviderChanges.keepSignInChange(locks);

      const write: SsoRequirementWrite = { locks };
      SsoRequirementChanges.writes.set(
        data.createBy as unknown as CreateBy<BaseModel>,
        write,
      );
      return write;
    } catch (err) {
      await ProjectSsoProviderChanges.releaseSignInChange(locks);

      // Busy, or lost while the check read: in the creator's words.
      if (
        err instanceof BadDataException &&
        err.message === SIGN_IN_CHANGE_IN_PROGRESS_MESSAGE
      ) {
        throw new BadDataException(
          PROJECT_CREATE_WAITS_FOR_SIGN_IN_CHANGE_MESSAGE,
        );
      }

      throw err;
    }
  }

  /*
   * Once the write is done (first in the success hooks) or has failed (the
   * error hooks): its locks are given back, once. Never throws.
   */
  public static async afterUpdate<TModel extends BaseModel>(
    updateBy: UpdateBy<TModel>,
  ): Promise<void> {
    await SsoRequirementChanges.release(
      updateBy as unknown as UpdateBy<BaseModel>,
    );
  }

  /*
   * Once a project is created (first in ProjectService.onCreateSuccess), or
   * its create has failed after the check (ProjectService.create, whatever
   * happened): the lock its check took is given back, once. Never throws. A
   * create that took none, or a hook handed no create, gives nothing back.
   */
  public static async afterProjectCreate(
    createBy: CreateBy<Project> | null | undefined,
  ): Promise<void> {
    if (!createBy) {
      return;
    }

    await SsoRequirementChanges.release(
      createBy as unknown as CreateBy<BaseModel>,
    );
  }

  /*
   * The sign-in rules an update names, as they were before it is written
   * (rememberProjectRulesBefore, rememberServerRuleBefore), by the update:
   * so that once it is written every server is told of a rule it changed -
   * and not of one it wrote back as it was, as an edit form or an API client
   * that sends a whole record does with every save.
   */
  private static projectRulesBefore: WeakMap<
    UpdateBy<BaseModel>,
    Map<string, ProjectSignInRule>
  > = new WeakMap<UpdateBy<BaseModel>, Map<string, ProjectSignInRule>>();

  private static serverRuleBefore: WeakMap<UpdateBy<BaseModel>, boolean> =
    new WeakMap<UpdateBy<BaseModel>, boolean>();

  /*
   * Before an update that names a project's Require SSO for Login, or the
   * provider it requires, is written (ProjectService.onUpdatePermitted):
   * the rules of the projects it reaches, as they are. Never throws: a read
   * that fails leaves every project it writes to be told.
   */
  public static async rememberProjectRulesBefore(
    updateBy: UpdateBy<Project>,
  ): Promise<void> {
    const written: Record<string, unknown> = updateBy.data as unknown as Record<
      string,
      unknown
    >;

    if (
      written["requireSsoForLogin"] === undefined &&
      written["requireSsoWithSsoProviderId"] === undefined
    ) {
      return;
    }

    try {
      const projects: Array<Project> = await ProjectService.findAllBy({
        query: updateBy.query,
        select: {
          _id: true,
          requireSsoForLogin: true,
          requireSsoWithSsoProviderId: true,
        },
        limit: updateBy.limit,
        skip: updateBy.skip,
        props: {
          isRoot: true,
        },
      });

      const rules: Map<string, ProjectSignInRule> = new Map<
        string,
        ProjectSignInRule
      >();

      for (const project of projects) {
        const projectId: string | null = toIdString(project.id);

        if (projectId) {
          rules.set(projectId, {
            requireSsoForLogin: project.requireSsoForLogin === true,
            requiredProviderId: toIdString(project.requireSsoWithSsoProviderId),
          });
        }
      }

      SsoRequirementChanges.projectRulesBefore.set(
        updateBy as unknown as UpdateBy<BaseModel>,
        rules,
      );
    } catch (err) {
      logger.warn(
        "Require SSO for Login: could not read the projects' rules before the write; every project it writes is told.",
      );
      logger.warn(err);
    }
  }

  /*
   * Once the update is written (ProjectService.onUpdateSuccess): those of
   * the projects it wrote whose Require SSO for Login, or required
   * provider, it changed - as the switch and the id are stored. A project
   * whose rule was not read before counts, so a change is never missed.
   */
  public static takeProjectsWhoseRuleChanged(
    updateBy: UpdateBy<Project>,
    updatedItemIds: Array<ObjectID>,
  ): Array<ObjectID> {
    const key: UpdateBy<BaseModel> = updateBy as unknown as UpdateBy<BaseModel>;
    const before: Map<string, ProjectSignInRule> | undefined =
      SsoRequirementChanges.projectRulesBefore.get(key);

    SsoRequirementChanges.projectRulesBefore.delete(key);

    const written: Record<string, unknown> = updateBy.data as unknown as Record<
      string,
      unknown
    >;

    const writesRule: boolean = written["requireSsoForLogin"] !== undefined;
    const writesProvider: boolean =
      written["requireSsoWithSsoProviderId"] !== undefined;

    if (!writesRule && !writesProvider) {
      return [];
    }

    const requireSsoForLogin: boolean = written["requireSsoForLogin"] === true;
    const requiredProviderId: string | null = writesProvider
      ? toIdString(written["requireSsoWithSsoProviderId"])
      : null;

    return updatedItemIds.filter((projectId: ObjectID): boolean => {
      const rule: ProjectSignInRule | undefined = before?.get(
        toIdString(projectId) || "",
      );

      if (!rule) {
        return true;
      }

      return (
        (writesRule && requireSsoForLogin !== rule.requireSsoForLogin) ||
        (writesProvider && requiredProviderId !== rule.requiredProviderId)
      );
    });
  }

  /*
   * Before an update that names the server's Require SSO for Login is
   * written (GlobalConfigService.onUpdatePermitted): the rule as it is.
   * Never throws: a read that fails leaves the write to be told.
   */
  public static async rememberServerRuleBefore(
    updateBy: UpdateBy<GlobalConfig>,
  ): Promise<void> {
    const written: Record<string, unknown> = updateBy.data as unknown as Record<
      string,
      unknown
    >;

    if (written["requireSsoForLogin"] === undefined) {
      return;
    }

    try {
      const config: GlobalConfig | null = await GlobalConfigService.findOneBy({
        query: updateBy.query,
        select: {
          requireSsoForLogin: true,
        },
        props: {
          isRoot: true,
        },
      });

      if (config) {
        SsoRequirementChanges.serverRuleBefore.set(
          updateBy as unknown as UpdateBy<BaseModel>,
          config.requireSsoForLogin === true,
        );
      }
    } catch (err) {
      logger.warn(
        "Require SSO for Login: could not read the server's rule before the write; the write is told.",
      );
      logger.warn(err);
    }
  }

  /*
   * Once the update is written (GlobalConfigService.onUpdateSuccess):
   * whether it changed the server's Require SSO for Login, as the switch is
   * stored. One whose rule was not read before counts as a change.
   */
  public static takeWhetherServerRuleChanged(
    updateBy: UpdateBy<GlobalConfig>,
  ): boolean {
    const key: UpdateBy<BaseModel> = updateBy as unknown as UpdateBy<BaseModel>;
    const before: boolean | undefined =
      SsoRequirementChanges.serverRuleBefore.get(key);

    SsoRequirementChanges.serverRuleBefore.delete(key);

    const written: unknown = (
      updateBy.data as unknown as Record<string, unknown>
    )["requireSsoForLogin"];

    if (written === undefined) {
      return false;
    }

    return before === undefined || (written === true) !== before;
  }

  // Gives a write's locks back, once.
  private static async release(
    key: UpdateBy<BaseModel> | CreateBy<BaseModel>,
  ): Promise<void> {
    const write: SsoRequirementWrite | undefined =
      SsoRequirementChanges.writes.get(key);

    if (!write) {
      return;
    }

    SsoRequirementChanges.writes.delete(key);

    await ProjectSsoProviderChanges.releaseSignInChange(write.locks);
  }

  // The projects an update names, to lock them before they are read again.
  private static async readProjectIds(
    updateBy: UpdateBy<Project>,
  ): Promise<Array<string>> {
    const projects: Array<Project> = await ProjectService.findAllBy({
      query: updateBy.query,
      select: {
        _id: true,
      },
      limit: updateBy.limit,
      skip: updateBy.skip,
      props: {
        isRoot: true,
      },
    });

    const ids: Array<string> = [];

    for (const project of projects) {
      const id: string | null = toIdString(project.id);

      if (id) {
        ids.push(id);
      }
    }

    return ids;
  }
}
