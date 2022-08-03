import ObjectID from 'Common/Types/ObjectID';
import DatabaseCommonInteractionProps from 'Common/Types/Database/DatabaseCommonInteractionProps';
import BaseModel from 'Model/Models/BaseModel';
import Select from './Select';
import Populate from './Populate';

export default interface FindOneByID<TBaseModel extends BaseModel> {
    id: ObjectID;
    select?: Select<TBaseModel>;
    populate?: Populate<TBaseModel>;
    props: DatabaseCommonInteractionProps;
}
