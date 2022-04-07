import PositiveNumber from 'common/types/PositiveNumber';
import { Document } from '../../utils/ORM';

export default interface SearchResult {
    items: Array<Document>;
    count: PositiveNumber;
}
