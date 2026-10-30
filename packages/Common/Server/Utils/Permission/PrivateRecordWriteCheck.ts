import DatabaseBaseModel, {
  DatabaseBaseModelType,
} from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../../../Types/ObjectID";
import DatabaseService from "../../Services/DatabaseService";
import DatabaseRequestType from "../../Types/BaseDatabase/DatabaseRequestType";
import PrivateRecordPermission, {
  PrivateRecordColumn,
} from "../../Types/Database/Permissions/PrivateRecordPermission";
import Query from "../../Types/Database/Query";
import Select from "../../Types/Database/Select";
import CaptureSpan from "../Telemetry/CaptureSpan";

/*
 * WHETHER A WRITE NAMED BY ITS RECORD REACHES A PRIVATE ONE, for the paths
 * that ask before they write: a Slack or Microsoft Teams action, which tells
 * the member why in the chat's own words before anything is written, and the
 * routes that check their caller and then write as OneUptime (an incident
 * call's transcript, IncidentVideoCallAPI). The CRUD path holds every write
 * to the same rule itself (PrivateRecordPermission): this asks it of one
 * record, by its id, without writing.
 *
 * A private incident, alert or episode is changed only with the permissions
 * of the teams that own it and of the people named as its owners: one of
 * their other teams' permission reaches none of it.
 */
export default class PrivateRecordWriteCheck {
  /*
   * Whether `type` on `modelType` - the record's own kind, or a part of it
   * (a note, an owner, a state change, a call) - made by the caller reaches
   * the record `recordId` of `recordService`'s kind: true for a record that
   * is not private, or that the caller or a team of theirs granting the
   * write owns, and for a caller who acts on every private record (project
   * owners and admins, OneUptime itself). A write that is no part of the
   * record's kind is not this rule's to answer: true.
   */
  @CaptureSpan()
  public static async reaches(data: {
    modelType: DatabaseBaseModelType;
    type: DatabaseRequestType;
    recordService: DatabaseService<DatabaseBaseModel>;
    recordId: ObjectID;
    props: DatabaseCommonInteractionProps;
    /*
     * The record as the caller's own read gave it, with isPrivate selected,
     * when the check follows one: a record read as not private is reached
     * without asking again. The write itself is held to the rule whatever
     * this answers.
     */
    readRecord?: DatabaseBaseModel | undefined;
  }): Promise<boolean> {
    const recordModelType: DatabaseBaseModelType = data.recordService
      .modelType as DatabaseBaseModelType;

    if (!PrivateRecordWriteCheck.isPartOf(data.modelType, recordModelType)) {
      return true;
    }

    if (
      data.readRecord &&
      (data.readRecord as unknown as { isPrivate?: unknown }).isPrivate !==
        true
    ) {
      return true;
    }

    const query: Query<DatabaseBaseModel> | null =
      PrivateRecordPermission.getUnreachableRecordsQuery({
        modelType: data.modelType,
        recordModelType: recordModelType,
        recordIds: [data.recordId.toString()],
        props: data.props,
        type: data.type,
      });

    if (!query) {
      return true;
    }

    const unreachable: DatabaseBaseModel | null =
      await data.recordService.findOneBy({
        query: {
          ...query,
          ...(data.props.tenantId ? { projectId: data.props.tenantId } : {}),
        } as Query<DatabaseBaseModel>,
        select: { _id: true } as Select<DatabaseBaseModel>,
        props: { isRoot: true },
      });

    return !unreachable;
  }

  /*
   * Of `records` - read by the caller, isPrivate with them - the ids of the
   * private ones `type` on `modelType` does not reach (lower-cased): what a
   * write of many records at once, made as OneUptime once its caller is
   * checked (adding several alerts to an episode), leaves out, each with
   * why. Asks the database only about the private ones, in one read.
   */
  @CaptureSpan()
  public static async findUnreachable(data: {
    modelType: DatabaseBaseModelType;
    type: DatabaseRequestType;
    recordService: DatabaseService<DatabaseBaseModel>;
    records: Array<DatabaseBaseModel>;
    props: DatabaseCommonInteractionProps;
  }): Promise<Set<string>> {
    const recordModelType: DatabaseBaseModelType = data.recordService
      .modelType as DatabaseBaseModelType;

    const privateIds: Array<string> = data.records
      .filter((record: DatabaseBaseModel): boolean => {
        return (
          Boolean(record._id) &&
          (record as unknown as { isPrivate?: unknown }).isPrivate === true
        );
      })
      .map((record: DatabaseBaseModel): string => {
        return record._id!.toString();
      });

    if (
      privateIds.length === 0 ||
      !PrivateRecordWriteCheck.isPartOf(data.modelType, recordModelType)
    ) {
      return new Set<string>();
    }

    const query: Query<DatabaseBaseModel> | null =
      PrivateRecordPermission.getUnreachableRecordsQuery({
        modelType: data.modelType,
        recordModelType: recordModelType,
        recordIds: privateIds,
        props: data.props,
        type: data.type,
      });

    if (!query) {
      return new Set<string>();
    }

    const unreachable: Array<DatabaseBaseModel> =
      await data.recordService.findBy({
        query: {
          ...query,
          ...(data.props.tenantId ? { projectId: data.props.tenantId } : {}),
        } as Query<DatabaseBaseModel>,
        select: { _id: true } as Select<DatabaseBaseModel>,
        limit: privateIds.length,
        skip: 0,
        props: { isRoot: true },
      });

    return new Set<string>(
      unreachable.map((record: DatabaseBaseModel): string => {
        return (record._id || "").toString().toLowerCase();
      }),
    );
  }

  /*
   * Whether a write of `modelType` is one of `recordModelType`'s records or
   * of their parts (PrivateRecordPermission.getPrivateRecordColumns): an
   * incident's note, or an episode's member row of the episode as much as of
   * its alert.
   */
  public static isPartOf(
    modelType: DatabaseBaseModelType,
    recordModelType: DatabaseBaseModelType,
  ): boolean {
    const recordTable: string | null = new recordModelType().tableName;

    return PrivateRecordPermission.getPrivateRecordColumns(modelType).some(
      (column: PrivateRecordColumn): boolean => {
        return column.kind.tableName === recordTable;
      },
    );
  }
}
