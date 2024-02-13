import BaseModel from 'Common/Models/BaseModel';
import CompareBase from 'Common/Types/Database/CompareBase';
import InBetween from 'Common/Types/BaseDatabase/InBetween';
import NotNull from 'Common/Types/BaseDatabase/NotNull';
import Search from 'Common/Types/BaseDatabase/Search';
import { JSONObject, JSONValue } from 'Common/Types/JSON';
import AnalyticsBaseModel from 'Common/AnalyticsModels/BaseModel';

type Query<TBaseModel extends BaseModel | AnalyticsBaseModel | JSONObject> = {
    [P in keyof TBaseModel]?:
        | JSONValue
        | Search
        | InBetween
        | NotNull
        | CompareBase;
};

export default Query;
