import { buildNotificationSms } from "Common/Utils/Sms/NotificationSms";
import RunCron from "../../Utils/Cron";
import OwnerNotificationBacklog, {
  OwnerNotificationGroup,
  OwnerNotificationPage,
} from "../../Utils/OwnerNotificationBacklog";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import JobDeadline from "Common/Server/Utils/JobDeadline";
import ProjectService from "Common/Server/Services/ProjectService";
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
import EmailColorUtil from "Common/Utils/Email/EmailColorUtil";
import { mdText } from "Common/Utils/Markdown/FeedMarkdown";
import OwnerNotificationFeedText from "Common/Server/Utils/Notification/OwnerNotificationFeedText";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import OwnerNotificationDeliveries, {
  OwnerNotificationDelivery,
} from "Common/Server/Utils/Notification/OwnerNotificationDeliveries";
import { OwnerNotificationKind } from "Common/Types/Notification/OwnerNotificationDelivery";

/*
 * Cap the number of incidents we list inline in the email body. Anything
 * beyond this gets summarized as "and N more" so the email stays readable.
 */
const MAX_INCIDENTS_IN_EMAIL: number = 25;

// What a member row is read with.
const MEMBER_SELECT: Select<IncidentEpisodeMember> = {
  _id: true,
  projectId: true,
  incidentId: true,
  incidentEpisodeId: true,
  addedAt: true,
  createdAt: true,
};

// What the episode is read with.
const EPISODE_SELECT: Select<IncidentEpisode> = {
  _id: true,
  title: true,
  projectId: true,
  project: {
    name: true,
  } as Select<Project>,
  currentIncidentState: {
    name: true,
    color: true,
  } as Select<IncidentState>,
  incidentSeverity: {
    name: true,
    color: true,
  },
  episodeNumber: true,
  episodeNumberWithPrefix: true,
};

/*
 * ONE NOTIFICATION PER BATCH (#8509). Each run tells each owner of an
 * episode once of every incident added to it since the last run: the batch.
 * The notification is the batch's first member row (by when it was added,
 * then its id) and its size, so a later run that tells the owners a stopped
 * run left reads the same batch again: that many of the episode's notified
 * member rows, from the first on.
 */
function inBatchOrder(
  members: Array<IncidentEpisodeMember>,
): Array<IncidentEpisodeMember> {
  return [...members].sort(
    (a: IncidentEpisodeMember, b: IncidentEpisodeMember): number => {
      const byTime: number =
        (a.createdAt?.getTime() || 0) - (b.createdAt?.getTime() || 0);

      if (byTime !== 0) {
        return byTime;
      }

      const aId: string = a.id?.toString() || "";
      const bId: string = b.id?.toString() || "";

      return aId < bId ? -1 : aId > bId ? 1 : 0;
    },
  );
}

RunCron(
  "IncidentEpisodeOwner:SendIncidentAddedEmail",
  { schedule: EVERY_MINUTE, runOnStartup: false },
  async (deadline: JobDeadline = JobDeadline.none()): Promise<void> => {
    /*
     * The owners a run that stopped part way left untold - a worker killed
     * between the take and the last owner (#8509) - told first, exactly
     * them, of the same batch, and the feed item a run that told them all
     * left unwritten (#8510) (OwnerNotificationDeliveries).
     */
    await OwnerNotificationDeliveries.resume({
      kinds: [OwnerNotificationKind.IncidentEpisodeIncidentAdded],
      notify: async (delivery: OwnerNotificationDelivery): Promise<void> => {
        const episodeMembers: Array<IncidentEpisodeMember> = await readBatch({
          episodeId: delivery.notification.resourceId,
          firstMemberId: delivery.notification.eventId,
          size: delivery.notification.occurrence,
        });

        const episode: IncidentEpisode | null =
          episodeMembers.length > 0
            ? await readEpisode(delivery.notification.resourceId)
            : null;

        const incidents: Array<Incident> = episode
          ? await readIncidents(episodeMembers)
          : [];

        if (!episode || incidents.length === 0) {
          await delivery.giveUp(
            "the incident episode or the incidents added to it are gone",
          );
          return;
        }

        await notifyOwnersOfIncidentsAdded({
          episode: episode,
          projectId: delivery.notification.projectId,
          episodeMembers: episodeMembers,
          incidents: incidents,
          delivery: delivery,
        });
      },
    });

    /*
     * Every episode's incidents added since its last batch, a page at a time,
     * oldest first: an episode's members still to tell are one batch, told
     * of in one notification - each owner gets ONE notification per episode
     * per run, however many incidents landed - and each member row is taken
     * by one run alone. The run stops between batches at its deadline and
     * the next carries on (OwnerNotificationBacklog.forEachGroupToNotify,
     * issue #8862).
     */
    await OwnerNotificationBacklog.forEachGroupToNotify({
      jobName: "IncidentEpisodeOwner:SendIncidentAddedEmail",
      recordIdColumn: "incidentEpisodeId",
      tables: [
        OwnerNotificationBacklog.groupTable<IncidentEpisodeMember>({
          service: IncidentEpisodeMemberService,
          notYetNotified: {
            isOwnerNotifiedOfIncidentAdded: false,
          },
          notified: {
            isOwnerNotifiedOfIncidentAdded: true,
          },
          select: MEMBER_SELECT,
        }),
      ],
      deadline: deadline,
      readPage: readEpisodesOfPage,
      notify: async (input: {
        group: OwnerNotificationGroup;
        page: OwnerNotificationPage;
        take: () => Promise<Array<Array<BaseModel>>>;
      }): Promise<void> => {
        await notifyOfBatch(input);
      },
    });
  },
);

