import BaseModel from 'Common/Models/BaseModel';
import SortOrder from 'Common/Types/Database/SortOrder';
import { JSONObject } from 'Common/Types/JSON';

type Query<TBaseModel extends BaseModel | JSONObject> = {
    [P in keyof TBaseModel]?: SortOrder;
};

export default Query;
