import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { JSONObject } from "../../../Types/JSON";

export default interface CreateBy<TBaseModel extends BaseModel> {
  data: TBaseModel;
  miscDataProps?: JSONObject;
  props: DatabaseCommonInteractionProps;
  /*
   * Filled in by the create, for its caller to pass on: each field of
   * `data` it left out because only OneUptime writes it - a column only
   * OneUptime writes (ColumnsOnlyOneUptimeWrites), who did something to the
   * record (UserAttribution), a value OneUptime fills in itself (a computed
   * column) - by the name it was sent under (#10136). The API answers them
   * in its X-OneUptime-Fields-Left-Out header (FieldsLeftOut). A caller that
   * gives none hears nothing.
   */
  fieldsLeftOut?: Array<string> | undefined;
}
