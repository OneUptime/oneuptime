import Monitor from "../../../../Models/DatabaseModels/Monitor";
import DataToProcess from "../../../../Server/Utils/Monitor/DataToProcess";
import MonitorCriteriaEvaluator from "../../../../Server/Utils/Monitor/MonitorCriteriaEvaluator";
import MonitorEvaluationDetailsBuilder from "../../../../Server/Utils/Monitor/MonitorEvaluationDetailsBuilder";
import MonitorEvaluationEvidence, {
  MonitorEvaluationFilterEvidence,
} from "../../../../Server/Utils/Monitor/MonitorEvaluationEvidence";
import HTTPMethod from "../../../../Types/API/HTTPMethod";
import URL from "../../../../Types/API/URL";
import Hostname from "../../../../Types/API/Hostname";
import FilterCondition from "../../../../Types/Filter/FilterCondition";
import {
  CheckOn,
  CriteriaFilter,
  EvaluateOverTimeType,
  FilterType,
} from "../../../../Types/Monitor/CriteriaFilter";
import MonitorCriteriaInstance from "../../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorEvaluationDetails, {
  MonitorEvaluationDetailsLimits,
  MonitorEvaluationDetailsVersion,
  MonitorEvaluationFilterDetails,
} from "../../../../Types/Monitor/MonitorEvaluationDetails";
import MonitorEvaluationSummary from "../../../../Types/Monitor/MonitorEvaluationSummary";
import MonitorStep from "../../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import ObjectID from "../../../../Types/ObjectID";
import Port from "../../../../Types/Port";
import ProbeApiIngestResponse from "../../../../Types/Probe/ProbeApiIngestResponse";
import ProbeMonitorResponse from "../../../../Types/Probe/ProbeMonitorResponse";
import { describe, expect, test } from "@jest/globals";

/*
 * WHY A MONITOR OPENED AN INCIDENT, AS THE INCIDENT KEEPS IT.
 *
 * Each case below runs the real criteria evaluator on a check, then builds
 * the evaluation details from what it decided - what an incident or an alert
 * created from that check stores: the criteria, each filter's condition and
 * sentence, what a filter that matched found and where, the request and the
 * response, all of it redacted and bounded.
 */

const REDACTED: string = "[REDACTED]";
const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const MONITOR_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const PROBE_ID: ObjectID = new ObjectID("44444444-4444-4444-8444-444444444444");
const CHECKED_AT: Date = new Date("2026-11-08T10:04:12.000Z");

interface Evaluation {
  details: MonitorEvaluationDetails | null;
  rootCause: string | null;
}

function criteria(input: {
  filters: Array<CriteriaFilter>;
  filterCondition?: FilterCondition;
  name?: string;
}): MonitorCriteriaInstance {
  const instance: MonitorCriteriaInstance = new MonitorCriteriaInstance();
  instance.data!.id = "criteria-1";
  instance.data!.name = input.name ?? "API returns errors";
  instance.data!.filterCondition = input.filterCondition || FilterCondition.All;
  instance.data!.filters = input.filters;
  instance.data!.createIncidents = true;
  instance.data!.createAlerts = true;
  return instance;
}

function step(input: {
  criteriaInstance: MonitorCriteriaInstance;
  destination?: URL | Hostname | undefined;
  port?: number | undefined;
  requestType?: HTTPMethod | undefined;
}): MonitorStep {
  const monitorStep: MonitorStep = new MonitorStep();
  monitorStep.data!.id = "33333333-3333-4333-8333-333333333333";
  monitorStep.data!.monitorCriteria.data!.monitorCriteriaInstanceArray = [
    input.criteriaInstance,
  ];
  monitorStep.data!.monitorDestination = input.destination;

  if (input.port) {
    monitorStep.data!.monitorDestinationPort = new Port(input.port);
  }

  if (input.requestType) {
    monitorStep.data!.requestType = input.requestType;
  }

  return monitorStep;
}

function monitorFor(input: {
  monitorType: MonitorType;
  steps: Array<MonitorStep>;
  keepResponseContent?: boolean | undefined;
}): Monitor {
  const monitor: Monitor = new Monitor();
  monitor._id = MONITOR_ID.toString();
  monitor.projectId = PROJECT_ID;
  monitor.monitorType = input.monitorType;
  monitor.name = "Checkout API";

  const steps: MonitorSteps = new MonitorSteps();
  steps.data!.monitorStepsInstanceArray = input.steps;
  monitor.monitorSteps = steps;

  if (input.keepResponseContent !== undefined) {
    monitor.keepResponseContent = input.keepResponseContent;
  }

  return monitor;
}

