import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/WorkspacePublicNoteApprovalMessage";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import ObjectID from "../../Types/ObjectID";
import Query from "../Types/Database/Query";
import QueryHelper from "../Types/Database/QueryHelper";
import Select from "../Types/Database/Select";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

/*
 * The column that names the note a kept message is about, one per kind of
 * note (WorkspacePublicNoteApprovalMessages.getNoteColumn).
 */
export type WorkspacePublicNoteApprovalMessageNoteColumn =
  | "incidentPublicNoteId"
  | "incidentEpisodePublicNoteId"
  | "scheduledMaintenancePublicNoteId";

/*
 * The approval messages OneUptime keeps while a public note's round of
 * approval is open (WorkspacePublicNoteApprovalMessage), as
 * WorkspacePublicNoteApprovalMessages keeps, finds and drops them. Only the
 * server reads or writes a row.
 */
export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  // The note a kept message is about.
  public static getNoteId(message: Model): ObjectID | null {
    return (
      message.incidentPublicNoteId ||
      message.incidentEpisodePublicNoteId ||
      message.scheduledMaintenancePublicNoteId ||
      null
    );
  }

  // Every message kept for these notes of the project, oldest first.
  @CaptureSpan()
  public async findForNotes(data: {
    projectId: ObjectID;
    noteColumn: WorkspacePublicNoteApprovalMessageNoteColumn;
    noteIds: Array<ObjectID>;
  }): Promise<Array<Model>> {
    if (data.noteIds.length === 0) {
      return [];
    }

    return await this.findKept({
      projectId: data.projectId,
      [data.noteColumn]: QueryHelper.any(data.noteIds),
    } as Query<Model>);
  }

  /*
   * Every message kept for a note of one kind on these records, of the
   * project: what a delete of the records takes with them.
   */
  @CaptureSpan()
  public async findForRecords(data: {
    projectId: ObjectID;
    noteColumn: WorkspacePublicNoteApprovalMessageNoteColumn;
    recordIds: Array<ObjectID>;
  }): Promise<Array<Model>> {
    if (data.recordIds.length === 0) {
      return [];
    }

    return await this.findKept({
      projectId: data.projectId,
      recordId: QueryHelper.any(data.recordIds),
      [data.noteColumn]: QueryHelper.notNull(),
    } as Query<Model>);
  }

  /*
   * Takes a kept message out of the table: true when this call took it, so
   * whoever takes a message is the one who replaces it, once - and a
   * message is never kept past its round, whatever comes of replacing it.
   */
  @CaptureSpan()
  public async claim(data: {
    id: ObjectID;
    projectId: ObjectID;
  }): Promise<boolean> {
    const removed: number = await this.deleteOneBy({
      query: {
        _id: data.id.toString(),
        projectId: data.projectId,
      },
      props: {
        isRoot: true,
        ignoreHooks: true,
      },
    });

    return removed > 0;
  }

  private async findKept(query: Query<Model>): Promise<Array<Model>> {
    return await this.findBy({
      query: query,
      select: Service.SELECT,
      sort: {
        createdAt: SortOrder.Ascending,
      },
      skip: 0,
      limit: LIMIT_MAX,
      props: {
        isRoot: true,
      },
    });
  }

  private static readonly SELECT: Select<Model> = {
    _id: true,
    projectId: true,
    userId: true,
    incidentPublicNoteId: true,
    incidentEpisodePublicNoteId: true,
    scheduledMaintenancePublicNoteId: true,
    recordId: true,
    workspaceType: true,
    workspaceProjectId: true,
    channelId: true,
    messageId: true,
    serviceUrl: true,
    submittedAt: true,
    stepId: true,
    isFinal: true,
    isEdit: true,
    textDigest: true,
    createdAt: true,
  };
}

export default new Service();
