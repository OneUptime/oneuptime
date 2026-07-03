import RunCron from "../../Utils/Cron";
import { CallRequestMessage } from "Common/Types/Call/CallRequest";
import Dictionary from "Common/Types/Dictionary";
import { EmailEnvelope } from "Common/Types/Email/EmailMessage";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import NotificationSettingEventType from "Common/Types/NotificationSetting/NotificationSettingEventType";
import ObjectID from "Common/Types/ObjectID";
import { SMSMessage } from "Common/Types/SMS/SMS";
import PushNotificationMessage from "Common/Types/PushNotification/PushNotificationMessage";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import OnCallDutyPolicyScheduleOwnerTeamService from "Common/Server/Services/OnCallDutyPolicyScheduleOwnerTeamService";
import OnCallDutyPolicyScheduleOwnerUserService from "Common/Server/Services/OnCallDutyPolicyScheduleOwnerUserService";
import OnCallDutyPolicyScheduleService from "Common/Server/Services/OnCallDutyPolicyScheduleService";
import TeamMemberService from "Common/Server/Services/TeamMemberService";
import UserNotificationSettingService from "Common/Server/Services/UserNotificationSettingService";
import PushNotificationUtil from "Common/Server/Utils/PushNotificationUtil";
import { createWhatsAppMessageFromTemplate } from "Common/Server/Utils/WhatsAppTemplateUtil";
import { WhatsAppMessagePayload } from "Common/Types/WhatsApp/WhatsAppMessage";
import OnCallDutyPolicySchedule from "Common/Models/DatabaseModels/OnCallDutyPolicySchedule";
import OnCallDutyPolicyScheduleOwnerTeam from "Common/Models/DatabaseModels/OnCallDutyPolicyScheduleOwnerTeam";
import OnCallDutyPolicyScheduleOwnerUser from "Common/Models/DatabaseModels/OnCallDutyPolicyScheduleOwnerUser";
import User from "Common/Models/DatabaseModels/User";

