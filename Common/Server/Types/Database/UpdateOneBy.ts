import Query from "./Query";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import PartialEntity from "../../../Types/Database/PartialEntity";

export default interface UpdateOneBy<TBaseModel extends BaseModel> {
  query: Query<TBaseModel>;
  data: PartialEntity<TBaseModel>;
  props: DatabaseCommonInteractionProps;
}
