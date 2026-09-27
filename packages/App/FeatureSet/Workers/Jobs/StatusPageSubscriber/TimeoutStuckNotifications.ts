import RunCron from "../../Utils/Cron";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import OneUptimeDate from "Common/Types/Date";
import ObjectID from "Common/Types/ObjectID";
import StatusPageSubscriberNotificationStatus from "Common/Types/StatusPage/StatusPageSubscriberNotificationStatus";
import SubscriberNotificationInterruption from "Common/Types/StatusPage/SubscriberNotificationInterruption";
import { EVERY_FIVE_MINUTE } from "Common/Utils/CronTime";
import DatabaseService from "Common/Server/Services/DatabaseService";
import IncidentEpisodePublicNoteService from "Common/Server/Services/IncidentEpisodePublicNoteService";
import IncidentEpisodeService from "Common/Server/Services/IncidentEpisodeService";
import IncidentEpisodeStateTimelineService from "Common/Server/Services/IncidentEpisodeStateTimelineService";
import IncidentPublicNoteService from "Common/Server/Services/IncidentPublicNoteService";
import IncidentService from "Common/Server/Services/IncidentService";
import IncidentStateTimelineService from "Common/Server/Services/IncidentStateTimelineService";
import ScheduledMaintenancePublicNoteService from "Common/Server/Services/ScheduledMaintenancePublicNoteService";
import ScheduledMaintenanceService from "Common/Server/Services/ScheduledMaintenanceService";
import ScheduledMaintenanceStateTimelineService from "Common/Server/Services/ScheduledMaintenanceStateTimelineService";
import StatusPageAnnouncementService from "Common/Server/Services/StatusPageAnnouncementService";
import Query from "Common/Server/Types/Database/Query";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";
import Select from "Common/Server/Types/Database/Select";
import SubscriberNotificationClaim from "Common/Server/Utils/StatusPage/SubscriberNotificationClaim";
import SubscriberNotificationTiming from "Common/Server/Utils/StatusPage/SubscriberNotificationTiming";
import logger from "Common/Server/Utils/Logger";

/*
 * A status page subscriber notification is sent by a queue job that claims
 * it (Pending to InProgress) and settles it when it is done: Success, or
 * Failed with what was sent and what failed. Kill the worker in between - a
 * deploy, an OOM, a node eviction, a lost database connection - and nothing
 * is left to settle it. The jobs only pick up Pending rows, so the row says
 * "Notifications being sent" forever, and nobody can retry it: the dashboard
 * offers Retry only on a Failed one.
 *
 * This sweep is the backstop. A notification In progress for longer than
 * SubscriberNotificationTiming.STUCK_AFTER_IN_MS - the job timeout plus a
 * margin - cannot still be sending: a live send stops starting messages at
 * the end of its send window and settles within the job's timeout. So it is
 * marked Failed, with a message that starts "Interrupted:" and says what
 * Retry will do (SubscriberNotificationInterruption):
 *
 * - The incident created notification records the pages it has told as it
 *   goes (Incident.statusPagesNotifiedOnCreation), so Retry resumes after
 *   them. A page part-way through when the send stopped is sent again in
 *   full: progress is kept per page, not per subscriber.
 * - Every other notification is sent again to every page.
 *
 * The InProgress time is read off updatedAt, which the claim stamps. A row
 * edited since (an incident whose title changed, say) is only swept later,
 * never sooner. Each row is failed with a compare-and-set on its status and
 * version, so a send that settles at the last moment is never overwritten.
 *
 * Covered: the incident and episode notifications this build awaits (the
 * incident created, state change, public note created and updated,
 * postmortem, and episode created, state change and public note ones), and
 * the scheduled maintenance and announcement ones. Those last still hand
 * their messages off without waiting, so their sends finish in seconds, but
 * a worker that dies between the claim and the settle strands them the same
 * way, and the threshold is far past anything a live send of theirs takes.
 */

// Bound the work per table per tick, so one bad backlog cannot monopolise the Worker queue.
export const MAX_STUCK_NOTIFICATIONS_PER_TABLE: number = 100;

