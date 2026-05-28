import RunCron from "../../Utils/Cron";
import { CallRequestMessage } from "Common/Types/Call/CallRequest";
import OneUptimeDate from "Common/Types/Date";
import Dictionary from "Common/Types/Dictionary";
import { EmailEnvelope } from "Common/Types/Email/EmailMessage";
import EmailTemplateType from "Common/Types/Email/EmailTemplateType";
import { JSONObject } from "Common/Types/JSON";
import NotificationSettingEventType from "Common/Types/NotificationSetting/NotificationSettingEventType";
import { SMSMessage } from "Common/Types/SMS/SMS";
import PushNotificationMessage from "Common/Types/PushNotification/PushNotificationMessage";
import { EVERY_MINUTE } from "Common/Utils/CronTime";
import IncidentEpisodeService from "Common/Server/Services/IncidentEpisodeService";
import IncidentEpisodeMemberService from "Common/Server/Services/IncidentEpisodeMemberService";
import IncidentService from "Common/Server/Services/IncidentService";
import ProjectService from "Common/Server/Services/ProjectService";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";
import UserNotificationSettingService from "Common/Server/Services/UserNotificationSettingService";
import PushNotificationUtil from "Common/Server/Utils/PushNotificationUtil";
import Select from "Common/Server/Types/Database/Select";
import logger from "Common/Server/Utils/Logger";
import Incident from "Common/Models/DatabaseModels/Incident";
import IncidentEpisode from "Common/Models/DatabaseModels/IncidentEpisode";
import IncidentEpisodeMember from "Common/Models/DatabaseModels/IncidentEpisodeMember";
import IncidentState from "Common/Models/DatabaseModels/IncidentState";
import Project from "Common/Models/DatabaseModels/Project";
import User from "Common/Models/DatabaseModels/User";
import { IncidentEpisodeFeedEventType } from "Common/Models/DatabaseModels/IncidentEpisodeFeed";
import { Yellow500 } from "Common/Types/BrandColors";
import IncidentEpisodeFeedService from "Common/Server/Services/IncidentEpisodeFeedService";
import ObjectID from "Common/Types/ObjectID";
import { createWhatsAppMessageFromTemplate } from "Common/Server/Utils/WhatsAppTemplateUtil";
import { WhatsAppMessagePayload } from "Common/Types/WhatsApp/WhatsAppMessage";

// Cap the number of incidents we list inline in the email body. Anything
// beyond this gets summarized as "and N more" so the email stays readable.
const MAX_INCIDENTS_IN_EMAIL: number = 25;

