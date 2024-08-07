import Query from "./Query";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseCommonInteractionProps from "Common/Types/BaseDatabase/DatabaseCommonInteractionProps";
import PartialEntity from "Common/Types/Database/PartialEntity";

export default interface UpdateOneBy<TBaseModel extends BaseModel> {
  query: Query<TBaseModel>;
  data: PartialEntity<TBaseModel>;
  props: DatabaseCommonInteractionProps;
}
