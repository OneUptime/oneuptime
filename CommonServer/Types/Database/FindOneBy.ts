import Query from './Query';
import Select from './Select';
import Populate from './Populate';
import Sort from './Sort';
import BaseModel from 'Common/Models/BaseModel';
import DatabaseCommonInteractionProps from './DatabaseCommonInteractionProps';

export default interface FindOneBy<TBaseModel extends BaseModel>
    extends DatabaseCommonInteractionProps {
    query: Query<TBaseModel>;
    select?: Select<TBaseModel>;
    populate?: Populate<TBaseModel>;
    sort?: Sort<TBaseModel>;
}
