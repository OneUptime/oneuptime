/*
 * The statement terminators at the end of a SQL query - every ";" of the
 * last run of them, and the white space after it - taken off, as
 * query.replace(/;+\s*$/g, "") took them off: the data sources do it before
 * a query is embedded in DECLARE ... CURSOR, the SQL monitor before it checks
 * a query and before it runs one.
 *
 * A query is a project's own text, read by the server and by every probe -
 * shared ones too - so it is read in time in line with its length. That
 * pattern was tried again from every ";" of a run of them that is not at the
 * end (inside a string literal, say), each try reading on to the end of the
 * run; here the run is tried once, from the character before it, which is
 * put back.
 */
const TRAILING_STATEMENT_TERMINATORS: RegExp = /(^|[^;]);+\s*$/;

export type WithoutTrailingStatementTerminatorsFunction = (
  query: string,
) => string;

export const withoutTrailingStatementTerminators: WithoutTrailingStatementTerminatorsFunction =
  (query: string): string => {
    return query.replace(TRAILING_STATEMENT_TERMINATORS, "$1");
  };
