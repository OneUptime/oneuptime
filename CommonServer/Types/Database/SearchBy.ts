import Select from './Select';
import PositiveNumber from 'Common/Types/PositiveNumber';
import BaseModel from 'Common/Models/BaseModel';
import DatabaseCommonInteractionProps from 'Common/Types/BaseDatabase/DatabaseCommonInteractionProps';

export default interface SearchBy<TBaseModel extends BaseModel> {
    text: string;
    column: keyof TBaseModel;
    limit: PositiveNumber;
    skip: PositiveNumber;
    select: Select<TBaseModel>;
    props: DatabaseCommonInteractionProps;
}
