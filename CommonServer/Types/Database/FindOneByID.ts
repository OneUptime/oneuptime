import ObjectID from 'Common/Types/ObjectID';
import DatabaseCommonInteractionProps from 'Common/Types/Database/DatabaseCommonInteractionProps';
import BaseModel from 'Common/Models/BaseModel';
import Select from './Select';

export default interface FindOneByID<TBaseModel extends BaseModel> {
    id: ObjectID;
    select?: Select<TBaseModel>,
    props: DatabaseCommonInteractionProps;
}
