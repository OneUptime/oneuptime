// Set required env vars before importing anything that pulls Config.ts.
process.env["ONEUPTIME_URL"] = "http://oneuptime-ingest.test";
process.env["PROBE_KEY"] = "test-probe-key";
process.env["PROBE_ID"] = "11111111-2222-3333-4444-555555555555";

import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";

interface CapturedCronJob {
  jobName: string;
  runFunction: PromiseVoidFunction;
}

const mockCapturedCronJobs: Array<CapturedCronJob> = [];

// The jobs' run functions, driven here as production runs them.
jest.mock("Common/Server/Utils/BasicCron", () => {
  return {
    __esModule: true,
    default: (props: CapturedCronJob): void => {
      mockCapturedCronJobs.push(props);
    },
  };
});

import {
  FetchListAndProbe,
  resetProbeWorkerRunState,
  whenMonitorChecksSettle,
} from "../../../Jobs/Monitor/FetchList";
import InitMonitorTestJob from "../../../Jobs/Monitor/FetchMonitorTest";
import OnlineCheck from "../../../Utils/OnlineCheck";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import MonitorTest from "Common/Models/DatabaseModels/MonitorTest";
import DataSourceEgressGuard from "Common/Server/Utils/DataSource/EgressGuard";
import OneUptimeTelemetry from "Common/Server/Utils/Telemetry";
import logger from "Common/Server/Utils/Logger";
import MonitorSecretValueRedaction, {
  HIDDEN_SECRET_MARKER,
  HiddenSecretValues,
} from "Common/Server/Utils/Monitor/MonitorSecretValueRedaction";
import VMRunner from "Common/Server/Utils/VM/VMRunner";
import ConfigLogLevel from "Common/Server/Types/ConfigLogLevel";
import HTTPMethod from "Common/Types/API/HTTPMethod";
import URL from "Common/Types/API/URL";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import { CheckOn, FilterType } from "Common/Types/Monitor/CriteriaFilter";
import MonitorCriteriaInstance from "Common/Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import MonitorSteps from "Common/Types/Monitor/MonitorSteps";
import MonitorType from "Common/Types/Monitor/MonitorType";
import SqlDatabaseType from "Common/Types/Monitor/SqlDatabaseType";
import BrowserType from "Common/Types/Monitor/SyntheticMonitors/BrowserType";
import ObjectID from "Common/Types/ObjectID";
import ProbeMonitorResponse from "Common/Types/Probe/ProbeMonitorResponse";
import ScreenSizeType from "Common/Types/ScreenSizeType";
import Sleep from "Common/Types/Sleep";
import API from "Common/Utils/API";
import APIException from "Common/Types/Exception/ApiException";
import { SeededRandom, seededRandom } from "Common/Tests/Helpers/SeededRandom";
import { secretValueFormsIn } from "Common/Tests/Helpers/SecretValueForms";
import escapeRegExp from "Common/Utils/RegExpEscape";
import SyntheticMonitor from "../../../Utils/Monitors/MonitorTypes/SyntheticMonitor";
import ProxyConfig from "../../../Utils/ProxyConfig";
import FakeInternet from "./SyntheticRuntime/Fixtures/FakeInternet";
import http from "http";
import net, { AddressInfo, Socket } from "net";
import { chromium } from "playwright";
import { inspect } from "util";

/*
 * NO PROBE LOG LINE WRITES A MONITOR SECRET'S VALUE, AT ANY LEVEL (#10875).
 *
 * The server fills a monitor's Text secrets into its steps before it hands
 * them to the probe, and a check can say a value back: a server that
 * echoes the request, Playwright quoting the URL a page failed to load, a
 * script logging what it holds, a database naming the database it was
 * asked for. At LOG_LEVEL=DEBUG the probe writes every step's whole result
 * to its own log, and on a global probe that log is OneUptime's.
 *
 * These run real checks through the probe's own jobs - the monitor list
 * and the monitor test list as the server sends them, values to hide beside
 * each step (MonitorStep.secretValuesToHide) - against real servers on this
 * machine: an HTTP server that echoes the query, headers and body back in
 * every encoding a server writes them in, one that drops the connection, a
 * Postgres that names the database it refuses, a host that does not
 * resolve, a page Chromium cannot load, and a OneUptime that cannot take
 * the report. Each checks every line the probe logs, at every level, in
 * all three places a line goes - stdout, the recent-log buffer and the
 * OpenTelemetry exporter - for every form of each value, by plain search
 * (SecretValueForms) and by the redaction's own reading; and that the check
 * still worked: the real value went out, and the result was reported.
 *
 * A Synthetic check's every request goes through its own egress proxy, which
 * refuses loopback (GHSA-9rx7-vwfj-whp7). So the page Chromium cannot load
 * is on a made-up public address that FakeInternet, standing in for the
 * probe's outbound proxy, answers from a server on this machine; and a host
 * that does not resolve is looked up by that egress proxy, not by Chromium.
 */

