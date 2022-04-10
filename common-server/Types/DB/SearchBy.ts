import Select from './Select';
import Populate from './Populate';
import PositiveNumber from 'common/Types/PositiveNumber';

export default interface SearchBy {
    text: string;
    column: string;
    limit: PositiveNumber;
    skip: PositiveNumber;
    select: Select;
    populate: Populate;
}
