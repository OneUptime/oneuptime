import OnCallDutyPolicy from "../../../Models/DatabaseModels/OnCallDutyPolicy";
import OnCallDutyPolicyExecutionLog from "../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import Project from "../../../Models/DatabaseModels/Project";
import User from "../../../Models/DatabaseModels/User";
import UserNotificationRule from "../../../Models/DatabaseModels/UserNotificationRule";
import UserOnCallLogTimeline from "../../../Models/DatabaseModels/UserOnCallLogTimeline";
import AlertSeverity from "../../../Models/DatabaseModels/AlertSeverity";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import ShortLink from "../../../Models/DatabaseModels/ShortLink";
import URL from "../../../Types/API/URL";
import { ONEUPTIME_PRODUCT_NAME } from "../../../Types/Branding/ProductBranding";
import CallRequest from "../../../Types/Call/CallRequest";
import TwilioConfig from "../../../Types/CallAndSMS/TwilioConfig";
import {
  CustomChannelEvent,
  buildCustomChannelTestPayload,
} from "../../../Types/CustomNotificationChannel/CustomNotificationChannelPayload";
import Dictionary from "../../../Types/Dictionary";
import EmailMessage from "../../../Types/Email/EmailMessage";
import EmailTemplateType from "../../../Types/Email/EmailTemplateType";
import { JSONObject } from "../../../Types/JSON";
import { isCriticalPushNotification } from "../../../Types/NotificationRule/PushNotificationLevel";
import ObjectID from "../../../Types/ObjectID";
import { getOnCallPageStateName } from "../../../Types/OnCallDutyPolicy/OnCallPageWords";
import { OnCallPageChannel } from "../../../Types/OnCallDutyPolicy/OnCallPageChannel";
import {
  getOnCallTestPageCustomChannelOffMessage,
  getOnCallTestPageNotVerifiedMessage,
} from "../../../Types/OnCallDutyPolicy/OnCallTestPageLine";
import {
  OnCallTestPageRecordKind,
  isOnCallTestPageRecordKind,
} from "../../../Types/OnCallDutyPolicy/OnCallTestPage";
import {
  ON_CALL_TEST_PAGE_CALL_ACKNOWLEDGED,
  ON_CALL_TEST_PAGE_CALL_GREETING,
  ON_CALL_TEST_PAGE_CALL_INVALID_INPUT,
  ON_CALL_TEST_PAGE_CALL_NO_INPUT,
  ON_CALL_TEST_PAGE_CALL_PROMPT,
  getOnCallTestPageAcknowledgeLabel,
  getOnCallTestPageAskToAcknowledge,
  getOnCallTestPageCallWhatItTests,
  getOnCallTestPageEmailSubject,
  getOnCallTestPageHeadline,
  getOnCallTestPageSentBy,
  getOnCallTestPageSmsText,
  getOnCallTestPageWhatItTests,
} from "../../../Types/OnCallDutyPolicy/OnCallTestPageWords";
import PushDeviceType from "../../../Types/PushNotification/PushDeviceType";
import PushNotificationMessage from "../../../Types/PushNotification/PushNotificationMessage";
import { DEFAULT_READER_LANGUAGE } from "../../../Types/ReaderLanguage";
import { Translator } from "../../../Types/Translator";
import UserNotificationStatus from "../../../Types/UserNotification/UserNotificationStatus";
import { TwilioMessageKind } from "../../../Utils/Project/TwilioAccount";
import {
  WhatsAppTemplateIds,
  WhatsAppTemplateLanguage,
} from "../../../Types/WhatsApp/WhatsAppTemplates";
import WorkspaceType, {
  getWorkspaceTypeDisplayName,
} from "../../../Types/Workspace/WorkspaceType";
import {
  WorkspaceMessageBlock,
  WorkspacePayloadMarkdown,
} from "../../../Types/Workspace/WorkspaceMessagePayload";
import { mdText } from "../../../Utils/Markdown/FeedMarkdown";
import AlertSeverityService from "../../Services/AlertSeverityService";
import CallService from "../../Services/CallService";
import CustomNotificationChannelDeliveryService from "../../Services/CustomNotificationChannelDeliveryService";
import IncidentSeverityService from "../../Services/IncidentSeverityService";
import MailService from "../../Services/MailService";
import OnCallDutyPolicyExecutionLogService from "../../Services/OnCallDutyPolicyExecutionLogService";
import OnCallDutyPolicyService from "../../Services/OnCallDutyPolicyService";
import ProjectCallSMSConfigService from "../../Services/ProjectCallSMSConfigService";
import ProjectService from "../../Services/ProjectService";
import PushNotificationService from "../../Services/PushNotificationService";
import ShortLinkService from "../../Services/ShortLinkService";
import SmsService from "../../Services/SmsService";
import TelegramService from "../../Services/TelegramService";
import UserOnCallLogTimelineService from "../../Services/UserOnCallLogTimelineService";
import UserService from "../../Services/UserService";
import WebhookService from "../../Services/WebhookService";
import WhatsAppService from "../../Services/WhatsAppService";
import WorkspaceUserNotificationService from "../../Services/WorkspaceUserNotificationService";
import { ExecuteNotificationRuleOptions } from "../../Services/UserNotificationRuleService";
import logger from "../Logger";
import PushNotificationUtil from "../PushNotificationUtil";
import ProductBrandingText from "../ProductBrandingText";
import CaptureSpan from "../Telemetry/CaptureSpan";
import OnCallPageLinks from "./OnCallPageLinks";
import {
  whenNotificationRequestAnswers,
  whenNotificationRequestFails,
  whenSendFails,
} from "./OnCallSendFailure";

