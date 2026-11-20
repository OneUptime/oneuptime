import ProjectService from "../Services/ProjectService";
import TeamMemberService from "../Services/TeamMemberService";
import UserService from "../Services/UserService";
import QueryHelper from "../Types/Database/QueryHelper";
import logger from "./Logger";
import SsoRequiredSignIn from "./SsoRequiredSignIn";
import SsoSignInMethods from "./SsoSignInMethods";
import Project from "../../Models/DatabaseModels/Project";
import TeamMember from "../../Models/DatabaseModels/TeamMember";
import User from "../../Models/DatabaseModels/User";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import BadDataException from "../../Types/Exception/BadDataException";
import NotFoundException from "../../Types/Exception/NotFoundException";
import ObjectID from "../../Types/ObjectID";
import SignInManagementUtil, {
  MAX_LOCAL_SIGN_IN_PROJECT_NAMES,
  MAX_SSO_PROVIDER_NAMES,
  SignInManagement,
  SSO_MANAGED_SIGN_IN_MESSAGE,
  SsoManagedBy,
} from "../../Types/SSO/SsoManagedSignIn";
import {
  ProjectSignInMethods,
  SsoSignInProvider,
} from "../../Types/SSO/SignInMethods";

/*
 * WHETHER SOMEONE'S SIGN-IN IS MANAGED BY SINGLE SIGN-ON, AND THE LOCAL
 * SIGN-IN SETTINGS THAT ARE REFUSED THEM (issues #9688 and #9763).
 *
 * The rule and why are in Common/Types/SSO/SsoManagedSignIn.ts. In short,
 * nobody but a master admin sets a password, passkey, security key,
 * authenticator app, backup codes or two-factor authentication in OneUptime
 * while either:
 *
 *   - the whole server requires SSO (SsoManagedBy.Server) - the people
 *     SsoRequiredSignIn refuses every other sign-in for; or
 *   - every project they belong to, an invitation they have not accepted
 *     yet included, requires SSO and manages sign-in with it
 *     (Project.manageSignInWithSso, SsoManagedBy.Projects).
 *
 * Whether someone is a master admin is read from their account, never from
 * the session asking: a session keeps what it was signed with for as long as
 * its token lives. It is read before either rule, as at sign-in, so a rule
 * that cannot be read never refuses a master admin anything; for everyone
 * else a rule that cannot be read refuses (it throws), as it does at
 * sign-in - a failed read is never "not required" (GlobalConfigService).
 *
 * The projects' rule is read from the database on every ask, never kept:
 * an invitation to a project that does not require SSO gives someone their
 * settings back at once, and leaving it covers them again at once.
 *
 * Every write the rule covers asks assertMayChangeLocalSignIn first:
 *
 *   - a new password from the profile (UserService.onBeforeUpdate);
 *   - turning two-factor authentication on (UserService
 *     .assertTwoFactorAuthMayBeTurnedOn);
 *   - adding an authenticator app (UserTotpAuthService.onBeforeCreate) and
 *     finishing it with its first code (POST /user-totp-auth/validate);
 *   - adding a passkey or a security key (UserWebAuthnService
 *     .generateRegistrationOptions and .verifyRegistration);
 *   - new backup codes (POST /user-two-factor-backup-code/generate);
 *   - a second step set up at sign-in (the Identity API's enrolment), and
 *     a password chosen to claim an invited account at sign-up.
 *
 * Forgot password asks isManagedBySsoFor and mails such an account no link.
 * GET /user/sign-in-management answers getSignInManagement, for the profile,
 * and the Admin Dashboard's Authentication page reads getManagedBy.
 */

// A project as the projects' rule reads it.
export interface SsoManagedSignInProject {
  id: ObjectID;
  name: string;
}

