import type DeleteOneBy from './DeleteOneBy';
import type BaseModel from 'Common/Models/BaseModel';

type DeleteBy<TBaseModel extends BaseModel> = DeleteOneBy<TBaseModel>;
export default DeleteBy;
