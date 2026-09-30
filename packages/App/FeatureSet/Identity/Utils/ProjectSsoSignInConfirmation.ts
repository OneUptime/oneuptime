import crypto from "crypto";
import Hostname from "Common/Types/API/Hostname";
import Protocol from "Common/Types/API/Protocol";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import OneUptimeDate from "Common/Types/Date";
import Email from "Common/Types/Email";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import ObjectID from "Common/Types/ObjectID";
import PositiveNumber from "Common/Types/PositiveNumber";
import DatabaseConfig from "Common/Server/DatabaseConfig";
import {
  EncryptionSecret,
  IsBillingEnabled,
} from "Common/Server/EnvironmentConfig";
import AccessTokenService from "Common/Server/Services/AccessTokenService";
import EmailVerificationTokenService from "Common/Server/Services/EmailVerificationTokenService";
import MailService from "Common/Server/Services/MailService";
import ProjectOidcService from "Common/Server/Services/ProjectOidcService";
import ProjectService from "Common/Server/Services/ProjectService";
import ProjectSSOService from "Common/Server/Services/ProjectSsoService";
import TeamMemberService from "Common/Server/Services/TeamMemberService";
import UserProjectSsoConsentService from "Common/Server/Services/UserProjectSsoConsentService";
import UserService from "Common/Server/Services/UserService";
import logger from "Common/Server/Utils/Logger";
import EmailVerificationToken from "Common/Models/DatabaseModels/EmailVerificationToken";
import Project from "Common/Models/DatabaseModels/Project";
import ProjectOIDC from "Common/Models/DatabaseModels/ProjectOidc";
import ProjectSSO from "Common/Models/DatabaseModels/ProjectSso";
import Team from "Common/Models/DatabaseModels/Team";
import TeamMember from "Common/Models/DatabaseModels/TeamMember";
import User from "Common/Models/DatabaseModels/User";

/*
 * ---------------------------------------------------------------------------
 * A PROJECT'S SINGLE SIGN-ON MAY SIGN SOMEBODY IN ONLY AFTER THEY SAY SO.
 *
 * A project's SAML and OIDC providers are configured by that project's admins.
 * The email address an assertion carries is therefore that customer's claim,
 * and on a multi-tenant instance a customer's claim cannot be what hands out a
 * session: an admin who runs their own identity provider could assert any
 * address at all and be signed in as the matching OneUptime account --
 * including every other project that account belongs to, since a user session
 * is not scoped to the project whose SSO minted it. The same trust gap marked
 * every account an IdP provisioned "email verified" on the IdP's say-so.
 *
 * On the hosted service (billing on), the first project-SSO sign-in to an
 * account therefore stops before any session exists and emails the account's
 * own address instead. The link in that email, and only that link, records the
 * owner's consent (UserProjectSsoConsent). After that, sign-ins through the
 * project's SSO go straight through, exactly as before. The same click proves
 * the mailbox, so it also verifies the address of an account the IdP has just
 * provisioned -- which is what "email verification for SSO signups" means
 * here.
 *
 * Self-hosted installs are unchanged. Their project admins are usually one
 * organisation, and many have no working SMTP to confirm anything with.
 *
 * Global SSO and Global OIDC are unaffected everywhere: the instance operator
 * configures those providers, so their assertions are trusted as before.
 * ---------------------------------------------------------------------------
 */

export enum ProjectSsoKind {
  SAML = "saml",
  OIDC = "oidc",
}

export enum ProjectSsoConfirmationOutcome {
  Confirmed = "confirmed",
  // Tampered, unknown, already used, or minted for a different address.
  InvalidLink = "invalid-link",
  ExpiredLink = "expired-link",
  AccountBlocked = "account-blocked",
  ProviderUnavailable = "provider-unavailable",
  NoDefaultTeams = "no-default-teams",
}

export interface ProjectSsoConfirmationResult {
  outcome: ProjectSsoConfirmationOutcome;
}

interface ProjectSsoProvider {
  teams: Array<Team>;
}

export const PROJECT_SSO_CONFIRMATION_EXPIRY_HOURS: number = 24;

// What a sign-in that is waiting on its confirmation email tells the person.
export const PROJECT_SSO_CONFIRMATION_REQUIRED_MESSAGE: string =
  "To finish signing in with single sign-on, open the link we have just emailed you. You only need to do this once for this project. Please do not forget to check spam.";

// The same, as the reason code on the mobile app's deep link.
export const PROJECT_SSO_CONFIRMATION_REQUIRED_ERROR: string =
  "sso_confirmation_required";

