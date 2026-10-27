import StatusPageAPI from "../../API/StatusPageAPI";
import OnCallCalendarFeedRateLimit from "../../Middleware/OnCallCalendarFeedRateLimit";
import StatusPageService from "../../Services/StatusPageService";
import { ExpressRequest, ExpressResponse, NextFunction } from "../Express";
import logger from "../Logger";
import ProductBrandingText from "../ProductBrandingText";
import applyPublicPageNotFound from "../PublicPageNotFound";
import Response, { CalendarResponseDisposition } from "../Response";
import MaintenanceCalendarFeedCache, {
  RenderedMaintenanceCalendar,
} from "../ScheduledMaintenance/MaintenanceCalendarFeedCache";
import { maintenanceDescriptionToPlainText } from "../ScheduledMaintenance/MaintenanceCalendarPlainText";
import BlockedProjectStatusPages from "./BlockedProjectStatusPages";
import StatusPageOverviewCache from "./StatusPageOverviewCache";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Label from "../../../Models/DatabaseModels/Label";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import ScheduledMaintenance from "../../../Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenanceState from "../../../Models/DatabaseModels/ScheduledMaintenanceState";
import ScheduledMaintenanceStateTimeline from "../../../Models/DatabaseModels/ScheduledMaintenanceStateTimeline";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import StatusPageResource from "../../../Models/DatabaseModels/StatusPageResource";
import Dictionary from "../../../Types/Dictionary";
import NotFoundException from "../../../Types/Exception/NotFoundException";
import { JSONArray, JSONObject } from "../../../Types/JSON";
import JSONFunctions from "../../../Types/JSONFunctions";
import ObjectID from "../../../Types/ObjectID";
import MaintenanceCalendar, {
  MAINTENANCE_CALENDAR_FILE_NAME,
  MAINTENANCE_CALENDAR_MAX_EVENTS,
  MaintenanceCalendarAudience,
  MaintenanceCalendarEventInput,
} from "../../../Types/ScheduledMaintenance/MaintenanceCalendar";
import { MAINTENANCE_CALENDAR_EVENT_QUERY_PARAM } from "../../../Types/ScheduledMaintenance/MaintenanceCalendarLinks";
import { getAffectedResourceLabels } from "../../../Types/StatusPage/StatusPageAffectedResources";
import { ScheduledMaintenanceTimelineRow } from "../../../Utils/ScheduledMaintenanceStart";
import { createHash } from "crypto";

/*
 * A status page's maintenance calendar: <page>/maintenance.ics on the page's
 * own domain, /status-page/<id>/maintenance.ics on its address under
 * OneUptime (Frontend/Index.ts serves both), and ?event=<id> for one event as
 * a file (the event page's Add to calendar).
 *
 * WHAT IT HOLDS is exactly what the page's Scheduled Maintenance page shows,
 * because it is read the same way (StatusPageAPI.
 * readShownScheduledMaintenanceEvents): the events of the page's history
 * window, every event still to come and every event in progress, each only
 * while Visible on Status Page is on and the event is published - one
 * kept to the team until its publish time joins the calendar within the
 * five minutes the calendar is KEPT for after it; what each affects by the
 * names the page gives its resources, never a monitor's own name
 * (StatusPageAffectedResources); its labels only when the page shows labels;
 * each linked to the event on the page.
 *
 * WHO MAY READ IT is who may read the page, asked of the request on every
 * fetch with the page's own check (StatusPageService.hasReadAccess): a
 * private page's signed-in reader, the page's IP allow list, an archived
 * page and a blocked project all answer as they do for the page itself. A
 * calendar app signs in nowhere, so:
 *
 *   no such page, archived, blocked project   -> 404, as the page answers
 *   a private page, read by a calendar app     -> 200, an EMPTY calendar
 *                                                 saying why; one that had
 *                                                 events (the page was
 *                                                 public) clears its copy
 *   a page that shows no maintenance           -> 200, an EMPTY calendar
 *   otherwise                                  -> 200, the page's events
 *
 * One event (?event=) is a download a reader's browser makes from the event
 * page, signed in if the page is private: it answers 404 for an event the
 * page does not show, and 401 for a reader the page would not let in -
 * an error the browser shows, not an empty file.
 *
 * KEPT for five minutes per page (MaintenanceCalendarFeedCache) under the
 * page's project generation (StatusPageOverviewCache): an event taken off the
 * page, or a page made private, is a new key at once. Who may read it is
 * asked before the cache, every time. Rate limited per page and per address
 * (OnCallCalendarFeedRateLimit, keyed by the page instead of a token).
 *
 * The few words the calendar adds are English, as the page's RSS feed,
 * emails and SMS are (MaintenanceCalendar).
 */

