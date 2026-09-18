import DeleteOneBy from "./DeleteOneBy";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import PositiveNumber from "../../../Types/PositiveNumber";

interface DeleteBy<TBaseModel extends BaseModel>
  extends DeleteOneBy<TBaseModel> {
  limit: PositiveNumber | number;
  skip: PositiveNumber | number;
}

export default DeleteBy;