jest.setTimeout(600_000);

const PROJECT_ID: ObjectID = new ObjectID(
  "eeeeeeee-0000-4000-8000-00000000000e",
);

// A value of the alphabet a header can carry: quotes, spaces, symbols.
function makeToken(random: SeededRandom): string {
  const alphabet: string = "abcXYZ019-_.~!$'()*+,;=:@/&<> \"\\%";
  let token: string = "Tk";

  for (let index: number = 0; index < 18; index++) {
    token += alphabet.charAt(random(alphabet.length));
  }

  return `${token}Z`;
}

// A value of any alphabet: unicode too, for a body, a query or a script.
function makePassword(random: SeededRandom): string {
  const alphabet: string = "abcXYZ019-_.~!$'()*+,;=:@/&<> \"\\é日ß😀";
  let password: string = "Pw";

  for (let index: number = 0; index < 16; index++) {
    password += Array.from(alphabet)[random(Array.from(alphabet).length)];
  }

  return `${password}Q`;
}

function htmlEscape(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// JSON as Python's json.dumps writes it: every non-ASCII character escaped.
function asciiJson(text: string): string {
  return JSON.stringify(text).replace(/[\u007f-￿]/g, (unit: string) => {
    return `\\u${unit.charCodeAt(0).toString(16).padStart(4, "0")}`;
  });
}

// What the logger was handed, as each place it writes to has it.
interface EmittedRecord {
  body: string;
  attributes?: Record<string, unknown> | undefined;
}

type LogMethod = "info" | "error" | "warn" | "debug" | "trace";

const LEVELS: Array<LogMethod> = ["info", "error", "warn", "debug", "trace"];

const emitted: Array<EmittedRecord> = [];
const consoleCalls: Array<{ level: LogMethod; args: Array<unknown> }> = [];
let recentLogsBefore: number = 0;

// Every line written since the test began, as each place has it.
function everythingWritten(): string {
  const parts: Array<string> = [];

  for (const call of consoleCalls) {
    parts.push(
      call.args
        .map((argument: unknown): string => {
          return typeof argument === "string"
            ? argument
            : inspect(argument, { depth: null });
        })
        .join(" "),
    );
  }

  for (const entry of logger.getRecentLogs().slice(recentLogsBefore)) {
    parts.push(entry.message);
  }

  for (const record of emitted) {
    parts.push(record.body);
    parts.push(JSON.stringify(record.attributes || {}));
  }

  return parts.join("\n");
}

function compiled(values: Array<string>): HiddenSecretValues {
  const read: HiddenSecretValues | null =
    MonitorSecretValueRedaction.compile(values);

  expect(read).not.toBeNull();

  return read!;
}

// No form of any of these values in what was written, by either reading.
function expectNoValueWritten(values: Array<string>): void {
  const written: string = everythingWritten();

  for (const value of values) {
    expect(secretValueFormsIn(written, value)).toEqual([]);
    expect(
      MonitorSecretValueRedaction.holdsValue(written, compiled([value])),
    ).toBe(false);
  }
}

function criteria(): JSONObject {
  const instance: MonitorCriteriaInstance =
    new MonitorCriteriaInstance().setFilters([
      {
        checkOn: CheckOn.IsOnline,
        filterType: FilterType.True,
        value: undefined,
      },
    ]);

  return {
    _type: "MonitorCriteria",
    value: { monitorCriteriaInstanceArray: [instance.toJSON()] },
  };
}

// A step as the server hands it over: its values filled in, and beside it.
function step(
  value: JSONObject,
  secretValuesToHide: Array<string>,
): MonitorStep {
  return MonitorStep.fromJSON({
    _type: "MonitorStep",
    value: {
      id: ObjectID.generate().toString(),
      monitorCriteria: criteria(),
      retryCount: 0,
      ...value,
      ...(secretValuesToHide.length > 0
        ? { secretValuesToHide: secretValuesToHide }
        : {}),
    } as JSONObject,
  });
}

function stepsOf(items: Array<MonitorStep>): MonitorSteps {
  const steps: MonitorSteps = new MonitorSteps();
  steps.data = {
    monitorStepsInstanceArray: items,
    defaultMonitorStatusId: undefined,
  };
  return steps;
}

function monitorOf(
  monitorType: MonitorType,
  items: Array<MonitorStep>,
): Monitor {
  const monitor: Monitor = new Monitor(ObjectID.generate());
  monitor.projectId = PROJECT_ID;
  monitor.monitorType = monitorType;
  monitor.monitorSteps = stepsOf(items);
  return monitor;
}

// The servers on this machine.
let echoServer: http.Server;
let echoOrigin: string;
let droppingOrigin: string;
let droppingServer: http.Server;
let ingestServer: http.Server;
let ingestOrigin: string;
let postgresServer: net.Server;
let postgresPort: number;
const openSockets: Set<Socket> = new Set<Socket>();

// What the echo server was sent, and what OneUptime was reported.
let echoed: Array<{
  url: string;
  headers: http.IncomingHttpHeaders;
  body: string;
}> = [];
let reported: Array<ProbeMonitorResponse> = [];
let ingestDropsReports: boolean = false;

// What the server hands out when the probe asks, as JSON.
let monitorList: JSONArray = [];
let monitorTestList: JSONArray = [];

function track(server: http.Server | net.Server): void {
  server.on("connection", (socket: Socket) => {
    openSockets.add(socket);
    socket.on("close", () => {
      openSockets.delete(socket);
    });
  });
}

async function listen(server: http.Server | net.Server): Promise<number> {
  track(server);

  await new Promise<void>((resolve: () => void) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  return (server.address() as AddressInfo).port;
}

async function close(server: http.Server | net.Server): Promise<void> {
  await new Promise<void>((resolve: () => void) => {
    server.close(() => {
      resolve();
    });
  });
}

function readBody(request: http.IncomingMessage): Promise<string> {
  return new Promise<string>((resolve: (body: string) => void) => {
    const chunks: Array<Buffer> = [];
    request.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });
    request.on("end", () => {
      resolve(Buffer.concat(chunks).toString("utf8"));
    });
  });
}

