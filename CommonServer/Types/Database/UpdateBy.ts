import type BaseModel from 'Common/Models/BaseModel';
import type UpdateOneBy from './UpdateOneBy';

type UpdateBy<TBaseModel extends BaseModel> = UpdateOneBy<TBaseModel>;
export default UpdateBy;
