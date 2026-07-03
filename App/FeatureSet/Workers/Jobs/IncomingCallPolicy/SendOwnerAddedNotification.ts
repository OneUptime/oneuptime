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
import IncomingCallPolicyOwnerTeamService from "Common/Server/Services/IncomingCallPolicyOwnerTeamService";
import IncomingCallPolicyOwnerUserService from "Common/Server/Services/IncomingCallPolicyOwnerUserService";
import IncomingCallPolicyService from "Common/Server/Services/IncomingCallPolicyService";
import TeamMemberService from "Common/Server/Services/TeamMemberService";
import UserNotificationSettingService from "Common/Server/Services/UserNotificationSettingService";
import PushNotificationUtil from "Common/Server/Utils/PushNotificationUtil";
import { createWhatsAppMessageFromTemplate } from "Common/Server/Utils/WhatsAppTemplateUtil";
import { WhatsAppMessagePayload } from "Common/Types/WhatsApp/WhatsAppMessage";
import IncomingCallPolicy from "Common/Models/DatabaseModels/IncomingCallPolicy";
import IncomingCallPolicyOwnerTeam from "Common/Models/DatabaseModels/IncomingCallPolicyOwnerTeam";
import IncomingCallPolicyOwnerUser from "Common/Models/DatabaseModels/IncomingCallPolicyOwnerUser";
import User from "Common/Models/DatabaseModels/User";

RunCron(
  "IncomingCallPolicyOwner:SendOwnerAddedEmail",
  { schedule: EVERY_MINUTE, runOnStartup: false },
  async () => {
    const incomingCallPolicyOwnerTeams: Array<IncomingCallPolicyOwnerTeam> =
      await IncomingCallPolicyOwnerTeamService.findAllBy({
        query: {
          isOwnerNotified: false,
        },
        props: {
          isRoot: true,
        },
        select: {
          _id: true,
          incomingCallPolicyId: true,
          teamId: true,
        },
      });

    const incomingCallPolicyOwnersMap: Dictionary<Array<User>> = {};

    for (const incomingCallPolicyOwnerTeam of incomingCallPolicyOwnerTeams) {
      const incomingCallPolicyId: ObjectID =
        incomingCallPolicyOwnerTeam.incomingCallPolicyId!;
      const teamId: ObjectID = incomingCallPolicyOwnerTeam.teamId!;

      const users: Array<User> = await TeamMemberService.getUsersInTeams([
        teamId,
      ]);

      if (
        incomingCallPolicyOwnersMap[incomingCallPolicyId.toString()] ===
        undefined
      ) {
        incomingCallPolicyOwnersMap[incomingCallPolicyId.toString()] = [];
      }

      for (const user of users) {
        (
          incomingCallPolicyOwnersMap[
            incomingCallPolicyId.toString()
          ] as Array<User>
        ).push(user);
      }

      // mark this as notified.
      await IncomingCallPolicyOwnerTeamService.updateOneById({
        id: incomingCallPolicyOwnerTeam.id!,
        data: {
          isOwnerNotified: true,
        },
        props: {
          isRoot: true,
        },
      });
    }

    const incomingCallPolicyOwnerUsers: Array<IncomingCallPolicyOwnerUser> =
      await IncomingCallPolicyOwnerUserService.findAllBy({
        query: {
          isOwnerNotified: false,
        },
        props: {
          isRoot: true,
        },
        select: {
          _id: true,
          incomingCallPolicyId: true,
          userId: true,
          user: {
            email: true,
            name: true,
          },
        },
      });

    for (const incomingCallPolicyOwnerUser of incomingCallPolicyOwnerUsers) {
      const incomingCallPolicyId: ObjectID =
        incomingCallPolicyOwnerUser.incomingCallPolicyId!;
      const user: User = incomingCallPolicyOwnerUser.user!;

      if (
        incomingCallPolicyOwnersMap[incomingCallPolicyId.toString()] ===
        undefined
      ) {
        incomingCallPolicyOwnersMap[incomingCallPolicyId.toString()] = [];
      }

      (
        incomingCallPolicyOwnersMap[
          incomingCallPolicyId.toString()
        ] as Array<User>
      ).push(user);

      // mark this as notified.
      await IncomingCallPolicyOwnerUserService.updateOneById({
        id: incomingCallPolicyOwnerUser.id!,
        data: {
          isOwnerNotified: true,
        },
        props: {
          isRoot: true,
        },
      });
    }

    // send email to all of these users.

    for (const incomingCallPolicyId in incomingCallPolicyOwnersMap) {
      if (!incomingCallPolicyOwnersMap[incomingCallPolicyId]) {
        continue;
      }

      if (
        (incomingCallPolicyOwnersMap[incomingCallPolicyId] as Array<User>)
          .length === 0
      ) {
        continue;
      }

      const users: Array<User> = incomingCallPolicyOwnersMap[
        incomingCallPolicyId
      ] as Array<User>;

      const incomingCallPolicy: IncomingCallPolicy | null =
        await IncomingCallPolicyService.findOneById({
          id: new ObjectID(incomingCallPolicyId),
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

      if (!incomingCallPolicy) {
        continue;
      }

      const viewPolicyLink: string = (
        await IncomingCallPolicyService.getLinkInDashboard(
          incomingCallPolicy.projectId!,
          incomingCallPolicy.id!,
        )
      ).toString();

      const vars: Dictionary<string> = {
        policyName: incomingCallPolicy.name!,
        policyDescription:
          incomingCallPolicy.description || "No description provided",
        projectName: incomingCallPolicy.project!.name!,
        viewPolicyLink: viewPolicyLink,
      };

      for (const user of users) {
        const emailMessage: EmailEnvelope = {
          templateType: EmailTemplateType.IncomingCallPolicyOwnerAdded,
          vars: vars,
          subject: "[Incoming Call Policy] Owner of " + incomingCallPolicy.name,
        };

        const sms: SMSMessage = {
          message: `This is a message from OneUptime. You have been added as the owner of the incoming call policy: ${incomingCallPolicy.name!}. To unsubscribe from this notification go to User Settings in OneUptime Dashboard.`,
        };

        const callMessage: CallRequestMessage = {
          data: [
            {
              sayMessage: `This is a message from OneUptime. You have been added as the owner of the incoming call policy: ${incomingCallPolicy.name!}. To unsubscribe from this notification go to User Settings in OneUptime Dashboard.  Good bye.`,
            },
          ],
        };

        const pushMessage: PushNotificationMessage =
          PushNotificationUtil.createGenericNotification({
            title: "Added as Incoming Call Policy Owner",
            body: `You have been added as the owner of the incoming call policy: ${incomingCallPolicy.name!}. Click to view details.`,
            clickAction: viewPolicyLink,
            tag: "incoming-call-policy-owner-added",
            requireInteraction: false,
          });

        const eventType: NotificationSettingEventType =
          NotificationSettingEventType.SEND_INCOMING_CALL_POLICY_OWNER_ADDED_NOTIFICATION;

        const whatsAppMessage: WhatsAppMessagePayload =
          createWhatsAppMessageFromTemplate({
            eventType,
            templateVariables: {
              policy_name: incomingCallPolicy.name!,
              policy_link: viewPolicyLink,
            },
          });

        await UserNotificationSettingService.sendUserNotification({
          userId: user.id!,
          projectId: incomingCallPolicy.projectId!,
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