RunCron(
  "IncidentEpisodeOwner:SendIncidentAddedEmail",
  { schedule: EVERY_MINUTE, runOnStartup: false },
  async () => {
    // Find every member row that hasn't been rolled into a notification yet.
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
          createdAt: true,
        },
      });

    if (members.length === 0) {
      return;
    }

    // Group members by episode so each owner gets ONE email per episode per
    // cron tick, no matter how many incidents landed.
    const membersByEpisode: Dictionary<Array<IncidentEpisodeMember>> = {};

    for (const member of members) {
      if (!member.incidentEpisodeId) {
        // Bad data — mark so we never reprocess.
        await IncidentEpisodeMemberService.updateOneById({
          id: member.id!,
          data: {
            isOwnerNotifiedOfIncidentAdded: true,
          },
          props: {
            isRoot: true,
          },
        });
        continue;
      }

      const key: string = member.incidentEpisodeId.toString();
      if (!membersByEpisode[key]) {
        membersByEpisode[key] = [];
      }
      (membersByEpisode[key] as Array<IncidentEpisodeMember>).push(member);
    }

    for (const episodeIdStr of Object.keys(membersByEpisode)) {
      const episodeMembers: Array<IncidentEpisodeMember> = membersByEpisode[
        episodeIdStr
      ] as Array<IncidentEpisodeMember>;

      if (episodeMembers.length === 0) {
        continue;
      }

      const episodeId: ObjectID = new ObjectID(episodeIdStr);
      const projectId: ObjectID | undefined = episodeMembers[0]!.projectId;

      // Mark everything in this batch as notified upfront. If the rest of
      // this iteration fails we don't want to retry-spam owners on the next
      // cron tick.
      for (const member of episodeMembers) {
        await IncidentEpisodeMemberService.updateOneById({
          id: member.id!,
          data: {
            isOwnerNotifiedOfIncidentAdded: true,
          },
          props: {
            isRoot: true,
          },
        });
      }

      if (!projectId) {
        continue;
      }

      // Load episode metadata for the email.
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
        continue;
      }

      // Load every added incident in one query.
      const incidentIds: Array<ObjectID> = episodeMembers
        .map((m: IncidentEpisodeMember) => {
          return m.incidentId;
        })
        .filter((id: ObjectID | undefined): id is ObjectID => {
          return Boolean(id);
        });

      if (incidentIds.length === 0) {
        continue;
      }

      const incidents: Array<Incident> = await IncidentService.findBy({
        query: {
          _id: QueryHelper.any(incidentIds),
        },
        props: {
          isRoot: true,
        },
        skip: 0,
        limit: incidentIds.length,
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

      if (incidents.length === 0) {
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

      const incidentCountInBatch: number = incidents.length;

      // Map incidentId -> addedAt for the in-email list. Some members may have
      // had no addedAt (defensive), so we fall back to createdAt.
      const addedAtByIncidentId: Dictionary<Date> = {};
      for (const member of episodeMembers) {
        if (member.incidentId) {
          addedAtByIncidentId[member.incidentId.toString()] =
            member.addedAt || member.createdAt || OneUptimeDate.getCurrentDate();
        }
      }

      // Sort incidents by addedAt ascending so newest-at-bottom; truncate if
      // the batch is huge.
      const sortedIncidents: Array<Incident> = [...incidents].sort(
        (a: Incident, b: Incident) => {
          const aTime: number = (
            addedAtByIncidentId[a.id!.toString()] || new Date(0)
          ).getTime();
          const bTime: number = (
            addedAtByIncidentId[b.id!.toString()] || new Date(0)
          ).getTime();
          return aTime - bTime;
        },
      );

      const truncated: boolean =
        sortedIncidents.length > MAX_INCIDENTS_IN_EMAIL;
      const incidentsToShow: Array<Incident> = truncated
        ? sortedIncidents.slice(0, MAX_INCIDENTS_IN_EMAIL)
        : sortedIncidents;
      const remainingCount: number = truncated
        ? sortedIncidents.length - MAX_INCIDENTS_IN_EMAIL
        : 0;

      const episodeViewLink: string = (
        await IncidentEpisodeService.getEpisodeLinkInDashboard(
          projectId,
          episodeId,
        )
      ).toString();

      const episodeFeedText: string = `🔔 **Owner Incidents Added to Episode Notification Sent**:
      Notification sent to owners because ${incidentCountInBatch} incident(s) were added to [Incident Episode ${episodeDisplayNumber}](${episodeViewLink}).`;
      let moreEpisodeFeedInformationInMarkdown: string = "";

      for (const user of owners) {
        try {
          // Build the per-incident list for the HBS template. addedAt is
          // pre-formatted per-recipient because timezone is per-user.
          const incidentsForTemplate: Array<JSONObject> = await Promise.all(
            incidentsToShow.map(async (incident: Incident): Promise<JSONObject> => {
              const incidentLink: string = (
                await IncidentService.getIncidentLinkInDashboard(
                  projectId,
                  incident.id!,
                )
              ).toString();

              const incidentNumberStr: string =
                incident.incidentNumberWithPrefix ||
                (incident.incidentNumber
                  ? `#${incident.incidentNumber}`
                  : "");

              return {
                incidentTitle: incident.title || "",
                incidentNumber: incidentNumberStr,
                incidentSeverity: incident.incidentSeverity?.name || "Not Set",
                addedAt:
                  OneUptimeDate.getDateAsFormattedHTMLInMultipleTimezones({
                    date:
                      addedAtByIncidentId[incident.id!.toString()] ||
                      OneUptimeDate.getCurrentDate(),
                    timezones: user.timezone ? [user.timezone] : [],
                  }),
                incidentViewLink: incidentLink,
              };
            }),
          );

          const vars: Dictionary<string | JSONObject> = {
            episodeTitle: episode.title!,
            episodeNumber: episodeNumberStr,
            projectName: episode.project!.name!,
            currentState: episode.currentIncidentState?.name || "Not Set",
            incidentCount: incidentCountInBatch.toString(),
            incidentCountLabel:
              incidentCountInBatch === 1 ? "incident" : "incidents",
            remainingCount: remainingCount.toString(),
            hasMore: remainingCount > 0 ? "true" : "false",
            incidents: incidentsForTemplate as unknown as JSONObject,
            episodeViewLink: episodeViewLink,
          };

          if (doesResourceHasOwners === true) {
            vars["isOwner"] = "true";
          }

          const subjectIncidentLabel: string =
            incidentCountInBatch === 1
              ? `1 new incident`
              : `${incidentCountInBatch} new incidents`;

          const emailMessage: EmailEnvelope = {
            templateType: EmailTemplateType.IncidentEpisodeOwnerIncidentAdded,
            vars: vars,
            subject: `[Episode ${episodeNumberStr}] ${subjectIncidentLabel} added - ${episode.title!}`,
          };

          const summaryLine: string =
            incidentCountInBatch === 1
              ? `1 new incident was added to incident episode ${episodeNumberStr} (${episode.title}).`
              : `${incidentCountInBatch} new incidents were added to incident episode ${episodeNumberStr} (${episode.title}).`;

          const sms: SMSMessage = {
            message: `This is a message from OneUptime. ${summaryLine} To unsubscribe from this notification go to User Settings in OneUptime Dashboard.`,
          };

          const callMessage: CallRequestMessage = {
            data: [
              {
                sayMessage: `This is a message from OneUptime. ${summaryLine} To unsubscribe from this notification go to User Settings in OneUptime Dashboard. Good bye.`,
              },
            ],
          };

          const pushMessage: PushNotificationMessage =
            PushNotificationUtil.createGenericNotification({
              title: `${subjectIncidentLabel} added to Episode ${episodeNumberStr}`,
              body: `${summaryLine} Click to view the episode.`,
              clickAction: episodeViewLink,
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
                incident_count: incidentCountInBatch.toString(),
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

          moreEpisodeFeedInformationInMarkdown += `**Notified**: ${user.name} (${user.email}) — ${incidentCountInBatch} incident(s)\n`;
        } catch (e) {
          logger.error(
            "Error in sending incident-added-to-episode batch notification",
            {
              projectId: projectId?.toString(),
              incidentEpisodeId: episodeId?.toString(),
              batchSize: incidentCountInBatch,
            },
          );
          logger.error(e, {
            projectId: projectId?.toString(),
            incidentEpisodeId: episodeId?.toString(),
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
