import BaseModel from "../../../Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import CommonSort from "../../../Types/BaseDatabase/Sort";

type Sort<TBaseModel extends BaseModel> = CommonSort<TBaseModel>;

export default Sort;
