import Query from "./Query";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import Dictionary from "../../../Types/Dictionary";

/*
 * The shape of a read that answers a question ABOUT a set of rows without
 * shipping the rows.
 *
 * Every "how many devices are down", "how many interfaces are down across the
 * fleet", "which six vendors do we have most of" used to be answered by
 * fetching every matching row into a browser and reducing it there. At a
 * hundred rows that is invisible; at eighty thousand it is a multi-megabyte
 * payload, half a second of main-thread model hydration, and — worse — a
 * number that silently stops being true once the fleet outgrows the page
 * limit the fetch was capped at.
 *
 * `DatabaseService.aggregateBy` runs the same reduction in Postgres and
 * returns the handful of numbers instead, through the same permission
 * pipeline every other read goes through.
 */

/**
 * One column of an aggregate read: a SQL expression and the name it comes back
 * under.
 *
 * ## The expression is trusted; values are not
 *
 * `expression` is interpolated into SQL verbatim, so it MUST be a
 * compile-time constant owned by server code — never a string built from a
 * request body, a query parameter, or any other caller-supplied value. Every
 * dynamic value belongs in `AggregateBy.parameters` and is referenced from the
 * expression as a `:name` placeholder, which the driver binds:
 *
 *   { expression: `COUNT(*) FILTER (WHERE "NetworkDevice"."siteId" = :siteId)`,
 *     alias: "devicesAtSite" }
 *
 * `aggregateBy` rejects an expression containing a statement separator and an
 * alias that is not a plain identifier, so the contract is enforced rather
 * than merely documented.
 *
 * Column references need the model's alias, which is the model name —
 * `"NetworkDevice"."isReachable"` — because the permission pipeline joins
 * relations in beside it.
 */
export interface AggregateColumn {
  expression: string;
  alias: string;
}

export interface AggregateOrder {
  // A select alias, or a repeat of the expression. Same trust rules as above.
  expression: string;
  sortOrder: SortOrder;
}

/**
 * One row of an aggregate result, exactly as the driver returned it.
 *
 * Postgres hands back `COUNT`/`SUM` as strings (they are `bigint`/`numeric`,
 * which do not fit a JS number in the general case), so callers read these
 * through `AggregateResultUtil` rather than trusting the runtime type.
 */
export type AggregateRow = Dictionary<string | number | boolean | Date | null>;

export default interface AggregateBy<TBaseModel extends BaseModel> {
  query: Query<TBaseModel>;
  props: DatabaseCommonInteractionProps;
  // At least one. These are the aggregates — COUNT, SUM, MIN, MAX...
  select: Array<AggregateColumn>;
  /*
   * The columns rows are bucketed by. Each is both grouped on and selected, so
   * a caller never has to name it twice, and omitting this produces exactly one
   * row for the whole matched set.
   */
  groupBy?: Array<AggregateColumn> | undefined;
  orderBy?: Array<AggregateOrder> | undefined;
  // Rows of OUTPUT (i.e. groups), not rows of input.
  limit?: number | undefined;
  // Bound values for the `:name` placeholders used by the expressions above.
  parameters?: Dictionary<string | number | boolean | Date | null> | undefined;
}
