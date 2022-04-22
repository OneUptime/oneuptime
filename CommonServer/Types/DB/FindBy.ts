import PositiveNumber from 'Common/Types/PositiveNumber';
import FindOneBy from './FindOneBy';

export default interface FindBy extends FindOneBy {
    limit: PositiveNumber;
    skip: PositiveNumber;
}
