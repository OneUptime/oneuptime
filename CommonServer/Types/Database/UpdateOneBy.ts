import BaseModel from 'Common/Models/BaseModel';
import DatabaseCommonInteractionProps from 'Common/Types/Database/DatabaseCommonInteractionProps';
import Query from './Query';
import PartialEntity from 'Common/Types/Database/PartialEntity';

export default interface UpdateOneBy<TBaseModel extends BaseModel> {
    query: Query<TBaseModel>;
    data: PartialEntity<TBaseModel>;
    props: DatabaseCommonInteractionProps;
}
