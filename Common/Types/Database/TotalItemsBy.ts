export default (
    columnName: string,
    totalItems: number,
    errorMessage: string
) => {
    return (ctr: Function) => {
        ctr.prototype.totalItemsByColumnnName = columnName;
        ctr.prototype.totalItemsNumber = totalItems;
        ctr.prototype.totalItemsErrorMessage = errorMessage;
    };
};
