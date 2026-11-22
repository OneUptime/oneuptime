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
import AlertEpisodeService from "Common/Server/Services/AlertEpisodeService";
import AlertEpisodeMemberService from "Common/Server/Services/AlertEpisodeMemberService";
import AlertService from "Common/Server/Services/AlertService";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";
import UserNotificationSettingService from "Common/Server/Services/UserNotificationSettingService";
import PushNotificationUtil from "Common/Server/Utils/PushNotificationUtil";
import Select from "Common/Server/Types/Database/Select";
import logger from "Common/Server/Utils/Logger";
import Alert from "Common/Models/DatabaseModels/Alert";
import AlertEpisode from "Common/Models/DatabaseModels/AlertEpisode";
import AlertEpisodeMember from "Common/Models/DatabaseModels/AlertEpisodeMember";
import AlertState from "Common/Models/DatabaseModels/AlertState";
import Project from "Common/Models/DatabaseModels/Project";
import User from "Common/Models/DatabaseModels/User";
import { AlertEpisodeFeedEventType } from "Common/Models/DatabaseModels/AlertEpisodeFeed";
import { Yellow500 } from "Common/Types/BrandColors";
import AlertEpisodeFeedService from "Common/Server/Services/AlertEpisodeFeedService";
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
 * Cap the number of alerts we list inline in the email body. Anything
 * beyond this gets summarized as "and N more" so the email stays readable.
 */
const MAX_ALERTS_IN_EMAIL: number = 25;

// What a member row is read with.
const MEMBER_SELECT: Select<AlertEpisodeMember> = {
  _id: true,
  projectId: true,
  alertId: true,
  alertEpisodeId: true,
  addedAt: true,
  createdAt: true,
};

// What the episode is read with.
const EPISODE_SELECT: Select<AlertEpisode> = {
  _id: true,
  title: true,
  projectId: true,
  project: {
    name: true,
  } as Select<Project>,
  currentAlertState: {
    name: true,
    color: true,
  } as Select<AlertState>,
  alertSeverity: {
    name: true,
    color: true,
  },
  episodeNumber: true,
  episodeNumberWithPrefix: true,
};

/*
 * ONE NOTIFICATION PER BATCH (#8509). Each run tells each owner of an
 * episode once of every alert added to it since the last run: the batch.
 * The notification is the batch's first member row (by when it was added,
 * then its id) and its size, so a later run that tells the owners a stopped
 * run left reads the same batch again: that many of the episode's notified
 * member rows, from the first on.
 */