export const STATUS_PAGE_CALENDAR_PRIVATE_REASON: string =
  "This status page is private, so a calendar app cannot read its events. Sign in to the status page to see them.";

export const STATUS_PAGE_CALENDAR_NO_MAINTENANCE_REASON: string =
  "This status page does not show scheduled maintenance.";

export const STATUS_PAGE_CALENDAR_NOT_FOUND_MESSAGE: string =
  "Status Page not found";

export const STATUS_PAGE_CALENDAR_EVENT_NOT_FOUND_MESSAGE: string =
  "This scheduled maintenance event is not on this status page.";

export const STATUS_PAGE_CALENDAR_SIGN_IN_MESSAGE: string =
  "Sign in to this status page to add its events to your calendar.";

export const STATUS_PAGE_PREVIEW_PARAM: string = "statusPageId";

// The names a page's resources appear under, with the page's events.
interface ShownEvents {
  events: Array<ScheduledMaintenance>;
  states: Array<ScheduledMaintenanceState>;
  timelines: Array<ScheduledMaintenanceStateTimeline>;
  statusPageResources: Array<StatusPageResource>;
  monitorsInGroup: Dictionary<Array<ObjectID>>;
}

export interface StatusPageCalendarPage {
  statusPageId: ObjectID;
  projectId: ObjectID | null;
  name: string;
  showsMaintenance: boolean;
}

type Handler = (req: ExpressRequest, res: ExpressResponse) => Promise<void>;

export default class StatusPageMaintenanceCalendarFeed {
  /*
   * The page a request names: the id in a /status-page/<id>/... path, else
   * the host the request was made to (the page's own domain).
   */
  public static getStatusPageIdOrDomain(req: ExpressRequest): string {
    const fromPath: unknown = req.params?.[STATUS_PAGE_PREVIEW_PARAM];

    if (typeof fromPath === "string" && fromPath.trim()) {
      return fromPath.trim();
    }

    return (req.hostname || "").toString().trim().toLowerCase();
  }

  /*
   * ?event=<id>: undefined when absent, null when it is not an event id - a
   * link to one event must never quietly answer with every event.
   */
  public static readEventId(req: ExpressRequest): ObjectID | undefined | null {
    const raw: unknown = req.query?.[MAINTENANCE_CALENDAR_EVENT_QUERY_PARAM];

    if (raw === undefined || raw === null) {
      return undefined;
    }

    const value: string = (
      Array.isArray(raw) ? String(raw[0] ?? "") : String(raw)
    ).trim();

    if (!value) {
      return undefined;
    }

    if (!ObjectID.isValidUUID(value)) {
      return null;
    }

    return new ObjectID(value.toLowerCase());
  }

  /*
   * The rate limit's first counter, keyed by the page a request names (a
   * short hash, so a hostname never becomes a raw Redis key).
   */
  public static getRateLimitKey(req: ExpressRequest): string {
    const page: string =
      StatusPageMaintenanceCalendarFeed.getStatusPageIdOrDomain(req);

    if (!page) {
      return "none";
    }

    return `s:${createHash("sha256")
      .update(page.toLowerCase(), "utf8")
      .digest("hex")
      .slice(0, 16)}`;
  }

  public static getRateLimitMiddleware(): (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ) => Promise<void> {
    return OnCallCalendarFeedRateLimit.getMiddleware({
      resolveTokenKey: (req: ExpressRequest): string => {
        return StatusPageMaintenanceCalendarFeed.getRateLimitKey(req);
      },
    });
  }

  // The route handler for both addresses of the calendar.
  public static getHandler(): Handler {
    return async (req: ExpressRequest, res: ExpressResponse): Promise<void> => {
      try {
        await StatusPageMaintenanceCalendarFeed.serve(req, res);
      } catch (err) {
        logger.error(err);

        if (!res.headersSent) {
          res.status(500).send("Internal Server Error");
        }
      }
    };
  }

