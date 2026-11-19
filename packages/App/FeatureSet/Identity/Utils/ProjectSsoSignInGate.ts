import { respondToMobileSsoFailure } from "./MobileSso";
import ProjectSsoSignInConfirmation, {
  PROJECT_SSO_CONFIRMATION_REQUIRED_ERROR,
  PROJECT_SSO_CONFIRMATION_REQUIRED_MESSAGE,
  PROJECT_SSO_CONFIRMATION_REQUIRED_TITLE,
  PROJECT_SSO_SIGN_IN_REFUSED_ERROR,
  PROJECT_SSO_SIGN_IN_REFUSED_MESSAGE,
  PROJECT_SSO_SIGN_IN_REFUSED_TITLE,
  ProjectSsoKind,
} from "./ProjectSsoSignInConfirmation";
import TeamMemberService from "Common/Server/Services/TeamMemberService";
import UserProjectSsoConsentService from "Common/Server/Services/UserProjectSsoConsentService";
import UserService from "Common/Server/Services/UserService";
import { ExpressRequest, ExpressResponse } from "Common/Server/Utils/Express";
import logger from "Common/Server/Utils/Logger";
import Response from "Common/Server/Utils/Response";
import User from "Common/Models/DatabaseModels/User";
import { SignInFailureReason } from "Common/Types/AuditLog/AuditLogSignInFailure";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import OneUptimeDate from "Common/Types/Date";
import Email from "Common/Types/Email";
import Name from "Common/Types/Name";
import ObjectID from "Common/Types/ObjectID";
import RequestOrigin from "Common/Types/RequestOrigin";

// The page a sign-in that did not go through is told so on.
export const MESSAGE_VIEW: string =
  "/usr/src/app/FeatureSet/Identity/Views/Message.ejs";

/*
 * ---------------------------------------------------------------------------
 * WHOM A PROJECT'S SINGLE SIGN-ON SIGNS IN, AND WHAT EVERYONE ELSE IS TOLD
 * (#9824). Both project callbacks ask it - SAML (API/SSO.ts) and OpenID
 * Connect (API/OIDC.ts) - once the provider's answer has verified.
 *
 * A project's provider is configured by that project's admins, so whoever
 * controls one can assert any address and read the answer. The answers used
 * to differ by the account behind the address: "Account blocked." for a
 * blocked one, "Sign in with your OneUptime account." for an
 * administrator's, "Email not verified." for an unverified one on a
 * self-hosted server, and, on the hosted service, a sign-in for an address
 * with no account made the account first - a scrypt hash, so it took
 * longer, and an account was left behind for every address asserted. So a
 * hostile provider told its admin which addresses had accounts, and which of
 * them were blocked or administrators.
 *
 * Now every sign-in that does not go through gets one answer, in the same
 * time, wherever the protocol lets it:
 *
 *   - On the hosted service (ProjectSsoSignInConfirmation.isRequired), an
 *     address may be signed in only once its owner has confirmed this
 *     project's sign-in from the mailbox. Everyone else - no account yet, an
 *     account that has not confirmed (an unverified one included), a blocked
 *     one, an administrator's - is answered "Check your email.", whose
 *     words are true of each: a link goes only where it can do something.
 *     An address no account uses is sent a link that makes the account once
 *     confirmed (requestConfirmationForNewAccount), never before; one that
 *     has not confirmed, the link it always was; a blocked or administrator
 *     account, nothing. Every one of them takes the same reads (its
 *     account, and its consent - a stand-in's for no account), and what is
 *     mailed is never waited for.
 *   - On a self-hosted server the project's provider is trusted with the
 *     address, as it always was for an account it makes: an address with no
 *     account gets one, and an account whose address is not verified yet
 *     signs in like any other and is verified - as one the provider had just
 *     made would be. A blocked account and an administrator's are refused,
 *     with one refusal for both. Neither can look like a sign-in that went
 *     through, which a self-hosted server's provider has always been able to
 *     tell apart.
 *
 * The reason is logged on the server, and a refused account's own projects
 * record it in their audit logs (FailedSignInAuditLog), as before.
 * ---------------------------------------------------------------------------
 */

export enum ProjectSsoGateOutcome {
  // The account may be signed in through this provider.
  SignIn = "sign-in",
  // The hosted service's one answer for everyone else: "Check your email."
  CheckEmail = "check-email",
  // A self-hosted server's one refusal, for a blocked account or an administrator's.
  Refused = "refused",
}

// Why a sign-in did not go through: logged, never shown.
export enum ProjectSsoGateReason {
  NoAccount = "no account uses the address yet",
  NotConfirmed = "the account has not confirmed this project's single sign-on from its mailbox",
  Blocked = "the account is blocked",
  Administrator = "the account is a OneUptime administrator's",
}

