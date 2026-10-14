import ExceptionCode from "./ExceptionCode";
import TimeoutException from "./TimeoutException";

/*
 * A read the database stopped at its time limit: ClickHouse's
 * max_execution_time ran out before the query finished (issue #4707). Not a
 * bug and not a malformed request — the question was bigger than a read may
 * take to answer — so it stays a TimeoutException, classed Infrastructure,
 * and its message says what to change: a shorter time range or more specific
 * filters.
 *
 * Answered with 504 Gateway Timeout, never 408. The API is the gateway to the
 * database here, and the database did not answer in time. 408 would also say
 * "took too long", but Chromium resends a request that is answered 408 on a
 * reused HTTP/1.1 connection (net/http/http_network_transaction.cc), and keeps
 * doing so while its pool hands it reused sockets: a 45-second search that ran
 * out of time would silently run again, and again, before the reader saw a
 * thing. No browser resends a 504. The Dashboard reads 504 (and 408, from
 * older servers) as "this took too long" — see TelemetryLoadError.
 */
export default class QueryTimeoutException extends TimeoutException {
  public constructor(message: string) {
    super(message);
    this.code = ExceptionCode.QueryTimeoutException;
  }
}
