import DatabaseConfig from "../DatabaseConfig";
import BaseService from "./BaseService";
import MailService from "./MailService";
import OnCallReadinessService, {
  MaskedIdentifierKind,
  ReadinessMethodType,
  maskIdentifier,
} from "./OnCallReadinessService";
import ProjectService from "./ProjectService";
import TeamMemberService from "./TeamMemberService";
import UserCallService from "./UserCallService";
import UserEmailService from "./UserEmailService";
import UserNotificationRuleService, {
  NotificationDeletionImpact,
} from "./UserNotificationRuleService";
import UserPushService from "./UserPushService";
import UserService from "./UserService";
import UserSmsService from "./UserSmsService";
import UserTelegramService from "./UserTelegramService";
import UserSlackService from "./UserSlackService";
import UserMicrosoftTeamsService from "./UserMicrosoftTeamsService";
import UserWebhookService from "./UserWebhookService";
import UserWhatsAppService from "./UserWhatsAppService";
import type AuditLogServiceType from "./AuditLogService";
import logger, { LogAttributes } from "../Utils/Logger";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import URL from "../../Types/API/URL";
import AuditLogAction from "../../Types/AuditLog/AuditLogAction";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import Dictionary from "../../Types/Dictionary";
import Email from "../../Types/Email";
import EmailTemplateType from "../../Types/Email/EmailTemplateType";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import Phone from "../../Types/Phone";
import BaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Project from "../../Models/DatabaseModels/Project";
import TeamMember from "../../Models/DatabaseModels/TeamMember";
import User from "../../Models/DatabaseModels/User";
import UserCall from "../../Models/DatabaseModels/UserCall";
import UserEmail from "../../Models/DatabaseModels/UserEmail";
import UserPush from "../../Models/DatabaseModels/UserPush";
import UserSMS from "../../Models/DatabaseModels/UserSMS";
import UserTelegram from "../../Models/DatabaseModels/UserTelegram";
import UserSlack from "../../Models/DatabaseModels/UserSlack";
import UserMicrosoftTeams from "../../Models/DatabaseModels/UserMicrosoftTeams";
import UserWebhook from "../../Models/DatabaseModels/UserWebhook";
import UserWhatsApp from "../../Models/DatabaseModels/UserWhatsApp";

/*
 * ADDING A NOTIFICATION METHOD TO SOMEBODY ELSE'S ACCOUNT.
 *
 * The readiness work that came before this one could tell a project owner that
 * a responder was unreachable, and the admin rules page let them repair that
 * responder's RULES. Neither could do anything about the case that produces
 * most unreachable responders in practice: somebody who has no notification
 * method at all. A rule is a pointer; with nothing to point at, an owner
 * looking at a brand-new engineer's page could only send them a reminder and
 * hope. This service is what closes that last gap.
 *
 * It is deliberately NOT "widen the seven method models so admins can write
 * them". That was tried, and the essay at the top of UserEmail.ts is the record
 * of how it failed: those models are scoped to their owner by
 * TenantPermission.isAccessGrantedOnlyByCurrentUser, which holds exactly while
 * their table access control lists Permission.CurrentUser and nothing else, and
 * every attempt to keep the raw columns fenced off once that stamp stopped
 * being applied was walked past by something — nested relation selects, `query`
 * filters, sort columns appended after the guard had run. The models are still
 * CurrentUser-only. Nothing in this file changes that, and an administrator's
 * every direct read or write of UserEmail, UserSMS, UserCall, UserWhatsApp,
 * UserTelegram, UserSlack, UserMicrosoftTeams, UserPush and UserWebhook is
 * still refused.
 *
 * What this file does instead is a NARROW, SERVER-SIDE, AUDITED capability
 * that runs as root on the admin's behalf and never hands them the row:
 *
 *   - LIST returns masked identifiers only, through the same maskIdentifier
 *     the readiness payload uses. There is no unmask-for-anybody branch, and
 *     the raw column never enters a response body.
 *
 *   - ADD writes the row with the target user's id and isVerified left at its
 *     default of false, which makes the method service send a verification code
 *     TO THE DEVICE. That is the whole safety property, and it is worth being
 *     precise about: an administrator can type a phone number in, but they
 *     cannot make it live. /user-email/verify, /user-sms/verify and their
 *     siblings all compare the row's userId against the SIGNED-IN caller and
 *     refuse anybody else (UserEmailAPI.ts and friends), so the code that was
 *     just sent is only usable by the person holding the device. An admin who
 *     types their own number in has created a row that will never be verified,
 *     will never be selected by the fallback, and shows up on the owner's own
 *     notification methods page as an unverified method they did not add — on
 *     top of the mail this service sends them.
 *
 *   - REMOVE is allowed on all nine channels, because offboarding a stale
 *     device is a real administrative job and the owner may well be gone. It is
 *     the destructive direction, so it is the one with a preview attached:
 *     UserNotificationRuleService.getNotificationMethodDeletionImpact says how
 *     many rules would go with it and whether the person is reachable
 *     afterwards. That method was written for this caller and had none until
 *     now.
 *
 *   - ADD is allowed on FOUR channels — Email, SMS, Call, WhatsApp — and the
 *     omissions are not oversights. Push is a device token minted by a browser
 *     or a phone at registration time; there is nothing an admin could type.
 *     Telegram needs the account holder to message the bot before a chat id
 *     exists. Slack and Microsoft Teams are pointers at the owner's own OAuth
 *     workspace link, which only the owner can establish — and an admin-created
 *     row would be live immediately, since creation is verification for those
 *     two. Webhook is the one that is deliberately refused rather than
 *     merely impractical: UserWebhook has no isVerified column at all, so an
 *     admin-created webhook would be live the moment it was written, which is
 *     exactly the silent-redirect this whole design is built to prevent.
 *
 * EVERY WRITE TELLS THE OWNER. Same reasoning as the rules path: an admin
 * adding a colleague's work phone and an attacker adding their own are the same
 * request from the server's point of view, and the only party who can always
 * tell them apart is the person whose account it is.
 */

/**
 * A method as an administrator is allowed to see it: enough to recognise, never
 * enough to reach.
 *
 * `methodId` is a foreign key, not a secret — it is already stored in plain
 * sight on every rule the owner has created, and it is what lets an admin point
 * a rule at a method (or remove one) without reading the row behind it.
 *
 * Nothing else belongs on this interface. Every field added here is a field
 * that ships to every administrator of the project.
 */
export interface AdminNotificationMethodView {
  methodId: ObjectID;
  methodType: ReadinessMethodType;
  /** Already masked by maskIdentifier. Never the raw value, for any caller. */
  maskedIdentifier: string;
  isVerified: boolean;
  /**
   * Whether an administrator could have created this kind of method at all.
   * Drives the page's copy, so a responder with only a webhook is told why the
   * "Add" control does not offer one rather than being left to guess.
   */
  isAdminAddable: boolean;
  createdAt?: Date | undefined;
}

