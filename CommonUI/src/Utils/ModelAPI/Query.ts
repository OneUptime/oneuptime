import BaseModel from 'Common/Models/BaseModel';
import { JSONValue } from 'Common/Types/JSON';

type Query<TBaseModel extends BaseModel> = {
    [P in keyof TBaseModel]?: JSONValue;
};

export default Query;
