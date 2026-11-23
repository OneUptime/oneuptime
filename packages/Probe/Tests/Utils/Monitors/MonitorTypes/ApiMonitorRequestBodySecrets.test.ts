// Set required env vars before importing anything that pulls Config.ts.
process.env["ONEUPTIME_URL"] = "https://oneuptime.com";
process.env["PROBE_KEY"] = "test-probe-key";
process.env["PROBE_ID"] = "11111111-2222-3333-4444-555555555555";

import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "@jest/globals";
import MonitorUtil from "../../../../Utils/Monitors/Monitor";
import ApiMonitor, {
  APIResponse,
} from "../../../../Utils/Monitors/MonitorTypes/ApiMonitor";
import WebsiteMonitor, {
  ProbeWebsiteResponse,
} from "../../../../Utils/Monitors/MonitorTypes/WebsiteMonitor";
import MonitorLogUrl from "../../../../Utils/Monitors/MonitorLogUrl";
import OnlineCheck from "../../../../Utils/OnlineCheck";
import DataSourceEgressGuard from "Common/Server/Utils/DataSource/EgressGuard";
import logger from "Common/Server/Utils/Logger";
import HTTPMethod from "Common/Types/API/HTTPMethod";
import URL from "Common/Types/API/URL";
import Dictionary from "Common/Types/Dictionary";
import { JSONObject } from "Common/Types/JSON";
import { CheckOn, FilterType } from "Common/Types/Monitor/CriteriaFilter";
import MonitorCriteriaInstance from "Common/Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import MonitorType from "Common/Types/Monitor/MonitorType";
import ObjectID from "Common/Types/ObjectID";
import PositiveNumber from "Common/Types/PositiveNumber";
import ProbeMonitorResponse from "Common/Types/Probe/ProbeMonitorResponse";
import Sleep from "Common/Types/Sleep";
import MonitorRequestBody from "Common/Utils/Monitor/MonitorRequestBody";
import TotpCodeIssuer from "Common/Utils/Monitor/MonitorSecretTotp";
import {
  ProbeFailureCause,
  writeProbeFailureCause,
} from "Common/Utils/Monitor/ProbeFailureCauses";
import {
  TotpAlgorithm,
  TotpParameters,
} from "Common/Utils/Totp/TotpParameters";
import { generateTotpCode } from "Common/Utils/Totp/TotpSecret";
import { SeededRandom, seededRandom } from "Common/Tests/Helpers/SeededRandom";
import * as http from "http";
import { AddressInfo, Socket } from "net";

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    EXTERNAL_FAULT: { "error.class": "user-error" },
    default: {
      debug: jest.fn(),
      error: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
    },
  };
});