export interface ProjectSsoGateDecision {
  outcome: ProjectSsoGateOutcome;
  // The account at the address: made just now, on a self-hosted server, for one with none.
  user: User | null;
  isNewUser: boolean;
  reason: ProjectSsoGateReason | null;
}

// What the callbacks read of the account at the address.
export const PROJECT_SSO_SIGN_IN_USER_SELECT: {
  _id: true;
  name: true;
  email: true;
  isMasterAdmin: true;
  isEmailVerified: true;
  isBlocked: true;
  profilePictureId: true;
  timezone: true;
} = {
  _id: true,
  name: true,
  email: true,
  isMasterAdmin: true,
  isEmailVerified: true,
  isBlocked: true,
  profilePictureId: true,
  timezone: true,
};

/*
 * Whose consent is asked when no account has the address: nobody's, so the
 * answer is always no, and the read takes the time a real one does.
 */
export const NO_ACCOUNT_CONSENT_STAND_IN: ObjectID = new ObjectID(
  "00000000-0000-4000-8000-000000000000",
);

// What a sign-in set going without waiting for it: the emails above.
const backgroundWork: Set<Promise<void>> = new Set<Promise<void>>();

export default class ProjectSsoSignInGate {
  /*
   * Runs work the answer must not wait for. Each piece never throws (the
   * emails log their own failures); this only keeps hold of it until it
   * has finished, for waitForBackgroundWork.
   */
  public static inBackground(work: Promise<void>): void {
    const held: Promise<void> = work
      .catch((err: unknown) => {
        logger.error(err as Error);
      })
      .finally(() => {
        backgroundWork.delete(held);
      });

    backgroundWork.add(held);
  }

  // Waits for the work sign-ins set going: for a test, or a graceful stop.
  public static async waitForBackgroundWork(): Promise<void> {
    while (backgroundWork.size > 0) {
      await Promise.all(Array.from(backgroundWork));
    }
  }

  public static async decide(data: {
    email: Email;
    name: Name | null;
    projectId: ObjectID;
    kind: ProjectSsoKind;
    providerId: ObjectID;
    origin?: RequestOrigin | undefined;
  }): Promise<ProjectSsoGateDecision> {
    const user: User | null = await UserService.findOneBy({
      query: { email: data.email },
      select: PROJECT_SSO_SIGN_IN_USER_SELECT,
      props: {
        isRoot: true,
      },
    });

    const decision: ProjectSsoGateDecision =
      ProjectSsoSignInConfirmation.isRequired()
        ? await ProjectSsoSignInGate.decideOnHostedService({
            ...data,
            user: user,
          })
        : await ProjectSsoSignInGate.decideOnSelfHostedServer({
            ...data,
            user: user,
          });

    if (decision.outcome !== ProjectSsoGateOutcome.SignIn) {
      logger.info(
        `A ${data.kind} sign-in through provider ${data.providerId.toString()} of project ${data.projectId.toString()} did not go through: ${decision.reason}.`,
        {
          projectId: data.projectId.toString(),
          ...(decision.user?.id ? { userId: decision.user.id.toString() } : {}),
          service: "identity",
        },
      );
    }

    return decision;
  }

