import AnalyticsBaseModel from "../../Models/AnalyticsModels/AnalyticsBaseModel";
import CommonQuery from "../../Types/BaseDatabase/Query";

type Query<TBaseModel extends AnalyticsBaseModel> = CommonQuery<TBaseModel>;

export default Query;
