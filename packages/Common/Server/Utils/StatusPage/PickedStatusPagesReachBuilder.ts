import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import PickedStatusPagesReach, {
  PickedStatusPagesReachResult,
} from "../../../Types/StatusPage/PickedStatusPagesReach";
import { PublicNoteNothingSentReason } from "../../../Types/StatusPage/PublicNoteReach";
import DatabaseService from "../../Services/DatabaseService";
import StatusPageService from "../../Services/StatusPageService";
import StatusPageSubscriberService from "../../Services/StatusPageSubscriberService";
import DatabaseRequestType from "../../Types/BaseDatabase/DatabaseRequestType";
import QueryHelper from "../../Types/Database/QueryHelper";
import Select from "../../Types/Database/Select";
import PublicNoteReachBuilder from "./PublicNoteReachBuilder";

/*
 * What a record on the status pages picked on its form does
 * (Types/StatusPage/PickedStatusPagesReach), for POST /<record>/reach:
 * whether one of them shows that kind of record, and whether one that does
 * tells its subscribers - or why not. An announcement's forms say it
 * (#9775, AnnouncementReachBuilder), and a maintenance event's and a
 * maintenance template's (#9920, ScheduledMaintenanceReachBuilder): each
 * is a kind of record here (PickedStatusPagesRecordKind), and everything
 * else is one rule for all of them.
 *
 * Worked out the way the notification jobs send: the pages loaded as every
 * subscriber notification loads them (StatusPageSubscriberService
 * .getStatusPagesToSendNotification: an archived page and a blocked
 * project's pages left out), then the ones that show the kind of record,
 * then whether one of those sends notifications - by the one rule every
 * answer of this kind is given by (PublicNoteReachBuilder
 * .getStatusPagesReason, #9735).
 *
 * Who may ask is decided for the record as the form will save it, never by
 * the table's permissions alone
 * (Tests/Server/Utils/Permission/TableHalfWriteGuard):
 *
 *   - on Create, whoever may create this record: the checks a create of
 *     one on the pages picked runs, without writing it
 *     (DatabaseService.checkCallerMayCreate) - the table and its plan, the
 *     caller's read of every page picked, and the labels a permission
 *     limited to some reaches through those pages;
 *   - on Edit (the record's id), whoever may update that record
 *     (DatabaseService.findOneUpdatableById), and a page it is not on yet
 *     only one the caller may read, as the update holds a page it adds.
 *
 * Every page picked must be the project's. One the caller may not read
 * counts all the same when the record is on it already - an edit keeps it
 * - and the answer names no page: it is one reason, or none.
 */

// A kind of record whose form picks the status pages it shows on.
export interface PickedStatusPagesRecordKind<TModel extends BaseModel> {
  modelType: { new (): TModel };
  service: DatabaseService<TModel>;
  // The body's key for the record an Edit edits: "announcementId".
  recordIdKey: string;
  // What a refusal calls the record, in a sentence: "announcement".
  recordName: string;
  // Whether a status page shows this kind of record at all.
  showsRecord: (statusPage: StatusPage) => boolean;
}

export interface PickedStatusPagesReachRequest {
  // The status pages picked on the form, each once.
  statusPageIds: Array<ObjectID>;
  // The record an Edit form is editing; null on Create.
  recordId: ObjectID | null;
}

export default class PickedStatusPagesReachBuilder {
  /*
   * The request body: {statusPageIds, <recordIdKey>?}. Every id a real one,
   * each page once, and no more of them than the form could pick.
   */
  public static parseRequest<TModel extends BaseModel>(
    body: unknown,
    kind: PickedStatusPagesRecordKind<TModel>,
  ): PickedStatusPagesReachRequest {
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

    if (
      statusPageIds.length > PickedStatusPagesReach.maxStatusPagesPerRequest
    ) {
      throw new BadDataException(
        `This request names more status pages than one ${kind.recordName} can be on. Send at most ${PickedStatusPagesReach.maxStatusPagesPerRequest} IDs as statusPageIds.`,
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

    const recordIdValue: unknown = json[kind.recordIdKey];
    let recordId: ObjectID | null = null;

    if (recordIdValue !== undefined && recordIdValue !== null) {
      const id: string | null = this.readId(recordIdValue);

      if (!id) {
        throw new BadDataException(
          `This request names the ${kind.recordName} by something that is not an ID. Send the ID of the ${kind.recordName} being edited as ${kind.recordIdKey}, or leave it out.`,
        );
      }

      recordId = new ObjectID(id);
    }

    return {
      statusPageIds: ids.map((id: string): ObjectID => {
        return new ObjectID(id);
      }),
      recordId: recordId,
    };
  }

  public static async build<TModel extends BaseModel>(data: {
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
    request: PickedStatusPagesReachRequest;
    kind: PickedStatusPagesRecordKind<TModel>;
  }): Promise<PickedStatusPagesReachResult> {
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
     * As the jobs load them: an archived page, or one of a blocked project,
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
        showsEvent: data.kind.showsRecord,
      }),
    };
  }

  /*
   * Who may ask, decided for the record as the form will save it (see the
   * class). Root and a master admin pass. A refusal is the write's own: what
   * creating the record on these pages would be refused with, or why the
   * edit would change nothing (DatabaseService.getUnwrittenByIdError: a
   * record the caller may not read is answered as missing).
   */
  public static async assertCallerMayAsk<TModel extends BaseModel>(data: {
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
    request: PickedStatusPagesReachRequest;
    kind: PickedStatusPagesRecordKind<TModel>;
  }): Promise<void> {
    if (data.props.isRoot || data.props.isMasterAdmin) {
      return;
    }

    const recordId: ObjectID | null = data.request.recordId;

    if (!recordId) {
      // The create the form will send, held to its checks without its hooks.
      await data.kind.service.checkCallerMayCreate({
        data: this.getDraft({
          kind: data.kind,
          projectId: data.projectId,
          statusPageIds: data.request.statusPageIds,
        }),
        props: data.props,
      });

      return;
    }

    const record: TModel | null = await data.kind.service.findOneUpdatableById({
      id: recordId,
      select: {
        _id: true,
        statusPages: {
          _id: true,
        },
      } as unknown as Select<TModel>,
      props: data.props,
    });

    if (!record) {
      throw await data.kind.service.getUnwrittenByIdError({
        id: recordId,
        props: data.props,
        type: DatabaseRequestType.Update,
      });
    }

    // A page the record is not on yet: only one the caller may read.
    const pagesItIsOn: Array<string> = (
      (record.getColumnValue("statusPages") as Array<StatusPage> | null) || []
    )
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

  // The record the Create form will send, as far as who may create it goes.
  private static getDraft<TModel extends BaseModel>(data: {
    kind: PickedStatusPagesRecordKind<TModel>;
    projectId: ObjectID;
    statusPageIds: Array<ObjectID>;
  }): TModel {
    const draft: TModel = new data.kind.modelType();
    draft.setColumnValue("projectId", data.projectId);
    draft.setColumnValue(
      "statusPages",
      data.statusPageIds.map((id: ObjectID): StatusPage => {
        const statusPage: StatusPage = new StatusPage();
        statusPage._id = id.toString();
        return statusPage;
      }),
    );

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