/*
 * A TEST PAGE'S MESSAGES, FOR ONE RULE (OnCallTestPage).
 *
 * UserNotificationRuleService hands a rule of a test page here, once it has
 * claimed the rule and checked the methods are the rule owner's own, as it
 * does for every page: what a real page would send on each of the rule's
 * methods, a test sends too - by the same senders, with the same plan,
 * channel and balance rules (an SMS or a call on OneUptime Cloud is paid
 * from the project's balance) - only its words are a test's, TEST first,
 * in the person's language (OnCallTestPageWords), and they carry the links
 * that acknowledge a test.
 *
 * Each message is a row of the person's on-call timeline, as every page's
 * is: "Sending", then what its sender says - sent, or why not - so the
 * test's result reads what happened to each one. A method that is not
 * verified gets the row a real page writes for it, with the same words. A
 * send that fails is handed to the handler of its kind, as every page's
 * is (OnCallSendFailure): Error over Sending only, and nothing at all for
 * a request to the Notification service that got no answer.
 *
 * Returns whether anything was handed to a sender.
 */

// What every message of one test page says, read once for a rule.
export interface OnCallTestPageContext {
  recordKind: OnCallTestPageRecordKind;
  // In the person's language, when it is OneUptime's own default name.
  severityName: string;
  projectName: string;
  isSentBySelf: boolean;
  senderName: string;
  policyName?: string | undefined;
}

