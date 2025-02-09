import AnalyticsBaseModel from "Common/Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { JSONObject } from "Common/Types/JSON";

export default interface ListResult<
  TBaseModel extends BaseModel | AnalyticsBaseModel,
> extends JSONObject {
  data: Array<TBaseModel>;
  count: number;
  skip: number;
  limit: number;
}
