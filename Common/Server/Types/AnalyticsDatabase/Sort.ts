import BaseModel from "Common/Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import CommonSort from "Common/Types/BaseDatabase/Sort";

type Sort<TBaseModel extends BaseModel> = CommonSort<TBaseModel>;

export default Sort;
