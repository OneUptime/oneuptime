import {
  AUDIT_LOG_RESOURCE_NAME_LIMIT,
  firstLineOf,
  getAuditLogResourceName,
} from "../../../../Server/Utils/AuditLog/AuditLogResourceNames";
import { FastestRun, fastestRun } from "../../../Helpers/FastestRun";
import { generatedTexts } from "../../../Helpers/GeneratedTexts";
import { describe, expect, test } from "@jest/globals";

/*
 * WHAT NAMES AN ENTRY OF A ROW WITH NO NAME OF ITS OWN (issue #6287).
 *
 * Every exception's entry in the project-wide audit log read "Unnamed". An
 * exception is now named by its type and the start of its message, made
 * safe as everywhere a message leaves the platform; other unnamed rows by
 * the columns that name them. Nothing that looks like a secret becomes a
 * name, and a megabyte of telemetry is read for a name in linear time.
 */

function exception(type: unknown, message: unknown): string | null {
  return getAuditLogResourceName({
    tableName: "TelemetryException",
    columns: ["exceptionType", "message"],
    values: { exceptionType: type, message },
  });
}

describe("an exception's name", () => {
  test("is its type and the start of its message", () => {
    expect(
      exception(
        "TypeError",
        "Cannot read properties of undefined (reading 'map')",
      ),
    ).toBe("TypeError: Cannot read properties of undefined (reading 'map')");
  });

  test("says the type once when the message starts with it", () => {
    expect(exception("ValueError", "ValueError: invalid literal")).toBe(
      "ValueError: invalid literal",
    );
  });

  test("is the type alone, or the message alone, when only one is there", () => {
    expect(exception("TimeoutError", "")).toBe("TimeoutError");
    expect(exception(undefined, "connect ECONNREFUSED")).toBe(
      "connect ECONNREFUSED",
    );
    expect(exception(null, null)).toBeNull();
    expect(exception("   ", "\n\n")).toBeNull();
  });

  test("reads only the message's first line, and cuts it", () => {
    const name: string = exception(
      "Error",
      `${"x".repeat(500)}\n    at handler (/srv/app.js:1:1)`,
    )!;

    expect(name).not.toContain("at handler");
    expect(Array.from(name).length).toBeLessThanOrEqual(
      AUDIT_LOG_RESOURCE_NAME_LIMIT,
    );
  });

  test("masks the ids, addresses and secrets a message can carry", () => {
    /*
     * The id comes first: the secret redactor alone keeps ids, so only the
     * exception sanitizer masks it.
     */
    const name: string = exception(
      "AuthError",
      "order 550e8400-e29b-41d4-a716-446655440000 by ada@example.com from 203.0.113.7 sent Bearer abcdefghijklmnop1234567890",
    )!;

    expect(name).not.toContain("550e8400-e29b-41d4-a716-446655440000");
    expect(name).not.toContain("ada@example.com");
    expect(name).not.toContain("203.0.113.7");
    expect(name).not.toContain("abcdefghijklmnop1234567890");
    expect(name.startsWith("AuthError: order ")).toBe(true);
  });

  test("a message of several megabytes on one line is named in linear time", () => {
    const message: string = `Error ${"q".repeat(4 * 1024 * 1024)} token=sk_live_abc`;

    const timed: FastestRun<string | null> = fastestRun({
      run: (): string | null => {
        return exception("Error", message);
      },
      limitInMs: 2000,
    });

    expect(timed.inMs).toBeLessThan(2000);
    expect(Array.from(timed.result!).length).toBeLessThanOrEqual(
      AUDIT_LOG_RESOURCE_NAME_LIMIT,
    );
  });
});

describe("another unnamed row's name", () => {
  test("joins the texts of its name columns, first lines only", () => {
    expect(
      getAuditLogResourceName({
        tableName: "DataPipeline",
        columns: ["jobNamespace", "jobName"],
        values: { jobNamespace: "airflow", jobName: "daily_etl\nsecond line" },
      }),
    ).toBe("airflow: daily_etl");
  });

  test("leaves out an empty column, and is nothing when all are", () => {
    expect(
      getAuditLogResourceName({
        tableName: "RunbookExecution",
        columns: ["runbookNameSnapshot"],
        values: { runbookNameSnapshot: "Restart the API" },
      }),
    ).toBe("Restart the API");
    expect(
      getAuditLogResourceName({
        tableName: "RunbookExecution",
        columns: ["runbookNameSnapshot"],
        values: {},
      }),
    ).toBeNull();
  });

  test("never carries what looks like a secret", () => {
    expect(
      getAuditLogResourceName({
        tableName: "IncidentNoteTemplate",
        columns: ["templateName"],
        values: { templateName: "Rotate key password=hunter2-secret-value" },
      }),
    ).not.toContain("hunter2-secret-value");
  });
});

describe("a value's first line", () => {
  test("for any text of line breaks and words", () => {
    for (const text of generatedTexts(2000, 6287, [
      "a",
      " ",
      "\n",
      "\r",
      "é",
    ])) {
      const line: string = firstLineOf(text);

      expect(line.includes("\n") || line.includes("\r")).toBe(false);
      expect(text.trimStart().startsWith(line) || line === "").toBe(true);
    }
  });

  test("of what is not text", () => {
    expect(firstLineOf(undefined)).toBe("");
    expect(firstLineOf(null)).toBe("");
    expect(firstLineOf(42)).toBe("42");
  });
});
