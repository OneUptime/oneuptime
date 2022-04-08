import PositiveNumber from 'common/types/PositiveNumber';
import { Document } from '../../infrastructure/ORM';

export default interface SearchResult {
    items: Array<Document>;
    count: PositiveNumber;
}