export default class OnCallTestPageDelivery {
  @CaptureSpan()
  public static async deliver(data: {
    rule: UserNotificationRule;
    options: ExecuteNotificationRuleOptions;
    translator: Translator;
    // A fresh row of the person's timeline for this rule, as every page writes them.
    newTimelineRow: () => UserOnCallLogTimeline;
  }): Promise<boolean> {
    const rule: UserNotificationRule = data.rule;
    const options: ExecuteNotificationRuleOptions = data.options;

    const context: OnCallTestPageContext = await this.readContext({
      options: options,
      userId: rule.userId,
      translator: data.translator,
    });

    let deliveryAttempted: boolean = false;

    // Everything a send names, beside its row.
    const sendIds: {
      userId: ObjectID;
      onCallPolicyId: ObjectID | undefined;
      onCallPolicyEscalationRuleId: ObjectID | undefined;
      teamId: ObjectID | undefined;
      onCallDutyPolicyExecutionLogTimelineId: ObjectID | undefined;
      onCallScheduleId: ObjectID | undefined;
    } = {
      userId: rule.userId!,
      onCallPolicyId: options.onCallPolicyId,
      onCallPolicyEscalationRuleId: options.onCallPolicyEscalationRuleId,
      teamId: options.userBelongsToTeamId,
      onCallDutyPolicyExecutionLogTimelineId:
        options.onCallDutyPolicyExecutionLogTimelineId,
      onCallScheduleId: options.onCallScheduleId,
    };

    // EMAIL.
    if (rule.userEmail?.email) {
      if (rule.userEmail.isVerified) {
        deliveryAttempted = true;

        const row: UserOnCallLogTimeline = await this.writeSendingRow({
          row: data.newTimelineRow(),
          statusMessage: `Sending email to ${rule.userEmail.email.toString()}`,
          method: { userEmailId: rule.userEmail.id! },
        });

        const emailMessage: Omit<EmailMessage, "toEmail"> =
          await this.getEmailMessage({
            timelineId: row.id!,
            context: context,
            translator: data.translator,
          });

        MailService.sendMail(
          {
            ...emailMessage,
            toEmail: rule.userEmail.email,
          },
          {
            userOnCallLogTimelineId: row.id!,
            projectId: options.projectId,
            ...sendIds,
          },
        )
          .then(
            whenNotificationRequestAnswers({
              userOnCallLogTimelineId: row.id!,
            }),
          )
          .catch(
            whenNotificationRequestFails({
              userOnCallLogTimelineId: row.id!,
              fallbackStatusMessage: "Error sending email.",
            }),
          );
      } else {
        await this.writeErrorRow({
          row: data.newTimelineRow(),
          statusMessage: getOnCallTestPageNotVerifiedMessage({
            channel: OnCallPageChannel.Email,
            address: rule.userEmail.email.toString(),
          }),
          // Names its method, so the test's result says which one, and where.
          method: { userEmailId: rule.userEmail.id! },
        });
      }
    }

    // SMS.
    if (rule.userSms?.phone) {
      if (rule.userSms.isVerified) {
        deliveryAttempted = true;

        const row: UserOnCallLogTimeline = await this.writeSendingRow({
          row: data.newTimelineRow(),
          statusMessage: `Sending SMS to ${rule.userSms.phone.toString()}.`,
          method: { userSmsId: rule.userSms.id! },
        });

        const projectTwilioConfigForSms: TwilioConfig | undefined =
          await ProjectCallSMSConfigService.getProjectDefaultTwilioConfig(
            options.projectId,
            TwilioMessageKind.SMS,
          );

        SmsService.sendSms(
          {
            to: rule.userSms.phone,
            message: await this.getSmsText({
              timelineId: row.id!,
              context: context,
              translator: data.translator,
            }),
          },
          {
            projectId: options.projectId,
            customTwilioConfig: projectTwilioConfigForSms,
            userOnCallLogTimelineId: row.id!,
            ...sendIds,
          },
        )
          .then(
            whenNotificationRequestAnswers({
              userOnCallLogTimelineId: row.id!,
            }),
          )
          .catch(
            whenNotificationRequestFails({
              userOnCallLogTimelineId: row.id!,
              fallbackStatusMessage: "Error sending SMS.",
            }),
          );
      } else {
        await this.writeErrorRow({
          row: data.newTimelineRow(),
          statusMessage: getOnCallTestPageNotVerifiedMessage({
            channel: OnCallPageChannel.SMS,
            address: rule.userSms.phone.toString(),
          }),
          method: { userSmsId: rule.userSms.id! },
        });
      }
    }

    // WHATSAPP: the test message Meta approved.
    if (rule.userWhatsApp?.phone) {
      if (rule.userWhatsApp.isVerified) {
        deliveryAttempted = true;

        const row: UserOnCallLogTimeline = await this.writeSendingRow({
          row: data.newTimelineRow(),
          statusMessage: `Sending WhatsApp message to ${rule.userWhatsApp.phone.toString()}.`,
          method: { userWhatsAppId: rule.userWhatsApp.id! },
        });

        WhatsAppService.sendWhatsAppMessage(
          {
            to: rule.userWhatsApp.phone,
            body: "",
            templateKey: WhatsAppTemplateIds.TestNotification,
            templateVariables: undefined,
            templateLanguageCode:
              WhatsAppTemplateLanguage[WhatsAppTemplateIds.TestNotification] ||
              "en",
          },
          {
            projectId: options.projectId,
            userOnCallLogTimelineId: row.id!,
            ...sendIds,
          },
        )
          .then(
            whenNotificationRequestAnswers({
              userOnCallLogTimelineId: row.id!,
            }),
          )
          .catch(
            whenNotificationRequestFails({
              userOnCallLogTimelineId: row.id!,
              fallbackStatusMessage: "Error sending WhatsApp message.",
            }),
          );
      } else {
        await this.writeErrorRow({
          row: data.newTimelineRow(),
          statusMessage: getOnCallTestPageNotVerifiedMessage({
            channel: OnCallPageChannel.WhatsApp,
            address: rule.userWhatsApp.phone.toString(),
          }),
          method: { userWhatsAppId: rule.userWhatsApp.id! },
        });
      }
    }

    // TELEGRAM.
    if (rule.userTelegram?.telegramChatId) {
      if (rule.userTelegram.isVerified) {
        deliveryAttempted = true;

        const row: UserOnCallLogTimeline = await this.writeSendingRow({
          row: data.newTimelineRow(),
          statusMessage: "Sending Telegram message.",
          method: { userTelegramId: rule.userTelegram.id! },
        });

        TelegramService.sendTelegramMessage(
          {
            to: rule.userTelegram.telegramChatId,
            body: this.getTelegramBody({
              ackUrl: await this.getAcknowledgeShortUrl(row.id!),
              context: context,
              translator: data.translator,
            }),
            parseMode: "HTML",
            disableWebPagePreview: true,
          },
          {
            projectId: options.projectId,
            userOnCallLogTimelineId: row.id!,
            ...sendIds,
          },
        )
          .then(
            whenNotificationRequestAnswers({
              userOnCallLogTimelineId: row.id!,
            }),
          )
          .catch(
            whenNotificationRequestFails({
              userOnCallLogTimelineId: row.id!,
              fallbackStatusMessage: "Error sending Telegram message.",
            }),
          );
      } else {
        await this.writeErrorRow({
          row: data.newTimelineRow(),
          statusMessage: getOnCallTestPageNotVerifiedMessage({
            channel: OnCallPageChannel.Telegram,
          }),
          method: { userTelegramId: rule.userTelegram.id! },
        });
      }
    }

    // SLACK, MICROSOFT TEAMS AND MATTERMOST: a message to the person.
    const workspaceMethods: Array<{
      workspaceType: WorkspaceType;
      channel:
        | OnCallPageChannel.Slack
        | OnCallPageChannel.MicrosoftTeams
        | OnCallPageChannel.Mattermost;
      methodId: ObjectID | undefined;
      workspaceUserId: string | undefined;
      isVerified: boolean | undefined;
      methodColumn: "userSlackId" | "userMicrosoftTeamsId" | "userMattermostId";
    }> = [
      {
        workspaceType: WorkspaceType.Slack,
        channel: OnCallPageChannel.Slack,
        methodId: rule.userSlack?.id || undefined,
        workspaceUserId: rule.userSlack?.slackUserId,
        isVerified: rule.userSlack?.isVerified,
        methodColumn: "userSlackId",
      },
      {
        workspaceType: WorkspaceType.MicrosoftTeams,
        channel: OnCallPageChannel.MicrosoftTeams,
        methodId: rule.userMicrosoftTeams?.id || undefined,
        workspaceUserId: rule.userMicrosoftTeams?.microsoftTeamsUserId,
        isVerified: rule.userMicrosoftTeams?.isVerified,
        methodColumn: "userMicrosoftTeamsId",
      },
      {
        workspaceType: WorkspaceType.Mattermost,
        channel: OnCallPageChannel.Mattermost,
        methodId: rule.userMattermost?.id || undefined,
        workspaceUserId: rule.userMattermost?.mattermostUserId,
        isVerified: rule.userMattermost?.isVerified,
        methodColumn: "userMattermostId",
      },
    ];

    for (const workspaceMethod of workspaceMethods) {
      if (!workspaceMethod.methodId || !workspaceMethod.workspaceUserId) {
        continue;
      }

      const method: Partial<UserOnCallLogTimeline> = {
        [workspaceMethod.methodColumn]: workspaceMethod.methodId,
      };

      const displayName: string = getWorkspaceTypeDisplayName(
        workspaceMethod.workspaceType,
      );

      if (!workspaceMethod.isVerified) {
        await this.writeErrorRow({
          row: data.newTimelineRow(),
          statusMessage: getOnCallTestPageNotVerifiedMessage({
            channel: workspaceMethod.channel,
          }),
          method: method,
        });

        continue;
      }

      deliveryAttempted = true;

      const row: UserOnCallLogTimeline = await this.writeSendingRow({
        row: data.newTimelineRow(),
        statusMessage: `Sending ${displayName} message.`,
        method: method,
      });

      const headline: string = getOnCallTestPageHeadline(
        data.translator,
        ProductBrandingText.getProductName(),
      );

      WorkspaceUserNotificationService.sendDirectMessageToUser({
        projectId: options.projectId,
        workspaceType: workspaceMethod.workspaceType,
        workspaceUserId: workspaceMethod.workspaceUserId,
        messageBlocks: this.getWorkspaceMessageBlocks({
          ackUrl: await this.getAcknowledgeShortUrl(row.id!),
          context: context,
          translator: data.translator,
        }),
        notificationText: headline,
        messageSummary: "On-call notification: test page.",
        userId: rule.userId!,
        userOnCallLogTimelineId: row.id!,
        onCallPolicyId: options.onCallPolicyId,
        onCallPolicyEscalationRuleId: options.onCallPolicyEscalationRuleId,
        teamId: options.userBelongsToTeamId,
        onCallScheduleId: options.onCallScheduleId,
      }).catch(
        whenSendFails({
          userOnCallLogTimelineId: row.id!,
          fallbackStatusMessage: `Error sending ${displayName} message.`,
        }),
      );
    }

    // WEBHOOK: the documented test event, saying it is a test page.
    if (rule.userWebhook?.webhookUrl) {
      deliveryAttempted = true;

      const webhookUrl: string = rule.userWebhook.webhookUrl;

      const row: UserOnCallLogTimeline = await this.writeSendingRow({
        row: data.newTimelineRow(),
        statusMessage: `Sending webhook to ${webhookUrl}.`,
        method: { userWebhookId: rule.userWebhook.id! },
      });

      WebhookService.sendWebhook(
        {
          url: webhookUrl,
          eventType: ON_CALL_TEST_PAGE_WEBHOOK_EVENT,
          payload: this.getWebhookPayload({
            options: options,
            userId: rule.userId!,
            context: context,
            acknowledgeUrl: (
              await OnCallPageLinks.getAcknowledgePageUrl(row.id!)
            ).toString(),
          }),
          secret: rule.userWebhook.secret,
        },
        {
          projectId: options.projectId,
          userOnCallLogTimelineId: row.id!,
          ...sendIds,
        },
      )
        .then(
          whenNotificationRequestAnswers({ userOnCallLogTimelineId: row.id! }),
        )
        .catch(
          whenNotificationRequestFails({
            userOnCallLogTimelineId: row.id!,
            fallbackStatusMessage: "Error sending webhook.",
          }),
        );
    }

    // CALL.
    if (rule.userCall?.phone) {
      if (rule.userCall.isVerified) {
        deliveryAttempted = true;

        const row: UserOnCallLogTimeline = await this.writeSendingRow({
          row: data.newTimelineRow(),
          statusMessage: `Making a call to ${rule.userCall.phone.toString()}.`,
          method: { userCallId: rule.userCall.id! },
        });

        const projectTwilioConfigForCalls: TwilioConfig | undefined =
          await ProjectCallSMSConfigService.getProjectDefaultTwilioConfig(
            options.projectId,
            TwilioMessageKind.Call,
          );

        CallService.makeCall(
          await this.getCallRequest({
            to: rule.userCall.phone,
            timelineId: row.id!,
            context: context,
          }),
          {
            projectId: options.projectId,
            customTwilioConfig: projectTwilioConfigForCalls,
            userOnCallLogTimelineId: row.id!,
            ...sendIds,
          },
        )
          .then(
            whenNotificationRequestAnswers({
              userOnCallLogTimelineId: row.id!,
            }),
          )
          .catch(
            whenNotificationRequestFails({
              userOnCallLogTimelineId: row.id!,
              fallbackStatusMessage: "Error making call.",
            }),
          );
      } else {
        await this.writeErrorRow({
          row: data.newTimelineRow(),
          statusMessage: getOnCallTestPageNotVerifiedMessage({
            channel: OnCallPageChannel.Call,
            address: rule.userCall.phone.toString(),
          }),
          method: { userCallId: rule.userCall.id! },
        });
      }
    }

    /*
     * CUSTOM CHANNEL: the documented test payload (CustomChannelEvent.Test),
     * so a channel's service needs nothing new to receive it. It carries
     * nothing to act on, so a test is not acknowledged from it.
     */
    const customChannelId: ObjectID | undefined =
      rule.customNotificationChannelId ||
      rule.customNotificationChannel?.id ||
      undefined;

    if (customChannelId) {
      const channelName: string =
        rule.customNotificationChannel?.name || "the custom channel";

      if (rule.customNotificationChannel?.isEnabled) {
        deliveryAttempted = true;

        const row: UserOnCallLogTimeline = await this.writeSendingRow({
          row: data.newTimelineRow(),
          statusMessage: `Sending to ${channelName}.`,
          method: {
            customNotificationChannelId: customChannelId,
          },
        });

        const person: User | null = await this.readPerson(rule.userId);

        CustomNotificationChannelDeliveryService.send({
          customNotificationChannelId: customChannelId,
          eventType: CustomChannelEvent.Test,
          payload: buildCustomChannelTestPayload({
            sentAt: new Date(),
            channel: {
              id: customChannelId.toString(),
              name: rule.customNotificationChannel?.name || "",
            },
            user: {
              id: rule.userId!.toString(),
              name: person?.name?.toString() || "",
              email: person?.email?.toString() || "",
            },
            project: {
              id: options.projectId.toString(),
              name: context.projectName,
            },
          }),
          projectId: options.projectId,
          userOnCallLogTimelineId: row.id!,
        }).catch(
          whenNotificationRequestFails({
            userOnCallLogTimelineId: row.id!,
            fallbackStatusMessage: `Error sending to ${channelName}.`,
          }),
        );
      } else if (rule.customNotificationChannel) {
        await this.writeErrorRow({
          row: data.newTimelineRow(),
          statusMessage: getOnCallTestPageCustomChannelOffMessage(channelName),
          method: {
            customNotificationChannelId: customChannelId,
          },
        });
      }
    }

    // PUSH: rings through silent mode exactly as the real page of this rule would.
    if (rule.userPush?.deviceToken) {
      if (rule.userPush.isVerified) {
        deliveryAttempted = true;

        const row: UserOnCallLogTimeline = await this.writeSendingRow({
          row: data.newTimelineRow(),
          statusMessage: "Sending push notification to device.",
          method: { userPushId: rule.userPush.id! },
        });

        const pushMessage: PushNotificationMessage = this.getPushMessage({
          context: context,
          translator: data.translator,
          acknowledgeUrl: (
            await OnCallPageLinks.getAcknowledgePageUrl(row.id!)
          ).toString(),
        });

        pushMessage.isCriticalAlert = isCriticalPushNotification({
          pushNotificationLevel: rule.pushNotificationLevel,
          isDeviceCriticalAlertEnabled: rule.userPush.isCriticalAlertEnabled,
        });
        pushMessage.criticalAlertSound = rule.userPush.criticalAlertSound;
        pushMessage.criticalAlertVolume = rule.userPush.criticalAlertVolume;

        PushNotificationService.sendPushNotification(
          {
            devices: [
              {
                token: rule.userPush.deviceToken,
                ...(rule.userPush.deviceName && {
                  name: rule.userPush.deviceName,
                }),
              },
            ],
            message: pushMessage,
            deviceType: rule.userPush.deviceType! as PushDeviceType,
          },
          {
            projectId: options.projectId,
            userOnCallLogTimelineId: row.id!,
            ...sendIds,
          },
        ).catch(
          whenSendFails({
            userOnCallLogTimelineId: row.id!,
            fallbackStatusMessage: "Error sending push notification.",
          }),
        );
      } else {
        await this.writeErrorRow({
          row: data.newTimelineRow(),
          statusMessage:
            PushNotificationService.getNotSentToUnverifiedDeviceMessage(
              rule.userPush.deviceType,
            ),
          method: { userPushId: rule.userPush.id! },
        });
      }
    }

    return deliveryAttempted;
  }

