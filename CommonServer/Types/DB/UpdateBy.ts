import BaseModel from 'Common/Models/BaseModel';
import UpdateOneBy from './UpdateOneBy';

export default interface UpdateBy<TBaseModel extends BaseModel> extends UpdateOneBy<TBaseModel> {}
