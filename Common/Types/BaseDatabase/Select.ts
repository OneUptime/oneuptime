import AnalyticsBaseModel from "../../Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import BaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { JSONObject } from "../../Types/JSON";

type Select<TBaseModel extends BaseModel | AnalyticsBaseModel | JSONObject> = {
  [P in keyof TBaseModel]?: boolean | JSONObject;
};

export default Select;