  /*
   * What every message of the test says, read once for the rule: the kind
   * and severity it stands in for, the project, who sent it and, for a
   * policy's test, the policy. Best effort: a value that cannot be read
   * leaves a sentence plainer, and the test is still sent.
   */
  public static async readContext(data: {
    options: ExecuteNotificationRuleOptions;
    userId: ObjectID | undefined;
    translator: Translator;
  }): Promise<OnCallTestPageContext> {
    const context: OnCallTestPageContext = {
      recordKind: OnCallTestPageRecordKind.Incident,
      severityName: "",
      projectName: "",
      isSentBySelf: false,
      senderName: "",
    };

    try {
      const run: OnCallDutyPolicyExecutionLog | null = data.options
        .onCallPolicyExecutionLogId
        ? await OnCallDutyPolicyExecutionLogService.findOneById({
            id: data.options.onCallPolicyExecutionLogId,
            select: {
              _id: true,
              testPageRecordKind: true,
              testPageSeverityId: true,
              // Who sent the test: the person its run was created for.
              createdByUserId: true,
              onCallDutyPolicyId: true,
            },
            props: {
              isRoot: true,
            },
          })
        : null;

      if (run && isOnCallTestPageRecordKind(run.testPageRecordKind)) {
        context.recordKind = run.testPageRecordKind;
      }

      if (run?.testPageSeverityId) {
        context.severityName = getOnCallPageStateName(
          data.translator,
          await this.readSeverityName({
            recordKind: context.recordKind,
            severityId: run.testPageSeverityId,
          }),
        );
      }

      /*
       * The sender is named even to themselves: a policy's test says who
       * is testing it ("Ana Lopez is testing the on-call policy Primary").
       */
      if (run?.createdByUserId) {
        context.isSentBySelf =
          Boolean(data.userId) &&
          run.createdByUserId.toString() === data.userId!.toString();

        const sender: User | null = await this.readPerson(run.createdByUserId);
        context.senderName =
          sender?.name?.toString() || sender?.email?.toString() || "";
      }

      if (run?.onCallDutyPolicyId) {
        const policy: OnCallDutyPolicy | null =
          await OnCallDutyPolicyService.findOneById({
            id: run.onCallDutyPolicyId,
            select: {
              name: true,
            },
            props: {
              isRoot: true,
            },
          });

        context.policyName = policy?.name?.toString() || undefined;
      }

      const project: Project | null = await ProjectService.findOneById({
        id: data.options.projectId,
        select: {
          name: true,
        },
        props: {
          isRoot: true,
        },
      });

      context.projectName = project?.name?.toString() || "";
    } catch (err) {
      logger.error(
        `Could not read everything a test page's messages say for UserOnCallLog ${data.options.userNotificationLogId.toString()}; sending it with what was read.`,
      );
      logger.error(err as Error);
    }

    return context;
  }

