import DatabaseConfig from "../DatabaseConfig";
import {
  IsBillingEnabled,
  NotificationSlackWebhookOnCreateUser,
} from "../EnvironmentConfig";
import { OnCreate, OnDelete, OnUpdate } from "../Types/Database/Hooks";
import UpdateBy from "../Types/Database/UpdateBy";
import DeleteBy from "../Types/Database/DeleteBy";
import logger from "../Utils/Logger";
import DatabaseService from "./DatabaseService";
import EmailVerificationTokenService from "./EmailVerificationTokenService";
import MailService from "./MailService";
import TeamMemberService from "./TeamMemberService";
import UserNotificationRuleService from "./UserNotificationRuleService";
import UserNotificationSettingService from "./UserNotificationSettingService";
import { AccountsRoute } from "../../ServiceRoute";
import Hostname from "../../Types/API/Hostname";
import Protocol from "../../Types/API/Protocol";
import Route from "../../Types/API/Route";
import URL from "../../Types/API/URL";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import OneUptimeDate from "../../Types/Date";
import Email from "../../Types/Email";
import EmailTemplateType from "../../Types/Email/EmailTemplateType";
import HashedString from "../../Types/HashedString";
import ObjectID from "../../Types/ObjectID";
import Text from "../../Types/Text";
import EmailVerificationToken from "../../Models/DatabaseModels/EmailVerificationToken";
import TeamMember from "../../Models/DatabaseModels/TeamMember";
import Model from "../../Models/DatabaseModels/User";
import SlackUtil from "../Utils/Workspace/Slack/Slack";
import UserTotpAuth from "../../Models/DatabaseModels/UserTotpAuth";
import UserTotpAuthService from "./UserTotpAuthService";
import UserWebAuthn from "../../Models/DatabaseModels/UserWebAuthn";
import UserWebAuthnService from "./UserWebAuthnService";
import BadDataException from "../../Types/Exception/BadDataException";
import Name from "../../Types/Name";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import Timezone from "../../Types/Timezone";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  @CaptureSpan()
  public async getUserMarkdownString(data: {
    userId: ObjectID;
    projectId: ObjectID;
  }): Promise<string> {
    const user: Model | null = await this.findOneBy({
      query: {
        _id: data.userId,
      },
      select: {
        name: true,
        email: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!user) {
      return "";
    }

    return `[${user.name?.toString() || user.email?.toString() || "User"}](${(await this.getUserLinkInDashboard(data.projectId, data.userId)).toString()})`;
  }

  @CaptureSpan()
  public async getUserLinkInDashboard(
    projectId: ObjectID,
    userId: ObjectID,
  ): Promise<URL> {
    const dashboardUrl: URL = await DatabaseConfig.getDashboardUrl();

    return URL.fromString(dashboardUrl.toString()).addRoute(
      `/${projectId.toString()}/settings/users/${userId.toString()}`,
    );
  }

  @CaptureSpan()
  protected override async onCreateSuccess(
    _onCreate: OnCreate<Model>,
    createdItem: Model,
  ): Promise<Model> {
    if (NotificationSlackWebhookOnCreateUser) {
      SlackUtil.sendMessageToChannelViaIncomingWebhook({
        url: URL.fromString(NotificationSlackWebhookOnCreateUser),
        text: `*New OneUptime User:* 
  *Email:* ${createdItem.email?.toString() || "N/A"}
  *Name:* ${createdItem.name?.toString() || "N/A"}
  *Phone:* ${createdItem.companyPhoneNumber?.toString() || "N/A"}
  *Company:* ${createdItem.companyName?.toString() || "N/A"}`,
      }).catch((err: Error) => {
        // log this error but do not throw it. Not important enough to stop the process.
        logger.error(err);
      });
    }

    // A place holder method used for overriding.
    return Promise.resolve(createdItem);
  }

  @CaptureSpan()
  public async findByEmail(
    email: Email,
    props: DatabaseCommonInteractionProps,
  ): Promise<Model | null> {
    return await this.findOneBy({
      query: {
        email: email,
      },
      select: {
        _id: true,
      },
      props: props,
    });
  }

  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    let carryForward: Array<Model> = [];

    if (updateBy.data.password || updateBy.data.email) {
      const users: Array<Model> = await this.findBy({
        query: updateBy.query,
        select: {
          _id: true,
          email: true,
        },
        props: {
          isRoot: true,
        },
        limit: LIMIT_MAX,
        skip: 0,
      });

      carryForward = users;
    }

    if (updateBy.data.enableTwoFactorAuth) {
      // check if any two factor auth is verified.

      const users: Array<Model> = await this.findBy({
        query: updateBy.query,
        select: {
          _id: true,
          email: true,
        },
        props: {
          isRoot: true,
        },
        limit: LIMIT_MAX,
        skip: 0,
      });

      for (const user of users) {
        const totpAuth: UserTotpAuth | null =
          await UserTotpAuthService.findOneBy({
            query: {
              userId: user.id!,
              isVerified: true,
            },
            select: {
              _id: true,
            },
            props: {
              isRoot: true,
            },
          });

        const webAuthn: UserWebAuthn | null =
          await UserWebAuthnService.findOneBy({
            query: {
              userId: user.id!,
              isVerified: true,
            },
            select: {
              _id: true,
            },
            props: {
              isRoot: true,
            },
          });

        if (!totpAuth && !webAuthn) {
          throw new BadDataException(
            "Please verify two factor authentication method before you enable two factor authentication.",
          );
        }
      }
    }

    return { updateBy, carryForward: carryForward };
  }

  @CaptureSpan()
  protected override async onBeforeDelete(
    deleteBy: DeleteBy<Model>,
  ): Promise<OnDelete<Model>> {
    // Check if the user is a member of any project
    const users: Array<Model> = await this.findBy({
      query: deleteBy.query,
      select: {
        _id: true,
      },
      props: {
        isRoot: true,
      },
      limit: LIMIT_MAX,
      skip: 0,
    });

    for (const user of users) {
      const teamMembers: Array<TeamMember> = await TeamMemberService.findBy({
        query: {
          userId: user.id!,
        },
        select: {
          _id: true,
          projectId: true,
        },
        limit: LIMIT_MAX,
        skip: 0,
        props: {
          isRoot: true,
        },
      });

      if (teamMembers.length > 0) {
        throw new BadDataException(
          "You cannot delete your account because you are a member of one or more projects. Please leave all projects before deleting your account.",
        );
      }
    }

    return { deleteBy, carryForward: null };
  }

  @CaptureSpan()
  protected override async onUpdateSuccess(
    onUpdate: OnUpdate<Model>,
    _updatedItemIds: ObjectID[],
  ): Promise<OnUpdate<Model>> {
    if (onUpdate && onUpdate.updateBy.data.password) {
      const host: Hostname = await DatabaseConfig.getHost();
      const httpProtocol: Protocol = await DatabaseConfig.getHttpProtocol();

      for (const user of onUpdate.carryForward) {
        // password changed, send password changed mail
        MailService.sendMail({
          toEmail: user.email!,
          subject: "Password Changed.",
          templateType: EmailTemplateType.PasswordChanged,
          vars: {
            homeURL: new URL(httpProtocol, host).toString(),
          },
        }).catch((err: Error) => {
          logger.error(err);
        });
      }
    }

    if (onUpdate && onUpdate.updateBy.data.isEmailVerified) {
      // if the email is verified then create default policies for this user.

      const newUsers: Array<Model> = await this.findBy({
        query: onUpdate.updateBy.query,
        select: {
          _id: true,
          email: true,
        },
        props: {
          isRoot: true,
        },
        limit: LIMIT_MAX,
        skip: 0,
      });

      for (const user of newUsers) {
        // emai is verified. create default policies for this user.
        const teamMembers: Array<TeamMember> = await TeamMemberService.findBy({
          query: {
            userId: user.id!,
            hasAcceptedInvitation: true,
          },
          select: {
            projectId: true,
          },
          limit: LIMIT_MAX,
          skip: 0,
          props: {
            isRoot: true,
          },
        });

        for (const member of teamMembers) {
          // create default policies for this user.
          await UserNotificationRuleService.addDefaultNotificationRuleForUser(
            member.projectId!,
            user.id!,
            user.email!,
          );

          await UserNotificationSettingService.addDefaultNotificationSettingsForUser(
            user.id!,
            member.projectId!,
          );
        }
      }
    }

    if (onUpdate && onUpdate.updateBy.data.email) {
      const newUsers: Array<Model> = await this.findBy({
        query: onUpdate.updateBy.query,
        select: {
          _id: true,
          email: true,
          name: true,
        },
        props: {
          isRoot: true,
        },
        limit: LIMIT_MAX,
        skip: 0,
      });

      for (const user of onUpdate.carryForward) {
        const newUser: Model | undefined = newUsers.find((u: Model) => {
          return u._id?.toString() === user._id.toString();
        });

        if (newUser && newUser.email?.toString() !== user.email.toString()) {
          // password changed, send password changed mail
          const generatedToken: ObjectID = ObjectID.generate();

          const emailVerificationToken: EmailVerificationToken =
            new EmailVerificationToken();
          emailVerificationToken.userId = user.id;
          emailVerificationToken.email = newUser.email!;
          emailVerificationToken.token = generatedToken;
          emailVerificationToken.expires = OneUptimeDate.getOneDayAfter();

          await EmailVerificationTokenService.create({
            data: emailVerificationToken,
            props: {
              isRoot: true,
            },
          });

          const host: Hostname = await DatabaseConfig.getHost();
          const httpProtocol: Protocol = await DatabaseConfig.getHttpProtocol();

          MailService.sendMail({
            toEmail: newUser.email!,
            subject: "You have changed your email. Please verify your email.",
            templateType: EmailTemplateType.EmailChanged,
            vars: {
              name: newUser.name!.toString(),
              tokenVerifyUrl: new URL(
                httpProtocol,
                host,
                new Route(AccountsRoute.toString()).addRoute(
                  "/verify-email/" + generatedToken.toString(),
                ),
              ).toString(),
              homeUrl: new URL(httpProtocol, host).toString(),
            },
          }).catch((err: Error) => {
            logger.error(err);
          });

          await this.updateOneBy({
            query: {
              _id: user.id.toString(),
            },
            data: {
              isEmailVerified: false,
            },
            props: {
              isRoot: true,
              ignoreHooks: true,
            },
          });
        }
      }
    }

    return onUpdate;
  }

  @CaptureSpan()
  public async createByEmail(data: {
    email: Email;
    name: Name | undefined;
    isEmailVerified?: boolean;
    generateRandomPassword?: boolean;
    props: DatabaseCommonInteractionProps;
  }): Promise<Model> {
    const { email, props } = data;

    const user: Model = new Model();
    user.email = email;
    if (data.name) {
      user.name = data.name;
    }
    user.isEmailVerified = data.isEmailVerified || false;

    if (data.generateRandomPassword) {
      user.password = new HashedString(Text.generateRandomText(20));
    }

    if (!IsBillingEnabled) {
      // if billing is not enabled, then email is verified by default.
      user.isEmailVerified = true;
    }

    return await this.create({
      data: user,
      props: props,
    });
  }

  public async getTimezoneForUser(userId: ObjectID): Promise<Timezone | null> {
    const user: Model | null = await this.findOneBy({
      query: {
        _id: userId,
      },
      select: {
        timezone: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!user) {
      return null;
    }

    return user.timezone || null;
  }
}

export default new Service();