function probeCheck(input: Partial<ProbeMonitorResponse>): DataToProcess {
  return {
    projectId: PROJECT_ID,
    monitorId: MONITOR_ID,
    monitorStepId: new ObjectID("33333333-3333-4333-8333-333333333333"),
    probeId: PROBE_ID,
    isOnline: true,
    failureCause: "",
    monitoredAt: CHECKED_AT,
    ...input,
  } as unknown as DataToProcess;
}

async function evaluate(input: {
  monitorType: MonitorType;
  filters: Array<CriteriaFilter>;
  filterCondition?: FilterCondition;
  dataToProcess: DataToProcess;
  destination?: URL | Hostname | undefined;
  port?: number | undefined;
  requestType?: HTTPMethod | undefined;
  keepResponseContent?: boolean | undefined;
  extraSteps?: number | undefined;
}): Promise<Evaluation> {
  const criteriaInstance: MonitorCriteriaInstance = criteria({
    filters: input.filters,
    ...(input.filterCondition ? { filterCondition: input.filterCondition } : {}),
  });

  const monitorStep: MonitorStep = step({
    criteriaInstance: criteriaInstance,
    destination: input.destination,
    port: input.port,
    requestType: input.requestType,
  });

  const steps: Array<MonitorStep> = [monitorStep];

  for (let index: number = 0; index < (input.extraSteps || 0); index++) {
    steps.push(new MonitorStep());
  }

  const monitor: Monitor = monitorFor({
    monitorType: input.monitorType,
    steps: steps,
    keepResponseContent: input.keepResponseContent,
  });

  const evaluationSummary: MonitorEvaluationSummary = {
    evaluatedAt: CHECKED_AT,
    criteriaResults: [],
    events: [],
  };

  const response: ProbeApiIngestResponse =
    await MonitorCriteriaEvaluator.processMonitorStep({
      dataToProcess: input.dataToProcess,
      monitorStep: monitorStep,
      monitor: monitor,
      probeApiIngestResponse: {
        monitorId: MONITOR_ID,
        rootCause: null,
      } as ProbeApiIngestResponse,
      evaluationSummary: evaluationSummary,
    });

  const details: MonitorEvaluationDetails | null =
    await MonitorEvaluationDetailsBuilder.build({
      monitor: monitor,
      monitorStep: monitorStep,
      criteriaInstance: criteriaInstance,
      evaluationSummary: evaluationSummary,
      dataToProcess: input.dataToProcess,
      probeName: "US West",
    });

  return { details: details, rootCause: response.rootCause || null };
}

function filterOf(
  details: MonitorEvaluationDetails | null,
  checkOn: CheckOn,
): MonitorEvaluationFilterDetails {
  const filter: MonitorEvaluationFilterDetails | undefined =
    details?.filters.find((candidate: MonitorEvaluationFilterDetails) => {
      return candidate.checkOn === checkOn;
    });

  expect(filter).toBeDefined();

  return filter!;
}

const HEALTH_BODY: string = JSON.stringify({
  service: "checkout",
  owner: "oncall@acme.example",
  token: "tok_live_9f8e7d6c5b4a",
  checks: [
    { name: "db", status: "ok" },
    { name: "payments", status: "error: connection refused" },
  ],
});

