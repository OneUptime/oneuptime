import SsoTeamMembership, {
  SsoTeamMembershipOutcome,
} from "./SsoTeamMembership";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import ObjectID from "Common/Types/ObjectID";
import PositiveNumber from "Common/Types/PositiveNumber";
import SsoProviderType from "Common/Types/SSO/SsoProviderType";
import GlobalOIDCProjectService from "Common/Server/Services/GlobalOidcProjectService";
import GlobalSSOProjectService from "Common/Server/Services/GlobalSsoProjectService";
import TeamMemberService from "Common/Server/Services/TeamMemberService";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";
import { ExpressRequest } from "Common/Server/Utils/Express";
import logger, {
  getLogAttributesFromRequest,
  type RequestLike,
} from "Common/Server/Utils/Logger";
import GlobalOIDCProject from "Common/Models/DatabaseModels/GlobalOidcProject";
import GlobalSSOProject from "Common/Models/DatabaseModels/GlobalSsoProject";
import Team from "Common/Models/DatabaseModels/Team";

/*
 * ---------------------------------------------------------------------------
 * WHOM THE SERVER'S OWN SINGLE SIGN-ON GIVES AN ACCOUNT, AND WHICH PROJECTS
 * IT ADDS PEOPLE TO (#11149).
 *
 * Both instance-wide callbacks ask this - SAML (API/GlobalSSO.ts) and
 * OpenID Connect (API/GlobalOIDC.ts) - once the identity provider's answer
 * has verified, so the two protocols cannot drift apart.
 *
 * A server's own provider adds people to projects through the projects
 * attached to it and nothing else (Admin Dashboard > Settings > Single
 * Sign-On > the provider > Attached Projects): each attachment names a
 * project and the teams people join there. "Where this sign-in counts as
 * SSO" decides which projects accept the sign-in where SSO is required; it
 * adds nobody to any project, "Every project" included.
 *
 *   - Someone with no account gets one only when "People without an
 *     account" is "Get one on their first sign-in" AND an attached project
 *     can take them: an attachment that is on, with at least one team of
 *     its own project (SsoTeamMembership.getProjectTeams). With none - no
 *     project attached, as every provider starts - nobody new is made: an
 *     account in no project could do nothing, the sign-in would turn them
 *     away all the same, and the account would be left behind. That is
 *     what the issue's provider did: its page said "Get one on their first
 *     sign-in", it had no project attached, and nobody who signed in got an
 *     account, with nothing in the server's log to say why. Its page now
 *     names the break (AdminDashboard
 *     Components/GlobalProvider/GlobalProviderAnswers), and the log says it
 *     too (logNewcomerTurnedAway).
 *   - Everyone who signs in - new, or an account a master admin made by
 *     hand - joins each such project they are not a member of yet, in its
 *     teams; a project they are in already keeps the teams they have there.
 *
 * Creating accounts for a provider with nothing attached was the other
 * answer, and the wrong one: every provider on its defaults ("Get one on
 * their first sign-in", nothing attached) would start making an account
 * for anyone its identity provider signs in - a Google OAuth client open
 * to every Google account, a multi-tenant Entra ID app - and on a server
 * that lets people create projects, such an account could set a password
 * by email and make projects of its own.
 * ---------------------------------------------------------------------------
 */

export type GlobalSsoProviderType =
  | SsoProviderType.GlobalSSO
  | SsoProviderType.GlobalOIDC;

// A project people join through the provider, and its teams they join.
export interface GlobalSsoJoinableProject {
  projectId: ObjectID;
  // Teams of that project, each once, never empty.
  teams: Array<Team>;
}

export interface GlobalSsoAttachments {
  /*
   * No attachment is on: the provider adds nobody to any project, and its
   * sign-in counts in every project people belong to ("default-all").
   */
  isDefaultAllMode: boolean;
  // The projects of the attachments that are on.
  attachedProjectIds: Array<ObjectID>;
  // The attachments that are on, with teams of their own project: where people join.
  joinableProjects: Array<GlobalSsoJoinableProject>;
}

// Why someone with no account was not given one.
export enum GlobalSsoNewcomerRefusal {
  // "People without an account" is "Must be invited first".
  InviteFirst = "invite-first",
  // No attachment is on: there is no project to put them in.
  NoProjectAttached = "no-project-attached",
  // Projects are attached, but none with a team of its own project.
  NoAttachedProjectHasTeams = "no-attached-project-has-teams",
}

