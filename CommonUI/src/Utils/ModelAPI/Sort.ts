import type BaseModel from 'Common/Models/BaseModel';
import type SortOrder from 'Common/Types/Database/SortOrder';
import type { JSONObject } from 'Common/Types/JSON';

type Query<TBaseModel extends BaseModel | JSONObject> = {
    [P in keyof TBaseModel]?: SortOrder;
};

export default Query;