describe("an API monitor whose JSON body matched", () => {
  test("keeps the criteria, the field that matched and a redacted excerpt around it", async () => {
    const { details } = await evaluate({
      monitorType: MonitorType.API,
      filters: [
        {
          checkOn: CheckOn.ResponseBody,
          filterType: FilterType.Contains,
          value: "error",
        },
      ],
      dataToProcess: probeCheck({
        responseCode: 503,
        responseTimeInMs: 1234.4,
        responseBody: HEALTH_BODY,
        responseHeaders: {
          "content-type": "application/json",
          "set-cookie": "sid=abc",
        },
      }),
      destination: URL.fromString(
        "https://api.acme.example/v1/health?api_key=k_live_123&region=eu",
      ),
      requestType: HTTPMethod.POST,
    });

    expect(details).not.toBeNull();
    expect(details!.version).toBe(MonitorEvaluationDetailsVersion);
    expect(details!.monitorType).toBe(MonitorType.API);
    expect(details!.evaluatedAt).toEqual(CHECKED_AT);
    expect(details!.criteriaId).toBe("criteria-1");
    expect(details!.criteriaName).toBe("API returns errors");
    expect(details!.filterCondition).toBe(FilterCondition.All);
    expect(details!.probeName).toBe("US West");

    // The request line: the method, the URL with its secret masked.
    expect(details!.request).toEqual({
      method: "POST",
      url: `https://api.acme.example/v1/health?api_key=${REDACTED}&region=eu`,
    });

    // What came back.
    expect(details!.response).toEqual({
      statusCode: 503,
      responseTimeInMs: 1234,
      isOnline: true,
    });

    const filter: MonitorEvaluationFilterDetails = filterOf(
      details,
      CheckOn.ResponseBody,
    );

    expect(filter.met).toBe(true);
    expect(filter.filterType).toBe(FilterType.Contains);
    expect(filter.value).toBe("error");
    expect(filter.message).toBe("Response body contains error.");
    expect(filter.field).toBe("checks[1].status");
    expect(filter.excerpt!.match).toBe("error");
    expect(filter.excerpt!.after).toContain(": connection refused");

    // Nothing secret near the match is kept.
    const excerptText: string =
      filter.excerpt!.before + filter.excerpt!.match + filter.excerpt!.after;

    expect(excerptText).not.toContain("tok_live_9f8e7d6c5b4a");
    expect(excerptText).not.toContain("oncall@acme.example");
    expect(JSON.stringify(details)).not.toContain("k_live_123");
    expect(JSON.stringify(details)).not.toContain("sid=abc");
  });

  test("a monitor secret in the URL is named as configured, never its value", async () => {
    const { details } = await evaluate({
      monitorType: MonitorType.API,
      filters: [
        {
          checkOn: CheckOn.ResponseStatusCode,
          filterType: FilterType.GreaterThan,
          value: 499,
        },
      ],
      dataToProcess: probeCheck({
        responseCode: 503,
        // What the probe echoed: the URL with the secret filled in.
        monitorDestination: URL.fromString(
          "https://api.acme.example/tenant-s3cret/health",
        ),
      }),
      destination: "https://api.acme.example/{{monitorSecrets.Tenant}}/health" as unknown as URL,
    });

    expect(details!.request!.url).toBe(
      "https://api.acme.example/{{monitorSecrets.Tenant}}/health",
    );
    expect(JSON.stringify(details)).not.toContain("tenant-s3cret");
  });

  test("status code and response time keep the values the check had", async () => {
    const { details } = await evaluate({
      monitorType: MonitorType.API,
      filters: [
        {
          checkOn: CheckOn.ResponseStatusCode,
          filterType: FilterType.GreaterThan,
          value: 499,
        },
        {
          checkOn: CheckOn.ResponseTime,
          filterType: FilterType.GreaterThan,
          value: 1000,
        },
      ],
      dataToProcess: probeCheck({
        responseCode: 503,
        responseTimeInMs: 1234.4,
        responseBody: "{}",
      }),
      destination: URL.fromString("https://api.acme.example/health"),
    });

    expect(filterOf(details, CheckOn.ResponseStatusCode).actual).toBe("503");
    expect(filterOf(details, CheckOn.ResponseTime).actual).toBe("1234 ms");
    expect(filterOf(details, CheckOn.ResponseStatusCode).message).toContain(
      "503",
    );
  });

  test("Does Not Contain keeps how the body began instead", async () => {
    const { details } = await evaluate({
      monitorType: MonitorType.Website,
      filters: [
        {
          checkOn: CheckOn.ResponseBody,
          filterType: FilterType.NotContains,
          value: "Welcome",
        },
      ],
      dataToProcess: probeCheck({
        responseCode: 200,
        responseBody:
          "<html><head><title>Down for maintenance</title></head><body>Back soon.</body></html>",
      }),
      destination: URL.fromString("https://www.acme.example"),
    });

    const filter: MonitorEvaluationFilterDetails = filterOf(
      details,
      CheckOn.ResponseBody,
    );

    expect(filter.excerpt!.match).toBe("");
    expect(filter.excerpt!.after).toContain("Down for maintenance");
    // A Website monitor's method is the probe's own choice: not claimed.
    expect(details!.request).toEqual({ url: "https://www.acme.example/" });
  });

  test("a header value match names the header, and masks a credential's value", async () => {
    const { details } = await evaluate({
      monitorType: MonitorType.API,
      filters: [
        {
          checkOn: CheckOn.ResponseHeaderValue,
          filterType: FilterType.Contains,
          value: "session=abc",
        },
      ],
      dataToProcess: probeCheck({
        responseCode: 200,
        responseBody: "{}",
        responseHeaders: {
          "Content-Type": "application/json",
          "Set-Cookie": "session=abc",
        },
      }),
      destination: URL.fromString("https://api.acme.example"),
    });

    const filter: MonitorEvaluationFilterDetails = filterOf(
      details,
      CheckOn.ResponseHeaderValue,
    );

    expect(filter.field).toBe("set-cookie");
    expect(filter.actual).toBe(REDACTED);
  });

  test("a header value that is no credential is kept", async () => {
    const { details } = await evaluate({
      monitorType: MonitorType.API,
      filters: [
        {
          checkOn: CheckOn.ResponseHeaderValue,
          filterType: FilterType.Contains,
          value: "miss",
        },
      ],
      dataToProcess: probeCheck({
        responseCode: 200,
        responseBody: "{}",
        responseHeaders: { "X-Cache": "MISS" },
      }),
      destination: URL.fromString("https://api.acme.example"),
    });

    const filter: MonitorEvaluationFilterDetails = filterOf(
      details,
      CheckOn.ResponseHeaderValue,
    );

    expect(filter.field).toBe("x-cache");
    expect(filter.actual).toBe("MISS");
  });

  test("a header name match names the header and lists the ones the check got", async () => {
    const { details } = await evaluate({
      monitorType: MonitorType.API,
      filters: [
        {
          checkOn: CheckOn.ResponseHeader,
          filterType: FilterType.Contains,
          value: "x-deprecated",
        },
      ],
      dataToProcess: probeCheck({
        responseCode: 200,
        responseBody: "{}",
        responseHeaders: {
          "content-type": "application/json",
          "x-deprecated": "true",
        },
      }),
      destination: URL.fromString("https://api.acme.example"),
    });

    const filter: MonitorEvaluationFilterDetails = filterOf(
      details,
      CheckOn.ResponseHeader,
    );

    expect(filter.field).toBe("x-deprecated");
    expect(filter.actual).toBe("content-type, x-deprecated");
  });

  test("a JavaScript expression keeps what each of its references held", async () => {
    const { details, rootCause } = await evaluate({
      monitorType: MonitorType.API,
      filters: [
        {
          checkOn: CheckOn.JavaScriptExpression,
          filterType: FilterType.EvaluatesToTrue,
          value:
            "'{{responseBody.checks[1].status}}'.startsWith('error') && {{responseStatusCode}} >= 500",
        },
      ],
      dataToProcess: probeCheck({
        responseCode: 503,
        responseBody: HEALTH_BODY,
      }),
      destination: URL.fromString("https://api.acme.example"),
    });

    const filter: MonitorEvaluationFilterDetails = filterOf(
      details,
      CheckOn.JavaScriptExpression,
    );

    expect(filter.met).toBe(true);
    expect(filter.actual).toBe("true");
    expect(filter.fieldValues).toEqual([
      {
        path: "responseBody.checks[1].status",
        value: '"error: connection refused"',
      },
      { path: "responseStatusCode", value: "503" },
    ]);

    /*
     * Its sentence - the root cause's finding - names the expression as
     * written, with the values its references held.
     */
    expect(filter.message).toBe(
      "JavaScript Expression - '{{responseBody.checks[1].status}}'.startsWith('error') && {{responseStatusCode}} >= 500 - evaluated to true. Values: responseBody.checks[1].status = \"error: connection refused\", responseStatusCode = 503.",
    );
    expect(rootCause).toContain("evaluated to true");
    expect(rootCause).not.toContain("tok_live");
  });

  test("with Any, a filter that did not match keeps only its sentence", async () => {
    const { details } = await evaluate({
      monitorType: MonitorType.API,
      filterCondition: FilterCondition.Any,
      filters: [
        {
          checkOn: CheckOn.ResponseTime,
          filterType: FilterType.GreaterThan,
          value: 5000,
        },
        {
          checkOn: CheckOn.ResponseStatusCode,
          filterType: FilterType.GreaterThan,
          value: 499,
        },
      ],
      dataToProcess: probeCheck({
        responseCode: 503,
        responseTimeInMs: 120,
        responseBody: "{}",
      }),
      destination: URL.fromString("https://api.acme.example"),
    });

    expect(details!.filterCondition).toBe(FilterCondition.Any);

    const notMatched: MonitorEvaluationFilterDetails = filterOf(
      details,
      CheckOn.ResponseTime,
    );

    expect(notMatched.met).toBe(false);
    expect(notMatched.actual).toBeUndefined();
    expect(notMatched.message).toContain("120");

    expect(filterOf(details, CheckOn.ResponseStatusCode).actual).toBe("503");
  });
});