/*
 * A MONITOR SECRET WHOSE VALUE HOLDS A QUOTE REACHES THE API EXACTLY
 * (#10735).
 *
 * The server filled {{monitorSecrets.NAME}} into an API monitor's body as
 * plain text, so a password ab"c in {"password": "{{monitorSecrets.P}}"}
 * went to the probe as {"password": "ab"c"}: no JSON, and since #9737 the
 * check fails at once, "The request body is not valid JSON, so the request
 * was not sent." It now fills a secret inside a JSON string escaped for that
 * string (MonitorRequestBody.fillSecrets), and one on its own as it is.
 *
 * Each step here is the one the server hands the probe: its body filled by
 * that same function. A real HTTP server on this machine receives every
 * request, so what is checked is the bytes that arrive, and what the API
 * reads from them. The probe's step (MonitorUtil.probeMonitorStep) is what
 * both a monitor's check and a Test Monitor run go through.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();
const MONITOR_ID: ObjectID = ObjectID.generate();

// In every secret, so a log line or a message that holds one is found.
const MARK: string = "hunter2";

const SECRETS: ReadonlyMap<string, string> = new Map([
  ["Password", `p"a\\ss\nwörd ${MARK} 😀`],
  ["Quote", `say "${MARK}"`],
  ["Backslash", `C:\\${MARK}\\`],
  ["Newline", `${MARK}\r\nline two\tend`],
  ["Unicode", `café 日本 Привет ${MARK} 😀`],
  ["Ids", "1,2,3"],
  ["Count", "42"],
  // A JSON string of its own: a secret on its own is written as it is.
  ["Literal", `"ab\\"c\\n日本 ${MARK}"`],
]);

// What the server does before it hands the probe the step.
function asTheServerFillsIt(body: string): string {
  return MonitorRequestBody.fillSecrets(body, SECRETS);
}

function secret(name: string): string {
  return SECRETS.get(name) as string;
}

const REQUEST_BODY_NOT_JSON: string = writeProbeFailureCause(
  ProbeFailureCause.RequestBodyNotJson,
);

interface ReceivedRequest {
  method: string;
  path: string;
  headers: http.IncomingHttpHeaders;
  body: Buffer;
}

let server: http.Server;
let serverUrl: string;
let received: Array<ReceivedRequest> = [];
const sockets: Set<Socket> = new Set();

beforeAll(async () => {
  server = http.createServer(
    (request: http.IncomingMessage, response: http.ServerResponse): void => {
      const chunks: Array<Buffer> = [];

      request.on("data", (chunk: Buffer) => {
        chunks.push(chunk);
      });

      request.on("end", () => {
        received.push({
          method: request.method || "",
          path: request.url || "",
          headers: request.headers,
          body: Buffer.concat(chunks),
        });

        // A request that fails before any answer: the socket is dropped.
        if ((request.url || "").startsWith("/drop")) {
          request.socket.destroy();
          return;
        }

        if (request.url === "/moved-307") {
          response.writeHead(307, { Location: "/echo" });
          response.end();
          return;
        }

        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ ok: true }));
      });
    },
  );

  server.on("connection", (socket: Socket) => {
    sockets.add(socket);
    socket.on("close", () => {
      sockets.delete(socket);
    });
  });

  await new Promise<void>((resolve: () => void) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  const address: AddressInfo = server.address() as AddressInfo;
  serverUrl = `http://127.0.0.1:${address.port}`;
});

beforeEach(() => {
  received = [];

  // Real request preparation and sockets; only this server is let through.
  jest
    .spyOn(DataSourceEgressGuard, "assertUrlAllowed")
    .mockImplementation(async (rawUrl: string) => {
      const url: globalThis.URL = new globalThis.URL(rawUrl);

      if (url.origin !== serverUrl) {
        throw new Error("Unexpected request outside the secrets fixture");
      }

      return { url, addresses: [{ address: "127.0.0.1", family: 4 }] };
    });
  jest.spyOn(Sleep, "sleep").mockResolvedValue(undefined);
  jest
    .spyOn(OnlineCheck, "canProbeMonitorWebsiteMonitors")
    .mockResolvedValue(true);
});

afterEach(() => {
  server.closeAllConnections();
  jest.restoreAllMocks();

  for (const method of [logger.error, logger.debug, logger.info, logger.warn]) {
    (method as jest.Mock).mockClear();
  }
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve: () => void) => {
    server.close(() => {
      resolve();
    });
  });
});

// An API step as the server hands it to the probe: JSON, read by fromJSON.
function apiStep(data: {
  body: string;
  headers?: Dictionary<string> | undefined;
  path?: string | undefined;
}): MonitorStep {
  const criteria: MonitorCriteriaInstance =
    new MonitorCriteriaInstance().setFilters([
      {
        checkOn: CheckOn.IsOnline,
        filterType: FilterType.True,
        value: undefined,
      },
    ]);
  const value: JSONObject = {
    id: ObjectID.generate().toString(),
    monitorDestination: {
      _type: "URL",
      value: `${serverUrl}${data.path || "/echo"}`,
    },
    requestType: HTTPMethod.POST,
    retryCount: 0,
    requestBody: data.body,
    monitorCriteria: {
      _type: "MonitorCriteria",
      value: { monitorCriteriaInstanceArray: [criteria.toJSON()] },
    },
  };

  if (data.headers) {
    value["requestHeaders"] = data.headers;
  }

  return MonitorStep.fromJSON({ _type: "MonitorStep", value });
}

async function probeStep(step: MonitorStep): Promise<ProbeMonitorResponse> {
  const response: ProbeMonitorResponse | null =
    await MonitorUtil.probeMonitorStep({
      monitorStep: step,
      monitorType: MonitorType.API,
      monitorId: MONITOR_ID,
      projectId: PROJECT_ID,
    });

  expect(response).not.toBeNull();

  return response!;
}

// The one request the server received, and only one.
function onlyRequest(): ReceivedRequest {
  expect(received).toHaveLength(1);

  return received[0]!;
}

// What arrived: exactly these bytes, with a length to match.
function expectSent(request: ReceivedRequest, body: string): void {
  expect(request.body.toString("utf8")).toBe(body);
  expect(request.headers["content-length"]).toBe(
    String(Buffer.byteLength(body, "utf8")),
  );
}

// What the API reads from the bytes it received.
function readByTheApi(request: ReceivedRequest): unknown {
  return JSON.parse(request.body.toString("utf8"));
}

// Everything the logger was handed, as text.
function everythingLogged(): string {
  return [logger.error, logger.debug, logger.info, logger.warn]
    .map((method: unknown) => {
      return JSON.stringify((method as jest.Mock).mock.calls);
    })
    .join("\n");
}

describe("a secret inside a string of a JSON body reaches the API exactly", () => {
  it("the issue's monitor: a password holding a quote, a backslash, a line break and unicode", async () => {
    const written: string =
      '{"username": "ops", "password": "{{monitorSecrets.Password}}"}';

    const response: ProbeMonitorResponse = await probeStep(
      apiStep({ body: asTheServerFillsIt(written) }),
    );

    expect(response.isOnline).toBe(true);
    expect(response.responseCode).toBe(200);
    expect(response.failureCause).toBe("");

    const request: ReceivedRequest = onlyRequest();

    expectSent(
      request,
      `{"username": "ops", "password": ${JSON.stringify(secret("Password"))}}`,
    );
    expect(readByTheApi(request)).toEqual({
      username: "ops",
      password: secret("Password"),
    });
  });

  it.each(["Quote", "Backslash", "Newline", "Unicode"])(
    "a secret holding %s",
    async (name: string) => {
      const written: string = `[{"value": "{{monitorSecrets.${name}}}"}, 2]`;

      const response: ProbeMonitorResponse = await probeStep(
        apiStep({ body: asTheServerFillsIt(written) }),
      );

      expect(response.isOnline).toBe(true);
      expect(readByTheApi(onlyRequest())).toEqual([{ value: secret(name) }, 2]);
    },
  );

  it("several in one string, and a key, each whole", async () => {
    const written: string =
      '{"{{monitorSecrets.Quote}}": "{{monitorSecrets.Backslash}}|{{monitorSecrets.Newline}}"}';

    await probeStep(apiStep({ body: asTheServerFillsIt(written) }));

    expect(readByTheApi(onlyRequest())).toEqual({
      [secret("Quote")]: `${secret("Backslash")}|${secret("Newline")}`,
    });
  });

  it("in a JSON5 body, sent as the JSON it stands for", async () => {
    const written: string =
      "{user: 'ops', password: '{{monitorSecrets.Password}}', /* \" */ note: \"{{monitorSecrets.Quote}}\",}";

    await probeStep(apiStep({ body: asTheServerFillsIt(written) }));

    expect(readByTheApi(onlyRequest())).toEqual({
      user: "ops",
      password: secret("Password"),
      note: secret("Quote"),
    });
  });

  it("sends the same bytes again after a 307 redirect", async () => {
    const body: string = asTheServerFillsIt(
      '{"password": "{{monitorSecrets.Password}}"}',
    );

    const response: ProbeMonitorResponse = await probeStep(
      apiStep({ body, path: "/moved-307" }),
    );

    expect(response.isOnline).toBe(true);
    expect(received).toHaveLength(2);

    for (const request of received) {
      expectSent(request, body);
      expect(readByTheApi(request)).toEqual({ password: secret("Password") });
    }
  });

  it("written as it is, as the server wrote it before, the same body is never sent", async () => {
    // What main's server made of the issue's body: the value as it is.
    const asItWas: string = `{"password": "${secret("Password")}"}`;

    const response: ProbeMonitorResponse = await probeStep(
      apiStep({ body: asItWas }),
    );

    expect(response.isOnline).toBe(false);
    expect(response.failureCause).toBe(REQUEST_BODY_NOT_JSON);
    expect(received).toHaveLength(0);
  });

  it("any secret, drawn, in a string of any body", async () => {
    const random: SeededRandom = seededRandom(10735);
    const pieces: ReadonlyArray<string> = [
      "a",
      '"',
      "'",
      "\\",
      "\n",
      "\t",
      "\u0001",
      "é",
      "日本",
      "😀",
      "{}",
      "$&",
    ];

    for (let draw: number = 0; draw < 25; draw++) {
      received = [];

      let value: string = "";

      for (let piece: number = random(10); piece > 0; piece--) {
        value += pieces[random(pieces.length)];
      }

      const body: string = MonitorRequestBody.fillSecrets(
        '[{"drawn": "{{monitorSecrets.Drawn}}", "n": {{monitorSecrets.N}}}]',
        new Map([
          ["Drawn", value],
          ["N", String(draw)],
        ]),
      );

      const response: ProbeMonitorResponse = await probeStep(apiStep({ body }));

      expect({ draw, isOnline: response.isOnline }).toEqual({
        draw,
        isOnline: true,
      });
      expect({ draw, read: readByTheApi(onlyRequest()) }).toEqual({
        draw,
        read: [{ drawn: value, n: draw }],
      });
    }
  });
});

