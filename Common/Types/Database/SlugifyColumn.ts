import GenericFunction from "../GenericFunction";

export default (columnName: string, saveSlugToColumnName: string) => {
  return (ctr: GenericFunction) => {
    ctr.prototype.slugifyColumn = columnName;
    ctr.prototype.saveSlugToColumn = saveSlugToColumnName;
  };
};