  private static async readSeverityName(data: {
    recordKind: OnCallTestPageRecordKind;
    severityId: ObjectID;
  }): Promise<string> {
    const severity: IncidentSeverity | AlertSeverity | null =
      data.recordKind === OnCallTestPageRecordKind.Alert
        ? await AlertSeverityService.findOneById({
            id: data.severityId,
            select: {
              name: true,
            },
            props: {
              isRoot: true,
            },
          })
        : await IncidentSeverityService.findOneById({
            id: data.severityId,
            select: {
              name: true,
            },
            props: {
              isRoot: true,
            },
          });

    return severity?.name?.toString() || "";
  }

  private static async readPerson(
    userId: ObjectID | undefined,
  ): Promise<User | null> {
    if (!userId) {
      return null;
    }

    try {
      return await UserService.findOneById({
        id: userId,
        select: {
          name: true,
          email: true,
        },
        props: {
          isRoot: true,
        },
      });
    } catch (err) {
      logger.error(err as Error);
      return null;
    }
  }

  // The project name and severity, when one was not read: still a sentence.
  private static getWhatItTests(
    context: OnCallTestPageContext,
    translator: Translator,
  ): string {
    return getOnCallTestPageWhatItTests(translator, {
      recordKind: context.recordKind,
      projectName: context.projectName || ProductBrandingText.getProductName(),
      severityName: context.severityName || "-",
    });
  }

