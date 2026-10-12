import { Statement } from "../../../Server/Utils/AnalyticsDatabase/Statement";

/*
 * The outer ORDER BY of an analytics find statement, read the way the
 * statement generator writes it: `{p3:Identifier} DESC, {p4:Identifier}
 * DESC` after the LAST "ORDER BY " and before " LIMIT". The sort-key
 * boundary filter (toSortKeyBoundaryFilter) puts an ORDER BY of its own in a
 * subquery inside the WHERE, so a statement can carry two; the last one is
 * the sort that orders the page. AnalyticsDatabaseSortKeyBoundary and
 * AnalyticsDatabasePaginationStability read it with these.
 */

const ORDER_BY: string = "ORDER BY ";
const LIMIT: string = " LIMIT";
const TERM_SEPARATOR: string = ", ";

// A rendered ORDER BY term: a bound column name, then its direction.
const ORDER_BY_TERM: RegExp = /^\{(p\d+):Identifier\} (?:ASC|DESC)$/;

export type OuterOrderByFunction = (query: string) => string;

// The terms of a query's last ORDER BY, as written; none without one.
export const outerOrderBy: OuterOrderByFunction = (query: string): string => {
  const at: number = query.lastIndexOf(ORDER_BY);

  if (at === -1) {
    return "";
  }

  return query.slice(at + ORDER_BY.length).split(LIMIT)[0]!;
};

export type OrderByColumnsFunction = (statement: Statement) => Array<string>;

/*
 * The column names the outer ORDER BY sorts by, each term's bound parameter
 * resolved, so assertions do not depend on parameter numbering. A term of
 * any other shape - another direction, a name written in place, a
 * parameter that is no identifier - is returned as written, so an
 * assertion on the names shows it.
 */
export const orderByColumns: OrderByColumnsFunction = (
  statement: Statement,
): Array<string> => {
  return outerOrderBy(statement.query)
    .split(TERM_SEPARATOR)
    .map((term: string): string => {
      const parameter: string | undefined = ORDER_BY_TERM.exec(term)?.[1];

      return parameter === undefined
        ? term
        : (statement.query_params[parameter] as string);
    });
};
