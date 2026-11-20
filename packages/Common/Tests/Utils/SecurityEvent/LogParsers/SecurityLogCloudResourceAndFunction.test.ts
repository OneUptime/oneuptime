import { describe, expect, test } from "@jest/globals";
import { STORED_CLOUD_RESOURCE_ID_ATTRIBUTE } from "../../../../Types/Cloud/CloudLogGroups";
import { JSONObject } from "../../../../Types/JSON";
import { SERVERLESS_FUNCTION_NAME_FILTER } from "../../../../Types/Monitor/ServerlessAlertTemplates";
import {
  SECURITY_LOG_CLOUD_RESOURCE_ATTRIBUTE,
  SECURITY_LOG_FUNCTION_ATTRIBUTE,
  SECURITY_LOG_RESOURCE_ID_ATTRIBUTE,
  SECURITY_LOG_ROW_CLOUD_RESOURCE_KEY,
  SECURITY_LOG_ROW_FUNCTION_KEY,
} from "../../../../Types/SecurityCase/SecurityConnection";
import NormalizedSecurityEvent from "../../../../Types/SecurityEvent/NormalizedSecurityEvent";
import ServiceType from "../../../../Types/Telemetry/ServiceType";
import SecurityLogParser from "../../../../Utils/SecurityEvent/LogParsers/SecurityLogParser";
import {
  MAX_LOG_FUNCTION_NAME_LENGTH,
  readLogCloudResource,
  readLogFunction,
} from "../../../../Utils/SecurityEvent/LogParsers/SecurityLogLine";
import {
  TRACE_SCAN_ATTRIBUTES_READ,
  TraceScanSpan,
  buildTraceSecurityEvents,
} from "../../../../Utils/SecurityEvent/TelemetryScan/TraceSignals";
import { SSH_LINES, WEB_LINES, logLine } from "./LogParserFixtures";

/*
 * A CLOUD RESOURCE'S AND A SERVERLESS FUNCTION'S OWN SECURITY EVENTS
 * (#9779, #9780).
 *
 * Their logs are filed under a service - a cloud connection's, for what its
 * stream delivers; the function's namesake, for what a Lambda's
 * OpenTelemetry layer sends - so the log resource an event carries never
 * names them. Their Logs and Traces pages read their lines by the resource
 * attributes the lines carry instead: cloud.resource_id and faas.name. Every
 * event read from such a line, or from such a span, carries them too, which
 * puts it on their Security Events pages.
 */

const SERVICE_ID: string = "0192f1a0-0000-7000-8000-0000000000aa";
const FUNCTION_ARN: string =
  "arn:aws:lambda:us-east-1:111122223333:function:checkout";

// A function's line, as a cloud connection's stream delivers it from its log group.
function streamedLambdaLine(
  body: string,
  attributes: JSONObject = {},
): Array<NormalizedSecurityEvent> {
  return SecurityLogParser.parse({
    ...logLine(body, {
      "resource.service.name": "aws-111122223333",
      "resource.cloud.provider": "aws",
      "resource.cloud.account.id": "111122223333",
      "resource.cloud.region": "us-east-1",
      "resource.aws.log.group.name": "/aws/lambda/checkout",
      [STORED_CLOUD_RESOURCE_ID_ATTRIBUTE]: FUNCTION_ARN,
      "resource.cloud.platform": "aws_lambda",
      [SERVERLESS_FUNCTION_NAME_FILTER]: "checkout",
      ...attributes,
    }),
    resourceId: SERVICE_ID,
    resourceType: ServiceType.OpenTelemetry,
  });
}

describe("the rows' keys are the ones the pages filter on", () => {
  test("a resource's Logs page reads cloud.resource_id, a function's faas.name", () => {
    expect(SECURITY_LOG_ROW_CLOUD_RESOURCE_KEY).toBe(
      STORED_CLOUD_RESOURCE_ID_ATTRIBUTE,
    );
    expect(SECURITY_LOG_ROW_FUNCTION_KEY).toBe(SERVERLESS_FUNCTION_NAME_FILTER);
  });
});

