import { buildNotificationSms } from "Common/Utils/Sms/NotificationSms";
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
import ProbeOwnerTeamService from "Common/Server/Services/ProbeOwnerTeamService";
import ProbeOwnerUserService from "Common/Server/Services/ProbeOwnerUserService";
import TeamMemberService from "Common/Server/Services/TeamMemberService";
import UserNotificationSettingService from "Common/Server/Services/UserNotificationSettingService";
import PushNotificationUtil from "Common/Server/Utils/PushNotificationUtil";
import { createWhatsAppMessageFromTemplate } from "Common/Server/Utils/WhatsAppTemplateUtil";
import { WhatsAppMessagePayload } from "Common/Types/WhatsApp/WhatsAppMessage";
import ProbeOwnerTeam from "Common/Models/DatabaseModels/ProbeOwnerTeam";
import ProbeOwnerUser from "Common/Models/DatabaseModels/ProbeOwnerUser";
import User from "Common/Models/DatabaseModels/User";
import Probe from "Common/Models/DatabaseModels/Probe";
import ProbeService from "Common/Server/Services/ProbeService";
import logger from "Common/Server/Utils/Logger";
import OwnerNotificationDeliveries, {
  OwnerNotificationDelivery,
} from "Common/Server/Utils/Notification/OwnerNotificationDeliveries";
import { OwnerNotificationKind } from "Common/Types/Notification/OwnerNotificationDelivery";
import {
  OwnerRowAdded,
  ownersToTell,
  planOwnersAdded,
} from "../../Utils/OwnersAdded";