/*
 * One email per account, per project, per window, per node. The SSO callback
 * is reachable by anyone who can complete a round trip through the project's
 * identity provider -- including the admin of a hostile one -- so without
 * this a script could fill a stranger's inbox. A second attempt inside the
 * window gets the same "check your email" page; the first link still works.
 */
export const PROJECT_SSO_CONFIRMATION_EMAIL_THROTTLE_MS: number = 5 * 60 * 1000;

const lastConfirmationEmailSentAt: Map<string, number> = new Map<
  string,
  number
>();

const SIGNATURE_PURPOSE: string = "project-sso-sign-in-confirmation";

export default class ProjectSsoSignInConfirmation {
  /*
   * Whether project-SSO sign-ins have to be confirmed from the mailbox at
   * all: on the hosted service only. Read on every call, never cached, so the
   * deployment shape is whatever EnvironmentConfig says at the time.
   */
  public static isRequired(): boolean {
    return IsBillingEnabled;
  }

  /*
   * May this project's SSO sign this account in without asking first?
   *
   * Both halves are needed. Consent is what an admin cannot forge; a verified
   * address is what the rest of the product assumes of a signed-in user, and
   * an account's address can become unverified after consent was given (by
   * changing it).
   */
  public static async isSignInConfirmed(data: {
    user: User;
    projectId: ObjectID;
  }): Promise<boolean> {
    if (!data.user.id || !data.user.isEmailVerified) {
      return false;
    }

    return await UserProjectSsoConsentService.hasConsent({
      userId: data.user.id,
      projectId: data.projectId,
    });
  }

  public static isProjectSsoKind(value: unknown): value is ProjectSsoKind {
    return value === ProjectSsoKind.SAML || value === ProjectSsoKind.OIDC;
  }

  /*
   * Binds a confirmation token to the one project and provider it was minted
   * for, and to this purpose. The token row itself only says "whoever holds
   * this controls that mailbox" -- the shape every EmailVerificationToken
   * shares -- so without this a welcome-email link could be replayed here
   * with any project in the path, and an SSO link's project could be swapped.
   */
  public static getSignature(data: {
    token: string;
    kind: ProjectSsoKind;
    projectId: string;
    providerId: string;
  }): string {
    return crypto
      .createHmac("sha256", EncryptionSecret.toString())
      .update(
        [
          SIGNATURE_PURPOSE,
          data.token,
          data.kind,
          data.projectId,
          data.providerId,
        ].join(":"),
      )
      .digest("hex");
  }

  public static isSignatureValid(data: {
    token: string;
    signature: string;
    kind: ProjectSsoKind;
    projectId: string;
    providerId: string;
  }): boolean {
    const expected: Buffer = Buffer.from(
      this.getSignature({
        token: data.token,
        kind: data.kind,
        projectId: data.projectId,
        providerId: data.providerId,
      }),
      "utf8",
    );
    const supplied: Buffer = Buffer.from(data.signature || "", "utf8");

    return (
      expected.length === supplied.length &&
      crypto.timingSafeEqual(expected, supplied)
    );
  }

  /*
   * Where the confirmation link points. Path parameters rather than query
   * parameters for everything but the two secrets, so the page can be served
   * by one route per method.
   */
  public static getConfirmationRoute(data: {
    kind: ProjectSsoKind;
    projectId: string;
    providerId: string;
  }): Route {
    return new Route("/identity/sso-sign-in-confirmation").addRoute(
      `/${data.kind}/${data.projectId}/${data.providerId}`,
    );
  }

  /*
   * The SP-initiated start of this provider's sign-in, which is where the
   * user is sent once they have confirmed. A relative route: it is only ever
   * rendered on a page this instance serves.
   */
  public static getSignInStartRoute(data: {
    kind: ProjectSsoKind;
    projectId: string;
    providerId: string;
  }): Route {
    return new Route(
      data.kind === ProjectSsoKind.SAML ? "/identity/sso" : "/identity/oidc",
    ).addRoute(`/${data.projectId}/${data.providerId}`);
  }

  public static async getProjectName(projectId: ObjectID): Promise<string> {
    const project: Project | null = await ProjectService.findOneById({
      id: projectId,
      select: {
        name: true,
      },
      props: {
        isRoot: true,
      },
    });

    return project?.name?.toString() || "your organization";
  }

