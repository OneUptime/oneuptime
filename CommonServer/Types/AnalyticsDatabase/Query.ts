import AnalyticsBaseModel from 'Common/AnalyticsModels/BaseModel';
import { JSONObject, JSONValue } from 'Common/Types/JSON';

export type QueryPropertyOptions = JSONValue | JSONObject;

export declare type QueryOptions<Entity> = {
    [P in keyof Entity]?: QueryPropertyOptions;
};

type Query<TBaseModel extends AnalyticsBaseModel> = QueryOptions<TBaseModel>;
export default Query;
