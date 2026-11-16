import User from "../../../Models/DatabaseModels/User";
import UserOnCallLogTimeline from "../../../Models/DatabaseModels/UserOnCallLogTimeline";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import { OwnerNotificationKind } from "../../../Types/Notification/OwnerNotificationDelivery";
import ObjectID from "../../../Types/ObjectID";
import { isOnCallPageNotificationOut } from "../../../Types/OnCallDutyPolicy/OnCallPageChannel";
import UserNotificationStatus from "../../../Types/UserNotification/UserNotificationStatus";
import UserOnCallLogTimelineService from "../../Services/UserOnCallLogTimelineService";
import Query from "../../Types/Database/Query";
import QueryHelper from "../../Types/Database/QueryHelper";
import logger, { LogAttributes } from "../Logger";
import { OwnerNotificationOf } from "./OwnerNotificationDeliveries";

/*
 * ONE NOTIFICATION FOR A NEW ALERT, NOT TWO (#7987).
 *
 * A new incident, alert or episode reaches people in two ways. Its on-call
 * policies page whoever is on call as it is created, through each person's
 * own On-Call Rules ("ACTION REQUIRED: Alert ALT-1 created"). And about a
 * minute later its owners - or the Project Owners, standing in for a record
 * that has none - are told it was created, by the owners' Created job
 * ("[New Alert ALT-1]"). Someone who is both got two notifications a minute
 * apart with the same facts: the one person of a new project, its owner, on
 * call through the "Default on-call policy" the guided setup made. A
 * newcomer read the second as a second alert.
 *
 * So the Created jobs of incidents, alerts and their episodes leave out of
 * the owners' notification each owner a page about that same record has
 * reached already: one with a notification of the page (a row of their
 * on-call timeline, UserOnCallLogTimeline, naming the record) that went out
 * - sending, sent, acknowledged, passed on, or a call that rang
 * (isOnCallPageNotificationOut). Any page counts - a policy's, an
 * observer's, a direct page: each told them of the record.
 *
 * Nobody may miss being told because of it. Everyone a page has not reached
 * is told as before: someone whose page is held for working hours or for
 * OneUptime AI (it has sent nothing yet), whose rules skipped it (opted out
 * of the severity, no rules and no fallback), whose page failed, whose first
 * rule waits longer than the job does, or who was not paged at all. And a
 * read that fails leaves nobody out.
 *
 * It is read once per record, for all its owners, right before the job
 * writes down whom it is to tell (OwnerNotificationDeliveries.plan's
 * leaveOut): those left out get no row, so a later run that takes up what a
 * stopped one left never tells them either. The record's feed entry says
 * who they were, apart from those it notified
 * (OwnerNotificationFeedText.reachedByPageMarkdown).
 *
 * Only a record's "created" notification is left out so: a page tells of
 * the record being created, and of nothing that happens to it later - a
 * state change, a note or a reminder is told to every owner as before.
 */

// The on-call timeline columns that name the record a page was about.
type PagedRecordColumn =
  | "triggeredByIncidentId"
  | "triggeredByAlertId"
  | "triggeredByIncidentEpisodeId"
  | "triggeredByAlertEpisodeId";

/*
 * The column naming the record of each notification a page tells of too: a
 * record's "created" notification. Of every other notification, a page says
 * nothing, and nobody is left out.
 */
export const PAGED_RECORD_COLUMN_OF: Partial<
  Record<OwnerNotificationKind, PagedRecordColumn>
> = {
  [OwnerNotificationKind.IncidentCreated]: "triggeredByIncidentId",
  [OwnerNotificationKind.AlertCreated]: "triggeredByAlertId",
  [OwnerNotificationKind.IncidentEpisodeCreated]:
    "triggeredByIncidentEpisodeId",
  [OwnerNotificationKind.AlertEpisodeCreated]: "triggeredByAlertEpisodeId",
};

/*
 * The statuses of a notification of a page that went out to its person, as
 * isOnCallPageNotificationOut names them - read from it, so the two never
 * part ways. One held, skipped, failed or not sent yet is not among them.
 */
export const ON_CALL_PAGE_STATUSES_OUT: ReadonlyArray<UserNotificationStatus> =
  Object.values(UserNotificationStatus).filter(
    (status: UserNotificationStatus): boolean => {
      return isOnCallPageNotificationOut(status);
    },
  );

function idKey(id: ObjectID | string | null | undefined): string {
  return (id?.toString() || "").toLowerCase();
}

export default class OwnersReachedByAPage {
  /*
   * Of the owners a record's "created" notification is to tell, those a
   * page about the record has reached already, in the order given: read in
   * one query for them all. None for any other notification. Never throws:
   * should the read fail, it says so and leaves nobody out, so every owner
   * is told, as before.
   */
  public static async findAmong(data: {
    notification: OwnerNotificationOf;
    owners: Array<User>;
  }): Promise<Array<User>> {
    const column: PagedRecordColumn | undefined =
      PAGED_RECORD_COLUMN_OF[data.notification.kind];

    const userIds: Array<ObjectID> = data.owners
      .map((owner: User): ObjectID | undefined => {
        return owner.id || undefined;
      })
      .filter((userId: ObjectID | undefined): userId is ObjectID => {
        return Boolean(userId);
      });

    if (!column || userIds.length === 0) {
      return [];
    }

    let reached: Set<string>;

    try {
      const query: Query<UserOnCallLogTimeline> = {
        projectId: data.notification.projectId,
        userId: QueryHelper.any(userIds),
        status: QueryHelper.any([...ON_CALL_PAGE_STATUSES_OUT]),
      };

      query[column] = data.notification.resourceId;

      const notifications: Array<UserOnCallLogTimeline> =
        await UserOnCallLogTimelineService.findBy({
          query: query,
          select: {
            userId: true,
            status: true,
          },
          skip: 0,
          limit: LIMIT_PER_PROJECT,
          props: {
            isRoot: true,
          },
        });

      reached = new Set<string>(
        notifications
          .filter((notification: UserOnCallLogTimeline): boolean => {
            return isOnCallPageNotificationOut(notification.status);
          })
          .map((notification: UserOnCallLogTimeline): string => {
            return idKey(notification.userId);
          }),
      );
    } catch (error) {
      logger.error(
        `Could not read whom the on-call page of ${data.notification.kind} ${data.notification.resourceId.toString()} reached: ${error}. Telling every owner.`,
        {
          projectId: data.notification.projectId.toString(),
          ownerNotificationKind: data.notification.kind,
          resourceId: data.notification.resourceId.toString(),
        } as LogAttributes,
      );

      return [];
    }

    return data.owners.filter((owner: User): boolean => {
      const key: string = idKey(owner.id);

      return Boolean(key) && reached.has(key);
    });
  }
}
