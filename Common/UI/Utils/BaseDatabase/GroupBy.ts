import AnalyticsBaseModel from "Common/Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { JSONObject } from "Common/Types/JSON";

type GroupBy<TBaseModel extends AnalyticsBaseModel | BaseModel | JSONObject> = {
  [P in keyof TBaseModel]?: true;
};

export default GroupBy;