/*
 * An API that says the request back in every way a server writes it: the
 * query as it parsed it, every header, the body as text and as JSON, the
 * query's value in an HTML page, escaped for JSON as Python writes it, and
 * a header in base64 - and a response header and a cookie of its own.
 */
async function answerEcho(
  request: http.IncomingMessage,
  response: http.ServerResponse,
): Promise<void> {
  const body: string = await readBody(request);
  const url: globalThis.URL = new globalThis.URL(
    request.url || "/",
    "http://127.0.0.1",
  );

  echoed.push({ url: request.url || "", headers: request.headers, body });

  const key: string = url.searchParams.get("key") || "";
  const token: string = String(request.headers["x-api-key"] || "");
  let json: unknown = null;

  try {
    json = JSON.parse(body);
  } catch {
    json = null;
  }

  const said: string = JSON.stringify({
    method: request.method,
    path: decodeURIComponent(url.pathname),
    args: Object.fromEntries(url.searchParams.entries()),
    headers: request.headers,
    data: body,
    json: json,
    html: `<p>Signed in as ${htmlEscape(key)}</p>`,
    tokenBase64: Buffer.from(token, "utf8").toString("base64"),
  });

  response.writeHead(200, {
    "Content-Type": "application/json",
    "X-Echoed-Key": token,
    "Set-Cookie": `session=${encodeURIComponent(key)}; Path=/`,
  });

  // Python's json.dumps: the query's value with every non-ASCII escaped.
  response.end(`${said.slice(0, -1)},"ascii":${asciiJson(key)}}`);
}

/*
 * A Postgres that refuses the database it is asked for, naming it, as a
 * real one does: FATAL 3D000, database "<name>" does not exist.
 */
