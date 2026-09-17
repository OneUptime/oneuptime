import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../../../Types/ObjectID";
import QueryDeepPartialEntity from "../../../Types/Database/PartialEntity";
import { JSONObject } from "../../../Types/JSON";

export default interface UpdateBy<TBaseModel extends BaseModel> {
  id: ObjectID;
  data: QueryDeepPartialEntity<TBaseModel>;
  // See UpdateOneBy.miscDataProps.
  miscDataProps?: JSONObject | undefined;
  props: DatabaseCommonInteractionProps;
}
