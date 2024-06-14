import Query from "./Query";
import BaseModel from "Common/Models/BaseModel";
import DatabaseCommonInteractionProps from "Common/Types/BaseDatabase/DatabaseCommonInteractionProps";
import User from "Model/Models/User";

export default interface DeleteOneBy<TBaseModel extends BaseModel> {
  query: Query<TBaseModel>;
  deletedByUser?: User | undefined;
  props: DatabaseCommonInteractionProps;
}