  /*
   * Mails the account's own address a link that confirms this project's SSO.
   * Never throws: the caller answers "check your email" either way, and a
   * mail server that is down must not turn a sign-in page into a 500.
   */
  public static async requestConfirmation(data: {
    user: User;
    projectId: ObjectID;
    kind: ProjectSsoKind;
    providerId: ObjectID;
  }): Promise<void> {
    try {
      if (!data.user.id || !data.user.email) {
        return;
      }

      const throttleKey: string = `${data.user.id.toString()}:${data.projectId.toString()}`;
      const now: number = Date.now();

      for (const [key, sentAt] of lastConfirmationEmailSentAt) {
        if (now - sentAt >= PROJECT_SSO_CONFIRMATION_EMAIL_THROTTLE_MS) {
          lastConfirmationEmailSentAt.delete(key);
        }
      }

      if (lastConfirmationEmailSentAt.has(throttleKey)) {
        return;
      }

      lastConfirmationEmailSentAt.set(throttleKey, now);

      const token: ObjectID = ObjectID.generate();

      const emailVerificationToken: EmailVerificationToken =
        new EmailVerificationToken();
      emailVerificationToken.userId = data.user.id;
      emailVerificationToken.email = data.user.email;
      emailVerificationToken.token = token;
      emailVerificationToken.expires = OneUptimeDate.getSomeHoursAfter(
        PROJECT_SSO_CONFIRMATION_EXPIRY_HOURS,
      );

      await EmailVerificationTokenService.create({
        data: emailVerificationToken,
        props: {
          isRoot: true,
        },
      });

      const host: Hostname = await DatabaseConfig.getHost();
      const httpProtocol: Protocol = await DatabaseConfig.getHttpProtocol();

      const confirmationUrl: URL = new URL(
        httpProtocol,
        host,
        this.getConfirmationRoute({
          kind: data.kind,
          projectId: data.projectId.toString(),
          providerId: data.providerId.toString(),
        }),
      )
        .addQueryParam("token", token.toString())
        .addQueryParam(
          "signature",
          this.getSignature({
            token: token.toString(),
            kind: data.kind,
            projectId: data.projectId.toString(),
            providerId: data.providerId.toString(),
          }),
        );

      const projectName: string = await this.getProjectName(data.projectId);

      await MailService.sendMail({
        toEmail: data.user.email as Email,
        subject: "Confirm single sign-on for your OneUptime account",
        isSubjectLiteral: true,
        templateType: EmailTemplateType.ConfirmProjectSsoSignIn,
        vars: {
          /*
           * The project name is chosen by that project's admins, so it goes
           * into the email as text, never as HTML: the template prints this
           * sentence through InfoBlock's escaped `plainInfo`.
           */
          signInSummary: `Someone just signed in through the single sign-on of the OneUptime project "${projectName}" as ${data.user.email.toString()}. Before that sign-in can reach your OneUptime account, we need to know it was you.`,
          confirmationUrl: confirmationUrl.toString(),
          expiryNote: `This link expires in ${PROJECT_SSO_CONFIRMATION_EXPIRY_HOURS} hours and can only be used once.`,
          homeUrl: new URL(httpProtocol, host).toString(),
        },
      });
    } catch (err) {
      logger.error(err as Error, {
        userId: data.user.id?.toString(),
        projectId: data.projectId.toString(),
        service: "identity",
      });
    }
  }

  private static async findProvider(data: {
    kind: ProjectSsoKind;
    projectId: ObjectID;
    providerId: ObjectID;
  }): Promise<ProjectSsoProvider | null> {
    if (data.kind === ProjectSsoKind.SAML) {
      const provider: ProjectSSO | null = await ProjectSSOService.findOneBy({
        query: {
          projectId: data.projectId,
          _id: data.providerId.toString(),
          isEnabled: true,
        },
        select: {
          _id: true,
          teams: {
            _id: true,
          },
        },
        props: {
          isRoot: true,
        },
      });

      return provider ? { teams: provider.teams || [] } : null;
    }

    const provider: ProjectOIDC | null = await ProjectOidcService.findOneBy({
      query: {
        projectId: data.projectId,
        _id: data.providerId.toString(),
        isEnabled: true,
      },
      select: {
        _id: true,
        teams: {
          _id: true,
        },
      },
      props: {
        isRoot: true,
      },
    });

    return provider ? { teams: provider.teams || [] } : null;
  }

