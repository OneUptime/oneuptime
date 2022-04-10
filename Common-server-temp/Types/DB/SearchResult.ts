import PositiveNumber from 'common/Types/PositiveNumber';
import { Document } from '../../Infrastructure/ORM';

export default interface SearchResult {
    items: Array<Document>;
    count: PositiveNumber;
}
