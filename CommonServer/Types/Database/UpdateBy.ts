import BaseModel from 'Model/Models/BaseModel';
import UpdateOneBy from './UpdateOneBy';

type UpdateBy<TBaseModel extends BaseModel> = UpdateOneBy<TBaseModel>;
export default UpdateBy;
