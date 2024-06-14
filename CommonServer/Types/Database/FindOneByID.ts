import Select from "./Select";
import BaseModel from "Common/Models/BaseModel";
import DatabaseCommonInteractionProps from "Common/Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "Common/Types/ObjectID";

export default interface FindOneByID<TBaseModel extends BaseModel> {
  id: ObjectID;
  select?: Select<TBaseModel> | undefined;
  props: DatabaseCommonInteractionProps;
}
