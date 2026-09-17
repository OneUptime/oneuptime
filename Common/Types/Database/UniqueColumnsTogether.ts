import GenericFunction from "../GenericFunction";

/*
 * Declares that no two rows of a model may share the same values across
 * `columnNames`. DatabaseService.create looks for an existing row with those
 * values before inserting and, if there is one, rejects the insert with
 * `errorMessage` instead of writing a second row.
 *
 * WHY THIS EXISTS
 *
 * Join rows such as <Resource>OwnerTeam / <Resource>OwnerUser have side effects
 * on create: each new row writes a feed item and notifies the owner. The
 * dashboard hides owners that are already attached, but the REST API,
 * workflows and internal callers all insert directly, so a duplicate row used
 * to mean a duplicate notification (issue #3394).
 *
 * This is the application half of the guarantee. Declare the same columns in
 * an `@Index([...], { unique: true })` on the entity as well: a check before an
 * insert cannot stop two concurrent writers, and only the database can.
 * PostgresErrorTranslator.isUniqueViolation() recognises the rejection from
 * either layer, so a caller that wants "already there" to be a no-op needs a
 * single check.
 *
 * Only creates are checked. Rows are expected to be re-keyed rarely, if ever,
 * and the unique index covers updates.
 */

export interface UniqueColumnsTogetherMetadata {
  columnNames: Array<string>;
  errorMessage: string;
}

export default (columnNames: Array<string>, errorMessage: string) => {
  return (ctr: GenericFunction) => {
    /*
     * Stackable. Read only this class's own list: a subclass must not
     * append to the list its parent keeps on the parent's prototype.
     */
    const existing: Array<UniqueColumnsTogetherMetadata> =
      Object.prototype.hasOwnProperty.call(
        ctr.prototype,
        "uniqueColumnsTogether",
      )
        ? ctr.prototype.uniqueColumnsTogether
        : [];

    ctr.prototype.uniqueColumnsTogether = [
      ...existing,
      {
        columnNames: [...columnNames],
        errorMessage: errorMessage,
      },
    ];
  };
};