interface StuckNotificationColumn {
  // What the log calls it.
  name: string;
  // The rows InProgress since before the cutoff, at most `limit` of them.
  findStuck: (data: {
    cutoff: Date;
    limit: number;
  }) => Promise<Array<{ id: ObjectID; version: number | undefined }>>;
  // Fail one, if it is still InProgress at that version.
  failInterrupted: (row: {
    id: ObjectID;
    version: number | undefined;
  }) => Promise<boolean>;
}

function stuckNotificationColumn<TBaseModel extends BaseModel>(data: {
  name: string;
  service: DatabaseService<TBaseModel>;
  statusColumn: keyof TBaseModel & string;
  messageColumn: keyof TBaseModel & string;
  message: string;
}): StuckNotificationColumn {
  return {
    name: data.name,
    findStuck: async (query: {
      cutoff: Date;
      limit: number;
    }): Promise<Array<{ id: ObjectID; version: number | undefined }>> => {
      const rows: Array<TBaseModel> = await data.service.findBy({
        query: {
          [data.statusColumn]:
            StatusPageSubscriberNotificationStatus.InProgress,
          updatedAt: QueryHelper.lessThan(query.cutoff),
        } as Query<TBaseModel>,
        select: {
          _id: true,
          version: true,
        } as Select<TBaseModel>,
        limit: query.limit,
        skip: 0,
        props: {
          isRoot: true,
        },
      });

      return rows
        .filter((row: TBaseModel): boolean => {
          return Boolean(row.id);
        })
        .map(
          (row: TBaseModel): { id: ObjectID; version: number | undefined } => {
            return { id: row.id!, version: row.version };
          },
        );
    },
    failInterrupted: async (row: {
      id: ObjectID;
      version: number | undefined;
    }): Promise<boolean> => {
      return await SubscriberNotificationClaim.failInterrupted({
        service: data.service,
        id: row.id,
        statusColumn: data.statusColumn,
        messageColumn: data.messageColumn,
        message: data.message,
        version: row.version,
      });
    },
  };
}

