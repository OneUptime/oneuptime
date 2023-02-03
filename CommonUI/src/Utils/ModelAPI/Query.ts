import type BaseModel from 'Common/Models/BaseModel';
import type CompareBase from 'Common/Types/Database/CompareBase';
import type InBetween from 'Common/Types/Database/InBetween';
import type NotNull from 'Common/Types/Database/NotNull';
import type Search from 'Common/Types/Database/Search';
import type { JSONObject, JSONValue } from 'Common/Types/JSON';

type Query<TBaseModel extends BaseModel | JSONObject> = {
    [P in keyof TBaseModel]?:
        | JSONValue
        | Search
        | InBetween
        | NotNull
        | CompareBase;
};

export default Query;
