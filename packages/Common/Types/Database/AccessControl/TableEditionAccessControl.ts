import TableEditionAccessControl from "../../BaseDatabase/TableEditionAccessControl";
import GenericFunction from "../../GenericFunction";

export default (accessControl: TableEditionAccessControl) => {
  return (ctr: GenericFunction) => {
    ctr.prototype.requiresEnterprise = accessControl.requiresEnterprise;
  };
};