describe("a monitor that keeps no response content", () => {
  test("keeps the filters and the status, and nothing from the body or headers", async () => {
    const { details } = await evaluate({
      monitorType: MonitorType.API,
      keepResponseContent: false,
      filters: [
        {
          checkOn: CheckOn.ResponseBody,
          filterType: FilterType.Contains,
          value: "error",
        },
        {
          checkOn: CheckOn.JavaScriptExpression,
          filterType: FilterType.EvaluatesToTrue,
          value: "'{{responseBody.service}}'.length > 0",
        },
        {
          checkOn: CheckOn.ResponseStatusCode,
          filterType: FilterType.GreaterThan,
          value: 499,
        },
      ],
      dataToProcess: probeCheck({
        responseCode: 503,
        responseBody: HEALTH_BODY,
      }),
      destination: URL.fromString("https://api.acme.example"),
    });

    expect(details!.areResponseExcerptsOff).toBe(true);

    const body: MonitorEvaluationFilterDetails = filterOf(
      details,
      CheckOn.ResponseBody,
    );

    expect(body.excerpt).toBeUndefined();
    expect(body.field).toBeUndefined();
    expect(body.excerptOmission).toBe("response-excerpts-off");

    const expression: MonitorEvaluationFilterDetails = filterOf(
      details,
      CheckOn.JavaScriptExpression,
    );

    expect(expression.fieldValues).toBeUndefined();
    expect(expression.excerptOmission).toBe("response-excerpts-off");
    // Its sentence names the expression, not what it read.
    expect(expression.message).toBe(
      "JavaScript Expression - '{{responseBody.service}}'.length > 0 - evaluated to true.",
    );

    // What is no content of the response stays.
    expect(filterOf(details, CheckOn.ResponseStatusCode).actual).toBe("503");
    expect(details!.response!.statusCode).toBe(503);
    expect(JSON.stringify(details)).not.toContain("checkout");
    expect(JSON.stringify(details)).not.toContain("connection refused");
  });
});

