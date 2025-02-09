import Select from "./Select";
import UpdateByID from "./UpdateByID";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";

export default interface UpdateByIDAndFetch<TBaseModel extends BaseModel>
  extends UpdateByID<TBaseModel> {
  select?: Select<TBaseModel> | undefined;
}