function refuseDatabase(socket: Socket, databaseName: string): void {
  socket.once("data", () => {
    const fields: string = [
      "SFATAL",
      "VFATAL",
      "C3D000",
      `Mdatabase "${databaseName}" does not exist`,
    ]
      .map((field: string): string => {
        return `${field}\u0000`;
      })
      .join("");
    const payload: Buffer = Buffer.from(`${fields}\u0000`, "utf8");
    const message: Buffer = Buffer.alloc(5 + payload.length);

    message.write("E", 0, "ascii");
    message.writeInt32BE(4 + payload.length, 1);
    payload.copy(message, 5);
    socket.end(message);
  });
}

let refusedDatabaseName: string = "";

beforeAll(async () => {
  echoServer = http.createServer(
    (request: http.IncomingMessage, response: http.ServerResponse): void => {
      void answerEcho(request, response);
    },
  );
  echoOrigin = `http://127.0.0.1:${await listen(echoServer)}`;

  // Drops every connection before it answers.
  droppingServer = http.createServer((request: http.IncomingMessage) => {
    request.socket.destroy();
  });
  droppingOrigin = `http://127.0.0.1:${await listen(droppingServer)}`;

  // OneUptime's ingest: keeps each report, or drops the connection.
  ingestServer = http.createServer(
    (request: http.IncomingMessage, response: http.ServerResponse): void => {
      void (async (): Promise<void> => {
        if (ingestDropsReports) {
          request.socket.destroy();
          return;
        }

        const body: string = await readBody(request);
        const report: JSONObject = JSON.parse(body) as JSONObject;

        reported.push(
          report["probeMonitorResponse"] as unknown as ProbeMonitorResponse,
        );
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end("{}");
      })();
    },
  );
  ingestOrigin = `http://127.0.0.1:${await listen(ingestServer)}`;

  postgresServer = net.createServer((socket: Socket) => {
    refuseDatabase(socket, refusedDatabaseName);
  });
  postgresPort = await listen(postgresServer);
});

afterAll(async () => {
  for (const socket of Array.from(openSockets)) {
    socket.destroy();
  }

  await close(echoServer);
  await close(droppingServer);
  await close(ingestServer);
  await close(postgresServer);
});

beforeEach(() => {
  resetProbeWorkerRunState();
  mockCapturedCronJobs.length = 0;
  echoed = [];
  reported = [];
  ingestDropsReports = false;
  monitorList = [];
  monitorTestList = [];
  emitted.length = 0;
  consoleCalls.length = 0;
  recentLogsBefore = logger.getRecentLogs().length;

  // DEBUG: the level the issue is about, with every line on.
  jest.spyOn(logger, "getLogLevel").mockReturnValue(ConfigLogLevel.DEBUG);

  for (const level of LEVELS) {
    jest.spyOn(console, level).mockImplementation((...args: Array<unknown>) => {
      consoleCalls.push({ level, args });
    });
  }

  jest.spyOn(OneUptimeTelemetry, "getLogger").mockReturnValue({
    emit: (record: EmittedRecord): void => {
      emitted.push(record);
    },
  } as never);

  /*
   * The server's answers to the probe's fetches, and its ingest: the
   * reports go to the ingest server here. Every other request - each check
   * - goes out for real.
   */
  const realFetch: typeof API.fetch = API.fetch.bind(API);

  jest
    .spyOn(API, "fetch")
    .mockImplementation(async (options: Parameters<typeof API.fetch>[0]) => {
      const url: string = options.url.toString();

      if (url.startsWith("http://oneuptime-ingest.test")) {
        if (url.endsWith("/monitor/list")) {
          const list: JSONArray = monitorList;
          monitorList = [];
          return { statusCode: 200, data: list } as never;
        }

        if (url.endsWith("/monitor-test/list")) {
          const list: JSONArray = monitorTestList;
          monitorTestList = [];
          return { statusCode: 200, data: list } as never;
        }

        return await realFetch({
          ...options,
          url: URL.fromString(
            url.replace("http://oneuptime-ingest.test", ingestOrigin),
          ),
        } as never);
      }

      return await realFetch(options as never);
    });

  // This machine's servers are let through the egress guard.
  jest
    .spyOn(DataSourceEgressGuard, "assertUrlAllowed")
    .mockImplementation(async (rawUrl: string) => {
      return {
        url: new globalThis.URL(rawUrl),
        addresses: [{ address: "127.0.0.1", family: 4 }],
      } as never;
    });

  jest.spyOn(Sleep, "sleep").mockResolvedValue(undefined as never);
  jest
    .spyOn(OnlineCheck, "canProbeMonitorWebsiteMonitors")
    .mockResolvedValue(true);
  jest
    .spyOn(OnlineCheck, "canProbeMonitorPortMonitors")
    .mockResolvedValue(true);
  jest
    .spyOn(OnlineCheck, "canProbeMonitorPingMonitors")
    .mockResolvedValue(true);
});

