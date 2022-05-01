import BaseModel from 'Common/Models/BaseModel';
import { FindOptionsWhere } from 'typeorm';

declare type Query<TBaseModel extends BaseModel> = FindOptionsWhere<TBaseModel>;

export default Query;