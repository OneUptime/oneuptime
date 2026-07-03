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
import OnCallDutyPolicyOwnerTeamService from "Common/Server/Services/OnCallDutyPolicyOwnerTeamService";
import OnCallDutyPolicyOwnerUserService from "Common/Server/Services/OnCallDutyPolicyOwnerUserService";
import OnCallDutyPolicyService from "Common/Server/Services/OnCallDutyPolicyService";
import TeamMemberService from "Common/Server/Services/TeamMemberService";
import UserNotificationSettingService from "Common/Server/Services/UserNotificationSettingService";
import PushNotificationUtil from "Common/Server/Utils/PushNotificationUtil";
import { createWhatsAppMessageFromTemplate } from "Common/Server/Utils/WhatsAppTemplateUtil";
import { WhatsAppMessagePayload } from "Common/Types/WhatsApp/WhatsAppMessage";
import OnCallDutyPolicy from "Common/Models/DatabaseModels/OnCallDutyPolicy";
import OnCallDutyPolicyOwnerTeam from "Common/Models/DatabaseModels/OnCallDutyPolicyOwnerTeam";
import OnCallDutyPolicyOwnerUser from "Common/Models/DatabaseModels/OnCallDutyPolicyOwnerUser";
import User from "Common/Models/DatabaseModels/User";

RunCron(
  "OnCallDutyPolicyOwner:SendOwnerAddedEmail",
  { schedule: EVERY_MINUTE, runOnStartup: false },
  async () => {
    const onCallDutyPolicyOwnerTeams: Array<OnCallDutyPolicyOwnerTeam> =
      await OnCallDutyPolicyOwnerTeamService.findAllBy({
        query: {
          isOwnerNotified: false,
        },
        props: {
          isRoot: true,
        },
        select: {
          _id: true,
          onCallDutyPolicyId: true,
          teamId: true,
        },
      });

    const onCallDutyPolicyOwnersMap: Dictionary<Array<User>> = {};

    for (const onCallDutyPolicyOwnerTeam of onCallDutyPolicyOwnerTeams) {
      const onCallDutyPolicyId: ObjectID =
        onCallDutyPolicyOwnerTeam.onCallDutyPolicyId!;
      const teamId: ObjectID = onCallDutyPolicyOwnerTeam.teamId!;

      const users: Array<User> = await TeamMemberService.getUsersInTeams([
        teamId,
      ]);

      if (
        onCallDutyPolicyOwnersMap[onCallDutyPolicyId.toString()] === undefined
      ) {
        onCallDutyPolicyOwnersMap[onCallDutyPolicyId.toString()] = [];
      }

      for (const user of users) {
        (
          onCallDutyPolicyOwnersMap[
            onCallDutyPolicyId.toString()
          ] as Array<User>
        ).push(user);
      }

      // mark this as notified.
      await OnCallDutyPolicyOwnerTeamService.updateOneById({
        id: onCallDutyPolicyOwnerTeam.id!,
        data: {
          isOwnerNotified: true,
        },
        props: {
          isRoot: true,
        },
      });
    }

    const onCallDutyPolicyOwnerUsers: Array<OnCallDutyPolicyOwnerUser> =
      await OnCallDutyPolicyOwnerUserService.findAllBy({
        query: {
          isOwnerNotified: false,
        },
        props: {
          isRoot: true,
        },
        select: {
          _id: true,
          onCallDutyPolicyId: true,
          userId: true,
          user: {
            email: true,
            name: true,
          },
        },
      });

    for (const onCallDutyPolicyOwnerUser of onCallDutyPolicyOwnerUsers) {
      const onCallDutyPolicyId: ObjectID =
        onCallDutyPolicyOwnerUser.onCallDutyPolicyId!;
      const user: User = onCallDutyPolicyOwnerUser.user!;

      if (
        onCallDutyPolicyOwnersMap[onCallDutyPolicyId.toString()] === undefined
      ) {
        onCallDutyPolicyOwnersMap[onCallDutyPolicyId.toString()] = [];
      }

      (
        onCallDutyPolicyOwnersMap[onCallDutyPolicyId.toString()] as Array<User>
      ).push(user);

      // mark this as notified.
      await OnCallDutyPolicyOwnerUserService.updateOneById({
        id: onCallDutyPolicyOwnerUser.id!,
        data: {
          isOwnerNotified: true,
        },
        props: {
          isRoot: true,
        },
      });
    }

    // send email to all of these users.

    for (const onCallDutyPolicyId in onCallDutyPolicyOwnersMap) {
      if (!onCallDutyPolicyOwnersMap[onCallDutyPolicyId]) {
        continue;
      }

      if (
        (onCallDutyPolicyOwnersMap[onCallDutyPolicyId] as Array<User>)
          .length === 0
      ) {
        continue;
      }

      const users: Array<User> = onCallDutyPolicyOwnersMap[
        onCallDutyPolicyId
      ] as Array<User>;

      const onCallDutyPolicy: OnCallDutyPolicy | null =
        await OnCallDutyPolicyService.findOneById({
          id: new ObjectID(onCallDutyPolicyId),
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

      if (!onCallDutyPolicy) {
        continue;
      }

      const viewPolicyLink: string = (
        await OnCallDutyPolicyService.getOnCallDutyPolicyLinkInDashboard(
          onCallDutyPolicy.projectId!,
          onCallDutyPolicy.id!,
        )
      ).toString();

      const vars: Dictionary<string> = {
        policyName: onCallDutyPolicy.name!,
        policyDescription:
          onCallDutyPolicy.description || "No description provided",
        projectName: onCallDutyPolicy.project!.name!,
        viewPolicyLink: viewPolicyLink,
      };

      for (const user of users) {
        const emailMessage: EmailEnvelope = {
          templateType: EmailTemplateType.OnCallDutyPolicyOwnerAdded,
          vars: vars,
          subject: "[On-Call Policy] Owner of " + onCallDutyPolicy.name,
        };

        const sms: SMSMessage = {
          message: `This is a message from OneUptime. You have been added as the owner of the on-call policy: ${onCallDutyPolicy.name!}. To unsubscribe from this notification go to User Settings in OneUptime Dashboard.`,
        };

        const callMessage: CallRequestMessage = {
          data: [
            {
              sayMessage: `This is a message from OneUptime. You have been added as the owner of the on-call policy: ${onCallDutyPolicy.name!}. To unsubscribe from this notification go to User Settings in OneUptime Dashboard.  Good bye.`,
            },
          ],
        };

        const pushMessage: PushNotificationMessage =
          PushNotificationUtil.createGenericNotification({
            title: "Added as On-Call Policy Owner",
            body: `You have been added as the owner of the on-call policy: ${onCallDutyPolicy.name!}. Click to view details.`,
            clickAction: viewPolicyLink,
            tag: "on-call-policy-owner-added",
            requireInteraction: false,
          });

        const eventType: NotificationSettingEventType =
          NotificationSettingEventType.SEND_ON_CALL_DUTY_POLICY_OWNER_ADDED_NOTIFICATION;

        const whatsAppMessage: WhatsAppMessagePayload =
          createWhatsAppMessageFromTemplate({
            eventType,
            templateVariables: {
              policy_name: onCallDutyPolicy.name!,
              policy_link: viewPolicyLink,
            },
          });

        await UserNotificationSettingService.sendUserNotification({
          userId: user.id!,
          projectId: onCallDutyPolicy.projectId!,
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
