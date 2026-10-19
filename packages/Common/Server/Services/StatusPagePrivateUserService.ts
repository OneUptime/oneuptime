import crypto from "crypto";
import DatabaseConfig from "../DatabaseConfig";
import { EncryptionSecret } from "../EnvironmentConfig";
import CreateBy from "../Types/Database/CreateBy";
import UpdateBy from "../Types/Database/UpdateBy";
import { OnCreate, OnUpdate } from "../Types/Database/Hooks";
import logger from "../Utils/Logger";
import RelationIdUtil from "../Utils/Database/RelationIdUtil";
import QueryHelper from "../Types/Database/QueryHelper";
import ProjectReferencesService from "./ProjectReferencesService";
import MailService from "./MailService";
import ProjectSMTPConfigService from "./ProjectSmtpConfigService";
import StatusPageService from "./StatusPageService";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import Hostname from "../../Types/API/Hostname";
import Protocol from "../../Types/API/Protocol";
import URL from "../../Types/API/URL";
import OneUptimeDate from "../../Types/Date";
import EmailTemplateType from "../../Types/Email/EmailTemplateType";
import Email from "../../Types/Email";
import HashedString from "../../Types/HashedString";
import ObjectID from "../../Types/ObjectID";
import BadDataException from "../../Types/Exception/BadDataException";
import StatusPage from "../../Models/DatabaseModels/StatusPage";
import Model from "../../Models/DatabaseModels/StatusPagePrivateUser";
import StatusPageEmailLogo, {
  STATUS_PAGE_EMAIL_LOGO_SELECT,
} from "../Utils/StatusPage/StatusPageEmailLogo";
import PublicMessageRateLimit, {
  PublicMessageSendPermit,
  TeamMessageKind,
} from "../Utils/RateLimit/PublicMessageRateLimit";
import Exception from "../../Types/Exception/Exception";
import { StatementContext } from "../Utils/Database/StatementOutcome";

// The status page's two names, ID column first: a write may use either.
const STATUS_PAGE_KEYS: Array<string> = ["statusPageId", "statusPage"];

/*
 * What a private user's create carries from its hooks to the next: the
 * count of the invitation it emails (onCreatePermitted), given back when the
 * create ends before the email is sent (onCreateError).
 */
interface PrivateUserCreateCarryForward {
  invitationPermit: PublicMessageSendPermit | null;
  // Set as onCreateSuccess starts: from then on the email may have gone out.
  isSending: boolean;
}

export class Service extends ProjectReferencesService<Model> {
  public constructor() {
    super(Model);
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    await super.onBeforeCreate(createBy);

    /*
     * The status page under either of its names, kept in the ID column for
     * the check below and for onCreateSuccess, which mails the invitation
     * from the page the saved row names.
     */
    const statusPageId: ObjectID | null = RelationIdUtil.readIntoIdColumn(
      createBy.data as unknown as Record<string, unknown>,
      STATUS_PAGE_KEYS,
      "Status Page",
    );

    // check if this user is already invited.
    if (statusPageId && createBy.data.email) {
      const statusPageUser: Model | null = await this.findOneBy({
        query: {
          email: createBy.data.email,
          statusPageId: statusPageId,
        },
        props: {
          isRoot: true,
        },
        select: {
          _id: true,
        },
      });

      if (statusPageUser) {
        throw new BadDataException(
          "This user is already invited to this status page.",
        );
      }
    }

    const carryForward: PrivateUserCreateCarryForward = {
      invitationPermit: null,
      isSending: false,
    };

    return {
      createBy: createBy,
      carryForward: carryForward,
    };
  }

