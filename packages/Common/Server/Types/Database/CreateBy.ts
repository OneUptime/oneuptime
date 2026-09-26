import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { JSONObject } from "../../../Types/JSON";
import CreateByTx from "./CreateByTx";

export default interface CreateBy<TBaseModel extends BaseModel> {
  data: TBaseModel;
  miscDataProps?: JSONObject;
  props: DatabaseCommonInteractionProps;
  /*
   * Server-only: run the insert on this transaction's EntityManager and
   * defer the create success phase until afterCommit. Omit it and create
   * behaves exactly as before. See CreateByTx.
   */
  tx?: CreateByTx;
}
