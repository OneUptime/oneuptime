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
  SignInChangeFailure,
  SignInChangeRecheck,
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
 * A write is checked by what it asks for, not only by what it changes: one
 * that writes Require SSO for Login on, or names the provider a project
 * requires, is checked as one turning it on is - the projects that already
 * say the same, or the server that requires SSO already, included - and
 * holds its locks until it is written. A save that writes back the rule a
 * project has - an API client or Terraform sending the whole record - would
 * otherwise hold nothing while it lands, and a provider could be turned off
 * or deleted between its read and its write, after another change turned
 * the rule off for a moment: the save would then write the rule back with
 * no way in left.
 *
 * The check is the one every change to who can sign in asks (SsoSignInWays),
 * under the locks those changes hold (ProjectSsoProviderChanges.
 * lockSignInChange), held until the write is done or fails: the project's
 * own lock, and - when the project would rely on the global providers or
 * the provider it requires is not one of its own that is on - the one on
 * the server's sign-in rules, kept while the check reads, kept once more
 * right before the write and kept alive while it is written
 * (ProjectSsoProviderChanges.holdForWrite). A lock found gone right before
 * the write - an auto recharge charge took long, Valkey lost it - is taken
 * again and the check run again under it (the write's `recheck`): the write
 * is refused only when a lock cannot be taken, or the check now fails. A
 * project with a provider of its own that is on needs neither the check nor
 * the server's lock (SsoSignInWays.dependsOnServerRules), and holds its own.
 * Turning Require SSO off, or clearing the provider a project requires,
 * asks for less and is never refused or locked.
 *
 * An update that names its projects by a filter writes exactly the projects
 * it read under their locks (ProjectSsoProviderChanges.writeOnlyTheRowsRead):
 * a project that comes to match the filter afterwards - one created a
 * moment later - was never checked, and is left alone. One that comes to
 * match it between the read that picks the projects to lock and the read
 * under the locks was never locked: the update is refused, to be saved
 * again ("Another change to who can sign in with SSO is being saved").
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
  /*
   * Its check, run again from the start should a lock be found gone right
   * before the write (ProjectSsoProviderChanges.holdForWrite).
   */
  recheck: SignInChangeRecheck;
}