// How the server's log names a provider.
const PROTOCOL_NAMES: Record<GlobalSsoProviderType, string> = {
  [SsoProviderType.GlobalSSO]: "SAML",
  [SsoProviderType.GlobalOIDC]: "OpenID Connect",
};

// What to do about each refusal, said to whoever reads the server's log.
const REFUSAL_REASONS: Record<GlobalSsoNewcomerRefusal, string> = {
  [GlobalSsoNewcomerRefusal.InviteFirst]:
    'its "People without an account" is "Must be invited first". Invite them to a project first',
  [GlobalSsoNewcomerRefusal.NoProjectAttached]:
    'no project is attached to it, and people get an account only by joining an attached project, whatever "People without an account" says. Attach the projects people should join, with their teams, under Attached Projects on the provider\'s page in the Admin Dashboard, or invite them to a project first',
  [GlobalSsoNewcomerRefusal.NoAttachedProjectHasTeams]:
    "none of its attached projects has teams of that project for people to join. Attach the projects again, with the teams people should join, under Attached Projects on the provider's page in the Admin Dashboard, or invite them to a project first",
};

type AttachmentRow = GlobalOIDCProject | GlobalSSOProject;

export default class GlobalSsoProvisioning {
  /*
   * The provider's attachments that are on, and which of them people join:
   * those with teams of their own project. An attachment naming another
   * project's teams - saved before teams were held to its project
   * (Common/Server/Utils/ValidateGlobalProviderProjectTeams) - joins
   * nobody to them, and the server's log says so.
   */
  public static async readAttachments(data: {
    providerType: GlobalSsoProviderType;
    providerId: ObjectID;
  }): Promise<GlobalSsoAttachments> {
    const rows: Array<AttachmentRow> =
      data.providerType === SsoProviderType.GlobalOIDC
        ? await GlobalOIDCProjectService.findBy({
            query: { globalOidcId: data.providerId, isEnabled: true },
            select: { projectId: true, teams: { _id: true } },
            limit: LIMIT_PER_PROJECT,
            skip: 0,
            props: { isRoot: true },
          })
        : await GlobalSSOProjectService.findBy({
            query: { globalSsoId: data.providerId, isEnabled: true },
            select: { projectId: true, teams: { _id: true } },
            limit: LIMIT_PER_PROJECT,
            skip: 0,
            props: { isRoot: true },
          });

    const attachedProjectIds: Array<ObjectID> = [];
    const joinableProjects: Array<GlobalSsoJoinableProject> = [];

    for (const row of rows) {
      if (!row.projectId) {
        continue;
      }

      attachedProjectIds.push(row.projectId);

      const named: number = (row.teams || []).length;

      if (named === 0) {
        continue;
      }

      const teams: Array<Team> = await SsoTeamMembership.getProjectTeams({
        projectId: row.projectId,
        teams: row.teams,
      });

      if (teams.length < named) {
        logger.warn(
          `The server's ${PROTOCOL_NAMES[data.providerType]} provider ${data.providerId.toString()} is attached to project ${row.projectId.toString()} with ${
            named - teams.length
          } team(s) that are not teams of that project, so nobody who signs in with it joins them. Attach the project again with its own teams.`,
          {
            projectId: row.projectId.toString(),
            service: "identity",
          },
        );
      }

      if (teams.length > 0) {
        joinableProjects.push({ projectId: row.projectId, teams: teams });
      }
    }

    return {
      isDefaultAllMode: rows.length === 0,
      attachedProjectIds: attachedProjectIds,
      joinableProjects: joinableProjects,
    };
  }

  /*
   * Why someone with no account gets none through this provider, or null
   * when they get one: "Get one on their first sign-in", and an attached
   * project to put them in.
   */
  public static getNewcomerRefusal(data: {
    disableSignUpWithSso: boolean | undefined;
    attachments: GlobalSsoAttachments;
  }): GlobalSsoNewcomerRefusal | null {
    if (data.disableSignUpWithSso) {
      return GlobalSsoNewcomerRefusal.InviteFirst;
    }

    if (data.attachments.isDefaultAllMode) {
      return GlobalSsoNewcomerRefusal.NoProjectAttached;
    }

    if (data.attachments.joinableProjects.length === 0) {
      return GlobalSsoNewcomerRefusal.NoAttachedProjectHasTeams;
    }

    return null;
  }

