import UpdateOneBy from "./UpdateOneBy";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import PositiveNumber from "../../../Types/PositiveNumber";

interface UpdateBy<TBaseModel extends BaseModel>
  extends UpdateOneBy<TBaseModel> {
  limit: PositiveNumber | number;
  skip: PositiveNumber | number;
}

export default UpdateBy;