/**
 * The four channels an administrator may CREATE. See the header for why the
 * other five are absent; this enum is the single place that decides, and both
 * the API's validation and the service's own dispatch read it.
 */
export enum AdminAddableChannel {
  Email = "Email",
  SMS = "SMS",
  Call = "Call",
  WhatsApp = "WhatsApp",
}

/**
 * A compact deletion preview, for the confirmation an admin sees before
 * removing somebody else's method.
 *
 * It is a projection of NotificationDeletionImpact rather than that whole
 * structure: the full one carries per-cell severity names, and an admin
 * confirming a removal needs the counts and the one sentence about whether this
 * is the deletion that makes a person unreachable.
 */
export interface AdminNotificationMethodDeletionPreview {
  rulesDeletedCount: number;
  coverageLostCount: number;
  verifiedMethodCountAfterDeletion: number;
  reachability: string;
  isFallbackEnabled: boolean;
  /**
   * TRUE means the read behind these numbers hit its ceiling, so they are
   * floors rather than totals. Carried through rather than swallowed: a
   * confirmation that undercounts silently is worse than one that says it is
   * unsure.
   */
  isTruncated: boolean;
}

/*
 * One channel, and everything this service needs to do to it. Built per call
 * rather than hoisted to module scope for the same reason
 * UserNotificationRuleAdminService builds its descriptors per call: the seven
 * method services import UserNotificationRuleService, which imports this
 * file's siblings, and a module-level constant would capture `default` while
 * one of those modules was still mid-evaluation and freeze `undefined` into the
 * table.
 */
interface ChannelDescriptor {
  methodType: ReadinessMethodType;
  isAdminAddable: boolean;
  /*
   * The model class behind this channel, used for ONE thing: naming the table
   * an audit entry is about. Never instantiated with a real row's values — see
   * writeAuditLog for why the entry is built from a blank instance.
   */
  modelType: { new (): BaseModel };
  /** Reads every one of this user's rows on this channel, already masked. */
  list: (data: {
    projectId: ObjectID;
    userId: ObjectID;
  }) => Promise<Array<AdminNotificationMethodView>>;
  /** Confirms one row exists AND belongs to this user in this project. */
  findOwnedRow: (data: {
    methodId: ObjectID;
    projectId: ObjectID;
    userId: ObjectID;
  }) => Promise<AdminNotificationMethodView | null>;
  deleteRow: (data: { methodId: ObjectID }) => Promise<void>;
  /** Absent on the three channels an administrator may not create. */
  create?:
    | ((data: {
        projectId: ObjectID;
        userId: ObjectID;
        value: string;
      }) => Promise<AdminNotificationMethodView>)
    | undefined;
  /** Absent on Webhook, which has no verification concept at all. */
  resendVerificationCode?: ((methodId: ObjectID) => Promise<void>) | undefined;
}

