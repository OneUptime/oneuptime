import AnalyticsBaseModel from "Common/Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { JSONObject } from "Common/Types/JSON";

type Select<TBaseModel extends BaseModel | AnalyticsBaseModel | JSONObject> = {
  [P in keyof TBaseModel]?: boolean | JSONObject;
};

export default Select;