function inBatchOrder(
  members: Array<AlertEpisodeMember>,
): Array<AlertEpisodeMember> {
  return [...members].sort(
    (a: AlertEpisodeMember, b: AlertEpisodeMember): number => {
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
  "AlertEpisodeOwner:SendAlertAddedEmail",
  { schedule: EVERY_MINUTE, runOnStartup: false },
  async (deadline: JobDeadline = JobDeadline.none()): Promise<void> => {
    /*
     * The owners a run that stopped part way left untold - a worker killed
     * between the take and the last owner (#8509) - told first, exactly
     * them, of the same batch, and the feed item a run that told them all
     * left unwritten (#8510) (OwnerNotificationDeliveries).
     */
    await OwnerNotificationDeliveries.resume({
      kinds: [OwnerNotificationKind.AlertEpisodeAlertAdded],
      notify: async (delivery: OwnerNotificationDelivery): Promise<void> => {
        const episodeMembers: Array<AlertEpisodeMember> = await readBatch({
          episodeId: delivery.notification.resourceId,
          firstMemberId: delivery.notification.eventId,
          size: delivery.notification.occurrence,
        });

        const episode: AlertEpisode | null =
          episodeMembers.length > 0
            ? await readEpisode(delivery.notification.resourceId)
            : null;

        const alerts: Array<Alert> = episode
          ? await readAlerts(episodeMembers)
          : [];

        if (!episode || alerts.length === 0) {
          await delivery.giveUp(
            "the alert episode or the alerts added to it are gone",
          );
          return;
        }

        await notifyOwnersOfAlertsAdded({
          episode: episode,
          projectId: delivery.notification.projectId,
          episodeMembers: episodeMembers,
          alerts: alerts,
          delivery: delivery,
        });
      },
    });

    /*
     * Every episode's alerts added since its last batch, a page at a time,
     * oldest first: an episode's members still to tell are one batch, told
     * of in one notification - each owner gets ONE notification per episode
     * per run, however many alerts landed - and each member row is taken
     * by one run alone. The run stops between batches at its deadline and
     * the next carries on (OwnerNotificationBacklog.forEachGroupToNotify,
     * issue #8862).
     */
    await OwnerNotificationBacklog.forEachGroupToNotify({
      jobName: "AlertEpisodeOwner:SendAlertAddedEmail",
      recordIdColumn: "alertEpisodeId",
      tables: [
        OwnerNotificationBacklog.groupTable<AlertEpisodeMember>({
          service: AlertEpisodeMemberService,
          notYetNotified: {
            isOwnerNotifiedOfAlertAdded: false,
          },
          notified: {
            isOwnerNotifiedOfAlertAdded: true,
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
  const episodeMembers: Array<AlertEpisodeMember> = inBatchOrder(
    (data.group.rows[0] || []) as Array<AlertEpisodeMember>,
  );
  const projectId: ObjectID | undefined = episodeMembers[0]?.projectId;

  // Load episode metadata for the email: read with the page's episodes.
  const episode: AlertEpisode | null = projectId
    ? await data.page.once(
        episodeKey(episodeId),
        (): Promise<AlertEpisode | null> => {
          return readEpisode(episodeId);
        },
      )
    : null;

  // Load every added alert in one query.
  const alerts: Array<Alert> = episode ? await readAlerts(episodeMembers) : [];

  /*
   * Whom the batch is to tell - the episode's owners, or the project's
   * when it has none - written before the batch is taken: a worker
   * stopped from here on leaves them to be told by a later run, and one
   * stopped before the take leaves the batch to be read again.
   */
  const delivery: OwnerNotificationDelivery | null =
    projectId && episode && alerts.length > 0
      ? await OwnerNotificationDeliveries.planForOwnersOf({
          notification: {
            kind: OwnerNotificationKind.AlertEpisodeAlertAdded,
            projectId: projectId,
            resourceId: episodeId,
            eventId: episodeMembers[0]!.id!,
            occurrence: episodeMembers.length,
          },
          // Each read once for every batch of the page.
          findOwners: (): Promise<Array<User>> => {
            return data.page.once(`owners:${episodeId.toString()}`, () => {
              return AlertEpisodeService.findOwners(episodeId);
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
    await notifyOwnersOfAlertsAdded({
      episode: episode,
      projectId: projectId,
      episodeMembers: episodeMembers,
      alerts: alerts,
      delivery: delivery,
    });
  } catch (e) {
    logger.error("Error in sending alert-added-to-episode batch notification", {
      projectId: projectId?.toString(),
      alertEpisodeId: episodeId?.toString(),
      batchSize: alerts.length,
    });
    logger.error(e, {
      projectId: projectId?.toString(),
      alertEpisodeId: episodeId?.toString(),
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
  const episodes: Array<AlertEpisode> = await AlertEpisodeService.findBy({
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
      page.prime<AlertEpisode | null>(episodeKey(each.id), each);
    }
  }
}

async function readEpisode(episodeId: ObjectID): Promise<AlertEpisode | null> {
  return await AlertEpisodeService.findOneById({
    id: episodeId,
    props: {
      isRoot: true,
    },
    select: EPISODE_SELECT,
  });
}

// Every added alert of the batch, in one query.
async function readAlerts(
  episodeMembers: Array<AlertEpisodeMember>,
): Promise<Array<Alert>> {
  const alertIds: Array<ObjectID> = episodeMembers
    .map((m: AlertEpisodeMember) => {
      return m.alertId;
    })
    .filter((id: ObjectID | undefined): id is ObjectID => {
      return Boolean(id);
    });

  if (alertIds.length === 0) {
    return [];
  }

  return await AlertService.findBy({
    query: {
      _id: QueryHelper.any(alertIds),
    },
    props: {
      isRoot: true,
    },
    skip: 0,
    limit: alertIds.length,
    select: {
      _id: true,
      title: true,
      isPrivate: true,
      alertNumber: true,
      alertNumberWithPrefix: true,
      alertSeverity: {
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
}): Promise<Array<AlertEpisodeMember>> {
  const first: AlertEpisodeMember | null =
    await AlertEpisodeMemberService.findOneById({
      id: data.firstMemberId,
      select: MEMBER_SELECT,
      props: {
        isRoot: true,
      },
    });

  if (!first?.createdAt) {
    return [];
  }

  const members: Array<AlertEpisodeMember> =
    await AlertEpisodeMemberService.findBy({
      query: {
        alertEpisodeId: data.episodeId,
        isOwnerNotifiedOfAlertAdded: true,
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

  const ordered: Array<AlertEpisodeMember> = inBatchOrder(members);
  const from: number = ordered.findIndex(
    (member: AlertEpisodeMember): boolean => {
      return member.id?.toString() === data.firstMemberId.toString();
    },
  );

  return from < 0 ? [] : ordered.slice(from, from + data.size);
}

/*
 * Tells the delivery's owners of the alerts the batch added to the
 * episode, each once (OwnerNotificationDelivery.tell), and says in the
 * episode's feed whom it reached - those a stopped run told first among
 * them.
 */
async function notifyOwnersOfAlertsAdded(data: {
  episode: AlertEpisode;
  projectId: ObjectID;
  episodeMembers: Array<AlertEpisodeMember>;
  alerts: Array<Alert>;
  delivery: OwnerNotificationDelivery;
}): Promise<void> {
  const episode: AlertEpisode = data.episode;
  const projectId: ObjectID = data.projectId;
  const episodeId: ObjectID = episode.id!;
  const alerts: Array<Alert> = data.alerts;
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

  const alertCountInBatch: number = alerts.length;

  /*
   * Map alertId -> addedAt for the in-email list. Some members may have
   * had no addedAt (defensive), so we fall back to createdAt.
   */
  const addedAtByAlertId: Dictionary<Date> = {};
  for (const member of data.episodeMembers) {
    if (member.alertId) {
      addedAtByAlertId[member.alertId.toString()] =
        member.addedAt || member.createdAt || OneUptimeDate.getCurrentDate();
    }
  }

  /*
   * Sort alerts by addedAt ascending so newest-at-bottom; truncate if
   * the batch is huge.
   */
  const sortedAlerts: Array<Alert> = [...alerts].sort((a: Alert, b: Alert) => {
    const aTime: number = (
      addedAtByAlertId[a.id!.toString()] || new Date(0)
    ).getTime();
    const bTime: number = (
      addedAtByAlertId[b.id!.toString()] || new Date(0)
    ).getTime();
    return aTime - bTime;
  });

  const truncated: boolean = sortedAlerts.length > MAX_ALERTS_IN_EMAIL;
  const alertsToShow: Array<Alert> = truncated
    ? sortedAlerts.slice(0, MAX_ALERTS_IN_EMAIL)
    : sortedAlerts;
  const remainingCount: number = truncated
    ? sortedAlerts.length - MAX_ALERTS_IN_EMAIL
    : 0;

  const episodeViewLink: string = (
    await AlertEpisodeService.getEpisodeLinkInDashboard(projectId, episodeId)
  ).toString();

  const episodeFeedText: string = OwnerNotificationFeedText.membersAdded({
    isProjectOwners: !doesResourceHasOwners,
    memberNoun: "alert",
    count: alertCountInBatch,
  });

  // A person told, as the episode's feed names them.
  const feedLineMarkdown: (user: User) => string = (user: User): string => {
    return OwnerNotificationFeedText.notifiedLineMarkdown(
      mdText`${OwnerNotificationFeedText.personName({
        name: user.name?.toString(),
        email: user.email?.toString(),
      })}, told of ${alertCountInBatch === 1 ? "1 alert" : `${alertCountInBatch} alerts`}`,
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
         * Build the per-alert list for the HBS template. addedAt is
         * pre-formatted per-recipient because timezone is per-user.
         */
        const alertsForTemplate: Array<JSONObject> = await Promise.all(
          alertsToShow.map(async (alert: Alert): Promise<JSONObject> => {
            const alertLink: string = (
              await AlertService.getAlertLinkInDashboard(projectId, alert.id!)
            ).toString();

            const alertNumberStr: string =
              alert.alertNumberWithPrefix ||
              (alert.alertNumber ? `#${alert.alertNumber}` : "");

            const alertForTemplate: JSONObject = {
              alertNumber: alertNumberStr,
              alertSeverity: alert.alertSeverity?.name || "Not Set",
              ...EmailColorUtil.getTemplateVariables(
                "alertSeverity",
                alert.alertSeverity?.color,
              ),
              addedAt: OneUptimeDate.getDateAsFormattedHTMLInMultipleTimezones({
                date:
                  addedAtByAlertId[alert.id!.toString()] ||
                  OneUptimeDate.getCurrentDate(),
                timezones: user.timezone ? [user.timezone] : [],
              }),
              alertViewLink: alertLink,
            };

            /*
             * A private alert is seen only by its own owners and the
             * project's owners and admins, and the episode's owners are
             * often none of those - the grouping engine adds private
             * alerts to episodes by itself. So its title never goes
             * into this email, whoever receives it, as IncidentAlertService
             * keeps a private end's title out of the other side's feed
             * entry. Its number and link are kept (opening the link is
             * subject to the alert's own privacy), and the template
             * names it "Private alert" where the title would be.
             */
            if (alert.isPrivate === true) {
              alertForTemplate["isPrivate"] = "true";
            } else {
              alertForTemplate["alertTitle"] = alert.title || "";
            }

            return alertForTemplate;
          }),
        );

        const vars: Dictionary<string | JSONObject> = {
          episodeTitle: episode.title!,
          episodeNumber: episodeNumberStr,
          projectName: episode.project!.name!,
          currentState: episode.currentAlertState?.name || "Not Set",
          ...EmailColorUtil.getTemplateVariables(
            "currentState",
            episode.currentAlertState?.color,
          ),
          episodeSeverity: episode.alertSeverity?.name || "Not Set",
          ...EmailColorUtil.getTemplateVariables(
            "episodeSeverity",
            episode.alertSeverity?.color,
          ),
          alertCount: alertCountInBatch.toString(),
          alertCountLabel: alertCountInBatch === 1 ? "alert" : "alerts",
          remainingCount: remainingCount.toString(),
          hasMore: remainingCount > 0 ? "true" : "false",
          alerts: alertsForTemplate as unknown as JSONObject,
          episodeViewLink: episodeViewLink,
        };

        if (doesResourceHasOwners === true) {
          vars["isOwner"] = "true";
        }

        const subjectAlertLabel: string =
          alertCountInBatch === 1
            ? `1 new alert`
            : `${alertCountInBatch} new alerts`;

        const emailMessage: EmailEnvelope = {
          templateType: EmailTemplateType.AlertEpisodeOwnerAlertAdded,
          vars: vars,
          subject: `[Episode ${episodeNumberStr}] ${subjectAlertLabel} added - ${episode.title!}`,
          isSubjectLiteral: true,
        };

        const summaryLine: string =
          alertCountInBatch === 1
            ? `1 new alert was added to alert episode ${episodeNumberStr} (${episode.title}).`
            : `${alertCountInBatch} new alerts were added to alert episode ${episodeNumberStr} (${episode.title}).`;

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
            title: `${subjectAlertLabel} added to Episode ${episodeNumberStr}`,
            body: `${summaryLine} Click to view the episode.`,
            clickAction: episodeViewLink,
            tag: "alert-added-to-episode",
            requireInteraction: false,
          });

        const eventType: NotificationSettingEventType =
          NotificationSettingEventType.SEND_ALERT_ADDED_TO_EPISODE_OWNER_NOTIFICATION;

        const whatsAppMessage: WhatsAppMessagePayload =
          createWhatsAppMessageFromTemplate({
            eventType,
            templateVariables: {
              episode_title: episode.title!,
              episode_number: episodeDisplayNumber,
              episode_link: episodeViewLink,
              alert_count: alertCountInBatch.toString(),
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
          alertEpisodeId: episodeId,
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

  await AlertEpisodeFeedService.createAlertEpisodeFeedItem({
    alertEpisodeId: episodeId,
    projectId: projectId,
    alertEpisodeFeedEventType: AlertEpisodeFeedEventType.OwnerNotificationSent,
    displayColor: Yellow500,
    feedInfoInMarkdown: episodeFeedText,
    moreInformationInMarkdown: moreEpisodeFeedInformationInMarkdown,
  });

  await delivery.feedItemWritten();
}
