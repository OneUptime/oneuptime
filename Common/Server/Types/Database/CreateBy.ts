import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { JSONObject } from "../../../Types/JSON";

export default interface CreateBy<TBaseModel extends BaseModel> {
  data: TBaseModel;
  miscDataProps?: JSONObject;
  props: DatabaseCommonInteractionProps;
}