RunCron(
  "ProbeOwner:SendOwnerAddedEmail",
  { schedule: EVERY_MINUTE, runOnStartup: false },
  async () => {
    /*
     * The owners a run that stopped part way left untold - a worker killed
     * between the take and the last owner (#8509) - told first, exactly
     * them, from the probe as it is now (OwnerNotificationDeliveries).
     */
    await OwnerNotificationDeliveries.resume({
      kinds: [OwnerNotificationKind.ProbeOwnerAdded],
      notify: async (delivery: OwnerNotificationDelivery): Promise<void> => {
        const probe: Probe | null = await readProbe(
          delivery.notification.resourceId,
        );

        if (!probe) {
          await delivery.giveUp("the probe is gone");
          return;
        }

        await notifyOwnersAdded({
          probe: probe,
          deliveries: [delivery],
        });
      },
    });

    const probeOwnerTeams: Array<ProbeOwnerTeam> =
      await ProbeOwnerTeamService.findAllBy({
        query: {
          isOwnerNotified: false,
        },
        props: {
          isRoot: true,
        },
        skip: 0,
        select: {
          _id: true,
          probeId: true,
          teamId: true,
        },
      });

    const probeOwnersMap: Dictionary<Array<OwnerRowAdded>> = {};

    for (const probeOwnerTeam of probeOwnerTeams) {
      const probeId: ObjectID = probeOwnerTeam.probeId!;
      const teamId: ObjectID = probeOwnerTeam.teamId!;

      const users: Array<User> = await TeamMemberService.getUsersInTeams([
        teamId,
      ]);

      if (probeOwnersMap[probeId.toString()] === undefined) {
        probeOwnersMap[probeId.toString()] = [];
      }

      (probeOwnersMap[probeId.toString()] as Array<OwnerRowAdded>).push({
        ownerRowId: probeOwnerTeam.id!,
        isTeam: true,
        users: users,
      });
    }

    const probeOwnerUsers: Array<ProbeOwnerUser> =
      await ProbeOwnerUserService.findAllBy({
        query: {
          isOwnerNotified: false,
        },
        props: {
          isRoot: true,
        },
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

      (probeOwnersMap[probeId.toString()] as Array<OwnerRowAdded>).push({
        ownerRowId: probeOwnerUser.id!,
        isTeam: false,
        users: [user],
      });
    }

    // send email to all of these users.

    for (const probeId in probeOwnersMap) {
      const ownerRows: Array<OwnerRowAdded> = probeOwnersMap[probeId] || [];

      if (ownerRows.length === 0) {
        continue;
      }

      const probe: Probe | null = await readProbe(new ObjectID(probeId));

      /*
       * Whom each owner row is to tell, written before the rows are taken:
       * a worker stopped from here on leaves them to be told by a later
       * run, and one stopped before the take leaves the rows to be read
       * again.
       */
      const deliveries: Array<OwnerNotificationDelivery> = probe
        ? await planOwnersAdded({
            kind: OwnerNotificationKind.ProbeOwnerAdded,
            projectId: probe.projectId!,
            resourceId: probe.id!,
            ownerRows: ownerRows,
          })
        : [];

      /*
       * Marked as notified before the owners are told, so an owner row
       * whose notification keeps failing is never read again on every run -
       * one whose probe is gone too.
       */
      for (const ownerRow of ownerRows) {
        if (ownerRow.isTeam) {
          await ProbeOwnerTeamService.updateOneById({
            id: ownerRow.ownerRowId,
            data: {
              isOwnerNotified: true,
            },
            props: {
              isRoot: true,
            },
          });
        } else {
          await ProbeOwnerUserService.updateOneById({
            id: ownerRow.ownerRowId,
            data: {
              isOwnerNotified: true,
            },
            props: {
              isRoot: true,
            },
          });
        }
      }

      if (!probe) {
        continue;
      }

      try {
        await notifyOwnersAdded({
          probe: probe,
          deliveries: deliveries,
        });
      } catch (e) {
        logger.error("Error in sending probe owner added notification", {
          projectId: probe.projectId?.toString(),
          probeId: probe.id?.toString(),
        });
        logger.error(e, {
          projectId: probe.projectId?.toString(),
          probeId: probe.id?.toString(),
        });
      }
    }
  },
);

async function readProbe(probeId: ObjectID): Promise<Probe | null> {
  return await ProbeService.findOneById({
    id: probeId,
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
}

/*
 * Tells each delivery's owners that they were added as owners of the
 * probe, each once (OwnerNotificationDelivery.tell).
 */
async function notifyOwnersAdded(data: {
  probe: Probe;
  deliveries: Array<OwnerNotificationDelivery>;
}): Promise<void> {
  const probe: Probe = data.probe;

  if (ownersToTell(data.deliveries).length === 0) {
    return;
  }

  const vars: Dictionary<string> = {
    probeName: probe.name!,
    probeDescription: probe.description || "No description provided",
    projectName: probe.project!.name!,
    viewProbeLink: (
      await ProbeService.getLinkInDashboard(probe.projectId!, probe.id!)
    ).toString(),
  };

  for (const delivery of data.deliveries) {
    for (const user of delivery.owners) {
      await delivery.tell(user, async (): Promise<void> => {
        const emailMessage: EmailEnvelope = {
          templateType: EmailTemplateType.ProbeOwnerAdded,
          vars: vars,
          subject: "[Probe] Owner of " + probe.name,
          isSubjectLiteral: true,
        };

        const sms: SMSMessage = {
          message: buildNotificationSms(
            `You have been added as the owner of the probe: ${probe.name!}.`,
          ),
        };

        const callMessage: CallRequestMessage = {
          data: [
            {
              sayMessage: `This is a message from OneUptime. You have been added as the owner of the probe: ${probe.name!}. To unsubscribe from this notification go to User Settings in OneUptime Dashboard.  Good bye.`,
            },
          ],
        };

        const pushMessage: PushNotificationMessage =
          PushNotificationUtil.createGenericNotification({
            title: "Added as Probe Owner",
            body: `You have been added as the owner of the probe: ${probe.name!}. Click to view details.`,
            clickAction: (
              await ProbeService.getLinkInDashboard(probe.projectId!, probe.id!)
            ).toString(),
            tag: "probe-owner-added",
            requireInteraction: false,
          });

        const eventType: NotificationSettingEventType =
          NotificationSettingEventType.SEND_PROBE_OWNER_ADDED_NOTIFICATION;

        const whatsAppMessage: WhatsAppMessagePayload =
          createWhatsAppMessageFromTemplate({
            eventType,
            templateVariables: {
              probe_name: probe.name!,
              probe_link: vars["viewProbeLink"] || "",
            },
          });

        await UserNotificationSettingService.sendUserNotification({
          userId: user.id!,
          projectId: probe.projectId!,
          emailEnvelope: emailMessage,
          smsMessage: sms,
          callRequestMessage: callMessage,
          pushNotificationMessage: pushMessage,
          whatsAppMessage,
          eventType,
        });
      });
    }
  }
}
