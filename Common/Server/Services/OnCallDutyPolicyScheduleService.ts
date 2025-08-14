import DatabaseService from "./DatabaseService";
import OnCallDutyPolicyScheduleLayerService from "./OnCallDutyPolicyScheduleLayerService";
import OnCallDutyPolicyScheduleLayerUserService from "./OnCallDutyPolicyScheduleLayerUserService";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import CalendarEvent from "../../Types/Calendar/CalendarEvent";
import { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import OneUptimeDate from "../../Types/Date";
import ObjectID from "../../Types/ObjectID";
import LayerUtil, { LayerProps } from "../../Types/OnCallDutyPolicy/Layer";
import OnCallDutyPolicyScheduleLayer from "../../Models/DatabaseModels/OnCallDutyPolicyScheduleLayer";
import OnCallDutyPolicyScheduleLayerUser from "../../Models/DatabaseModels/OnCallDutyPolicyScheduleLayerUser";
import User from "../../Models/DatabaseModels/User";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import OnCallDutyPolicySchedule from "../../Models/DatabaseModels/OnCallDutyPolicySchedule";
import OnCallDutyPolicyEscalationRuleSchedule from "../../Models/DatabaseModels/OnCallDutyPolicyEscalationRuleSchedule";
import OnCallDutyPolicyEscalationRuleScheduleService from "./OnCallDutyPolicyEscalationRuleScheduleService";
import Dictionary from "../../Types/Dictionary";
import { EmailEnvelope } from "../../Types/Email/EmailMessage";
import EmailTemplateType from "../../Types/Email/EmailTemplateType";
import OnCallDutyPolicy from "../../Models/DatabaseModels/OnCallDutyPolicy";
import OnCallDutyPolicyEscalationRule from "../../Models/DatabaseModels/OnCallDutyPolicyEscalationRule";
import UserService from "./UserService";
import OnCallDutyPolicyService from "./OnCallDutyPolicyService";
import { SMSMessage } from "../../Types/SMS/SMS";
import { CallRequestMessage } from "../../Types/Call/CallRequest";
import UserNotificationSettingService from "./UserNotificationSettingService";
import NotificationSettingEventType from "../../Types/NotificationSetting/NotificationSettingEventType";
import BadDataException from "../../Types/Exception/BadDataException";
import Timezone from "../../Types/Timezone";
import logger from "../Utils/Logger";
import OnCallDutyPolicyFeedService from "./OnCallDutyPolicyFeedService";
import { OnCallDutyPolicyFeedEventType } from "../../Models/DatabaseModels/OnCallDutyPolicyFeed";
import { Green500 } from "../../Types/BrandColors";
import OnCallDutyPolicyTimeLogService from "./OnCallDutyPolicyTimeLogService";
import DeleteBy from "../Types/Database/DeleteBy";
import { OnDelete } from "../Types/Database/Hooks";
import PushNotificationMessage from "../../Types/PushNotification/PushNotificationMessage";
import PushNotificationUtil from "../Utils/PushNotificationUtil";

export class Service extends DatabaseService<OnCallDutyPolicySchedule> {
  private layerUtil = new LayerUtil();

  public constructor() {
    super(OnCallDutyPolicySchedule);
  }

  protected override async onBeforeDelete(
    deleteBy: DeleteBy<OnCallDutyPolicySchedule>,
  ): Promise<OnDelete<OnCallDutyPolicySchedule>> {
    const callSchedules: Array<OnCallDutyPolicySchedule> = await this.findBy({
      query: deleteBy.query,
      select: {
        _id: true,
        projectId: true,
      },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    for (const schedule of callSchedules) {
      OnCallDutyPolicyTimeLogService.endTimeForSchedule({
        projectId: schedule.projectId!,
        onCallDutyPolicyScheduleId: schedule.id!,
        endsAt: OneUptimeDate.getCurrentDate(),
      }).catch((err: Error) => {
        logger.error(err);
      });
    }

    return {
      deleteBy: deleteBy,
      carryForward: {},
    };
  }

  public async getOnCallSchedulesWhereUserIsOnCallDuty(data: {
    projectId: ObjectID;
    userId: ObjectID;
  }): Promise<Array<OnCallDutyPolicySchedule>> {
    const schedules: Array<OnCallDutyPolicySchedule> = await this.findBy({
      query: {
        projectId: data.projectId,
        currentUserIdOnRoster: data.userId,
      },
      select: {
        _id: true,
        name: true,
      },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    return schedules;
  }

  private async sendNotificationToUserOnScheduleHandoff(data: {
    scheduleId: ObjectID;
    previousInformation: {
      currentUserIdOnRoster: ObjectID | null;
      rosterHandoffAt: Date | null;
      nextUserIdOnRoster: ObjectID | null;
      nextHandOffTimeAt: Date | null;
      rosterStartAt: Date | null;
      nextRosterStartAt: Date | null;
    };
    newInformation: {
      currentUserIdOnRoster: ObjectID | null;
      rosterHandoffAt: Date | null;
      nextUserIdOnRoster: ObjectID | null;
      nextHandOffTimeAt: Date | null;
      rosterStartAt: Date | null;
      nextRosterStartAt: Date | null;
    };
  }): Promise<void> {
    // Before we send any notification, we need to check if this schedule is attached to any on-call policy.

    const escalationRulesAttachedToSchedule: Array<OnCallDutyPolicyEscalationRuleSchedule> =
      await OnCallDutyPolicyEscalationRuleScheduleService.findBy({
        query: {
          onCallDutyPolicyScheduleId: data.scheduleId,
        },
        select: {
          projectId: true,
          _id: true,
          onCallDutyPolicy: {
            name: true,
            _id: true,
          },
          onCallDutyPolicyEscalationRule: {
            name: true,
            _id: true,
            order: true,
          },
          onCallDutyPolicySchedule: {
            name: true,
            _id: true,
          },
        },
        props: {
          isRoot: true,
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
      });

    if (escalationRulesAttachedToSchedule.length === 0) {
      // do nothing.
      return;
    }

    for (const escalationRule of escalationRulesAttachedToSchedule) {
      const projectId: ObjectID = escalationRule.projectId!;

      const onCallSchedule: OnCallDutyPolicySchedule | undefined =
        escalationRule.onCallDutyPolicySchedule;

      if (!onCallSchedule) {
        continue;
      }

      const onCallPolicy: OnCallDutyPolicy | undefined =
        escalationRule.onCallDutyPolicy;

      if (!onCallPolicy) {
        continue;
      }

      const onCallDutyPolicyEscalationRule:
        | OnCallDutyPolicyEscalationRule
        | undefined = escalationRule.onCallDutyPolicyEscalationRule;

      if (!onCallDutyPolicyEscalationRule) {
        continue;
      }

      const { previousInformation, newInformation } = data;

      // if there's a change, witht he current user, send notification to the new current user.
      // Send notificiation to the new current user.
      if (
        previousInformation.currentUserIdOnRoster?.toString() !==
          newInformation.currentUserIdOnRoster?.toString() ||
        previousInformation.rosterHandoffAt?.toString() !==
          newInformation.rosterHandoffAt?.toString()
      ) {
        if (
          previousInformation.currentUserIdOnRoster?.toString() !==
            newInformation.currentUserIdOnRoster?.toString() &&
          previousInformation.currentUserIdOnRoster?.toString()
        ) {
          // the user has changed. Send notifiction to old user that he has been removed.

          // send notification to the new current user.

          const sendEmailToUserId: ObjectID =
            previousInformation.currentUserIdOnRoster;

          const userTimezone: Timezone | null =
            await UserService.getTimezoneForUser(sendEmailToUserId);

          const vars: Dictionary<string> = {
            onCallPolicyName: onCallPolicy.name || "No name provided",
            escalationRuleName:
              onCallDutyPolicyEscalationRule.name || "No name provided",
            escalationRuleOrder:
              onCallDutyPolicyEscalationRule.order?.toString() || "-",
            reason:
              "Your on-call roster on schedule " +
              onCallSchedule.name +
              " just ended.",
            rosterStartsAt:
              OneUptimeDate.getDateAsFormattedHTMLInMultipleTimezones({
                date: previousInformation.rosterStartAt!,
                timezones: userTimezone ? [userTimezone] : [Timezone.GMT],
              }),
            rosterEndsAt:
              OneUptimeDate.getDateAsFormattedHTMLInMultipleTimezones({
                date: OneUptimeDate.isInTheFuture(
                  previousInformation.rosterHandoffAt!,
                )
                  ? OneUptimeDate.getCurrentDate()
                  : previousInformation.rosterHandoffAt!,
                timezones: userTimezone ? [userTimezone] : [Timezone.GMT],
              }),
            onCallPolicyViewLink: (
              await OnCallDutyPolicyService.getOnCallDutyPolicyLinkInDashboard(
                projectId,
                onCallPolicy.id!,
              )
            ).toString(),
          };

          // current user changed, send alert the new current user.
          const emailMessage: EmailEnvelope = {
            templateType: EmailTemplateType.UserNoLongerActiveOnOnCallRoster,
            vars: vars,
            subject: "You are no longer on-call for " + onCallPolicy.name!,
          };

          const sms: SMSMessage = {
            message: `This is a message from OneUptime. You are no longer on-call for ${onCallPolicy.name!} because your on-call roster on schedule ${onCallSchedule.name} just ended. To unsubscribe from this notification go to User Settings in OneUptime Dashboard.`,
          };

          const callMessage: CallRequestMessage = {
            data: [
              {
                sayMessage: `This is a message from OneUptime. You are no longer on-call for ${onCallPolicy.name!} because your on-call roster on schedule ${onCallSchedule.name} just ended. To unsubscribe from this notification go to User Settings in OneUptime Dashboard.  Good bye.`,
              },
            ],
          };

          const pushMessage: PushNotificationMessage =
            PushNotificationUtil.createGenericNotification({
              title: "On-Call Duty Ended",
              body: `You are no longer on-call for ${onCallPolicy.name!} as your roster on schedule ${onCallSchedule.name} has ended.`,
              tag: "on-call-duty-ended",
              requireInteraction: false,
            });

          await UserNotificationSettingService.sendUserNotification({
            userId: sendEmailToUserId,
            projectId: projectId,
            emailEnvelope: emailMessage,
            smsMessage: sms,
            callRequestMessage: callMessage,
            pushNotificationMessage: pushMessage,
            eventType:
              NotificationSettingEventType.SEND_WHEN_USER_IS_NO_LONGER_ACTIVE_ON_ON_CALL_ROSTER,
            onCallPolicyId: escalationRule.onCallDutyPolicy!.id!,
            onCallPolicyEscalationRuleId:
              escalationRule.onCallDutyPolicyEscalationRule!.id!,
            onCallScheduleId: data.scheduleId,
          });

          // add end log for user.
          OnCallDutyPolicyTimeLogService.endTimeLogForUser({
            userId: sendEmailToUserId,
            onCallDutyPolicyScheduleId: data.scheduleId,
            onCallDutyPolicyEscalationRuleId:
              escalationRule.onCallDutyPolicyEscalationRule!.id!,
            onCallDutyPolicyId: escalationRule.onCallDutyPolicy!.id!,
            projectId: projectId,
            endsAt: OneUptimeDate.getCurrentDate(),
          }).catch((err: Error) => {
            logger.error(
              "Error ending time log for user: " +
                sendEmailToUserId.toString() +
                " for schedule: " +
                data.scheduleId.toString(),
            );
            logger.error(err);
          });

          const onCallDutyPolicyId: ObjectID =
            escalationRule.onCallDutyPolicy!.id!;

          // Send workspace notifiction as well.
          await OnCallDutyPolicyFeedService.createOnCallDutyPolicyFeedItem({
            onCallDutyPolicyId: onCallDutyPolicyId,
            projectId: projectId!,
            onCallDutyPolicyFeedEventType:
              OnCallDutyPolicyFeedEventType.RosterHandoff,
            displayColor: Green500,
            feedInfoInMarkdown: `🚫 **${await UserService.getUserMarkdownString(
              {
                userId: sendEmailToUserId,
                projectId: projectId!,
              },
            )}** is no longer on call for [On-Call Policy ${escalationRule.onCallDutyPolicy?.name}](${(await OnCallDutyPolicyService.getOnCallDutyPolicyLinkInDashboard(projectId!, onCallDutyPolicyId!)).toString()}) escalation rule **${escalationRule.onCallDutyPolicyEscalationRule?.name}** with order **${escalationRule.onCallDutyPolicyEscalationRule?.order}** because your on-call roster on schedule **${onCallSchedule.name}** just ended.`,
            userId: sendEmailToUserId || undefined,
            workspaceNotification: {
              sendWorkspaceNotification: true,
              notifyUserId: undefined,
            },
          });
        }

        if (newInformation.currentUserIdOnRoster?.toString()) {
          // send email to the new current user.
          const sendEmailToUserId: ObjectID =
            newInformation.currentUserIdOnRoster;
          const userTimezone: Timezone | null =
            await UserService.getTimezoneForUser(sendEmailToUserId);

          const vars: Dictionary<string> = {
            onCallPolicyName: onCallPolicy.name || "No name provided",
            escalationRuleName:
              onCallDutyPolicyEscalationRule.name || "No name provided",
            escalationRuleOrder:
              onCallDutyPolicyEscalationRule.order?.toString() || "-",
            reason:
              "You are now on-call for the policy " +
              onCallPolicy.name +
              " because your on-call roster on schedule " +
              onCallSchedule.name,
            rosterStartsAt:
              OneUptimeDate.getDateAsFormattedHTMLInMultipleTimezones({
                date: newInformation.rosterStartAt!,
                timezones: userTimezone ? [userTimezone] : [Timezone.GMT],
              }),
            rosterEndsAt:
              OneUptimeDate.getDateAsFormattedHTMLInMultipleTimezones({
                date: newInformation.rosterHandoffAt!,
                timezones: userTimezone ? [userTimezone] : [Timezone.GMT],
              }),
            onCallPolicyViewLink: (
              await OnCallDutyPolicyService.getOnCallDutyPolicyLinkInDashboard(
                projectId,
                onCallPolicy.id!,
              )
            ).toString(),
          };

          const emailMessage: EmailEnvelope = {
            templateType: EmailTemplateType.UserCurrentlyOnOnCallRoster,
            vars: vars,
            subject: "You are now on-call for " + onCallPolicy.name!,
          };

          const sms: SMSMessage = {
            message: `This is a message from OneUptime. You are now on-call for ${onCallPolicy.name!} because you are now on the roster for schedule ${onCallSchedule.name}. To unsubscribe from this notification go to User Settings in OneUptime Dashboard.`,
          };

          const callMessage: CallRequestMessage = {
            data: [
              {
                sayMessage: `This is a message from OneUptime. You are now on-call for ${onCallPolicy.name!} because you are now on the roster for schedule ${onCallSchedule.name}. To unsubscribe from this notification go to User Settings in OneUptime Dashboard.  Good bye.`,
              },
            ],
          };

          const pushMessage: PushNotificationMessage =
            PushNotificationUtil.createGenericNotification({
              title: "On-Call Duty Started",
              body: `You are now on-call for ${onCallPolicy.name!} on schedule ${onCallSchedule.name}.`,
              tag: "on-call-duty-started",
              requireInteraction: true,
            });

          await UserNotificationSettingService.sendUserNotification({
            userId: sendEmailToUserId,
            projectId: projectId,
            emailEnvelope: emailMessage,
            smsMessage: sms,
            callRequestMessage: callMessage,
            pushNotificationMessage: pushMessage,
            eventType:
              NotificationSettingEventType.SEND_WHEN_USER_IS_ON_CALL_ROSTER,
            onCallPolicyId: escalationRule.onCallDutyPolicy!.id!,
            onCallPolicyEscalationRuleId:
              escalationRule.onCallDutyPolicyEscalationRule!.id!,
            onCallScheduleId: data.scheduleId,
          });

          // add start log for user.
          OnCallDutyPolicyTimeLogService.startTimeLogForUser({
            userId: sendEmailToUserId,
            onCallDutyPolicyScheduleId: data.scheduleId,
            onCallDutyPolicyEscalationRuleId:
              escalationRule.onCallDutyPolicyEscalationRule!.id!,
            onCallDutyPolicyId: escalationRule.onCallDutyPolicy!.id!,
            projectId: projectId,
            startsAt: OneUptimeDate.getCurrentDate(),
          }).catch((err: Error) => {
            logger.error(
              "Error starting time log for user: " +
                sendEmailToUserId.toString() +
                " for schedule: " +
                data.scheduleId.toString(),
            );
            logger.error(err);
          });

          const onCallDutyPolicyId: ObjectID =
            escalationRule.onCallDutyPolicy!.id!;

          // Send workspace notifiction as well.
          await OnCallDutyPolicyFeedService.createOnCallDutyPolicyFeedItem({
            onCallDutyPolicyId: onCallDutyPolicyId,
            projectId: projectId!,
            onCallDutyPolicyFeedEventType:
              OnCallDutyPolicyFeedEventType.RosterHandoff,
            displayColor: Green500,
            feedInfoInMarkdown: `📞 **${await UserService.getUserMarkdownString(
              {
                userId: sendEmailToUserId,
                projectId: projectId!,
              },
            )}** is currently on call for [On-Call Policy ${escalationRule.onCallDutyPolicy?.name}](${(await OnCallDutyPolicyService.getOnCallDutyPolicyLinkInDashboard(projectId!, onCallDutyPolicyId!)).toString()}) escalation rule **${escalationRule.onCallDutyPolicyEscalationRule?.name}** with order **${escalationRule.onCallDutyPolicyEscalationRule?.order}** because of schedule **${onCallSchedule.name}** and your on-call roster starts at **${OneUptimeDate.getDateAsFormattedStringInMultipleTimezones(
              {
                date: newInformation.rosterStartAt!,
                timezones: userTimezone ? [userTimezone] : [Timezone.GMT],
              },
            )}** and ends at **${OneUptimeDate.getDateAsFormattedStringInMultipleTimezones(
              {
                date: newInformation.rosterHandoffAt!,
                timezones: userTimezone ? [userTimezone] : [Timezone.GMT],
              },
            )}**.`,
            userId: sendEmailToUserId || undefined,
            workspaceNotification: {
              sendWorkspaceNotification: true,
              notifyUserId: undefined,
            },
          });
        }
      }

      // send an email to the next user.
      if (
        previousInformation.nextUserIdOnRoster?.toString() !==
          newInformation.nextUserIdOnRoster?.toString() ||
        previousInformation.nextHandOffTimeAt?.toString() !==
          newInformation.nextHandOffTimeAt?.toString() ||
        previousInformation.nextRosterStartAt?.toString() !==
          newInformation.nextRosterStartAt?.toString()
      ) {
        if (newInformation.nextUserIdOnRoster?.toString()) {
          // send email to the next user.
          const sendEmailToUserId: ObjectID = newInformation.nextUserIdOnRoster;
          const userTimezone: Timezone | null =
            await UserService.getTimezoneForUser(sendEmailToUserId);

          const vars: Dictionary<string> = {
            onCallPolicyName: onCallPolicy.name || "No name provided",
            escalationRuleName:
              onCallDutyPolicyEscalationRule.name || "No name provided",
            escalationRuleOrder:
              onCallDutyPolicyEscalationRule.order?.toString() || "-",
            reason:
              "You are next on-call for the policy " +
              onCallPolicy.name +
              " because your on-call roster on schedule " +
              onCallSchedule.name +
              " will start when the next handoff happens.",
            rosterStartsAt:
              OneUptimeDate.getDateAsFormattedHTMLInMultipleTimezones({
                date: newInformation.nextRosterStartAt!,
                timezones: userTimezone ? [userTimezone] : [Timezone.GMT],
              }),
            rosterEndsAt:
              OneUptimeDate.getDateAsFormattedHTMLInMultipleTimezones({
                date: newInformation.nextHandOffTimeAt!,
                timezones: userTimezone ? [userTimezone] : [Timezone.GMT],
              }),
            onCallPolicyViewLink: (
              await OnCallDutyPolicyService.getOnCallDutyPolicyLinkInDashboard(
                projectId,
                onCallPolicy.id!,
              )
            ).toString(),
          };

          const emailMessage: EmailEnvelope = {
            templateType: EmailTemplateType.UserNextOnOnCallRoster,
            vars: vars,
            subject: "You are next on-call for " + onCallPolicy.name!,
          };

          const sms: SMSMessage = {
            message: `This is a message from OneUptime. You are next on-call for ${onCallPolicy.name!} because your on-call roster on schedule ${onCallSchedule.name} will start when the next handoff happens. To unsubscribe from this notification go to User Settings in OneUptime Dashboard.`,
          };

          const callMessage: CallRequestMessage = {
            data: [
              {
                sayMessage: `This is a message from OneUptime. You are next on-call for ${onCallPolicy.name!} because your on-call roster on schedule ${onCallSchedule.name} will start when the next handoff happens. To unsubscribe from this notification go to User Settings in OneUptime Dashboard.  Good bye.`,
              },
            ],
          };

          const pushMessage: PushNotificationMessage =
            PushNotificationUtil.createGenericNotification({
              title: "Next On-Call Duty",
              body: `You are next on-call for ${onCallPolicy.name!} on schedule ${onCallSchedule.name}.`,
              tag: "next-on-call-duty",
              requireInteraction: false,
            });

          await UserNotificationSettingService.sendUserNotification({
            userId: sendEmailToUserId,
            projectId: projectId,
            emailEnvelope: emailMessage,
            smsMessage: sms,
            callRequestMessage: callMessage,
            pushNotificationMessage: pushMessage,
            eventType:
              NotificationSettingEventType.SEND_WHEN_USER_IS_NEXT_ON_CALL_ROSTER,
            onCallPolicyId: escalationRule.onCallDutyPolicy!.id!,
            onCallPolicyEscalationRuleId:
              escalationRule.onCallDutyPolicyEscalationRule!.id!,
            onCallScheduleId: data.scheduleId,
          });

          const onCallDutyPolicyId: ObjectID =
            escalationRule.onCallDutyPolicy!.id!;

          // Send workspace notifiction as well.
          await OnCallDutyPolicyFeedService.createOnCallDutyPolicyFeedItem({
            onCallDutyPolicyId: onCallDutyPolicyId,
            projectId: projectId!,
            onCallDutyPolicyFeedEventType:
              OnCallDutyPolicyFeedEventType.RosterHandoff,
            displayColor: Green500,
            feedInfoInMarkdown: `➡️ **${await UserService.getUserMarkdownString(
              {
                userId: sendEmailToUserId,
                projectId: projectId!,
              },
            )}** is next on call for [On-Call Policy ${escalationRule.onCallDutyPolicy?.name}](${(await OnCallDutyPolicyService.getOnCallDutyPolicyLinkInDashboard(projectId!, onCallDutyPolicyId!)).toString()}) escalation rule **${escalationRule.onCallDutyPolicyEscalationRule?.name}** with order **${escalationRule.onCallDutyPolicyEscalationRule?.order}**. The on-call roster on schedule **${onCallSchedule.name}** will start when the next handoff happens which is at **${OneUptimeDate.getDateAsFormattedStringInMultipleTimezones(
              {
                date: newInformation.nextRosterStartAt!,
                timezones: userTimezone ? [userTimezone] : [Timezone.GMT],
              },
            )}** and will end at **${OneUptimeDate.getDateAsFormattedStringInMultipleTimezones(
              {
                date: newInformation.nextHandOffTimeAt!,
                timezones: userTimezone ? [userTimezone] : [Timezone.GMT],
              },
            )}**.`,
            userId: sendEmailToUserId || undefined,
            workspaceNotification: {
              sendWorkspaceNotification: true,
              notifyUserId: undefined,
            },
          });
        }
      }
    }
  }

  public async refreshCurrentUserIdAndHandoffTimeInSchedule(
    scheduleId: ObjectID,
  ): Promise<{
    currentUserId: ObjectID | null;
    handOffTimeAt: Date | null;
    nextUserId: ObjectID | null;
    nextHandOffTimeAt: Date | null;
    rosterStartAt: Date | null;
    nextRosterStartAt: Date | null;
  }> {
    logger.debug(
      "refreshCurrentUserIdAndHandoffTimeInSchedule called with scheduleId: " +
        scheduleId.toString(),
    );

    // get previoius result.
    logger.debug(
      "Fetching previous schedule information for scheduleId: " +
        scheduleId.toString(),
    );
    const onCallSchedule: OnCallDutyPolicySchedule | null =
      await this.findOneById({
        id: scheduleId,
        select: {
          currentUserIdOnRoster: true,
          rosterHandoffAt: true,
          nextUserIdOnRoster: true,
          rosterNextHandoffAt: true,
          rosterStartAt: true,
          rosterNextStartAt: true,
        },
        props: {
          isRoot: true,
        },
      });

    if (!onCallSchedule) {
      logger.debug(
        "Schedule not found for scheduleId: " + scheduleId.toString(),
      );
      throw new BadDataException("Schedule not found");
    }

    logger.debug(
      "Previous schedule information fetched for scheduleId: " +
        scheduleId.toString(),
    );

    const previousInformation: {
      currentUserIdOnRoster: ObjectID | null;
      rosterHandoffAt: Date | null;
      nextUserIdOnRoster: ObjectID | null;
      nextHandOffTimeAt: Date | null;
      rosterStartAt: Date | null;
      nextRosterStartAt: Date | null;
    } = {
      currentUserIdOnRoster: onCallSchedule.currentUserIdOnRoster || null,
      rosterHandoffAt: onCallSchedule.rosterHandoffAt || null,
      nextUserIdOnRoster: onCallSchedule.nextUserIdOnRoster || null,
      nextHandOffTimeAt: onCallSchedule.rosterNextHandoffAt || null,
      rosterStartAt: onCallSchedule.rosterStartAt || null,
      nextRosterStartAt: onCallSchedule.rosterNextStartAt || null,
    };

    logger.debug(previousInformation);

    logger.debug(
      "Fetching new schedule information for scheduleId: " +
        scheduleId.toString(),
    );

    const newInformation: {
      currentUserId: ObjectID | null;
      handOffTimeAt: Date | null;
      nextUserId: ObjectID | null;
      nextHandOffTimeAt: Date | null;
      rosterStartAt: Date | null;
      nextRosterStartAt: Date | null;
    } = await this.getCurrrentUserIdAndHandoffTimeInSchedule(scheduleId);

    logger.debug(newInformation);

    logger.debug(
      "Updating schedule with new information for scheduleId: " +
        scheduleId.toString(),
    );

    await this.updateOneById({
      id: scheduleId!,
      data: {
        currentUserIdOnRoster: newInformation.currentUserId,
        rosterHandoffAt: newInformation.handOffTimeAt,
        nextUserIdOnRoster: newInformation.nextUserId,
        rosterNextHandoffAt: newInformation.nextHandOffTimeAt,
        rosterStartAt: newInformation.rosterStartAt,
        rosterNextStartAt: newInformation.nextRosterStartAt,
      },
      props: {
        isRoot: true,
        ignoreHooks: true,
      },
    });

    logger.debug(
      "Sending notifications for schedule handoff for scheduleId: " +
        scheduleId.toString(),
    );

    // send notification to the users.
    await this.sendNotificationToUserOnScheduleHandoff({
      scheduleId: scheduleId,
      previousInformation: previousInformation,
      newInformation: {
        currentUserIdOnRoster: newInformation.currentUserId,
        rosterHandoffAt: newInformation.handOffTimeAt,
        nextUserIdOnRoster: newInformation.nextUserId,
        nextHandOffTimeAt: newInformation.nextHandOffTimeAt,
        rosterStartAt: newInformation.rosterStartAt,
        nextRosterStartAt: newInformation.nextRosterStartAt,
      },
    });

    logger.debug(
      "Returning new schedule information for scheduleId: " +
        scheduleId.toString(),
    );

    return newInformation;
  }

  public async getCurrrentUserIdAndHandoffTimeInSchedule(
    scheduleId: ObjectID,
  ): Promise<{
    rosterStartAt: Date | null;
    currentUserId: ObjectID | null;
    handOffTimeAt: Date | null;
    nextUserId: ObjectID | null;
    nextHandOffTimeAt: Date | null;
    nextRosterStartAt: Date | null;
  }> {
    logger.debug(
      "getCurrrentUserIdAndHandoffTimeInSchedule called with scheduleId: " +
        scheduleId.toString(),
    );

    const resultReturn: {
      rosterStartAt: Date | null;
      currentUserId: ObjectID | null;
      handOffTimeAt: Date | null;
      nextUserId: ObjectID | null;
      nextHandOffTimeAt: Date | null;
      nextRosterStartAt: Date | null;
    } = {
      currentUserId: null,
      handOffTimeAt: null,
      nextUserId: null,
      nextHandOffTimeAt: null,
      rosterStartAt: null,
      nextRosterStartAt: null,
    };

    logger.debug("Fetching events for scheduleId: " + scheduleId.toString());
    const events: Array<CalendarEvent> | null =
      await this.getEventByIndexInSchedule({
        scheduleId: scheduleId,
        getNumberOfEvents: 2,
      });

    logger.debug("Events fetched: " + JSON.stringify(events));

    let currentEvent: CalendarEvent | null = events[0] || null;
    let nextEvent: CalendarEvent | null = events[1] || null;

    logger.debug("Current event: " + JSON.stringify(currentEvent));
    logger.debug("Next event: " + JSON.stringify(nextEvent));

    // if the current event start time in the future then the current event is the next event.
    if (currentEvent && OneUptimeDate.isInTheFuture(currentEvent.start)) {
      logger.debug(
        "Current event is in the future, treating it as next event.",
      );
      nextEvent = currentEvent;
      currentEvent = null;
    }

    if (currentEvent) {
      logger.debug("Processing current event: " + JSON.stringify(currentEvent));
      const userId: string | undefined = currentEvent?.title; // this is user id in string.

      if (userId) {
        logger.debug("Current userId: " + userId);
        resultReturn.currentUserId = new ObjectID(userId);
      }

      // get handOffTime
      const handOffTime: Date | undefined = currentEvent?.end; // this is user id in string.
      if (handOffTime) {
        logger.debug("Current handOffTime: " + handOffTime.toISOString());
        resultReturn.handOffTimeAt = handOffTime;
      }

      // get start time
      const startTime: Date | undefined = currentEvent?.start; // this is user id in string.
      if (startTime) {
        logger.debug("Current rosterStartAt: " + startTime.toISOString());
        resultReturn.rosterStartAt = startTime;
      }
    }

    // do the same for next event.

    if (nextEvent) {
      logger.debug("Processing next event: " + JSON.stringify(nextEvent));
      const userId: string | undefined = nextEvent?.title; // this is user id in string.

      if (userId) {
        logger.debug("Next userId: " + userId);
        resultReturn.nextUserId = new ObjectID(userId);
      }

      // get handOffTime
      const handOffTime: Date | undefined = nextEvent?.end; // this is user id in string.
      if (handOffTime) {
        logger.debug("Next handOffTime: " + handOffTime.toISOString());
        resultReturn.nextHandOffTimeAt = handOffTime;
      }

      // get start time
      const startTime: Date | undefined = nextEvent?.start; // this is user id in string.
      if (startTime) {
        logger.debug("Next rosterStartAt: " + startTime.toISOString());
        resultReturn.nextRosterStartAt = startTime;
      }
    }

    logger.debug("Returning result: " + JSON.stringify(resultReturn));
    return resultReturn;
  }

  private async getScheduleLayerProps(data: {
    scheduleId: ObjectID;
  }): Promise<Array<LayerProps>> {
    // get schedule layers.

    const scheduleId: ObjectID = data.scheduleId;

    const layers: Array<OnCallDutyPolicyScheduleLayer> =
      await OnCallDutyPolicyScheduleLayerService.findBy({
        query: {
          onCallDutyPolicyScheduleId: scheduleId,
        },
        select: {
          order: true,
          name: true,
          description: true,
          startsAt: true,
          restrictionTimes: true,
          rotation: true,
          onCallDutyPolicyScheduleId: true,
          projectId: true,
          handOffTime: true,
        },
        sort: {
          order: SortOrder.Ascending,
        },
        props: {
          isRoot: true,
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
      });

    const layerUsers: Array<OnCallDutyPolicyScheduleLayerUser> =
      await OnCallDutyPolicyScheduleLayerUserService.findBy({
        query: {
          onCallDutyPolicyScheduleId: scheduleId,
        },
        select: {
          user: true,
          order: true,
          onCallDutyPolicyScheduleLayerId: true,
        },
        sort: {
          order: SortOrder.Ascending,
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        props: {
          isRoot: true,
        },
      });

    const layerProps: Array<LayerProps> = [];

    for (const layer of layers) {
      layerProps.push({
        users:
          layerUsers
            .filter((layerUser: OnCallDutyPolicyScheduleLayerUser) => {
              return (
                layerUser.onCallDutyPolicyScheduleLayerId?.toString() ===
                layer.id?.toString()
              );
            })
            .map((layerUser: OnCallDutyPolicyScheduleLayerUser) => {
              return layerUser.user!;
            })
            .filter((user: User) => {
              return Boolean(user);
            }) || [],
        startDateTimeOfLayer: layer.startsAt!,
        restrictionTimes: layer.restrictionTimes!,
        rotation: layer.rotation!,
        handOffTime: layer.handOffTime!,
      });
    }

    return layerProps;
  }

  public async getEventByIndexInSchedule(data: {
    scheduleId: ObjectID;
    getNumberOfEvents: number; // which event would you like to get. First event, second event, etc.
  }): Promise<Array<CalendarEvent>> {
    logger.debug(
      "getEventByIndexInSchedule called with data: " + JSON.stringify(data),
    );

    const layerProps: Array<LayerProps> = await this.getScheduleLayerProps({
      scheduleId: data.scheduleId,
    });

    logger.debug("Layer properties fetched: " + JSON.stringify(layerProps));

    if (layerProps.length === 0) {
      logger.debug(
        "No layers found for scheduleId: " + data.scheduleId.toString(),
      );
      return [];
    }

    const currentStartTime: Date = OneUptimeDate.getCurrentDate();
    logger.debug("Current start time: " + currentStartTime.toISOString());

    const currentEndTime: Date = OneUptimeDate.addRemoveYears(
      currentStartTime,
      1,
    );
    logger.debug("Current end time: " + currentEndTime.toISOString());

    const numberOfEventsToGet: number = data.getNumberOfEvents;
    logger.debug("Number of events to get: " + numberOfEventsToGet);

    const events: Array<CalendarEvent> = this.layerUtil.getMultiLayerEvents(
      {
        layers: layerProps,
        calendarStartDate: currentStartTime,
        calendarEndDate: currentEndTime,
      },
      {
        getNumberOfEvents: numberOfEventsToGet,
      },
    );

    logger.debug("Events fetched: " + JSON.stringify(events));

    return events;
  }

  @CaptureSpan()
  public async getCurrentUserIdInSchedule(
    scheduleId: ObjectID,
  ): Promise<ObjectID | null> {
    const layerProps: Array<LayerProps> = await this.getScheduleLayerProps({
      scheduleId: scheduleId,
    });

    if (layerProps.length === 0) {
      return null;
    }

    const currentStartTime: Date = OneUptimeDate.getCurrentDate();
    const currentEndTime: Date = OneUptimeDate.addRemoveSeconds(
      currentStartTime,
      1,
    );

    const events: Array<CalendarEvent> = this.layerUtil.getMultiLayerEvents(
      {
        layers: layerProps,
        calendarStartDate: currentStartTime,
        calendarEndDate: currentEndTime,
      },
      {
        getNumberOfEvents: 1,
      },
    );

    const currentEvent: CalendarEvent | null = events[0] || null;

    if (!currentEvent) {
      return null;
    }

    const userId: string | undefined = currentEvent?.title; // this is user id in string.

    if (!userId) {
      return null;
    }

    return new ObjectID(userId);
  }
}

export default new Service();
