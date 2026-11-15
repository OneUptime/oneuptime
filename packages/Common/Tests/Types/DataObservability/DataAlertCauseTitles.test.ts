import { describe, expect, test } from "@jest/globals";
import {
  DATA_ALERT_CAUSE_TITLES,
  DataAlertCauseTitle,
  DataAlertCauseTitleCode,
  getFailedRunCauseTitle,
  getFailedWritesCauseTitle,
  getRaisedErrorCauseTitle,
  getSchemaChangeCauseTitle,
  getUnreadableDatabaseCauseTitle,
  getUnwellServerCauseTitle,
  getUpstreamAlertCauseTitle,
  isDataAlertCauseTitleCode,
  titleAsWritten,
  wordDataAlertCauseTitle,
} from "../../../Types/DataObservability/DataAlertCauseTitles";
import { fillTemplate } from "../../../Types/Translator";

/*
 * A DATA ALERT'S LIKELY CAUSES, TITLED AS SENTENCES WITH THEIR NAMES (#8343).
 *
 * The server titles each likely cause in English; the Why This Happened
 * card drew that English on every page. A title the server words itself
 * now carries its sentence's code and the names and counts in it, for the
 * Dashboard to say in the reader's language. Its English `title` reads
 * exactly as the server wrote it before: these tests hold every builder to
 * the English the server's template literals wrote.
 */

const PLACEHOLDER: RegExp = /\{\{\s*([\w.]+)\s*\}\}/g;

function placeholdersOf(template: string): Array<string> {
  return Array.from(
    template.matchAll(PLACEHOLDER),
    (match: RegExpMatchArray) => {
      return match[1] as string;
    },
  ).sort();
}

// The English and the sentence a builder gave, with the code it named.
function expectWorded(
  title: DataAlertCauseTitle,
  code: DataAlertCauseTitleCode,
  english: string,
  values: Record<string, string | number> = {},
): void {
  expect(title).toEqual({
    title: english,
    titleWords: { code: code, values: values },
  });
  // The sentence filled with its values is the English, word for word.
  expect(fillTemplate(DATA_ALERT_CAUSE_TITLES[code], values)).toBe(english);
}

describe("the sentences", () => {
  test("every code has one, and nothing else does", () => {
    expect(Object.keys(DATA_ALERT_CAUSE_TITLES).sort()).toEqual(
      Object.values(DataAlertCauseTitleCode).sort(),
    );

    for (const code of Object.values(DataAlertCauseTitleCode)) {
      expect(DATA_ALERT_CAUSE_TITLES[code].trim().length).toBeGreaterThan(0);
    }
  });

  test("each is a different sentence", () => {
    const sentences: Array<string> = Object.values(DATA_ALERT_CAUSE_TITLES);

    expect(new Set(sentences).size).toBe(sentences.length);
  });

  test("a named sentence and its unnamed one differ only in the name", () => {
    const PAIRS: Array<[DataAlertCauseTitleCode, DataAlertCauseTitleCode]> = [
      [
        DataAlertCauseTitleCode.PipelineFailed,
        DataAlertCauseTitleCode.UnnamedPipelineFailed,
      ],
      [
        DataAlertCauseTitleCode.ServiceRaisesError,
        DataAlertCauseTitleCode.UnnamedServiceRaisesError,
      ],
      [
        DataAlertCauseTitleCode.ServiceRaisesAnError,
        DataAlertCauseTitleCode.UnnamedServiceRaisesAnError,
      ],
      [
        DataAlertCauseTitleCode.WritesFailed,
        DataAlertCauseTitleCode.UnnamedServiceWritesFailed,
      ],
      [
        DataAlertCauseTitleCode.DatabaseUnreadable,
        DataAlertCauseTitleCode.UnnamedDatabaseUnreadable,
      ],
      [
        DataAlertCauseTitleCode.ServerDegraded,
        DataAlertCauseTitleCode.UnnamedServerDegraded,
      ],
      [
        DataAlertCauseTitleCode.ServerUnhealthy,
        DataAlertCauseTitleCode.UnnamedServerUnhealthy,
      ],
    ];

    for (const [named, unnamed] of PAIRS) {
      const namedPlaceholders: Array<string> = placeholdersOf(
        DATA_ALERT_CAUSE_TITLES[named],
      );
      const unnamedPlaceholders: Array<string> = placeholdersOf(
        DATA_ALERT_CAUSE_TITLES[unnamed],
      );

      // The unnamed sentence has every value but the name.
      expect(namedPlaceholders.length).toBe(unnamedPlaceholders.length + 1);
      expect(
        unnamedPlaceholders.every((name: string): boolean => {
          return namedPlaceholders.includes(name);
        }),
      ).toBe(true);
    }
  });

  test("a code is known only when it is one of them", () => {
    for (const code of Object.values(DataAlertCauseTitleCode)) {
      expect(isDataAlertCauseTitleCode(code)).toBe(true);
    }

    for (const other of [
      "SomethingNew",
      "pipelineFailed",
      "",
      "constructor",
      "toString",
      "__proto__",
      null,
      undefined,
      42,
      {},
    ]) {
      expect({ other, known: isDataAlertCauseTitleCode(other) }).toEqual({
        other,
        known: false,
      });
    }
  });

  test("wordDataAlertCauseTitle copies its values, so the caller's object is not the cause's", () => {
    const values: Record<string, string> = { pipeline: "nightly_orders" };
    const worded: Required<DataAlertCauseTitle> = wordDataAlertCauseTitle(
      DataAlertCauseTitleCode.PipelineFailed,
      values,
    );

    values["pipeline"] = "changed";

    expect(worded.titleWords?.values).toEqual({ pipeline: "nightly_orders" });
    expect(worded.title).toBe("nightly_orders failed");
  });
});