/*
 * One batch: an episode's members still to tell, in batch order. Whom it
 * tells is planned, the batch taken, and - when this run took any of it -
 * its owners told.
 */
async function notifyOfBatch(data: {
  group: OwnerNotificationGroup;
  page: OwnerNotificationPage;
  take: () => Promise<Array<Array<BaseModel>>>;
}): Promise<void> {
  const episodeId: ObjectID = data.group.recordId;
  const episodeMembers: Array<IncidentEpisodeMember> = inBatchOrder(
    (data.group.rows[0] || []) as Array<IncidentEpisodeMember>,
  );
  const projectId: ObjectID | undefined = episodeMembers[0]?.projectId;

  // Load episode metadata for the email: read with the page's episodes.
  const episode: IncidentEpisode | null = projectId
    ? await data.page.once(
        episodeKey(episodeId),
        (): Promise<IncidentEpisode | null> => {
          return readEpisode(episodeId);
        },
      )
    : null;

  // Load every added incident in one query.
  const incidents: Array<Incident> = episode
    ? await readIncidents(episodeMembers)
    : [];

  /*
   * Whom the batch is to tell - the episode's owners, or the project's
   * when it has none - written before the batch is taken: a worker
   * stopped from here on leaves them to be told by a later run, and one
   * stopped before the take leaves the batch to be read again.
   */
  const delivery: OwnerNotificationDelivery | null =
    projectId && episode && incidents.length > 0
      ? await OwnerNotificationDeliveries.planForOwnersOf({
          notification: {
            kind: OwnerNotificationKind.IncidentEpisodeIncidentAdded,
            projectId: projectId,
            resourceId: episodeId,
            eventId: episodeMembers[0]!.id!,
            occurrence: episodeMembers.length,
          },
          // Each read once for every batch of the page.
          findOwners: (): Promise<Array<User>> => {
            return data.page.once(`owners:${episodeId.toString()}`, () => {
              return IncidentEpisodeService.findOwners(episodeId);
            });
          },
          findProjectOwners: (): Promise<Array<User>> => {
            return data.page.once(
              `projectOwners:${projectId.toString()}`,
              () => {
                return ProjectService.getOwners(projectId);
              },
            );
          },
          writesFeedItem: true,
        })
      : null;

  /*
   * Mark everything in this batch as notified upfront. If the rest of
   * this run fails we don't want to retry-spam owners on the next cron
   * tick. A batch another run took all of tells nobody here: that run
   * tells its owners.
   */
  const taken: Array<BaseModel> = (await data.take()).flat();

  if (taken.length === 0 || !projectId || !episode || !delivery) {
    return;
  }

  try {
    await notifyOwnersOfIncidentsAdded({
      episode: episode,
      projectId: projectId,
      episodeMembers: episodeMembers,
      incidents: incidents,
      delivery: delivery,
    });
  } catch (e) {
    logger.error(
      "Error in sending incident-added-to-episode batch notification",
      {
        projectId: projectId?.toString(),
        incidentEpisodeId: episodeId?.toString(),
        batchSize: incidents.length,
      },
    );
    logger.error(e, {
      projectId: projectId?.toString(),
      incidentEpisodeId: episodeId?.toString(),
    });
  }
}

function episodeKey(episodeId: ObjectID): string {
  return `episode:${episodeId.toString()}`;
}

/*
 * The episodes of a page's batches, in one query: each is read once
 * however many batches of the page are of it.
 */
async function readEpisodesOfPage(
  episodeIds: Array<ObjectID>,
  page: OwnerNotificationPage,
): Promise<void> {
  const episodes: Array<IncidentEpisode> = await IncidentEpisodeService.findBy({
    query: {
      _id: QueryHelper.any(episodeIds),
    },
    select: EPISODE_SELECT,
    limit: episodeIds.length,
    skip: 0,
    props: {
      isRoot: true,
    },
  });

  /*
   * One not found - gone since its members were read - is read on its own
   * when its batch asks for it, as it would be without the page.
   */
  for (const each of episodes) {
    if (each.id) {
      page.prime<IncidentEpisode | null>(episodeKey(each.id), each);
    }
  }
}