describe("Ping, IP and Port monitors", () => {
  test("a ping that found the host offline keeps the host and the reachability", async () => {
    const { details } = await evaluate({
      monitorType: MonitorType.Ping,
      filters: [
        {
          checkOn: CheckOn.IsOnline,
          filterType: FilterType.False,
          value: undefined,
        },
      ],
      dataToProcess: probeCheck({
        isOnline: false,
        failureCause: "Request timed out",
      }),
      destination: Hostname.fromString("db.acme.example"),
    });

    expect(filterOf(details, CheckOn.IsOnline).actual).toBe("false");
    expect(details!.request).toEqual({ destination: "db.acme.example" });
    expect(details!.response).toEqual({
      isOnline: false,
      failureCause: "Request timed out",
    });
  });

  test("a port check keeps its port and timings", async () => {
    const { details } = await evaluate({
      monitorType: MonitorType.Port,
      filters: [
        {
          checkOn: CheckOn.PortTcpConnectTime,
          filterType: FilterType.GreaterThan,
          value: 100,
        },
      ],
      dataToProcess: probeCheck({
        isOnline: true,
        responseTimeInMs: 420,
        portTimings: { tcpConnectInMs: 380.55 },
      } as unknown as Partial<ProbeMonitorResponse>),
      destination: Hostname.fromString("db.acme.example"),
      port: 5432,
    });

    expect(filterOf(details, CheckOn.PortTcpConnectTime).actual).toBe(
      "381 ms",
    );
    expect(details!.request).toEqual({
      destination: "db.acme.example",
      port: 5432,
    });
  });

  test("a failure that quotes a URL with a password keeps none of it", async () => {
    const { details } = await evaluate({
      monitorType: MonitorType.Ping,
      filters: [
        {
          checkOn: CheckOn.IsOnline,
          filterType: FilterType.False,
          value: undefined,
        },
      ],
      dataToProcess: probeCheck({
        isOnline: false,
        failureCause:
          "connect ECONNREFUSED via https://admin:hunter2@proxy.acme.example",
      }),
      destination: Hostname.fromString("db.acme.example"),
    });

    expect(details!.response!.failureCause).not.toContain("hunter2");
  });
});

