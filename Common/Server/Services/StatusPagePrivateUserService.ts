import DatabaseConfig from "../DatabaseConfig";
import CreateBy from "../Types/Database/CreateBy";
import UpdateBy from "../Types/Database/UpdateBy";
import { OnCreate, OnUpdate } from "../Types/Database/Hooks";
import logger from "../Utils/Logger";
import DatabaseService from "./DatabaseService";
import MailService from "./MailService";
import ProjectSMTPConfigService from "./ProjectSmtpConfigService";
import StatusPageService from "./StatusPageService";
import { StatusPageApiRoute } from "../../ServiceRoute";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import Hostname from "../../Types/API/Hostname";
import Protocol from "../../Types/API/Protocol";
import URL from "../../Types/API/URL";
import OneUptimeDate from "../../Types/Date";
import EmailTemplateType from "../../Types/Email/EmailTemplateType";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import Email from "../../Types/Email";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import StatusPage from "../../Models/DatabaseModels/StatusPage";
import Model from "../../Models/DatabaseModels/StatusPagePrivateUser";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    // check if this user is already invited.
    if (createBy.data.statusPageId && createBy.data.email) {
      const statusPageUser: Model | null = await this.findOneBy({
        query: {
          email: createBy.data.email,
          statusPageId: createBy.data.statusPageId,
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

    return {
      createBy: createBy,
      carryForward: null,
    };
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
    if (updateBy.data.email) {
      const newEmail: string = (updateBy.data.email as Email)
        .toString()
        .toLowerCase();

      const existingUsers: Array<Model> = await this.findBy({
        query: updateBy.query,
        select: {
          _id: true,
          email: true,
        },
        props: updateBy.props,
        limit: LIMIT_MAX,
        skip: 0,
      });

      for (const user of existingUsers) {
        if (!user.id) {
          continue;
        }

        /*
         * A row whose `email` did not come back is treated as changed -- that
         * only happens when the caller could not read the column, and on a
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
    _onCreate: OnCreate<Model>,
    createdItem: Model,
  ): Promise<Model> {
    // send email to the user.
    const token: string = ObjectID.generate().toString();
    await this.updateOneById({
      id: createdItem.id!,
      data: {
        resetPasswordToken: token,
        resetPasswordExpires: OneUptimeDate.getOneDayAfter(),
      },
      props: {
        isRoot: true,
        ignoreHooks: true,
      },
    });

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
        logoFileId: true,
        projectId: true,
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

    const statusPageName: string | undefined =
      statusPage.pageTitle || statusPage.name;

    const statusPageURL: string = await StatusPageService.getStatusPageURL(
      statusPage.id!,
    );

    const host: Hostname = await DatabaseConfig.getHost();

    const httpProtocol: Protocol = await DatabaseConfig.getHttpProtocol();
    const statusPageIdString: string | null =
      statusPage.id?.toString() || statusPage._id?.toString() || null;

    MailService.sendMail(
      {
        toEmail: createdItem.email!,
        subject: "You have been invited to " + statusPageName,
        templateType: EmailTemplateType.StatusPageWelcomeEmail,
        vars: {
          statusPageName: statusPageName!,
          statusPageUrl: statusPageURL,
          logoUrl:
            statusPage.logoFileId && statusPageIdString
              ? new URL(httpProtocol, host)
                  .addRoute(StatusPageApiRoute)
                  .addRoute(`/logo/${statusPageIdString}`)
                  .toString()
              : "",
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
}
export default new Service();
