import Select from './Select';
import UpdateByID from './UpdateByID';
import BaseModel from 'Common/Models/BaseModel';

export default interface UpdateByIDAndFetch<TBaseModel extends BaseModel>
    extends UpdateByID<TBaseModel> {
    select?: Select<TBaseModel> | undefined;
}
