import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseCommonInteractionProps from "Common/Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "Common/Types/ObjectID";
import QueryDeepPartialEntity from "../../../Types/Database/PartialEntity";


export default interface UpdateBy<TBaseModel extends BaseModel> {
  id: ObjectID;
  data: QueryDeepPartialEntity<TBaseModel>;
  props: DatabaseCommonInteractionProps;
}