export class UserNotificationMethodAdminService extends BaseService {
  /*
   * The seven channels. Every one of them is listable and deletable; four are
   * creatable. A channel missing from this table is a channel this service
   * cannot see at all, which is why the list is exhaustive rather than
   * restricted to the interesting ones — an admin looking at a responder whose
   * only method is a webhook must be told the webhook is there, or they will
   * conclude the person has nothing and go and add a phone number that
   * duplicates a working channel.
   */
  private getChannelDescriptors(): Array<ChannelDescriptor> {
    return [
      {
        methodType: ReadinessMethodType.Email,
        isAdminAddable: true,
        modelType: UserEmail,
        list: async (data: {
          projectId: ObjectID;
          userId: ObjectID;
        }): Promise<Array<AdminNotificationMethodView>> => {
          const rows: Array<UserEmail> = await UserEmailService.findBy({
            query: { projectId: data.projectId, userId: data.userId },
            select: {
              _id: true,
              email: true,
              isVerified: true,
              createdAt: true,
            },
            sort: { createdAt: SortOrder.Ascending },
            skip: 0,
            limit: LIMIT_PER_PROJECT,
            props: { isRoot: true },
          });

          return rows.map((row: UserEmail): AdminNotificationMethodView => {
            return this.toView({
              row: row,
              methodType: ReadinessMethodType.Email,
              isAdminAddable: true,
              identifier: row.email?.toString(),
              kind: MaskedIdentifierKind.Email,
              isVerified: row.isVerified,
            });
          });
        },
        findOwnedRow: async (data: {
          methodId: ObjectID;
          projectId: ObjectID;
          userId: ObjectID;
        }): Promise<AdminNotificationMethodView | null> => {
          const row: UserEmail | null = await UserEmailService.findOneBy({
            query: {
              _id: data.methodId,
              projectId: data.projectId,
              userId: data.userId,
            },
            select: { _id: true, email: true, isVerified: true },
            props: { isRoot: true },
          });

          return row
            ? this.toView({
                row: row,
                methodType: ReadinessMethodType.Email,
                isAdminAddable: true,
                identifier: row.email?.toString(),
                kind: MaskedIdentifierKind.Email,
                isVerified: row.isVerified,
              })
            : null;
        },
        deleteRow: async (data: { methodId: ObjectID }): Promise<void> => {
          await UserEmailService.deleteOneById({
            id: data.methodId,
            props: { isRoot: true },
          });
        },
        create: async (data: {
          projectId: ObjectID;
          userId: ObjectID;
          value: string;
        }): Promise<AdminNotificationMethodView> => {
          const model: UserEmail = new UserEmail();
          model.projectId = data.projectId;
          model.userId = data.userId;
          model.email = new Email(data.value);

          const created: UserEmail = await UserEmailService.create({
            data: model,
            props: { isRoot: true },
          });

          return this.toView({
            row: created,
            methodType: ReadinessMethodType.Email,
            isAdminAddable: true,
            identifier: created.email?.toString(),
            kind: MaskedIdentifierKind.Email,
            isVerified: created.isVerified,
          });
        },
        resendVerificationCode: async (methodId: ObjectID): Promise<void> => {
          await UserEmailService.resendVerificationCode(methodId);
        },
      },
      {
        methodType: ReadinessMethodType.SMS,
        isAdminAddable: true,
        modelType: UserSMS,
        list: async (data: {
          projectId: ObjectID;
          userId: ObjectID;
        }): Promise<Array<AdminNotificationMethodView>> => {
          const rows: Array<UserSMS> = await UserSmsService.findBy({
            query: { projectId: data.projectId, userId: data.userId },
            select: {
              _id: true,
              phone: true,
              isVerified: true,
              createdAt: true,
            },
            sort: { createdAt: SortOrder.Ascending },
            skip: 0,
            limit: LIMIT_PER_PROJECT,
            props: { isRoot: true },
          });

          return rows.map((row: UserSMS): AdminNotificationMethodView => {
            return this.toView({
              row: row,
              methodType: ReadinessMethodType.SMS,
              isAdminAddable: true,
              identifier: row.phone?.toString(),
              kind: MaskedIdentifierKind.Phone,
              isVerified: row.isVerified,
            });
          });
        },
        findOwnedRow: async (data: {
          methodId: ObjectID;
          projectId: ObjectID;
          userId: ObjectID;
        }): Promise<AdminNotificationMethodView | null> => {
          const row: UserSMS | null = await UserSmsService.findOneBy({
            query: {
              _id: data.methodId,
              projectId: data.projectId,
              userId: data.userId,
            },
            select: { _id: true, phone: true, isVerified: true },
            props: { isRoot: true },
          });

          return row
            ? this.toView({
                row: row,
                methodType: ReadinessMethodType.SMS,
                isAdminAddable: true,
                identifier: row.phone?.toString(),
                kind: MaskedIdentifierKind.Phone,
                isVerified: row.isVerified,
              })
            : null;
        },
        deleteRow: async (data: { methodId: ObjectID }): Promise<void> => {
          await UserSmsService.deleteOneById({
            id: data.methodId,
            props: { isRoot: true },
          });
        },
        create: async (data: {
          projectId: ObjectID;
          userId: ObjectID;
          value: string;
        }): Promise<AdminNotificationMethodView> => {
          const model: UserSMS = new UserSMS();
          model.projectId = data.projectId;
          model.userId = data.userId;
          model.phone = new Phone(data.value);

          const created: UserSMS = await UserSmsService.create({
            data: model,
            props: { isRoot: true },
          });

          return this.toView({
            row: created,
            methodType: ReadinessMethodType.SMS,
            isAdminAddable: true,
            identifier: created.phone?.toString(),
            kind: MaskedIdentifierKind.Phone,
            isVerified: created.isVerified,
          });
        },
        resendVerificationCode: async (methodId: ObjectID): Promise<void> => {
          await UserSmsService.resendVerificationCode(methodId);
        },
      },
      {
        methodType: ReadinessMethodType.Call,
        isAdminAddable: true,
        modelType: UserCall,
        list: async (data: {
          projectId: ObjectID;
          userId: ObjectID;
        }): Promise<Array<AdminNotificationMethodView>> => {
          const rows: Array<UserCall> = await UserCallService.findBy({
            query: { projectId: data.projectId, userId: data.userId },
            select: {
              _id: true,
              phone: true,
              isVerified: true,
              createdAt: true,
            },
            sort: { createdAt: SortOrder.Ascending },
            skip: 0,
            limit: LIMIT_PER_PROJECT,
            props: { isRoot: true },
          });

          return rows.map((row: UserCall): AdminNotificationMethodView => {
            return this.toView({
              row: row,
              methodType: ReadinessMethodType.Call,
              isAdminAddable: true,
              identifier: row.phone?.toString(),
              kind: MaskedIdentifierKind.Phone,
              isVerified: row.isVerified,
            });
          });
        },
        findOwnedRow: async (data: {
          methodId: ObjectID;
          projectId: ObjectID;
          userId: ObjectID;
        }): Promise<AdminNotificationMethodView | null> => {
          const row: UserCall | null = await UserCallService.findOneBy({
            query: {
              _id: data.methodId,
              projectId: data.projectId,
              userId: data.userId,
            },
            select: { _id: true, phone: true, isVerified: true },
            props: { isRoot: true },
          });

          return row
            ? this.toView({
                row: row,
                methodType: ReadinessMethodType.Call,
                isAdminAddable: true,
                identifier: row.phone?.toString(),
                kind: MaskedIdentifierKind.Phone,
                isVerified: row.isVerified,
              })
            : null;
        },
        deleteRow: async (data: { methodId: ObjectID }): Promise<void> => {
          await UserCallService.deleteOneById({
            id: data.methodId,
            props: { isRoot: true },
          });
        },
        create: async (data: {
          projectId: ObjectID;
          userId: ObjectID;
          value: string;
        }): Promise<AdminNotificationMethodView> => {
          const model: UserCall = new UserCall();
          model.projectId = data.projectId;
          model.userId = data.userId;
          model.phone = new Phone(data.value);

          const created: UserCall = await UserCallService.create({
            data: model,
            props: { isRoot: true },
          });

          return this.toView({
            row: created,
            methodType: ReadinessMethodType.Call,
            isAdminAddable: true,
            identifier: created.phone?.toString(),
            kind: MaskedIdentifierKind.Phone,
            isVerified: created.isVerified,
          });
        },
        resendVerificationCode: async (methodId: ObjectID): Promise<void> => {
          await UserCallService.resendVerificationCode(methodId);
        },
      },
      {
        methodType: ReadinessMethodType.WhatsApp,
        isAdminAddable: true,
        modelType: UserWhatsApp,
        list: async (data: {
          projectId: ObjectID;
          userId: ObjectID;
        }): Promise<Array<AdminNotificationMethodView>> => {
          const rows: Array<UserWhatsApp> = await UserWhatsAppService.findBy({
            query: { projectId: data.projectId, userId: data.userId },
            select: {
              _id: true,
              phone: true,
              isVerified: true,
              createdAt: true,
            },
            sort: { createdAt: SortOrder.Ascending },
            skip: 0,
            limit: LIMIT_PER_PROJECT,
            props: { isRoot: true },
          });

          return rows.map((row: UserWhatsApp): AdminNotificationMethodView => {
            return this.toView({
              row: row,
              methodType: ReadinessMethodType.WhatsApp,
              isAdminAddable: true,
              identifier: row.phone?.toString(),
              kind: MaskedIdentifierKind.Phone,
              isVerified: row.isVerified,
            });
          });
        },
        findOwnedRow: async (data: {
          methodId: ObjectID;
          projectId: ObjectID;
          userId: ObjectID;
        }): Promise<AdminNotificationMethodView | null> => {
          const row: UserWhatsApp | null = await UserWhatsAppService.findOneBy({
            query: {
              _id: data.methodId,
              projectId: data.projectId,
              userId: data.userId,
            },
            select: { _id: true, phone: true, isVerified: true },
            props: { isRoot: true },
          });

          return row
            ? this.toView({
                row: row,
                methodType: ReadinessMethodType.WhatsApp,
                isAdminAddable: true,
                identifier: row.phone?.toString(),
                kind: MaskedIdentifierKind.Phone,
                isVerified: row.isVerified,
              })
            : null;
        },
        deleteRow: async (data: { methodId: ObjectID }): Promise<void> => {
          await UserWhatsAppService.deleteOneById({
            id: data.methodId,
            props: { isRoot: true },
          });
        },
        create: async (data: {
          projectId: ObjectID;
          userId: ObjectID;
          value: string;
        }): Promise<AdminNotificationMethodView> => {
          const model: UserWhatsApp = new UserWhatsApp();
          model.projectId = data.projectId;
          model.userId = data.userId;
          model.phone = new Phone(data.value);

          const created: UserWhatsApp = await UserWhatsAppService.create({
            data: model,
            props: { isRoot: true },
          });

          return this.toView({
            row: created,
            methodType: ReadinessMethodType.WhatsApp,
            isAdminAddable: true,
            identifier: created.phone?.toString(),
            kind: MaskedIdentifierKind.Phone,
            isVerified: created.isVerified,
          });
        },
        resendVerificationCode: async (methodId: ObjectID): Promise<void> => {
          await UserWhatsAppService.resendVerificationCode(methodId);
        },
      },
      /*
       * The three read-and-remove-only channels. They carry no `create`, which
       * is what the API's "this channel cannot be added by an administrator"
       * refusal is derived from — the refusal is a consequence of the table
       * rather than a second list that could drift out of step with it.
       */
      {
        methodType: ReadinessMethodType.Push,
        isAdminAddable: false,
        modelType: UserPush,
        list: async (data: {
          projectId: ObjectID;
          userId: ObjectID;
        }): Promise<Array<AdminNotificationMethodView>> => {
          const rows: Array<UserPush> = await UserPushService.findBy({
            query: { projectId: data.projectId, userId: data.userId },
            select: {
              _id: true,
              deviceName: true,
              isVerified: true,
              createdAt: true,
            },
            sort: { createdAt: SortOrder.Ascending },
            skip: 0,
            limit: LIMIT_PER_PROJECT,
            props: { isRoot: true },
          });

          /*
           * `deviceName` and never `deviceToken`. The token is the addressable
           * secret behind a push method — anyone holding it can push to that
           * device — and this select is the only thing standing between it and
           * a response body.
           */
          return rows.map((row: UserPush): AdminNotificationMethodView => {
            return this.toView({
              row: row,
              methodType: ReadinessMethodType.Push,
              isAdminAddable: false,
              identifier: row.deviceName,
              kind: MaskedIdentifierKind.Handle,
              isVerified: row.isVerified,
            });
          });
        },
        findOwnedRow: async (data: {
          methodId: ObjectID;
          projectId: ObjectID;
          userId: ObjectID;
        }): Promise<AdminNotificationMethodView | null> => {
          const row: UserPush | null = await UserPushService.findOneBy({
            query: {
              _id: data.methodId,
              projectId: data.projectId,
              userId: data.userId,
            },
            select: { _id: true, deviceName: true, isVerified: true },
            props: { isRoot: true },
          });

          return row
            ? this.toView({
                row: row,
                methodType: ReadinessMethodType.Push,
                isAdminAddable: false,
                identifier: row.deviceName,
                kind: MaskedIdentifierKind.Handle,
                isVerified: row.isVerified,
              })
            : null;
        },
        deleteRow: async (data: { methodId: ObjectID }): Promise<void> => {
          await UserPushService.deleteOneById({
            id: data.methodId,
            props: { isRoot: true },
          });
        },
      },
      {
        methodType: ReadinessMethodType.Telegram,
        isAdminAddable: false,
        modelType: UserTelegram,
        list: async (data: {
          projectId: ObjectID;
          userId: ObjectID;
        }): Promise<Array<AdminNotificationMethodView>> => {
          const rows: Array<UserTelegram> = await UserTelegramService.findBy({
            query: { projectId: data.projectId, userId: data.userId },
            /*
             * The handle only — never telegramChatId, which is the addressable
             * target a bot sends to. Same rule OnCallReadinessService follows.
             */
            select: {
              _id: true,
              telegramUserHandle: true,
              isVerified: true,
              createdAt: true,
            },
            sort: { createdAt: SortOrder.Ascending },
            skip: 0,
            limit: LIMIT_PER_PROJECT,
            props: { isRoot: true },
          });

          return rows.map((row: UserTelegram): AdminNotificationMethodView => {
            return this.toView({
              row: row,
              methodType: ReadinessMethodType.Telegram,
              isAdminAddable: false,
              identifier: row.telegramUserHandle,
              kind: MaskedIdentifierKind.Handle,
              isVerified: row.isVerified,
            });
          });
        },
        findOwnedRow: async (data: {
          methodId: ObjectID;
          projectId: ObjectID;
          userId: ObjectID;
        }): Promise<AdminNotificationMethodView | null> => {
          const row: UserTelegram | null = await UserTelegramService.findOneBy({
            query: {
              _id: data.methodId,
              projectId: data.projectId,
              userId: data.userId,
            },
            select: {
              _id: true,
              telegramUserHandle: true,
              isVerified: true,
            },
            props: { isRoot: true },
          });

          return row
            ? this.toView({
                row: row,
                methodType: ReadinessMethodType.Telegram,
                isAdminAddable: false,
                identifier: row.telegramUserHandle,
                kind: MaskedIdentifierKind.Handle,
                isVerified: row.isVerified,
              })
            : null;
        },
        deleteRow: async (data: { methodId: ObjectID }): Promise<void> => {
          await UserTelegramService.deleteOneById({
            id: data.methodId,
            props: { isRoot: true },
          });
        },
      },
      {
        methodType: ReadinessMethodType.Slack,
        isAdminAddable: false,
        modelType: UserSlack,
        list: async (data: {
          projectId: ObjectID;
          userId: ObjectID;
        }): Promise<Array<AdminNotificationMethodView>> => {
          const rows: Array<UserSlack> = await UserSlackService.findBy({
            query: { projectId: data.projectId, userId: data.userId },
            /*
             * The username only — never slackUserId, which is the addressable
             * target the bot sends to. Same rule OnCallReadinessService
             * follows.
             */
            select: {
              _id: true,
              slackUserName: true,
              isVerified: true,
              createdAt: true,
            },
            sort: { createdAt: SortOrder.Ascending },
            skip: 0,
            limit: LIMIT_PER_PROJECT,
            props: { isRoot: true },
          });

          return rows.map((row: UserSlack): AdminNotificationMethodView => {
            return this.toView({
              row: row,
              methodType: ReadinessMethodType.Slack,
              isAdminAddable: false,
              identifier: row.slackUserName,
              kind: MaskedIdentifierKind.Handle,
              isVerified: row.isVerified,
            });
          });
        },
        findOwnedRow: async (data: {
          methodId: ObjectID;
          projectId: ObjectID;
          userId: ObjectID;
        }): Promise<AdminNotificationMethodView | null> => {
          const row: UserSlack | null = await UserSlackService.findOneBy({
            query: {
              _id: data.methodId,
              projectId: data.projectId,
              userId: data.userId,
            },
            select: {
              _id: true,
              slackUserName: true,
              isVerified: true,
            },
            props: { isRoot: true },
          });

          return row
            ? this.toView({
                row: row,
                methodType: ReadinessMethodType.Slack,
                isAdminAddable: false,
                identifier: row.slackUserName,
                kind: MaskedIdentifierKind.Handle,
                isVerified: row.isVerified,
              })
            : null;
        },
        deleteRow: async (data: { methodId: ObjectID }): Promise<void> => {
          await UserSlackService.deleteOneById({
            id: data.methodId,
            props: { isRoot: true },
          });
        },
      },
      {
        methodType: ReadinessMethodType.MicrosoftTeams,
        isAdminAddable: false,
        modelType: UserMicrosoftTeams,
        list: async (data: {
          projectId: ObjectID;
          userId: ObjectID;
        }): Promise<Array<AdminNotificationMethodView>> => {
          const rows: Array<UserMicrosoftTeams> =
            await UserMicrosoftTeamsService.findBy({
              query: { projectId: data.projectId, userId: data.userId },
              /*
               * The display name only — never microsoftTeamsUserId, which is
               * the addressable target the bot sends to. Same rule
               * OnCallReadinessService follows.
               */
              select: {
                _id: true,
                microsoftTeamsUserName: true,
                isVerified: true,
                createdAt: true,
              },
              sort: { createdAt: SortOrder.Ascending },
              skip: 0,
              limit: LIMIT_PER_PROJECT,
              props: { isRoot: true },
            });

          return rows.map(
            (row: UserMicrosoftTeams): AdminNotificationMethodView => {
              return this.toView({
                row: row,
                methodType: ReadinessMethodType.MicrosoftTeams,
                isAdminAddable: false,
                identifier: row.microsoftTeamsUserName,
                kind: MaskedIdentifierKind.Handle,
                isVerified: row.isVerified,
              });
            },
          );
        },
        findOwnedRow: async (data: {
          methodId: ObjectID;
          projectId: ObjectID;
          userId: ObjectID;
        }): Promise<AdminNotificationMethodView | null> => {
          const row: UserMicrosoftTeams | null =
            await UserMicrosoftTeamsService.findOneBy({
              query: {
                _id: data.methodId,
                projectId: data.projectId,
                userId: data.userId,
              },
              select: {
                _id: true,
                microsoftTeamsUserName: true,
                isVerified: true,
              },
              props: { isRoot: true },
            });

          return row
            ? this.toView({
                row: row,
                methodType: ReadinessMethodType.MicrosoftTeams,
                isAdminAddable: false,
                identifier: row.microsoftTeamsUserName,
                kind: MaskedIdentifierKind.Handle,
                isVerified: row.isVerified,
              })
            : null;
        },
        deleteRow: async (data: { methodId: ObjectID }): Promise<void> => {
          await UserMicrosoftTeamsService.deleteOneById({
            id: data.methodId,
            props: { isRoot: true },
          });
        },
      },
      {
        methodType: ReadinessMethodType.Webhook,
        isAdminAddable: false,
        modelType: UserWebhook,
        list: async (data: {
          projectId: ObjectID;
          userId: ObjectID;
        }): Promise<Array<AdminNotificationMethodView>> => {
          const rows: Array<UserWebhook> = await UserWebhookService.findBy({
            query: { projectId: data.projectId, userId: data.userId },
            /*
             * `name` ONLY. UserWebhook.webhookUrl is a bearer credential —
             * anyone holding a Slack/Discord/Teams hook url can post as the
             * integration — so it never leaves the server on this path.
             */
            select: { _id: true, name: true, createdAt: true },
            sort: { createdAt: SortOrder.Ascending },
            skip: 0,
            limit: LIMIT_PER_PROJECT,
            props: { isRoot: true },
          });

          return rows.map((row: UserWebhook): AdminNotificationMethodView => {
            return this.toView({
              row: row,
              methodType: ReadinessMethodType.Webhook,
              isAdminAddable: false,
              identifier: row.name,
              kind: MaskedIdentifierKind.Handle,
              /*
               * UserWebhook has no isVerified column: a webhook is live from
               * the moment it is written. Reported as verified because that is
               * what it behaves like, and reporting it as unverified would put
               * a "needs setup" badge on a channel that is already delivering.
               */
              isVerified: true,
            });
          });
        },
        findOwnedRow: async (data: {
          methodId: ObjectID;
          projectId: ObjectID;
          userId: ObjectID;
        }): Promise<AdminNotificationMethodView | null> => {
          const row: UserWebhook | null = await UserWebhookService.findOneBy({
            query: {
              _id: data.methodId,
              projectId: data.projectId,
              userId: data.userId,
            },
            select: { _id: true, name: true },
            props: { isRoot: true },
          });

          return row
            ? this.toView({
                row: row,
                methodType: ReadinessMethodType.Webhook,
                isAdminAddable: false,
                identifier: row.name,
                kind: MaskedIdentifierKind.Handle,
                isVerified: true,
              })
            : null;
        },
        deleteRow: async (data: { methodId: ObjectID }): Promise<void> => {
          await UserWebhookService.deleteOneById({
            id: data.methodId,
            props: { isRoot: true },
          });
        },
      },
    ];
  }

