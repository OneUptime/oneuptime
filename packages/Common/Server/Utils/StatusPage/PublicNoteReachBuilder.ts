import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentEpisode from "../../../Models/DatabaseModels/IncidentEpisode";
import IncidentEpisodePublicNote from "../../../Models/DatabaseModels/IncidentEpisodePublicNote";
import IncidentPublicNote from "../../../Models/DatabaseModels/IncidentPublicNote";
import ScheduledMaintenance from "../../../Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenancePublicNote from "../../../Models/DatabaseModels/ScheduledMaintenancePublicNote";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import NotFoundException from "../../../Types/Exception/NotFoundException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import ScheduledMaintenancePublication, {
  ScheduledMaintenancePublicationState,
} from "../../../Types/ScheduledMaintenance/ScheduledMaintenancePublication";
import PublicNoteReach, {
  PublicNoteNothingSentReason,
  PublicNoteReachEvent,
  PublicNoteReachResult,
} from "../../../Types/StatusPage/PublicNoteReach";
import StatusPageVisibility from "../../../Types/StatusPage/StatusPageVisibility";
import { isSendingSubscriberNotifications } from "../../../Types/StatusPage/SubscriberNotificationsSwitch";
import IncidentEpisodeService from "../../Services/IncidentEpisodeService";
import ScheduledMaintenanceService from "../../Services/ScheduledMaintenanceService";
import StatusPageSubscriberService from "../../Services/StatusPageSubscriberService";
import CallerPermission from "../Permission/CallerPermission";
import IncidentStatusPageScope, {
  ResolvedIncidentStatusPages,
} from "./IncidentStatusPageScope";
import IncidentSubscriberAudienceBuilder, {
  IncidentSubscriberAudienceWithStatusPages,
} from "./IncidentSubscriberAudienceBuilder";
import SubscriberNotificationPreviewBuilder from "./SubscriberNotificationPreviewBuilder";

/*
 * What a public note posted now does (Types/StatusPage/PublicNoteReach), for
 * POST /<event>/public-note-reach: whether a status page shows the note's
 * event, and whether the note notifies any status page's subscribers - or
 * why not.
 *
 * Each event is worked out the way its own note job sends, in the job's
 * order, so the composer says what the job will do:
 *
 *   - an incident through its notification preview's reason for a public
 *     note (SubscriberNotificationPreviewBuilder.getNothingSentReason, from
 *     the audience the preview and the "Will notify" summary are built on,
 *     #9684): no monitors, hidden, and then whether a page shows it - so
 *     the composer, the preview and the job can never disagree;
 *   - an episode through its incidents (IncidentStatusPageScope), on the
 *     pages that show episodes, as its note job sends;
 *   - a maintenance event on the status pages picked on it, once it is
 *     visible and published, on the pages that show maintenance events, as
 *     its note job sends.
 *
 * Every page the event reaches counts, a page the caller cannot read
 * included, so the answer is true whoever asks. It names no page: it is one
 * reason, or none - no more than whether some page shows the event and
 * sends notifications, which the notification preview already tells the
 * same people. The event itself is read with the caller's own permissions,
 * inside the caller's project: another project's event, and one the caller
 * may not read, are not found.
 */
export default class PublicNoteReachBuilder {
  // The public note each event's composer writes.
  public static getNoteModel(event: PublicNoteReachEvent): BaseModel {
    switch (event) {
      case PublicNoteReachEvent.Incident:
        return new IncidentPublicNote();
      case PublicNoteReachEvent.IncidentEpisode:
        return new IncidentEpisodePublicNote();
      case PublicNoteReachEvent.ScheduledMaintenance:
        return new ScheduledMaintenancePublicNote();
    }
  }

  /*
   * Who may ask: whoever may write the event's public notes - post one, or
   * edit one - since the answer is what the composer says to them. Read the
   * way every permission check reads it (CallerPermission): a team's block
   * is no grant.
   */
  public static assertCallerMayAsk(data: {
    props: DatabaseCommonInteractionProps;
    event: PublicNoteReachEvent;
  }): void {
    if (data.props.isMasterAdmin) {
      return;
    }

    const note: BaseModel = this.getNoteModel(data.event);

    const mayWrite: boolean =
      CallerPermission.holdsModelPermission(data.props, {
        model: note,
        operation: "create",
      }) ||
      CallerPermission.holdsModelPermission(data.props, {
        model: note,
        operation: "update",
      });

    if (!mayWrite) {
      throw new NotAuthorizedException(
        `You do not have permission to see where this ${this.getEventName(data.event)}'s public notes are shown. You need a permission that lets you post or edit them.`,
      );
    }
  }

  // The request body: {eventId}.
  public static parseEventId(body: unknown): ObjectID {
    const json: JSONObject =
      body && typeof body === "object" && !Array.isArray(body)
        ? (body as JSONObject)
        : {};
    const value: unknown = json["eventId"];

    let id: string = "";

    if (typeof value === "string") {
      id = value.trim();
    } else if (value instanceof ObjectID) {
      id = value.toString();
    }

    if (!id || !ObjectID.isValidUUID(id)) {
      throw new BadDataException(
        "This request names no event. Send the ID of the incident, episode or maintenance event as eventId.",
      );
    }

    return new ObjectID(id.toLowerCase());
  }