describe("each cause, in the English the server always wrote", () => {
  test("an upstream alert: its number and title as written, no sentence", () => {
    expect(
      getUpstreamAlertCauseTitle({
        alertNumberWithPrefix: "#42",
        title: "orders is late",
      }),
    ).toEqual({ title: "#42 orders is late" });
    expect(getUpstreamAlertCauseTitle({ title: "orders is late" })).toEqual({
      title: "orders is late",
    });
    expect(getUpstreamAlertCauseTitle({})).toEqual({ title: "" });
  });

  test("a private upstream alert: the sentence, naming nothing of it", () => {
    expectWorded(
      getUpstreamAlertCauseTitle({
        isPrivate: true,
        alertNumberWithPrefix: "#42",
        title: "Payroll export is late",
      }),
      DataAlertCauseTitleCode.PrivateUpstreamAlert,
      "A private alert upstream",
    );
  });

  test("a failed run: its pipeline's name, or a pipeline", () => {
    expectWorded(
      getFailedRunCauseTitle("nightly_orders"),
      DataAlertCauseTitleCode.PipelineFailed,
      "nightly_orders failed",
      { pipeline: "nightly_orders" },
    );

    for (const none of [undefined, null, "", "   "]) {
      expectWorded(
        getFailedRunCauseTitle(none),
        DataAlertCauseTitleCode.UnnamedPipelineFailed,
        "A pipeline failed",
      );
    }
  });

  test("a raised error: its service and its type, each or a stand-in", () => {
    expectWorded(
      getRaisedErrorCauseTitle({
        serviceName: "orders-api",
        errorType: "PSQLException",
      }),
      DataAlertCauseTitleCode.ServiceRaisesError,
      "orders-api keeps raising PSQLException naming this table",
      { service: "orders-api", error: "PSQLException" },
    );
    expectWorded(
      getRaisedErrorCauseTitle({ serviceName: "orders-api", errorType: "" }),
      DataAlertCauseTitleCode.ServiceRaisesAnError,
      "orders-api keeps raising an error naming this table",
      { service: "orders-api" },
    );
    expectWorded(
      getRaisedErrorCauseTitle({ serviceName: "", errorType: "PSQLException" }),
      DataAlertCauseTitleCode.UnnamedServiceRaisesError,
      "A service keeps raising PSQLException naming this table",
      { error: "PSQLException" },
    );
    expectWorded(
      getRaisedErrorCauseTitle({}),
      DataAlertCauseTitleCode.UnnamedServiceRaisesAnError,
      "A service keeps raising an error naming this table",
    );
  });

  test("failed writes: the service, how many failed and of how many", () => {
    expectWorded(
      getFailedWritesCauseTitle({
        serviceName: "orders-api",
        failed: 3,
        total: 120,
      }),
      DataAlertCauseTitleCode.WritesFailed,
      "orders-api: 3 of 120 writes failed",
      { service: "orders-api", failed: 3, total: 120 },
    );
    // No count of calls: "of 0", as the server always wrote it.
    expectWorded(
      getFailedWritesCauseTitle({ serviceName: "orders-api", failed: 3 }),
      DataAlertCauseTitleCode.WritesFailed,
      "orders-api: 3 of 0 writes failed",
      { service: "orders-api", failed: 3, total: 0 },
    );
    expectWorded(
      getFailedWritesCauseTitle({ failed: 1, total: 1 }),
      DataAlertCauseTitleCode.UnnamedServiceWritesFailed,
      "A service: 1 of 1 writes failed",
      { failed: 1, total: 1 },
    );
  });

  test("the counts stay numbers, for the Dashboard to write in the reader's digits", () => {
    const title: DataAlertCauseTitle = getFailedWritesCauseTitle({
      serviceName: "orders-api",
      failed: 1500,
      total: 120000,
    });

    expect(typeof title.titleWords?.values["failed"]).toBe("number");
    expect(typeof title.titleWords?.values["total"]).toBe("number");
    // English as the server wrote it: no thousands separator.
    expect(title.title).toBe("orders-api: 1500 of 120000 writes failed");
  });

  test("a schema change: its feed's line as written, or that a column changed", () => {
    expect(getSchemaChangeCauseTitle("Column customer_id was removed")).toEqual(
      { title: "Column customer_id was removed" },
    );

    for (const none of [undefined, null, ""]) {
      expectWorded(
        getSchemaChangeCauseTitle(none),
        DataAlertCauseTitleCode.ColumnChanged,
        "A column changed",
      );
    }
  });

  test("an unreadable database: its name, or the database", () => {
    expectWorded(
      getUnreadableDatabaseCauseTitle("orders-db"),
      DataAlertCauseTitleCode.DatabaseUnreadable,
      "orders-db could not be read",
      { database: "orders-db" },
    );
    expectWorded(
      getUnreadableDatabaseCauseTitle(undefined),
      DataAlertCauseTitleCode.UnnamedDatabaseUnreadable,
      "The database could not be read",
    );
  });

  test("an unwell server: degraded or unhealthy, named or not", () => {
    expectWorded(
      getUnwellServerCauseTitle({ serverName: "pg-main", health: "degraded" }),
      DataAlertCauseTitleCode.ServerDegraded,
      "pg-main is degraded",
      { server: "pg-main" },
    );
    expectWorded(
      getUnwellServerCauseTitle({ health: "degraded" }),
      DataAlertCauseTitleCode.UnnamedServerDegraded,
      "The database server is degraded",
    );
    expectWorded(
      getUnwellServerCauseTitle({ serverName: "pg-main", health: "unhealthy" }),
      DataAlertCauseTitleCode.ServerUnhealthy,
      "pg-main is unhealthy",
      { server: "pg-main" },
    );
    expectWorded(
      getUnwellServerCauseTitle({ serverName: "", health: "unhealthy" }),
      DataAlertCauseTitleCode.UnnamedServerUnhealthy,
      "The database server is unhealthy",
    );
  });

  test("a health with no sentence is said in English as it always was, with no code", () => {
    expect(
      getUnwellServerCauseTitle({
        serverName: "pg-main",
        health: "overloaded",
      }),
    ).toEqual({ title: "pg-main is overloaded" });
    expect(getUnwellServerCauseTitle({ health: "overloaded" })).toEqual({
      title: "The database server is overloaded",
    });
  });

  test("a title as written carries no sentence", () => {
    expect(titleAsWritten("checkout-api: Deployed v2.4.1")).toEqual({
      title: "checkout-api: Deployed v2.4.1",
    });
  });
});
