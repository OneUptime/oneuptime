import crypto from "crypto";
import Hostname from "Common/Types/API/Hostname";
import Protocol from "Common/Types/API/Protocol";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import OneUptimeDate from "Common/Types/Date";
import Email from "Common/Types/Email";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import { JSONObject } from "Common/Types/JSON";
import Name from "Common/Types/Name";
import ObjectID from "Common/Types/ObjectID";
import PositiveNumber from "Common/Types/PositiveNumber";
import DatabaseConfig from "Common/Server/DatabaseConfig";
import { IsBillingEnabled } from "Common/Server/EnvironmentConfig";
import AccessTokenService from "Common/Server/Services/AccessTokenService";
import EmailVerificationTokenService from "Common/Server/Services/EmailVerificationTokenService";
import MailService from "Common/Server/Services/MailService";
import ProductBrandingText from "Common/Server/Utils/ProductBrandingText";
import RequestOriginUtil from "Common/Server/Utils/RequestOrigin/RequestOriginUtil";
import RequestOrigin from "Common/Types/RequestOrigin";
import ProjectOidcService from "Common/Server/Services/ProjectOidcService";
import ProjectService from "Common/Server/Services/ProjectService";
import ProjectSSOService from "Common/Server/Services/ProjectSsoService";
import TeamMemberService from "Common/Server/Services/TeamMemberService";
import UserProjectSsoConsentService from "Common/Server/Services/UserProjectSsoConsentService";
import UserService from "Common/Server/Services/UserService";
import logger from "Common/Server/Utils/Logger";
import JSONWebToken from "Common/Server/Utils/JsonWebToken";
import TokenSigningKey from "Common/Server/Utils/TokenSigningKey";
import SsoTeamMembership, {
  SsoTeamMembershipOutcome,
} from "./SsoTeamMembership";
import EmailVerificationToken from "Common/Models/DatabaseModels/EmailVerificationToken";
import Project from "Common/Models/DatabaseModels/Project";
import ProjectOIDC from "Common/Models/DatabaseModels/ProjectOidc";
import ProjectSSO from "Common/Models/DatabaseModels/ProjectSso";
import Team from "Common/Models/DatabaseModels/Team";
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
 * the mailbox, so it also verifies the account's address -- which is what
 * "email verification for SSO signups" means here. An address no account
 * uses yet gets nothing made for it: its link carries the sign-in, and
 * confirming it makes the account (requestConfirmationForNewAccount, #9824).
 * Every sign-in that stops answers alike, whatever stopped it
 * (ProjectSsoSignInGate).
 *
 * Self-hosted installs are unchanged. Their project admins are usually one
 * organisation, and many have no working SMTP to confirm anything with.
 *
 * Global SSO and Global OIDC are unaffected everywhere: the instance operator
 * configures those providers, so their assertions are trusted as before.
 *
 * ---------------------------------------------------------------------------
 * A PROJECT'S SINGLE SIGN-ON NEVER SIGNS IN A ONEUPTIME ADMINISTRATOR.
 *
 * A separate, stronger rule that holds on EVERY edition, hosted or not, and
 * does not depend on the mailbox consent above. The master-admin capability
 * is instance-wide: the access token's `isMasterAdmin` claim is what the
 * master-admin middleware trusts for the whole instance. A project's SAML and
 * OIDC providers are configured by that project's admins and can assert any
 * address, so letting one authenticate an administrator account would let a
 * tenant mint an administrator session and take the instance over -- exactly
 * the escalation the mailbox gate does NOT close on a self-hosted install, or
 * on the hosted service once an administrator has confirmed a project once.
 *
 * So a project provider refuses an administrator account outright: no session,
 * no provisioning, and no confirmation email. Administrators sign in with a
 * first-party credential instead -- email and password, a passkey, or an
 * instance-wide Global SSO/OIDC provider the operator themselves configured.
 * This is never reached by an account a project provider has just created,
 * because new accounts are never administrators.
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
  // The project has no room for one more person (SsoTeamMembership).
  NoRoom = "no-room",
}