  // The test's email: TEST first, what it tests, who sent it, and Acknowledge.
  public static async getEmailMessage(data: {
    timelineId: ObjectID;
    context: OnCallTestPageContext;
    translator: Translator;
  }): Promise<Omit<EmailMessage, "toEmail">> {
    const vars: Dictionary<string> = {
      productName: ProductBrandingText.getProductName(),
      projectName: data.context.projectName,
      whatItTests: this.getWhatItTests(data.context, data.translator),
      sentBy: getOnCallTestPageSentBy(data.translator, {
        isSentBySelf: data.context.isSentBySelf,
        senderName: data.context.senderName,
        policyName: data.context.policyName,
      }),
      acknowledgeLink: (
        await OnCallPageLinks.getEmailAcknowledgePageUrl(data.timelineId)
      ).toString(),
    };

    return {
      templateType: EmailTemplateType.OnCallTestPage,
      vars: vars,
      subject: getOnCallTestPageEmailSubject(
        data.translator,
        data.context.projectName || ProductBrandingText.getProductName(),
      ),
      isSubjectLiteral: true,
      ...(data.translator.language === DEFAULT_READER_LANGUAGE
        ? {}
        : { language: data.translator.language }),
    };
  }

  /*
   * The test's text message: written with OneUptime as the sender, as every
   * SMS is - the Notification service puts the installation's own name in
   * its place - with the short link that acknowledges it.
   */
  public static async getSmsText(data: {
    timelineId: ObjectID;
    context: OnCallTestPageContext;
    translator: Translator;
  }): Promise<string> {
    return getOnCallTestPageSmsText(data.translator, {
      productName: ONEUPTIME_PRODUCT_NAME,
      projectName: cutToLength(
        data.context.projectName || ONEUPTIME_PRODUCT_NAME,
        SMS_PROJECT_NAME_MAX_LENGTH,
      ),
      link: (await this.getAcknowledgeShortUrl(data.timelineId)).toString(),
    });
  }

