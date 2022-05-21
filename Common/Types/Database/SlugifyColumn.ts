export default (columnName: string, saveSlugToColumnName: string) => {
    return (ctr: Function) => {
        ctr.prototype.slugifyColumn = columnName;
        ctr.prototype.saveSlugToColumn = saveSlugToColumnName;
    };
};