afterEach(() => {
  jest.restoreAllMocks();
});

// The probe's monitor job, handed this monitor by the server, run to the end.
async function runMonitorJob(monitor: Monitor): Promise<void> {
  monitorList = BaseModel.toJSONArray([monitor], Monitor);
  await new FetchListAndProbe("Worker 1").run();
  await whenMonitorChecksSettle();
}

// The probe's monitor test job, handed this test by the server, run to the end.
async function runMonitorTestJob(monitorTest: MonitorTest): Promise<void> {
  monitorTestList = BaseModel.toJSONArray([monitorTest], MonitorTest);
  InitMonitorTestJob();
  const job: CapturedCronJob | undefined = mockCapturedCronJobs.find(
    (captured: CapturedCronJob): boolean => {
      return captured.jobName === "Probe:MonitorTest";
    },
  );

  expect(job).toBeDefined();
  await job!.runFunction();
}

// A made-up public address whose TLS port closes every connection it takes.
const CLOSING_SITE: string = "93.184.215.16";

/*
 * The Chromium the probe launches: its own lookup finds the Linux builds its
 * image installs; elsewhere - a developer's machine - Playwright's own.
 */
async function useChromium(): Promise<void> {
  const executablePath: string =
    await SyntheticMonitor.getChromeExecutablePath().catch((): string => {
      return chromium.executablePath();
    });

  jest
    .spyOn(SyntheticMonitor, "getChromeExecutablePath")
    .mockResolvedValue(executablePath);
}

// The probe's outbound proxy, which a check's egress proxy goes through.
function useOutboundProxy(fakeInternet: FakeInternet): void {
  jest.spyOn(ProxyConfig, "isProxyConfigured").mockReturnValue(true);
  jest
    .spyOn(ProxyConfig, "getHttpsProxyUrl")
    .mockReturnValue(fakeInternet.url());
  jest.spyOn(ProxyConfig, "getHttpProxyUrl").mockReturnValue(null);
}

// A Synthetic step whose script logs the token, then opens the target.
function syntheticStep(
  target: string,
  token: string,
  password: string,
): MonitorStep {
  return step(
    {
      customCode: [
        `const token = ${JSON.stringify(token)};`,
        `console.log("signing in with " + token);`,
        `await page.goto(${JSON.stringify(target)}, { timeout: 20000 });`,
      ].join("\n"),
      browserTypes: [BrowserType.Chromium],
      screenSizeTypes: [ScreenSizeType.Desktop],
      retryCountOnError: 0,
    },
    [token, password],
  );
}

// The one browser run the check reported.
function reportedRun(): JSONObject {
  expect(reported).toHaveLength(1);

  return (
    reported[0]!.syntheticMonitorResponse as unknown as Array<JSONObject>
  )[0]!;
}

// An API step that sends both values every way a request carries one.
function echoStep(token: string, password: string): MonitorStep {
  return step(
    {
      monitorDestination: {
        _type: "URL",
        value: `${echoOrigin}/accounts/${encodeURIComponent(token)}?key=${encodeURIComponent(password)}&user=ops`,
      },
      requestType: HTTPMethod.POST,
      requestHeaders: {
        "X-Api-Key": token,
        Authorization: `Basic ${Buffer.from(`ops:${password}`, "utf8").toString("base64")}`,
        "Content-Type": "application/json",
      },
      // As the server fills a secret into a JSON string: escaped for it.
      requestBody: JSON.stringify({ password: password, token: token }),
    },
    [token, password],
  );
}

