import DataMigrationBase from "./DataMigrationBase";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import ScheduledMaintenance from "Common/Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenanceService from "Common/Server/Services/ScheduledMaintenanceService";
import QueryHelper from "Common/Server/Types/Database/QueryHelper";
import OneUptimeDate from "Common/Types/Date";
import logger from "Common/Server/Utils/Logger";

export default class UpdateRemiderDateInScheduledEvent extends DataMigrationBase {
  public constructor() {
    super("UpdateRemiderDateInScheduledEvent");
  }

  public override async migrate(): Promise<void> {
    // get all the users with email isVerified true.

    const scheduledEvents: Array<ScheduledMaintenance> =
      await ScheduledMaintenanceService.findBy({
        query: {
          sendSubscriberNotificationsOnBeforeTheEvent: QueryHelper.notNull(),
          startsAt: QueryHelper.greaterThan(OneUptimeDate.getCurrentDate()),
        },
        props: {
          isRoot: true,
        },
        limit: LIMIT_MAX,
        skip: 0,
        select: {
          _id: true,
          startsAt: true,
          sendSubscriberNotificationsOnBeforeTheEvent: true,
          nextSubscriberNotificationBeforeTheEventAt: true,
          scheduledMaintenanceNumber: true,
        },
      });

    for (const event of scheduledEvents) {
      try {
        const nextSubscriberNotificationAt: Date | null =
          ScheduledMaintenanceService.getNextTimeToNotify({
            eventScheduledDate: event.startsAt!,
            sendSubscriberNotifiationsOn:
              event.sendSubscriberNotificationsOnBeforeTheEvent!,
          });

        await ScheduledMaintenanceService.updateOneById({
          id: event.id!,
          data: {
            nextSubscriberNotificationBeforeTheEventAt:
              nextSubscriberNotificationAt,
          },
          props: {
            isRoot: true,
          },
        });
      } catch (error) {
        logger.error(
          "ScheduledMaintenance:SendSubscriberRemindersOnEventScheduled: Error while sending notification for event: ",
        );
        logger.error(error);
      }
    }
  }

  public override async rollback(): Promise<void> {
    return;
  }
}
