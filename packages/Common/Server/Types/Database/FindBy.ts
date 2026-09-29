import FindOneBy from "./FindOneBy";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import PositiveNumber from "../../../Types/PositiveNumber";

export default interface FindBy<TBaseModel extends BaseModel>
  extends FindOneBy<TBaseModel> {
  limit: PositiveNumber | number;
  skip: PositiveNumber | number;
}
