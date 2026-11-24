/*
 * A MONITOR SECRET A CHECK SAYS BACK NEVER GOES PAST THE SERVER'S INGEST
 * (#10825).
 *
 * The server fills {{monitorSecrets.NAME}} into a monitor's steps before it
 * hands the check to the probe, and the check can say the value back: a
 * Synthetic or Custom JavaScript Code script's error (Playwright quotes the
 * URL a page failed to load, token and all) and log lines, a response that
 * echoes the query, the headers or the body it was sent. A probe of any
 * release reports what it reports, so the server hides each value as it
 * takes the check in:
 *
 *   - a Test Monitor run's check here, in processProbeFromQueue, right after
 *     the test is read: before it is judged (MonitorTestEvaluation) and kept
 *     (MonitorTestService.mergeStepProbeResponse);
 *   - a monitor's check in MonitorResource, right after the monitor is read
 *     (MonitorResourceSecretValues.test.ts in Common): here it is handed on
 *     as the probe sent it, with no read of the monitor of its own.
 *
 * MonitorResource, MonitorTestService and the secrets the monitor may use
 * are mocked; the evaluation of a test is the real one. The echoed
 * response comes from a real local HTTP server.
 */

jest.mock("Common/Server/Utils/Monitor/MonitorResource", () => {
  return {
    __esModule: true,
    default: {
      monitorResource: jest.fn(() => {
        return Promise.resolve({});
      }),
    },
  };
});

jest.mock("Common/Server/Services/MonitorTestService", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "Common/Server/Services/MonitorTestService",
  ) as Record<string, unknown>;

  return {
    __esModule: true,
    MONITOR_TEST_NOT_HANDED_TO_PROBE_MESSAGE:
      actual["MONITOR_TEST_NOT_HANDED_TO_PROBE_MESSAGE"],
    default: {
      findOneById: jest.fn(),
      mergeStepProbeResponse: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/MonitorSecretService", () => {
  return {
    __esModule: true,
    default: {
      getSecretsForMonitors: jest.fn(),
      getSecretsForUnsavedMonitor: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      trace: jest.fn(),
    },
  };
});

import http, { IncomingMessage, Server, ServerResponse } from "http";
import { AddressInfo } from "net";
import { processProbeFromQueue } from "../../FeatureSet/Telemetry/Jobs/ProbeIngest/ProcessProbeIngest";
import { ProbeIngestJobData } from "../../FeatureSet/Telemetry/Services/Queue/TelemetryQueueService";
import MonitorResourceUtil from "Common/Server/Utils/Monitor/MonitorResource";
import MonitorTestService from "Common/Server/Services/MonitorTestService";
import MonitorSecretService from "Common/Server/Services/MonitorSecretService";
import { HIDDEN_SECRET_MARKER } from "Common/Server/Utils/Monitor/MonitorSecretValueRedaction";
import MonitorSecret from "Common/Models/DatabaseModels/MonitorSecret";
import MonitorTest from "Common/Models/DatabaseModels/MonitorTest";
import URL from "Common/Types/API/URL";
import Dictionary from "Common/Types/Dictionary";
import FilterCondition from "Common/Types/Filter/FilterCondition";
import { JSONObject } from "Common/Types/JSON";
import { CheckOn, FilterType } from "Common/Types/Monitor/CriteriaFilter";
import MonitorCriteria from "Common/Types/Monitor/MonitorCriteria";
import MonitorCriteriaInstance from "Common/Types/Monitor/MonitorCriteriaInstance";
import MonitorSecretType from "Common/Types/Monitor/MonitorSecretType";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import MonitorSteps from "Common/Types/Monitor/MonitorSteps";
import MonitorType from "Common/Types/Monitor/MonitorType";
import ObjectID from "Common/Types/ObjectID";
import ProbeMonitorResponse from "Common/Types/Probe/ProbeMonitorResponse";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";
import { Mock } from "jest-mock";

type AnyMock = Mock<(...args: Array<any>) => any>;

const monitorResource: AnyMock =
  MonitorResourceUtil.monitorResource as unknown as AnyMock;
