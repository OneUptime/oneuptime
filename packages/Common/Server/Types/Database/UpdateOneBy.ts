import Query from "./Query";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import PartialEntity from "../../../Types/Database/PartialEntity";
import { JSONObject } from "../../../Types/JSON";
import { ListEntryWrites } from "../../Utils/Database/ListEntries";

export default interface UpdateOneBy<TBaseModel extends BaseModel> {
  query: Query<TBaseModel>;
  data: PartialEntity<TBaseModel>;
  /*
   * Request-scoped choices that are not columns, read by a service's update
   * hooks - the update-side twin of CreateBy.miscDataProps. For example,
   * whether an edit to a public note should notify status page subscribers.
   */
  miscDataProps?: JSONObject | undefined;
  /*
   * The columns this write records in the audit log although the model's
   * audit configuration leaves them out as OneUptime's own: a write
   * OneUptime makes for a person (OnBehalfOfProps) names the columns that
   * say what they did - a run they cancelled names its status. Recorded on
   * this write's entry only; one nobody may read, or a secret, as changed
   * and never with its value (AuditLogService.recordUpdate's
   * includeColumns).
   */
  auditLogIncludeColumns?: Array<string> | undefined;
  /*
   * What updateOneById made of an update's list changes (UpdateByID
   * .listChanges, #10135): each list it changes is in `data` whole, for
   * every check and hook, and the row's write adds and takes off only these
   * entries (Server/Utils/Database/ListEntries). Set by updateOneById, for
   * the one row it updates.
   */
  listEntryWrites?: ListEntryWrites | undefined;
  props: DatabaseCommonInteractionProps;
}