describe("readLogCloudResource", () => {
  test("a line's cloud resource, exactly as it carried it", () => {
    expect(
      readLogCloudResource({
        [STORED_CLOUD_RESOURCE_ID_ATTRIBUTE]: FUNCTION_ARN,
      }),
    ).toEqual({ [SECURITY_LOG_CLOUD_RESOURCE_ATTRIBUTE]: FUNCTION_ARN });

    // A resource whose metrics do not name it in full keeps its stand-in, which its Logs page filters on too.
    expect(
      readLogCloudResource({
        [STORED_CLOUD_RESOURCE_ID_ATTRIBUTE]:
          "  AWS/AppRunner ServiceName=checkout ServiceID=abc  ",
      }),
    ).toEqual({
      [SECURITY_LOG_CLOUD_RESOURCE_ATTRIBUTE]:
        "AWS/AppRunner ServiceName=checkout ServiceID=abc",
    });
  });

  /*
   * #10034: Azure compares its resource IDs without case, and a collector
   * or a pipeline stamps one in any case it likes - so the event keeps it
   * by its key, in lower case, the one spelling the resource's page and
   * Connected Signals read it by. An ARN keeps its case (above).
   */
  test("an Azure ID is kept by its key, in lower case, whatever case the stream stamped it in", () => {
    const id: string =
      "/subscriptions/11111111-2222-3333-4444-555555555555/resourceGroups/rg-prod/providers/Microsoft.Web/sites/orders-func";

    for (const stamped of [id, id.toUpperCase(), `${id}/`]) {
      expect(
        readLogCloudResource({ [STORED_CLOUD_RESOURCE_ID_ATTRIBUTE]: stamped }),
      ).toEqual({ [SECURITY_LOG_CLOUD_RESOURCE_ATTRIBUTE]: id.toLowerCase() });
    }
  });

  test.each<[string, JSONObject]>([
    ["no attributes", {}],
    ["an empty one", { [STORED_CLOUD_RESOURCE_ID_ATTRIBUTE]: "  " }],
    ["one that is no text", { [STORED_CLOUD_RESOURCE_ID_ATTRIBUTE]: 42 }],
    // The record's own attribute, not the resource's: not what the Logs page reads.
    ["the log record's own", { "cloud.resource_id": FUNCTION_ARN }],
    // Cut to fit, it would name another resource.
    [
      "one longer than any cloud's ID",
      {
        [STORED_CLOUD_RESOURCE_ID_ATTRIBUTE]: `arn:aws:s3:::${"a".repeat(2100)}`,
      },
    ],
  ])("%s names no cloud resource", (_case: string, attributes: JSONObject) => {
    expect(readLogCloudResource(attributes)).toEqual({});
  });

  test("an inherited key is never read as the line's", () => {
    const attributes: JSONObject = Object.create({
      [STORED_CLOUD_RESOURCE_ID_ATTRIBUTE]: FUNCTION_ARN,
    }) as JSONObject;

    expect(readLogCloudResource(attributes)).toEqual({});
    expect(readLogCloudResource(null)).toEqual({});
  });
});

describe("readLogFunction", () => {
  test("a line's function, by the faas.name ingest stamped on it", () => {
    expect(
      readLogFunction({ [SERVERLESS_FUNCTION_NAME_FILTER]: " checkout " }),
    ).toEqual({ [SECURITY_LOG_FUNCTION_ATTRIBUTE]: "checkout" });
  });

  test.each<[string, JSONObject]>([
    ["no attributes", {}],
    ["the log record's own faas.name", { "faas.name": "checkout" }],
    ["an empty one", { [SERVERLESS_FUNCTION_NAME_FILTER]: "" }],
    [
      "one too long to be a function's",
      {
        [SERVERLESS_FUNCTION_NAME_FILTER]: "f".repeat(
          MAX_LOG_FUNCTION_NAME_LENGTH + 1,
        ),
      },
    ],
  ])("%s names no function", (_case: string, attributes: JSONObject) => {
    expect(readLogFunction(attributes)).toEqual({});
  });
});

