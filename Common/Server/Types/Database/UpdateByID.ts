import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../../../Types/ObjectID";
import QueryDeepPartialEntity from "../../../Types/Database/PartialEntity";

export default interface UpdateBy<TBaseModel extends BaseModel> {
  id: ObjectID;
  data: QueryDeepPartialEntity<TBaseModel>;
  props: DatabaseCommonInteractionProps;
}
