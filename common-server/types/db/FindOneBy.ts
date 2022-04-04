import Query from './Query';
import Select from './Select';
import Populate from './Populate';
import Sort from './Sort';

export default interface FindOneBy {
    query: Query;
    select: Select;
    populate: Populate;
    sort: Sort;
}