const findTest: AnyMock = MonitorTestService.findOneById as unknown as AnyMock;
const mergeStepProbeResponse: AnyMock =
  MonitorTestService.mergeStepProbeResponse as unknown as AnyMock;
const getSecretsForMonitors: AnyMock =
  MonitorSecretService.getSecretsForMonitors as unknown as AnyMock;
const getSecretsForUnsavedMonitor: AnyMock =
  MonitorSecretService.getSecretsForUnsavedMonitor as unknown as AnyMock;

const SENDER: string = "2a4c6e8f-0b1d-4f3a-9c5e-7b9d1f3a5c11";
const TEST_ID: string = "3c5e7a9b-1d2f-4a4c-8e6b-0d2f4a6c8e33";
const PROJECT_ID: string = "0e2a4c6e-8b3d-4f5a-9c7e-1d3f5b7d9f66";
const MONITOR_ID: string = "9d1f3b5d-7a2c-4c6e-8f0a-2b4d6f8a0c55";

// The values, as their secrets hold them: a quote, a backslash, spaces, unicode.
const TOKEN: string = "tok_Live-Q7r9xZ2";
const API_KEY: string = "ak/8f3+K9=Zz";
const PASSWORD: string = 'Pa ss"w\\rd-é!';

function asJson(value: unknown): JSONObject {
  return JSON.parse(JSON.stringify(value)) as JSONObject;
}

function secret(name: string, value: string): MonitorSecret {
  const monitorSecret: MonitorSecret = new MonitorSecret();
  monitorSecret.name = name;
  monitorSecret.secretValue = value;
  monitorSecret.secretType = MonitorSecretType.Text;
  monitorSecret.projectId = new ObjectID(PROJECT_ID);

  return monitorSecret;
}

function criteria(
  checkOn: CheckOn,
  filterType: FilterType,
  value: string,
): MonitorCriteria {
  const instance: MonitorCriteriaInstance = new MonitorCriteriaInstance();
  instance.data!.id = "criteria-1";
  instance.data!.name = "Check failed";
  instance.data!.filterCondition = FilterCondition.Any;
  instance.data!.filters = [
    { checkOn: checkOn, filterType: filterType, value: value },
  ];

  const monitorCriteria: MonitorCriteria = new MonitorCriteria();
  monitorCriteria.data = { monitorCriteriaInstanceArray: [instance] };

  return monitorCriteria;
}

// A test as the Test Monitor form wrote it, handed to the sender.
function monitorTest(input: {
  step: MonitorStep;
  monitorType: MonitorType;
  monitorId?: string | undefined;
}): MonitorTest {
  const steps: MonitorSteps = new MonitorSteps();
  steps.data = {
    monitorStepsInstanceArray: [input.step],
    defaultMonitorStatusId: undefined,
  };

  const test: MonitorTest = new MonitorTest();
  test.id = new ObjectID(TEST_ID);
  test.projectId = new ObjectID(PROJECT_ID);
  test.monitorType = input.monitorType;
  test.monitorSteps = steps;
  test.probeId = new ObjectID(SENDER);

  if (input.monitorId) {
    test.monitorId = new ObjectID(input.monitorId);
  }

  return test;
}

// A job as the probe ingest route queues it, read back from Redis.
function job(
  jobType: "probe-response" | "monitor-test",
  result: JSONObject,
): ProbeIngestJobData {
  return JSON.parse(
    JSON.stringify({
      jobType: jobType,
      testId: jobType === "monitor-test" ? TEST_ID : undefined,
      ingestionTimestamp: new Date("2026-11-23T10:00:01.500Z"),
      probeMonitorResponse: {
        probeId: SENDER,
        probeMonitorResponse: result,
      },
    }),
  ) as ProbeIngestJobData;
}

// Every text in a value, its object keys included.
function textsOf(value: unknown): Array<string> {
  if (typeof value === "string") {
    return [value];
  }

  if (Array.isArray(value)) {
    return value.flatMap((item: unknown): Array<string> => {
      return textsOf(item);
    });
  }

  if (value && typeof value === "object") {
    if (Object.getPrototypeOf(value) !== Object.prototype) {
      return [String(value)];
    }

    return Object.entries(value as Record<string, unknown>).flatMap(
      ([key, item]: [string, unknown]): Array<string> => {
        return [key, ...textsOf(item)];
      },
    );
  }

  return [];
}

