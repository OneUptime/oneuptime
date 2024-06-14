import FindOneBy from "./FindOneBy";
import BaseModel from "Common/AnalyticsModels/BaseModel";
import PositiveNumber from "Common/Types/PositiveNumber";

export default interface FindBy<TBaseModel extends BaseModel>
  extends FindOneBy<TBaseModel> {
  limit: PositiveNumber | number;
  skip: PositiveNumber | number;
}
