import RunCron from "../../Utils/Cron";
import { CallRequestMessage } from "Common/Types/Call/CallRequest";
import OneUptimeDate from "Common/Types/Date";
import Dictionary from "Common/Types/Dictionary";
import { EmailEnvelope } from "Common/Types/Email/EmailMessage";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import NotificationSettingEventType from "Common/Types/NotificationSetting/NotificationSettingEventType";
import { SMSMessage } from "Common/Types/SMS/SMS";
import PushNotificationMessage from "Common/Types/PushNotification/PushNotificationMessage";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import IncidentEpisodeService from "Common/Server/Services/IncidentEpisodeService";
import IncidentEpisodeMemberService from "Common/Server/Services/IncidentEpisodeMemberService";
import IncidentService from "Common/Server/Services/IncidentService";
import ProjectService from "Common/Server/Services/ProjectService";
import UserNotificationSettingService from "Common/Server/Services/UserNotificationSettingService";
import PushNotificationUtil from "Common/Server/Utils/PushNotificationUtil";
import Select from "Common/Server/Types/Database/Select";
import logger from "Common/Server/Utils/Logger";
import Incident from "Common/Models/DatabaseModels/Incident";
import IncidentEpisode from "Common/Models/DatabaseModels/IncidentEpisode";
import IncidentEpisodeMember, {
  IncidentEpisodeMemberAddedBy,
} from "Common/Models/DatabaseModels/IncidentEpisodeMember";
import IncidentState from "Common/Models/DatabaseModels/IncidentState";
import Project from "Common/Models/DatabaseModels/Project";
import User from "Common/Models/DatabaseModels/User";
import { IncidentEpisodeFeedEventType } from "Common/Models/DatabaseModels/IncidentEpisodeFeed";
import { Yellow500 } from "Common/Types/BrandColors";
import IncidentEpisodeFeedService from "Common/Server/Services/IncidentEpisodeFeedService";
import ObjectID from "Common/Types/ObjectID";
import { createWhatsAppMessageFromTemplate } from "Common/Server/Utils/WhatsAppTemplateUtil";
import { WhatsAppMessagePayload } from "Common/Types/WhatsApp/WhatsAppMessage";

