import BaseModel from "Common/AnalyticsModels/BaseModel";
import CommonSort from "Common/Types/BaseDatabase/Sort";

type Sort<TBaseModel extends BaseModel> = CommonSort<TBaseModel>;

export default Sort;