  public static async build(data: {
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
    event: PublicNoteReachEvent;
    eventId: ObjectID;
  }): Promise<PublicNoteReachResult> {
    switch (data.event) {
      case PublicNoteReachEvent.Incident:
        return this.buildForIncident(data);
      case PublicNoteReachEvent.IncidentEpisode:
        return this.buildForIncidentEpisode(data);
      case PublicNoteReachEvent.ScheduledMaintenance:
        return this.buildForScheduledMaintenance(data);
    }
  }

  /*
   * Of the status pages an event reaches, whether one shows it and whether
   * one that shows it sends its subscribers anything: NoStatusPages when
   * none shows it, NotificationsOff when every one that does is switched
   * off, null when one tells its subscribers. Another project's page is
   * never told, so it does not count.
   */
  public static getStatusPagesReason(data: {
    projectId: ObjectID;
    statusPages: Array<StatusPage>;
    // Whether a page shows this kind of event at all.
    showsEvent: (statusPage: StatusPage) => boolean;
  }): PublicNoteNothingSentReason | null {
    const projectId: string = data.projectId.toString().toLowerCase();

    const showingPages: Array<StatusPage> = data.statusPages.filter(
      (statusPage: StatusPage): boolean => {
        const isProjectPage: boolean =
          !statusPage.projectId ||
          statusPage.projectId.toString().toLowerCase() === projectId;

        return isProjectPage && data.showsEvent(statusPage);
      },
    );

    if (showingPages.length === 0) {
      return PublicNoteNothingSentReason.NoStatusPages;
    }

    if (!showingPages.some(isSendingSubscriberNotifications)) {
      return PublicNoteNothingSentReason.NotificationsOff;
    }

    return null;
  }

  /*
   * An incident: its notification preview's answer for a public note, from
   * the same audience. The audience reads the incident with the caller's
   * permissions first, and works the pages out from every page the
   * incident reaches (IncidentSubscriberAudienceBuilder).
   */
  private static async buildForIncident(data: {
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
    eventId: ObjectID;
  }): Promise<PublicNoteReachResult> {
    const withStatusPages: IncidentSubscriberAudienceWithStatusPages =
      await IncidentSubscriberAudienceBuilder.buildWithStatusPages({
        projectId: data.projectId,
        props: data.props,
        incidentId: data.eventId,
      });

    return PublicNoteReach.fromPreviewReason(
      SubscriberNotificationPreviewBuilder.getNothingSentReason({
        audience: withStatusPages.audience,
        draftNothingSentReason: null,
        isShownOnAnyStatusPage:
          SubscriberNotificationPreviewBuilder.isShownOnAnyStatusPage({
            projectId: data.projectId,
            statusPages: withStatusPages.resolved.statusPages,
          }),
      }),
    );
  }

  /*
   * An episode, as its note job sends (IncidentEpisodePublicNote's
   * SendNotificationToSubscribers): its incidents on no monitor, the episode
   * hidden from status pages (or private), then the pages its incidents
   * reach - each through its own scope, a private incident reaching none -
   * that show episodes.
   */
  private static async buildForIncidentEpisode(data: {
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
    eventId: ObjectID;
  }): Promise<PublicNoteReachResult> {
    const episode: IncidentEpisode | null =
      await IncidentEpisodeService.findOneBy({
        query: {
          _id: data.eventId,
          projectId: data.projectId,
        },
        select: {
          _id: true,
          // Whether a status page shows it (StatusPageVisibility).
          isVisibleOnStatusPage: true,
          isPrivate: true,
        },
        props: data.props,
      });

    if (!episode) {
      throw new NotFoundException("Episode not found.");
    }

    const incidents: Array<Incident> =
      await IncidentStatusPageScope.getEpisodeMemberIncidents(data.eventId);

    const hasMonitors: boolean = incidents.some(
      (incident: Incident): boolean => {
        return (incident.monitors || []).length > 0;
      },
    );

    if (!hasMonitors) {
      return { nothingSentReason: PublicNoteNothingSentReason.NoMonitors };
    }

    if (!StatusPageVisibility.isShown(episode)) {
      return {
        nothingSentReason: PublicNoteNothingSentReason.HiddenFromStatusPages,
      };
    }

    const resolved: ResolvedIncidentStatusPages =
      await IncidentStatusPageScope.resolvePagesForIncidents({
        incidents: incidents,
      });

    return {
      nothingSentReason: this.getStatusPagesReason({
        projectId: data.projectId,
        statusPages: resolved.statusPages,
        showsEvent: (statusPage: StatusPage): boolean => {
          return Boolean(statusPage.showEpisodesOnStatusPage);
        },
      }),
    };
  }

  /*
   * A maintenance event, as its note job sends
   * (ScheduledMaintenancePublicNote's SendNotificationToSubscribers): hidden
   * from status pages, or not published on them yet
   * (ScheduledMaintenancePublication), then the status pages picked on it
   * that show maintenance events. It reaches no page through its monitors:
   * on none, it is still on the pages picked.
   */
  private static async buildForScheduledMaintenance(data: {
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
      nothingSentReason: this.getStatusPagesReason({
        projectId: data.projectId,
        statusPages: statusPages,
        showsEvent: (statusPage: StatusPage): boolean => {
          return Boolean(statusPage.showScheduledMaintenanceEventsOnStatusPage);
        },
      }),
    };
  }

  // What a refusal calls the event.
  private static getEventName(event: PublicNoteReachEvent): string {
    switch (event) {
      case PublicNoteReachEvent.Incident:
        return "incident";
      case PublicNoteReachEvent.IncidentEpisode:
        return "episode";
      case PublicNoteReachEvent.ScheduledMaintenance:
        return "maintenance event";
    }
  }
}