// Where someone stands, by the rule above.
export interface SsoManagedSignInState {
  // Why their sign-in is managed by SSO, or null when it is not.
  managedBy: SsoManagedBy | null;
  /*
   * Their projects that manage sign-in with SSO: they require it and have
   * Manage Sign-In with SSO on. Read only when the server does not require
   * SSO: every project then.
   */
  managingProjects: Array<SsoManagedSignInProject>;
  /*
   * Their other projects: those that keep their own sign-in theirs. Not
   * empty, with managingProjects not empty either, for someone some of
   * whose projects manage sign-in and some do not.
   */
  otherProjects: Array<SsoManagedSignInProject>;
}

// An account whose id and master-admin standing are known.
export interface SsoManagedSignInAccount {
  userId: ObjectID;
  isMasterAdmin?: boolean | undefined;
}

const NOT_MANAGED: SsoManagedSignInState = {
  managedBy: null,
  managingProjects: [],
  otherProjects: [],
};

export default class SsoManagedSignIn {
  /*
   * Where an account whose master-admin standing is known stands: nothing
   * for a master admin, without reading either rule.
   */
  public static async getStateFor(
    account: SsoManagedSignInAccount,
  ): Promise<SsoManagedSignInState> {
    if (account.isMasterAdmin === true) {
      return NOT_MANAGED;
    }

    if (
      await SsoRequiredSignIn.isNonSsoSignInRefused({
        isMasterAdmin: account.isMasterAdmin,
      })
    ) {
      return {
        managedBy: SsoManagedBy.Server,
        managingProjects: [],
        otherProjects: [],
      };
    }

    const projects: {
      managingProjects: Array<SsoManagedSignInProject>;
      otherProjects: Array<SsoManagedSignInProject>;
    } = await SsoManagedSignIn.readProjects(account.userId);

    return {
      managedBy:
        projects.managingProjects.length > 0 &&
        projects.otherProjects.length === 0
          ? SsoManagedBy.Projects
          : null,
      managingProjects: projects.managingProjects,
      otherProjects: projects.otherProjects,
    };
  }

  /*
   * Whether an account whose master-admin standing is known is covered:
   * false for a master admin without reading either rule.
   */
  public static async isManagedBySsoFor(
    account: SsoManagedSignInAccount,
  ): Promise<boolean> {
    return (await SsoManagedSignIn.getStateFor(account)).managedBy !== null;
  }

