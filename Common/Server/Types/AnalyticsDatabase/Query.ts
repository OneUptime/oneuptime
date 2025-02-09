import AnalyticsBaseModel from "Common/Models/AnalyticsModels/AnalyticsBaseModel/AnalyticsBaseModel";
import CommonQuery from "Common/Types/BaseDatabase/Query";

type Query<TBaseModel extends AnalyticsBaseModel> = CommonQuery<TBaseModel>;

export default Query;
