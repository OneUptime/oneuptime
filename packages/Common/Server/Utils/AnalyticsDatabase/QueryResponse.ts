/**
 * Reading the FORMAT JSON body of a read that carries
 * timeout_overflow_mode = 'break'.
 *
 * 'break' is meant to stop a query at max_execution_time and hand back the
 * rows it has so far. Over HTTP that is often not what arrives: ClickHouse
 * has already answered 200 and started streaming when the cap is reached,
 * and it ends the response without finishing the JSON document. There is no
 * exception header, system.query_log records the query as a success, and the
 * body is either empty (nothing had been produced yet, which is also what
 * happens when the cap is reached inside a scalar subquery) or cut off part
 * way through. Observed on ClickHouse 26.7, the version the Helm chart and
 * docker compose ship.
 *
 * ResultSet.json() is a plain JSON.parse of that body, so the stop surfaced
 * as a SyntaxError. That is not an Exception, so the API error handler could
 * only answer it with a bare "Server Error" — which is all a user whose log
 * search ran into the cap ever saw.
 */

import ServerException from "../../../Types/Exception/ServerException";
import { ResponseJSON, ResultSet } from "@clickhouse/client";

export interface ReadJSONResponseOptions {
  resultSet: ResultSet<"JSON">;
  // Names the work in the message, e.g. "The log search".
  subject: string;
}

export function getQueryStoppedMessage(subject: string): string {
  return `${subject} took too long and was stopped before it finished. Try a shorter time range or more specific filters.`;
}

/**
 * ResultSet.json(), except that a body which is not a complete JSON
 * document — a query stopped by 'break' — becomes an exception that says
 * so. Any other failure is rethrown untouched.
 *
 * Infrastructure, because the time budget ran out rather than the code or
 * the caller being wrong. And a 500 so that the message reaches the reader
 * and nothing re-runs the query on its own: the web app swaps the message of
 * a 502 or 504 for a generic connection error, Chromium resends a request
 * answered with 408 on a reused connection, and a 503 invites retries —
 * Istio's default route policy before 1.27 retries it twice. Repeating a
 * query that just spent its whole budget only adds load.
 */
export async function readJSONResponse<T>(
  options: ReadJSONResponseOptions,
): Promise<ResponseJSON<T>> {
  try {
    return await options.resultSet.json<T>();
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new ServerException(
        getQueryStoppedMessage(options.subject),
      ).asInfrastructure();
    }

    throw error;
  }
}
