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
  }): Promise<boolean> {
    const recordModelType: DatabaseBaseModelType = data.recordService
      .modelType as DatabaseBaseModelType;

    if (!PrivateRecordWriteCheck.isPartOf(data.modelType, recordModelType)) {
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
   * Whether a write of `modelType` is one of `recordModelType`'s records or
   * of their parts (PrivateRecordPermission.getPrivateRecordColumn).
   */
  public static isPartOf(
    modelType: DatabaseBaseModelType,
    recordModelType: DatabaseBaseModelType,
  ): boolean {
    const column: PrivateRecordColumn | null =
      PrivateRecordPermission.getPrivateRecordColumn(modelType);

    return Boolean(
      column &&
        column.kind.tableName === new recordModelType().tableName,
    );
  }
}
