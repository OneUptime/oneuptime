import Monitor from "../../../Models/DatabaseModels/Monitor";
import MonitorStatus from "../../../Models/DatabaseModels/MonitorStatus";
import MonitorStatusTimeline from "../../../Models/DatabaseModels/MonitorStatusTimeline";
import OpenStackProjectNotice from "../../../Models/DatabaseModels/OpenStackProjectNotice";
import OpenStackProjectNoticeDelivery from "../../../Models/DatabaseModels/OpenStackProjectNoticeDelivery";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import StatusPageAnnouncement from "../../../Models/DatabaseModels/StatusPageAnnouncement";
import OneUptimeDate from "../../../Types/Date";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  OpenStackProjectNoticeDeliveryStatus,
  OpenStackProjectNoticeEvent,
} from "../../../Types/OpenStack/OpenStackProjectNotice";
import {
  OpenStackProjectPageRow,
  readOpenStackProjectPageRows,
} from "../../../Types/OpenStack/OpenStackStatusPagePlan";
import { OpenStackProjectNoticeMessage } from "../../../Utils/OpenStack/OpenStackProjectNoticeText";
import MonitorService from "../../Services/MonitorService";
import MonitorStatusService from "../../Services/MonitorStatusService";
import MonitorStatusTimelineService from "../../Services/MonitorStatusTimelineService";
import OpenStackProjectNoticeDeliveryService from "../../Services/OpenStackProjectNoticeDeliveryService";
import StatusPageAnnouncementService from "../../Services/StatusPageAnnouncementService";
import QueryHelper from "../../Types/Database/QueryHelper";

/*
 * TELLING A PROJECT'S OWN PRIVATE STATUS PAGE.
 *
 * A notice whose recipient is a page, so every rule of who is told is the one every other notice goes by:
 * the page hears only of what reaches its project, once, and can be turned off.
 *
 * What it does is the page's own: the row for the service and region turns red while something reaches
 * them, and an announcement says what, in the words any other recipient reads. The page lists only its own
 * monitors, which no incident is ever on, so nothing of anyone else's can be read through it: not the
 * incident that opened, which names every project on the host, and not through the page's API either.
 */

// As long as the column holds.
const ANNOUNCEMENT_TITLE_LENGTH: number = 95;

function cut(text: string): string {
  return text.length > ANNOUNCEMENT_TITLE_LENGTH
    ? `${text.substring(0, ANNOUNCEMENT_TITLE_LENGTH)}...`
    : text;
}

export default class OpenStackProjectPages {
  public static async tell(data: {
    row: OpenStackProjectNoticeDelivery;
    notice: OpenStackProjectNotice;
    message: OpenStackProjectNoticeMessage;
  }): Promise<{ isSent: boolean; message?: string | undefined }> {
    const event: OpenStackProjectNoticeEvent = data.row
      .event as OpenStackProjectNoticeEvent;

    if (
      event === OpenStackProjectNoticeEvent.IncidentResolved ||
      event === OpenStackProjectNoticeEvent.MaintenanceEnded
    ) {
      await this.endWhatWasAnnounced(data);
    } else {
      await this.announce(data);
    }

    await this.refreshRow(data);

    return { isSent: true };
  }

  private static async announce(data: {
    row: OpenStackProjectNoticeDelivery;
    notice: OpenStackProjectNotice;
    message: OpenStackProjectNoticeMessage;
  }): Promise<void> {
    const page: StatusPage = new StatusPage();
    page._id = data.notice.statusPageId!.toString();

    const announcement: StatusPageAnnouncement = new StatusPageAnnouncement();
    announcement.projectId = data.row.projectId!;
    announcement.title = cut(data.message.subject);
    announcement.description = data.message.markdown;
    announcement.showAnnouncementAt = OneUptimeDate.getCurrentDate();
    announcement.statusPages = [page];
    // Whoever reads this page and asked to hear of it, and nobody else: it is on no other page.
    announcement.shouldStatusPageSubscribersBeNotified = true;

    const created: StatusPageAnnouncement =
      await StatusPageAnnouncementService.create({
        data: announcement,
        props: { isRoot: true },
      });

    if (created.id) {
      await OpenStackProjectNoticeDeliveryService.updateOneById({
        id: new ObjectID((data.row._id || "").toString()),
        data: { statusPageAnnouncementId: created.id },
        props: { isRoot: true },
      });
    }
  }

