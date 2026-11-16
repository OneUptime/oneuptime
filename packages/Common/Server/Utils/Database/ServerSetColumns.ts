/*
 * THE SERVER-SET COLUMNS ONEUPTIME'S OWN CODE FILLS IN ON A RECORD IT
 * CREATES AS A PERSON.
 *
 * A column marked computed is OneUptime's to fill in. On a create, a value a
 * write gives one is held to the column's create list, as any other column's
 * is, and refused for anyone not on it (ColumnPermission
 * .checkComputedColumnsSentOnCreate); what the create's own steps write there
 * once it has been asked - its hooks, the defaults, the hashing - is
 * OneUptime's (checkDataColumnPermissions' columnsSetByServer).
 *
 * Some of OneUptime's own writes are made as the person they act for, so
 * that the person's permissions are asked of the record: the owners picked in
 * the form that created a resource (OwnerRuleAssignment), the status rows an
 * incident they declare or edit gives its monitors (MonitorService
 * .changeMonitorStatus). Those fill in a computed column of the record before
 * they create it - whether its owners are told, the evidence of a status
 * change - and mark the record: the columns they name hold OneUptime's values
 * on that record, not the person's.
 *
 * The mark is the record object itself, held weakly for as long as the record
 * is: nothing a request carries can make one, as BaseAPI and the workflow
 * steps build every record they create from what was sent. A mark names a
 * column only once its value is set, so marking a column leaves no value of
 * the person's in it.
 */
const SERVER_SET_COLUMNS: WeakMap<object, Set<string>> = new WeakMap<
  object,
  Set<string>
>();

export default class ServerSetColumns {
  /*
   * Writes `values` into `record`'s columns and marks them as OneUptime's:
   * a value left undefined is neither written nor marked.
   */
  public static set(record: object, values: Record<string, unknown>): void {
    const columns: Array<string> = [];

    for (const [column, value] of Object.entries(values)) {
      if (value === undefined) {
        continue;
      }

      (record as Record<string, unknown>)[column] = value;
      columns.push(column);
    }

    ServerSetColumns.mark(record, columns);
  }

  // Marks `columns` of `record` as holding the values OneUptime's own code gave them.
  public static mark(record: object, columns: Array<string>): void {
    if (columns.length === 0) {
      return;
    }

    const marked: Set<string> =
      SERVER_SET_COLUMNS.get(record) || new Set<string>();

    for (const column of columns) {
      marked.add(column);
    }

    SERVER_SET_COLUMNS.set(record, marked);
  }

  // Whether OneUptime's own code marked `column` of `record` (set, mark).
  public static isMarked(record: unknown, column: string): boolean {
    if (!record || typeof record !== "object") {
      return false;
    }

    return Boolean(SERVER_SET_COLUMNS.get(record)?.has(column));
  }

  // The columns of `record` OneUptime's own code marked, in the order it marked them.
  public static getMarked(record: unknown): Array<string> {
    if (!record || typeof record !== "object") {
      return [];
    }

    return Array.from(SERVER_SET_COLUMNS.get(record) || []);
  }
}
