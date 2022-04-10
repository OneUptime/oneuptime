import { Document } from '../../Infrastructure/ORM';
import Query from './Query';

export default interface UpdateOneBy {
    query: Query;
    data: Document;
}
