import {
  AdvancedConsoleLogger,
  LogMessage,
  LoggerOptions,
  QueryRunner,
} from "typeorm";
import EventLoopStalls from "../../Utils/EventLoopStalls";

/*
 * TYPEORM'S SLOW-QUERY LOG, SAYING WHAT WAS SLOW (issue #10108).
 *
 * TypeORM times a statement from when it is sent to when its answer has been
 * read, and logs one over maxQueryExecutionTime as "query is slow". The
 * answer is read only when this process's event loop gets to it, so while a
 * piece of work held the loop - a grouped monitor's evaluation, for 20 to 30
 * seconds - every statement in flight was "slow": a one-row SELECT or DELETE
 * by id at 2.5 to 2.8 seconds, sent to look into Postgres when Postgres had
 * answered at once.
 *
 * The time the answer can have waited for the loop is known
 * (EventLoopStalls: how long the loop had been blocked right before the
 * answer was read), so the time Postgres took is at least the rest:
 *
 *   - when that rest is over the threshold, Postgres was slow: the line is
 *     TypeORM's "query is slow" as before, saying how much of the time, if
 *     any, the loop was blocked;
 *   - when it is not, the statement may only have waited for the loop: the
 *     line says so instead ("query waited for the event loop"), with both
 *     times, so nobody looks for it in Postgres.
 *
 * Everything else is TypeORM's AdvancedConsoleLogger, as before.
 */
export default class PostgresQueryLogger extends AdvancedConsoleLogger {
  private readonly slowQueryThresholdMs: number;

  public constructor(data: {
    options?: LoggerOptions | undefined;
    // TypeORM's maxQueryExecutionTime: what counts as slow.
    slowQueryThresholdMs: number;
  }) {
    super(data.options);
    this.slowQueryThresholdMs = data.slowQueryThresholdMs;
  }

  /*
   * Called before every statement, logged or not: the event loop is watched
   * from the first one on, so its stalls are known when one is slow.
   */
  public override logQuery(
    query: string,
    parameters?: Array<unknown>,
    queryRunner?: QueryRunner,
  ): void {
    EventLoopStalls.start();
    super.logQuery(query, parameters, queryRunner);
  }

  public override logQuerySlow(
    time: number,
    query: string,
    parameters?: Array<unknown>,
    queryRunner?: QueryRunner,
  ): void {
    const blockedMs: number = Math.min(
      time,
      Math.max(0, Math.round(EventLoopStalls.getBlockedStretchBefore())),
    );
    const databaseAtLeastMs: number = time - blockedMs;

    if (databaseAtLeastMs > this.slowQueryThresholdMs) {
      if (blockedMs === 0) {
        super.logQuerySlow(time, query, parameters, queryRunner);
        return;
      }

      this.writeLog(
        "warn",
        [
          PostgresQueryLogger.statementLine({
            prefix: "query is slow",
            query,
            parameters,
            time,
          }),
          {
            type: "query-slow",
            prefix: "execution time",
            message: `${time} ms, of which this process's event loop was blocked for up to ${blockedMs} ms: Postgres took at least ${databaseAtLeastMs} ms`,
          },
        ],
        queryRunner,
      );
      return;
    }

    this.writeLog(
      "warn",
      [
        PostgresQueryLogger.statementLine({
          prefix: "query waited for the event loop",
          query,
          parameters,
          time,
        }),
        {
          type: "query-slow",
          prefix: "execution time",
          message: `${time} ms, of which this process's event loop was blocked for up to ${blockedMs} ms and could not read the answer: Postgres took at least ${databaseAtLeastMs} ms, which is not slow`,
        },
      ],
      queryRunner,
    );
  }

  // The statement's line, as TypeORM writes a slow statement's.
  private static statementLine(data: {
    prefix: string;
    query: string;
    parameters?: Array<unknown> | undefined;
    time: number;
  }): LogMessage {
    return {
      type: "query-slow",
      prefix: data.prefix,
      message: data.query,
      format: "sql",
      ...(data.parameters ? { parameters: data.parameters } : {}),
      additionalInfo: { time: data.time },
    };
  }
}
