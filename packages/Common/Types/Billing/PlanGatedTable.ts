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
 * trial ends, a downgrade - keeps what it set up, and much of it keeps
 * working: SSO providers sign people in, SCIM connections provision them,
 * rules post to channels, API keys authenticate, schedules page people. So
 * whatever its plan, a project can still, for the records it already has:
 *
 *   - read them;
 *   - switch one off: an update that writes its switch - the isEnabled
 *     column - false, and nothing else;
 *   - delete them.
 *
 * Creating a record, switching one back on and every other change still
 * need the plan, and are refused with the plan's name.
 *
 * Reading stays gated only where reading is what the plan sells: a table
 * whose records a feature produced as it ran - on-call logs, form
 * submissions - rather than configuration people made says so with
 * @TableBillingAccessControl({ readStaysGated: true }).
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

// What this rule needs to know of a model: its columns and its read flag.
export interface PlanGatedTableModel {
  readStaysGated?: boolean | undefined;
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
 * The comparison is exact - "false", 0 or null is not false - and one more
 * column, whatever it holds, makes it an ordinary update. Columns set to
 * undefined are not written and are ignored. Anything that is not a plain
 * object of columns is not a switch-off.
 */
export const isPlanGatedTableSwitchOff: (
  model: PlanGatedTableModel,
  data: unknown,
) => boolean = (model: PlanGatedTableModel, data: unknown): boolean => {
  const switchColumn: string | null = getPlanGatedTableSwitchColumn(model);

  if (!switchColumn || !data || typeof data !== "object") {
    return false;
  }

  if (Array.isArray(data)) {
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
 * it has: yes, unless reading them is what the plan sells (readStaysGated).
 */
export const canReadPlanGatedTableBelowPlan: (
  model: PlanGatedTableModel,
) => boolean = (model: PlanGatedTableModel): boolean => {
  return !model.readStaysGated;
};
