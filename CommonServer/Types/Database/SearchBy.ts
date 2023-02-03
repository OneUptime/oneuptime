import type Select from './Select';
import type Populate from './Populate';
import type PositiveNumber from 'Common/Types/PositiveNumber';
import type BaseModel from 'Common/Models/BaseModel';
import type DatabaseCommonInteractionProps from 'Common/Types/Database/DatabaseCommonInteractionProps';

export default interface SearchBy<TBaseModel extends BaseModel> {
    text: string;
    column: keyof TBaseModel;
    limit: PositiveNumber;
    skip: PositiveNumber;
    select: Select<TBaseModel>;
    populate: Populate<TBaseModel>;
    props: DatabaseCommonInteractionProps;
}
