import type ObjectID from 'Common/Types/ObjectID';
import type DatabaseCommonInteractionProps from 'Common/Types/Database/DatabaseCommonInteractionProps';
import type BaseModel from 'Common/Models/BaseModel';
import type Select from './Select';
import type Populate from './Populate';

export default interface FindOneByID<TBaseModel extends BaseModel> {
    id: ObjectID;
    select?: Select<TBaseModel> | undefined;
    populate?: Populate<TBaseModel> | undefined;
    props: DatabaseCommonInteractionProps;
}