describe("an Incoming Request monitor", () => {
  test("keeps the request's method, the field that matched and an excerpt, never its credentials", async () => {
    const dataToProcess: DataToProcess = {
      projectId: PROJECT_ID,
      monitorId: MONITOR_ID,
      requestMethod: HTTPMethod.POST,
      requestHeaders: {
        authorization: "Bearer abc.def.ghi",
        "content-type": "application/json",
      },
      requestBody: {
        status: "firing",
        alerts: [{ labels: { alertname: "DiskFull", team: "infra" } }],
        contact: "pager@acme.example",
      },
      incomingRequestReceivedAt: CHECKED_AT,
      checkedAt: CHECKED_AT,
    } as unknown as DataToProcess;

    const { details } = await evaluate({
      monitorType: MonitorType.IncomingRequest,
      filters: [
        {
          checkOn: CheckOn.RequestBody,
          filterType: FilterType.Contains,
          value: "DiskFull",
        },
      ],
      dataToProcess: dataToProcess,
    });

    expect(details!.request).toEqual({ method: "POST" });

    const filter: MonitorEvaluationFilterDetails = filterOf(
      details,
      CheckOn.RequestBody,
    );

    expect(filter.field).toBe("alerts[0].labels.alertname");
    expect(filter.excerpt!.match).toBe("DiskFull");
    expect(JSON.stringify(details)).not.toContain("abc.def.ghi");
    expect(JSON.stringify(details)).not.toContain("pager@acme.example");
  });
});

describe("Custom Code and Synthetic monitors", () => {
  test("a result value read at a path keeps the path and the value", async () => {
    const { details } = await evaluate({
      monitorType: MonitorType.CustomJavaScriptCode,
      filters: [
        {
          checkOn: CheckOn.ResultValue,
          filterType: FilterType.EqualTo,
          value: "down",
          customCodeMonitorOptions: { resultValuePath: "checks.payments" },
        },
      ],
      dataToProcess: probeCheck({
        customCodeMonitorResponse: {
          result: {
            checks: { payments: "down", db: "up" },
            apiKey: "k-1",
          },
          logMessages: [],
          capturedMetrics: [],
          executionTimeInMS: 950,
        },
      }),
    });

    const filter: MonitorEvaluationFilterDetails = filterOf(
      details,
      CheckOn.ResultValue,
    );

    expect(filter.field).toBe("checks.payments");
    expect(filter.actual).toBe("down");
    expect(filter.message).toContain('Result value at "checks.payments"');
  });

  test("a synthetic run keeps what the browser it fired on found", async () => {
    const { details } = await evaluate({
      monitorType: MonitorType.SyntheticMonitor,
      filters: [
        {
          checkOn: CheckOn.ExecutionTime,
          filterType: FilterType.GreaterThan,
          value: 3000,
        },
      ],
      dataToProcess: probeCheck({
        syntheticMonitorResponse: [
          {
            result: null,
            logMessages: [],
            capturedMetrics: [],
            executionTimeInMS: 1200,
            browserType: "Chromium",
            screenSizeType: "Desktop",
          },
          {
            result: null,
            logMessages: [],
            capturedMetrics: [],
            executionTimeInMS: 4800,
            browserType: "Firefox",
            screenSizeType: "Mobile",
          },
        ],
      } as unknown as Partial<ProbeMonitorResponse>),
    });

    expect(filterOf(details, CheckOn.ExecutionTime).actual).toBe("4800 ms");
  });

  test("a script error is kept redacted", async () => {
    const { details } = await evaluate({
      monitorType: MonitorType.CustomJavaScriptCode,
      filters: [
        {
          checkOn: CheckOn.Error,
          filterType: FilterType.IsNotEmpty,
          value: undefined,
        },
      ],
      dataToProcess: probeCheck({
        customCodeMonitorResponse: {
          result: undefined,
          scriptError:
            "Login failed for ops@acme.example with Authorization: Bearer tok.123456",
          logMessages: [],
          capturedMetrics: [],
          executionTimeInMS: 40,
        },
      }),
    });

    const actual: string = filterOf(details, CheckOn.Error).actual!;

    expect(actual).toContain("Login failed");
    expect(actual).not.toContain("ops@acme.example");
    expect(actual).not.toContain("tok.123456");
  });
});

