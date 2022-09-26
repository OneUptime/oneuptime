import BaseModel from 'Common/Models/BaseModel';
import UpdateByID from './UpdateByID';
import Select from './Select';
import Populate from './Populate';

export default interface UpdateByIDAndFetch<TBaseModel extends BaseModel>
    extends UpdateByID<TBaseModel> {
    select?: Select<TBaseModel> | undefined;
    populate?: Populate<TBaseModel> | undefined;
}
