import ObjectID from 'Common/Types/ObjectID';
import DatabaseCommonInteractionProps from 'Common/Types/Database/DatabaseCommonInteractionProps';
import BaseModel from 'Common/Models/BaseModel';
import Select from './Select';
import Populate from './RelationSelect';

export default interface FindOneByID<TBaseModel extends BaseModel> {
    id: ObjectID;
    select?: Select<TBaseModel> | undefined;
    populate?: Populate<TBaseModel> | undefined;
    props: DatabaseCommonInteractionProps;
}
