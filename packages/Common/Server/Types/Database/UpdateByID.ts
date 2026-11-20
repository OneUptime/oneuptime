import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../../../Types/ObjectID";
import QueryDeepPartialEntity from "../../../Types/Database/PartialEntity";
import { JSONObject } from "../../../Types/JSON";
import { ListChanges } from "../../../Types/Database/ListChanges";

export default interface UpdateBy<TBaseModel extends BaseModel> {
  id: ObjectID;
  data: QueryDeepPartialEntity<TBaseModel>;
  // See UpdateOneBy.miscDataProps.
  miscDataProps?: JSONObject | undefined;
  // See UpdateOneBy.auditLogIncludeColumns.
  auditLogIncludeColumns?: Array<string> | undefined;
  /*
   * Entries to add to the record's lists of related records and take off
   * them, by the list's field, beside or in place of `data`
   * (Types/Database/ListChanges, #10135): the record's write adds and takes
   * off only these, so an entry added at the same moment stays. A list is
   * named here or in `data`, not both.
   */
  listChanges?: ListChanges | undefined;
  props: DatabaseCommonInteractionProps;
}