describe("every event read from a function's or a resource's line carries them", () => {
  test("an attack in a Lambda's streamed log: its function and its cloud resource, beside the service it is filed under", () => {
    const events: Array<NormalizedSecurityEvent> = streamedLambdaLine(
      WEB_LINES.sqlInjectionEncoded,
    );

    expect(events.length).toBeGreaterThan(0);

    for (const event of events) {
      expect(event.attributes[SECURITY_LOG_FUNCTION_ATTRIBUTE]).toBe(
        "checkout",
      );
      expect(event.attributes[SECURITY_LOG_CLOUD_RESOURCE_ATTRIBUTE]).toBe(
        FUNCTION_ARN,
      );
      expect(event.attributes[SECURITY_LOG_RESOURCE_ID_ATTRIBUTE]).toBe(
        SERVICE_ID,
      );
    }
  });

  test("a function's line its OpenTelemetry layer sent under the service of its name: the function", () => {
    const events: Array<NormalizedSecurityEvent> = SecurityLogParser.parse({
      ...logLine(WEB_LINES.pathTraversal, {
        "resource.service.name": "checkout",
        "resource.cloud.platform": "aws_lambda",
        [SERVERLESS_FUNCTION_NAME_FILTER]: "checkout",
      }),
      resourceId: SERVICE_ID,
      resourceType: ServiceType.OpenTelemetry,
    });

    expect(events.length).toBeGreaterThan(0);
    expect(events[0]!.attributes[SECURITY_LOG_FUNCTION_ATTRIBUTE]).toBe(
      "checkout",
    );
    expect(
      events[0]!.attributes[SECURITY_LOG_CLOUD_RESOURCE_ATTRIBUTE],
    ).toBeUndefined();
  });

  test("a database's streamed log: its cloud resource, and no function", () => {
    const database: string = "arn:aws:rds:us-east-1:111122223333:db:orders-db";
    const events: Array<NormalizedSecurityEvent> = SecurityLogParser.parse({
      ...logLine(SSH_LINES.failedPasswordInvalidUser, {
        [STORED_CLOUD_RESOURCE_ID_ATTRIBUTE]: database,
      }),
      resourceId: SERVICE_ID,
      resourceType: ServiceType.OpenTelemetry,
    });

    expect(events.length).toBeGreaterThan(0);
    expect(events[0]!.attributes[SECURITY_LOG_CLOUD_RESOURCE_ATTRIBUTE]).toBe(
      database,
    );
    expect(
      events[0]!.attributes[SECURITY_LOG_FUNCTION_ATTRIBUTE],
    ).toBeUndefined();
  });

  test("a host's line carries neither", () => {
    const events: Array<NormalizedSecurityEvent> = SecurityLogParser.parse(
      logLine(SSH_LINES.failedPasswordRoot, { "resource.host.name": "web-1" }),
    );

    expect(events.length).toBeGreaterThan(0);
    expect(
      events[0]!.attributes[SECURITY_LOG_CLOUD_RESOURCE_ATTRIBUTE],
    ).toBeUndefined();
    expect(
      events[0]!.attributes[SECURITY_LOG_FUNCTION_ATTRIBUTE],
    ).toBeUndefined();
  });
});

describe("every event read from a function's span carries it (#9780)", () => {
  function span(attributes: Record<string, string>): TraceScanSpan {
    return {
      traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
      spanId: "00f067aa0ba902b7",
      parentSpanId: "",
      sessionId: "",
      name: "GET /items",
      kind: "SPAN_KIND_SERVER",
      durationMs: 12,
      startTime: new Date("2026-11-18T10:00:00.000Z"),
      serviceId: SERVICE_ID,
      serviceType: "OpenTelemetry",
      isLlmSpan: false,
      llmUserMessagePreview: "",
      llmUserId: "",
      llmSystem: "",
      llmRequestModel: "",
      llmOperation: "",
      attributes,
    };
  }

  test("the trace scan reads the two attributes of every span it reads", () => {
    expect(TRACE_SCAN_ATTRIBUTES_READ).toEqual(
      expect.arrayContaining([
        SECURITY_LOG_ROW_CLOUD_RESOURCE_KEY,
        SECURITY_LOG_ROW_FUNCTION_KEY,
      ]),
    );
  });

  test("an attack in a request a Lambda answered: its function and its cloud resource", () => {
    const events: Array<NormalizedSecurityEvent> = buildTraceSecurityEvents(
      span({
        "url.full": "https://api.example/items?id=1%27%20or%201%3D1--",
        [SERVERLESS_FUNCTION_NAME_FILTER]: "checkout",
        [STORED_CLOUD_RESOURCE_ID_ATTRIBUTE]: FUNCTION_ARN,
      }),
    );

    expect(events).toHaveLength(1);
    expect(events[0]!.attributes[SECURITY_LOG_FUNCTION_ATTRIBUTE]).toBe(
      "checkout",
    );
    expect(events[0]!.attributes[SECURITY_LOG_CLOUD_RESOURCE_ATTRIBUTE]).toBe(
      FUNCTION_ARN,
    );
    // Still filed under its service, as before.
    expect(events[0]!.attributes[SECURITY_LOG_RESOURCE_ID_ATTRIBUTE]).toBe(
      SERVICE_ID,
    );
  });

  test("a span of no function carries neither", () => {
    const events: Array<NormalizedSecurityEvent> = buildTraceSecurityEvents(
      span({ "url.full": "https://api.example/items?id=1%27%20or%201%3D1--" }),
    );

    expect(events).toHaveLength(1);
    expect(
      events[0]!.attributes[SECURITY_LOG_FUNCTION_ATTRIBUTE],
    ).toBeUndefined();
    expect(
      events[0]!.attributes[SECURITY_LOG_CLOUD_RESOURCE_ATTRIBUTE],
    ).toBeUndefined();
  });
});
