import GenericFunction from '../GenericFunction';

export default (
    columnName: string,
    totalItems: number,
    errorMessage: string
) => {
    return (ctr: GenericFunction) => {
        ctr.prototype.totalItemsByColumnName = columnName;
        ctr.prototype.totalItemsNumber = totalItems;
        ctr.prototype.totalItemsErrorMessage = errorMessage;
    };
};
