import GlobalConfig from "../../Models/DatabaseModels/GlobalConfig";
import Project from "../../Models/DatabaseModels/Project";
import BadDataException from "../../Types/Exception/BadDataException";
import { SemaphoreMutex } from "../Infrastructure/Semaphore";
import GlobalConfigService from "../Services/GlobalConfigService";
import ProjectService from "../Services/ProjectService";
import UpdateBy from "../Types/Database/UpdateBy";
import ProjectSsoProviderChanges from "./ProjectSsoProviderChanges";
import SsoSignInsEnded from "./SsoSignInsEnded";
import SsoSignInWays, {
  ProjectSignInRule,
  StrandReason,
  StrandedProject,
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
 *     always were (UserMiddleware), so they can always turn it off again.
 *
 * The check is the one every change to who can sign in asks (SsoSignInWays),
 * under the lock those changes hold (ProjectSsoProviderChanges.
 * lockSignInChange): the project's own lock, and the one on the server's
 * sign-in rules, held until the write is done. Turning Require SSO off, or
 * clearing the provider a project requires, asks for less and is never
 * refused or locked.
 */

export const NO_SSO_PROVIDER_TO_REQUIRE_MESSAGE: string =
  "No SSO provider can sign people in to this project yet, so requiring SSO would lock everyone out of it, you included. Turn on an SSO provider for it and test it first.";

export const REQUIRED_PROVIDER_CANNOT_SIGN_IN_MESSAGE: string =
  "The SSO provider this project would require cannot sign people in to it: it is off, it was deleted, or it does not sign people in to this project. Turn it on first, or require another provider.";

/*
 * Why the server's Require SSO for Login is refused, naming the projects
 * that have no provider to sign in with.
 */
export function getServerRuleRefusalMessage(
  stranded: StrandedProjects,
): string {
  const projects: string = describeStrandedProjects(stranded);
  const isOne: boolean = stranded.count === 1;

  return `${projects.charAt(0).toUpperCase()}${projects.slice(1)} ${
    isOne ? "has" : "have"
  } no SSO provider people can sign in with, so requiring SSO for everyone would lock ${
    isOne ? "its" : "their"
  } members out. Turn on a global SSO provider, or an SSO provider in ${
    isOne ? "that project" : "each of them"
  }, first.`;
}

// A write that asks for more, worked out before it runs: the locks it holds.
export interface SsoRequirementWrite {
  locks: Array<SemaphoreMutex>;
}

export default class SsoRequirementChanges {
  /*
   * The writes worked out before they run, for the success hooks to give
   * the locks back: keyed by the UpdateBy the services hand back from
   * onBeforeUpdate, which DatabaseService passes on to onUpdateSuccess.
   */
  private static writes: WeakMap<object, SsoRequirementWrite> = new WeakMap<
    object,
    SsoRequirementWrite
  >();

  /*
   * Before an update to projects (ProjectService.onBeforeUpdate, with the
   * rows the caller may write): one that turns Require SSO for Login on, or
   * names the provider a project requires, is checked under the projects'
   * lock and the lock on the server's sign-in rules. Only a project whose
   * rule the write actually changes is checked: one that already requires
   * SSO and has it saved again is not.
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

    // Asks for less, or the same: nothing to check.
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
        wholeServer: true,
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
          rule.requiredProviderId &&
            rule.requiredProviderId !== storedRequired,
        );

        if (turnsOn || requiresAnother) {
          tightened.set(projectId, rule);
        }
      }

      if (tightened.size > 0) {
        const stranded: StrandedProjects =
          await SsoSignInWays.findStrandedProjects({
            projectRules: tightened,
          });

        const first: StrandedProject | undefined = stranded.firstProjects[0];

        if (first) {
          throw new BadDataException(
            first.reason === StrandReason.RequiredProvider
              ? REQUIRED_PROVIDER_CANNOT_SIGN_IN_MESSAGE
              : NO_SSO_PROVIDER_TO_REQUIRE_MESSAGE,
          );
        }
      }

      const write: SsoRequirementWrite = { locks };
      SsoRequirementChanges.writes.set(data.updateBy, write);
      return write;
    } catch (err) {
      await ProjectSsoProviderChanges.releaseSignInChange(locks);
      throw err;
    }
  }

  /*
   * Before an update to the server's settings (GlobalConfigService.
   * onBeforeUpdate): one that turns the server's Require SSO for Login on,
   * from off, is checked under the lock on the server's sign-in rules
   * against every project that does not require SSO itself.
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
          await SsoSignInWays.findStrandedProjects({
            turnsOnServerRule: true,
          });

        if (stranded.count > 0) {
          throw new BadDataException(getServerRuleRefusalMessage(stranded));
        }
      }

      const write: SsoRequirementWrite = { locks };
      SsoRequirementChanges.writes.set(data.updateBy, write);
      return write;
    } catch (err) {
      await ProjectSsoProviderChanges.releaseSignInChange(locks);
      throw err;
    }
  }

  // Once the write is done (the success hooks): its locks are given back, once.
  public static async afterUpdate(updateBy: object): Promise<void> {
    const write: SsoRequirementWrite | undefined =
      SsoRequirementChanges.writes.get(updateBy);

    if (!write) {
      return;
    }

    SsoRequirementChanges.writes.delete(updateBy);

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