RunCron(
  "IncidentEpisodeOwner:SendIncidentAddedEmail",
  { schedule: EVERY_MINUTE, runOnStartup: false },
  async () => {
    // Find all episode-member rows we haven't yet notified owners about.
    const members: Array<IncidentEpisodeMember> =
      await IncidentEpisodeMemberService.findAllBy({
        query: {
          isOwnerNotifiedOfIncidentAdded: false,
        },
        props: {
          isRoot: true,
        },
        skip: 0,
        select: {
          _id: true,
          projectId: true,
          incidentId: true,
          incidentEpisodeId: true,
          addedAt: true,
          addedBy: true,
          createdAt: true,
          addedByUser: {
            name: true,
            email: true,
          },
        },
      });

    for (const member of members) {
      const memberId: ObjectID = member.id!;
      const projectId: ObjectID | undefined = member.projectId;
      const incidentId: ObjectID | undefined = member.incidentId;
      const episodeId: ObjectID | undefined = member.incidentEpisodeId;

      if (!projectId || !incidentId || !episodeId) {
        // Bad data — mark as notified so we don't loop on it.
        await IncidentEpisodeMemberService.updateOneById({
          id: memberId,
          data: {
            isOwnerNotifiedOfIncidentAdded: true,
          },
          props: {
            isRoot: true,
          },
        });
        continue;
      }

      /*
       * Load the episode. We need its current incidentCount so we can skip the
       * very first incident — that one is covered by the "episode created"
       * notification and we don't want to double-notify owners.
       */
      const episode: IncidentEpisode | null =
        await IncidentEpisodeService.findOneById({
          id: episodeId,
          props: {
            isRoot: true,
          },
          select: {
            _id: true,
            title: true,
            projectId: true,
            incidentCount: true,
            project: {
              name: true,
            } as Select<Project>,
            currentIncidentState: {
              name: true,
            } as Select<IncidentState>,
            episodeNumber: true,
            episodeNumberWithPrefix: true,
          },
        });

      if (!episode) {
        // Episode is gone — nothing to notify about.
        await IncidentEpisodeMemberService.updateOneById({
          id: memberId,
          data: {
            isOwnerNotifiedOfIncidentAdded: true,
          },
          props: {
            isRoot: true,
          },
        });
        continue;
      }

      /*
       * Mark as notified now so we never retry this member, even if all
       * subsequent steps fail.
       */
      await IncidentEpisodeMemberService.updateOneById({
        id: memberId,
        data: {
          isOwnerNotifiedOfIncidentAdded: true,
        },
        props: {
          isRoot: true,
        },
      });

      /*
       * Skip the founding incident — the "episode created" notification
       * already covers it. If incidentCount <= 1 the episode has just this
       * one incident, which means owners are already being notified via the
       * creation flow.
       */
      const incidentCount: number =
        typeof episode.incidentCount === "number" ? episode.incidentCount : 0;

      if (incidentCount <= 1) {
        continue;
      }

      // Load incident details.
      const incident: Incident | null = await IncidentService.findOneById({
        id: incidentId,
        props: {
          isRoot: true,
        },
        select: {
          _id: true,
          title: true,
          incidentNumber: true,
          incidentNumberWithPrefix: true,
          incidentSeverity: {
            name: true,
          },
        },
      });

      if (!incident) {
        continue;
      }

      // Find owners — fall back to project owners if none are configured.
      let doesResourceHasOwners: boolean = true;
      let owners: Array<User> =
        await IncidentEpisodeService.findOwners(episodeId);

      if (owners.length === 0) {
        doesResourceHasOwners = false;
        owners = await ProjectService.getOwners(projectId);
      }

      if (owners.length === 0) {
        continue;
      }

      const episodeNumberStr: string =
        episode.episodeNumberWithPrefix ||
        (episode.episodeNumber ? `#${episode.episodeNumber}` : "");
      const episodeDisplayNumber: string =
        episode.episodeNumberWithPrefix || "#" + episode.episodeNumber;
      const incidentNumberStr: string =
        incident.incidentNumberWithPrefix ||
        (incident.incidentNumber ? `#${incident.incidentNumber}` : "");

      const addedAtDate: Date =
        member.addedAt || member.createdAt || OneUptimeDate.getCurrentDate();

      let addedByLabel: string;
      if (
        member.addedByUser &&
        member.addedByUser.name &&
        member.addedByUser.email
      ) {
        addedByLabel = `${member.addedByUser.name.toString()} (${member.addedByUser.email.toString()})`;
      } else if (member.addedBy === IncidentEpisodeMemberAddedBy.Rule) {
        addedByLabel = "Grouping rule";
      } else if (member.addedBy === IncidentEpisodeMemberAddedBy.API) {
        addedByLabel = "API";
      } else if (member.addedBy === IncidentEpisodeMemberAddedBy.Manual) {
        addedByLabel = "Manual";
      } else {
        addedByLabel = "OneUptime";
      }

      const episodeViewLink: string = (
        await IncidentEpisodeService.getEpisodeLinkInDashboard(
          projectId,
          episodeId,
        )
      ).toString();

      const incidentViewLink: string = (
        await IncidentService.getIncidentLinkInDashboard(projectId, incidentId)
      ).toString();

      const episodeFeedText: string = `🔔 **Owner Incident Added to Episode Notification Sent**:
      Notification sent to owners because incident ${incidentNumberStr} was added to [Incident Episode ${episodeDisplayNumber}](${episodeViewLink}).`;
      let moreEpisodeFeedInformationInMarkdown: string = "";

      for (const user of owners) {
        try {
          const vars: Dictionary<string> = {
            episodeTitle: episode.title!,
            episodeNumber: episodeNumberStr,
            projectName: episode.project!.name!,
            currentState: episode.currentIncidentState?.name || "Not Set",
            incidentTitle: incident.title!,
            incidentNumber: incidentNumberStr,
            incidentSeverity: incident.incidentSeverity?.name || "Not Set",
            addedAt: OneUptimeDate.getDateAsFormattedHTMLInMultipleTimezones({
              date: addedAtDate,
              timezones: user.timezone ? [user.timezone] : [],
            }),
            addedBy: addedByLabel,
            incidentViewLink: incidentViewLink,
            episodeViewLink: episodeViewLink,
          };

          if (doesResourceHasOwners === true) {
            vars["isOwner"] = "true";
          }

          const emailMessage: EmailEnvelope = {
            templateType: EmailTemplateType.IncidentEpisodeOwnerIncidentAdded,
            vars: vars,
            subject: `[Incident ${incidentNumberStr} added to Episode ${episodeNumberStr}] - ${incident.title!}`,
          };

          const sms: SMSMessage = {
            message: `This is a message from OneUptime. Incident ${incidentNumberStr} (${incident.title}) was added to incident episode ${episodeNumberStr} (${episode.title}). To unsubscribe from this notification go to User Settings in OneUptime Dashboard.`,
          };

          const callMessage: CallRequestMessage = {
            data: [
              {
                sayMessage: `This is a message from OneUptime. Incident ${incidentNumberStr} was added to incident episode ${episodeNumberStr}. To unsubscribe from this notification go to User Settings in OneUptime Dashboard. Good bye.`,
              },
            ],
          };

          const pushMessage: PushNotificationMessage =
            PushNotificationUtil.createGenericNotification({
              title: `Incident ${incidentNumberStr} added to Episode ${episodeNumberStr}`,
              body: `Incident ${incidentNumberStr} (${incident.title}) was added to incident episode ${episodeNumberStr} in ${episode.project!.name!}. Click to view details.`,
              clickAction: incidentViewLink,
              tag: "incident-added-to-episode",
              requireInteraction: false,
            });

          const eventType: NotificationSettingEventType =
            NotificationSettingEventType.SEND_INCIDENT_ADDED_TO_EPISODE_OWNER_NOTIFICATION;

          const whatsAppMessage: WhatsAppMessagePayload =
            createWhatsAppMessageFromTemplate({
              eventType,
              templateVariables: {
                episode_title: episode.title!,
                episode_number: episodeDisplayNumber,
                episode_link: episodeViewLink,
                incident_title: incident.title!,
                incident_number:
                  incident.incidentNumberWithPrefix ||
                  (incident.incidentNumber !== undefined
                    ? incident.incidentNumber.toString()
                    : ""),
              },
            });

          await UserNotificationSettingService.sendUserNotification({
            userId: user.id!,
            projectId: projectId,
            emailEnvelope: emailMessage,
            smsMessage: sms,
            callRequestMessage: callMessage,
            pushNotificationMessage: pushMessage,
            whatsAppMessage,
            incidentEpisodeId: episodeId,
            eventType,
          });

          moreEpisodeFeedInformationInMarkdown += `**Notified**: ${user.name} (${user.email})\n`;
        } catch (e) {
          logger.error(
            "Error in sending incident added to episode notification",
            {
              projectId: projectId?.toString(),
              incidentEpisodeId: episodeId?.toString(),
              incidentId: incidentId?.toString(),
            },
          );
          logger.error(e, {
            projectId: projectId?.toString(),
            incidentEpisodeId: episodeId?.toString(),
            incidentId: incidentId?.toString(),
          });
        }
      }

      await IncidentEpisodeFeedService.createIncidentEpisodeFeedItem({
        incidentEpisodeId: episodeId,
        projectId: projectId,
        incidentEpisodeFeedEventType:
          IncidentEpisodeFeedEventType.OwnerNotificationSent,
        displayColor: Yellow500,
        feedInfoInMarkdown: episodeFeedText,
        moreInformationInMarkdown: moreEpisodeFeedInformationInMarkdown,
      });
    }
  },
);
