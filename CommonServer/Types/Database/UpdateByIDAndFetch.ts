import type BaseModel from 'Common/Models/BaseModel';
import type UpdateByID from './UpdateByID';
import type Select from './Select';
import type Populate from './Populate';

export default interface UpdateByIDAndFetch<TBaseModel extends BaseModel>
    extends UpdateByID<TBaseModel> {
    select?: Select<TBaseModel> | undefined;
    populate?: Populate<TBaseModel> | undefined;
}
