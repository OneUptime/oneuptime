import {
  CloudWatchLogSeverity,
  SEVERITY_HEAD_LENGTH,
  inferCloudWatchLogSeverity,
} from "../../../Types/Cloud/CloudWatchLogSeverity";
import { FastestRun, fastestRun } from "../../Helpers/FastestRun";
import { describe, expect, test } from "@jest/globals";

/*
 * The severity a streamed CloudWatch Logs line says, read off its start the
 * way the service that wrote it says it. A database's lines matter as much
 * as a function's: RDS for PostgreSQL and MySQL stream their logs through
 * the same subscription, and a line read as no severity at all is drawn
 * grey on the resource's Logs page, its errors among its checkpoints.
 */

function severityOf(message: string): string | undefined {
  return inferCloudWatchLogSeverity(message)?.text;
}

describe("Lambda's runtimes and the loggers", () => {
  test.each([
    ["2026-11-04T09:59:01.200Z\t0b1d2c3e-1111\tERROR\tPayment failed", "ERROR"],
    ["[WARNING]\t2026-11-04T09:59:01.200Z\treq\tdeprecated", "WARN"],
    ['{"level":"ERROR","message":"x"}', "ERROR"],
    ["ERROR: deadlock detected", "ERROR"],
    ["[info] ready", "INFO"],
  ])("%s is %s", (message: string, severity: string) => {
    expect(severityOf(message)).toBe(severity);
  });
});

describe("RDS for PostgreSQL and Aurora PostgreSQL", () => {
  const CLIENT: string =
    "2026-11-06 09:58:12 UTC:10.0.1.23(52344):orders_app@orders:[23817]";

  test.each([
    [`${CLIENT}:LOG:  connection authorized: user=orders_app`, "INFO", 9],
    [`${CLIENT}:ERROR:  deadlock detected`, "ERROR", 17],
    [`${CLIENT}:WARNING:  there is no transaction in progress`, "WARN", 13],
    [`${CLIENT}:FATAL:  terminating connection`, "FATAL", 21],
    [`${CLIENT}:PANIC:  could not write to file`, "FATAL", 21],
    [`${CLIENT}:NOTICE:  table "x" does not exist, skipping`, "INFO", 10],
    [`${CLIENT}:INFO:  vacuuming "public.orders"`, "INFO", 9],
    [`${CLIENT}:DEBUG2:  StartTransaction`, "DEBUG", 5],
    // A background process has no client, user or database.
    [
      "2026-11-06 09:58:12 UTC::@:[6045]:LOG:  checkpoint starting: time",
      "INFO",
      9,
    ],
    // Before the user is known, the user and database are "[unknown]".
    [
      "2026-11-06 09:58:12 UTC:10.0.1.88(52390):[unknown]@[unknown]:[24420]:LOG:  connection received: host=10.0.1.88 port=52390",
      "INFO",
      9,
    ],
  ])("%s is %s", (message: string, text: string, number: number) => {
    const severity: CloudWatchLogSeverity | null =
      inferCloudWatchLogSeverity(message);

    expect(severity).toEqual({ number, text });
  });

  test.each(["DETAIL", "HINT", "STATEMENT", "CONTEXT", "QUERY"])(
    "a %s line goes with the line before it and says none of its own",
    (level: string) => {
      expect(
        inferCloudWatchLogSeverity(
          `${CLIENT}:${level}:  Process 24102 waits for ShareLock on transaction 9123411`,
        ),
      ).toBeNull();
    },
  );

  test("a line that does not start with its time is not read as PostgreSQL's", () => {
    expect(
      inferCloudWatchLogSeverity("[main]:ERROR: payment failed"),
    ).toBeNull();
    expect(
      inferCloudWatchLogSeverity("worker [3]:LOG: started a new batch"),
    ).toBeNull();
  });
});

describe("MySQL and MariaDB on RDS", () => {
  test.each([
    [
      "2026-11-06T09:58:12.123456Z 15 [Note] [MY-010914] [Server] Aborted connection 15 to db: 'orders'",
      "INFO",
    ],
    [
      "2026-11-06T09:58:12.123456Z 0 [Warning] [MY-010055] [Server] IP address '10.0.1.88' could not be resolved",
      "WARN",
    ],
    [
      "2026-11-06T09:58:12.123456Z 0 [ERROR] [MY-012592] [InnoDB] Operating system error number 28",
      "ERROR",
    ],
    [
      "2026-11-06T09:58:12.123456Z 0 [System] [MY-010116] [Server] mysqld starting as process 1",
      "INFO",
    ],
    // MariaDB pads a one-digit hour.
    [
      "2026-11-06  9:58:12 15 [Note] Aborted connection 15 to db: 'orders'",
      "INFO",
    ],
  ])("%s is %s", (message: string, severity: string) => {
    expect(severityOf(message)).toBe(severity);
  });

  test("a bracket after a time that is no level says none", () => {
    expect(
      inferCloudWatchLogSeverity("2026-11-06 09:58:12 [main] export started"),
    ).toBeNull();
    expect(
      inferCloudWatchLogSeverity(
        "2026-11-06 09:58:12 [a-thread-name-this-long] x",
      ),
    ).toBeNull();
  });
});

describe("a line with no level", () => {
  test.each([
    "START RequestId: 0b1d2c3e Version: $LATEST",
    "REPORT RequestId: 0b1d2c3e\tDuration: 12.3 ms",
    "2026-11-06 09:58:12 UTC:10.0.1.23(52344):orders_app@orders:[23817]:",
    "2026-11-06 09:58:12 UTC",
    "",
  ])("%s says none", (message: string) => {
    expect(inferCloudWatchLogSeverity(message)).toBeNull();
  });
});

describe("only the start of a line is read", () => {
  test("a level past the head is not read", () => {
    const padding: string = "x".repeat(SEVERITY_HEAD_LENGTH);

    expect(
      inferCloudWatchLogSeverity(
        `2026-11-06 09:58:12 UTC:${padding}:[23817]:ERROR:  late`,
      ),
    ).toBeNull();
  });

  test("400,000 characters of the database rules' worst case, in one pass", () => {
    const run: FastestRun<string | undefined> = fastestRun({
      run: (): string | undefined => {
        return severityOf(`1${"]:".repeat(200_000)}`);
      },
      limitInMs: 2000,
    });

    expect(run.inMs).toBeLessThan(2000);

    const brackets: FastestRun<string | undefined> = fastestRun({
      run: (): string | undefined => {
        return severityOf(`1${" [".repeat(200_000)}`);
      },
      limitInMs: 2000,
    });

    expect(brackets.inMs).toBeLessThan(2000);
  });
});
