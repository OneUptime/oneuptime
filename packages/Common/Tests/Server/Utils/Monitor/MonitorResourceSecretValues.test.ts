/*
 * A MONITOR'S CHECK, READ FOR ITS SECRETS BEFORE ANYTHING READS IT (#10825).
 *
 * The server filled the monitor's Text secrets into its steps, and the
 * check the probe reports can say them back: Playwright's error quotes the
 * URL a page failed to load, a script logs what it holds, a server echoes
 * the query, the headers and the body it was sent. MonitorResource hides
 * each value as soon as it has read the monitor - before its criteria judge
 * the check, the probe's latest check is stored, the monitor's log is
 * written or a root cause is built - and the monitor's own configuration
 * keeps the placeholders, so the next check is sent the secret as before.
 *
 * Everything heavy is mocked as in MonitorResourceReportingProbe.test.ts:
 * the monitor service and the monitor's probe rows (MonitorProbeRowsInMemory
 * answers as MonitorProbeLastResults' statement does), the per-monitor
 * semaphore, the metric and log utils, the logger, and the secrets the
 * monitor may use. The criteria evaluator is mocked so the test can see
 * what it is handed, and runs the real one on that, for the root cause it
 * would write. The echoed responses come from real local HTTP servers.
 */

jest.mock("isolated-vm", () => {
  return {};
});

jest.mock("../../../../Server/Utils/Monitor/MonitorCriteriaEvaluator", () => {
  return {
    __esModule: true,
    default: {
      processMonitorStep: jest.fn(),
    },
  };
});

jest.mock("../../../../Server/Services/MonitorService", () => {
  return {
    __esModule: true,
    default: {
      findOneById: jest.fn(),
      updateColumnsByIdWithoutHooks: jest.fn(),
    },
  };
});

jest.mock("../../../../Server/Services/MonitorSecretService", () => {
  return {
    __esModule: true,
    default: {
      getSecretsForMonitors: jest.fn(),
      getSecretsForUnsavedMonitor: jest.fn(),
    },
  };
});

jest.mock("../../../../Server/Utils/Monitor/MonitorProbeLastResults", () => {
  return {
    __esModule: true,
    default: {
      storeResultAndReadProbes: jest.fn(),
      readProbes: jest.fn(),
    },
  };
});

jest.mock("../../../../Server/Infrastructure/Semaphore", () => {
  return {
    __esModule: true,
    default: {
      lock: jest.fn(),
      release: jest.fn(),
    },
  };
});

jest.mock("../../../../Server/Utils/Monitor/MonitorMetricUtil", () => {
  return {
    __esModule: true,
    default: {
      saveMonitorMetrics: jest.fn(),
    },
  };
});

jest.mock("../../../../Server/Utils/Monitor/MonitorLogUtil", () => {
  return {
    __esModule: true,
    default: {
      saveMonitorLog: jest.fn(),
    },
  };
});

