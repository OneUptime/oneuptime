import AnalyticsBaseModel from "Common/AnalyticsModels/BaseModel";
import BaseModel from "Common/Models/BaseModel";
import { JSONObject } from "Common/Types/JSON";

export default interface ListResult<
  TBaseModel extends BaseModel | AnalyticsBaseModel,
> extends JSONObject {
  data: Array<TBaseModel>;
  count: number;
  skip: number;
  limit: number;
}
