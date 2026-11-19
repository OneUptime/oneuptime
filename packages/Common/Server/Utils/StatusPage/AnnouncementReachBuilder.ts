import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import StatusPageAnnouncement from "../../../Models/DatabaseModels/StatusPageAnnouncement";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../../../Types/ObjectID";
import { AnnouncementReachResult } from "../../../Types/StatusPage/AnnouncementReach";
import { PickedStatusPagesReachResult } from "../../../Types/StatusPage/PickedStatusPagesReach";
import StatusPageAnnouncementService from "../../Services/StatusPageAnnouncementService";
import PickedStatusPagesReachBuilder, {
  PickedStatusPagesReachRequest,
  PickedStatusPagesRecordKind,
} from "./PickedStatusPagesReachBuilder";

/*
 * What an announcement on the status pages picked on its form does
 * (Types/StatusPage/AnnouncementReach), for POST
 * /status-page-announcement/reach: whether one of them shows announcements,
 * and whether one that does tells its subscribers - or why not. Create
 * Announcement's Schedule & Notifications line says it, and the
 * announcement's Edit says it of its Schedule and of "Notify subscribers
 * about this update" (#9775).
 *
 * An announcement is one kind of record whose form picks its status pages
 * (PickedStatusPagesReachBuilder, the one rule for every such form): a page
 * shows it while Show Announcements is on (showAnnouncementsOnStatusPage),
 * and who may ask is decided for the announcement as the form will save it
 * - on Create whoever may create it on those pages, on Edit whoever may
 * update it.
 *
 * On Edit the answer adds where the announcement's own notification stands
 * (subscriberNotificationStatus, #9921): the update job skips an update
 * while it has not gone out (AnnouncementUpdateNotification), and "Notify
 * subscribers about this update" says so. It is read once the caller has
 * been shown to update the announcement, as the server reads it.
 */

export const ANNOUNCEMENT_RECORD: PickedStatusPagesRecordKind<StatusPageAnnouncement> =
  {
    modelType: StatusPageAnnouncement,
    service: StatusPageAnnouncementService,
    recordIdKey: "announcementId",
    recordName: "announcement",
    showsRecord: (statusPage: StatusPage): boolean => {
      return Boolean(statusPage.showAnnouncementsOnStatusPage);
    },
  };

export interface AnnouncementReachRequest {
  // The status pages picked on the form, each once.
  statusPageIds: Array<ObjectID>;
  // The announcement an Edit form is editing; null on Create.
  announcementId: ObjectID | null;
}

export default class AnnouncementReachBuilder {
  /*
   * The request body: {statusPageIds, announcementId?}. Every id a real
   * one, each page once, and no more of them than the form could pick.
   */
  public static parseRequest(body: unknown): AnnouncementReachRequest {
    const request: PickedStatusPagesReachRequest =
      PickedStatusPagesReachBuilder.parseRequest(body, ANNOUNCEMENT_RECORD);

    return {
      statusPageIds: request.statusPageIds,
      announcementId: request.recordId,
    };
  }

  public static async build(data: {
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
    request: AnnouncementReachRequest;
  }): Promise<AnnouncementReachResult> {
    const pages: PickedStatusPagesReachResult =
      await PickedStatusPagesReachBuilder.build({
        projectId: data.projectId,
        props: data.props,
        request: this.toPickedRequest(data.request),
        kind: ANNOUNCEMENT_RECORD,
      });

    const announcementId: ObjectID | null = data.request.announcementId;

    if (!announcementId) {
      return pages;
    }

    /*
     * Read as root, now that the caller has been shown to update the
     * announcement: its own notification's status is the announcement's,
     * and only decides what its update box says.
     */
    const announcement: StatusPageAnnouncement | null =
      await StatusPageAnnouncementService.findOneBy({
        query: {
          _id: announcementId,
          projectId: data.projectId,
        },
        select: {
          _id: true,
          subscriberNotificationStatus: true,
        },
        props: {
          isRoot: true,
        },
      });

    return {
      ...pages,
      originalNotificationStatus:
        announcement?.subscriberNotificationStatus || null,
    };
  }

  /*
   * Who may ask, decided for the announcement as the form will save it
   * (PickedStatusPagesReachBuilder.assertCallerMayAsk): on Create, whoever
   * may create it on the pages picked; on Edit, whoever may update it, with
   * a page it is not on yet only one they may read.
   */
  public static async assertCallerMayAsk(data: {
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
    request: AnnouncementReachRequest;
  }): Promise<void> {
    await PickedStatusPagesReachBuilder.assertCallerMayAsk({
      projectId: data.projectId,
      props: data.props,
      request: this.toPickedRequest(data.request),
      kind: ANNOUNCEMENT_RECORD,
    });
  }

  private static toPickedRequest(
    request: AnnouncementReachRequest,
  ): PickedStatusPagesReachRequest {
    return {
      statusPageIds: request.statusPageIds,
      recordId: request.announcementId,
    };
  }
}
