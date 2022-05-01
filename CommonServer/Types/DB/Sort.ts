import BaseModel from 'Common/Models/BaseModel';
import { FindOptionsOrder } from 'typeorm';

type Sort<TBaseModel extends BaseModel> = FindOptionsOrder<TBaseModel>

export default Sort