async function readEpisode(
  episodeId: ObjectID,
): Promise<IncidentEpisode | null> {
  return await IncidentEpisodeService.findOneById({
    id: episodeId,
    props: {
      isRoot: true,
    },
    select: EPISODE_SELECT,
  });
}

// Every added incident of the batch, in one query.
async function readIncidents(
  episodeMembers: Array<IncidentEpisodeMember>,
): Promise<Array<Incident>> {
  const incidentIds: Array<ObjectID> = episodeMembers
    .map((m: IncidentEpisodeMember) => {
      return m.incidentId;
    })
    .filter((id: ObjectID | undefined): id is ObjectID => {
      return Boolean(id);
    });

  if (incidentIds.length === 0) {
    return [];
  }

  return await IncidentService.findBy({
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
      isPrivate: true,
      incidentNumber: true,
      incidentNumberWithPrefix: true,
      incidentSeverity: {
        name: true,
        color: true,
      },
    },
  });
}

/*
 * The batch a notification is of, read again: `size` of the episode's
 * notified member rows, from its first on (inBatchOrder).
 */
async function readBatch(data: {
  episodeId: ObjectID;
  firstMemberId: ObjectID;
  size: number;
}): Promise<Array<IncidentEpisodeMember>> {
  const first: IncidentEpisodeMember | null =
    await IncidentEpisodeMemberService.findOneById({
      id: data.firstMemberId,
      select: MEMBER_SELECT,
      props: {
        isRoot: true,
      },
    });

  if (!first?.createdAt) {
    return [];
  }

  const members: Array<IncidentEpisodeMember> =
    await IncidentEpisodeMemberService.findBy({
      query: {
        incidentEpisodeId: data.episodeId,
        isOwnerNotifiedOfIncidentAdded: true,
        createdAt: QueryHelper.greaterThanEqualTo(first.createdAt),
      },
      sort: {
        createdAt: SortOrder.Ascending,
      },
      // The rows added at the same moment as the first, in either order, too.
      limit: data.size * 2 + 10,
      skip: 0,
      select: MEMBER_SELECT,
      props: {
        isRoot: true,
      },
    });

  const ordered: Array<IncidentEpisodeMember> = inBatchOrder(members);
  const from: number = ordered.findIndex(
    (member: IncidentEpisodeMember): boolean => {
      return member.id?.toString() === data.firstMemberId.toString();
    },
  );

  return from < 0 ? [] : ordered.slice(from, from + data.size);
}

/*
 * Tells the delivery's owners of the incidents the batch added to the
 * episode, each once (OwnerNotificationDelivery.tell), and says in the
 * episode's feed whom it reached - those a stopped run told first among
 * them.
 */
