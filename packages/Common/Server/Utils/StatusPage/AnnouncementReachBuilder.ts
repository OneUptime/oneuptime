import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import StatusPageAnnouncement from "../../../Models/DatabaseModels/StatusPageAnnouncement";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import AnnouncementReach, {
  AnnouncementReachResult,
} from "../../../Types/StatusPage/AnnouncementReach";
import { PublicNoteNothingSentReason } from "../../../Types/StatusPage/PublicNoteReach";
import StatusPageAnnouncementService from "../../Services/StatusPageAnnouncementService";
import StatusPageService from "../../Services/StatusPageService";
import StatusPageSubscriberService from "../../Services/StatusPageSubscriberService";
import DatabaseRequestType from "../../Types/BaseDatabase/DatabaseRequestType";
import QueryHelper from "../../Types/Database/QueryHelper";
import PublicNoteReachBuilder from "./PublicNoteReachBuilder";

/*
 * What an announcement on the status pages picked on its form does
 * (Types/StatusPage/AnnouncementReach), for POST
 * /status-page-announcement/reach: whether one of them shows announcements,
 * and whether one that does tells its subscribers - or why not. Create
 * Announcement's Schedule & Notifications line says it, and the
 * announcement's Edit says it of its Schedule and of "Notify subscribers
 * about this update" (#9775).
 *
 * Worked out the way the announcement job sends (Workers/Jobs/Announcement/
 * SendNotificationToSubscribers): the pages loaded as every subscriber
 * notification loads them (StatusPageSubscriberService
 * .getStatusPagesToSendNotification: an archived page and a blocked
 * project's pages left out), then the ones that show announcements
 * (showAnnouncementsOnStatusPage), then whether one of those sends
 * notifications - by the one rule every answer of this kind is given by
 * (PublicNoteReachBuilder.getStatusPagesReason, #9735).
 *
 * Who may ask is decided for the announcement as the form will save it,
 * never by the table's permissions alone
 * (Tests/Server/Utils/Permission/TableHalfWriteGuard):
 *
 *   - on Create, whoever may create this announcement: the checks a create
 *     of one on the pages picked runs, without writing it
 *     (DatabaseService.checkCallerMayCreate) - the table and its plan, the
 *     caller's read of every page picked, and the labels a permission
 *     limited to some reaches through those pages;
 *   - on Edit (announcementId), whoever may update that announcement
 *     (DatabaseService.findOneUpdatableById), and a page it is not on yet
 *     only one the caller may read, as the update holds a page it adds.
 *
 * Every page picked must be the project's. One the caller may not read
 * counts all the same when the announcement is on it already - an edit
 * keeps it - and the answer names no page: it is one reason, or none.
 */

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
    const json: JSONObject =
      body && typeof body === "object" && !Array.isArray(body)
        ? (body as JSONObject)
        : {};

    const statusPageIds: unknown = json["statusPageIds"];

    if (!Array.isArray(statusPageIds)) {
      throw new BadDataException(
        "This request names no status pages. Send the IDs of the status pages picked as statusPageIds.",
      );
    }

    if (statusPageIds.length > AnnouncementReach.maxStatusPagesPerRequest) {
      throw new BadDataException(
        `This request names more status pages than one announcement can be on. Send at most ${AnnouncementReach.maxStatusPagesPerRequest} IDs as statusPageIds.`,
      );
    }

    const ids: Array<string> = [];

    for (const value of statusPageIds) {
      const id: string | null = this.readId(value);

      if (!id) {
        throw new BadDataException(
          "This request names a status page by something that is not an ID. Send the IDs of the status pages picked as statusPageIds.",
        );
      }

      if (!ids.includes(id)) {
        ids.push(id);
      }
    }

    const announcementIdValue: unknown = json["announcementId"];
    let announcementId: ObjectID | null = null;

    if (announcementIdValue !== undefined && announcementIdValue !== null) {
      const id: string | null = this.readId(announcementIdValue);

      if (!id) {
        throw new BadDataException(
          "This request names the announcement by something that is not an ID. Send the ID of the announcement being edited as announcementId, or leave it out.",
        );
      }

      announcementId = new ObjectID(id);
    }

    return {
      statusPageIds: ids.map((id: string): ObjectID => {
        return new ObjectID(id);
      }),
      announcementId: announcementId,
    };
  }

  public static async build(data: {
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
    request: AnnouncementReachRequest;
  }): Promise<AnnouncementReachResult> {
    await this.assertCallerMayAsk(data);

    const statusPageIds: Array<ObjectID> = data.request.statusPageIds;

    // No page picked: it shows nowhere, and nobody is told.
    if (statusPageIds.length === 0) {
      return {
        nothingSentReason: PublicNoteNothingSentReason.NoStatusPages,
      };
    }

    await this.assertPagesOfProject({
      projectId: data.projectId,
      statusPageIds: statusPageIds,
      props: {
        isRoot: true,
      },
    });

    /*
     * As the job loads them: an archived page, or one of a blocked project,
     * shows nothing and sends nothing, and is left out here.
     */
    const statusPages: Array<StatusPage> =
      await StatusPageSubscriberService.getStatusPagesToSendNotification(
        statusPageIds,
      );

    return {
      nothingSentReason: PublicNoteReachBuilder.getStatusPagesReason({
        projectId: data.projectId,
        statusPages: statusPages,
        showsEvent: (statusPage: StatusPage): boolean => {
          return Boolean(statusPage.showAnnouncementsOnStatusPage);
        },
      }),
    };
  }

  /*
   * Who may ask, decided for the announcement as the form will save it (see
   * the class). Root and a master admin pass. A refusal is the write's own:
   * what creating the announcement on these pages would be refused with,
   * or why the edit would change nothing (DatabaseService
   * .getUnwrittenByIdError: an announcement the caller may not read is
   * answered as missing).
   */
  public static async assertCallerMayAsk(data: {
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
    request: AnnouncementReachRequest;
  }): Promise<void> {
    if (data.props.isRoot || data.props.isMasterAdmin) {
      return;
    }

    const announcementId: ObjectID | null = data.request.announcementId;

    if (!announcementId) {
      // The create the form will send, held to its checks without its hooks.
      await StatusPageAnnouncementService.checkCallerMayCreate({
        data: this.getDraft({
          projectId: data.projectId,
          statusPageIds: data.request.statusPageIds,
        }),
        props: data.props,
      });

      return;
    }

    const announcement: StatusPageAnnouncement | null =
      await StatusPageAnnouncementService.findOneUpdatableById({
        id: announcementId,
        select: {
          _id: true,
          statusPages: {
            _id: true,
          },
        },
        props: data.props,
      });

    if (!announcement) {
      throw await StatusPageAnnouncementService.getUnwrittenByIdError({
        id: announcementId,
        props: data.props,
        type: DatabaseRequestType.Update,
      });
    }

    // A page the announcement is not on yet: only one the caller may read.
    const pagesItIsOn: Array<string> = (announcement.statusPages || [])
      .map((statusPage: StatusPage): string => {
        return (statusPage._id || statusPage.id?.toString() || "")
          .toString()
          .toLowerCase();
      })
      .filter(Boolean);

    const pagesAdded: Array<ObjectID> = data.request.statusPageIds.filter(
      (id: ObjectID): boolean => {
        return !pagesItIsOn.includes(id.toString().toLowerCase());
      },
    );

    await this.assertPagesOfProject({
      projectId: data.projectId,
      statusPageIds: pagesAdded,
      props: data.props,
    });
  }

  /*
   * Every one of `statusPageIds` is a page of the project - read with
   * `props`, so as the caller, one they may read. One that is not is
   * answered as a page that does not exist, as any reference is.
   */
  private static async assertPagesOfProject(data: {
    projectId: ObjectID;
    statusPageIds: Array<ObjectID>;
    props: DatabaseCommonInteractionProps;
  }): Promise<void> {
    if (data.statusPageIds.length === 0) {
      return;
    }

    const found: Array<StatusPage> = await StatusPageService.findBy({
      query: {
        _id: QueryHelper.any(data.statusPageIds),
        projectId: data.projectId,
      },
      select: {
        _id: true,
      },
      limit: data.statusPageIds.length,
      skip: 0,
      props: data.props,
    });

    const foundIds: Array<string> = found.map(
      (statusPage: StatusPage): string => {
        return (statusPage._id || statusPage.id?.toString() || "")
          .toString()
          .toLowerCase();
      },
    );

    const isEveryPageFound: boolean = data.statusPageIds.every(
      (id: ObjectID): boolean => {
        return foundIds.includes(id.toString().toLowerCase());
      },
    );

    if (!isEveryPageFound) {
      throw new BadDataException(
        "One or more of these status pages were not found in this project.",
      );
    }
  }

  // The announcement the Create form will send, as far as who may create it goes.
  private static getDraft(data: {
    projectId: ObjectID;
    statusPageIds: Array<ObjectID>;
  }): StatusPageAnnouncement {
    const draft: StatusPageAnnouncement = new StatusPageAnnouncement();
    draft.projectId = data.projectId;
    draft.statusPages = data.statusPageIds.map((id: ObjectID): StatusPage => {
      const statusPage: StatusPage = new StatusPage();
      statusPage._id = id.toString();
      return statusPage;
    });

    return draft;
  }

  // A real ID, lower-cased, or null.
  private static readId(value: unknown): string | null {
    let id: string = "";

    if (typeof value === "string") {
      id = value.trim();
    } else if (value instanceof ObjectID) {
      id = value.toString();
    }

    if (!id || !ObjectID.isValidUUID(id)) {
      return null;
    }

    return id.toLowerCase();
  }
}