  private static async endWhatWasAnnounced(data: {
    row: OpenStackProjectNoticeDelivery;
  }): Promise<void> {
    /*
     * What told it began holds the announcement. Written when it was told, and its key is this one's
     * without what says this one is the closing.
     */
    const opening: OpenStackProjectNoticeDelivery | null =
      await OpenStackProjectNoticeDeliveryService.findOneBy({
        query: {
          openStackProjectNoticeId: data.row.openStackProjectNoticeId!,
          dedupeKey: (data.row.dedupeKey || "").replace(/:closed$/, ""),
        },
        select: { statusPageAnnouncementId: true },
        props: { isRoot: true },
      });

    if (opening?.statusPageAnnouncementId) {
      await StatusPageAnnouncementService.updateOneById({
        id: opening.statusPageAnnouncementId,
        data: { endAnnouncementAt: OneUptimeDate.getCurrentDate() },
        props: { isRoot: true },
      });
    }
  }

  /*
   * A row reads red for as long as an incident still open reaches its service and region. Planned
   * maintenance is announced, and leaves the row as it is: nothing has failed.
   */
  private static async refreshRow(data: {
    row: OpenStackProjectNoticeDelivery;
    notice: OpenStackProjectNotice;
  }): Promise<void> {
    const facts: JSONObject = (data.row.facts || {}) as JSONObject;
    const event: OpenStackProjectNoticeEvent = data.row
      .event as OpenStackProjectNoticeEvent;

    if (
      event !== OpenStackProjectNoticeEvent.IncidentOpened &&
      event !== OpenStackProjectNoticeEvent.IncidentResolved
    ) {
      return;
    }

    const row: OpenStackProjectPageRow | undefined =
      readOpenStackProjectPageRows(data.notice.statusPageRows).find(
        (candidate: OpenStackProjectPageRow): boolean => {
          return (
            candidate.service === facts["service"] &&
            (candidate.regionName || null) ===
              ((facts["regionName"] as string | null | undefined) || null)
          );
        },
      );

    // Nothing on the page for this: it was told, and has no row to turn.
    if (!row) {
      return;
    }

    const isRed: boolean =
      event === OpenStackProjectNoticeEvent.IncidentOpened ||
      (await this.isStillReached({ row, notice: data.notice }));

    await this.setRow({
      projectId: data.row.projectId!,
      monitorId: new ObjectID(row.monitorId),
      isRed,
    });
  }

  private static async isStillReached(data: {
    row: OpenStackProjectPageRow;
    notice: OpenStackProjectNotice;
  }): Promise<boolean> {
    const open: Array<OpenStackProjectNoticeDelivery> =
      await OpenStackProjectNoticeDeliveryService.findBy({
        query: {
          openStackProjectNoticeId: new ObjectID(
            (data.notice._id || "").toString(),
          ),
          event: OpenStackProjectNoticeEvent.IncidentOpened,
          closedAt: QueryHelper.isNull(),
          status: QueryHelper.any([
            OpenStackProjectNoticeDeliveryStatus.Sending,
            OpenStackProjectNoticeDeliveryStatus.Sent,
          ]),
        },
        select: { facts: true },
        skip: 0,
        limit: 1000,
        props: { isRoot: true },
      });

    return open.some((row: OpenStackProjectNoticeDelivery): boolean => {
      const facts: JSONObject = (row.facts || {}) as JSONObject;
      return (
        facts["service"] === data.row.service &&
        ((facts["regionName"] as string | null | undefined) || null) ===
          (data.row.regionName || null)
      );
    });
  }

  private static async setRow(data: {
    projectId: ObjectID;
    monitorId: ObjectID;
    isRed: boolean;
  }): Promise<void> {
    const monitor: Monitor | null = await MonitorService.findOneById({
      id: data.monitorId,
      select: { currentMonitorStatusId: true },
      props: { isRoot: true },
    });

    // Someone took this row off their page: nothing to turn.
    if (!monitor) {
      return;
    }

    const status: MonitorStatus | null = await MonitorStatusService.findOneBy({
      query: {
        projectId: data.projectId,
        ...(data.isRed
          ? { isOfflineState: true }
          : { isOperationalState: true }),
      },
      select: { _id: true },
      props: { isRoot: true },
    });

    if (
      !status?.id ||
      monitor.currentMonitorStatusId?.toString() === status.id.toString()
    ) {
      return;
    }

    const timeline: MonitorStatusTimeline = new MonitorStatusTimeline();
    timeline.projectId = data.projectId;
    timeline.monitorId = data.monitorId;
    timeline.monitorStatusId = status.id;
    timeline.rootCause = data.isRed
      ? "Something this project uses has an incident."
      : "What this project uses is back.";

    await MonitorStatusTimelineService.create({
      data: timeline,
      props: { isRoot: true },
    });
  }
}
