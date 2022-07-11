import BaseModel from 'Common/Models/BaseModel';
import PositiveNumber from 'Common/Types/PositiveNumber';
import DatabaseCommonInteractionProps from 'Common/Types/Database/DatabaseCommonInteractionProps';
import Query from './Query';

export default interface CountBy<TBaseModel extends BaseModel>
    extends DatabaseCommonInteractionProps {
    query: Query<TBaseModel>;
    skip?: PositiveNumber;
    limit?: PositiveNumber;
}
