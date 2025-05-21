import AnalyticsDataModel from "../../../Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { JSONObject } from "../../../Types/JSON";

type Sort<TBaseModel extends AnalyticsDataModel | BaseModel | JSONObject> = {
  [P in keyof TBaseModel]?: SortOrder;
};

export default Sort;
