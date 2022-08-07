export default (isMultiTenant: string) => {
    return (ctr: Function) => {
        ctr.prototype.userColumn = columnName;
    };
};
