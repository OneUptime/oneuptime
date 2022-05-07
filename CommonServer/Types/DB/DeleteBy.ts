import BaseModel from 'Common/Models/BaseModel';
import DeleteOneBy from './DeleteOneBy';

export default interface DeleteBy<TBaseModel extends BaseModel>
    extends DeleteOneBy<TBaseModel> {}
