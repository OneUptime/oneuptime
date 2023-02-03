import type BaseModel from 'Common/Models/BaseModel';
import type { JSONObject } from 'Common/Types/JSON';

type Populate<TBaseModel extends BaseModel | JSONObject> = {
    [P in keyof TBaseModel]?: boolean | JSONObject;
};

export default Populate;
