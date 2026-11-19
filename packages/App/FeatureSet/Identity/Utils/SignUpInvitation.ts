import TeamMemberService from "Common/Server/Services/TeamMemberService";
import UserService from "Common/Server/Services/UserService";
import logger from "Common/Server/Utils/Logger";
import InvitationInviterUtil, {
  InvitationInviter,
} from "Common/Server/Utils/TeamMember/InvitationInviter";
import CaptureSpan from "Common/Server/Utils/Telemetry/CaptureSpan";
import UserRegistrationToken from "Common/Server/Utils/UserRegistrationToken";
import SsoManagedSignIn from "Common/Server/Utils/SsoManagedSignIn";
import SsoSignInMethods from "Common/Server/Utils/SsoSignInMethods";
import TeamMember from "Common/Models/DatabaseModels/TeamMember";
import User from "Common/Models/DatabaseModels/User";
import {
  SignUpInvitation,
  SignUpInvitationSsoSignIn,
} from "Common/Types/Accounts/SignUpInvitation";
import { ProjectSignInMethods } from "Common/Types/SSO/SignInMethods";
import { SsoManagedBy } from "Common/Types/SSO/SsoManagedSignIn";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import OneUptimeDate from "Common/Types/Date";
import Email from "Common/Types/Email";
import ObjectID from "Common/Types/ObjectID";

/*
 * THE INVITATION A SIGN-UP LINK IS FOR, ON THE SERVER (#7471,
 * Common/Types/Accounts/SignUpInvitation).
 *
 *   - read: what the sign-up page an invitation opens may say - which
 *     project, who invited them, the name the inviter typed - for the
 *     holder of the invited address's registration token, read and never
 *     spent. Anything else - a token that is wrong, spent, expired or
 *     another address's, an account that has signed up or is blocked, a
 *     person with no invitation left - is the same none.
 *   - acceptForClaimedAccount: once a sign-up has spent that token and
 *     claimed the account, the invitation of the project the page named is
 *     accepted, as the page said creating the account would: the person
 *     followed it to join, and is not asked again.
 */
