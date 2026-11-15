import { PromQLPosition } from "./PromQLAst";

/*
 * What went wrong with a PromQL query, sorted the way the Prometheus HTTP API
 * sorts it, so the API can answer with Prometheus' own `errorType` and status
 * code and every client (Grafana, the Metrics page) can tell a mistake in the
 * query from a query that ran out of room.
 */
export enum PromQLErrorType {
  // The query or a parameter is wrong: HTTP 400.
  BadData = "bad_data",
  // The query is right, but could not be evaluated: HTTP 422.
  Execution = "execution",
  // The query took longer than it may: HTTP 503.
  Timeout = "timeout",
}

export default class PromQLError extends Error {
  public readonly errorType: PromQLErrorType;
  public readonly position: PromQLPosition | undefined;

  public constructor(
    message: string,
    errorType: PromQLErrorType = PromQLErrorType.BadData,
    position?: PromQLPosition | undefined,
  ) {
    super(message);
    this.name = "PromQLError";
    this.errorType = errorType;
    this.position = position;
  }
}
