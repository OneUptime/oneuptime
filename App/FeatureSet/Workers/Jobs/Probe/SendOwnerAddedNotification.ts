import RunCron from "../../Utils/Cron";
import { CallRequestMessage } from "Common/Types/Call/CallRequest";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import Dictionary from "Common/Types/Dictionary";
import { EmailEnvelope } from "Common/Types/Email/EmailMessage";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import NotificationSettingEventType from "Common/Types/NotificationSetting/NotificationSettingEventType";
import ObjectID from "Common/Types/ObjectID";
import { SMSMessage } from "Common/Types/SMS/SMS";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import ProbeOwnerTeamService from "CommonServer/Services/ProbeOwnerTeamService";
import ProbeOwnerUserService from "CommonServer/Services/ProbeOwnerUserService";
import TeamMemberService from "CommonServer/Services/TeamMemberService";
import UserNotificationSettingService from "CommonServer/Services/UserNotificationSettingService";
import ProbeOwnerTeam from "Common/Models/DatabaseModels/ProbeOwnerTeam";
import ProbeOwnerUser from "Common/Models/DatabaseModels/ProbeOwnerUser";
import User from "Common/Models/DatabaseModels/User";
import Probe from "Common/Models/DatabaseModels/Probe";
import ProbeService from "CommonServer/Services/ProbeService";

RunCron(
  "ProbeOwner:SendOwnerAddedEmail",
  { schedule: EVERY_MINUTE, runOnStartup: false },
  async () => {
    const probeOwnerTeams: Array<ProbeOwnerTeam> =
      await ProbeOwnerTeamService.findBy({
        query: {
          isOwnerNotified: false,
        },
        props: {
          isRoot: true,
        },
        limit: LIMIT_MAX,
        skip: 0,
        select: {
          _id: true,
          probeId: true,
          teamId: true,
        },
      });

    const probeOwnersMap: Dictionary<Array<User>> = {};

    for (const probeOwnerTeam of probeOwnerTeams) {
      const probeId: ObjectID = probeOwnerTeam.probeId!;
      const teamId: ObjectID = probeOwnerTeam.teamId!;

      const users: Array<User> = await TeamMemberService.getUsersInTeams([
        teamId,
      ]);

      if (probeOwnersMap[probeId.toString()] === undefined) {
        probeOwnersMap[probeId.toString()] = [];
      }

      for (const user of users) {
        (probeOwnersMap[probeId.toString()] as Array<User>).push(user);
      }

      // mark this as notified.
      await ProbeOwnerTeamService.updateOneById({
        id: probeOwnerTeam.id!,
        data: {
          isOwnerNotified: true,
        },
        props: {
          isRoot: true,
        },
      });
    }

    const probeOwnerUsers: Array<ProbeOwnerUser> =
      await ProbeOwnerUserService.findBy({
        query: {
          isOwnerNotified: false,
        },
        props: {
          isRoot: true,
        },
        limit: LIMIT_MAX,
        skip: 0,
        select: {
          _id: true,
          probeId: true,
          userId: true,
          user: {
            email: true,
            name: true,
          },
        },
      });

    for (const probeOwnerUser of probeOwnerUsers) {
      const probeId: ObjectID = probeOwnerUser.probeId!;
      const user: User = probeOwnerUser.user!;

      if (probeOwnersMap[probeId.toString()] === undefined) {
        probeOwnersMap[probeId.toString()] = [];
      }

      (probeOwnersMap[probeId.toString()] as Array<User>).push(user);

      // mark this as notified.
      await ProbeOwnerUserService.updateOneById({
        id: probeOwnerUser.id!,
        data: {
          isOwnerNotified: true,
        },
        props: {
          isRoot: true,
        },
      });
    }

    // send email to all of these users.

    for (const probeId in probeOwnersMap) {
      if (!probeOwnersMap[probeId]) {
        continue;
      }

      if ((probeOwnersMap[probeId] as Array<User>).length === 0) {
        continue;
      }

      const users: Array<User> = probeOwnersMap[probeId] as Array<User>;

      // get all scheduled events of all the projects.
      const probe: Probe | null = await ProbeService.findOneById({
        id: new ObjectID(probeId),
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

      if (!probe) {
        continue;
      }

      const vars: Dictionary<string> = {
        probeName: probe.name!,
        probeDescription: probe.description || "No description provided",
        projectName: probe.project!.name!,
        viewProbeLink: (
          await ProbeService.getLinkInDashboard(probe.projectId!, probe.id!)
        ).toString(),
      };

      for (const user of users) {
        const emailMessage: EmailEnvelope = {
          templateType: EmailTemplateType.ProbeOwnerAdded,
          vars: vars,
          subject: "[Probe] Owner of " + probe.name,
        };

        const sms: SMSMessage = {
          message: `This is a message from OneUptime. You have been added as the owner of the probe: ${probe.name!}. To unsubscribe from this notification go to User Settings in OneUptime Dashboard.`,
        };

        const callMessage: CallRequestMessage = {
          data: [
            {
              sayMessage: `This is a message from OneUptime. You have been added as the owner of the probe: ${probe.name!}. To unsubscribe from this notification go to User Settings in OneUptime Dashboard.  Good bye.`,
            },
          ],
        };

        await UserNotificationSettingService.sendUserNotification({
          userId: user.id!,
          projectId: probe.projectId!,
          emailEnvelope: emailMessage,
          smsMessage: sms,
          callRequestMessage: callMessage,
          eventType:
            NotificationSettingEventType.SEND_PROBE_OWNER_ADDED_NOTIFICATION,
        });
      }
    }
  },
);