export default class SignUpInvitationUtil {
  @CaptureSpan()
  public static async read(data: {
    email: unknown;
    token: unknown;
  }): Promise<SignUpInvitation | null> {
    const emailText: string =
      typeof data.email === "string" ? data.email.trim() : "";
    const tokenText: string =
      typeof data.token === "string" ? data.token.trim() : "";

    if (
      !emailText ||
      !Email.isValid(emailText) ||
      !tokenText ||
      !ObjectID.isValidUUID(tokenText)
    ) {
      return null;
    }

    const email: Email = new Email(emailText);

    // The proof that whoever asks holds the invited mailbox.
    if (
      !(await UserRegistrationToken.isRegistrationTokenLive({
        token: new ObjectID(tokenText),
        email: email,
      }))
    ) {
      return null;
    }

    const user: User | null = await UserService.findOneBy({
      query: { email: email },
      select: {
        _id: true,
        name: true,
        password: true,
        isBlocked: true,
        // Whether SSO manages their sign-in is not asked of a master admin.
        isMasterAdmin: true,
      },
      props: {
        isRoot: true,
      },
    });

    // Signed up already, or blocked: the sign-up would not claim it.
    if (!user?.id || user.password || user.isBlocked) {
      return null;
    }

    const memberships: Array<TeamMember> = await TeamMemberService.findBy({
      query: { userId: user.id },
      select: {
        _id: true,
        projectId: true,
        project: {
          name: true,
        },
        hasAcceptedInvitation: true,
        createdByUserId: true,
        createdAt: true,
        inviteeName: true,
      },
      sort: {
        createdAt: SortOrder.Descending,
      },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    const isShown: (membership: TeamMember) => boolean = (
      membership: TeamMember,
    ): boolean => {
      return Boolean(
        membership.projectId && membership.project?.name?.toString().trim(),
      );
    };

    /*
     * The newest invitation still waiting for them - the one whose email
     * they most likely followed - or, with none waiting, the newest
     * membership accepted for them.
     */
    const membership: TeamMember | undefined =
      memberships.find((candidate: TeamMember): boolean => {
        return !candidate.hasAcceptedInvitation && isShown(candidate);
      }) || memberships.find(isShown);

    if (!membership || !membership.projectId) {
      return null;
    }

    let inviter: InvitationInviter | null = null;

    try {
      inviter = await InvitationInviterUtil.readById(
        membership.createdByUserId,
      );
    } catch (err) {
      // Who invited them only adds to the page: it is drawn without them.
      logger.warn("Could not read who made an invitation a sign-up is for.");
      logger.warn(err);
    }

    return {
      projectId: membership.projectId.toString(),
      projectName: membership.project!.name!.toString().trim(),
      inviterName: inviter ? InvitationInviterUtil.getName(inviter) : null,
      /*
       * The name typed with this invitation (#9823), else the one an
       * earlier invitation gave the account nobody has claimed yet.
       */
      name:
        membership.inviteeName?.trim() || user.name?.toString().trim() || null,
      isAccepted: Boolean(membership.hasAcceptedInvitation),
      ssoSignIn: await SignUpInvitationUtil.readSsoSignIn({
        userId: user.id,
        isMasterAdmin: user.isMasterAdmin === true,
        projectId: membership.projectId,
      }),
    };
  }

  /*
   * SINGLE SIGN-ON IN PLACE OF A PASSWORD (#9819): when every project the
   * person would be in manages sign-in with SSO, the project's providers
   * for the page to offer - claiming the account with a password would only
   * be refused (SsoManagedSignIn). Null otherwise, and when the rule or the
   * providers cannot be read: the page is then the sign-up page it always
   * was, and the server still refuses a password where it must. A server
   * that requires SSO for everyone is not this: the page offers its own
   * providers then (SsoRequiredSignIn).
   */
  public static async readSsoSignIn(data: {
    userId: ObjectID;
    isMasterAdmin: boolean;
    projectId: ObjectID;
  }): Promise<SignUpInvitationSsoSignIn | null> {
    try {
      const managedBy: SsoManagedBy | null =
        await SsoManagedSignIn.getManagedByOnceIn({
          userId: data.userId,
          isMasterAdmin: data.isMasterAdmin,
          joiningProjectId: data.projectId,
        });

      if (managedBy !== SsoManagedBy.Projects) {
        return null;
      }

      const methods: ProjectSignInMethods =
        await SsoSignInMethods.getProjectSignInMethods(data.projectId);

      return { providers: methods.ssoProviders };
    } catch (err) {
      logger.warn(
        "Could not read whether single sign-on manages an invited person's sign-in; their sign-up page is the plain one.",
      );
      logger.warn(err);
      return null;
    }
  }

  /*
   * Accepts every invitation of `projectId` still waiting for the account
   * a sign-up has just claimed by spending its registration token: the
   * project its sign-up page named. Returns the project when one was
   * accepted, or null - nothing named, nothing waiting there, or a failure,
   * which never fails the sign-up: the account is made, and the invitation
   * waits for them in the Dashboard as before.
   *
   * As OneUptime: the token this request spent proves it is the invited
   * person accepting, which is all the accept-invitation update checks.
   * The update's hooks do the rest of what accepting does - the person's
   * permissions, their notification defaults (the claim has just verified
   * the address), the other teams of the project.
   */
  @CaptureSpan()
  public static async acceptForClaimedAccount(data: {
    userId: ObjectID;
    projectId: unknown;
  }): Promise<ObjectID | null> {
    const projectIdText: string =
      typeof data.projectId === "string" ? data.projectId.trim() : "";

    if (!projectIdText || !ObjectID.isValidUUID(projectIdText)) {
      return null;
    }

    const projectId: ObjectID = new ObjectID(projectIdText);

    try {
      const accepted: number = await TeamMemberService.updateBy({
        query: {
          userId: data.userId,
          projectId: projectId,
          hasAcceptedInvitation: false,
        },
        data: {
          hasAcceptedInvitation: true,
          invitationAcceptedAt: OneUptimeDate.getCurrentDate(),
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        props: {
          isRoot: true,
        },
      });

      return accepted > 0 ? projectId : null;
    } catch (err) {
      logger.error(err);
      return null;
    }
  }
}
