export default (columnName: string) => {
    return (ctr: Function) => {
        ctr.prototype.currentUserCanAccessColumnBy = columnName;
    };
};