// The forms of the values a text still holds.
function formsLeftIn(value: unknown, secrets: Array<string>): Array<string> {
  const left: Array<string> = [];

  for (const text of textsOf(value)) {
    for (const secretValue of secrets) {
      for (const form of [
        secretValue,
        encodeURIComponent(secretValue),
        JSON.stringify(secretValue).slice(1, -1),
      ]) {
        if (text.toLowerCase().includes(form.toLowerCase())) {
          left.push(form);
        }
      }
    }
  }

  return left;
}

// What the test kept of its step: the step's entry of the merged result.
function keptResult(stepId: ObjectID): JSONObject {
  expect(mergeStepProbeResponse).toHaveBeenCalledTimes(1);

  const merged: JSONObject = mergeStepProbeResponse.mock
    .calls[0]![0] as JSONObject;

  return (merged["monitorStepProbeResponse"] as JSONObject)[
    stepId.toString()
  ] as JSONObject;
}

let echoServer: Server;
let echoPort: number = 0;

beforeAll(async () => {
  // httpbin's /anything: the query, the headers and the body it was sent.
  echoServer = http.createServer(
    (request: IncomingMessage, response: ServerResponse): void => {
      let body: string = "";

      request.on("data", (chunk: Buffer) => {
        body += chunk.toString("utf8");
      });

      request.on("end", () => {
        const address: globalThis.URL = new globalThis.URL(
          request.url || "/",
          "http://127.0.0.1",
        );

        response.writeHead(200, {
          "Content-Type": "application/json",
          "X-Echoed-Key": address.searchParams.get("key") || "",
        });
        response.end(
          JSON.stringify({
            args: Object.fromEntries(address.searchParams.entries()),
            headers: request.headers,
            data: body,
            json: body ? JSON.parse(body) : null,
          }),
        );
      });
    },
  );

  await new Promise<void>((resolve: () => void) => {
    echoServer.listen(0, "127.0.0.1", resolve);
  });

  echoPort = (echoServer.address() as AddressInfo).port;
});

afterAll(async () => {
  await new Promise<void>((resolve: () => void) => {
    echoServer.close(() => {
      resolve();
    });
  });
});

beforeEach(() => {
  monitorResource.mockClear();
  findTest.mockReset();
  mergeStepProbeResponse.mockReset();
  mergeStepProbeResponse.mockResolvedValue(true as never);
  getSecretsForMonitors.mockReset();
  getSecretsForUnsavedMonitor.mockReset();
});

