import Monitor from "../../../Models/DatabaseModels/Monitor";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import StatusPageResource from "../../../Models/DatabaseModels/StatusPageResource";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import IncidentScopeAddedPagesNotification from "../../../Types/StatusPage/IncidentScopeAddedPagesNotification";
import StatusPageEventType from "../../../Types/StatusPage/StatusPageEventType";
import StatusPagesListingMonitors, {
  StatusPageListingMonitors,
  StatusPagesListingMonitorsResult,
} from "../../../Types/StatusPage/StatusPagesListingMonitors";
import MonitorService from "../../Services/MonitorService";
import StatusPageResourceService from "../../Services/StatusPageResourceService";
import StatusPageService from "../../Services/StatusPageService";
import QueryHelper from "../../Types/Database/QueryHelper";
import StatusPageReadAccess from "./StatusPageReadAccess";

/*
 * Which status pages list some monitors (see
 * Common/Types/StatusPage/StatusPagesListingMonitors), for
 * POST /status-page/listing-monitors: the status pages the dashboard
 * suggests for a scheduled maintenance event or an announcement about those
 * monitors.
 *
 * It only reads, and what the caller learns is bounded by what they may
 * read:
 *
 * - the monitors are read with the caller's own permissions, in the caller's
 *   project. A monitor they cannot read - another project's, or one outside
 *   the labels their monitor access is limited to - is left out, as if it
 *   had not been named, so the answer says nothing about it;
 * - the status pages listing the rest are found the way the subscriber jobs
 *   find them (StatusPageResourceService.findByMonitors: listed directly, or
 *   through a monitor group);
 * - of those, only the pages the caller can read are named:
 *   StatusPageReadAccess.getReadableStatusPageIds, the rule that decides
 *   which pages someone may pick for an incident. Status page access can be
 *   limited to pages with some labels, and a page outside them is neither
 *   named nor counted;
 * - an archived page, and a page that does not show the kind of event asked
 *   about, are left out: adding the event to them would show nobody
 *   anything.
 */

export interface StatusPagesListingMonitorsRequest {
  projectId: ObjectID;
  props: DatabaseCommonInteractionProps;
  monitorIds: Array<ObjectID>;
  // Left out: every page that lists the monitors, whatever it shows.
  eventType?: StatusPageEventType | undefined;
}

