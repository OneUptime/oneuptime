import AnalyticsDataModel from "Common/AnalyticsModels/BaseModel";
import BaseModel from "Common/Models/BaseModel";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { JSONObject } from "Common/Types/JSON";

type Sort<TBaseModel extends AnalyticsDataModel | BaseModel | JSONObject> = {
  [P in keyof TBaseModel]?: SortOrder;
};

export default Sort;
