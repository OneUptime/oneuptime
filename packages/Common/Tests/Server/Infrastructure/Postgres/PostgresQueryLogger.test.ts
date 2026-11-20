import PostgresQueryLogger from "../../../../Server/Infrastructure/Postgres/PostgresQueryLogger";
import dataSourceOptions from "../../../../Server/Infrastructure/Postgres/DataSourceOptions";
import { PostgresSlowQueryLogThresholdMs } from "../../../../Server/EnvironmentConfig";
import EventLoopStalls from "../../../../Server/Utils/EventLoopStalls";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * THE SLOW-QUERY LOG SAYS WHAT WAS SLOW (issue #10108).
 *
 * TypeORM times a statement from send to read, and logs one over
 * maxQueryExecutionTime as "query is slow". While a grouped monitor's
 * evaluation held the event loop, one-row SELECTs and DELETEs by id were
 * logged "slow" at 2.5 to 2.8 s: their answers waited in the socket for the
 * loop, not for Postgres. PostgresQueryLogger knows how long the loop had
 * been blocked before an answer was read (EventLoopStalls) and says which it
 * was.
 */

const SELECT_BY_ID: string =
  'SELECT "Monitor"."_id" FROM "Monitor" WHERE "Monitor"."_id" = $1';

let printed: Array<string>;

function printedText(): string {
  return printed.join("\n");
}

beforeEach(() => {
  printed = [];
  jest.spyOn(console, "log").mockImplementation((...args: Array<unknown>) => {
    printed.push(args.map(String).join(" "));
  });
});

afterEach(() => {
  EventLoopStalls.stop();
  jest.restoreAllMocks();
});

function logger(): PostgresQueryLogger {
  return new PostgresQueryLogger({ slowQueryThresholdMs: 1000 });
}

describe("PostgresQueryLogger", () => {
  test("is the logger every Postgres connection is made with, at the configured threshold", () => {
    expect(dataSourceOptions.logger).toBeInstanceOf(PostgresQueryLogger);
    expect(dataSourceOptions.maxQueryExecutionTime).toBe(
      PostgresSlowQueryLogThresholdMs,
    );
  });

  test("starts watching the event loop with the first statement", () => {
    expect(EventLoopStalls.isStarted()).toBe(false);

    logger().logQuery(SELECT_BY_ID, ["id"]);

    expect(EventLoopStalls.isStarted()).toBe(true);
    // Logging statements is still off, as it was.
    expect(printed).toEqual([]);
  });

  test("a statement Postgres was slow to answer, the loop free, is slow as before", () => {
    jest.spyOn(EventLoopStalls, "getBlockedStretchBefore").mockReturnValue(0);

    logger().logQuerySlow(2_650, SELECT_BY_ID, ["id"]);

    expect(printedText()).toContain("query is slow");
    expect(printedText()).toContain(SELECT_BY_ID);
    expect(printedText()).toContain("2650");
    expect(printedText()).not.toContain("event loop");
  });

  test("a one-row SELECT whose answer waited for a blocked loop is not called slow", () => {
    // As the issue measured: 2.6 s, nearly all of it the loop held.
    jest
      .spyOn(EventLoopStalls, "getBlockedStretchBefore")
      .mockReturnValue(2_610);

    logger().logQuerySlow(2_650, SELECT_BY_ID, ["id"]);

    const text: string = printedText();
    expect(text).not.toContain("query is slow");
    expect(text).toContain("query waited for the event loop");
    expect(text).toContain(SELECT_BY_ID);
    expect(text).toContain("2650 ms");
    expect(text).toContain("blocked for up to 2610 ms");
    expect(text).toContain("Postgres took at least 40 ms, which is not slow");
  });

  test("a statement slow in Postgres while the loop was blocked too is slow, and says how much was the loop", () => {
    jest
      .spyOn(EventLoopStalls, "getBlockedStretchBefore")
      .mockReturnValue(1_000);

    logger().logQuerySlow(3_500, SELECT_BY_ID, ["id"]);

    const text: string = printedText();
    expect(text).toContain("query is slow");
    expect(text).toContain("blocked for up to 1000 ms");
    expect(text).toContain("Postgres took at least 2500 ms");
  });

  test("a stretch longer than the statement itself counts the statement's time only", () => {
    jest
      .spyOn(EventLoopStalls, "getBlockedStretchBefore")
      .mockReturnValue(9_000);

    logger().logQuerySlow(2_500, SELECT_BY_ID, ["id"]);

    expect(printedText()).toContain("blocked for up to 2500 ms");
    expect(printedText()).toContain("Postgres took at least 0 ms");
  });

  test("timed as TypeORM times it, a statement that waited on a really blocked loop reads so", async () => {
    const queryLogger: PostgresQueryLogger = new PostgresQueryLogger({
      slowQueryThresholdMs: 100,
    });
    queryLogger.logQuery(SELECT_BY_ID, ["id"]);

    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 50);
    });

    // Postgres answers in 5 ms; the loop is held for 400 ms meanwhile.
    const startedAt: number = Date.now();
    const answer: Promise<void> = new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 5);
    });

    const blockedFrom: number = Date.now();
    while (Date.now() - blockedFrom < 400) {
      // The evaluation holding the loop.
    }

    await answer;
    const time: number = Date.now() - startedAt;

    queryLogger.logQuerySlow(time, SELECT_BY_ID, ["id"]);

    expect(time).toBeGreaterThan(100);
    expect(printedText()).toContain("query waited for the event loop");
    expect(printedText()).not.toContain("query is slow");
  });

  test("timed as TypeORM times it, a statement Postgres was slow to answer reads slow", async () => {
    const queryLogger: PostgresQueryLogger = new PostgresQueryLogger({
      slowQueryThresholdMs: 100,
    });
    queryLogger.logQuery(SELECT_BY_ID, ["id"]);

    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 50);
    });

    // Postgres takes 300 ms; the loop is free throughout.
    const startedAt: number = Date.now();
    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 300);
    });
    const time: number = Date.now() - startedAt;

    queryLogger.logQuerySlow(time, SELECT_BY_ID, ["id"]);

    expect(printedText()).toContain("query is slow");
    expect(printedText()).not.toContain("event loop");
  });
});