  // The test's Telegram message, as HTML.
  public static getTelegramBody(data: {
    ackUrl: URL;
    context: OnCallTestPageContext;
    translator: Translator;
  }): string {
    const sentBy: string = getOnCallTestPageSentBy(data.translator, {
      isSentBySelf: data.context.isSentBySelf,
      senderName: data.context.senderName,
      policyName: data.context.policyName,
    });

    const lines: Array<string> = [
      `🧪 <b>${escapeTelegramHtml(getOnCallTestPageHeadline(data.translator, ProductBrandingText.getProductName()))}</b>`,
      "",
      escapeTelegramHtml(this.getWhatItTests(data.context, data.translator)),
    ];

    if (sentBy) {
      lines.push("", `👤 ${escapeTelegramHtml(sentBy)}`);
    }

    lines.push(
      "",
      escapeTelegramHtml(getOnCallTestPageAskToAcknowledge(data.translator)),
      `✅ <a href="${escapeTelegramHtml(data.ackUrl.toString())}">${escapeTelegramHtml(getOnCallTestPageAcknowledgeLabel(data.translator))}</a>`,
    );

    return lines.join("\n");
  }

  // The test's Slack, Microsoft Teams or Mattermost message, as Markdown.
  public static getWorkspaceMessageBlocks(data: {
    ackUrl: URL;
    context: OnCallTestPageContext;
    translator: Translator;
  }): Array<WorkspaceMessageBlock> {
    const sentBy: string = getOnCallTestPageSentBy(data.translator, {
      isSentBySelf: data.context.isSentBySelf,
      senderName: data.context.senderName,
      policyName: data.context.policyName,
    });

    const lines: Array<string> = [
      mdText`🧪 **${getOnCallTestPageHeadline(data.translator, ProductBrandingText.getProductName())}**`.toString(),
      "",
      mdText`${this.getWhatItTests(data.context, data.translator)}`.toString(),
    ];

    if (sentBy) {
      lines.push("", mdText`👤 ${sentBy}`.toString());
    }

    lines.push(
      "",
      mdText`${getOnCallTestPageAskToAcknowledge(data.translator)}`.toString(),
      "",
      mdText`✅ [${getOnCallTestPageAcknowledgeLabel(data.translator)}](${data.ackUrl.toString()})`.toString(),
    );

    const markdownBlock: WorkspacePayloadMarkdown = {
      _type: "WorkspacePayloadMarkdown",
      text: lines.join("\n"),
    };

    return [markdownBlock];
  }

  /*
   * The test's push: TEST first, and what it tests. Tapping it opens the
   * page that acknowledges it in a browser; the On-Call app has no record to
   * open, so it offers none of a page's buttons (no category).
   */
  public static getPushMessage(data: {
    context: OnCallTestPageContext;
    translator: Translator;
    acknowledgeUrl: string;
  }): PushNotificationMessage {
    return PushNotificationUtil.createGenericNotification({
      title: getOnCallTestPageHeadline(data.translator, ONEUPTIME_PRODUCT_NAME),
      body: this.getWhatItTests(data.context, data.translator),
      clickAction: data.acknowledgeUrl,
      tag: "oneuptime-test-page",
      requireInteraction: false,
    });
  }