jest.mock("../../../../Server/Utils/Logger", () => {
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
import MonitorResourceUtil from "../../../../Server/Utils/Monitor/MonitorResource";
import MonitorCriteriaEvaluator from "../../../../Server/Utils/Monitor/MonitorCriteriaEvaluator";
import MonitorLogUtil from "../../../../Server/Utils/Monitor/MonitorLogUtil";
import MonitorMetricUtil from "../../../../Server/Utils/Monitor/MonitorMetricUtil";
import { HIDDEN_SECRET_MARKER } from "../../../../Server/Utils/Monitor/MonitorSecretValueRedaction";
import MonitorService from "../../../../Server/Services/MonitorService";
import MonitorSecretService from "../../../../Server/Services/MonitorSecretService";
import ProjectService from "../../../../Server/Services/ProjectService";
import Semaphore from "../../../../Server/Infrastructure/Semaphore";
import MonitorProbeRowsInMemory from "../../TestingUtils/MonitorProbeRowsInMemory";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import MonitorProbe from "../../../../Models/DatabaseModels/MonitorProbe";
import MonitorSecret from "../../../../Models/DatabaseModels/MonitorSecret";
import URL from "../../../../Types/API/URL";
import FilterCondition from "../../../../Types/Filter/FilterCondition";
import { CheckOn, FilterType } from "../../../../Types/Monitor/CriteriaFilter";
import MonitorCriteria from "../../../../Types/Monitor/MonitorCriteria";
import MonitorCriteriaInstance from "../../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorEvaluationSummary from "../../../../Types/Monitor/MonitorEvaluationSummary";
import MonitorSecretType from "../../../../Types/Monitor/MonitorSecretType";
import MonitorStep from "../../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../../Types/Monitor/MonitorSteps";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import BrowserType from "../../../../Types/Monitor/SyntheticMonitors/BrowserType";
import ScreenSizeType from "../../../../Types/Monitor/SyntheticMonitors/ScreenSizeType";
import Dictionary from "../../../../Types/Dictionary";
import ObjectID from "../../../../Types/ObjectID";
import OneUptimeDate from "../../../../Types/Date";
import ProbeApiIngestResponse from "../../../../Types/Probe/ProbeApiIngestResponse";
import ProbeMonitorResponse from "../../../../Types/Probe/ProbeMonitorResponse";
import DataToProcess from "../../../../Server/Utils/Monitor/DataToProcess";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";

const processMonitorStepMock: jest.Mock =
  MonitorCriteriaEvaluator.processMonitorStep as unknown as jest.Mock;
const findMonitorMock: jest.Mock =
  MonitorService.findOneById as unknown as jest.Mock;
const updateMonitorColumnsMock: jest.Mock =
  MonitorService.updateColumnsByIdWithoutHooks as unknown as jest.Mock;
const getSecretsForMonitorsMock: jest.Mock =
  MonitorSecretService.getSecretsForMonitors as unknown as jest.Mock;
const saveMetricsMock: jest.Mock =
  MonitorMetricUtil.saveMonitorMetrics as unknown as jest.Mock;
const saveLogMock: jest.Mock =
  MonitorLogUtil.saveMonitorLog as unknown as jest.Mock;
const lockMock: jest.Mock = Semaphore.lock as unknown as jest.Mock;

const SENDER: ObjectID = new ObjectID("0d4b1e3a-6c2f-4e8d-9a71-3f5b2c8e4d10");

// The values, as their secrets hold them: quotes, a backslash, spaces, unicode.
const TOKEN: string = "tok_Live-Q7r9xZ2";
const API_KEY: string = "ak/8f3+K9=Zz";
const PASSWORD: string = 'Pa ss"w\\rd-é!';

let probeRows: MonitorProbeRowsInMemory = new MonitorProbeRowsInMemory();

// What the evaluator was handed, and what the real one made of it.
let judged: Array<DataToProcess> = [];
let rootCauses: Array<string> = [];
let criteriaMet: Array<string | undefined> = [];

function secret(name: string, value: string): MonitorSecret {
  const monitorSecret: MonitorSecret = new MonitorSecret();
  monitorSecret.name = name;
  monitorSecret.secretValue = value;
  monitorSecret.secretType = MonitorSecretType.Text;

  return monitorSecret;
}

function criteria(filter: {
  checkOn: CheckOn;
  filterType: FilterType;
  value: string | undefined;
}): MonitorCriteria {
  const instance: MonitorCriteriaInstance = new MonitorCriteriaInstance();
  instance.data!.id = "criteria-1";
  instance.data!.name = "Script failed";
  instance.data!.filterCondition = FilterCondition.Any;
  instance.data!.filters = [filter];
  instance.data!.createIncidents = false;
  instance.data!.createAlerts = false;

  const monitorCriteria: MonitorCriteria = new MonitorCriteria();
  monitorCriteria.data = { monitorCriteriaInstanceArray: [instance] };

  return monitorCriteria;
}

function makeMonitor(monitorType: MonitorType, step: MonitorStep): Monitor {
  const monitorSteps: MonitorSteps = new MonitorSteps();
  monitorSteps.data = {
    monitorStepsInstanceArray: [step],
    defaultMonitorStatusId: undefined,
  };

  const monitor: Monitor = new Monitor();
  monitor.id = ObjectID.generate();
  monitor.projectId = ObjectID.generate();
  monitor.monitorType = monitorType;
  monitor.monitorSteps = monitorSteps;
  monitor.currentMonitorStatusId = ObjectID.generate();

  return monitor;
}

function makeMonitorProbe(probeId: ObjectID): MonitorProbe {
  const monitorProbe: MonitorProbe = new MonitorProbe();
  monitorProbe.id = ObjectID.generate();
  monitorProbe.probeId = probeId;
  monitorProbe.isEnabled = true;
  monitorProbe.lastMonitoringLog = {};

  return monitorProbe;
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

  if (value instanceof Date || value instanceof ObjectID) {
    return [];
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

// The forms of a value a text still holds.
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

/*
 * An echo server, as httpbin's /anything answers: the query, the headers
 * and the body it was sent, a header of its own that repeats the key, and
 * an error page that quotes the address for anything else.
 */
function echo(request: IncomingMessage, response: ServerResponse): void {
  let body: string = "";

  request.on("data", (chunk: Buffer) => {
    body += chunk.toString("utf8");
  });

  request.on("end", () => {
    const address: globalThis.URL = new globalThis.URL(
      request.url || "/",
      "http://127.0.0.1",
    );

    if (!address.pathname.startsWith("/anything")) {
      const asked: string = decodeURIComponent(request.url || "")
        .split("&")
        .join("&amp;")
        .split("<")
        .join("&lt;")
        .split('"')
        .join("&quot;");

      response.writeHead(404, { "Content-Type": "text/html" });
      response.end(
        `<html><body><h1>404</h1><p>No page at ${asked}</p></body></html>`,
      );
      return;
    }

    response.writeHead(200, {
      "Content-Type": "application/json",
      "X-Echoed-Key": address.searchParams.get("key") || "",
      "Set-Cookie": `session=${address.searchParams.get("token") || ""}; Path=/`,
    });
    response.end(
      JSON.stringify({
        args: Object.fromEntries(address.searchParams.entries()),
        headers: request.headers,
        data: body,
        json: body ? JSON.parse(body) : null,
        url: `http://127.0.0.1${request.url}`,
      }),
    );
  });
}

// A request as a probe's API monitor sends it, and the response as it reports it.
function send(input: {
  port: number;
  path: string;
  headers: Dictionary<string>;
  body?: string | undefined;
}): Promise<{
  statusCode: number;
  body: string;
  headers: Dictionary<string>;
}> {
  return new Promise(
    (
      resolve: (value: {
        statusCode: number;
        body: string;
        headers: Dictionary<string>;
      }) => void,
      reject: (error: Error) => void,
    ) => {
      const request: http.ClientRequest = http.request(
        {
          host: "127.0.0.1",
          port: input.port,
          path: input.path,
          method: input.body ? "POST" : "GET",
          headers: input.headers,
        },
        (response: IncomingMessage) => {
          let text: string = "";

          response.on("data", (chunk: Buffer) => {
            text += chunk.toString("utf8");
          });

          response.on("end", () => {
            const headers: Dictionary<string> = {};

            for (const [name, value] of Object.entries(response.headers)) {
              headers[name] = Array.isArray(value)
                ? value.join(", ")
                : String(value);
            }

            resolve({
              statusCode: response.statusCode || 0,
              body: text,
              headers: headers,
            });
          });
        },
      );

      request.on("error", reject);

      if (input.body) {
        request.write(input.body);
      }

      request.end();
    },
  );
}

describe("a monitor's check is read for its secrets before anything reads it", () => {
  let server: Server;
  let port: number = 0;

  beforeAll(async () => {
    server = http.createServer(echo);

    await new Promise<void>((resolve: () => void) => {
      server.listen(0, "127.0.0.1", resolve);
    });

    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await new Promise<void>((resolve: () => void) => {
      server.close(() => {
        resolve();
      });
    });
  });

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(ProjectService, "isProjectBlocked").mockResolvedValue(false);

    lockMock.mockResolvedValue({});
    probeRows = new MonitorProbeRowsInMemory();
    probeRows.install();
    probeRows.set([makeMonitorProbe(SENDER)]);
    updateMonitorColumnsMock.mockResolvedValue(undefined);
    saveMetricsMock.mockResolvedValue(undefined);
    judged = [];
    rootCauses = [];
    criteriaMet = [];

    /*
     * The real evaluator, on what it is handed: the root cause it would
     * write. Reported back as no criteria met, so nothing past the probe's
     * latest check and the log is written.
     */
    processMonitorStepMock.mockImplementation((async (input: {
      dataToProcess: DataToProcess;
      monitorStep: MonitorStep;
      monitor: Monitor;
      probeApiIngestResponse: ProbeApiIngestResponse;
    }): Promise<ProbeApiIngestResponse> => {
      judged.push(input.dataToProcess);

      const evaluationSummary: MonitorEvaluationSummary = {
        evaluatedAt: OneUptimeDate.getCurrentDate(),
        criteriaResults: [],
        events: [],
      };

      const real: ProbeApiIngestResponse = await jest
        .requireActual<{
          default: typeof MonitorCriteriaEvaluator;
        }>("../../../../Server/Utils/Monitor/MonitorCriteriaEvaluator")
        .default.processMonitorStep({
          dataToProcess: input.dataToProcess,
          monitorStep: input.monitorStep,
          monitor: input.monitor,
          probeApiIngestResponse: {
            monitorId: input.monitor.id!,
            rootCause: null,
          } as ProbeApiIngestResponse,
          evaluationSummary: evaluationSummary,
        });

      if (real.rootCause) {
        rootCauses.push(real.rootCause);
      }

      criteriaMet.push(real.criteriaMetId);

      return {
        ...input.probeApiIngestResponse,
        criteriaMetId: undefined,
        rootCause: null,
      };
    }) as never);

    jest
      .spyOn(MonitorResourceUtil as any, "checkProbeAgreement")
      .mockImplementation((input: any) => {
        return Promise.resolve({
          hasAgreement: true,
          agreementCount: 1,
          requiredCount: 1,
          totalActiveProbes: 1,
          agreedCriteriaId: input.currentCriteriaMetId,
          agreedRootCause: input.currentRootCause,
          agreedProbeNames: [],
        });
      });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function everythingWritten(): unknown {
    return {
      judged: judged,
      rootCauses: rootCauses,
      stored: probeRows.stored.map((stored: { lastMonitoringLog: unknown }) => {
        return stored.lastMonitoringLog;
      }),
      logged: saveLogMock.mock.calls,
    };
  }

  test("a Synthetic script's error, log lines and returned data: judged, stored and logged with no secret, the Error criteria still met", async () => {
    const script: string = [
      "await page.goto('https://app.example.invalid/login?token={{monitorSecrets.Token}}');",
      "console.log('signing in with {{monitorSecrets.Password}}');",
    ].join("\n");

    const step: MonitorStep = new MonitorStep();
    step.setCustomCode(script);
    step.data!.monitorCriteria = criteria({
      checkOn: CheckOn.Error,
      filterType: FilterType.Contains,
      value: "ERR_NAME_NOT_RESOLVED",
    });

    const monitor: Monitor = makeMonitor(MonitorType.SyntheticMonitor, step);
    findMonitorMock.mockResolvedValue(monitor);
    getSecretsForMonitorsMock.mockResolvedValue(
      new Map<string, Array<MonitorSecret>>([
        [
          monitor.id!.toString(),
          [
            secret("Token", TOKEN),
            secret("Password", PASSWORD),
            secret("NotUsed", "not-named-by-a-step"),
          ],
        ],
      ]),
    );

    // Playwright 1.63.0's error, as Chromium writes the URL, the token filled in.
    const playwrightError: string = `page.goto: net::ERR_NAME_NOT_RESOLVED at https://app.example.invalid/login?token=${TOKEN}\nCall log:\n\u001b[2m  - navigating to "https://app.example.invalid/login?token=${TOKEN}", waiting until "load"\u001b[22m\n`;

    const check: ProbeMonitorResponse = {
      projectId: monitor.projectId!,
      monitorId: monitor.id!,
      monitorStepId: step.id,
      probeId: SENDER,
      isOnline: false,
      failureCause: "",
      monitoredAt: OneUptimeDate.getCurrentDate(),
      syntheticMonitorResponse: [
        {
          result: { landedOn: `https://app.example.invalid/?token=${TOKEN}` },
          scriptError: playwrightError,
          logMessages: [`signing in with ${PASSWORD}`],
          capturedMetrics: [],
          executionTimeInMS: 2048,
          retryAttempts: [
            {
              attemptNumber: 1,
              scriptError: playwrightError,
              executionTimeInMS: 1000,
            },
            {
              attemptNumber: 2,
              scriptError: playwrightError,
              executionTimeInMS: 1048,
            },
          ],
          screenshots: {},
          browserType: BrowserType.Chromium,
          screenSizeType: ScreenSizeType.Desktop,
        },
      ],
    };

    await MonitorResourceUtil.monitorResource(check, {
      reportingProbeId: SENDER,
    });

    // The secrets the monitor may use, read once.
    expect(getSecretsForMonitorsMock).toHaveBeenCalledTimes(1);
    expect(getSecretsForMonitorsMock).toHaveBeenCalledWith({
      monitorIds: [monitor.id],
    });

    expect(judged).toHaveLength(1);
    expect(probeRows.stored).toHaveLength(1);
    expect(saveLogMock).toHaveBeenCalled();
    expect(formsLeftIn(everythingWritten(), [TOKEN, PASSWORD])).toEqual([]);

    // The Error criteria reads the error as the summary shows it, and is still met.
    const run: NonNullable<
      ProbeMonitorResponse["syntheticMonitorResponse"]
    >[number] = (judged[0] as ProbeMonitorResponse)
      .syntheticMonitorResponse![0]!;

    expect(run.scriptError).toBe(
      `page.goto: net::ERR_NAME_NOT_RESOLVED at https://app.example.invalid/login?token=${HIDDEN_SECRET_MARKER}\nCall log:\n\u001b[2m  - navigating to "https://app.example.invalid/login?token=${HIDDEN_SECRET_MARKER}", waiting until "load"\u001b[22m\n`,
    );
    expect(rootCauses).toHaveLength(1);
    expect(rootCauses[0]).toContain("ERR_NAME_NOT_RESOLVED");

    // The monitor keeps the placeholders: the next check is sent the secrets.
    expect(step.data!.customCode).toBe(script);
    // What the probe sent is not changed under it.
    expect(check.syntheticMonitorResponse![0]!.scriptError).toBe(
      playwrightError,
    );
  });

  test("a response that echoes the query, the headers and the body, from a real server: judged and stored with no secret, the body still JSON", async () => {
    const step: MonitorStep = new MonitorStep();
    step.setMonitorDestination(
      URL.fromString(
        `http://127.0.0.1:${port}/anything/v1?key={{monitorSecrets.ApiKey}}&token={{monitorSecrets.Token}}`,
      ),
    );
    step.data!.requestHeaders = {
      "X-Api-Key": "{{monitorSecrets.ApiKey}}",
    };
    step.data!.requestBody =
      '{"password": "{{monitorSecrets.Password}}", "user": "ops"}';
    step.data!.monitorCriteria = criteria({
      checkOn: CheckOn.ResponseBody,
      filterType: FilterType.Contains,
      value: "ops",
    });

    const monitor: Monitor = makeMonitor(MonitorType.API, step);
    findMonitorMock.mockResolvedValue(monitor);
    getSecretsForMonitorsMock.mockResolvedValue(
      new Map<string, Array<MonitorSecret>>([
        [
          monitor.id!.toString(),
          [
            secret("Token", TOKEN),
            secret("ApiKey", API_KEY),
            secret("Password", PASSWORD),
          ],
        ],
      ]),
    );

    // The request as the server filled it in, and a client sends it.
    const answer: {
      statusCode: number;
      body: string;
      headers: Dictionary<string>;
    } = await send({
      port: port,
      path: `/anything/v1?key=${encodeURIComponent(API_KEY)}&token=${encodeURIComponent(TOKEN)}`,
      headers: {
        "X-Api-Key": API_KEY,
        Authorization: `Basic ${Buffer.from(`ops:${PASSWORD}`, "utf8").toString("base64")}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ password: PASSWORD, user: "ops" }),
    });

    expect(answer.statusCode).toBe(200);
    // The server said every value back.
    expect(
      formsLeftIn(answer, [TOKEN, API_KEY, PASSWORD]).length,
    ).toBeGreaterThan(0);

    const check: ProbeMonitorResponse = {
      projectId: monitor.projectId!,
      monitorId: monitor.id!,
      monitorStepId: step.id,
      probeId: SENDER,
      isOnline: true,
      responseCode: answer.statusCode,
      // As the probe's API monitor keeps a JSON body: its JSON written again.
      responseBody: JSON.stringify(JSON.parse(answer.body)),
      responseHeaders: answer.headers,
      failureCause: "",
      monitorDestination: URL.fromString(
        `http://127.0.0.1:${port}/anything/v1?key=${API_KEY}&token=${TOKEN}`,
      ),
      monitoredAt: OneUptimeDate.getCurrentDate(),
    };

    await MonitorResourceUtil.monitorResource(check, {
      reportingProbeId: SENDER,
    });

    expect(
      formsLeftIn(everythingWritten(), [TOKEN, API_KEY, PASSWORD]),
    ).toEqual([]);

    const read: ProbeMonitorResponse = judged[0] as ProbeMonitorResponse;
    const body: Record<string, any> = JSON.parse(read.responseBody as string);

    expect(body["args"]).toEqual({
      key: HIDDEN_SECRET_MARKER,
      token: HIDDEN_SECRET_MARKER,
    });
    expect(body["json"]).toEqual({
      password: HIDDEN_SECRET_MARKER,
      user: "ops",
    });
    expect(body["headers"]["x-api-key"]).toBe(HIDDEN_SECRET_MARKER);
    // The Basic header: the user's part is no secret, the password's is hidden.
    expect(body["headers"]["authorization"]).toContain(HIDDEN_SECRET_MARKER);
    expect(read.responseHeaders!["x-echoed-key"]).toBe(HIDDEN_SECRET_MARKER);
    expect(read.responseHeaders!["set-cookie"]).toBe(
      `session=${HIDDEN_SECRET_MARKER}; Path=/`,
    );
    expect(read.monitorDestination).toBe(step.data!.monitorDestination);
    expect(rootCauses[0]).toContain("ops");
  });

  test("an error page that quotes the address it was asked for, from a real server", async () => {
    const step: MonitorStep = new MonitorStep();
    // A placeholder in the path is kept as written, as the monitor form keeps it.
    step.setMonitorDestination(
      URL.fromStringLenient(
        `http://127.0.0.1:${port}/missing/{{monitorSecrets.Token}}/page?api_key={{monitorSecrets.ApiKey}}`,
      ),
    );

    const monitor: Monitor = makeMonitor(MonitorType.Website, step);
    findMonitorMock.mockResolvedValue(monitor);
    getSecretsForMonitorsMock.mockResolvedValue(
      new Map<string, Array<MonitorSecret>>([
        [
          monitor.id!.toString(),
          [secret("Token", TOKEN), secret("ApiKey", API_KEY)],
        ],
      ]),
    );

    const answer: {
      statusCode: number;
      body: string;
      headers: Dictionary<string>;
    } = await send({
      port: port,
      path: `/missing/${encodeURIComponent(TOKEN)}/page?api_key=${encodeURIComponent(API_KEY)}`,
      headers: {},
    });

    expect(answer.statusCode).toBe(404);

    await MonitorResourceUtil.monitorResource(
      {
        projectId: monitor.projectId!,
        monitorId: monitor.id!,
        monitorStepId: step.id,
        probeId: SENDER,
        isOnline: false,
        responseCode: 404,
        responseBody: answer.body,
        responseHeaders: answer.headers,
        failureCause: "Response status code is 404.",
        monitoredAt: OneUptimeDate.getCurrentDate(),
      },
      { reportingProbeId: SENDER },
    );

    expect(formsLeftIn(everythingWritten(), [TOKEN, API_KEY])).toEqual([]);
    expect((judged[0] as ProbeMonitorResponse).responseBody).toBe(
      `<html><body><h1>404</h1><p>No page at /missing/${HIDDEN_SECRET_MARKER}/page?api_key=${HIDDEN_SECRET_MARKER}</p></body></html>`,
    );
  });

  /*
   * The Error criteria reads a script's error as the summary shows it and
   * the root cause quotes it: the secret's value hidden. A criteria written
   * against the text around the value - what failed, the host, the path,
   * the parameter's name - is met as before, and [REDACTED] stands where a
   * value was hidden. One whose own value holds the secret's value no
   * longer finds it in the error. That value is the monitor's
   * configuration, which the check's reading never changes: a criteria is
   * shown to everyone who can read the monitor, and a root cause quotes it
   * as written, so a secret's value is no thing to write in one.
   */
  test.each([
    [
      "contains what failed",
      FilterType.Contains,
      "ERR_NAME_NOT_RESOLVED",
      true,
    ],
    [
      "contains the host and the parameter",
      FilterType.Contains,
      "app.example.invalid/login?token=",
      true,
    ],
    [
      "contains the marker where the value was",
      FilterType.Contains,
      HIDDEN_SECRET_MARKER,
      true,
    ],
    [
      "starts with the call that failed",
      FilterType.StartsWith,
      "page.goto:",
      true,
    ],
    ["contains the secret's value itself", FilterType.Contains, TOKEN, false],
    [
      "does not contain the secret's value itself",
      FilterType.NotContains,
      TOKEN,
      true,
    ],
    ["is not empty", FilterType.IsNotEmpty, undefined, true],
  ])(
    "the Error criteria on a script error that held a secret: %s",
    async (
      _name: string,
      filterType: FilterType,
      value: string | undefined,
      isMet: boolean,
    ) => {
      const step: MonitorStep = new MonitorStep();
      step.setCustomCode(
        "await page.goto('https://app.example.invalid/login?token={{monitorSecrets.Token}}');",
      );
      step.data!.monitorCriteria = criteria({
        checkOn: CheckOn.Error,
        filterType: filterType,
        value: value,
      });

      const monitor: Monitor = makeMonitor(MonitorType.SyntheticMonitor, step);
      findMonitorMock.mockResolvedValue(monitor);
      getSecretsForMonitorsMock.mockResolvedValue(
        new Map<string, Array<MonitorSecret>>([
          [monitor.id!.toString(), [secret("Token", TOKEN)]],
        ]),
      );

      await MonitorResourceUtil.monitorResource(
        {
          projectId: monitor.projectId!,
          monitorId: monitor.id!,
          monitorStepId: step.id,
          probeId: SENDER,
          isOnline: false,
          failureCause: "",
          monitoredAt: OneUptimeDate.getCurrentDate(),
          syntheticMonitorResponse: [
            {
              result: undefined,
              scriptError: `page.goto: net::ERR_NAME_NOT_RESOLVED at https://app.example.invalid/login?token=${TOKEN}`,
              logMessages: [],
              capturedMetrics: [],
              executionTimeInMS: 900,
              browserType: BrowserType.Chromium,
              screenSizeType: ScreenSizeType.Desktop,
            },
          ],
        },
        { reportingProbeId: SENDER },
      );

      expect(criteriaMet).toHaveLength(1);
      expect(Boolean(criteriaMet[0])).toBe(isMet);
      expect(rootCauses).toHaveLength(isMet ? 1 : 0);

      // What the check said is quoted with the value hidden.
      for (const rootCause of rootCauses) {
        // As its reader reads it: the Markdown's backslash escapes gone.
        const read: string = rootCause.replace(/\\([!-/:-@[-`{-~])/g, "$1");

        expect(read).toContain(
          `app.example.invalid/login?token=${HIDDEN_SECRET_MARKER}`,
        );
        expect(read).not.toContain(`token=${TOKEN}`);
      }

      // The criteria is quoted as it was written: its own value, if any.
      if (value !== TOKEN) {
        expect(formsLeftIn(rootCauses, [TOKEN])).toEqual([]);
      }

      // Its configuration is never read for the secrets.
      expect(
        step.data!.monitorCriteria.data!.monitorCriteriaInstanceArray[0]!.data!
          .filters[0]!.value,
      ).toBe(value);
    },
  );

  test("a monitor whose steps name no secret is read for none, and costs no query", async () => {
    const step: MonitorStep = new MonitorStep();
    step.setCustomCode("await page.goto('https://example.com');");

    const monitor: Monitor = makeMonitor(MonitorType.SyntheticMonitor, step);
    findMonitorMock.mockResolvedValue(monitor);

    const check: ProbeMonitorResponse = {
      projectId: monitor.projectId!,
      monitorId: monitor.id!,
      monitorStepId: step.id,
      probeId: SENDER,
      isOnline: true,
      failureCause: "",
      monitoredAt: OneUptimeDate.getCurrentDate(),
    };

    await MonitorResourceUtil.monitorResource(check, {
      reportingProbeId: SENDER,
    });

    expect(getSecretsForMonitorsMock).not.toHaveBeenCalled();
    expect(judged[0]).toBe(check);
  });
});