  /*
   * The ONLY place a raw identifier is turned into something this service will
   * return. Every descriptor above routes through it, so there is no code path
   * on which an unmasked value can reach a view object by accident — reaching
   * one would mean deliberately constructing the interface by hand.
   */
  private toView(data: {
    row: BaseModel;
    methodType: ReadinessMethodType;
    isAdminAddable: boolean;
    identifier: string | undefined;
    kind: MaskedIdentifierKind;
    isVerified: boolean | undefined;
  }): AdminNotificationMethodView {
    return {
      methodId: data.row.id!,
      methodType: data.methodType,
      maskedIdentifier: maskIdentifier(data.identifier, data.kind),
      isVerified: Boolean(data.isVerified),
      isAdminAddable: data.isAdminAddable,
      createdAt: data.row.createdAt,
    };
  }

  private getChannelDescriptor(
    methodType: string,
  ): ChannelDescriptor | undefined {
    return this.getChannelDescriptors().find(
      (descriptor: ChannelDescriptor): boolean => {
        return descriptor.methodType === methodType;
      },
    );
  }

  /**
   * Every notification method this user has in this project, masked.
   *
   * Ordered by channel and then by age, so the list an admin reads is stable
   * between visits — a list that reshuffles is a list somebody misreads when
   * they come back to remove the row they saw a moment ago.
   */
  @CaptureSpan()
  public async listMethodsForUser(data: {
    projectId: ObjectID;
    userId: ObjectID;
  }): Promise<Array<AdminNotificationMethodView>> {
    const methods: Array<AdminNotificationMethodView> = [];

    for (const descriptor of this.getChannelDescriptors()) {
      methods.push(
        ...(await descriptor.list({
          projectId: data.projectId,
          userId: data.userId,
        })),
      );
    }

    return methods;
  }

