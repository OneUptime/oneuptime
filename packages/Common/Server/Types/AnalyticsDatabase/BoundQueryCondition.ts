import QueryOperator from "../../../Types/BaseDatabase/QueryOperator";
import { Statement } from "../../Utils/AnalyticsDatabase/Statement";

/*
 * A condition a service has already turned into SQL, for the statement
 * generator to place on the column - or the attribute - it filters.
 *
 * Some conditions need the database before they can be compiled: a
 * watchlist's values are in Postgres, and only the name travels in the
 * query (OnWatchlist). The service reads what the condition needs just
 * before the read, and puts one of these in the query in its place
 * (SecurityWatchlistQueryBinder); the generator, which stays synchronous
 * and knows nothing of watchlists, asks it for its SQL on whatever reads
 * the value, so the condition is the same in a list, a count, a chart and a
 * facet.
 *
 * Made on the server for one read and never sent anywhere: toJSON writes
 * back what the query said before it was bound.
 */
export default abstract class BoundQueryCondition extends QueryOperator<string> {
  /*
   * The condition, given SQL that reads the value: a column, an attribute
   * (`attributes['k']`), or - `isArray` - an Array(String) column, any of
   * whose elements may meet it. Every value it holds is bound as a
   * parameter.
   */
  public abstract toStatement(data: {
    expression: Statement;
    isArray: boolean;
  }): Statement;
}