  public static async serve(
    req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<void> {
    const eventId: ObjectID | undefined | null =
      StatusPageMaintenanceCalendarFeed.readEventId(req);

    if (eventId === null) {
      return StatusPageMaintenanceCalendarFeed.sendText(
        res,
        404,
        STATUS_PAGE_CALENDAR_EVENT_NOT_FOUND_MESSAGE,
      );
    }

    const statusPageId: ObjectID | null =
      await StatusPageService.resolveStatusPageIdOrNull(
        StatusPageMaintenanceCalendarFeed.getStatusPageIdOrDomain(req),
      );

    if (
      !statusPageId ||
      (await BlockedProjectStatusPages.isStatusPageOfBlockedProject(
        statusPageId,
      ))
    ) {
      return StatusPageMaintenanceCalendarFeed.sendPageNotFound(res);
    }

    const access: { hasReadAccess: boolean; error?: Error | undefined } =
      await StatusPageService.hasReadAccess({
        statusPageId: statusPageId,
        req: req,
      });

    if (!access.hasReadAccess && access.error instanceof NotFoundException) {
      return StatusPageMaintenanceCalendarFeed.sendPageNotFound(res);
    }

    const page: StatusPageCalendarPage | null =
      await StatusPageMaintenanceCalendarFeed.readPage(statusPageId);

    if (!page) {
      return StatusPageMaintenanceCalendarFeed.sendPageNotFound(res);
    }

    if (eventId) {
      if (!access.hasReadAccess) {
        return StatusPageMaintenanceCalendarFeed.sendText(
          res,
          401,
          STATUS_PAGE_CALENDAR_SIGN_IN_MESSAGE,
        );
      }

      return await StatusPageMaintenanceCalendarFeed.serveOneEvent({
        req: req,
        res: res,
        page: page,
        eventId: eventId,
      });
    }

    let calendar: RenderedMaintenanceCalendar;

    if (!access.hasReadAccess) {
      calendar = StatusPageMaintenanceCalendarFeed.renderEmpty({
        page: page,
        reason: STATUS_PAGE_CALENDAR_PRIVATE_REASON,
      });
    } else if (!page.showsMaintenance) {
      calendar = StatusPageMaintenanceCalendarFeed.renderEmpty({
        page: page,
        reason: STATUS_PAGE_CALENDAR_NO_MAINTENANCE_REASON,
      });
    } else {
      calendar = (
        await MaintenanceCalendarFeedCache.getOrRender({
          key: await StatusPageMaintenanceCalendarFeed.getCacheKey(page),
          render: (): Promise<RenderedMaintenanceCalendar> => {
            return StatusPageMaintenanceCalendarFeed.render(page);
          },
        })
      ).calendar;
    }

    return Response.sendCalendarResponse(req, res, {
      body: calendar.body,
      etag: calendar.etag,
      lastModified: calendar.lastModified,
      fileName: MAINTENANCE_CALENDAR_FILE_NAME,
    });
  }

  /*
   * The key a page's calendar is kept under: the page and its project's
   * generation - a record taken off the page, or the page made private,
   * starts a new one (StatusPageOverviewCache) - or the page alone when its
   * project is not known.
   */
  public static async getCacheKey(
    page: StatusPageCalendarPage,
  ): Promise<string> {
    const generation: string = page.projectId
      ? await StatusPageOverviewCache.getProjectGeneration(page.projectId)
      : "none";

    return `status-page:${page.statusPageId.toString()}:${generation}`;
  }

  public static async readPage(
    statusPageId: ObjectID,
  ): Promise<StatusPageCalendarPage | null> {
    const statusPage: StatusPage | null = await StatusPageService.findOneBy({
      query: {
        _id: statusPageId.toString(),
      },
      select: {
        _id: true,
        projectId: true,
        name: true,
        pageTitle: true,
        isArchived: true,
        showScheduledMaintenanceEventsOnStatusPage: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!statusPage || statusPage.isArchived) {
      return null;
    }

    return {
      statusPageId: statusPageId,
      projectId: statusPage.projectId || null,
      name: statusPage.pageTitle || statusPage.name || "",
      showsMaintenance: Boolean(
        statusPage.showScheduledMaintenanceEventsOnStatusPage,
      ),
    };
  }

  public static renderEmpty(data: {
    page: StatusPageCalendarPage;
    reason: string;
  }): RenderedMaintenanceCalendar {
    const body: string = MaintenanceCalendar.render({
      audience: MaintenanceCalendarAudience.StatusPage,
      name: data.page.name,
      productId: MaintenanceCalendar.getProductId(
        ProductBrandingText.getProductName(),
      ),
      events: [],
      emptyReason: data.reason,
    });

    return {
      body: body,
      etag: Response.getCalendarETag(body),
      lastModified: new Date(),
      eventCount: 0,
    };
  }

  // The page's calendar, read as the page reads its events.
  public static async render(
    page: StatusPageCalendarPage,
  ): Promise<RenderedMaintenanceCalendar> {
    const [response, statusPageUrl]: [JSONObject, string] = await Promise.all([
      StatusPageAPI.readShownScheduledMaintenanceEvents({
        statusPageId: page.statusPageId,
        scheduledMaintenanceId: null,
      }),
      StatusPageService.getStatusPageURL(page.statusPageId),
    ]);

    const built: {
      events: Array<MaintenanceCalendarEventInput>;
      isTruncated: boolean;
    } = StatusPageMaintenanceCalendarFeed.buildEvents({
      response: response,
      statusPageUrl: statusPageUrl,
    });

    const body: string = MaintenanceCalendar.render({
      audience: MaintenanceCalendarAudience.StatusPage,
      name: page.name,
      productId: MaintenanceCalendar.getProductId(
        ProductBrandingText.getProductName(),
      ),
      events: built.events,
      isTruncated: built.isTruncated,
    });

    return {
      body: body,
      etag: Response.getCalendarETag(body),
      lastModified: new Date(),
      eventCount: built.events.length,
    };
  }

  /*
   * The page's events as a calendar holds them, from what
   * readShownScheduledMaintenanceEvents answers: at most
   * MAINTENANCE_CALENDAR_MAX_EVENTS, the ones furthest ahead left out.
   */
  public static buildEvents(data: {
    response: JSONObject;
    statusPageUrl: string;
  }): { events: Array<MaintenanceCalendarEventInput>; isTruncated: boolean } {
    const shown: ShownEvents = StatusPageMaintenanceCalendarFeed.readShown(
      data.response,
    );

    const timelinesByEvent: Map<
      string,
      Array<ScheduledMaintenanceTimelineRow>
    > = new Map<string, Array<ScheduledMaintenanceTimelineRow>>();

    for (const row of shown.timelines) {
      const eventId: string | undefined =
        row.scheduledMaintenanceId?.toString();

      if (!eventId) {
        continue;
      }

      const rows: Array<ScheduledMaintenanceTimelineRow> =
        timelinesByEvent.get(eventId) || [];

      rows.push({
        stateId:
          row.scheduledMaintenanceState?._id ||
          row.scheduledMaintenanceStateId?.toString(),
        startsAt: row.startsAt || row.createdAt,
      });

      timelinesByEvent.set(eventId, rows);
    }

    let pageUrl: string = data.statusPageUrl || "";

    while (pageUrl.endsWith("/")) {
      pageUrl = pageUrl.slice(0, -1);
    }

    const events: Array<MaintenanceCalendarEventInput> = shown.events
      .filter((event: ScheduledMaintenance): boolean => {
        return Boolean(event.id && event.startsAt);
      })
      .map((event: ScheduledMaintenance): MaintenanceCalendarEventInput => {
        const eventId: string = event.id!.toString();

        return {
          id: eventId,
          title: event.title,
          description: maintenanceDescriptionToPlainText(event.description),
          startsAt: event.startsAt!,
          endsAt: event.endsAt,
          stateName: event.currentScheduledMaintenanceState?.name,
          isCalledOff: MaintenanceCalendar.isCalledOff({
            states: shown.states,
            state: event.currentScheduledMaintenanceState,
            timeline: timelinesByEvent.get(eventId) || [],
          }),
          createdAt: event.createdAt,
          updatedAt: event.updatedAt,
          version: event.version,
          affects: getAffectedResourceLabels({
            monitorIds: (event.monitors || []).map(
              (monitor: Monitor): string | undefined => {
                return monitor.id?.toString();
              },
            ),
            statusPageResources: shown.statusPageResources,
            monitorsInGroup: shown.monitorsInGroup,
          }),
          labels: (event.labels || []).map((label: Label): string => {
            return label.name || "";
          }),
          url: pageUrl ? `${pageUrl}/scheduled-events/${eventId}` : "",
        };
      });

    const sorted: Array<MaintenanceCalendarEventInput> =
      MaintenanceCalendar.sortEvents(events);

    return {
      events: sorted.slice(0, MAINTENANCE_CALENDAR_MAX_EVENTS),
      isTruncated: sorted.length > MAINTENANCE_CALENDAR_MAX_EVENTS,
    };
  }

  private static readShown(response: JSONObject): ShownEvents {
    const readArray: (name: string) => JSONArray = (
      name: string,
    ): JSONArray => {
      const value: unknown = response[name];
      return Array.isArray(value) ? (value as JSONArray) : [];
    };

    return {
      events: BaseModel.fromJSONArray(
        readArray("scheduledMaintenanceEvents"),
        ScheduledMaintenance,
      ),
      states: BaseModel.fromJSONArray(
        readArray("scheduledMaintenanceStates"),
        ScheduledMaintenanceState,
      ),
      timelines: BaseModel.fromJSONArray(
        readArray("scheduledMaintenanceStateTimelines"),
        ScheduledMaintenanceStateTimeline,
      ),
      statusPageResources: BaseModel.fromJSONArray(
        readArray("statusPageResources"),
        StatusPageResource,
      ),
      monitorsInGroup: JSONFunctions.deserialize(
        (response["monitorsInGroup"] as JSONObject) || {},
      ) as Dictionary<Array<ObjectID>>,
    };
  }

  // One event of the page as a file the reader's calendar app opens.
  private static async serveOneEvent(data: {
    req: ExpressRequest;
    res: ExpressResponse;
    page: StatusPageCalendarPage;
    eventId: ObjectID;
  }): Promise<void> {
    if (!data.page.showsMaintenance) {
      return StatusPageMaintenanceCalendarFeed.sendText(
        data.res,
        404,
        STATUS_PAGE_CALENDAR_EVENT_NOT_FOUND_MESSAGE,
      );
    }

    const [response, statusPageUrl]: [JSONObject, string] = await Promise.all([
      StatusPageAPI.readShownScheduledMaintenanceEvents({
        statusPageId: data.page.statusPageId,
        scheduledMaintenanceId: data.eventId,
      }),
      StatusPageService.getStatusPageURL(data.page.statusPageId),
    ]);

    const built: {
      events: Array<MaintenanceCalendarEventInput>;
      isTruncated: boolean;
    } = StatusPageMaintenanceCalendarFeed.buildEvents({
      response: response,
      statusPageUrl: statusPageUrl,
    });

    const event: MaintenanceCalendarEventInput | undefined = built.events.find(
      (candidate: MaintenanceCalendarEventInput): boolean => {
        return candidate.id === data.eventId.toString();
      },
    );

    if (!event) {
      return StatusPageMaintenanceCalendarFeed.sendText(
        data.res,
        404,
        STATUS_PAGE_CALENDAR_EVENT_NOT_FOUND_MESSAGE,
      );
    }

    const body: string = MaintenanceCalendar.render({
      audience: MaintenanceCalendarAudience.StatusPage,
      name: data.page.name,
      productId: MaintenanceCalendar.getProductId(
        ProductBrandingText.getProductName(),
      ),
      events: [event],
    });

    return Response.sendCalendarResponse(data.req, data.res, {
      body: body,
      etag: Response.getCalendarETag(body),
      lastModified: new Date(),
      fileName: MAINTENANCE_CALENDAR_FILE_NAME,
      disposition: CalendarResponseDisposition.Attachment,
    });
  }

  private static sendPageNotFound(res: ExpressResponse): void {
    applyPublicPageNotFound(res);
    res.set("Content-Type", "text/plain; charset=utf-8");
    res.send(STATUS_PAGE_CALENDAR_NOT_FOUND_MESSAGE);
  }

  private static sendText(
    res: ExpressResponse,
    status: number,
    message: string,
  ): void {
    res.status(status);
    res.set("Content-Type", "text/plain; charset=utf-8");
    res.set("X-Robots-Tag", "noindex");
    res.send(message);
  }
}
