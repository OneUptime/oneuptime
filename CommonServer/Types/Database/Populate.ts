import type BaseModel from 'Common/Models/BaseModel';
import type { JSONObject } from 'Common/Types/JSON';
import type { FindOptionsRelations } from 'typeorm';

type Populate<TBaseModel extends BaseModel> =
    | FindOptionsRelations<TBaseModel>
    | JSONObject;

export default Populate;
