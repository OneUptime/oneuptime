import BaseModel from 'Common/Models/BaseModel';
import { FindOptionsRelations } from 'typeorm';

type Populate<TBaseModel extends BaseModel> = FindOptionsRelations<TBaseModel>;
export default Populate;
