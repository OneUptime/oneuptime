import FindOneBy from "./FindOneBy";
import AnalyticsBaseModel from "Common/AnalyticsModels/BaseModel";
import PositiveNumber from "Common/Types/PositiveNumber";

export default interface FindBy<TBaseModel extends AnalyticsBaseModel>
  extends FindOneBy<TBaseModel> {
  limit: PositiveNumber | number;
  skip: PositiveNumber | number;
}
