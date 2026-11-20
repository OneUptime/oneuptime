import ScheduledMaintenance from "../../../Models/DatabaseModels/ScheduledMaintenance";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import NotFoundException from "../../../Types/Exception/NotFoundException";
import ObjectID from "../../../Types/ObjectID";
import ScheduledMaintenancePublication, {
  ScheduledMaintenancePublicationState,
} from "../../../Types/ScheduledMaintenance/ScheduledMaintenancePublication";
import {
  PublicNoteNothingSentReason,
  PublicNoteReachEvent,
  PublicNoteReachResult,
} from "../../../Types/StatusPage/PublicNoteReach";
import ScheduledMaintenanceService from "../../Services/ScheduledMaintenanceService";
import StatusPageSubscriberService from "../../Services/StatusPageSubscriberService";
import PublicNoteReachBuilder from "../StatusPage/PublicNoteReachBuilder";

/*
 * What a public note posted now on a maintenance event does
 * (Types/StatusPage/PublicNoteReach): PublicNoteReachBuilder's answer for a
 * maintenance event, worked out as its note job sends
 * (ScheduledMaintenancePublicNote's SendNotificationToSubscribers): hidden
 * from status pages, or not published on them yet
 * (ScheduledMaintenancePublication), then the status pages picked on it
 * that show maintenance events. It reaches no page through its monitors:
 * on none, it is still on the pages picked.
 *
 * Here with the event's own utilities rather than with the code that
 * serves status pages (Utils/StatusPage): it reads the event as its team
 * does, hidden or not published yet included - that is what it tells them,
 * as the team's maintenance calendar shows such an event
 * (TeamMaintenanceCalendar). The code that serves status pages reads an
 * event only once it is visible and published
 * (StatusPageVisibilityQuery.shownScheduledMaintenance, held by
 * ScheduledMaintenancePublicationOneRule).
 */
export default class ScheduledMaintenancePublicNoteReach {
  public static async build(data: {
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
    eventId: ObjectID;
  }): Promise<PublicNoteReachResult> {
    const readable: ScheduledMaintenance | null =
      await ScheduledMaintenanceService.findOneBy({
        query: {
          _id: data.eventId,
          projectId: data.projectId,
        },
        select: {
          _id: true,
        },
        props: data.props,
      });

    if (!readable) {
      throw new NotFoundException("Maintenance event not found.");
    }

    await PublicNoteReachBuilder.assertCallerMayWriteNotesOn({
      projectId: data.projectId,
      props: data.props,
      event: PublicNoteReachEvent.ScheduledMaintenance,
      eventId: data.eventId,
    });

    /*
     * Read as root, now that the caller has been shown to read the event:
     * its switch, its publish time and the pages picked on it are its own,
     * and only decide the one reason answered.
     */
    const event: ScheduledMaintenance | null =
      await ScheduledMaintenanceService.findOneBy({
        query: {
          _id: data.eventId,
          projectId: data.projectId,
        },
        select: {
          _id: true,
          isVisibleOnStatusPage: true,
          publishOnStatusPageAt: true,
          statusPages: {
            _id: true,
          },
        },
        props: {
          isRoot: true,
        },
      });

    // Deleted since the caller's read.
    if (!event) {
      throw new NotFoundException("Maintenance event not found.");
    }

    const publication: ScheduledMaintenancePublicationState =
      ScheduledMaintenancePublication.getState(event);

    if (publication === ScheduledMaintenancePublicationState.Hidden) {
      return {
        nothingSentReason: PublicNoteNothingSentReason.HiddenFromStatusPages,
      };
    }

    if (publication === ScheduledMaintenancePublicationState.Scheduled) {
      return {
        nothingSentReason: PublicNoteNothingSentReason.NotPublishedYet,
      };
    }

    const statusPageIds: Array<ObjectID> = [];

    for (const statusPage of event.statusPages || []) {
      const id: string = (statusPage._id || statusPage.id?.toString() || "")
        .toString()
        .trim();

      if (id && ObjectID.isValidUUID(id)) {
        statusPageIds.push(new ObjectID(id));
      }
    }

    /*
     * As the job loads them: an archived page, or one of a blocked project,
     * sends nothing and shows nothing, and is left out here.
     */
    const statusPages: Array<StatusPage> =
      statusPageIds.length > 0
        ? await StatusPageSubscriberService.getStatusPagesToSendNotification(
            statusPageIds,
          )
        : [];

    return {
      nothingSentReason: PublicNoteReachBuilder.getStatusPagesReason({
        projectId: data.projectId,
        statusPages: statusPages,
        showsEvent: (statusPage: StatusPage): boolean => {
          return Boolean(statusPage.showScheduledMaintenanceEventsOnStatusPage);
        },
      }),
    };
  }
}
