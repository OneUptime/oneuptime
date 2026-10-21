/*
 * What a column is being picked for, and whether it belongs in that list.
 *
 * The record editor and the query builder share one picker, but they are
 * asking different questions. A create wants the values a person would
 * actually decide - the incident's title, its severity - and never the ones
 * OneUptime stamps itself (its ID, when it was created, who created it). An
 * update wants what may change after the record exists, which drops the
 * create-only columns as well. A query is the opposite case: "created after
 * yesterday" and "created by this user" are good filters, so the system columns
 * stay, and only the ones that are empty on every record go.
 *
 * Kept free of React and of the API client so the server-side tests can run
 * the real model metadata through exactly this policy.
 */

import {
  isAlwaysEmptyColumnId,
  isSystemColumnId,
} from "../../../../Types/Workflow/SystemColumns";
import { ModelSchemaColumn } from "../ModelSchema";

export enum ColumnUse {
  /** The values a Create One writes. */
  Create = "Create",
  /** The values an Update One / Update Many writes. */
  Update = "Update",
  /** The conditions a query matches records on. */
  Filter = "Filter",
}

export type IsSystemColumnFunction = (column: ModelSchemaColumn) => boolean;

/**
 * Whether OneUptime fills this column in itself.
 *
 * The endpoint's own flag wins when it is there, because it also knows about
 * `computed` and forced-default columns no list could name. The shared list is
 * the backstop for a response from before the flag existed.
 */
export const isSystemColumn: IsSystemColumnFunction = (
  column: ModelSchemaColumn,
): boolean => {
  if (typeof column.isSystemColumn === "boolean") {
    return column.isSystemColumn;
  }

  return isSystemColumnId(column.id);
};

export type IsAlwaysEmptyColumnFunction = (
  column: ModelSchemaColumn,
) => boolean;

/** Empty on every record a workflow can find (records are hard-deleted). */
export const isAlwaysEmptyColumn: IsAlwaysEmptyColumnFunction = (
  column: ModelSchemaColumn,
): boolean => {
  return isAlwaysEmptyColumnId(column.id);
};

export type CanUseColumnForFunction = (
  column: ModelSchemaColumn,
  use: ColumnUse,
) => boolean;

/**
 * Whether the column belongs in the list for this use at all, before asking
 * whether a single row could hold its value (ColumnControl.isOfferableColumn
 * asks that).
 *
 * A missing canCreate / canUpdate reads as allowed: the write gate already
 * admitted the column for at least one of the two, and a response from before
 * those flags existed should keep offering what it always did.
 */
export const canUseColumnFor: CanUseColumnForFunction = (
  column: ModelSchemaColumn,
  use: ColumnUse,
): boolean => {
  if (use === ColumnUse.Filter) {
    return !isAlwaysEmptyColumn(column);
  }

  if (isSystemColumn(column)) {
    return false;
  }

  if (use === ColumnUse.Create) {
    return column.canCreate !== false;
  }

  return column.canUpdate !== false;
};

export type RequiredWritableColumnsFunction = (
  columns: Array<ModelSchemaColumn>,
) => Array<ModelSchemaColumn>;

/**
 * Columns a create must be given a value for.
 *
 * Mirrors the server's own rule in DatabaseService.checkRequiredFields -
 * required, minus anything carrying a default - and additionally drops the
 * project column, which the workflow runner stamps itself
 * (ModelArguments.applyTenantColumn) and which a builder must never type.
 * Relations are left out because a row holds one scalar.
 *
 * System columns go too. A slug is required and has no default, because
 * DatabaseService.generateSlug writes it from the name on every create - so
 * Create One Scheduled Maintenance (and On-Call Policy, Incoming Call Policy,
 * On-Call Schedule, whose slugs carry a create list) opened on a required
 * "Slug" row for a value nobody can supply.
 */
export const requiredWritableColumns: RequiredWritableColumnsFunction = (
  columns: Array<ModelSchemaColumn>,
): Array<ModelSchemaColumn> => {
  return columns.filter((column: ModelSchemaColumn) => {
    return (
      Boolean(column.required) &&
      !column.hasDefault &&
      !column.isTenantColumn &&
      !column.isRelation &&
      canUseColumnFor(column, ColumnUse.Create)
    );
  });
};
