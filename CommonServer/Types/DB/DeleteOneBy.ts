import Query from './Query';
import ObjectID from 'Common/Types/ObjectID';

export default interface DeleteOneBy {
    query: Query;
    deletedByUserId: ObjectID;
}
