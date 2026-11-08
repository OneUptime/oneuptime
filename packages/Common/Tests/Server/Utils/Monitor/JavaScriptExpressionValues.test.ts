import JavaScriptExpressionValues from "../../../../Server/Utils/Monitor/JavaScriptExpressionValues";
import DataToProcess from "../../../../Server/Utils/Monitor/DataToProcess";
import { JSONObject } from "../../../../Types/JSON";
import {
  MonitorEvaluationDetailsLimits,
  MonitorEvaluationFieldValue,
} from "../../../../Types/Monitor/MonitorEvaluationDetails";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import ObjectID from "../../../../Types/ObjectID";
import { describe, expect, test } from "@jest/globals";

/*
 * What a monitor's JavaScript expression reads, and what the incident says
 * it read. An expression names response fields with placeholders -
 * {{responseBody.data.status}} == 'down' - and the evaluation details list
 * each with the value it had, redacted and bounded, from the very map the
 * expression was filled from.
 */

const REDACTED: string = "[REDACTED]";

function apiCheck(body: JSONObject | string): DataToProcess {
  return {
    projectId: ObjectID.generate(),
    monitorId: ObjectID.generate(),
    monitorStepId: ObjectID.generate(),
    probeId: ObjectID.generate(),
    isOnline: true,
    responseCode: 503,
    responseTimeInMs: 812,
    responseBody: typeof body === "string" ? body : JSON.stringify(body),
    responseHeaders: {
      "content-type": "application/json",
      "set-cookie": "session=abc; HttpOnly",
      "x-region": "eu-west-1",
    },
    failureCause: "",
    monitoredAt: new Date("2026-11-08T10:00:00.000Z"),
  } as unknown as DataToProcess;
}

function apiStorageMap(body: JSONObject | string): JSONObject {
  return JavaScriptExpressionValues.getStorageMap({
    monitorType: MonitorType.API,
    dataToProcess: apiCheck(body),
    isQuiet: true,
  });
}

describe("the names an expression reads", () => {
  test("each once, in the order they are written", () => {
    expect(
      JavaScriptExpressionValues.getReferences(
        "{{responseBody.status}} == 'down' && {{responseStatusCode}} >= 500 || {{responseBody.status}} == 'degraded'",
      ),
    ).toEqual(["responseBody.status", "responseStatusCode"]);
  });

  test("a loop's own tags name nothing", () => {
    expect(
      JavaScriptExpressionValues.getReferences(
        "{{#each responseBody.items}}{{@index}}{{/each}} {{responseTimeInMs}} > 100",
      ),
    ).toEqual(["responseTimeInMs"]);
  });

  test("an expression with no placeholder reads nothing", () => {
    expect(JavaScriptExpressionValues.getReferences("1 === 1")).toEqual([]);
    expect(JavaScriptExpressionValues.getReferences("")).toEqual([]);
  });
});

describe("what each reference held", () => {
  test("a response field, a header and a status, as JSON", () => {
    const { values, isTruncated } = JavaScriptExpressionValues.readReferences({
      expression:
        "'{{responseBody.data.status}}' === 'down' && {{responseStatusCode}} > 499 && '{{responseHeaders.x-region}}' !== ''",
      storageMap: apiStorageMap({ data: { status: "down" } }),
    });

    expect(isTruncated).toBe(false);
    expect(values).toEqual([
      { path: "responseBody.data.status", value: '"down"' },
      { path: "responseStatusCode", value: "503" },
      { path: "responseHeaders.x-region", value: '"eu-west-1"' },
    ]);
  });

  test("a path that found nothing says so", () => {
    const { values } = JavaScriptExpressionValues.readReferences({
      expression: "{{responseBody.data.missing}} == null",
      storageMap: apiStorageMap({ data: {} }),
    });

    expect(values).toEqual([
      { path: "responseBody.data.missing", isMissing: true },
    ]);
  });

  test("a path through a secret's name is masked whole", () => {
    const { values } = JavaScriptExpressionValues.readReferences({
      expression:
        "'{{responseBody.auth.token}}' !== '' && '{{responseHeaders.set-cookie}}' !== ''",
      storageMap: apiStorageMap({ auth: { token: "tok_live_123" } }),
    });

    expect(values).toEqual([
      { path: "responseBody.auth.token", value: REDACTED, isRedacted: true },
      { path: "responseHeaders.set-cookie", value: REDACTED, isRedacted: true },
    ]);
  });

  test("an object's secret fields and personal data are masked inside it", () => {
    const { values } = JavaScriptExpressionValues.readReferences({
      expression: "{{responseBody.user}}.active === false",
      storageMap: apiStorageMap({
        user: {
          name: "Jane",
          email: "jane@example.com",
          apiKey: "k-1",
          active: false,
          note: "call ops@example.com",
        },
      }),
    });

    expect(JSON.parse(values[0]!.value!)).toEqual({
      name: "Jane",
      email: REDACTED,
      apiKey: REDACTED,
      active: false,
      note: `call ${REDACTED}`,
    });
  });

  test("a long value is cut to the limit, and says so", () => {
    const { values } = JavaScriptExpressionValues.readReferences({
      expression: "'{{responseBody.note}}'.length > 0",
      storageMap: apiStorageMap({ note: "n".repeat(2000) }),
    });

    expect(values[0]!.isTruncated).toBe(true);
    expect(values[0]!.value!.length).toBe(
      MonitorEvaluationDetailsLimits.valueChars,
    );
  });

  test("past the limit of references, the rest are left out and it says so", () => {
    const expression: string = Array.from(
      { length: 14 },
      (_value: unknown, index: number): string => {
        return `{{responseBody.f${index}}}`;
      },
    ).join(" + ");

    const { values, isTruncated } = JavaScriptExpressionValues.readReferences({
      expression: expression,
      storageMap: apiStorageMap({}),
    });

    expect(values).toHaveLength(
      MonitorEvaluationDetailsLimits.fieldValuesPerFilter,
    );
    expect(isTruncated).toBe(true);
  });
});

