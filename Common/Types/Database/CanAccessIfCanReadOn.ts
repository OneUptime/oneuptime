// This Annotation only allows the record to be CRUD if the user has READ access on related record.

export default (columnName: string) => {
    return (ctr: Function) => {
        if (columnName) {
            ctr.prototype.canAccessIfCanReadOn = columnName;
        }
    };
};
