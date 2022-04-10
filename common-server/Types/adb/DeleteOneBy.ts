import Query from './Query';

export default interface DeleteOneBy {
    query: Query;
    deletedByUserId: string;
}
