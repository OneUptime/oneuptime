import type Query from './Query';
import type Select from './Select';
import type Populate from './Populate';
import type Sort from './Sort';
import type BaseModel from 'Common/Models/BaseModel';
import type DatabaseCommonInteractionProps from 'Common/Types/Database/DatabaseCommonInteractionProps';

export default interface FindOneBy<TBaseModel extends BaseModel> {
    query: Query<TBaseModel>;
    select?: Select<TBaseModel> | undefined;
    populate?: Populate<TBaseModel> | undefined;
    sort?: Sort<TBaseModel> | undefined;
    props: DatabaseCommonInteractionProps;
}
