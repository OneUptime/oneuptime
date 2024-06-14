import AnalyticsDataModel from "Common/AnalyticsModels/BaseModel";
import BaseModel from "Common/Models/BaseModel";
import { JSONObject } from "Common/Types/JSON";

type GroupBy<TBaseModel extends AnalyticsDataModel | BaseModel | JSONObject> = {
  [P in keyof TBaseModel]?: true;
};

export default GroupBy;