export default class StatusPagesListingMonitorsBuilder {
  /*
   * The request body: {monitorIds, eventType?}. monitorIds is a list of at
   * most StatusPagesListingMonitors.maxIdsPerRequest ids; eventType, when
   * sent, one of StatusPagesListingMonitors.eventTypes.
   */
  public static parseRequest(data: {
    body: unknown;
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): StatusPagesListingMonitorsRequest {
    const body: JSONObject =
      data.body && typeof data.body === "object" && !Array.isArray(data.body)
        ? (data.body as JSONObject)
        : {};

    const monitorIds: unknown = body["monitorIds"];

    if (!Array.isArray(monitorIds)) {
      throw new BadDataException("monitorIds must be a list of IDs.");
    }

    if (monitorIds.length > StatusPagesListingMonitors.maxIdsPerRequest) {
      throw new BadDataException(
        `monitorIds can list at most ${StatusPagesListingMonitors.maxIdsPerRequest} IDs.`,
      );
    }

    const eventType: unknown = body["eventType"];

    if (
      eventType !== undefined &&
      eventType !== null &&
      !StatusPagesListingMonitors.isEventType(eventType)
    ) {
      throw new BadDataException(
        `eventType must be one of: ${StatusPagesListingMonitors.eventTypes.join(", ")}.`,
      );
    }

    return {
      projectId: data.projectId,
      props: data.props,
      monitorIds: monitorIds.map((item: unknown): ObjectID => {
        return this.parseObjectID(item);
      }),
      ...(StatusPagesListingMonitors.isEventType(eventType)
        ? { eventType: eventType }
        : {}),
    };
  }

  public static async build(
    request: StatusPagesListingMonitorsRequest,
  ): Promise<StatusPagesListingMonitorsResult> {
    const monitorIds: Array<string> = await this.getReadableMonitorIds({
      projectId: request.projectId,
      props: request.props,
      monitorIds: this.normalizeIds(request.monitorIds),
    });

    if (monitorIds.length === 0) {
      return { statusPages: [] };
    }

    const resources: Array<StatusPageResource> =
      await StatusPageResourceService.findByMonitors({
        monitorIds: monitorIds.map((id: string): ObjectID => {
          return new ObjectID(id);
        }),
        select: {
          _id: true,
          statusPageId: true,
        },
      });

    const listingStatusPageIds: Array<string> = this.normalizeIds(
      resources.map((resource: StatusPageResource): unknown => {
        return resource.statusPageId;
      }),
    );

    if (listingStatusPageIds.length === 0) {
      return { statusPages: [] };
    }

    // The caller's own read of the pages: labels and all.
    const readableStatusPageIds: Array<string> =
      await StatusPageReadAccess.getReadableStatusPageIds({
        statusPageIds: listingStatusPageIds,
        props: request.props,
      });

    if (readableStatusPageIds.length === 0) {
      return { statusPages: [] };
    }

    /*
     * Read as root, now that the caller has been shown to read these pages:
     * only their names and the flags that decide whether the event would
     * show on them. Narrowed to the project either way.
     */
    const statusPages: Array<StatusPage> = await StatusPageService.findBy({
      query: {
        _id: QueryHelper.any(readableStatusPageIds),
        projectId: request.projectId,
      },
      select: {
        _id: true,
        name: true,
        isArchived: true,
        showScheduledMaintenanceEventsOnStatusPage: true,
        showAnnouncementsOnStatusPage: true,
      },
      limit: readableStatusPageIds.length,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    /*
     * A page without a name is named "" - the dashboard calls it what the
     * reader's language calls an untitled page.
     */
    const suggested: Array<StatusPageListingMonitors> = statusPages
      .filter((statusPage: StatusPage): boolean => {
        return this.isShowing(statusPage, request.eventType);
      })
      .map((statusPage: StatusPage): StatusPageListingMonitors => {
        return {
          statusPageId: this.normalizeIds(statusPage._id)[0] || "",
          name: statusPage.name?.trim() || "",
        };
      })
      .filter((statusPage: StatusPageListingMonitors): boolean => {
        return Boolean(statusPage.statusPageId);
      })
      .sort(StatusPagesListingMonitors.compareByName);

    return { statusPages: suggested };
  }

  /*
   * Whether an event of this kind would show on the page: it is not
   * archived (an archived page is offline, and tells its subscribers
   * nothing), and it shows that kind of event. A flag that was not loaded
   * counts as the column's default - on.
   */
  public static isShowing(
    statusPage: StatusPage,
    eventType: StatusPageEventType | undefined,
  ): boolean {
    if (statusPage.isArchived === true) {
      return false;
    }

    if (eventType === StatusPageEventType.ScheduledEvent) {
      return statusPage.showScheduledMaintenanceEventsOnStatusPage !== false;
    }

    if (eventType === StatusPageEventType.Announcement) {
      return statusPage.showAnnouncementsOnStatusPage !== false;
    }

    return true;
  }

  /*
   * The monitors, of these, that the caller can read in the project,
   * lower-cased. A caller with no monitor read access reads none of them.
   */
  private static async getReadableMonitorIds(data: {
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
    monitorIds: Array<string>;
  }): Promise<Array<string>> {
    if (data.monitorIds.length === 0) {
      return [];
    }

    try {
      const monitors: Array<Monitor> = await MonitorService.findBy({
        query: {
          _id: QueryHelper.any(data.monitorIds),
          projectId: data.projectId,
        },
        select: {
          _id: true,
        },
        limit: data.monitorIds.length,
        skip: 0,
        props: data.props,
      });

      const readable: Array<string> = this.normalizeIds(monitors);

      // In the order they were named, and only those.
      return data.monitorIds.filter((id: string): boolean => {
        return readable.includes(id);
      });
    } catch (err) {
      if (err instanceof NotAuthorizedException) {
        return [];
      }

      throw err;
    }
  }

  // An id as a string or a serialized ObjectID.
  private static parseObjectID(value: unknown): ObjectID {
    let id: string = "";

    if (typeof value === "string") {
      id = value;
    } else if (value instanceof ObjectID) {
      id = value.toString();
    } else if (value && typeof value === "object") {
      id = new ObjectID(value as JSONObject).toString();
    }

    id = id.trim();

    if (!id || !ObjectID.isValidUUID(id)) {
      throw new BadDataException("monitorIds must be a list of valid IDs.");
    }

    return new ObjectID(id);
  }

  /*
   * Ids in any shape they arrive in - an ObjectID, a string, a model or a
   * {_id} - lower-cased as the database returns them, without duplicates.
   */
  private static normalizeIds(value: unknown): Array<string> {
    return IncidentScopeAddedPagesNotification.normalizeStatusPageIds(value);
  }
}
