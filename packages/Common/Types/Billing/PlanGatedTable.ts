import { TableColumnMetadata } from "../Database/TableColumn";
import TableColumnType from "../Database/TableColumnType";

/*
 * Configuration a lower plan cannot use can still be seen, switched off and
 * removed.
 *
 * A table marked @TableBillingAccessControl holds a feature a plan sells:
 * single sign-on providers and SCIM connections (Scale), Slack and
 * Microsoft Teams notification rules and summaries, API keys and on-call
 * schedules (Growth), and more. A project that drops below the plan - a
 * trial ends, a downgrade - keeps what it set up, and some of it keeps
 * working: SSO providers sign people in, rules post to channels,
 * schedules page people. API keys and SCIM connections are kept too, but
 * stop working until the project is back on the plan (PlanCutoff-
 * Credentials), and have to be found to be removed. So whatever its plan,
 * a project can still, for the records it already has:
 *
 *   - delete them, on every plan-gated table - except a table whose records
 *     restrict something, where deleting one gives more than the plan
 *     allows (an API key's block permissions: deleteStaysGated);
 *   - switch one off: an update that writes its switch - the isEnabled
 *     column - false, and nothing else;
 *   - read them, on the tables of configuration that keeps working after a
 *     downgrade and has to be found to be stopped, or that stops and has
 *     to be found to be removed (readableBelowPlan).
 *     Every other plan-gated table keeps its read plan: reading its records
 *     is using the feature - a template applied, a group's status worked
 *     out, a log read - and features read their configuration with the
 *     caller's permissions, so a read allowed below the plan would be the
 *     feature working below it.
 *
 * Creating a record, switching one back on and every other change still
 * need the plan, and are refused with the plan's name.
 *
 * Only the plan is relaxed. Who may read, switch off or delete is decided
 * exactly as on the plan: the table's and the columns' permissions, labels,
 * owned scope and team blocks all apply as before (a SCIM connection's
 * bearer token stays readable by project owners only).
 *
 * The server's billing check (BillingPermission) asks this, and so does the
 * dashboard's view of what a project below the plan still has
 * (PlanLeftoverTable), so the page offers exactly the moves the server
 * allows.
 */

// The column that switches a record of a plan-gated table on and off.
export const PLAN_GATED_TABLE_SWITCH_COLUMN: string = "isEnabled";

// What this rule needs to know of a model: its columns and its flags.
export interface PlanGatedTableModel {
  readableBelowPlan?: boolean | undefined;
  deleteStaysGated?: boolean | undefined;
  getTableColumnMetadata: (columnName: string) => TableColumnMetadata;
}

/*
 * The table's switch - its isEnabled column, when it has one that holds a
 * boolean - or null for a table with no off state, whose records are
 * stopped by deleting them.
 */
export const getPlanGatedTableSwitchColumn: (
  model: PlanGatedTableModel,
) => string | null = (model: PlanGatedTableModel): string | null => {
  const metadata: TableColumnMetadata | undefined =
    model.getTableColumnMetadata(PLAN_GATED_TABLE_SWITCH_COLUMN);

  if (metadata && metadata.type === TableColumnType.Boolean) {
    return PLAN_GATED_TABLE_SWITCH_COLUMN;
  }

  return null;
};

/*
 * Whether an update only switches records off: it writes at least one
 * column, and every column it writes is the table's switch, written false.
 * The comparison is exact - "false", 0 or null is not false here - and one
 * more column, whatever it holds, makes it an ordinary update. Columns set
 * to undefined are not written and are ignored. On the server a switch the
 * API, Terraform or a workflow sends as "false", "no", "off" or 0 reaches
 * this as false: DatabaseService turns every Boolean column of a write into
 * the boolean the database stores before any check reads it
 * (Types/Database/BooleanColumnValue), so it switches off like false.
 *
 * Only a plain object of columns qualifies. Anything else - an array, a
 * model, an object whose prototype carries more values - is not a
 * switch-off: a value on the prototype is not among the object's own
 * columns, yet a write that reads columns by name would still write it.
 */
export const isPlanGatedTableSwitchOff: (
  model: PlanGatedTableModel,
  data: unknown,
) => boolean = (model: PlanGatedTableModel, data: unknown): boolean => {
  const switchColumn: string | null = getPlanGatedTableSwitchColumn(model);

  if (!switchColumn || !data || typeof data !== "object") {
    return false;
  }

  const prototype: unknown = Object.getPrototypeOf(data);

  if (prototype !== Object.prototype && prototype !== null) {
    return false;
  }

  const writtenColumns: Array<[string, unknown]> = Object.entries(
    data as Record<string, unknown>,
  ).filter(([, value]: [string, unknown]): boolean => {
    return value !== undefined;
  });

  if (writtenColumns.length === 0) {
    return false;
  }

  return writtenColumns.every(([column, value]: [string, unknown]): boolean => {
    return column === switchColumn && value === false;
  });
};

/*
 * Whether a project below the table's read plan may still read the records
 * it has: only on the tables of configuration that keeps working after a
 * downgrade (readableBelowPlan).
 */
export const canReadPlanGatedTableBelowPlan: (
  model: PlanGatedTableModel,
) => boolean = (model: PlanGatedTableModel): boolean => {
  return Boolean(model.readableBelowPlan);
};

/*
 * Whether a project below the table's delete plan may still delete the
 * records it has: yes, unless deleting one gives more than the plan allows
 * (deleteStaysGated).
 */
export const canDeletePlanGatedTableBelowPlan: (
  model: PlanGatedTableModel,
) => boolean = (model: PlanGatedTableModel): boolean => {
  return !model.deleteStaysGated;
};
