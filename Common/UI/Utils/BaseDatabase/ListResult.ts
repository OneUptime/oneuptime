import AnalyticsBaseModel from "../../Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import BaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { JSONObject } from "../../Types/JSON";

export default interface ListResult<
  TBaseModel extends BaseModel | AnalyticsBaseModel,
> extends JSONObject {
  data: Array<TBaseModel>;
  count: number;
  skip: number;
  limit: number;
}