describe("a secret on its own in a JSON body is sent as it is, as it always was", () => {
  it("a fragment, a number and a JSON string of its own", async () => {
    const written: string =
      '{"ids": [{{monitorSecrets.Ids}}], "count": {{monitorSecrets.Count}}, "name": {{monitorSecrets.Literal}}}';

    const response: ProbeMonitorResponse = await probeStep(
      apiStep({ body: asTheServerFillsIt(written) }),
    );

    expect(response.isOnline).toBe(true);

    const request: ReceivedRequest = onlyRequest();

    expectSent(
      request,
      `{"ids": [1,2,3], "count": 42, "name": ${secret("Literal")}}`,
    );
    expect(readByTheApi(request)).toEqual({
      ids: [1, 2, 3],
      count: 42,
      name: `ab"c\n日本 ${MARK}`,
    });
  });

  it("beside a secret inside a string, in an array body", async () => {
    const written: string =
      '[{{monitorSecrets.Count}}, "{{monitorSecrets.Quote}}", [{{monitorSecrets.Ids}}]]';

    await probeStep(apiStep({ body: asTheServerFillsIt(written) }));

    expect(readByTheApi(onlyRequest())).toEqual([
      42,
      secret("Quote"),
      [1, 2, 3],
    ]);
  });

  it("one whose value is no JSON there fails the check, sends nothing, and never says the value", async () => {
    const response: ProbeMonitorResponse = await probeStep(
      apiStep({
        body: asTheServerFillsIt('{"word": {{monitorSecrets.Quote}}}'),
      }),
    );

    expect(response.isOnline).toBe(false);
    expect(response.failureCause).toBe(REQUEST_BODY_NOT_JSON);
    expect(received).toHaveLength(0);
    expect(JSON.stringify(response)).not.toContain(MARK);
    expect(everythingLogged()).not.toContain(MARK);
  });
});