  /**
   * Membership, read straight from TeamMember with root props and no cache.
   *
   * Holding an administrative permission is a claim about a PROJECT, so it can
   * only ever authorise writing for users of that project. Without this, one
   * throwaway project where the caller is an admin would license adding a phone
   * number to any user id in the installation.
   *
   * TeamMemberService.getTeamIdsForUser would answer the same question with one
   * fewer query, but it memoises for 60 seconds — and a security decision that
   * keeps saying "yes" for a minute after somebody was removed from the project
   * is not a security decision.
   *
   * `hasAcceptedInvitation` is part of the test for the same reason
   * UserNotificationRuleAdminService includes it: a pending invitation is an
   * admin-created row for an arbitrary email address, so treating one as
   * membership would hand back most of what this guard takes away.
   */
  @CaptureSpan()
  public async assertTargetUserIsProjectMember(data: {
    targetUserId: ObjectID;
    projectId: ObjectID;
  }): Promise<void> {
    const membership: TeamMember | null = await TeamMemberService.findOneBy({
      query: {
        userId: data.targetUserId,
        projectId: data.projectId,
        hasAcceptedInvitation: true,
      },
      select: { _id: true },
      props: { isRoot: true },
    });

    if (!membership) {
      throw new BadDataException(
        "This user is not a member of this project, so their notification methods cannot be managed here.",
      );
    }
  }

