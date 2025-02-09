import AnalyticsDataModel from "Common/Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { JSONObject } from "Common/Types/JSON";

type Sort<TBaseModel extends AnalyticsDataModel | BaseModel | JSONObject> = {
  [P in keyof TBaseModel]?: SortOrder;
};

export default Sort;