export const STUCK_NOTIFICATION_COLUMNS: Array<StuckNotificationColumn> = [
  stuckNotificationColumn({
    name: "incident created",
    service: IncidentService,
    statusColumn: "subscriberNotificationStatusOnIncidentCreated",
    messageColumn: "subscriberNotificationStatusMessage",
    message: SubscriberNotificationInterruption.resumesMessage,
  }),
  stuckNotificationColumn({
    name: "incident postmortem",
    service: IncidentService,
    statusColumn: "subscriberNotificationStatusOnPostmortemPublished",
    messageColumn: "subscriberNotificationStatusMessageOnPostmortemPublished",
    message: SubscriberNotificationInterruption.resendsMessage,
  }),
  stuckNotificationColumn({
    name: "incident state change",
    service: IncidentStateTimelineService,
    statusColumn: "subscriberNotificationStatus",
    messageColumn: "subscriberNotificationStatusMessage",
    message: SubscriberNotificationInterruption.resendsMessage,
  }),
  stuckNotificationColumn({
    name: "incident public note created",
    service: IncidentPublicNoteService,
    statusColumn: "subscriberNotificationStatusOnNoteCreated",
    messageColumn: "subscriberNotificationStatusMessage",
    message: SubscriberNotificationInterruption.resendsMessage,
  }),
  stuckNotificationColumn({
    name: "incident public note updated",
    service: IncidentPublicNoteService,
    statusColumn: "subscriberNotificationStatusOnNoteUpdated",
    messageColumn: "subscriberNotificationStatusMessageOnNoteUpdated",
    message: SubscriberNotificationInterruption.resendsMessage,
  }),
  stuckNotificationColumn({
    name: "episode created",
    service: IncidentEpisodeService,
    statusColumn: "subscriberNotificationStatusOnEpisodeCreated",
    messageColumn: "subscriberNotificationStatusMessage",
    message: SubscriberNotificationInterruption.resendsMessage,
  }),
  stuckNotificationColumn({
    name: "episode state change",
    service: IncidentEpisodeStateTimelineService,
    statusColumn: "subscriberNotificationStatus",
    messageColumn: "subscriberNotificationStatusMessage",
    message: SubscriberNotificationInterruption.resendsMessage,
  }),
  stuckNotificationColumn({
    name: "episode public note created",
    service: IncidentEpisodePublicNoteService,
    statusColumn: "subscriberNotificationStatusOnNoteCreated",
    messageColumn: "subscriberNotificationStatusMessage",
    message: SubscriberNotificationInterruption.resendsMessage,
  }),
  stuckNotificationColumn({
    name: "episode public note updated",
    service: IncidentEpisodePublicNoteService,
    statusColumn: "subscriberNotificationStatusOnNoteUpdated",
    messageColumn: "subscriberNotificationStatusMessageOnNoteUpdated",
    message: SubscriberNotificationInterruption.resendsMessage,
  }),
  stuckNotificationColumn({
    name: "scheduled maintenance created",
    service: ScheduledMaintenanceService,
    statusColumn: "subscriberNotificationStatusOnEventScheduled",
    messageColumn: "subscriberNotificationStatusMessage",
    message: SubscriberNotificationInterruption.resendsMessage,
  }),
  stuckNotificationColumn({
    name: "scheduled maintenance state change",
    service: ScheduledMaintenanceStateTimelineService,
    statusColumn: "subscriberNotificationStatus",
    messageColumn: "subscriberNotificationStatusMessage",
    message: SubscriberNotificationInterruption.resendsMessage,
  }),
  stuckNotificationColumn({
    name: "scheduled maintenance public note created",
    service: ScheduledMaintenancePublicNoteService,
    statusColumn: "subscriberNotificationStatusOnNoteCreated",
    messageColumn: "subscriberNotificationStatusMessage",
    message: SubscriberNotificationInterruption.resendsMessage,
  }),
  stuckNotificationColumn({
    name: "scheduled maintenance public note updated",
    service: ScheduledMaintenancePublicNoteService,
    statusColumn: "subscriberNotificationStatusOnNoteUpdated",
    messageColumn: "subscriberNotificationStatusMessageOnNoteUpdated",
    message: SubscriberNotificationInterruption.resendsMessage,
  }),
  stuckNotificationColumn({
    name: "announcement created",
    service: StatusPageAnnouncementService,
    statusColumn: "subscriberNotificationStatus",
    messageColumn: "subscriberNotificationStatusMessage",
    message: SubscriberNotificationInterruption.resendsMessage,
  }),
  stuckNotificationColumn({
    name: "announcement updated",
    service: StatusPageAnnouncementService,
    statusColumn: "subscriberNotificationStatusOnAnnouncementUpdated",
    messageColumn: "subscriberNotificationStatusMessageOnAnnouncementUpdated",
    message: SubscriberNotificationInterruption.resendsMessage,
  }),
];

RunCron(
  "StatusPageSubscriber:TimeoutStuckNotifications",
  { schedule: EVERY_FIVE_MINUTE, runOnStartup: false },
  async () => {
    const cutoff: Date = new Date(
      OneUptimeDate.getCurrentDate().getTime() -
        SubscriberNotificationTiming.STUCK_AFTER_IN_MS,
    );

    for (const column of STUCK_NOTIFICATION_COLUMNS) {
      let stuck: Array<{ id: ObjectID; version: number | undefined }> = [];

      try {
        stuck = await column.findStuck({
          cutoff: cutoff,
          limit: MAX_STUCK_NOTIFICATIONS_PER_TABLE,
        });
      } catch (err) {
        logger.error(
          `Failed to look for ${column.name} subscriber notifications stuck in progress:`,
          { service: "workers" },
        );
        logger.error(err, { service: "workers" });
        continue;
      }

      for (const row of stuck) {
        try {
          const failed: boolean = await column.failInterrupted(row);

          if (failed) {
            logger.warn(
              `The ${column.name} subscriber notification of ${row.id.toString()} was in progress since before ${cutoff.toISOString()} and has been marked Failed as interrupted.`,
              { service: "workers" },
            );
          }
        } catch (err) {
          logger.error(
            `Failed to mark the ${column.name} subscriber notification of ${row.id.toString()} as interrupted:`,
            { service: "workers" },
          );
          logger.error(err, { service: "workers" });
        }
      }
    }
  },
);