  /**
   * Add a notification method to another member's account.
   *
   * The row is written with the TARGET's userId and with isVerified untouched,
   * which is what makes the method service mail or message a verification code
   * to the address itself. Nothing here can mark it verified, and neither can
   * the administrator afterwards: the verify endpoints compare the row's owner
   * against the signed-in caller.
   *
   * `value` is validated by the type it becomes — Email and Phone both throw
   * BadDataException from their constructors — so a malformed number is
   * refused before any row is written rather than stored and discovered later
   * by a page that fails to deliver.
   */
  @CaptureSpan()
  public async addMethodForUser(data: {
    projectId: ObjectID;
    targetUserId: ObjectID;
    actorUserId: ObjectID | undefined;
    methodType: string;
    value: string;
    props: DatabaseCommonInteractionProps;
  }): Promise<AdminNotificationMethodView> {
    await this.assertTargetUserIsProjectMember({
      targetUserId: data.targetUserId,
      projectId: data.projectId,
    });

    const descriptor: ChannelDescriptor | undefined = this.getChannelDescriptor(
      data.methodType,
    );

    if (!descriptor || !descriptor.create) {
      /*
       * One sentence for "no such channel" and for "that channel exists but an
       * administrator may not create it", because the two are the same answer
       * to the caller and naming which one it was would describe the shape of
       * the feature to somebody probing it.
       */
      throw new BadDataException(
        `A project administrator can only add Email, SMS, Call and WhatsApp notification methods for another user. Push, Telegram, Slack, Microsoft Teams and webhook methods have to be added by the person who owns the device or account.`,
      );
    }

    const trimmed: string = (data.value || "").trim();

    if (!trimmed) {
      throw new BadDataException(
        `A ${descriptor.methodType} notification method needs a value.`,
      );
    }

    /*
     * Adding the same address twice is refused rather than deduplicated. Two
     * identical rows are not merely untidy: they show up as two entries an
     * admin has to tell apart on a masked list, each with its own verification
     * state, and a rule pointed at the unverified one looks correct and pages
     * nobody.
     */
    const existing: Array<AdminNotificationMethodView> = await descriptor.list({
      projectId: data.projectId,
      userId: data.targetUserId,
    });

    const candidateMask: string = maskIdentifier(
      trimmed,
      descriptor.methodType === ReadinessMethodType.Email
        ? MaskedIdentifierKind.Email
        : MaskedIdentifierKind.Phone,
    );

    /*
     * Compared on the MASK, deliberately. The raw values are on the server and
     * could be compared directly, but a duplicate check that reports "this
     * already exists" for a value the admin cannot see is only useful if the
     * thing it matched is the thing they are looking at on screen — and what
     * they are looking at is the mask.
     */
    const isDuplicate: boolean = existing.some(
      (method: AdminNotificationMethodView): boolean => {
        return method.maskedIdentifier === candidateMask;
      },
    );

    if (isDuplicate) {
      throw new BadDataException(
        `This user already has a ${descriptor.methodType} notification method that looks like ${candidateMask}.`,
      );
    }

    const created: AdminNotificationMethodView = await descriptor.create({
      projectId: data.projectId,
      userId: data.targetUserId,
      value: trimmed,
    });

    await this.recordAdminMethodChange({
      action: AuditLogAction.Create,
      actorUserId: data.actorUserId,
      ownerUserId: data.targetUserId,
      projectId: data.projectId,
      methodType: descriptor.methodType,
      modelType: descriptor.modelType,
      methodId: created.methodId,
      isVerified: created.isVerified,
      maskedIdentifier: created.maskedIdentifier,
      props: data.props,
    });

    return created;
  }

  /**
   * What removing this method would cost the person who owns it.
   *
   * Every method foreign key on UserNotificationRule is onDelete: "CASCADE",
   * and each method service deletes the same rows itself in onBeforeDelete, so
   * removing one phone number takes every rule that pointed at it with it. An
   * administrator has even less reason to expect that than the owner does —
   * they are usually tidying up a number they know is dead — so the numbers are
   * put in front of them before they confirm.
   *
   * The row is resolved through the ownership check first, so a caller cannot
   * use this preview to learn anything about a method id belonging to another
   * user or another project.
   */
  @CaptureSpan()
  public async getDeletionPreview(data: {
    projectId: ObjectID;
    targetUserId: ObjectID;
    methodType: string;
    methodId: ObjectID;
  }): Promise<AdminNotificationMethodDeletionPreview> {
    const descriptor: ChannelDescriptor =
      await this.resolveOwnedMethodDescriptor(data);

    const impact: NotificationDeletionImpact =
      await UserNotificationRuleService.getNotificationMethodDeletionImpact({
        projectId: data.projectId,
        methodType: descriptor.methodType,
        methodId: data.methodId,
      });

    return {
      rulesDeletedCount: impact.rulesDeletedCount,
      coverageLostCount: impact.coverageLost.length,
      verifiedMethodCountAfterDeletion: impact.verifiedMethodCountAfterDeletion,
      reachability: impact.reachability,
      isFallbackEnabled: impact.isFallbackEnabled,
      isTruncated: impact.isTruncated,
    };
  }