  /*
   * Where this person stands now. Throws NotFoundException for an account
   * that does not exist, and a rule's own error when it cannot be read for
   * someone who is not a master admin.
   */
  public static async getState(
    userId: ObjectID,
  ): Promise<SsoManagedSignInState> {
    const user: User | null = await UserService.findOneById({
      id: userId,
      select: {
        _id: true,
        isMasterAdmin: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!user) {
      throw new NotFoundException("User not found.");
    }

    return await SsoManagedSignIn.getStateFor({
      userId: userId,
      isMasterAdmin: user.isMasterAdmin === true,
    });
  }

  /*
   * WHETHER AN INVITATION LEADS TO SSO (#9819): why the person's sign-in
   * would be managed by SSO once they are in `joiningProjectId` - the rule
   * above, with that project among theirs - or null when it would not. The
   * invitation email and the page it opens then offer that project's SSO
   * instead of a password nobody could set. Asked before the membership is
   * written, so the project is counted whether or not it is there yet.
   *
   * Someone who also belongs to a project that does not manage sign-in -
   * an accepted membership or another invitation - keeps their own sign-in,
   * so their invitation is the one it always was: nobody is sent to an SSO
   * that would not be the only way in. A master admin never; a person with
   * no account yet (userId null) has no other project.
   */
  public static async getManagedByOnceIn(data: {
    userId: ObjectID | null;
    // Read from the account when not given.
    isMasterAdmin?: boolean | undefined;
    joiningProjectId: ObjectID;
  }): Promise<SsoManagedBy | null> {
    let isMasterAdmin: boolean | undefined = data.isMasterAdmin;

    if (isMasterAdmin === undefined && data.userId) {
      const user: User | null = await UserService.findOneById({
        id: data.userId,
        select: {
          _id: true,
          isMasterAdmin: true,
        },
        props: {
          isRoot: true,
        },
      });

      isMasterAdmin = user?.isMasterAdmin === true;
    }

    if (isMasterAdmin === true) {
      return null;
    }

    if (
      await SsoRequiredSignIn.isNonSsoSignInRefused({
        isMasterAdmin: isMasterAdmin,
      })
    ) {
      return SsoManagedBy.Server;
    }

    const joiningProject: Project | null = await ProjectService.findOneById({
      id: data.joiningProjectId,
      select: {
        _id: true,
        requireSsoForLogin: true,
        manageSignInWithSso: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (
      !joiningProject ||
      joiningProject.requireSsoForLogin !== true ||
      joiningProject.manageSignInWithSso !== true
    ) {
      return null;
    }

    if (!data.userId) {
      return SsoManagedBy.Projects;
    }

    const projects: {
      managingProjects: Array<SsoManagedSignInProject>;
      otherProjects: Array<SsoManagedSignInProject>;
    } = await SsoManagedSignIn.readProjects(data.userId);

    return projects.otherProjects.length === 0 ? SsoManagedBy.Projects : null;
  }

  // Why this person's sign-in is managed by SSO now, or null when it is not.
  public static async getManagedBy(
    userId: ObjectID,
  ): Promise<SsoManagedBy | null> {
    return (await SsoManagedSignIn.getState(userId)).managedBy;
  }

  // Whether this person's sign-in is managed by SSO now (see getState).
  public static async isManagedBySso(userId: ObjectID): Promise<boolean> {
    return (await SsoManagedSignIn.getManagedBy(userId)) !== null;
  }

  // Throws SSO_MANAGED_SIGN_IN_MESSAGE when isManagedBySso.
  public static async assertMayChangeLocalSignIn(
    userId: ObjectID,
  ): Promise<void> {
    if (await SsoManagedSignIn.isManagedBySso(userId)) {
      throw new BadDataException(SSO_MANAGED_SIGN_IN_MESSAGE);
    }
  }

  // assertMayChangeLocalSignIn, for an account whose standing is known.
  public static async assertMayChangeLocalSignInFor(
    account: SsoManagedSignInAccount,
  ): Promise<void> {
    if (await SsoManagedSignIn.isManagedBySsoFor(account)) {
      throw new BadDataException(SSO_MANAGED_SIGN_IN_MESSAGE);
    }
  }

  /*
   * What User Profile is told about the signed-in person: whether their
   * organization manages their sign-in, the names of the SSO providers that
   * sign them in, and - when some of their projects manage sign-in but not
   * every one does - the projects that keep their settings theirs. The
   * providers' names are a courtesy: a list that cannot be read is logged
   * and left empty, and the profile then says "single sign-on" - it is the
   * rule that decides what it shows.
   */
  public static async getSignInManagement(
    userId: ObjectID,
  ): Promise<SignInManagement> {
    const state: SsoManagedSignInState =
      await SsoManagedSignIn.getState(userId);

    const isPartlyManaged: boolean =
      state.managedBy === null && state.managingProjects.length > 0;

    if (state.managedBy === null && !isPartlyManaged) {
      return {
        isManagedBySso: false,
        ssoProviderNames: [],
        localSignInProjectNames: [],
      };
    }

    let providerNames: Array<string> = [];

    try {
      providerNames =
        state.managedBy === SsoManagedBy.Server
          ? (await SsoSignInMethods.getInstanceWideProviders()).map(
              (provider: SsoSignInProvider): string => {
                return provider.name;
              },
            )
          : await SsoManagedSignIn.readProjectProviderNames(
              state.managingProjects,
            );
    } catch (err) {
      logger.error(
        "Could not read the SSO providers for a person's profile; it names none.",
      );
      logger.error(err);
    }

    return {
      isManagedBySso: state.managedBy !== null,
      ssoProviderNames: SignInManagementUtil.readProviderNames(providerNames),
      localSignInProjectNames: isPartlyManaged
        ? SignInManagementUtil.readProjectNames(
            state.otherProjects.map(
              (project: SsoManagedSignInProject): string => {
                return project.name;
              },
            ),
          )
        : [],
    };
  }

  /*
   * The person's projects, split by the projects' rule: those that require
   * SSO and manage sign-in with it, and the rest. Every membership counts,
   * an invitation not accepted yet included - its project will be theirs
   * the moment they accept, and asks for their own sign-in if it does not
   * manage it. A project that no longer exists counts for nothing.
   */
  private static async readProjects(userId: ObjectID): Promise<{
    managingProjects: Array<SsoManagedSignInProject>;
    otherProjects: Array<SsoManagedSignInProject>;
  }> {
    const projectIds: Array<ObjectID> =
      await SsoManagedSignIn.readMemberProjectIds(userId);

    const managingProjects: Array<SsoManagedSignInProject> = [];
    const otherProjects: Array<SsoManagedSignInProject> = [];

    if (projectIds.length === 0) {
      return { managingProjects, otherProjects };
    }

    for (let start: number = 0; start < projectIds.length; start += LIMIT_MAX) {
      const batch: Array<ObjectID> = projectIds.slice(start, start + LIMIT_MAX);

      const projects: Array<Project> = await ProjectService.findBy({
        query: {
          _id: QueryHelper.any(batch),
        },
        select: {
          _id: true,
          name: true,
          requireSsoForLogin: true,
          manageSignInWithSso: true,
        },
        limit: batch.length,
        skip: 0,
        props: {
          isRoot: true,
        },
      });

      for (const project of projects) {
        if (!project.id) {
          continue;
        }

        const entry: SsoManagedSignInProject = {
          id: project.id,
          name: (project.name || "").toString(),
        };

        if (
          project.requireSsoForLogin === true &&
          project.manageSignInWithSso === true
        ) {
          managingProjects.push(entry);
        } else {
          otherProjects.push(entry);
        }
      }
    }

    return { managingProjects, otherProjects };
  }

  // Every project the person is a member of or invited to, each once.
  private static async readMemberProjectIds(
    userId: ObjectID,
  ): Promise<Array<ObjectID>> {
    const projectIds: Map<string, ObjectID> = new Map<string, ObjectID>();

    for (let skip: number = 0; ; skip += LIMIT_MAX) {
      const memberships: Array<TeamMember> = await TeamMemberService.findBy({
        query: {
          userId: userId,
        },
        select: {
          _id: true,
          projectId: true,
        },
        limit: LIMIT_MAX,
        skip: skip,
        props: {
          isRoot: true,
        },
      });

      for (const membership of memberships) {
        if (membership.projectId) {
          projectIds.set(
            membership.projectId.toString().toLowerCase(),
            membership.projectId,
          );
        }
      }

      if (memberships.length < LIMIT_MAX) {
        break;
      }
    }

    return Array.from(projectIds.values());
  }

  /*
   * The providers that sign people in to these projects - each project's own
   * that are on, and the server's that reach it, only the one it requires
   * when it requires one (SsoSignInMethods.getProjectSignInMethods) - each
   * name once, from as many projects as it takes to name the most a profile
   * names.
   */
  private static async readProjectProviderNames(
    projects: Array<SsoManagedSignInProject>,
  ): Promise<Array<string>> {
    const names: Array<string> = [];
    const seen: Set<string> = new Set<string>();

    for (const project of projects.slice(0, MAX_LOCAL_SIGN_IN_PROJECT_NAMES)) {
      const methods: ProjectSignInMethods =
        await SsoSignInMethods.getProjectSignInMethods(project.id);

      for (const provider of methods.ssoProviders) {
        const key: string = provider.name.trim().toLowerCase();

        if (!key || seen.has(key)) {
          continue;
        }

        seen.add(key);
        names.push(provider.name);
      }

      if (names.length >= MAX_SSO_PROVIDER_NAMES) {
        break;
      }
    }

    return names;
  }
}
