import DatabaseConfig from "../../DatabaseConfig";
import ProjectService from "../../Services/ProjectService";
import ScheduledMaintenanceService from "../../Services/ScheduledMaintenanceService";
import ScheduledMaintenanceStateService from "../../Services/ScheduledMaintenanceStateService";
import ScheduledMaintenanceStateTimelineService from "../../Services/ScheduledMaintenanceStateTimelineService";
import QueryHelper from "../../Types/Database/QueryHelper";
import ProductBrandingText from "../ProductBrandingText";
import Response from "../Response";
import { RenderedMaintenanceCalendar } from "./MaintenanceCalendarFeedCache";
import { maintenanceDescriptionToPlainText } from "./MaintenanceCalendarPlainText";
import Label from "../../../Models/DatabaseModels/Label";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import Project from "../../../Models/DatabaseModels/Project";
import ScheduledMaintenance from "../../../Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenanceState from "../../../Models/DatabaseModels/ScheduledMaintenanceState";
import ScheduledMaintenanceStateTimeline from "../../../Models/DatabaseModels/ScheduledMaintenanceStateTimeline";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import ObjectID from "../../../Types/ObjectID";
import MaintenanceCalendar, {
  MAINTENANCE_CALENDAR_MAX_EVENTS,
  MaintenanceCalendarAudience,
  MaintenanceCalendarEventInput,
} from "../../../Types/ScheduledMaintenance/MaintenanceCalendar";
import { ScheduledMaintenanceTimelineRow } from "../../../Utils/ScheduledMaintenanceStart";

/*
 * The team's maintenance calendar: every scheduled maintenance event of the
 * project from 90 days back to a year ahead, each as the team knows it - its
 * monitors and status pages by their own names, its labels, a link to its
 * page in the Dashboard.
 *
 * Read as root: the link is the project's, and who may hold it is decided
 * when it is handed out (ScheduledMaintenanceCalendarAPI asks that a reader
 * reads every event of the project). The events are read in three queries
 * however many there are: the events with their relations, the project's
 * states, and the state timelines of the events that are over (an event
 * closed before it ever started was called off, MaintenanceCalendar).
 */

export const TEAM_CALENDAR_PAST_DAYS: number = 90;

export const TEAM_CALENDAR_FUTURE_DAYS: number = 365;

export const TEAM_CALENDAR_TURNED_OFF_REASON: string =
  "This calendar link is turned off, so it shows no events. Turn it on again from Scheduled Maintenance > Events > Subscribe.";

export const TEAM_CALENDAR_REPLACED_REASON: string =
  "This calendar link was replaced by a new one, so it shows no events. Subscribe again with the new link from Scheduled Maintenance > Events > Subscribe.";

const MILLISECONDS_PER_DAY: number = 24 * 60 * 60 * 1000;

export interface TeamCalendarWindow {
  from: Date;
  to: Date;
}

export interface TeamCalendarEvents {
  events: Array<MaintenanceCalendarEventInput>;
  isTruncated: boolean;
}

export default class TeamMaintenanceCalendar {
  /*
   * From 00:00 UTC of the day 90 days back to the end of the day a year
   * ahead: every fetch on one UTC day reads the same window, so the body is
   * the same until something changes.
   */
  public static getWindow(now: Date): TeamCalendarWindow {
    const today: number = Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
    );

