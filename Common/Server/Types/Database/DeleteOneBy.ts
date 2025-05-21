import Query from "./Query";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import User from "../../../Models/DatabaseModels/User";

export default interface DeleteOneBy<TBaseModel extends BaseModel> {
  query: Query<TBaseModel>;
  deletedByUser?: User | undefined;
  props: DatabaseCommonInteractionProps;
}
