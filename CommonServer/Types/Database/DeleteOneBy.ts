import Query from "./Query";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseCommonInteractionProps from "Common/Types/BaseDatabase/DatabaseCommonInteractionProps";
import User from "Common/Models/DatabaseModels/User";

export default interface DeleteOneBy<TBaseModel extends BaseModel> {
  query: Query<TBaseModel>;
  deletedByUser?: User | undefined;
  props: DatabaseCommonInteractionProps;
}