  /*
   * A private user the team adds - on the dashboard, with an API key, by a
   * workflow or by SCIM - is emailed an invitation to the status page, from
   * this installation's mail server unless the page has its own. On a
   * shared installation any project could otherwise invite one address
   * over and over, so each address is counted
   * (PublicMessageRateLimit.assertTeamMaySend, with the invitations to
   * projects): past its limit the create is refused with 429, before
   * anything is written. The team is never counted, so adding many readers
   * at once goes on. Only an invitation that is sent counts: a user who
   * signs in with SSO, or one of a page that takes only SSO, is sent none
   * (onCreateSuccess).
   */
  @CaptureSpan()
  protected override async onCreatePermitted(
    onCreate: OnCreate<Model>,
  ): Promise<void> {
    await super.onCreatePermitted(onCreate);

    const carryForward: PrivateUserCreateCarryForward | null =
      onCreate.carryForward as PrivateUserCreateCarryForward | null;
    const user: Model = onCreate.createBy.data;

    // The page under either of its names (onBeforeCreate wrote the ID column).
    const statusPageId: ObjectID | null = RelationIdUtil.readConsistent(
      user as unknown as Record<string, unknown>,
      STATUS_PAGE_KEYS,
      "Status Page",
    );

    if (!carryForward || user.isSsoUser || !user.email || !statusPageId) {
      return;
    }

    const statusPage: StatusPage | null = await StatusPageService.findOneById({
      id: statusPageId,
      select: {
        _id: true,
        requireSsoForLogin: true,
      },
      props: {
        isRoot: true,
        ignoreHooks: true,
      },
    });

    if (!statusPage || statusPage.requireSsoForLogin) {
      return;
    }

    carryForward.invitationPermit =
      await PublicMessageRateLimit.assertTeamMaySend({
        kind: TeamMessageKind.Invitation,
        contacts: [PublicMessageRateLimit.forEmail(user.email)],
      });
  }

  /*
   * A create that failed before onCreateSuccess began sent no invitation:
   * the address gets its count back.
   */
  @CaptureSpan()
  protected override async onCreateError(
    error: Exception,
    onCreate?: OnCreate<Model> | undefined,
    failedStatement?: StatementContext | undefined,
  ): Promise<Exception> {
    const carryForward: PrivateUserCreateCarryForward | null | undefined =
      onCreate?.carryForward as
        | PrivateUserCreateCarryForward
        | null
        | undefined;

    if (carryForward?.invitationPermit && !carryForward.isSending) {
      await carryForward.invitationPermit.giveBack();
    }

    return await super.onCreateError(error, onCreate, failedStatement);
  }

  /**
   * Kill any outstanding password-reset link for a status page user whose
   * email address is about to change.
   *
   * Same invariant, and the same reasoning, as
   * `UserService.expirePasswordResetTokensForEmailChange`: the link is a
   * bearer credential addressed to one mailbox, and `/status-page-api/
   * reset-password` finds the row by token hash and status page alone, never
   * by the address the link was mailed to. Left unexpired, a link sent to the
   * old address keeps working against the account at its new one.
   *
   * This path is worth closing even though a status page user cannot edit
   * their own email: project admins can (the column carries `update` for
   * ProjectAdmin and StatusPageAdmin), and `StatusPageSCIM.ts` rewrites it
   * from the directory. "Move this subscriber to their new address" is the
   * same rescue action, done by somebody else on the user's behalf, and it has
   * to invalidate old links for the same reason.
   *
   * Cleared before the write, and only for rows whose address actually
   * changes, so a SCIM push that re-sends an unchanged address does not
   * invalidate a reset link the user is part-way through using.
   */
  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    await super.onBeforeUpdate(updateBy);

    if (updateBy.data.email) {
      const newEmail: string = (updateBy.data.email as Email)
        .toString()
        .toLowerCase();

      const existingUsers: Array<Model> =
        await this.findRowsAndHoldUpdateToThem(updateBy, {
          _id: true,
          email: true,
        });

      for (const user of existingUsers) {
        if (!user.id) {
          continue;
        }

        /*
         * A row with no `email` stored is treated as changed: on a
         * credential the safe assumption is the one that expires the token.
         */
        const currentEmail: string | undefined = user.email
          ?.toString()
          .toLowerCase();

        if (currentEmail === newEmail) {
          continue;
        }

        await this.updateOneById({
          id: user.id,
          data: {
            resetPasswordToken: null!,
            resetPasswordExpires: null!,
          },
          props: {
            isRoot: true,
            ignoreHooks: true,
          },
        });
      }
    }