    return {
      from: new Date(today - TEAM_CALENDAR_PAST_DAYS * MILLISECONDS_PER_DAY),
      to: new Date(
        today + (TEAM_CALENDAR_FUTURE_DAYS + 1) * MILLISECONDS_PER_DAY,
      ),
    };
  }

  // "YYYY-MM-DD" of the UTC day: the window, for the cache key.
  public static getDayBucket(now: Date): string {
    return now.toISOString().slice(0, 10);
  }

  public static async getProjectName(projectId: ObjectID): Promise<string> {
    const project: Project | null = await ProjectService.findOneById({
      id: projectId,
      select: { name: true },
      props: { isRoot: true },
    });

    return project?.name || "";
  }

  public static async render(data: {
    projectId: ObjectID;
    now: Date;
  }): Promise<RenderedMaintenanceCalendar> {
    const [projectName, read]: [string, TeamCalendarEvents] =
      await Promise.all([
        TeamMaintenanceCalendar.getProjectName(data.projectId),
        TeamMaintenanceCalendar.readEvents(data),
      ]);

    const body: string = MaintenanceCalendar.render({
      audience: MaintenanceCalendarAudience.Team,
      name: projectName,
      productId: MaintenanceCalendar.getProductId(
        ProductBrandingText.getProductName(),
      ),
      events: read.events,
      isTruncated: read.isTruncated,
    });

    return {
      body: body,
      etag: Response.getCalendarETag(body),
      lastModified: data.now,
      eventCount: read.events.length,
    };
  }

  /*
   * The calendar a link answers when it shows nothing on purpose - turned
   * off, or replaced by a new one - with the reason in its description. An
   * empty calendar, not an error: an app that gets one clears its copy,
   * while one that gets an error keeps showing the last events it read.
   */
  public static async renderEmpty(data: {
    projectId: ObjectID;
    reason: string;
    now: Date;
  }): Promise<RenderedMaintenanceCalendar> {
    const body: string = MaintenanceCalendar.render({
      audience: MaintenanceCalendarAudience.Team,
      name: await TeamMaintenanceCalendar.getProjectName(data.projectId),
      productId: MaintenanceCalendar.getProductId(
        ProductBrandingText.getProductName(),
      ),
      events: [],
      emptyReason: data.reason,
    });

    return {
      body: body,
      etag: Response.getCalendarETag(body),
      lastModified: data.now,
      eventCount: 0,
    };
  }

  public static async readEvents(data: {
    projectId: ObjectID;
    now: Date;
  }): Promise<TeamCalendarEvents> {
    const window: TeamCalendarWindow = TeamMaintenanceCalendar.getWindow(
      data.now,
    );

    /*
     * Every event whose window touches the calendar's, earliest first; one
     * more than a calendar takes, to know whether any were left out.
     */
    const rows: Array<ScheduledMaintenance> =
      await ScheduledMaintenanceService.findBy({
        query: {
          projectId: data.projectId,
          startsAt: QueryHelper.lessThanEqualTo(window.to),
          endsAt: QueryHelper.greaterThanEqualTo(window.from),
        },
        select: {
          _id: true,
          title: true,
          description: true,
          startsAt: true,
          endsAt: true,
          createdAt: true,
          updatedAt: true,
          version: true,
          currentScheduledMaintenanceState: {
            _id: true,
            name: true,
            order: true,
            isScheduledState: true,
            isOngoingState: true,
            isEndedState: true,
            isResolvedState: true,
          },
          monitors: {
            _id: true,
            name: true,
          },
          statusPages: {
            _id: true,
            name: true,
          },
          labels: {
            _id: true,
            name: true,
          },
        },
        sort: {
          startsAt: SortOrder.Ascending,
        },
        skip: 0,
        limit: MAINTENANCE_CALENDAR_MAX_EVENTS + 1,
        props: {
          isRoot: true,
        },
      });

    const isTruncated: boolean = rows.length > MAINTENANCE_CALENDAR_MAX_EVENTS;
    const events: Array<ScheduledMaintenance> = rows.slice(
      0,
      MAINTENANCE_CALENDAR_MAX_EVENTS,
    );

    if (events.length === 0) {
      return { events: [], isTruncated: false };
    }

    const states: Array<ScheduledMaintenanceState> =
      await ScheduledMaintenanceStateService.getAllScheduledMaintenanceStates({
        projectId: data.projectId,
        props: { isRoot: true },
      });

    const calledOff: Set<string> =
      await TeamMaintenanceCalendar.findCalledOffEvents({
        projectId: data.projectId,
        events: events,
        states: states,
      });

    const dashboardUrl: string = (
      await DatabaseConfig.getDashboardUrl()
    ).toString();

    return {
      events: events
        .filter((event: ScheduledMaintenance): boolean => {
          return Boolean(event.id && event.startsAt);
        })
        .map((event: ScheduledMaintenance): MaintenanceCalendarEventInput => {
          const eventId: string = event.id!.toString();

          return {
            id: eventId,
            title: event.title,
            description: maintenanceDescriptionToPlainText(
              event.description,
            ),
            startsAt: event.startsAt!,
            endsAt: event.endsAt,
            stateName: event.currentScheduledMaintenanceState?.name,
            isCalledOff: calledOff.has(eventId),
            createdAt: event.createdAt,
            updatedAt: event.updatedAt,
            version: event.version,
            affects: (event.monitors || []).map((monitor: Monitor): string => {
              return monitor.name || "";
            }),
            statusPages: (event.statusPages || []).map(
              (statusPage: StatusPage): string => {
                return statusPage.name || "";
              },
            ),
            labels: (event.labels || []).map((label: Label): string => {
              return label.name || "";
            }),
            url: TeamMaintenanceCalendar.getEventUrl({
              dashboardUrl: dashboardUrl,
              projectId: data.projectId,
              eventId: eventId,
            }),
          };
        }),
      isTruncated: isTruncated,
    };
  }

  // The event's page in the Dashboard.
  public static getEventUrl(data: {
    dashboardUrl: string;
    projectId: ObjectID;
    eventId: string;
  }): string {
    let dashboardUrl: string = data.dashboardUrl;

    while (dashboardUrl.endsWith("/")) {
      dashboardUrl = dashboardUrl.slice(0, -1);
    }

    return `${dashboardUrl}/${data.projectId.toString()}/scheduled-maintenance-events/${data.eventId}`;
  }

  /*
   * The events of `events` that were called off: over, with no row of their
   * state timeline that ever put them in progress. Only the events that are
   * over need their timelines read.
   */
  public static async findCalledOffEvents(data: {
    projectId: ObjectID;
    events: Array<ScheduledMaintenance>;
    states: Array<ScheduledMaintenanceState>;
  }): Promise<Set<string>> {
    const overIds: Array<ObjectID> = data.events
      .filter((event: ScheduledMaintenance): boolean => {
        return Boolean(
          event.id &&
            MaintenanceCalendar.isCalledOff({
              states: data.states,
              state: event.currentScheduledMaintenanceState,
              timeline: [],
            }),
        );
      })
      .map((event: ScheduledMaintenance): ObjectID => {
        return event.id!;
      });

    const calledOff: Set<string> = new Set<string>();

    if (overIds.length === 0) {
      return calledOff;
    }

    const rows: Array<ScheduledMaintenanceStateTimeline> =
      await ScheduledMaintenanceStateTimelineService.findBy({
        query: {
          projectId: data.projectId,
          scheduledMaintenanceId: QueryHelper.any(overIds),
        },
        select: {
          scheduledMaintenanceId: true,
          scheduledMaintenanceStateId: true,
          startsAt: true,
        },
        sort: {
          startsAt: SortOrder.Ascending,
        },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        props: {
          isRoot: true,
        },
      });

    const timelines: Map<string, Array<ScheduledMaintenanceTimelineRow>> =
      new Map<string, Array<ScheduledMaintenanceTimelineRow>>();

    for (const row of rows) {
      const eventId: string | undefined = row.scheduledMaintenanceId?.toString();

      if (!eventId) {
        continue;
      }

      const timeline: Array<ScheduledMaintenanceTimelineRow> =
        timelines.get(eventId) || [];

      timeline.push({
        stateId: row.scheduledMaintenanceStateId,
        startsAt: row.startsAt,
      });

      timelines.set(eventId, timeline);
    }

    for (const event of data.events) {
      const eventId: string | undefined = event.id?.toString();

      if (
        eventId &&
        MaintenanceCalendar.isCalledOff({
          states: data.states,
          state: event.currentScheduledMaintenanceState,
          timeline: timelines.get(eventId) || [],
        })
      ) {
        calledOff.add(eventId);
      }
    }

    return calledOff;
  }
}
