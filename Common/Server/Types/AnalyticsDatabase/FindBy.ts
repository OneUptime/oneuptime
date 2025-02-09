import FindOneBy from "./FindOneBy";
import AnalyticsBaseModel from "Common/Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import PositiveNumber from "Common/Types/PositiveNumber";

export default interface FindBy<TBaseModel extends AnalyticsBaseModel>
  extends FindOneBy<TBaseModel> {
  limit: PositiveNumber | number;
  skip: PositiveNumber | number;
}