RunCron(
  "OnCallDutyPolicyScheduleOwner:SendOwnerAddedEmail",
  { schedule: EVERY_MINUTE, runOnStartup: false },
  async () => {
    const onCallDutyPolicyScheduleOwnerTeams: Array<OnCallDutyPolicyScheduleOwnerTeam> =
      await OnCallDutyPolicyScheduleOwnerTeamService.findAllBy({
        query: {
          isOwnerNotified: false,
        },
        props: {
          isRoot: true,
        },
        select: {
          _id: true,
          onCallDutyPolicyScheduleId: true,
          teamId: true,
        },
      });

    const onCallDutyPolicyScheduleOwnersMap: Dictionary<Array<User>> = {};

    for (const onCallDutyPolicyScheduleOwnerTeam of onCallDutyPolicyScheduleOwnerTeams) {
      const onCallDutyPolicyScheduleId: ObjectID =
        onCallDutyPolicyScheduleOwnerTeam.onCallDutyPolicyScheduleId!;
      const teamId: ObjectID = onCallDutyPolicyScheduleOwnerTeam.teamId!;

      const users: Array<User> = await TeamMemberService.getUsersInTeams([
        teamId,
      ]);

      if (
        onCallDutyPolicyScheduleOwnersMap[
          onCallDutyPolicyScheduleId.toString()
        ] === undefined
      ) {
        onCallDutyPolicyScheduleOwnersMap[
          onCallDutyPolicyScheduleId.toString()
        ] = [];
      }

      for (const user of users) {
        (
          onCallDutyPolicyScheduleOwnersMap[
            onCallDutyPolicyScheduleId.toString()
          ] as Array<User>
        ).push(user);
      }

      // mark this as notified.
      await OnCallDutyPolicyScheduleOwnerTeamService.updateOneById({
        id: onCallDutyPolicyScheduleOwnerTeam.id!,
        data: {
          isOwnerNotified: true,
        },
        props: {
          isRoot: true,
        },
      });
    }

    const onCallDutyPolicyScheduleOwnerUsers: Array<OnCallDutyPolicyScheduleOwnerUser> =
      await OnCallDutyPolicyScheduleOwnerUserService.findAllBy({
        query: {
          isOwnerNotified: false,
        },
        props: {
          isRoot: true,
        },
        select: {
          _id: true,
          onCallDutyPolicyScheduleId: true,
          userId: true,
          user: {
            email: true,
            name: true,
          },
        },
      });

    for (const onCallDutyPolicyScheduleOwnerUser of onCallDutyPolicyScheduleOwnerUsers) {
      const onCallDutyPolicyScheduleId: ObjectID =
        onCallDutyPolicyScheduleOwnerUser.onCallDutyPolicyScheduleId!;
      const user: User = onCallDutyPolicyScheduleOwnerUser.user!;

      if (
        onCallDutyPolicyScheduleOwnersMap[
          onCallDutyPolicyScheduleId.toString()
        ] === undefined
      ) {
        onCallDutyPolicyScheduleOwnersMap[
          onCallDutyPolicyScheduleId.toString()
        ] = [];
      }

      (
        onCallDutyPolicyScheduleOwnersMap[
          onCallDutyPolicyScheduleId.toString()
        ] as Array<User>
      ).push(user);

      // mark this as notified.
      await OnCallDutyPolicyScheduleOwnerUserService.updateOneById({
        id: onCallDutyPolicyScheduleOwnerUser.id!,
        data: {
          isOwnerNotified: true,
        },
        props: {
          isRoot: true,
        },
      });
    }

    // send email to all of these users.

    for (const onCallDutyPolicyScheduleId in onCallDutyPolicyScheduleOwnersMap) {
      if (!onCallDutyPolicyScheduleOwnersMap[onCallDutyPolicyScheduleId]) {
        continue;
      }

      if (
        (
          onCallDutyPolicyScheduleOwnersMap[
            onCallDutyPolicyScheduleId
          ] as Array<User>
        ).length === 0
      ) {
        continue;
      }

      const users: Array<User> = onCallDutyPolicyScheduleOwnersMap[
        onCallDutyPolicyScheduleId
      ] as Array<User>;

      const onCallDutyPolicySchedule: OnCallDutyPolicySchedule | null =
        await OnCallDutyPolicyScheduleService.findOneById({
          id: new ObjectID(onCallDutyPolicyScheduleId),
          props: {
            isRoot: true,
          },

          select: {
            _id: true,
            name: true,
            description: true,
            projectId: true,
            project: {
              name: true,
            },
          },
        });

      if (!onCallDutyPolicySchedule) {
        continue;
      }

      const viewScheduleLink: string = (
        await OnCallDutyPolicyScheduleService.getLinkInDashboard(
          onCallDutyPolicySchedule.projectId!,
          onCallDutyPolicySchedule.id!,
        )
      ).toString();

      const vars: Dictionary<string> = {
        scheduleName: onCallDutyPolicySchedule.name!,
        scheduleDescription:
          onCallDutyPolicySchedule.description || "No description provided",
        projectName: onCallDutyPolicySchedule.project!.name!,
        viewScheduleLink: viewScheduleLink,
      };

      for (const user of users) {
        const emailMessage: EmailEnvelope = {
          templateType: EmailTemplateType.OnCallDutyPolicyScheduleOwnerAdded,
          vars: vars,
          subject:
            "[On-Call Schedule] Owner of " + onCallDutyPolicySchedule.name,
        };

        const sms: SMSMessage = {
          message: `This is a message from OneUptime. You have been added as the owner of the on-call schedule: ${onCallDutyPolicySchedule.name!}. To unsubscribe from this notification go to User Settings in OneUptime Dashboard.`,
        };

        const callMessage: CallRequestMessage = {
          data: [
            {
              sayMessage: `This is a message from OneUptime. You have been added as the owner of the on-call schedule: ${onCallDutyPolicySchedule.name!}. To unsubscribe from this notification go to User Settings in OneUptime Dashboard.  Good bye.`,
            },
          ],
        };

        const pushMessage: PushNotificationMessage =
          PushNotificationUtil.createGenericNotification({
            title: "Added as On-Call Schedule Owner",
            body: `You have been added as the owner of the on-call schedule: ${onCallDutyPolicySchedule.name!}. Click to view details.`,
            clickAction: viewScheduleLink,
            tag: "on-call-schedule-owner-added",
            requireInteraction: false,
          });

        const eventType: NotificationSettingEventType =
          NotificationSettingEventType.SEND_ON_CALL_DUTY_POLICY_SCHEDULE_OWNER_ADDED_NOTIFICATION;

        const whatsAppMessage: WhatsAppMessagePayload =
          createWhatsAppMessageFromTemplate({
            eventType,
            templateVariables: {
              schedule_name: onCallDutyPolicySchedule.name!,
              schedule_link: viewScheduleLink,
            },
          });

        await UserNotificationSettingService.sendUserNotification({
          userId: user.id!,
          projectId: onCallDutyPolicySchedule.projectId!,
          emailEnvelope: emailMessage,
          smsMessage: sms,
          callRequestMessage: callMessage,
          pushNotificationMessage: pushMessage,
          whatsAppMessage,
          eventType,
        });
      }
    }
  },
);
