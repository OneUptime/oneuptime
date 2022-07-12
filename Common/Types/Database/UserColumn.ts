export default (columnName: string) => {
    return (ctr: Function) => {
        ctr.prototype.userColumn = columnName;
    };
};
