import AnalyticsBaseModel from "../../Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import BaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { JSONObject } from "../../Types/JSON";

type GroupBy<TBaseModel extends AnalyticsBaseModel | BaseModel | JSONObject> = {
  [P in keyof TBaseModel]?: true;
};

export default GroupBy;