    return {
      updateBy: updateBy,
      carryForward: null,
    };
  }

  @CaptureSpan()
  protected override async onCreateSuccess(
    onCreate: OnCreate<Model>,
    createdItem: Model,
  ): Promise<Model> {
    // From here on the invitation may have gone out (onCreateError).
    const carryForward: PrivateUserCreateCarryForward | null =
      onCreate.carryForward as PrivateUserCreateCarryForward | null;

    if (carryForward) {
      carryForward.isSending = true;
    }

    if (createdItem.isSsoUser) {
      return createdItem;
    }

    const statusPage: StatusPage | null = await StatusPageService.findOneById({
      id: createdItem.statusPageId!,
      props: {
        isRoot: true,
        ignoreHooks: true,
      },
      select: {
        _id: true,
        name: true,
        pageTitle: true,
        ...STATUS_PAGE_EMAIL_LOGO_SELECT,
        projectId: true,
        requireSsoForLogin: true,
        smtpConfig: {
          _id: true,
          transportType: true,
          hostname: true,
          port: true,
          username: true,
          password: true,
          fromEmail: true,
          fromName: true,
          secure: true,
          authType: true,
          clientId: true,
          clientSecret: true,
          tokenUrl: true,
          scope: true,
          oauthProviderType: true,
        },
      },
    });

    if (!statusPage) {
      throw new BadDataException("Status Page not found");
    }

    /*
     * SCIM and admin-created users must follow the page's login policy too.
     * Do not create a password-reset credential when only SSO can be used.
     */
    if (statusPage.requireSsoForLogin) {
      return createdItem;
    }

    /*
     * The invite link doubles as this user's first password-reset link, so the
     * column has to hold what `/status-page-api/reset-password` looks rows up
     * by: the SHA-256 of the token, never the token itself. That endpoint
     * hashes whatever the link carried and queries by the digest, so a raw
     * token stored here matches nothing and the welcome link is dead on
     * arrival -- and it would also leave a working bearer credential sitting
     * in the database in plaintext.
     *
     * Same split as `/status-page-api/forgot-password`: the digest is
     * persisted, the raw token is only ever mailed.
     */
    // A bearer secret: from the CSPRNG, never ObjectID's non-crypto fallback.
    const token: string = crypto.randomUUID();
    const hashedToken: string = await HashedString.hashValue(
      token,
      EncryptionSecret,
    );
    await this.updateOneById({
      id: createdItem.id!,
      data: {
        resetPasswordToken: hashedToken,
        resetPasswordExpires: OneUptimeDate.getOneDayAfter(),
      },
      props: {
        isRoot: true,
        ignoreHooks: true,
      },
    });

    const statusPageName: string | undefined =
      statusPage.pageTitle || statusPage.name;

    const statusPageURL: string = await StatusPageService.getStatusPageURL(
      statusPage.id!,
    );

    const host: Hostname = await DatabaseConfig.getHost();

    const httpProtocol: Protocol = await DatabaseConfig.getHttpProtocol();

    MailService.sendMail(
      {
        toEmail: createdItem.email!,
        subject: "You have been invited to " + statusPageName,
        isSubjectLiteral: true,
        templateType: EmailTemplateType.StatusPageWelcomeEmail,
        vars: {
          statusPageName: statusPageName!,
          statusPageUrl: statusPageURL,
          logoUrl: StatusPageEmailLogo.getLogoUrl({
            statusPage: statusPage,
            host: host,
            httpProtocol: httpProtocol,
          }),
          homeURL: statusPageURL,
          tokenVerifyUrl: URL.fromString(statusPageURL)
            .addRoute("/reset-password/" + token)
            .toString(),
        },
      },
      {
        projectId: statusPage.projectId,
        mailServer: ProjectSMTPConfigService.toEmailServer(
          statusPage.smtpConfig,
        ),
        statusPageId: statusPage.id!,
      },
    ).catch((err: Error) => {
      logger.error(err);
    });

    return createdItem;
  }

  /*
   * Whether an email address is a private user of this status page now: who
   * may be its subscriber when Only Private Users Can Subscribe is on
   * (Types/StatusPage/SubscriberRestrictions). Compared trimmed and
   * lower-cased; private users the page no longer has - removed by SCIM or
   * by hand - are not.
   */
  @CaptureSpan()
  public async isPrivateUserEmail(data: {
    statusPageId: ObjectID;
    email: string;
  }): Promise<boolean> {
    const email: string = data.email.trim().toLowerCase();

    if (!email) {
      return false;
    }

    const privateUser: Model | null = await this.findOneBy({
      query: {
        statusPageId: data.statusPageId,
        email: QueryHelper.findWithSameText(email),
      },
      select: {
        _id: true,
      },
      props: {
        isRoot: true,
      },
    });

    return Boolean(privateUser);
  }
}
export default new Service();
