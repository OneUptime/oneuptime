import DatabaseConfig from "../DatabaseConfig";
import {
  IsBillingEnabled,
  NotificationWebhookOnCreateUser,
} from "../EnvironmentConfig";
import { OnCreate, OnUpdate } from "../Types/Database/Hooks";
import UpdateBy from "../Types/Database/UpdateBy";
import logger from "../Utils/Logger";
import DatabaseService from "./DatabaseService";
import EmailVerificationTokenService from "./EmailVerificationTokenService";
import MailService from "./MailService";
import TeamMemberService from "./TeamMemberService";
import UserNotificationRuleService from "./UserNotificationRuleService";
import UserNotificationSettingService from "./UserNotificationSettingService";
import { AccountsRoute } from "Common/ServiceRoute";
import Hostname from "Common/Types/API/Hostname";
import Protocol from "Common/Types/API/Protocol";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import DatabaseCommonInteractionProps from "Common/Types/BaseDatabase/DatabaseCommonInteractionProps";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import OneUptimeDate from "Common/Types/Date";
import Email from "Common/Types/Email";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import HashedString from "Common/Types/HashedString";
import ObjectID from "Common/Types/ObjectID";
import Text from "Common/Types/Text";
import EmailVerificationToken from "Common/Models/DatabaseModels/EmailVerificationToken";
import TeamMember from "Common/Models/DatabaseModels/TeamMember";
import Model from "Common/Models/DatabaseModels/User";
import SlackUtil from "../Utils/Slack";
import UserTwoFactorAuth from "Common/Models/DatabaseModels/UserTwoFactorAuth";
import UserTwoFactorAuthService from "./UserTwoFactorAuthService";
import BadDataException from "Common/Types/Exception/BadDataException";

export class UserService extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  protected override async onCreateSuccess(
    _onCreate: OnCreate<Model>,
    createdItem: Model,
  ): Promise<Model> {
    if (NotificationWebhookOnCreateUser) {
      SlackUtil.sendMessageToChannel({
        url: URL.fromString(NotificationWebhookOnCreateUser),
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
        const twoFactorAuth: UserTwoFactorAuth | null =
          await UserTwoFactorAuthService.findOneBy({
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

        if (!twoFactorAuth) {
          throw new BadDataException(
            "Please verify two factor authentication method before you enable two factor authentication.",
          );
        }
      }
    }

    return { updateBy, carryForward: carryForward };
  }

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

  public async createByEmail(data: {
    email: Email;
    isEmailVerified?: boolean;
    generateRandomPassword?: boolean;
    props: DatabaseCommonInteractionProps;
  }): Promise<Model> {
    const { email, props } = data;

    const user: Model = new Model();
    user.email = email;
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
}

export default new UserService();