describe("a Test Monitor run's check, as the server takes it in", () => {
  it("a Synthetic script's error and log lines are judged and kept with the token hidden", async () => {
    const script: string = [
      "await page.goto('https://app.example.invalid/login?token={{monitorSecrets.Token}}');",
      "console.log('as {{monitorSecrets.Password}}');",
    ].join("\n");

    const step: MonitorStep = new MonitorStep();
    step.setCustomCode(script);
    step.data!.monitorCriteria = criteria(
      CheckOn.Error,
      FilterType.Contains,
      "ERR_NAME_NOT_RESOLVED",
    );

    // A test run from the Create Monitor form: no monitor saved yet.
    const test: MonitorTest = monitorTest({
      step: step,
      monitorType: MonitorType.SyntheticMonitor,
    });
    findTest.mockResolvedValue(test as never);
    getSecretsForUnsavedMonitor.mockResolvedValue([
      secret("Token", TOKEN),
      secret("Password", PASSWORD),
    ] as never);

    // Playwright 1.63.0's error, as Chromium writes the URL.
    const playwrightError: string = `page.goto: net::ERR_NAME_NOT_RESOLVED at https://app.example.invalid/login?token=${TOKEN}\nCall log:\n\u001b[2m  - navigating to "https://app.example.invalid/login?token=${TOKEN}", waiting until "load"\u001b[22m\n`;

    await processProbeFromQueue(
      job("monitor-test", {
        projectId: asJson(new ObjectID(PROJECT_ID)),
        monitorId: asJson(new ObjectID(TEST_ID)),
        monitorStepId: asJson(step.id),
        probeId: asJson(new ObjectID(SENDER)),
        isOnline: false,
        failureCause: "",
        syntheticMonitorResponse: [
          {
            result: null,
            scriptError: playwrightError,
            logMessages: [`as ${PASSWORD}`],
            capturedMetrics: [],
            executionTimeInMS: 2048,
            screenshots: {},
            browserType: "Chromium",
            screenSizeType: "Desktop",
          },
        ],
        monitoredAt: "2026-11-23T10:00:01.000Z",
      }),
    );

    expect(getSecretsForUnsavedMonitor).toHaveBeenCalledWith({
      projectId: new ObjectID(PROJECT_ID),
    });

    const kept: JSONObject = keptResult(step.id);

    expect(formsLeftIn(kept, [TOKEN, PASSWORD])).toEqual([]);

    const run: JSONObject = (
      kept["syntheticMonitorResponse"] as Array<JSONObject>
    )[0]!;

    expect(run["scriptError"]).toContain(
      `page.goto: net::ERR_NAME_NOT_RESOLVED at https://app.example.invalid/login?token=${HIDDEN_SECRET_MARKER}`,
    );
    expect(run["logMessages"]).toEqual([`as ${HIDDEN_SECRET_MARKER}`]);

    // Judged on the error as kept: the Error criteria still met.
    const evaluation: JSONObject = kept["evaluationSummary"] as JSONObject;
    expect(JSON.stringify(evaluation)).toContain("ERR_NAME_NOT_RESOLVED");
    expect(
      (evaluation["criteriaResults"] as Array<JSONObject>).some(
        (result: JSONObject): boolean => {
          return result["met"] === true;
        },
      ),
    ).toBe(true);

    // The test keeps its placeholders.
    expect(step.data!.customCode).toBe(script);
  });

  it("a response that echoes the query, the headers and the body, from a real server", async () => {
    const step: MonitorStep = new MonitorStep();
    step.setMonitorDestination(
      URL.fromString(
        `http://127.0.0.1:${echoPort}/anything?key={{monitorSecrets.ApiKey}}&token={{monitorSecrets.Token}}`,
      ),
    );
    step.data!.requestHeaders = { "X-Api-Key": "{{monitorSecrets.ApiKey}}" };
    step.data!.requestBody = '{"password": "{{monitorSecrets.Password}}"}';
    step.data!.monitorCriteria = criteria(
      CheckOn.ResponseBody,
      FilterType.Contains,
      "args",
    );

    // A test of a saved monitor: its secrets, while it is in the test's project.
    findTest.mockResolvedValue(
      monitorTest({
        step: step,
        monitorType: MonitorType.API,
        monitorId: MONITOR_ID,
      }) as never,
    );
    getSecretsForMonitors.mockResolvedValue(
      new Map<string, Array<MonitorSecret>>([
        [
          MONITOR_ID,
          [
            secret("ApiKey", API_KEY),
            secret("Token", TOKEN),
            secret("Password", PASSWORD),
          ],
        ],
      ]) as never,
    );

    // The request as the server filled it in, and a client sends it.
    const answer: { body: string; headers: Dictionary<string> } =
      await new Promise(
        (
          resolve: (value: {
            body: string;
            headers: Dictionary<string>;
          }) => void,
          reject: (error: Error) => void,
        ) => {
          const request: http.ClientRequest = http.request(
            {
              host: "127.0.0.1",
              port: echoPort,
              path: `/anything?key=${encodeURIComponent(API_KEY)}&token=${encodeURIComponent(TOKEN)}`,
              method: "POST",
              headers: {
                "X-Api-Key": API_KEY,
                "Content-Type": "application/json",
              },
            },
            (response: IncomingMessage) => {
              let text: string = "";

              response.on("data", (chunk: Buffer) => {
                text += chunk.toString("utf8");
              });
              response.on("end", () => {
                const headers: Dictionary<string> = {};

                for (const [name, value] of Object.entries(response.headers)) {
                  headers[name] = String(value);
                }

                resolve({ body: text, headers: headers });
              });
            },
          );

          request.on("error", reject);
          request.end(JSON.stringify({ password: PASSWORD }));
        },
      );

    expect(
      formsLeftIn(answer, [API_KEY, TOKEN, PASSWORD]).length,
    ).toBeGreaterThan(0);

    await processProbeFromQueue(
      job("monitor-test", {
        projectId: asJson(new ObjectID(PROJECT_ID)),
        monitorId: asJson(new ObjectID(MONITOR_ID)),
        monitorStepId: asJson(step.id),
        probeId: asJson(new ObjectID(SENDER)),
        isOnline: true,
        responseCode: 200,
        responseBody: JSON.stringify(JSON.parse(answer.body)),
        responseHeaders: answer.headers,
        monitorDestination: asJson(
          URL.fromString(
            `http://127.0.0.1:${echoPort}/anything?key=${API_KEY}&token=${TOKEN}`,
          ),
        ),
        failureCause: "",
        monitoredAt: "2026-11-23T10:00:01.000Z",
      }),
    );

    expect(getSecretsForMonitors).toHaveBeenCalledWith({
      monitorIds: [new ObjectID(MONITOR_ID)],
      projectId: new ObjectID(PROJECT_ID),
    });

    const kept: JSONObject = keptResult(step.id);

    expect(formsLeftIn(kept, [API_KEY, TOKEN, PASSWORD])).toEqual([]);

    const body: Record<string, any> = JSON.parse(
      kept["responseBody"] as string,
    );

    expect(body["args"]).toEqual({
      key: HIDDEN_SECRET_MARKER,
      token: HIDDEN_SECRET_MARKER,
    });
    expect(body["json"]).toEqual({ password: HIDDEN_SECRET_MARKER });
    expect(body["headers"]["x-api-key"]).toBe(HIDDEN_SECRET_MARKER);
    expect((kept["responseHeaders"] as JSONObject)["x-echoed-key"]).toBe(
      HIDDEN_SECRET_MARKER,
    );
  });

  it("a test whose steps name no secret is read for none", async () => {
    const step: MonitorStep = new MonitorStep();
    step.setCustomCode("await page.goto('https://example.com');");

    findTest.mockResolvedValue(
      monitorTest({
        step: step,
        monitorType: MonitorType.SyntheticMonitor,
      }) as never,
    );

    await processProbeFromQueue(
      job("monitor-test", {
        projectId: asJson(new ObjectID(PROJECT_ID)),
        monitorId: asJson(new ObjectID(TEST_ID)),
        monitorStepId: asJson(step.id),
        probeId: asJson(new ObjectID(SENDER)),
        isOnline: true,
        failureCause: "",
        monitoredAt: "2026-11-23T10:00:01.000Z",
      }),
    );

    expect(getSecretsForMonitors).not.toHaveBeenCalled();
    expect(getSecretsForUnsavedMonitor).not.toHaveBeenCalled();
    expect(mergeStepProbeResponse).toHaveBeenCalledTimes(1);
  });
});