async function notifyOwnersOfIncidentsAdded(data: {
  episode: IncidentEpisode;
  projectId: ObjectID;
  episodeMembers: Array<IncidentEpisodeMember>;
  incidents: Array<Incident>;
  delivery: OwnerNotificationDelivery;
}): Promise<void> {
  const episode: IncidentEpisode = data.episode;
  const projectId: ObjectID = data.projectId;
  const episodeId: ObjectID = episode.id!;
  const incidents: Array<Incident> = data.incidents;
  const delivery: OwnerNotificationDelivery = data.delivery;

  if (!delivery.hasWorkToDo) {
    return;
  }

  const doesResourceHasOwners: boolean = !delivery.isProjectOwners;

  const episodeNumberStr: string =
    episode.episodeNumberWithPrefix ||
    (episode.episodeNumber ? `#${episode.episodeNumber}` : "");
  const episodeDisplayNumber: string =
    episode.episodeNumberWithPrefix || "#" + episode.episodeNumber;

  const incidentCountInBatch: number = incidents.length;

  /*
   * Map incidentId -> addedAt for the in-email list. Some members may have
   * had no addedAt (defensive), so we fall back to createdAt.
   */
  const addedAtByIncidentId: Dictionary<Date> = {};
  for (const member of data.episodeMembers) {
    if (member.incidentId) {
      addedAtByIncidentId[member.incidentId.toString()] =
        member.addedAt || member.createdAt || OneUptimeDate.getCurrentDate();
    }
  }

  /*
   * Sort incidents by addedAt ascending so newest-at-bottom; truncate if
   * the batch is huge.
   */
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

  const truncated: boolean = sortedIncidents.length > MAX_INCIDENTS_IN_EMAIL;
  const incidentsToShow: Array<Incident> = truncated
    ? sortedIncidents.slice(0, MAX_INCIDENTS_IN_EMAIL)
    : sortedIncidents;
  const remainingCount: number = truncated
    ? sortedIncidents.length - MAX_INCIDENTS_IN_EMAIL
    : 0;

  const episodeViewLink: string = (
    await IncidentEpisodeService.getEpisodeLinkInDashboard(projectId, episodeId)
  ).toString();

  const episodeFeedText: string = OwnerNotificationFeedText.membersAdded({
    isProjectOwners: !doesResourceHasOwners,
    memberNoun: "incident",
    count: incidentCountInBatch,
  });

  // A person told, as the episode's feed names them.
  const feedLineMarkdown: (user: User) => string = (user: User): string => {
    return OwnerNotificationFeedText.notifiedLineMarkdown(
      mdText`${OwnerNotificationFeedText.personName(user)}, told of ${incidentCountInBatch === 1 ? "1 incident" : `${incidentCountInBatch} incidents`}`,
    );
  };

  // Whom a run that stopped part way told already.
  let moreEpisodeFeedInformationInMarkdown: string = delivery.toldEarlier
    .map(feedLineMarkdown)
    .join("");

  for (const user of delivery.owners) {
    const isTold: boolean = await delivery.tell(
      user,
      async (): Promise<void> => {
        /*
         * Build the per-incident list for the HBS template. addedAt is
         * pre-formatted per-recipient because timezone is per-user.
         */
        const incidentsForTemplate: Array<JSONObject> = await Promise.all(
          incidentsToShow.map(
            async (incident: Incident): Promise<JSONObject> => {
              const incidentLink: string = (
                await IncidentService.getIncidentLinkInDashboard(
                  projectId,
                  incident.id!,
                )
              ).toString();

              const incidentNumberStr: string =
                incident.incidentNumberWithPrefix ||
                (incident.incidentNumber ? `#${incident.incidentNumber}` : "");

              const incidentForTemplate: JSONObject = {
                incidentNumber: incidentNumberStr,
                incidentSeverity: incident.incidentSeverity?.name || "Not Set",
                ...EmailColorUtil.getTemplateVariables(
                  "incidentSeverity",
                  incident.incidentSeverity?.color,
                ),
                addedAt:
                  OneUptimeDate.getDateAsFormattedHTMLInMultipleTimezones({
                    date:
                      addedAtByIncidentId[incident.id!.toString()] ||
                      OneUptimeDate.getCurrentDate(),
                    timezones: user.timezone ? [user.timezone] : [],
                  }),
                incidentViewLink: incidentLink,
              };

              /*
               * A private incident is seen only by its own owners and the
               * project's owners and admins, and the episode's owners are
               * often none of those - the grouping engine adds private
               * incidents to episodes by itself. So its title never goes
               * into this email, whoever receives it, as IncidentAlertService
               * keeps a private end's title out of the other side's feed
               * entry. Its number and link are kept (opening the link is
               * subject to the incident's own privacy), and the template
               * names it "Private incident" where the title would be.
               */
              if (incident.isPrivate === true) {
                incidentForTemplate["isPrivate"] = "true";
              } else {
                incidentForTemplate["incidentTitle"] = incident.title || "";
              }

              return incidentForTemplate;
            },
          ),
        );

        const vars: Dictionary<string | JSONObject> = {
          episodeTitle: episode.title!,
          episodeNumber: episodeNumberStr,
          projectName: episode.project!.name!,
          currentState: episode.currentIncidentState?.name || "Not Set",
          ...EmailColorUtil.getTemplateVariables(
            "currentState",
            episode.currentIncidentState?.color,
          ),
          episodeSeverity: episode.incidentSeverity?.name || "Not Set",
          ...EmailColorUtil.getTemplateVariables(
            "episodeSeverity",
            episode.incidentSeverity?.color,
          ),
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
          isSubjectLiteral: true,
        };

        const summaryLine: string =
          incidentCountInBatch === 1
            ? `1 new incident was added to incident episode ${episodeNumberStr} (${episode.title}).`
            : `${incidentCountInBatch} new incidents were added to incident episode ${episodeNumberStr} (${episode.title}).`;

        const sms: SMSMessage = {
          message: buildNotificationSms(summaryLine),
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
      },
    );

    if (isTold) {
      moreEpisodeFeedInformationInMarkdown += feedLineMarkdown(user);
    }
  }

  /*
   * Written by the run that set out to tell the owners, or by the one that
   * took up the feed item a run that told them all left unwritten (#8510):
   * a run that found every owner told already writes none.
   */
  if (!delivery.isFeedItemToWrite) {
    return;
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

  await delivery.feedItemWritten();
}
