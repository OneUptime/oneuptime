import BaseModel from 'Common/Models/BaseModel';
import Search from 'Common/Types/Database/Search';
import { JSONObject, JSONValue } from 'Common/Types/JSON';

type Query<TBaseModel extends BaseModel | JSONObject> = {
    [P in keyof TBaseModel]?: JSONValue | Search;
};

export default Query;
