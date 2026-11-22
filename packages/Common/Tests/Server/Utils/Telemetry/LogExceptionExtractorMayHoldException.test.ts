import LogExceptionExtractor from "../../../../Server/Utils/Telemetry/LogExceptionExtractor";
import { JSONObject } from "../../../../Types/JSON";
import { describe, expect, test } from "@jest/globals";

/*
 * #10434: the logs ingest groups an exception by what it said as it arrived,
 * before the scrub rules, so it keeps a copy of a record before the rules
 * change its attributes in place - but only of a record that could hold an
 * exception, which it asks mayHoldException without reading the body. A
 * record it wrongly says no to would be grouped by what the rules left, the
 * bug this fixes: so whatever extractFromLogRecord finds an exception in,
 * mayHoldException says yes to, over every combination below.
 */

// OTel severity numbers.
const UNSPECIFIED: number = 0;
const INFO: number = 9;
const WARN: number = 13;
const ERROR: number = 17;
const FATAL: number = 21;
const FATAL4: number = 24;

const JS_TRACE: string = [
  "TypeError: Cannot read properties of undefined (reading 'id')",
  "    at checkout (/app/src/cart.ts:10:15)",
  "    at Layer.handle (/app/node_modules/express/lib/router/layer.js:95:5)",
].join("\n");

const PYTHON_TRACE: string = [
  "Traceback (most recent call last):",
  '  File "/app/orders/views.py", line 40, in create_order',
  "ValueError: Order 1001 failed",
].join("\n");

const JAVA_TRACE: string = [
  'Exception in thread "main" java.lang.IllegalStateException: boom',
  "\tat com.example.Cart.checkout(Cart.java:42)",
].join("\n");

const BODIES: Array<string> = [
  "",
  "user signed in",
  "TypeError: no frames here, only words",
  JS_TRACE,
  PYTHON_TRACE,
  JAVA_TRACE,
];

const SEVERITIES: Array<number> = [
  UNSPECIFIED,
  INFO,
  WARN,
  16,
  ERROR,
  20,
  FATAL,
  FATAL4,
  25,
  Number.NaN,
];

const ATTRIBUTE_SETS: Array<JSONObject> = [
  {},
  { "http.route": "/checkout", "user.id": "u-1" },
  { "exception.type": "TypeError" },
  { "exception.message": "Card ada@example.com declined" },
  { "exception.stacktrace": JS_TRACE },
  { "exception.message": "" },
  { "exception.type": 42 },
  { "exception.stacktrace": ["at a", "at b"] },
  { "exception.escaped": true },
  { "event.name": "app.crash" },
  { "event.name": "device.crash" },
  { "event.name": "device.anr" },
  { "event.name": "metrickit.diagnostic.crash" },
  { "event.name": "metrickit.diagnostic.hang" },
  { name: "metrickit.diagnostic.hang" },
  { "event.name": "browser.page_view" },
];

describe("whether a log record may hold an exception", () => {
  test("yes when it carries an exception attribute, whatever its value", () => {
    for (const attributes of [
      { "exception.type": "TypeError" },
      { "exception.message": "boom" },
      { "exception.stacktrace": JS_TRACE },
      { "exception.message": "" },
      { "exception.type": 42 },
      { "exception.stacktrace": ["at a"] },
    ] as Array<JSONObject>) {
      expect({
        attributes,
        may: LogExceptionExtractor.mayHoldException({
          attributes,
          severityNumber: INFO,
        }),
      }).toEqual({ attributes, may: true });
    }
  });

  test("yes at Error and Fatal severity, where its body is read for a stack trace", () => {
    for (const severityNumber of [ERROR, 18, 20, FATAL, FATAL4]) {
      expect(
        LogExceptionExtractor.mayHoldException({
          attributes: {},
          severityNumber,
        }),
      ).toBe(true);
    }
  });

  test("yes for a mobile app's crash, ANR or hang, at any severity", () => {
    for (const attributes of [
      { "event.name": "app.crash" },
      { "event.name": "device.crash" },
      { "event.name": "device.anr" },
      { "event.name": "metrickit.diagnostic.crash" },
      { name: "metrickit.diagnostic.hang" },
    ] as Array<JSONObject>) {
      expect(
        LogExceptionExtractor.mayHoldException({
          attributes,
          severityNumber: UNSPECIFIED,
        }),
      ).toBe(true);
    }
  });

  test("no for the logs most are: below Error, with no exception attribute and no fault", () => {
    for (const severityNumber of [UNSPECIFIED, INFO, WARN, 16, 25]) {
      expect(
        LogExceptionExtractor.mayHoldException({
          attributes: { "http.route": "/checkout", "event.name": "x" },
          severityNumber,
        }),
      ).toBe(false);
    }

    // A severity that is no number is not Error or Fatal (GH#3978).
    expect(
      LogExceptionExtractor.mayHoldException({
        attributes: {},
        severityNumber: Number.NaN,
      }),
    ).toBe(false);
  });

  test("an attribute named like an exception's, but inherited, is not one", () => {
    const attributes: JSONObject = Object.create({
      "exception.message": "boom",
    }) as JSONObject;

    expect(
      LogExceptionExtractor.mayHoldException({
        attributes,
        severityNumber: INFO,
      }),
    ).toBe(false);
  });

  test("never throws: a record it cannot read may hold one", () => {
    const unreadable: JSONObject = new Proxy(
      {},
      {
        has: (): boolean => {
          throw new Error("unreadable");
        },
        get: (): never => {
          throw new Error("unreadable");
        },
        getOwnPropertyDescriptor: (): never => {
          throw new Error("unreadable");
        },
      },
    ) as JSONObject;

    expect(
      LogExceptionExtractor.mayHoldException({
        attributes: unreadable,
        severityNumber: INFO,
      }),
    ).toBe(true);
    expect(
      LogExceptionExtractor.mayHoldException({
        attributes: null as unknown as JSONObject,
        severityNumber: INFO,
      }),
    ).toBe(false);
  });

  test("says yes to every record the extractor finds an exception in", () => {
    let found: number = 0;
    let saidNo: number = 0;

    for (const body of BODIES) {
      for (const severityNumber of SEVERITIES) {
        for (const attributes of ATTRIBUTE_SETS) {
          for (const hasTraceAndSpan of [false, true]) {
            const extracted: unknown =
              LogExceptionExtractor.extractFromLogRecord({
                body,
                attributes,
                severityNumber,
                hasTraceAndSpan,
              });
            const may: boolean = LogExceptionExtractor.mayHoldException({
              attributes,
              severityNumber,
            });

            if (extracted) {
              found++;
              expect({ body, severityNumber, attributes, may }).toEqual({
                body,
                severityNumber,
                attributes,
                may: true,
              });
            }

            if (!may) {
              saidNo++;
            }
          }
        }
      }
    }

    // The grid holds both: records with an exception, and records it skips.
    expect(found).toBeGreaterThan(100);
    expect(saidNo).toBeGreaterThan(100);
  });
});
