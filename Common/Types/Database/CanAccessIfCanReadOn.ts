// This Annotation only allows the record to be CRUD if the user has READ access on related record.
import GenericFunction from '../GenericFunction';

export default (columnName: string) => {
    return (ctr: GenericFunction) => {
        if (columnName) {
            ctr.prototype.canAccessIfCanReadOn = columnName;
        }
    };
};
