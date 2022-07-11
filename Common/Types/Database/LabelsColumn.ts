export default (columnName: string) => {
    return (ctr: Function) => {
        ctr.prototype.labelsColumn = columnName;
    };
};
