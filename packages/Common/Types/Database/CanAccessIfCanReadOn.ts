// This Annotation only allows the record to be CRUD if the user has READ access on related record.
import GenericFunction from "../GenericFunction";

export interface CanAccessIfCanReadOnOptions {
  /*
   * The model's own read permissions read its rows without one to read the
   * record they name, because the readers OneUptime ships for it do not
   * read that record (an alert responder reads which incidents their alerts
   * are linked to). A caller who may read the record is still held to it -
   * their grants limited to labels and their blocks on reading it narrow
   * the rows as for any model read through another - and a block with no
   * labels on reading it still takes the rows away. Every model declared
   * with it is listed in WriteNeedsReadRoleCoverage.test.ts.
   */
  isParentReadOptional?: boolean | undefined;
}

export default (columnName: string, options?: CanAccessIfCanReadOnOptions) => {
  return (ctr: GenericFunction) => {
    if (columnName) {
      ctr.prototype.canAccessIfCanReadOn = columnName;
      ctr.prototype.isParentReadOptional = Boolean(
        options?.isParentReadOptional,
      );
    }
  };
};