export interface ProjectSsoConfirmationResult {
  outcome: ProjectSsoConfirmationOutcome;
}

interface ProjectSsoProvider {
  teams: Array<Team>;
}

export const PROJECT_SSO_CONFIRMATION_EXPIRY_HOURS: number = 24;

/*
 * What every sign-in a project's single sign-on may not finish yet tells the
 * person, on the hosted service: one page, in the same time, whether the
 * address has an account that waits on its confirmation, has none yet, is
 * blocked, or is an administrator's (#9824, ProjectSsoSignInGate). True of
 * each: a link went to the address only where it can do something.
 */
export const PROJECT_SSO_CONFIRMATION_REQUIRED_MESSAGE: string =
  "If this address can sign in through this project's single sign-on, we have emailed it a link to finish signing in. You only need to do this once for this project. Please do not forget to check spam.";

export const PROJECT_SSO_CONFIRMATION_REQUIRED_TITLE: string =
  "Check your email.";

/*
 * What a sign-in a project's single sign-on may never finish tells the
 * person on a self-hosted server: one page for a blocked account and an
 * administrator's alike (#9824). Why is logged on the server, and recorded
 * in the person's own projects' audit logs.
 */
export const PROJECT_SSO_SIGN_IN_REFUSED_TITLE: string =
  "We could not sign you in with single sign-on.";

export const PROJECT_SSO_SIGN_IN_REFUSED_MESSAGE: string =
  "Sign in to OneUptime another way, or ask your OneUptime administrator for help.";

// The same, as the reason code on the mobile app's deep link.
export const PROJECT_SSO_SIGN_IN_REFUSED_ERROR: string = "sso_sign_in_refused";

// What a confirmation link for an account still to be made is signed for.
export const PROJECT_SSO_NEW_ACCOUNT_PURPOSE: string =
  "project-sso-new-account-confirmation";

// The query parameter that carries it.
export const PROJECT_SSO_NEW_ACCOUNT_PARAMETER: string = "account";