describe("one-time codes, filled by the probe as each attempt is sent", () => {
  const LOGIN: TotpParameters = {
    secret: "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ",
    algorithm: TotpAlgorithm.SHA1,
    digits: 6,
    periodInSeconds: 30,
  };

  /*
   * The middle of a period whose code starts with no zero, so it is a
   * number on its own too, and is not about to expire.
   */
  function momentWithCode(): { nowInMs: number; code: string } {
    for (let period: number = 37037036; ; period++) {
      const nowInMs: number = period * 30_000 + 10_000;
      const code: string = generateTotpCode(LOGIN, nowInMs);

      if (!code.startsWith("0")) {
        return { nowInMs, code };
      }
    }
  }

  it("a code in a string and on its own, beside a secret holding a quote", async () => {
    const { nowInMs, code } = momentWithCode();
    const body: string = asTheServerFillsIt(
      '{"otp": "{{monitorSecrets.LoginCode}}", "otpNumber": {{monitorSecrets.LoginCode}}, "password": "{{monitorSecrets.Password}}"}',
    );

    // The server leaves a one-time code's reference for the probe.
    expect(body).toContain('"otp": "{{monitorSecrets.LoginCode}}"');

    const response: APIResponse | null = await ApiMonitor.ping(
      URL.fromString(`${serverUrl}/echo`),
      {
        requestType: HTTPMethod.POST,
        requestBody: body,
        retry: 0,
        timeout: new PositiveNumber(30000),
        monitorId: MONITOR_ID,
        totpCodes: new TotpCodeIssuer({
          secrets: { LoginCode: LOGIN },
          now: (): number => {
            return nowInMs;
          },
        }),
      },
    );

    expect(response?.isOnline).toBe(true);

    const request: ReceivedRequest = onlyRequest();

    expectSent(
      request,
      `{"otp": "${code}", "otpNumber": ${code}, "password": ${JSON.stringify(secret("Password"))}}`,
    );
    expect(readByTheApi(request)).toEqual({
      otp: code,
      otpNumber: Number(code),
      password: secret("Password"),
    });
  });
});

