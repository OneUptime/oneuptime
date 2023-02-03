import type BaseModel from 'Common/Models/BaseModel';
import type { JSONObject } from 'Common/Types/JSON';

type Select<TBaseModel extends BaseModel | JSONObject> = {
    [P in keyof TBaseModel]?: boolean;
};

export default Select;