  /**
   * Remove one of another member's notification methods.
   *
   * Allowed on all seven channels: a device that has been handed back, a number
   * that has been reassigned or a webhook pointing at a decommissioned endpoint
   * are all things an administrator has to be able to clear up, frequently
   * without the owner around to do it.
   *
   * It is also the one operation here that can make somebody LESS reachable, so
   * it is the one that always mails them — including when it leaves them with
   * nothing.
   */
  @CaptureSpan()
  public async deleteMethodForUser(data: {
    projectId: ObjectID;
    targetUserId: ObjectID;
    actorUserId: ObjectID | undefined;
    methodType: string;
    methodId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<void> {
    await this.assertTargetUserIsProjectMember({
      targetUserId: data.targetUserId,
      projectId: data.projectId,
    });

    const descriptor: ChannelDescriptor =
      await this.resolveOwnedMethodDescriptor(data);

    /*
     * Read before the delete, because afterwards there is nothing to read. The
     * mask is the whole description of what the project just lost, and it is
     * the only thing the owner's mail can name.
     */
    const before: AdminNotificationMethodView | null =
      await descriptor.findOwnedRow({
        methodId: data.methodId,
        projectId: data.projectId,
        userId: data.targetUserId,
      });

    await descriptor.deleteRow({ methodId: data.methodId });

    await this.recordAdminMethodChange({
      action: AuditLogAction.Delete,
      actorUserId: data.actorUserId,
      ownerUserId: data.targetUserId,
      projectId: data.projectId,
      methodType: descriptor.methodType,
      modelType: descriptor.modelType,
      methodId: data.methodId,
      isVerified: Boolean(before?.isVerified),
      maskedIdentifier: before?.maskedIdentifier || "",
      props: data.props,
    });
  }

  /**
   * Send the verification code again, to the device.
   *
   * This is the administrator's most useful lever after adding a method, and it
   * discloses nothing: the code goes to the address on the row, which is the
   * one place the admin cannot read. It is how "I added your work mobile,
   * please confirm it" becomes something they can nudge rather than re-type.
   */
  @CaptureSpan()
  public async resendVerificationCodeForUser(data: {
    projectId: ObjectID;
    targetUserId: ObjectID;
    methodType: string;
    methodId: ObjectID;
  }): Promise<void> {
    await this.assertTargetUserIsProjectMember({
      targetUserId: data.targetUserId,
      projectId: data.projectId,
    });

    const descriptor: ChannelDescriptor =
      await this.resolveOwnedMethodDescriptor(data);

    if (!descriptor.resendVerificationCode) {
      throw new BadDataException(
        `${descriptor.methodType} notification methods do not use a verification code.`,
      );
    }

    await descriptor.resendVerificationCode(data.methodId);
  }

  /*
   * "Does this method exist, is it on a channel we know, and does it belong to
   * THIS user in THIS project?" — asked once, by every write path.
   *
   * A row that does not exist and a row belonging to somebody else get the same
   * refusal. In both cases the caller named a row they have no business naming,
   * and a distinguishable answer turns this into a probe for which method ids
   * are real.
   */
  private async resolveOwnedMethodDescriptor(data: {
    projectId: ObjectID;
    targetUserId: ObjectID;
    methodType: string;
    methodId: ObjectID;
  }): Promise<ChannelDescriptor> {
    const descriptor: ChannelDescriptor | undefined = this.getChannelDescriptor(
      data.methodType,
    );

    if (!descriptor) {
      throw new BadDataException(
        "This notification method could not be found for this user.",
      );
    }

    const row: AdminNotificationMethodView | null =
      await descriptor.findOwnedRow({
        methodId: data.methodId,
        projectId: data.projectId,
        userId: data.targetUserId,
      });

    if (!row) {
      throw new BadDataException(
        "This notification method could not be found for this user.",
      );
    }

    return descriptor;
  }

  /*
   * The trail, and the mail. Nothing in here may break the write: the row is
   * already committed by the time this runs, so throwing now would report a
   * failure for a change that happened and the caller would be entitled to
   * believe it did not.
   */
  private async recordAdminMethodChange(data: {
    action: AuditLogAction;
    actorUserId: ObjectID | undefined;
    ownerUserId: ObjectID;
    projectId: ObjectID;
    methodType: ReadinessMethodType;
    modelType: { new (): BaseModel };
    methodId: ObjectID | null | undefined;
    isVerified: boolean;
    maskedIdentifier: string;
    props: DatabaseCommonInteractionProps;
  }): Promise<void> {
    try {
      /*
       * The dependable half. AuditLogService writes only on enterprise builds
       * with audit logs switched on for the project, and "an administrator
       * added a phone number to somebody's account" is exactly the event an
       * operator needs to be able to find on the other installs too.
       */
      logger.info(
        `Notification method ${data.action.toLowerCase()}d for user ${data.ownerUserId.toString()} by ${
          data.actorUserId ? data.actorUserId.toString() : "an unknown actor"
        }.`,
        {
          projectId: data.projectId.toString(),
          userId: data.ownerUserId.toString(),
          actorUserId: data.actorUserId?.toString(),
          methodType: data.methodType,
          action: data.action,
        } as LogAttributes,
      );

      await this.writeAuditLog({
        action: data.action,
        modelType: data.modelType,
        methodId: data.methodId,
        ownerUserId: data.ownerUserId,
        projectId: data.projectId,
        isVerified: data.isVerified,
        props: data.props,
      });

      /*
       * The owner is not mailed about their own action. A person managing their
       * own methods from this page — an owner looking at their own row — has
       * just done the thing the mail would be warning them about.
       */
      if (
        data.actorUserId &&
        data.actorUserId.toString() === data.ownerUserId.toString()
      ) {
        return;
      }

      /*
       * The readiness cache holds this user's method list for 60 seconds, and
       * the page the admin is looking at re-reads readiness the moment this
       * returns. Left alone it would redraw the responder exactly as they were
       * before the change, which reads as "the add did not work".
       */
      OnCallReadinessService.clearCache();

      /*
       * Fire-and-forget by construction: the owner's mail involves three more
       * reads and an SMTP round trip, none of which the writing request should
       * wait on and none of which may surface as a failed write.
       */
      this.notifyOwnerOfAdminChange(data).catch((error: Error): void => {
        logger.error(
          `UserNotificationMethodAdminService: failed to tell user ${data.ownerUserId.toString()} that an administrator changed their notification methods.`,
        );
        logger.error(error);
      });
    } catch (error) {
      logger.error(
        "UserNotificationMethodAdminService: failed to record an administrative notification method change.",
      );
      logger.error(error);
    }
  }

  /**
   * The AuditLog row, written from a BLANK model rather than from the row that
   * changed. That is the whole subtlety of this method.
   *
   * AuditLogService snapshots every column it is handed and redacts only the
   * ones whose column-level `read` list is EMPTY. On UserEmail the address is
   * `read: [Permission.CurrentUser]`, not empty — so handing it the real row
   * would write the raw email address, phone number or webhook name into an
   * analytics table that every project administrator can query. For a removal
   * that address is one the acting admin never saw, which would make the audit
   * trail leak precisely what the page it records was built to hide.
   *
   * So the snapshot carries the three facts that make the entry useful and
   * nothing else: which project, whose account, and whether the method was
   * live. `buildSnapshotChanges` skips undefined columns, so everything else
   * simply is not in the row. WHAT was added or removed is in the message
   * logged above it, masked; WHO did it comes from `props` by way of
   * resolveActor.
   *
   * AuditLogService is required lazily for the same reason DatabaseService
   * requires it lazily: it depends on ProjectService and UserService, both of
   * which extend DatabaseService, so a top-level import can leave the base
   * class undefined at class-extension time.
   */
  private async writeAuditLog(data: {
    action: AuditLogAction;
    modelType: { new (): BaseModel };
    methodId: ObjectID | null | undefined;
    ownerUserId: ObjectID;
    projectId: ObjectID;
    isVerified: boolean;
    props: DatabaseCommonInteractionProps;
  }): Promise<void> {
    const auditLogService: typeof AuditLogServiceType =
      // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
      require("./AuditLogService").default;

    if (!auditLogService) {
      return;
    }

    const snapshot: BaseModel = new data.modelType();

    /*
     * Assigned through an index rather than through typed properties because
     * `snapshot` is a BaseModel here — the three columns are declared on each
     * of the seven concrete classes, not on the base, and casting to one of
     * them would be claiming a type this method deliberately does not know.
     */
    const columns: Record<string, unknown> = snapshot as unknown as Record<
      string,
      unknown
    >;

    if (data.methodId) {
      columns["_id"] = data.methodId.toString();
    }

    columns["projectId"] = data.projectId;
    columns["userId"] = data.ownerUserId;
    columns["isVerified"] = data.isVerified;

    if (data.action === AuditLogAction.Create) {
      await auditLogService.recordCreate({
        model: new data.modelType(),
        createdItem: snapshot,
        props: data.props,
      });

      return;
    }

    /*
     * A deleted method cannot be re-read, so this snapshot is the whole of what
     * the project has left of it. It is also the reason the id is set above: an
     * entry with no resourceId cannot be tied back to the rules that went with
     * it.
     */
    if (data.methodId) {
      await auditLogService.recordDelete({
        model: new data.modelType(),
        deletedItem: snapshot,
        itemId: data.methodId,
        props: data.props,
      });
    }
  }

  /*
   * Tell the person whose account just changed.
   *
   * This is what makes the capability safe to hand out rather than merely
   * possible. An admin adding a colleague's work mobile and an attacker adding
   * a number of their own are the same request from the server's side; the only
   * party who always knows which it was is the account holder.
   */
  private async notifyOwnerOfAdminChange(data: {
    action: AuditLogAction;
    actorUserId: ObjectID | undefined;
    ownerUserId: ObjectID;
    projectId: ObjectID;
    methodType: ReadinessMethodType;
    maskedIdentifier: string;
  }): Promise<void> {
    const owner: User | null = await UserService.findOneById({
      id: data.ownerUserId,
      select: { _id: true, name: true, email: true },
      props: { isRoot: true },
    });

    if (!owner || !owner.email) {
      return;
    }

    let actorDescription: string = "A project administrator";

    if (data.actorUserId) {
      const actor: User | null = await UserService.findOneById({
        id: data.actorUserId,
        select: { _id: true, name: true, email: true },
        props: { isRoot: true },
      });

      /*
       * Named by email as well as by name, deliberately. Display names are not
       * unique and are user-editable, so "Alex added a phone number" is not
       * something the reader can act on; an address is.
       */
      actorDescription = actor
        ? `${actor.name?.toString() || "A project administrator"} (${
            actor.email?.toString() || data.actorUserId.toString()
          })`
        : `A project administrator (${data.actorUserId.toString()})`;
    }

    let projectName: string = "your project";

    const project: Project | null = await ProjectService.findOneById({
      id: data.projectId,
      select: { _id: true, name: true },
      props: { isRoot: true },
    });

    if (project?.name) {
      projectName = project.name;
    }

    const isAdd: boolean = data.action === AuditLogAction.Create;

    const subject: string = isAdd
      ? "A notification method was added to your account"
      : "A notification method was removed from your account";

    /*
     * The two consequences are genuinely different and are worth separate
     * sentences. An addition is inert until the owner verifies it, and saying
     * so is what turns "somebody touched my account" into an instruction. A
     * removal has already happened and may have taken rules with it, which is
     * the only one of the two that can leave a responder silently unreachable.
     */
    const consequence: string = isAdd
      ? "It cannot be used to notify you until you verify it, and only you can do that — a verification code has been sent to the address or device itself. If you were not expecting this, do not verify it, remove it from your notification methods, and tell your project owners."
      : "Any notification rules that used it were removed with it, so you may no longer be paged the way you were. Check your notification methods and rules now, and tell your project owners if you were not expecting this.";

    const message: string = `${this.escapeHtml(actorDescription)} ${
      isAdd ? "added" : "removed"
    } a ${this.escapeHtml(data.methodType)} notification method (${this.escapeHtml(
      data.maskedIdentifier,
    )}) ${isAdd ? "to" : "from"} your account in ${this.escapeHtml(
      projectName,
    )}.<br/><br/>${consequence}`;

    const settingsLink: string = (
      await this.getNotificationMethodsLinkInDashboard(data.projectId)
    ).toString();

    const vars: Dictionary<string> = {
      subject: subject,
      message: `${message}<br/><br/><a href="${this.escapeHtml(
        settingsLink,
      )}">Review your notification methods</a>`,
    };

    await MailService.sendMail(
      {
        toEmail: owner.email,
        templateType: EmailTemplateType.SimpleMessage,
        vars: vars,
        subject: subject,
      },
      {
        projectId: data.projectId,
        userId: owner.id!,
      },
    );
  }

  private async getNotificationMethodsLinkInDashboard(
    projectId: ObjectID,
  ): Promise<URL> {
    const dashboardUrl: URL = await DatabaseConfig.getDashboardUrl();

    /*
     * Spelled out rather than imported: Common/Server cannot reach the
     * Dashboard's RouteMap, the same reason
     * UserNotificationRuleAdminService.getNotificationRulesLinkInDashboard
     * duplicates its path segments.
     */
    return URL.fromString(dashboardUrl.toString()).addRoute(
      `/${projectId.toString()}/user-settings/notification-methods`,
    );
  }

  /*
   * SimpleMessage.hbs renders `message` through a triple-stache InfoBlock
   * partial, so nothing between here and the recipient's inbox escapes
   * anything. Project names and user names are attacker-influenced free text.
   */
  private escapeHtml(value: string): string {
    return value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }
}

export default new UserNotificationMethodAdminService();