describe("a monitor's check, as the queue hands it on", () => {
  it("goes to MonitorResource as the probe sent it, which hides the secrets as it reads the monitor; the queue reads no monitor and no secret of its own", async () => {
    const error: string = `page.goto: net::ERR_NAME_NOT_RESOLVED at https://app.example.invalid/?token=${TOKEN}`;

    await processProbeFromQueue(
      job("probe-response", {
        projectId: asJson(new ObjectID(PROJECT_ID)),
        monitorId: asJson(new ObjectID(MONITOR_ID)),
        monitorStepId: asJson(ObjectID.generate()),
        probeId: asJson(new ObjectID(SENDER)),
        isOnline: false,
        failureCause: "",
        customCodeMonitorResponse: {
          result: null,
          scriptError: error,
          logMessages: [],
          capturedMetrics: [],
          executionTimeInMS: 5,
        },
        monitoredAt: "2026-11-23T10:00:01.000Z",
      }),
    );

    expect(monitorResource).toHaveBeenCalledTimes(1);
    expect(
      (monitorResource.mock.calls[0]![0] as ProbeMonitorResponse)
        .customCodeMonitorResponse?.scriptError,
    ).toBe(error);
    expect(findTest).not.toHaveBeenCalled();
    expect(getSecretsForMonitors).not.toHaveBeenCalled();
  });
});
