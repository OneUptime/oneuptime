import AnalyticsBaseModel from "Common/AnalyticsModels/BaseModel";
import CommonQuery from "Common/Types/BaseDatabase/Query";

type Query<TBaseModel extends AnalyticsBaseModel> = CommonQuery<TBaseModel>;

export default Query;