describe("a secret's value never reaches a log or an error message", () => {
  it("not when the request fails, with secrets in its body and its headers", async () => {
    const response: ProbeMonitorResponse = await probeStep(
      apiStep({
        body: asTheServerFillsIt(
          '{"password": "{{monitorSecrets.Password}}", "unicode": "{{monitorSecrets.Unicode}}"}',
        ),
        headers: {
          "X-Tenant": secret("Unicode").replace(/[^\x20-\x7e]/g, "-"),
          Authorization: `Bearer ${MARK}-token`,
        },
        path: "/drop",
      }),
    );

    // The request went out, and nothing answered it.
    expect(received).toHaveLength(1);
    expect(response.isOnline).toBe(false);
    expect(logger.error).toHaveBeenCalled();

    expect(everythingLogged()).not.toContain(MARK);
    expect(JSON.stringify(response)).not.toContain(MARK);
  });

  it("not when the request fails, with a secret in its URL's path and query (#10782)", async () => {
    const response: APIResponse | null = await ApiMonitor.ping(
      URL.fromString(`${serverUrl}/drop/${MARK}?key=${MARK}-key`),
      {
        requestType: HTTPMethod.GET,
        retry: 0,
        timeout: new PositiveNumber(30000),
        monitorId: MONITOR_ID,
      },
    );

    expect(received).toHaveLength(1);
    expect(response?.isOnline).toBe(false);
    expect(logger.error).toHaveBeenCalled();

    const logged: string = everythingLogged();

    expect(logged).not.toContain(MARK);
    // Each line still says which monitor, and where it was sent.
    expect(logged).toContain(MONITOR_ID.toString());
    expect(logged).toContain(serverUrl);
  });

  it("not when a Website monitor's request fails, with a secret in its URL", async () => {
    const response: ProbeWebsiteResponse | null = await WebsiteMonitor.ping(
      URL.fromString(`${serverUrl}/drop/${MARK}?token=${MARK}`),
      {
        retry: 0,
        timeout: new PositiveNumber(30000),
        monitorId: MONITOR_ID,
      },
    );

    expect(received).toHaveLength(1);
    expect(response?.isOnline).toBe(false);
    expect(logger.error).toHaveBeenCalled();
    expect(everythingLogged()).not.toContain(MARK);
  });

  it("not when a header cannot carry a line break the value holds", async () => {
    const response: ProbeMonitorResponse = await probeStep(
      apiStep({
        body: '{"a": 1}',
        headers: { "X-Note": secret("Newline") },
      }),
    );

    // The HTTP client takes out what a header cannot carry; nothing is injected.
    expect(response.isOnline).toBe(true);
    expect(onlyRequest().headers["x-note"]).not.toMatch(/[\r\n]/);
    expect(everythingLogged()).not.toContain(MARK);
    expect(JSON.stringify(response)).not.toContain(MARK);
  });

  it("not when the body is no JSON once filled in", async () => {
    const response: ProbeMonitorResponse = await probeStep(
      apiStep({
        body: asTheServerFillsIt(
          '{"a": {{monitorSecrets.Password}}, "b": "{{monitorSecrets.Quote}}"}',
        ),
      }),
    );

    expect(response.failureCause).toBe(REQUEST_BODY_NOT_JSON);
    expect(everythingLogged()).not.toContain(MARK);
    expect(JSON.stringify(response)).not.toContain(MARK);
  });
});

describe("a URL as a log line writes it (#10782)", () => {
  it("is its scheme, host and port alone", () => {
    expect(
      MonitorLogUrl.write(
        URL.fromString(
          "https://api.example.com:8443/v1/tenant-hunter2/health?key=hunter2#top",
        ),
      ),
    ).toBe("https://api.example.com:8443");
    expect(MonitorLogUrl.write("http://user:hunter2@example.com/a?b=c")).toBe(
      "http://example.com",
    );
    expect(MonitorLogUrl.write("https://example.com")).toBe(
      "https://example.com",
    );
  });

  it("never the text itself when it is no URL", () => {
    for (const text of ["hunter2", "", undefined, null, "not a url hunter2"]) {
      expect(MonitorLogUrl.write(text)).toBe("(an address that is not a URL)");
    }
  });
});