describe("the sentence a met expression puts into the root cause", () => {
  test("is the expression as written, never with the response written into it", () => {
    const sentence: string = JavaScriptExpressionValues.describeMetExpression({
      expression: "'{{responseBody.status}}' === 'down'",
      storageMap: apiStorageMap({ status: "down", secret: "s3cr3t" }),
    });

    expect(sentence).toBe(
      "JavaScript Expression - '{{responseBody.status}}' === 'down' - evaluated to true. Values: responseBody.status = \"down\".",
    );
  });

  test("a whole body named in the expression does not reach the sentence", () => {
    const body: JSONObject = {
      items: Array.from({ length: 500 }, (_value: unknown, index: number) => {
        return { id: index, owner: `user${index}@example.com` };
      }),
    };

    const sentence: string = JavaScriptExpressionValues.describeMetExpression({
      expression: "{{responseBody}}.items.length > 0",
      storageMap: apiStorageMap(body),
    });

    expect(sentence.length).toBeLessThan(400);
    expect(sentence).not.toContain("@example.com");
    expect(sentence).toContain("{{responseBody}}.items.length > 0");
    expect(sentence).toContain("…");
  });

  test("names a missing field", () => {
    expect(
      JavaScriptExpressionValues.describeMetExpression({
        expression: "{{responseBody.gone}} === undefined",
        storageMap: apiStorageMap({}),
      }),
    ).toBe(
      "JavaScript Expression - {{responseBody.gone}} === undefined - evaluated to true. Values: responseBody.gone was not found.",
    );
  });

  test("an expression that names nothing is just the sentence", () => {
    expect(
      JavaScriptExpressionValues.describeMetExpression({
        expression: "1 === 1",
        storageMap: {},
      }),
    ).toBe("JavaScript Expression - 1 === 1 - evaluated to true.");
  });
});

describe("what an expression can name, per monitor type", () => {
  test("API and Website: the parsed body, headers, status, time and reachability", () => {
    const map: JSONObject = apiStorageMap({ status: "ok" });

    expect(map["responseBody"]).toEqual({ status: "ok" });
    expect(map["responseStatusCode"]).toBe(503);
    expect(map["responseTimeInMs"]).toBe(812);
    expect(map["isOnline"]).toBe(true);
    expect((map["responseHeaders"] as JSONObject)["x-region"]).toBe(
      "eu-west-1",
    );
  });

  test("a body that is no JSON is kept as its text", () => {
    expect(apiStorageMap("<html>down</html>")["responseBody"]).toBe(
      "<html>down</html>",
    );
  });

  test("an empty body is an empty object", () => {
    expect(apiStorageMap("")["responseBody"]).toEqual({});
  });

  test("Incoming Request: the request's body and headers", () => {
    expect(
      JavaScriptExpressionValues.getStorageMap({
        monitorType: MonitorType.IncomingRequest,
        dataToProcess: {
          requestBody: { alert: "fired" },
          requestHeaders: { "x-source": "grafana" },
          incomingRequestReceivedAt: new Date(),
        } as unknown as DataToProcess,
      }),
    ).toEqual({
      requestBody: { alert: "fired" },
      requestHeaders: { "x-source": "grafana" },
    });
  });

  test("SQL Query: the query's results, never its connection", () => {
    expect(
      JavaScriptExpressionValues.getStorageMap({
        monitorType: MonitorType.SQLQuery,
        dataToProcess: {
          isOnline: true,
          sqlQueryMonitorResponse: {
            rowCount: 3,
            scalarValue: 7,
            firstRow: { id: 1 },
            responseTimeInMs: 12,
          },
        } as unknown as DataToProcess,
      }),
    ).toEqual({
      rowCount: 3,
      scalarValue: 7,
      firstRow: { id: 1 },
      executionTimeInMs: 12,
      queryError: undefined,
      isOnline: true,
    });
  });

  test("a type whose expressions name nothing has an empty map", () => {
    expect(
      JavaScriptExpressionValues.getStorageMap({
        monitorType: MonitorType.Ping,
        dataToProcess: { isOnline: true } as unknown as DataToProcess,
      }),
    ).toEqual({});
  });
});

describe("the value of each reference, for the evaluation details", () => {
  test("is what deepFind reads, like the expression itself", () => {
    const values: Array<MonitorEvaluationFieldValue> =
      JavaScriptExpressionValues.readReferences({
        expression:
          "{{responseBody.items[1].name}} && {{responseBody.items[last].name}}",
        storageMap: apiStorageMap({
          items: [{ name: "a" }, { name: "b" }, { name: "c" }],
        }),
      }).values;

    expect(values).toEqual([
      { path: "responseBody.items[1].name", value: '"b"' },
      { path: "responseBody.items[last].name", value: '"c"' },
    ]);
  });
});