describe("the probe's own log never writes a monitor secret's value, at debug level", () => {
  const random: SeededRandom = seededRandom(10875);

  test("an API check whose server echoes the query, headers and body: the check works, and the debug line keeps the response without any form of a value", async () => {
    for (let round: number = 0; round < 4; round++) {
      const token: string = makeToken(random);
      const password: string = makePassword(random);
      const monitor: Monitor = monitorOf(MonitorType.API, [
        echoStep(token, password),
      ]);

      echoed = [];
      reported = [];
      emitted.length = 0;
      consoleCalls.length = 0;
      recentLogsBefore = logger.getRecentLogs().length;

      await runMonitorJob(monitor);

      // The check went out with the real values...
      expect(echoed).toHaveLength(1);
      expect(echoed[0]!.headers["x-api-key"]).toBe(token);
      expect(
        Buffer.from(
          String(echoed[0]!.headers["authorization"]).slice("Basic ".length),
          "base64",
        ).toString("utf8"),
      ).toBe(`ops:${password}`);
      expect(
        new globalThis.URL(echoed[0]!.url, echoOrigin).searchParams.get("key"),
      ).toBe(password);
      expect(JSON.parse(echoed[0]!.body)).toEqual({ password, token });

      // ...and was reported as it was: the server hides the values there.
      expect(reported).toHaveLength(1);
      expect(reported[0]!.isOnline).toBe(true);
      expect(reported[0]!.responseCode).toBe(200);
      expect(reported[0]!.responseBody).toContain('"args"');

      // No line, at any level, holds any form of either value.
      expectNoValueWritten([token, password]);

      // The debug line is there, whole but for the values.
      const written: string = everythingWritten();
      expect(written).toContain("Probed monitor step:");
      expect(written).toContain(HIDDEN_SECRET_MARKER);
      expect(written).toContain("Signed in as");
      expect(written).toContain("x-echoed-key");
      expect(written).toContain(echoOrigin);
    }
  });

  test("an API check whose server drops the connection: the retries and the error keep no form of a value", async () => {
    const token: string = makeToken(random);
    const password: string = makePassword(random);
    const failing: MonitorStep = step(
      {
        monitorDestination: {
          _type: "URL",
          value: `${droppingOrigin}/${encodeURIComponent(password)}/health?key=${encodeURIComponent(token)}`,
        },
        requestType: HTTPMethod.GET,
        requestHeaders: { "X-Api-Key": token },
        retryCount: 2,
      },
      [token, password],
    );

    await runMonitorJob(monitorOf(MonitorType.API, [failing]));

    expect(reported).toHaveLength(1);
    expect(reported[0]!.isOnline).toBe(false);
    expect(reported[0]!.totalAttempts).toBe(3);
    expectNoValueWritten([token, password]);
    expect(everythingWritten()).toContain("socket hang up");
  });

  test("a Synthetic check, in real Playwright, whose page fails to load with the token in its URL and whose script logs it", async () => {
    const token: string = makeToken(random);
    const password: string = makePassword(random);
    const target: string = `https://${CLOSING_SITE}/login?user=ops&token=${encodeURIComponent(password)}`;
    const quotedTarget: RegExp = new RegExp(
      `net::ERR_[A-Z_]+ at https://${escapeRegExp(CLOSING_SITE)}/login`,
    );

    // The site's TLS port takes each connection and closes it: the load fails.
    const closingServer: net.Server = net.createServer(
      (socket: Socket): void => {
        socket.on("error", (): void => {
          // The tunnel went away first.
        });
        socket.destroy();
      },
    );
    const fakeInternet: FakeInternet = new FakeInternet();

    try {
      fakeInternet.route(CLOSING_SITE, 443, await listen(closingServer));
      await fakeInternet.start();
      useOutboundProxy(fakeInternet);
      await useChromium();

      await runMonitorJob(
        monitorOf(MonitorType.SyntheticMonitor, [
          syntheticStep(target, token, password),
        ]),
      );

      /*
       * The run was real: it reached the site, Playwright quoted the URL,
       * and the script logged.
       */
      expect(fakeInternet.connects).toContain(`${CLOSING_SITE}:443`);
      const run: JSONObject = reportedRun();
      expect(String(run["scriptError"])).toMatch(quotedTarget);
      expect(JSON.stringify(run["logMessages"])).toContain("signing in with");

      expectNoValueWritten([token, password]);
      const written: string = everythingWritten();
      expect(written).toContain("Synthetic Monitor script failed");
      expect(written).toMatch(quotedTarget);
      expect(written).toContain(`signing in with ${HIDDEN_SECRET_MARKER}`);
    } finally {
      await fakeInternet.stop();
      await close(closingServer);
    }
  });

  test("a Synthetic check, in real Playwright, whose page's host does not resolve: it is told the host could not be reached, as API and Website checks are", async () => {
    const token: string = makeToken(random);
    const password: string = makePassword(random);
    const host: string = "app.secret-echo.invalid";
    const target: string = `https://${host}/login?user=ops&token=${encodeURIComponent(password)}`;
    const unreachable: string = `Monitor target host ${host} could not be reached.`;

    await useChromium();

    await runMonitorJob(
      monitorOf(MonitorType.SyntheticMonitor, [
        syntheticStep(target, token, password),
      ]),
    );

    /*
     * The check's egress proxy looked the name up, not Chromium, and the
     * page is told no more than an API or Website check is: neither whether
     * the name resolved nor the URL, so no value in it is quoted at all.
     */
    const run: JSONObject = reportedRun();
    expect(String(run["scriptError"])).toBe(unreachable);
    expect(JSON.stringify(run["logMessages"])).toContain("signing in with");

    expectNoValueWritten([token, password]);
    const written: string = everythingWritten();
    expect(written).toContain("Synthetic Monitor script failed");
    expect(written).toContain(unreachable);
    expect(written).toContain(`signing in with ${HIDDEN_SECRET_MARKER}`);
  });

  test("a Custom JavaScript Code check whose script logs the value, returns it and fails quoting it - and one whose run throws with it", async () => {
    const token: string = makeToken(random);
    const password: string = makePassword(random);

    // The sandbox's answer: what the script did with the values it held.
    jest.spyOn(VMRunner, "runCodeInSandbox").mockResolvedValueOnce({
      returnValue: { data: { echoed: password, token: token } },
      logMessages: [`signing in with ${token}`, `as ${password}`],
      capturedMetrics: [],
      scriptError: new Error(
        `fetch failed for https://api.example.com/?key=${encodeURIComponent(password)}`,
      ),
    } as never);

    const script: MonitorStep = step(
      { customCode: `const token = ${JSON.stringify(token)}; // ...` },
      [token, password],
    );

    await runMonitorJob(monitorOf(MonitorType.CustomJavaScriptCode, [script]));

    expect(reported).toHaveLength(1);
    expect(
      String(reported[0]!.customCodeMonitorResponse?.scriptError),
    ).toContain("fetch failed");
    expectNoValueWritten([token, password]);
    expect(everythingWritten()).toContain(
      `signing in with ${HIDDEN_SECRET_MARKER}`,
    );

    /*
     * The run itself throws, quoting the script: the probe logs that error
     * whole, stack and all - every value in it hidden.
     */
    emitted.length = 0;
    consoleCalls.length = 0;
    recentLogsBefore = logger.getRecentLogs().length;

    jest
      .spyOn(VMRunner, "runCodeInSandbox")
      .mockRejectedValueOnce(
        new Error(`Unexpected identifier in: const label = ${token}`) as never,
      );

    await runMonitorJob(
      monitorOf(MonitorType.CustomJavaScriptCode, [
        step({ customCode: `const label = ${token}` }, [token]),
      ]),
    );

    expectNoValueWritten([token]);
    expect(everythingWritten()).toContain("Unexpected identifier in");
  });

  test("a SQL Query check against a Postgres that names the database and user it refuses: every line, the host and database included", async () => {
    const databaseName: string = `billing_${makeToken(random).replace(/[^A-Za-z0-9]/g, "")}`;
    const username: string = `ro_${makeToken(random).replace(/[^A-Za-z0-9]/g, "")}`;
    const password: string = makePassword(random);

    refusedDatabaseName = databaseName;

    const sql: MonitorStep = step(
      {
        sqlMonitor: {
          databaseType: SqlDatabaseType.PostgreSQL,
          host: "127.0.0.1",
          port: postgresPort,
          databaseName: databaseName,
          username: username,
          password: password,
          useWindowsIntegratedAuthentication: false,
          useSsl: false,
          rejectUnauthorizedSsl: true,
          query: "SELECT 1",
          connectionTimeoutInMs: 10000,
          statementTimeoutInMs: 15000,
          maxRows: 10,
        },
      },
      [databaseName, username, password],
    );

    await runMonitorJob(monitorOf(MonitorType.SQLQuery, [sql]));

    // Postgres refused it, naming the database: the check failed for that.
    expect(reported).toHaveLength(1);
    expect(reported[0]!.isOnline).toBe(false);
    expect(String(reported[0]!.failureCause)).toContain("does not exist");

    expectNoValueWritten([databaseName, username, password]);
    expect(everythingWritten()).toContain("SQL Query");
  });

  test("a Port check of a host that is itself a secret's value: no line names it", async () => {
    const host: string = `secret-host-${makeToken(random)
      .replace(/[^A-Za-z0-9]/g, "")
      .toLowerCase()}.invalid`;

    const port: MonitorStep = step(
      {
        monitorDestination: { _type: "Hostname", value: host },
        monitorDestinationPort: { _type: "Port", value: 443 },
        retryCount: 1,
      },
      [host],
    );

    await runMonitorJob(monitorOf(MonitorType.Port, [port]));

    expect(reported).toHaveLength(1);
    expect(reported[0]!.isOnline).toBe(false);
    expectNoValueWritten([host]);
    expect(everythingWritten()).toContain("Probed monitor step:");
  });

  test("a report that cannot reach OneUptime is logged without what it held: the check's response and the probe's key", async () => {
    const token: string = makeToken(random);
    const password: string = makePassword(random);

    ingestDropsReports = true;

    await runMonitorJob(
      monitorOf(MonitorType.API, [echoStep(token, password)]),
    );

    // The check ran; its report did not get through.
    expect(echoed).toHaveLength(1);
    expect(reported).toHaveLength(0);

    expectNoValueWritten([token, password]);
    const written: string = everythingWritten();
    expect(written).toContain("to OneUptime failed");
    expect(written).toContain("socket hang up");
    expect(written).not.toContain("test-probe-key");
  });

  test("the client's own error for such a report holds the report, which is why it is never what the probe logs", async () => {
    const token: string = makeToken(random);

    ingestDropsReports = true;

    let thrown: unknown = null;

    try {
      await API.fetch({
        method: HTTPMethod.POST,
        url: URL.fromString(
          `${ingestOrigin}/probe-ingest/probe/response/ingest`,
        ),
        data: { probeMonitorResponse: { responseBody: token } },
        headers: {},
      });
    } catch (err) {
      thrown = err;
    }

    expect(thrown).toBeInstanceOf(APIException);

    // The request it sent, report and all...
    const sent: string = String(
      (
        (thrown as APIException).error as unknown as {
          config?: { data?: unknown };
        }
      )?.config?.data,
    );
    expect(sent).toContain(JSON.stringify(token).slice(1, -1));

    // ...which the logger writes, outside a check, wherever the error goes.
    expect(
      secretValueFormsIn(logger.serializeLogBody(thrown), token).length,
    ).toBeGreaterThan(0);
  });

  test("a Test Monitor run through the probe's job: each step's debug line hides its own values, and the results are never logged whole", async () => {
    const token: string = makeToken(random);
    const password: string = makePassword(random);

    const monitorTest: MonitorTest = new MonitorTest(ObjectID.generate());
    monitorTest.projectId = PROJECT_ID;
    monitorTest.monitorType = MonitorType.API;
    monitorTest.monitorSteps = stepsOf([
      echoStep(token, password),
      step(
        {
          monitorDestination: {
            _type: "URL",
            value: `${echoOrigin}/second?key=${encodeURIComponent(password)}`,
          },
          requestType: HTTPMethod.GET,
        },
        [password],
      ),
    ]);

    await runMonitorTestJob(monitorTest);

    expect(echoed).toHaveLength(2);
    expect(reported).toHaveLength(2);
    expectNoValueWritten([token, password]);

    const written: string = everythingWritten();
    expect(written).toContain("Probed monitor test step:");
    expect(written).toContain(
      "Probed monitor test: 2 of 2 steps reported a result",
    );
    expect(written).toContain("Signed in as");
  });

  test("the control: handed no values (by a OneUptime from before), the same check's debug line holds the value, which is what every test above looks for", async () => {
    const token: string = makeToken(random);
    const echoing: MonitorStep = step(
      {
        monitorDestination: {
          _type: "URL",
          value: `${echoOrigin}/control?key=${encodeURIComponent(token)}`,
        },
        requestType: HTTPMethod.GET,
      },
      [],
    );

    await runMonitorJob(monitorOf(MonitorType.API, [echoing]));

    expect(reported).toHaveLength(1);
    expect(
      secretValueFormsIn(everythingWritten(), token).length,
    ).toBeGreaterThan(0);
  });
});