// What an update asks of a project's sign-in rule, as it writes it.
interface ProjectRuleAsked {
  // Require SSO for Login as written: true, false, or not written.
  requireSsoForLogin: boolean | undefined;
  // The update names the provider a project requires: an id, or null to clear it.
  writesRequiredProvider: boolean;
  requiredProviderId: string | null;
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
   * rows the caller may write): one that writes Require SSO for Login on,
   * or names the provider a project requires, is read under the projects'
   * lock and checked by what it asks for - every project it writes, the ones
   * that already say the same included: a write that saves back the rule a
   * project has asks for it all the same, and is held to it until it lands.
   * When a project would rely on more than its own providers that are on,
   * the lock on the server's sign-in rules is taken too, after the
   * projects', and the check runs under both.
   *
   * The projects are read once to learn which to lock, and again under the
   * locks. Read again, they must be the projects locked: a write whose
   * filter now reaches another - a project created in between - is refused,
   * to be saved again. The write then goes to exactly the projects read
   * under the locks (ProjectSsoProviderChanges.writeOnlyTheRowsRead), and a
   * write that read none writes none: a project that comes to match its
   * filter afterwards was never checked. Its locks are kept for the write
   * from the check on (ProjectSsoProviderChanges.holdForWrite), and once
   * more right before it (beforeWrite); one found gone by then is taken
   * again, and the projects read and checked again under it.
   */
  public static async beforeProjectUpdate(data: {
    updateBy: UpdateBy<Project>;
  }): Promise<SsoRequirementWrite | null> {
    const asked: ProjectRuleAsked = SsoRequirementChanges.getProjectRuleAsked(
      data.updateBy,
    );

    /*
     * Asks for less, or nothing of SSO: nothing to check. A provider
     * required by a project that does not require SSO itself is checked all
     * the same: the server's Require SSO for Login holds the project to it
     * too, and a server turning that on at this moment reads the project's
     * rule under the lock on the server's sign-in rules, which this write
     * then holds (SsoSignInWays.dependsOnServerRules).
     */
    if (!SsoRequirementChanges.asksForMore(asked)) {
      return null;
    }

    const recheck: SignInChangeRecheck = async (): Promise<
      Array<SemaphoreMutex>
    > => {
      return (
        (await SsoRequirementChanges.lockAndCheckProjects({
          updateBy: data.updateBy,
          asked,
        })) || []
      );
    };

    const locks: Array<SemaphoreMutex> | null =
      await SsoRequirementChanges.lockAndCheckProjects({
        updateBy: data.updateBy,
        asked,
      });

    // It reaches no project: nothing to check, nothing to hold, and nothing to write.
    if (!locks) {
      return null;
    }

    return await SsoRequirementChanges.holdChecked({
      key: data.updateBy as unknown as UpdateBy<BaseModel>,
      write: { locks, recheck },
    });
  }

  /*
   * Before an update to the server's settings is written
   * (GlobalConfigService.onUpdatePermitted): one that writes the server's
   * Require SSO for Login on is checked under the lock on the server's
   * sign-in rules - kept while the check reads every project, page by page
   * - against every project that does not require SSO itself, whether the
   * server requires SSO already or not: saved on again, it asks for it all
   * the same, and holds the lock until it is written.
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

    const recheck: SignInChangeRecheck = async (): Promise<
      Array<SemaphoreMutex>
    > => {
      return await SsoRequirementChanges.lockAndCheckServer();
    };

    return await SsoRequirementChanges.holdChecked({
      key: data.updateBy as unknown as UpdateBy<BaseModel>,
      write: { locks: await recheck(), recheck },
    });
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
   * the new project or is read by its check. A lock found gone once the
   * check is done is taken again, and the check run again under it.
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

    const recheck: SignInChangeRecheck = async (): Promise<
      Array<SemaphoreMutex>
    > => {
      return await SsoRequirementChanges.lockAndCheckNewProject(rule);
    };

    try {
      return await SsoRequirementChanges.holdChecked({
        key: data.createBy as unknown as CreateBy<BaseModel>,
        write: { locks: await recheck(), recheck },
      });
    } catch (err) {
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
   * The last step before an update to a project's or the server's sign-in
   * rule is written (ProjectService and GlobalConfigService.
   * onUpdatePermitted, after everything else they do there - the rules
   * read as they were, an auto recharge charged): the locks its check holds
   * are kept once more, right before the write, and kept alive until it is
   * done (ProjectSsoProviderChanges.holdForWrite). One found gone by now -
   * the charge took longer than the locks are kept, or Valkey lost it - is
   * taken again, with the others, and the check run again under them: the
   * write is refused only when a lock cannot be taken, or the check now
   * fails. A charge made already is not undone: the balance it bought is
   * the project's either way. An update that holds no lock - it asks for
   * less - goes on.
   */
  public static async beforeWrite<TModel extends BaseModel>(
    updateBy: UpdateBy<TModel>,
  ): Promise<void> {
    const write: SsoRequirementWrite | undefined =
      SsoRequirementChanges.writes.get(
        updateBy as unknown as UpdateBy<BaseModel>,
      );

    if (!write) {
      return;
    }

    await ProjectSsoProviderChanges.holdForWrite(write.locks, write.recheck);
  }

  /*
   * Once the write is done (first in the success hooks): its locks are
   * given back, once. Never throws.
   */
  public static async afterUpdate<TModel extends BaseModel>(
    updateBy: UpdateBy<TModel>,
  ): Promise<void> {
    await SsoRequirementChanges.release(
      updateBy as unknown as UpdateBy<BaseModel>,
    );
  }

  /*
   * Once the write has failed (the error hooks, with what failed): its locks
   * are given back, once - unless the database may still apply the write,
   * when they are kept until it would have cancelled it
   * (ProjectSsoProviderChanges.giveBackAfterFailedWrite). Never throws.
   */
  public static async afterFailedUpdate<TModel extends BaseModel>(
    updateBy: UpdateBy<TModel>,
    error: unknown,
  ): Promise<void> {
    await SsoRequirementChanges.release(
      updateBy as unknown as UpdateBy<BaseModel>,
      { error },
    );
  }

  /*
   * Once a project is created (first in ProjectService.onCreateSuccess): the
   * lock its check took is given back, once. Never throws. A create that
   * took none, or a hook handed no create, gives nothing back.
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
   * Once a project's create has failed after the check (ProjectService.
   * onCreateError, with what failed): the lock its check took is given back,
   * once - unless the database may still apply the create, when it is kept
   * until the database would have cancelled it. A project is written by
   * save(), in a transaction of its own, so only a COMMIT that went
   * unanswered may still land: an INSERT the client stopped waiting for is
   * rolled back. Never throws.
   */
  public static async afterFailedProjectCreate(
    createBy: CreateBy<Project> | null | undefined,
    error: unknown,
  ): Promise<void> {
    if (!createBy) {
      return;
    }

    await SsoRequirementChanges.release(
      createBy as unknown as CreateBy<BaseModel>,
      { error, context: { inOwnTransaction: true } },
    );
  }

  /*
   * The sign-in rules an update that asks for less names, as they were
   * before it is written (rememberProjectRulesBefore,
   * rememberServerRuleBefore), by the update: so that once it is written
   * every server is told of a rule it changed - and not of one it wrote
   * back as it was, as an edit form or an API client that sends a whole
   * record does with every save.
   *
   * An update that asks for more - Require SSO for Login on, or a provider
   * required - is told whatever the rules were, and reads nothing for it
   * (asksForMore): an update that asks for less takes no lock, so one may
   * be written between what the other read and what it writes, and a
   * server that heard of that one would keep its answer for a minute.
   */
  private static projectRulesBefore: WeakMap<
    UpdateBy<BaseModel>,
    Map<string, ProjectSignInRule>
  > = new WeakMap<UpdateBy<BaseModel>, Map<string, ProjectSignInRule>>();

  private static serverRuleBefore: WeakMap<UpdateBy<BaseModel>, boolean> =
    new WeakMap<UpdateBy<BaseModel>, boolean>();

  /*
   * Whether an update to a project's sign-in rules asks for more of it:
   * Require SSO for Login turned on, or a provider required - saved again
   * as it was included.
   */
  private static asksForMore(asked: ProjectRuleAsked): boolean {
    return (
      asked.requireSsoForLogin === true || Boolean(asked.requiredProviderId)
    );
  }

  /*
   * Before an update that asks less of a project's sign-in - Require SSO
   * for Login off, or the provider it requires cleared - is written
   * (ProjectService.onUpdatePermitted): the rules of the projects it
   * reaches, as they are. One that asks for more reads nothing: it is told
   * whatever they were. Never throws: a read that fails leaves every
   * project it writes to be told.
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

    if (
      SsoRequirementChanges.asksForMore(
        SsoRequirementChanges.getProjectRuleAsked(updateBy),
      )
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
   * Once the update is written (ProjectService.onUpdateSuccess): the
   * projects it wrote that every server is told of - those whose Require
   * SSO for Login, or required provider, it changed, as the switch and the
   * id are stored. A project whose rule was not read before counts, so a
   * change is never missed: every project a write that asks for more wrote
   * counts that way, since nothing is read before it
   * (rememberProjectRulesBefore).
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
   * Before an update that turns the server's Require SSO for Login off is
   * written (GlobalConfigService.onUpdatePermitted): the rule as it is. One
   * that turns it on reads nothing: it is told whatever the rule was. Never
   * throws: a read that fails leaves the write to be told.
   */
  public static async rememberServerRuleBefore(
    updateBy: UpdateBy<GlobalConfig>,
  ): Promise<void> {
    const written: Record<string, unknown> = updateBy.data as unknown as Record<
      string,
      unknown
    >;

    if (
      written["requireSsoForLogin"] === undefined ||
      written["requireSsoForLogin"] === true
    ) {
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
   * stored. One whose rule was not read before counts as a change: turning
   * it on always does, since nothing is read before it
   * (rememberServerRuleBefore) - saved on again while on included.
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

  /*
   * What an update asks of the sign-in rule of the projects it writes: the
   * Require SSO for Login switch it writes, and the provider it names for
   * them to require, as it writes them.
   */
  private static getProjectRuleAsked(
    updateBy: UpdateBy<Project>,
  ): ProjectRuleAsked {
    const written: Record<string, unknown> = updateBy.data as unknown as Record<
      string,
      unknown
    >;

    const writesRequiredProvider: boolean =
      written["requireSsoWithSsoProviderId"] !== undefined;

    return {
      requireSsoForLogin: SsoSignInsEnded.getWrittenBoolean(
        written,
        "requireSsoForLogin",
      ),
      writesRequiredProvider,
      requiredProviderId: writesRequiredProvider
        ? toIdString(written["requireSsoWithSsoProviderId"])
        : null,
    };
  }

  /*
   * The check of an update to projects' sign-in rules (beforeProjectUpdate),
   * from the start - as it runs again, too, should a lock be found gone
   * before the write: the projects the update names are read, locked, and
   * read again under the locks - refused, to be saved again, when they now
   * reach a project that was not locked - the update is held to them, and
   * each is checked against the rule the update leaves it with: every one,
   * whether its rule changes or is saved back as it is. Answers the locks it
   * holds, or null when the update reaches no project (it then writes none).
   * Refused, it gives back what it took.
   */
  private static async lockAndCheckProjects(data: {
    updateBy: UpdateBy<Project>;
    asked: ProjectRuleAsked;
  }): Promise<Array<SemaphoreMutex> | null> {
    const projectIdsToLock: Array<string> =
      await SsoRequirementChanges.readProjectIds(data.updateBy);

    // It names no project: nothing to check, and nothing to write.
    if (projectIdsToLock.length === 0) {
      ProjectSsoProviderChanges.writeOnlyTheRowsRead({
        service: ProjectService,
        write: data.updateBy,
        rowIds: [],
        isDelete: false,
      });

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

      const projectIdsRead: Array<string> =
        SsoRequirementChanges.projectIdsOf(projects);

      /*
       * Read under the projects' locks, a write that names its projects by
       * a filter may now reach one it did not lock - a project created in
       * between - whose own changes it could then overtake. It is refused,
       * to be saved again.
       */
      const locked: Set<string> = new Set<string>(projectIdsToLock);

      if (
        projectIdsRead.some((projectId: string): boolean => {
          return !locked.has(projectId);
        })
      ) {
        throw new BadDataException(SIGN_IN_CHANGE_IN_PROGRESS_MESSAGE);
      }

      // The write goes to exactly the projects read under the locks.
      ProjectSsoProviderChanges.writeOnlyTheRowsRead({
        service: ProjectService,
        write: data.updateBy,
        rowIds: projectIdsRead,
        isDelete: false,
      });

      /*
       * Each project is asked for what the write asks of it, as the rule
       * the write leaves it with: a rule saved back as it was is asked for
       * all the same.
       */
      const rules: Map<string, ProjectSignInRule> = new Map<
        string,
        ProjectSignInRule
      >();

      for (const project of projects) {
        const projectId: string | null = toIdString(project.id);

        if (!projectId) {
          continue;
        }

        rules.set(projectId, {
          requireSsoForLogin:
            data.asked.requireSsoForLogin !== undefined
              ? data.asked.requireSsoForLogin
              : project.requireSsoForLogin === true,
          requiredProviderId: data.asked.writesRequiredProvider
            ? data.asked.requiredProviderId
            : toIdString(project.requireSsoWithSsoProviderId),
        });
      }

      // Every project it named is gone by now: nothing to check, nothing to hold.
      if (rules.size === 0) {
        await ProjectSsoProviderChanges.releaseSignInChange(locks);
        return null;
      }

      if (
        await SsoSignInWays.dependsOnServerRules({
          projectRules: rules,
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
              projectRules: rules,
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
      }

      return locks;
    } catch (err) {
      await ProjectSsoProviderChanges.releaseSignInChange(locks);
      throw err;
    }
  }

  /*
   * The check of the server's Require SSO for Login written on
   * (beforeServerUpdate), from the start - as it runs again, too: the lock
   * on the server's sign-in rules is taken, and every project that does not
   * require SSO itself is read under it, page by page, the lock kept before
   * each; refused, naming the projects, when one would have no way in.
   * Answers the lock it holds; refused, it gives it back.
   */
  private static async lockAndCheckServer(): Promise<Array<SemaphoreMutex>> {
    const locks: Array<SemaphoreMutex> =
      await ProjectSsoProviderChanges.lockSignInChange({
        projectIds: [],
        wholeServer: true,
      });

    try {
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

      return locks;
    } catch (err) {
      await ProjectSsoProviderChanges.releaseSignInChange(locks);
      throw err;
    }
  }

  /*
   * The check of a project created with this rule (beforeProjectCreate),
   * from the start - as it runs again, too: the lock on the server's
   * sign-in rules is taken, and the providers that would sign people in to
   * a new project read under it. Answers the lock it holds; refused, it
   * gives it back.
   */
  private static async lockAndCheckNewProject(
    rule: ProjectSignInRule,
  ): Promise<Array<SemaphoreMutex>> {
    const locks: Array<SemaphoreMutex> =
      await ProjectSsoProviderChanges.lockSignInChange({
        projectIds: [],
        wholeServer: true,
      });

    try {
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

      return locks;
    } catch (err) {
      await ProjectSsoProviderChanges.releaseSignInChange(locks);
      throw err;
    }
  }

  /*
   * A checked write, held for its write: its locks kept once more, and kept
   * alive from here (ProjectSsoProviderChanges.holdForWrite) - one found
   * gone already is taken again and the check run again - and the write
   * remembered by what the hooks know it by, for the later steps to keep and
   * give back. Refused, it has given back whatever it held.
   */
  private static async holdChecked(data: {
    key: UpdateBy<BaseModel> | CreateBy<BaseModel>;
    write: SsoRequirementWrite;
  }): Promise<SsoRequirementWrite> {
    await ProjectSsoProviderChanges.holdCheckedForWrite(
      data.write.locks,
      data.write.recheck,
    );

    SsoRequirementChanges.writes.set(data.key, data.write);

    return data.write;
  }

  /*
   * Gives a write's locks back, once - after a failed write, unless the
   * database may still apply it, when they are kept until it would have
   * cancelled it (ProjectSsoProviderChanges.giveBackAfterFailedWrite).
   */
  private static async release(
    key: UpdateBy<BaseModel> | CreateBy<BaseModel>,
    failure?: SignInChangeFailure | undefined,
  ): Promise<void> {
    const write: SsoRequirementWrite | undefined =
      SsoRequirementChanges.writes.get(key);

    if (!write) {
      return;
    }

    SsoRequirementChanges.writes.delete(key);

    await ProjectSsoProviderChanges.giveBack(write.locks, failure);
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

    return SsoRequirementChanges.projectIdsOf(projects);
  }

  // The ids of the projects read.
  private static projectIdsOf(projects: Array<Project>): Array<string> {
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
