import BaseModel from 'Common/Models/BaseModel';
import { JSONObject } from 'Common/Types/JSON';

type Select<TBaseModel extends BaseModel | JSONObject> = {
    [P in keyof TBaseModel]?: boolean | JSONObject;
};

export default Select;
