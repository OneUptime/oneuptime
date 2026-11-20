import ProjectSsoSignInConfirmation from "./ProjectSsoSignInConfirmation";
import AccessTokenService from "Common/Server/Services/AccessTokenService";
import TeamMemberService from "Common/Server/Services/TeamMemberService";
import UserProjectSsoConsentService from "Common/Server/Services/UserProjectSsoConsentService";
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
import {
  ProjectSignInMethods,
  SsoSignInProvider,
} from "Common/Types/SSO/SignInMethods";
import { SsoManagedBy } from "Common/Types/SSO/SsoManagedSignIn";
import SsoProviderType from "Common/Types/SSO/SsoProviderType";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import OneUptimeDate from "Common/Types/Date";
import Email from "Common/Types/Email";
import ObjectID from "Common/Types/ObjectID";
import PositiveNumber from "Common/Types/PositiveNumber";

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
 *   - confirmSsoSignIn: on OneUptime Cloud, the page's link taken as the
 *     mailbox's confirmation of the project's single sign-on, as its person
 *     picks one of its providers, so that provider's sign-in goes through
 *     the first time (#9898).
 */

/*
 * What came of the page's link offered as the mailbox's confirmation of a
 * project's single sign-on (confirmSsoSignIn): logged on the server, never
 * answered, so asking tells nobody anything.
 */
export enum SignUpInvitationSsoOutcome {
  Confirmed = "confirmed",
  NotNeeded = "this server signs people in through a project's single sign-on without asking their mailbox",
  NotAsked = "the request did not name an address, a token and a project",
  LinkNotLive = "the link's token is not live for the address",
  NoAccountToClaim = "no account the link can claim: none at the address, or one that has signed up",
  Blocked = "the account is blocked",
  Administrator = "the account is a OneUptime administrator's",
  NoInvitationWaiting = "no invitation into the project waits for the account",
  NotManagedBySso = "single sign-on would not manage the person's sign-in once they join the project",
  NoProjectProvider = "the project has no provider of its own turned on",
  LinkSpentMeanwhile = "another request spent the link first",
  NotJoined = "no invitation was accepted, so no consent was recorded",
  Failed = "the server could not finish",
}

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

  /*
   * THE PAGE'S LINK, AS THE MAILBOX'S CONFIRMATION OF THE PROJECT'S SINGLE
   * SIGN-ON (#9898).
   *
   * On OneUptime Cloud a project's SAML or OIDC provider signs someone in
   * only once they have confirmed, from their mailbox, that it may: the
   * project's admins configure it, and could assert any address
   * (ProjectSsoSignInConfirmation). Someone invited into a project whose
   * people sign in with SSO follows their invitation email to the sign-up
   * page, which offers the project's providers (readSsoSignIn). Picking one
   * went through the provider, stopped at "Check your email", and took a
   * second email and a second trip through the provider.
   *
   * The page's link already proves the mailbox, exactly as that second
   * email's link does: its registration token went only into the invitation
   * email to the address (UserRegistrationToken), or to a master admin of a
   * server that cannot send email (InvitationLink), who can set the
   * account's password anyway. And picking the project's provider on the
   * page their own invitation opens is the person saying that the project's
   * single sign-on may sign them in, which is what the second email asked.
   * So the page sends the link here as they pick a provider, and it counts
   * as that confirmation: the token is spent, the invitation into the
   * project accepted, the address verified and the consent recorded, as a
   * confirmed email's link does (ProjectSsoSignInConfirmation.confirm). The
   * provider's answer then signs them in the first time.
   *
   * Only when every one of these holds, read before anything is written;
   * otherwise nothing is written, and a token that was live stays live:
   *
   *   - this is OneUptime Cloud: a self-hosted server signs people in
   *     through a project's SSO without asking the mailbox, and verifies and
   *     accepts as it does (ProjectSsoSignInGate);
   *   - the token is live, and the address's;
   *   - the account at the address has not signed up (it has no password,
   *     so the link can claim it), is not blocked, and is no OneUptime
   *     administrator's: a project's provider never signs one in;
   *   - an invitation into the project waits for it;
   *   - single sign-on would manage their sign-in there (SsoManagedSignIn),
   *     as it does whenever the page offers providers;
   *   - the project has a provider of its own turned on, whose sign-ins the
   *     consent is for: an instance-wide provider asks no mailbox.
   *
   * The token is spent first, so of two requests racing on one link only
   * the one whose spend removed it writes. Never throws: the route answers
   * every request alike, whatever came of it, and only the server's log
   * says why - by project, never by address.
   */
  @CaptureSpan()
  public static async confirmSsoSignIn(data: {
    email: unknown;
    token: unknown;
    projectId: unknown;
  }): Promise<SignUpInvitationSsoOutcome> {
    let outcome: SignUpInvitationSsoOutcome = SignUpInvitationSsoOutcome.Failed;
    let confirmed: { userId: ObjectID; projectId: ObjectID } | null = null;

    try {
      const result: {
        outcome: SignUpInvitationSsoOutcome;
        userId?: ObjectID | undefined;
        projectId?: ObjectID | undefined;
      } = await SignUpInvitationUtil.confirmSsoSignInOrSayWhyNot(data);

      outcome = result.outcome;

      if (
        outcome === SignUpInvitationSsoOutcome.Confirmed &&
        result.userId &&
        result.projectId
      ) {
        confirmed = { userId: result.userId, projectId: result.projectId };
      }
    } catch (err) {
      logger.error(err);
      outcome = SignUpInvitationSsoOutcome.Failed;
    }

    if (confirmed) {
      logger.info(
        "An invitation's link confirmed its project's single sign-on from the mailbox",
        {
          userId: confirmed.userId.toString(),
          projectId: confirmed.projectId.toString(),
          service: "identity",
        },
      );
    } else if (outcome !== SignUpInvitationSsoOutcome.NotNeeded) {
      const projectIdText: string =
        typeof data.projectId === "string" &&
        ObjectID.isValidUUID(data.projectId.trim())
          ? data.projectId.trim()
          : "";

      logger.info(
        `An invitation's link did not confirm the single sign-on of ${projectIdText ? `project ${projectIdText}` : "a project"}: ${outcome}.`,
        {
          ...(projectIdText ? { projectId: projectIdText } : {}),
          service: "identity",
        },
      );
    }

    return outcome;
  }

  private static async confirmSsoSignInOrSayWhyNot(data: {
    email: unknown;
    token: unknown;
    projectId: unknown;
  }): Promise<{
    outcome: SignUpInvitationSsoOutcome;
    userId?: ObjectID | undefined;
    projectId?: ObjectID | undefined;
  }> {
    if (!ProjectSsoSignInConfirmation.isRequired()) {
      return { outcome: SignUpInvitationSsoOutcome.NotNeeded };
    }

    const emailText: string =
      typeof data.email === "string" ? data.email.trim() : "";
    const tokenText: string =
      typeof data.token === "string" ? data.token.trim() : "";
    const projectIdText: string =
      typeof data.projectId === "string" ? data.projectId.trim() : "";

    if (
      !emailText ||
      !Email.isValid(emailText) ||
      !tokenText ||
      !ObjectID.isValidUUID(tokenText) ||
      !projectIdText ||
      !ObjectID.isValidUUID(projectIdText)
    ) {
      return { outcome: SignUpInvitationSsoOutcome.NotAsked };
    }

    const email: Email = new Email(emailText);
    const token: ObjectID = new ObjectID(tokenText);
    const projectId: ObjectID = new ObjectID(projectIdText);

    // The proof that whoever asks holds the invited mailbox.
    if (
      !(await UserRegistrationToken.isRegistrationTokenLive({
        token: token,
        email: email,
      }))
    ) {
      return { outcome: SignUpInvitationSsoOutcome.LinkNotLive };
    }

    const user: User | null = await UserService.findOneBy({
      query: { email: email },
      select: {
        _id: true,
        password: true,
        isBlocked: true,
        isMasterAdmin: true,
        isEmailVerified: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!user?.id || user.password) {
      return { outcome: SignUpInvitationSsoOutcome.NoAccountToClaim };
    }

    if (user.isBlocked) {
      return { outcome: SignUpInvitationSsoOutcome.Blocked };
    }

    if (
      ProjectSsoSignInConfirmation.mustNotSignInThroughProjectProvider(user)
    ) {
      return { outcome: SignUpInvitationSsoOutcome.Administrator };
    }

    const userId: ObjectID = user.id;

    const waiting: PositiveNumber = await TeamMemberService.countBy({
      query: {
        userId: userId,
        projectId: projectId,
        hasAcceptedInvitation: false,
      },
      props: {
        isRoot: true,
      },
    });

    if (waiting.toNumber() === 0) {
      return { outcome: SignUpInvitationSsoOutcome.NoInvitationWaiting };
    }

    if (
      (await SsoManagedSignIn.getManagedByOnceIn({
        userId: userId,
        isMasterAdmin: false,
        joiningProjectId: projectId,
      })) !== SsoManagedBy.Projects
    ) {
      return { outcome: SignUpInvitationSsoOutcome.NotManagedBySso };
    }

    const methods: ProjectSignInMethods =
      await SsoSignInMethods.getProjectSignInMethods(projectId);

    if (
      !methods.ssoProviders.some((provider: SsoSignInProvider): boolean => {
        return (
          provider.type === SsoProviderType.ProjectSSO ||
          provider.type === SsoProviderType.ProjectOIDC
        );
      })
    ) {
      return { outcome: SignUpInvitationSsoOutcome.NoProjectProvider };
    }

    /*
     * Everything that can refuse has been read. Spent before anything is
     * written: only the request whose spend removed the token goes on.
     */
    if (
      !(await UserRegistrationToken.consumeRegistrationToken({
        token: token,
        email: email,
      }))
    ) {
      return { outcome: SignUpInvitationSsoOutcome.LinkSpentMeanwhile };
    }

    // Joining the project they picked its single sign-on for.
    const joined: ObjectID | null =
      await SignUpInvitationUtil.acceptForClaimedAccount({
        userId: userId,
        projectId: projectIdText,
      });

    /*
     * After the memberships, so UserService's verification hook finds them
     * accepted and gives them their notification defaults: the spent token
     * proved the mailbox, as a sign-up that spends it does.
     */
    if (!user.isEmailVerified) {
      await UserService.updateOneById({
        id: userId,
        data: {
          isEmailVerified: true,
        },
        props: {
          isRoot: true,
        },
      });
    }

    /*
     * A consent is to be in the project. With no invitation accepted -
     * removed in the meantime, or a write that failed - none is recorded,
     * and the provider's answer asks the mailbox as it always did.
     */
    if (!joined) {
      return { outcome: SignUpInvitationSsoOutcome.NotJoined };
    }

    await UserProjectSsoConsentService.recordConsent({
      userId: userId,
      projectId: projectId,
    });

    await AccessTokenService.refreshUserAllPermissions(userId);

    return {
      outcome: SignUpInvitationSsoOutcome.Confirmed,
      userId: userId,
      projectId: projectId,
    };
  }
}
