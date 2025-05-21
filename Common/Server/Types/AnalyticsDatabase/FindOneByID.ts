import Select from "./Select";
import BaseModel from "../../../Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../../../Types/ObjectID";

export default interface FindOneByID<TBaseModel extends BaseModel> {
  id: ObjectID;
  select?: Select<TBaseModel> | undefined;
  props: DatabaseCommonInteractionProps;
}