  /*
   * A sign-in through a project's own single sign-on that is going through
   * is the person joining that project: every invitation into it they have
   * not accepted yet is accepted now (#9819) - the invitation that sent
   * them here said to sign in with it - with the hooks an acceptance runs
   * (their notification defaults, the seats, the other teams). Then an
   * address not verified yet is verified: the provider vouched for it, as
   * it does for an account it makes (on the hosted service nobody gets
   * this far unverified). Returns the account as it now stands.
   */
  public static async joinOnSignIn(data: {
    user: User;
    projectId: ObjectID;
  }): Promise<User> {
    const userId: ObjectID = data.user.id!;

    await TeamMemberService.updateBy({
      query: {
        projectId: data.projectId,
        userId: userId,
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

    if (!data.user.isEmailVerified) {
      await UserService.updateOneById({
        id: userId,
        data: {
          isEmailVerified: true,
        },
        props: {
          isRoot: true,
        },
      });

      data.user.isEmailVerified = true;
    }

    return data.user;
  }

  /*
   * The answer to a sign-in that did not go through: the page, or the
   * mobile app's deep link, for the outcome - never for the reason.
   */
  public static respondNotSignedIn(data: {
    req: ExpressRequest;
    res: ExpressResponse;
    isMobileRequest: boolean;
    outcome: ProjectSsoGateOutcome;
  }): void {
    const isCheckEmail: boolean =
      data.outcome === ProjectSsoGateOutcome.CheckEmail;

    if (
      respondToMobileSsoFailure({
        res: data.res,
        isMobileRequest: data.isMobileRequest,
        error: isCheckEmail
          ? PROJECT_SSO_CONFIRMATION_REQUIRED_ERROR
          : PROJECT_SSO_SIGN_IN_REFUSED_ERROR,
        errorDescription: isCheckEmail
          ? PROJECT_SSO_CONFIRMATION_REQUIRED_MESSAGE
          : PROJECT_SSO_SIGN_IN_REFUSED_MESSAGE,
      })
    ) {
      return;
    }

    return Response.render(data.req, data.res, MESSAGE_VIEW, {
      title: isCheckEmail
        ? PROJECT_SSO_CONFIRMATION_REQUIRED_TITLE
        : PROJECT_SSO_SIGN_IN_REFUSED_TITLE,
      message: isCheckEmail
        ? PROJECT_SSO_CONFIRMATION_REQUIRED_MESSAGE
        : PROJECT_SSO_SIGN_IN_REFUSED_MESSAGE,
    });
  }

  // What a refused account's own audit logs record (FailedSignInAuditLog).
  public static getFailureReason(
    reason: ProjectSsoGateReason | null,
  ): SignInFailureReason | null {
    switch (reason) {
      case ProjectSsoGateReason.Blocked:
        return SignInFailureReason.AccountBlocked;
      case ProjectSsoGateReason.Administrator:
        return SignInFailureReason.SingleSignOnRefused;
      default:
        return null;
    }
  }

  private static async decideOnHostedService(data: {
    user: User | null;
    email: Email;
    name: Name | null;
    projectId: ObjectID;
    kind: ProjectSsoKind;
    providerId: ObjectID;
    origin?: RequestOrigin | undefined;
  }): Promise<ProjectSsoGateDecision> {
    const user: User | null = data.user;

    /*
     * Asked of every address: its account's consent, or a stand-in's when
     * it has none, so no sign-in answers sooner for the account behind it.
     */
    const hasConsent: boolean = await UserProjectSsoConsentService.hasConsent({
      userId: user?.id || NO_ACCOUNT_CONSENT_STAND_IN,
      projectId: data.projectId,
    });

    let reason: ProjectSsoGateReason | null = null;

    if (!user || !user.id) {
      reason = ProjectSsoGateReason.NoAccount;
    } else if (user.isBlocked) {
      reason = ProjectSsoGateReason.Blocked;
    } else if (
      ProjectSsoSignInConfirmation.mustNotSignInThroughProjectProvider(user)
    ) {
      reason = ProjectSsoGateReason.Administrator;
    } else if (!user.isEmailVerified || !hasConsent) {
      reason = ProjectSsoGateReason.NotConfirmed;
    }

    if (!reason) {
      return {
        outcome: ProjectSsoGateOutcome.SignIn,
        user: user,
        isNewUser: false,
        reason: null,
      };
    }

    /*
     * Mailed in the background, never waited for: whether an email goes
     * out, and how long it takes, must not show in the answer.
     */
    if (reason === ProjectSsoGateReason.NoAccount) {
      ProjectSsoSignInGate.inBackground(
        ProjectSsoSignInConfirmation.requestConfirmationForNewAccount({
          email: data.email,
          name: data.name?.toString() || null,
          projectId: data.projectId,
          kind: data.kind,
          providerId: data.providerId,
          origin: data.origin,
        }),
      );
    } else if (reason === ProjectSsoGateReason.NotConfirmed) {
      ProjectSsoSignInGate.inBackground(
        ProjectSsoSignInConfirmation.requestConfirmation({
          user: user!,
          projectId: data.projectId,
          kind: data.kind,
          providerId: data.providerId,
          origin: data.origin,
        }),
      );
    }

    return {
      outcome: ProjectSsoGateOutcome.CheckEmail,
      user: user,
      isNewUser: false,
      reason: reason,
    };
  }

  private static async decideOnSelfHostedServer(data: {
    user: User | null;
    email: Email;
    name: Name | null;
  }): Promise<ProjectSsoGateDecision> {
    const user: User | null = data.user;

    if (user?.isBlocked) {
      return {
        outcome: ProjectSsoGateOutcome.Refused,
        user: user,
        isNewUser: false,
        reason: ProjectSsoGateReason.Blocked,
      };
    }

    if (
      user &&
      ProjectSsoSignInConfirmation.mustNotSignInThroughProjectProvider(user)
    ) {
      return {
        outcome: ProjectSsoGateOutcome.Refused,
        user: user,
        isNewUser: false,
        reason: ProjectSsoGateReason.Administrator,
      };
    }

    if (user) {
      return {
        outcome: ProjectSsoGateOutcome.SignIn,
        user: user,
        isNewUser: false,
        reason: null,
      };
    }

    // The provider vouches for the address, as it always has here.
    const created: User = await UserService.createByEmail({
      email: data.email,
      name: data.name || undefined,
      isEmailVerified: true,
      generateRandomPassword: true,
      props: {
        isRoot: true,
      },
    });

    return {
      outcome: ProjectSsoGateOutcome.SignIn,
      user: created,
      isNewUser: true,
      reason: null,
    };
  }
}