  // The test's call: in English, as every call is; 1 acknowledges it.
  public static async getCallRequest(data: {
    to: CallRequest["to"];
    timelineId: ObjectID;
    context: OnCallTestPageContext;
  }): Promise<CallRequest> {
    return {
      to: data.to,
      data: [
        {
          sayMessage: ON_CALL_TEST_PAGE_CALL_GREETING,
        },
        {
          sayMessage: getOnCallTestPageCallWhatItTests({
            recordKind: data.context.recordKind,
            projectName: data.context.projectName || ONEUPTIME_PRODUCT_NAME,
            severityName: data.context.severityName || "-",
          }),
        },
        {
          introMessage: ON_CALL_TEST_PAGE_CALL_PROMPT,
          numDigits: 1,
          timeoutInSeconds: 10,
          noInputMessage: ON_CALL_TEST_PAGE_CALL_NO_INPUT,
          onInputCallRequest: {
            "1": {
              sayMessage: ON_CALL_TEST_PAGE_CALL_ACKNOWLEDGED,
            },
            default: {
              sayMessage: ON_CALL_TEST_PAGE_CALL_INVALID_INPUT,
            },
          },
          responseUrl: await OnCallPageLinks.getCallResponseUrl(
            data.timelineId,
          ),
        },
      ],
    };
  }

  // The test's webhook body: the documented test event, with what it tests.
  public static getWebhookPayload(data: {
    options: ExecuteNotificationRuleOptions;
    userId: ObjectID;
    context: OnCallTestPageContext;
    acknowledgeUrl: string;
  }): JSONObject {
    return {
      eventType: ON_CALL_TEST_PAGE_WEBHOOK_EVENT,
      timestamp: new Date().toISOString(),
      projectId: data.options.projectId.toString(),
      userId: data.userId.toString(),
      isTestPage: true,
      testPage: {
        executionLogId:
          data.options.onCallPolicyExecutionLogId?.toString() || null,
        recordKind: data.context.recordKind,
        severity: data.context.severityName || null,
        acknowledgeUrl: data.acknowledgeUrl,
      },
      onCallPolicyId: data.options.onCallPolicyId?.toString() || null,
      onCallPolicyEscalationRuleId:
        data.options.onCallPolicyEscalationRuleId?.toString() || null,
    };
  }

  // The short link of a message's acknowledge page.
  private static async getAcknowledgeShortUrl(
    timelineId: ObjectID,
  ): Promise<URL> {
    const shortLink: ShortLink = await ShortLinkService.saveShortLinkFor(
      await OnCallPageLinks.getAcknowledgePageUrl(timelineId),
    );

    return await ShortLinkService.getShortenedUrl(shortLink);
  }

  // A message on its way out: its row, Sending, naming its method.
  private static async writeSendingRow(data: {
    row: UserOnCallLogTimeline;
    statusMessage: string;
    method: Partial<UserOnCallLogTimeline>;
  }): Promise<UserOnCallLogTimeline> {
    Object.assign(data.row, data.method);
    data.row.status = UserNotificationStatus.Sending;
    data.row.statusMessage = data.statusMessage;

    return await UserOnCallLogTimelineService.create({
      data: data.row,
      props: {
        isRoot: true,
      },
    });
  }

  // A message that is not sent, and why: an Error row, as a real page writes.
  private static async writeErrorRow(data: {
    row: UserOnCallLogTimeline;
    statusMessage: string;
    method?: Partial<UserOnCallLogTimeline> | undefined;
  }): Promise<void> {
    if (data.method) {
      Object.assign(data.row, data.method);
    }

    data.row.status = UserNotificationStatus.Error;
    data.row.statusMessage = data.statusMessage;

    await UserOnCallLogTimelineService.create({
      data: data.row,
      props: {
        isRoot: true,
      },
    });
  }
}

/*
 * The eventType a test page's webhook carries: the documented test event
 * (notifications/notification-methods), so an endpoint already ready for
 * Send Test needs nothing new; isTestPage and testPage say it is a page.
 */
export const ON_CALL_TEST_PAGE_WEBHOOK_EVENT: string = "test";

// The longest project name a test's text message carries.
export const SMS_PROJECT_NAME_MAX_LENGTH: number = 40;

const cutToLength: (text: string, maxLength: number) => string = (
  text: string,
  maxLength: number,
): string => {
  const trimmed: string = text.trim();

  if (trimmed.length <= maxLength) {
    return trimmed;
  }

  return `${trimmed.substring(0, maxLength - 1).trimEnd()}…`;
};

const escapeTelegramHtml: (value: string) => string = (
  value: string,
): string => {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
};