describe("what the details say about the evaluation", () => {
  test("a monitor with several steps says which one was evaluated", async () => {
    const { details } = await evaluate({
      monitorType: MonitorType.API,
      filters: [
        {
          checkOn: CheckOn.ResponseStatusCode,
          filterType: FilterType.GreaterThan,
          value: 499,
        },
      ],
      dataToProcess: probeCheck({ responseCode: 500, responseBody: "{}" }),
      destination: URL.fromString("https://api.acme.example"),
      extraSteps: 2,
    });

    expect(details!.stepNumber).toBe(1);
    expect(details!.stepCount).toBe(3);
  });

  test("a monitor with one step does not number it", async () => {
    const { details } = await evaluate({
      monitorType: MonitorType.API,
      filters: [
        {
          checkOn: CheckOn.ResponseStatusCode,
          filterType: FilterType.GreaterThan,
          value: 499,
        },
      ],
      dataToProcess: probeCheck({ responseCode: 500, responseBody: "{}" }),
      destination: URL.fromString("https://api.acme.example"),
    });

    expect(details!.stepNumber).toBeUndefined();
    expect(details!.stepCount).toBeUndefined();
  });

  test("a criteria this check did not match has no details", async () => {
    const { details } = await evaluate({
      monitorType: MonitorType.API,
      filters: [
        {
          checkOn: CheckOn.ResponseStatusCode,
          filterType: FilterType.GreaterThan,
          value: 499,
        },
      ],
      dataToProcess: probeCheck({ responseCode: 200, responseBody: "{}" }),
      destination: URL.fromString("https://api.acme.example"),
    });

    expect(details).toBeNull();
  });

  test("no evaluation summary, no details", async () => {
    const criteriaInstance: MonitorCriteriaInstance = criteria({
      filters: [],
    });

    expect(
      await MonitorEvaluationDetailsBuilder.build({
        monitor: monitorFor({ monitorType: MonitorType.API, steps: [] }),
        criteriaInstance: criteriaInstance,
        dataToProcess: probeCheck({}),
      }),
    ).toBeNull();
  });

  test("a telemetry monitor keeps its filters' sentences, and claims no request", async () => {
    const criteriaInstance: MonitorCriteriaInstance = criteria({
      filters: [
        {
          checkOn: CheckOn.LogCount,
          filterType: FilterType.GreaterThan,
          value: 100,
        },
      ],
    });

    const details: MonitorEvaluationDetails | null =
      await MonitorEvaluationDetailsBuilder.build({
        monitor: monitorFor({ monitorType: MonitorType.Logs, steps: [] }),
        criteriaInstance: criteriaInstance,
        evaluationSummary: {
          evaluatedAt: CHECKED_AT,
          events: [],
          criteriaResults: [
            {
              criteriaId: "criteria-1",
              criteriaName: "Error logs",
              filterCondition: FilterCondition.All,
              met: true,
              message: "All filters met.",
              filters: [
                {
                  checkOn: CheckOn.LogCount,
                  filterType: FilterType.GreaterThan,
                  value: 100,
                  met: true,
                  message: "Log Count was 412, above the 100 threshold.",
                },
              ],
            },
          ],
        },
        dataToProcess: { logCount: 412 } as unknown as DataToProcess,
      });

    expect(details!.request).toBeUndefined();
    expect(details!.response).toBeUndefined();
    expect(details!.filters).toEqual([
      {
        checkOn: CheckOn.LogCount,
        filterType: FilterType.GreaterThan,
        value: 100,
        met: true,
        message: "Log Count was 412, above the 100 threshold.",
      },
    ]);
  });
});