// What a confirmation link for an account still to be made carries.
export interface ProjectSsoNewAccountClaims {
  email: Email;
  name: string | null;
  kind: ProjectSsoKind;
  projectId: ObjectID;
  providerId: ObjectID;
}

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

  /*
   * Whether a project's own SAML or OIDC provider is forbidden from
   * authenticating this account at all (see the second doctrine block above).
   * True for a OneUptime administrator: a project provider must never confer
   * the instance-wide master-admin capability. Holds on every edition, and is
   * checked before anything is emailed, provisioned, or signed. Reads only the
   * account's own `isMasterAdmin`, so a project provider that asserts the
   * address of a non-administrator is unaffected.
   */
  public static mustNotSignInThroughProjectProvider(user: {
    isMasterAdmin?: boolean | undefined;
  }): boolean {
    return user.isMasterAdmin === true;
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
      .createHmac("sha256", TokenSigningKey.get())
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
    // The sign-in's request: the browser the identity provider sent back.
    origin?: RequestOrigin | undefined;
  }): Promise<void> {
    try {
      if (!data.user.id || !data.user.email) {
        return;
      }

      const throttleKey: string = `${data.user.id.toString()}:${data.projectId.toString()}`;

      if (!this.takeEmailSlot(throttleKey)) {
        return;
      }

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
        subject: `Confirm single sign-on for your ${ProductBrandingText.getProductName()} account`,
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
          /*
           * When, from where and on which device the sign-in came: the
           * recipient may never have tried to sign in at all.
           */
          ...RequestOriginUtil.getEmailVars({
            origin: data.origin,
            timezone: data.user.timezone,
          }),
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
        isMasterAdmin: true,
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

    /*
     * A project provider never signs an administrator in, so its mailbox is
     * never sent a confirmation link in the first place. Should a stale link
     * reach here -- an account made an administrator after a link went out --
     * spending it confers nothing: no consent, no membership, no verification.
     */
    if (this.mustNotSignInThroughProjectProvider(user)) {
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

    return await this.joinAndRecordConsent({
      user: user,
      projectId: projectId,
      provider: provider,
      isAlreadyMember: isAlreadyMember,
    });
  }

  /*
   * What a confirmed link writes, once everything that can refuse has been
   * read: the person joins the project - a pending invitation into it is
   * accepted, else the provider's default teams take them - their address
   * is verified, and their consent to this project's sign-in is recorded.
   */
  private static async joinAndRecordConsent(data: {
    user: User;
    projectId: ObjectID;
    provider: ProjectSsoProvider;
    isAlreadyMember: boolean;
  }): Promise<ProjectSsoConfirmationResult> {
    const user: User = data.user;
    const userId: ObjectID = user.id!;

    if (data.isAlreadyMember) {
      /*
       * An invitation into this project that was still pending: confirming
       * this project's sign-in is the person agreeing to join it.
       */
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
    } else {
      /*
       * The provider's default teams, exactly as its callback would add
       * them: a seat like anyone invited. A project with no room for one
       * more person adds them nowhere, and nothing more is written - no
       * consent, so their next sign-in asks again.
       */
      const added: SsoTeamMembershipOutcome =
        await SsoTeamMembership.addToTeams({
          projectId: data.projectId,
          userId: userId,
          teams: data.provider.teams,
        });

      if (added === SsoTeamMembershipOutcome.NoRoom) {
        return { outcome: ProjectSsoConfirmationOutcome.NoRoom };
      }
    }

    /*
     * After the memberships, so UserService's verification hook finds them
     * accepted and gives them their default notification rules.
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

    await UserProjectSsoConsentService.recordConsent({
      userId: userId,
      projectId: data.projectId,
    });

    await AccessTokenService.refreshUserAllPermissions(userId);

    logger.info("Project SSO sign-in confirmed from the mailbox", {
      userId: userId.toString(),
      projectId: data.projectId.toString(),
      service: "identity",
    });

    return { outcome: ProjectSsoConfirmationOutcome.Confirmed };
  }

  /*
   * ---------------------------------------------------------------------
   * AN ADDRESS NO ACCOUNT USES YET (#9824).
   *
   * A sign-in through a project's provider for an address with no account
   * used to make the account at once - a scrypt hash that took a sign-in
   * for such an address longer than any other, and an account left behind
   * for every address a hostile provider asserted - and only then asked its
   * mailbox. Now nothing is made: the address is sent a link that carries
   * the sign-in (whose address, the name the provider sent, which project
   * and provider), signed by the server so nobody else can make one, and
   * valid for a day. Confirming from the mailbox makes the account, joins
   * it to the project and records its consent, as confirming an existing
   * account's sign-in does. A second click, or one after an account has
   * appeared at the address meanwhile, confirms that account: the link
   * proves the mailbox either way.
   * ---------------------------------------------------------------------
   */
  public static getNewAccountToken(claims: ProjectSsoNewAccountClaims): string {
    return JSONWebToken.signJsonPayload(
      {
        purpose: PROJECT_SSO_NEW_ACCOUNT_PURPOSE,
        email: claims.email.toString(),
        name: claims.name || "",
        kind: claims.kind,
        projectId: claims.projectId.toString(),
        providerId: claims.providerId.toString(),
      },
      PROJECT_SSO_CONFIRMATION_EXPIRY_HOURS * 60 * 60,
    );
  }

  /*
   * The sign-in a new-account link carries, when it was made by this server
   * for the provider and project its path names; null for anything else.
   * An expired link is read with `isExpired` set, so the page can say so.
   *
   * Read as raw claims (JSONWebToken.decodeJsonPayload), not as a person's
   * token (JSONWebToken.decode): the link is no one's identity. It names no
   * account and no session, says a purpose of its own that no person's token
   * says (PROJECT_SSO_NEW_ACCOUNT_PURPOSE, never a JsonWebTokenPurpose), and
   * confirming it signs nobody in - it hands the person back to the
   * provider's own sign-in. So no reader of a person's token takes it, and it
   * takes none of theirs: each claim below is checked against the path, the
   * purpose first. TokenPurposeGuard lists this file with that reason, and
   * ProjectSsoNewAccountLinkIsItsOwnKind proves both directions with real
   * signatures.
   */
  public static readNewAccountToken(data: {
    account: string;
    kind: string;
    projectId: string;
    providerId: string;
  }): (ProjectSsoNewAccountClaims & { isExpired: boolean }) | null {
    if (
      !data.account ||
      !this.isProjectSsoKind(data.kind) ||
      !ObjectID.isValidUUID(data.projectId || "") ||
      !ObjectID.isValidUUID(data.providerId || "")
    ) {
      return null;
    }

    let claims: JSONObject;
    let isExpired: boolean = false;

    try {
      claims = JSONWebToken.decodeJsonPayload(data.account);
    } catch {
      try {
        claims = JSONWebToken.decodeJsonPayload(data.account, {
          acceptExpired: true,
        });
        isExpired = true;
      } catch {
        return null;
      }
    }

    const email: unknown = claims["email"];
    const sameId: (claimed: unknown, inPath: string) => boolean = (
      claimed: unknown,
      inPath: string,
    ): boolean => {
      return (
        typeof claimed === "string" &&
        claimed.toLowerCase() === inPath.toLowerCase()
      );
    };

    if (
      claims["purpose"] !== PROJECT_SSO_NEW_ACCOUNT_PURPOSE ||
      claims["kind"] !== data.kind ||
      !sameId(claims["projectId"], data.projectId) ||
      !sameId(claims["providerId"], data.providerId) ||
      typeof email !== "string" ||
      !Email.isValid(email)
    ) {
      return null;
    }

    const name: unknown = claims["name"];

    return {
      email: new Email(email),
      name: typeof name === "string" && name.trim() ? name.trim() : null,
      kind: data.kind as ProjectSsoKind,
      projectId: new ObjectID(data.projectId),
      providerId: new ObjectID(data.providerId),
      isExpired: isExpired,
    };
  }

  /*
   * Mails an address no account uses yet the link that, once its owner
   * confirms, makes the account and lets this project's sign-in through.
   * Never throws, and is never waited for by a sign-in: what it takes must
   * not say whether the address has an account.
   */
  public static async requestConfirmationForNewAccount(data: {
    email: Email;
    name: string | null;
    projectId: ObjectID;
    kind: ProjectSsoKind;
    providerId: ObjectID;
    origin?: RequestOrigin | undefined;
  }): Promise<void> {
    try {
      const throttleKey: string = `new:${data.email.toString().toLowerCase()}:${data.projectId.toString()}`;

      if (!this.takeEmailSlot(throttleKey)) {
        return;
      }

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
      ).addQueryParam(
        PROJECT_SSO_NEW_ACCOUNT_PARAMETER,
        this.getNewAccountToken({
          email: data.email,
          name: data.name,
          kind: data.kind,
          projectId: data.projectId,
          providerId: data.providerId,
        }),
      );

      const projectName: string = await this.getProjectName(data.projectId);

      await MailService.sendMail({
        toEmail: data.email,
        subject: `Confirm single sign-on for your ${ProductBrandingText.getProductName()} account`,
        isSubjectLiteral: true,
        templateType: EmailTemplateType.ConfirmProjectSsoSignIn,
        vars: {
          // Escaped text, never HTML: the project's name is its admins'.
          signInSummary: `Someone just signed in through the single sign-on of the OneUptime project "${projectName}" as ${data.email.toString()}. No ${ProductBrandingText.getProductName()} account uses this address yet: if it was you, confirm, and one is set up for you and signed in through it.`,
          confirmationUrl: confirmationUrl.toString(),
          expiryNote: `This link expires in ${PROJECT_SSO_CONFIRMATION_EXPIRY_HOURS} hours.`,
          homeUrl: new URL(httpProtocol, host).toString(),
          ...RequestOriginUtil.getEmailVars({
            origin: data.origin,
            timezone: undefined,
          }),
        },
      });
    } catch (err) {
      logger.error(err as Error, {
        projectId: data.projectId.toString(),
        service: "identity",
      });
    }
  }

  /*
   * Spends a new-account link (see above): makes the account the sign-in
   * named, unless one has appeared at its address meanwhile, then writes
   * what confirming any account's sign-in writes. Everything that can
   * refuse is read before anything is made.
   */
  public static async confirmNewAccount(data: {
    account: string;
    kind: string;
    projectId: string;
    providerId: string;
  }): Promise<ProjectSsoConfirmationResult> {
    const invalid: ProjectSsoConfirmationResult = {
      outcome: ProjectSsoConfirmationOutcome.InvalidLink,
    };

    const claims: (ProjectSsoNewAccountClaims & { isExpired: boolean }) | null =
      this.readNewAccountToken(data);

    if (!claims) {
      return invalid;
    }

    if (claims.isExpired) {
      return { outcome: ProjectSsoConfirmationOutcome.ExpiredLink };
    }

    const provider: ProjectSsoProvider | null = await this.findProvider({
      kind: claims.kind,
      projectId: claims.projectId,
      providerId: claims.providerId,
    });

    if (!provider) {
      return { outcome: ProjectSsoConfirmationOutcome.ProviderUnavailable };
    }

    let user: User | null = await this.findAccountAt(claims.email);

    if (user && this.mustNotSignInThroughProjectProvider(user)) {
      return invalid;
    }

    if (user?.isBlocked) {
      return { outcome: ProjectSsoConfirmationOutcome.AccountBlocked };
    }

    const isAlreadyMember: boolean = user?.id
      ? (
          await TeamMemberService.countBy({
            query: {
              projectId: claims.projectId,
              userId: user.id,
            },
            props: {
              isRoot: true,
            },
          })
        ).toNumber() > 0
      : false;

    if (!isAlreadyMember && provider.teams.length === 0) {
      return { outcome: ProjectSsoConfirmationOutcome.NoDefaultTeams };
    }

    if (!user) {
      try {
        user = await UserService.createByEmail({
          email: claims.email,
          name: claims.name ? new Name(claims.name) : undefined,
          // Verified once it has joined (joinAndRecordConsent).
          isEmailVerified: false,
          generateRandomPassword: true,
          props: {
            isRoot: true,
          },
        });
      } catch (err) {
        // A second click made it a moment ago: confirm that one.
        user = await this.findAccountAt(claims.email);

        if (!user) {
          throw err;
        }
      }
    }

    if (!user?.id) {
      return invalid;
    }

    return await this.joinAndRecordConsent({
      user: user,
      projectId: claims.projectId,
      provider: provider,
      isAlreadyMember: isAlreadyMember,
    });
  }

  // The account at an address, as a confirmation reads it.
  private static async findAccountAt(email: Email): Promise<User | null> {
    return await UserService.findOneBy({
      query: {
        email: email,
      },
      select: {
        _id: true,
        email: true,
        isEmailVerified: true,
        isBlocked: true,
        isMasterAdmin: true,
      },
      props: {
        isRoot: true,
      },
    });
  }

  /*
   * Whether a confirmation email may go out under this key now, taking the
   * slot if so: one per key, per window, per node.
   */
  private static takeEmailSlot(throttleKey: string): boolean {
    const now: number = Date.now();

    for (const [key, sentAt] of lastConfirmationEmailSentAt) {
      if (now - sentAt >= PROJECT_SSO_CONFIRMATION_EMAIL_THROTTLE_MS) {
        lastConfirmationEmailSentAt.delete(key);
      }
    }

    if (lastConfirmationEmailSentAt.has(throttleKey)) {
      return false;
    }

    lastConfirmationEmailSentAt.set(throttleKey, now);

    return true;
  }

  // Test-only: forget which confirmation emails were recently sent.
  public static resetThrottleForTests(): void {
    lastConfirmationEmailSentAt.clear();
  }
}