  /*
   * Spends a confirmation link. Everything that can refuse is read first; the
   * token is deleted before anything is written, and only the request whose
   * delete removed the row goes on to write, so two clicks racing on one link
   * cannot both act.
   */
  public static async confirm(data: {
    token: string;
    signature: string;
    kind: string;
    projectId: string;
    providerId: string;
  }): Promise<ProjectSsoConfirmationResult> {
    const invalid: ProjectSsoConfirmationResult = {
      outcome: ProjectSsoConfirmationOutcome.InvalidLink,
    };

    if (
      !this.isProjectSsoKind(data.kind) ||
      !ObjectID.isValidUUID(data.token || "") ||
      !ObjectID.isValidUUID(data.projectId || "") ||
      !ObjectID.isValidUUID(data.providerId || "")
    ) {
      return invalid;
    }

    const kind: ProjectSsoKind = data.kind;

    if (
      !this.isSignatureValid({
        token: data.token,
        signature: data.signature,
        kind,
        projectId: data.projectId,
        providerId: data.providerId,
      })
    ) {
      return invalid;
    }

    const projectId: ObjectID = new ObjectID(data.projectId);
    const providerId: ObjectID = new ObjectID(data.providerId);

    const savedToken: EmailVerificationToken | null =
      await EmailVerificationTokenService.findOneBy({
        query: {
          token: new ObjectID(data.token),
        },
        select: {
          _id: true,
          userId: true,
          email: true,
          expires: true,
        },
        props: {
          isRoot: true,
        },
      });

    if (
      !savedToken ||
      !savedToken._id ||
      !savedToken.userId ||
      !savedToken.email ||
      !savedToken.expires
    ) {
      return invalid;
    }

    if (OneUptimeDate.hasExpired(savedToken.expires)) {
      return { outcome: ProjectSsoConfirmationOutcome.ExpiredLink };
    }

    const user: User | null = await UserService.findOneById({
      id: savedToken.userId,
      select: {
        _id: true,
        email: true,
        isEmailVerified: true,
        isBlocked: true,
      },
      props: {
        isRoot: true,
      },
    });

    /*
     * The link proves the mailbox it was sent to. If the account has moved to
     * another address since, it proves nothing about the account any more.
     */
    if (
      !user ||
      !user.id ||
      !user.email ||
      user.email.toString() !== savedToken.email.toString()
    ) {
      return invalid;
    }

    if (user.isBlocked) {
      return { outcome: ProjectSsoConfirmationOutcome.AccountBlocked };
    }

    // The provider may have been disabled or deleted since the email went out.
    const provider: ProjectSsoProvider | null = await this.findProvider({
      kind,
      projectId,
      providerId,
    });

    if (!provider) {
      return { outcome: ProjectSsoConfirmationOutcome.ProviderUnavailable };
    }

    const membershipCount: PositiveNumber = await TeamMemberService.countBy({
      query: {
        projectId: projectId,
        userId: user.id,
      },
      props: {
        isRoot: true,
      },
    });

    const isAlreadyMember: boolean = membershipCount.toNumber() > 0;

    if (!isAlreadyMember && provider.teams.length === 0) {
      return { outcome: ProjectSsoConfirmationOutcome.NoDefaultTeams };
    }

    const deletedCount: number =
      await EmailVerificationTokenService.deleteOneBy({
        query: {
          _id: savedToken._id,
        },
        props: {
          isRoot: true,
        },
      });

    if (deletedCount !== 1) {
      return invalid;
    }

    if (isAlreadyMember) {
      /*
       * An invitation into this project that was still pending: confirming
       * this project's sign-in is the person agreeing to join it.
       */
      await TeamMemberService.updateBy({
        query: {
          projectId: projectId,
          userId: user.id,
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
    } else {
      // The provider's default teams, exactly as its callback would add them.
      for (const team of provider.teams) {
        const teamMember: TeamMember = new TeamMember();
        teamMember.projectId = projectId;
        teamMember.userId = user.id;
        teamMember.hasAcceptedInvitation = true;
        teamMember.invitationAcceptedAt = OneUptimeDate.getCurrentDate();
        teamMember.teamId = team.id!;

        await TeamMemberService.create({
          data: teamMember,
          props: {
            isRoot: true,
            ignoreHooks: true,
          },
        });
      }
    }

    /*
     * After the memberships, so UserService's verification hook finds them
     * accepted and gives them their default notification rules.
     */
    if (!user.isEmailVerified) {
      await UserService.updateOneById({
        id: user.id,
        data: {
          isEmailVerified: true,
        },
        props: {
          isRoot: true,
        },
      });
    }

    await UserProjectSsoConsentService.recordConsent({
      userId: user.id,
      projectId: projectId,
    });

    await AccessTokenService.refreshUserAllPermissions(user.id);

    logger.info("Project SSO sign-in confirmed from the mailbox", {
      userId: user.id.toString(),
      projectId: projectId.toString(),
      service: "identity",
    });

    return { outcome: ProjectSsoConfirmationOutcome.Confirmed };
  }

  // Test-only: forget which confirmation emails were recently sent.
  public static resetThrottleForTests(): void {
    lastConfirmationEmailSentAt.clear();
  }
}