describe("a filter judged over a time window", () => {
  test("says the window, so the value it shows reads as the latest check's", async () => {
    const evidence: MonitorEvaluationFilterEvidence =
      await MonitorEvaluationEvidence.read({
        monitorType: MonitorType.API,
        criteriaFilter: {
          checkOn: CheckOn.ResponseTime,
          filterType: FilterType.GreaterThan,
          value: 1000,
          evaluateOverTime: true,
          evaluateOverTimeOptions: {
            timeValueInMinutes: 5,
            evaluateOverTimeType: EvaluateOverTimeType.Average,
          },
        },
        dataToProcess: probeCheck({ responseTimeInMs: 1800 }),
        includeResponseContent: true,
      });

    expect(evidence).toEqual({
      actual: "1800 ms",
      windowMinutes: 5,
      windowType: EvaluateOverTimeType.Average,
    });
  });
});

describe("the size limit", () => {
  function bulkyDetails(): MonitorEvaluationDetails {
    return {
      version: MonitorEvaluationDetailsVersion,
      monitorType: MonitorType.API,
      evaluatedAt: CHECKED_AT,
      filterCondition: FilterCondition.Any,
      filters: Array.from({ length: 12 }, (): MonitorEvaluationFilterDetails => {
        return {
          checkOn: CheckOn.ResponseBody,
          met: true,
          message: "m".repeat(1000),
          actual: "a".repeat(300),
          fieldValues: Array.from({ length: 10 }, (_value: unknown, index: number) => {
            return { path: `responseBody.f${index}`, value: "v".repeat(300) };
          }),
          excerpt: {
            before: "b".repeat(160),
            match: "x".repeat(200),
            after: "c".repeat(160),
            isCutAtStart: true,
            isCutAtEnd: true,
          },
        };
      }),
    };
  }

  function size(details: MonitorEvaluationDetails): number {
    return Buffer.byteLength(JSON.stringify(details), "utf8");
  }

  test("a record within the limit is kept as it is", () => {
    const details: MonitorEvaluationDetails = bulkyDetails();
    details.filters = details.filters.slice(0, 1);

    const fitted: MonitorEvaluationDetails =
      MonitorEvaluationDetailsBuilder.fitToSizeLimit(details);

    expect(fitted.isTrimmedToSizeLimit).toBeUndefined();
    expect(fitted.filters[0]!.excerpt).toBeDefined();
  });

  test("sheds excerpts first, then values, and says so", () => {
    const fitted: MonitorEvaluationDetails =
      MonitorEvaluationDetailsBuilder.fitToSizeLimit(bulkyDetails());

    expect(size(fitted)).toBeLessThanOrEqual(
      MonitorEvaluationDetailsLimits.maxSizeInBytes,
    );
    expect(fitted.isTrimmedToSizeLimit).toBe(true);
    expect(fitted.filters[0]!.excerpt).toBeUndefined();
    // What says why stays.
    expect(fitted.filters[0]!.message.length).toBeGreaterThan(0);
    expect(fitted.filters).toHaveLength(12);
  });

  test("past every step, keeps the first five filters and says there are more", () => {
    const fitted: MonitorEvaluationDetails =
      MonitorEvaluationDetailsBuilder.fitToSizeLimit(bulkyDetails(), 2000);

    expect(fitted.filters).toHaveLength(5);
    expect(fitted.areFiltersTruncated).toBe(true);
    expect(fitted.isTrimmedToSizeLimit).toBe(true);
  });

  test("a criteria of more filters than kept says so", async () => {
    const filters: Array<CriteriaFilter> = Array.from(
      { length: MonitorEvaluationDetailsLimits.filters + 3 },
      (): CriteriaFilter => {
        return {
          checkOn: CheckOn.ResponseStatusCode,
          filterType: FilterType.GreaterThan,
          value: 499,
        };
      },
    );

    const { details } = await evaluate({
      monitorType: MonitorType.API,
      filters: filters,
      dataToProcess: probeCheck({ responseCode: 500, responseBody: "{}" }),
      destination: URL.fromString("https://api.acme.example"),
    });

    expect(details!.filters).toHaveLength(MonitorEvaluationDetailsLimits.filters);
    expect(details!.areFiltersTruncated).toBe(true);
  });
});