  /*
   * Tells whoever reads the server's log why someone with no account was
   * turned away, and what would let them in: the person sees only "You
   * need to be invited.", and a master admin who set "Get one on their
   * first sign-in" had nothing to go on (#11149). The person is not named.
   */
  public static logNewcomerTurnedAway(data: {
    req: ExpressRequest;
    providerType: GlobalSsoProviderType;
    providerId: ObjectID;
    providerName: string | undefined;
    refusal: GlobalSsoNewcomerRefusal;
  }): void {
    logger.info(
      `The server's ${PROTOCOL_NAMES[data.providerType]} provider "${
        data.providerName || ""
      }" (${data.providerId.toString()}) turned away someone with no account, without making one: ${
        REFUSAL_REASONS[data.refusal]
      }.`,
      getLogAttributesFromRequest(data.req as RequestLike),
    );
  }

  /*
   * Adds the person to each project they can join through the provider
   * and are not a member of yet, in its teams. A project with no room for
   * one more person adds them nowhere and is left out: they still sign in
   * to every other project, and join this one on a later sign-in once it
   * has room.
   */
  public static async addToAttachedProjects(data: {
    req: ExpressRequest;
    providerType: GlobalSsoProviderType;
    attachments: GlobalSsoAttachments;
    userId: ObjectID;
  }): Promise<void> {
    for (const project of data.attachments.joinableProjects) {
      const membershipCount: PositiveNumber = await TeamMemberService.countBy({
        query: {
          projectId: project.projectId,
          userId: data.userId,
        },
        props: { isRoot: true },
      });

      // A member already: the teams they have there stay as they are.
      if (membershipCount.toNumber() > 0) {
        continue;
      }

      const joined: SsoTeamMembershipOutcome =
        await SsoTeamMembership.addToTeams({
          projectId: project.projectId,
          userId: data.userId,
          teams: project.teams,
        });

      if (joined === SsoTeamMembershipOutcome.NoRoom) {
        logger.info(
          `The server's ${PROTOCOL_NAMES[data.providerType]} provider did not add user ${data.userId.toString()} to project ${project.projectId.toString()}: it has no room for another person.`,
          getLogAttributesFromRequest(data.req as RequestLike),
        );
      }
    }
  }

  /*
   * Whether "Attached projects only" leaves the person a project its
   * sign-in counts in, asked before a session is made: a session the
   * provider is restricted from would be refused on every request, and
   * signing in again would make the same one.
   *
   * Read as every request reads it (Common/Server/Utils
   * /GlobalSsoAuthorization.doAttachmentsGovernProject): a provider with no
   * attachment at all counts in every project; one whose attachments are
   * all off counts in none - so the callback, which reads only the ones
   * that are on, asks whether there are any others before it lets a
   * provider with none on through. It let them through, and every request
   * after was refused.
   */
  public static async isSignInRestrictedFromEveryProject(data: {
    providerType: GlobalSsoProviderType;
    providerId: ObjectID;
    attachments: GlobalSsoAttachments;
    userId: ObjectID;
  }): Promise<boolean> {
    if (data.attachments.isDefaultAllMode) {
      const attachmentCount: PositiveNumber =
        data.providerType === SsoProviderType.GlobalOIDC
          ? await GlobalOIDCProjectService.countBy({
              query: { globalOidcId: data.providerId },
              props: { isRoot: true },
            })
          : await GlobalSSOProjectService.countBy({
              query: { globalSsoId: data.providerId },
              props: { isRoot: true },
            });

      return attachmentCount.toNumber() > 0;
    }

    if (data.attachments.attachedProjectIds.length === 0) {
      return true;
    }

    const governedMembershipCount: PositiveNumber =
      await TeamMemberService.countBy({
        query: {
          userId: data.userId,
          projectId: QueryHelper.any(data.attachments.attachedProjectIds),
        },
        props: { isRoot: true },
      });

    return governedMembershipCount.toNumber() === 0;
  }
}
