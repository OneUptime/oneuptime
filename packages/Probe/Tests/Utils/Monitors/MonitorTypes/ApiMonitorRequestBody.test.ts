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
import OnlineCheck from "../../../../Utils/OnlineCheck";
import DataSourceEgressGuard from "Common/Server/Utils/DataSource/EgressGuard";
import logger, { EXTERNAL_FAULT } from "Common/Server/Utils/Logger";
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
 * AN API MONITOR SENDS ITS REQUEST BODY AS WRITTEN, WHATEVER JSON VALUE IT
 * IS (#9737).
 *
 * The probe read a body with JSONFunctions.parseJSONObject, so a body that
 * was an array - [{"id": 1}] - or a single value threw "Expected
 * JSONObject, but got JSONArray" and no request ever left the probe: the
 * check failed on every run, and a Test Monitor run never answered.
 *
 * A real HTTP server on this machine receives every request here, so what
 * is checked is the bytes that arrive - the body, its Content-Type and its
 * length - through ApiMonitor.ping and through the probe's step
 * (MonitorUtil.probeMonitorStep), not the types handed along the way.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();
const MONITOR_ID: ObjectID = ObjectID.generate();

const REQUEST_BODY_NOT_JSON: string = writeProbeFailureCause(
  ProbeFailureCause.RequestBodyNotJson,
);

// The Content-Type a request carries unless its headers name one.
const DEFAULT_CONTENT_TYPE: string = "application/json;charset=UTF-8";

const ARRAY_BODY: string = '[{"id": 1}, {"id": 2}]';

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

        if (request.url === "/moved-307") {
          response.writeHead(307, { Location: "/echo" });
          response.end();
          return;
        }

        if (request.url === "/moved-303") {
          response.writeHead(303, { Location: "/echo" });
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

  /*
   * Real request preparation, sockets and retries. Only this server is let
   * through the private-network guard.
   */
  jest
    .spyOn(DataSourceEgressGuard, "assertUrlAllowed")
    .mockImplementation(async (rawUrl: string) => {
      const url: globalThis.URL = new globalThis.URL(rawUrl);

      if (url.origin !== serverUrl) {
        throw new Error("Unexpected request outside the request body fixture");
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
  (logger.error as jest.Mock).mockClear();
});

afterAll(async () => {
  server.closeAllConnections();
  await new Promise<void>((resolve: () => void) => {
    server.close(() => {
      resolve();
    });
  });
});

async function ping(options: {
  body?: string | undefined;
  headers?: Dictionary<string> | undefined;
  path?: string | undefined;
  method?: HTTPMethod | undefined;
  retry?: number | undefined;
  totpCodes?: TotpCodeIssuer | undefined;
}): Promise<APIResponse> {
  const response: APIResponse | null = await ApiMonitor.ping(
    URL.fromString(`${serverUrl}${options.path || "/echo"}`),
    {
      requestType: options.method || HTTPMethod.POST,
      requestHeaders: options.headers,
      requestBody: options.body,
      retry: options.retry ?? 0,
      timeout: new PositiveNumber(30000),
      monitorId: MONITOR_ID,
      totpCodes: options.totpCodes,
    },
  );

  expect(response).not.toBeNull();

  return response!;
}

// The one request the server received, and only one.
function onlyRequest(): ReceivedRequest {
  expect(received).toHaveLength(1);

  return received[0]!;
}

// The server got exactly these bytes, as JSON, with a length to match.
function expectSent(request: ReceivedRequest, body: string): void {
  expect(request.body.toString("utf8")).toBe(body);
  expect(request.headers["content-length"]).toBe(
    String(Buffer.byteLength(body, "utf8")),
  );
}

describe("ApiMonitor.ping sends any JSON value as written", () => {
  it("sends an array, byte for byte, as JSON (the regression)", async () => {
    const response: APIResponse = await ping({ body: ARRAY_BODY });

    expect(response.isOnline).toBe(true);
    expect(response.statusCode).toBe(200);
    expect(response.failureCause).toBe("");
    expect(response.requestBody).toBe(ARRAY_BODY);

    const request: ReceivedRequest = onlyRequest();

    expect(request.method).toBe("POST");
    expectSent(request, ARRAY_BODY);
    expect(request.headers["content-type"]).toBe(DEFAULT_CONTENT_TYPE);
  });

  it.each([
    { name: "a string", body: '"hello"' },
    { name: "a number", body: "42" },
    { name: "zero", body: "0" },
    { name: "a fraction", body: "-1.50" },
    { name: "true", body: "true" },
    { name: "false", body: "false" },
    { name: "null", body: "null" },
    { name: "an empty array", body: "[]" },
    { name: "an empty string", body: '""' },
  ])(
    "sends $name as a single value",
    async ({ body }: { name: string; body: string }) => {
      const response: APIResponse = await ping({ body });

      expect(response.isOnline).toBe(true);
      expectSent(onlyRequest(), body);
    },
  );

  it("sends an object as written, its spacing and its key order kept", async () => {
    const body: string = '{\n  "z": 1,\n  "a": {"nested": [true, null]}\n}\n';

    const response: APIResponse = await ping({ body });

    expect(response.isOnline).toBe(true);
    expectSent(onlyRequest(), body);
  });

  it("never rounds a number or rewrites a character it was given", async () => {
    const body: string =
      '[12345678901234567890, 1.10, "caf\\u00e9", "日本", "😀"]';

    await ping({ body });

    expectSent(onlyRequest(), body);
  });

  it("sends no body when there is none", async () => {
    for (const body of [undefined, "", "   \n\t"]) {
      received = [];

      const response: APIResponse = await ping({ body });

      expect(response.isOnline).toBe(true);

      const request: ReceivedRequest = onlyRequest();

      expect(request.body.length).toBe(0);
    }
  });

  it("sends a JSON5 body as the JSON it stands for, as it always has", async () => {
    await ping({ body: "[{id: 1, name: 'first',}] // the batch" });

    expectSent(onlyRequest(), '[{"id":1,"name":"first"}]');
  });

  it("sends the body under the Content-Type the monitor names", async () => {
    await ping({
      body: ARRAY_BODY,
      headers: { "Content-Type": "application/vnd.api+json" },
    });

    const request: ReceivedRequest = onlyRequest();

    expectSent(request, ARRAY_BODY);
    expect(request.headers["content-type"]).toBe("application/vnd.api+json");
  });

  it("keeps every header the monitor sends", async () => {
    await ping({
      body: ARRAY_BODY,
      headers: { Authorization: "Bearer token-1", "X-Batch": "yes" },
    });

    const request: ReceivedRequest = onlyRequest();

    expect(request.headers["authorization"]).toBe("Bearer token-1");
    expect(request.headers["x-batch"]).toBe("yes");
    expectSent(request, ARRAY_BODY);
  });

  it("sends every value, written any way JSON is written, as written", async () => {
    const random: SeededRandom = seededRandom(9737);

    for (let draw: number = 0; draw < 25; draw++) {
      received = [];

      const value: unknown = drawJsonValue(random, 3);
      const body: string = JSON.stringify(value, null, [0, 2, "\t"][random(3)]);

      const response: APIResponse = await ping({ body });

      expect(response.isOnline).toBe(true);

      const request: ReceivedRequest = onlyRequest();

      expectSent(request, body);
      expect(JSON.parse(request.body.toString("utf8"))).toEqual(value);
    }
  });
});

describe("a body sent as a form, which has always worked", () => {
  it("sends an object as URL-encoded fields when the Content-Type is a form", async () => {
    await ping({
      body: '{"name": "ops", "count": "2"}',
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });

    const request: ReceivedRequest = onlyRequest();

    expect(request.body.toString("utf8")).toBe("name=ops&count=2");
    expect(request.headers["content-type"]).toContain(
      "application/x-www-form-urlencoded",
    );
  });

  it("does so for a Content-Type named in lower case, with a charset", async () => {
    await ping({
      body: '{"name": "ops"}',
      headers: {
        "content-type": "application/x-www-form-urlencoded; charset=utf-8",
      },
    });

    expect(onlyRequest().body.toString("utf8")).toBe("name=ops");
  });

  it("sends an object as multipart fields when the Content-Type is multipart", async () => {
    await ping({
      body: '{"name": "ops"}',
      headers: { "Content-Type": "multipart/form-data" },
    });

    const text: string = onlyRequest().body.toString("utf8");

    expect(text).toContain('name="name"');
    expect(text).toContain("ops");
  });

  it("sends an array under a form's Content-Type as written: it has no fields", async () => {
    const response: APIResponse = await ping({
      body: ARRAY_BODY,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });

    expect(response.isOnline).toBe(true);
    expectSent(onlyRequest(), ARRAY_BODY);
  });
});

describe("a body that is not JSON is never sent, and the check says why", () => {
  it.each([
    { name: "plain text", body: "hello world" },
    { name: "XML", body: "<ping><id>1</id></ping>" },
    { name: "form fields as text", body: "a=1&b=2" },
    { name: "an unclosed array", body: '[{"id": 1}' },
    {
      name: "a placeholder left unfilled",
      body: '{"n": {{monitorSecrets.N}}}',
    },
  ])(
    "$name: offline, with the reason as its cause, and no request made",
    async ({ body }: { name: string; body: string }) => {
      const response: APIResponse = await ping({ body, retry: 3 });

      expect(response.isOnline).toBe(false);
      expect(response.isTimeout).toBe(false);
      expect(response.statusCode).toBeUndefined();
      expect(response.failureCause).toBe(REQUEST_BODY_NOT_JSON);
      expect(response.requestBody).toBe(body);
      // Every retry would send the same body: there is none.
      expect(response.totalAttempts).toBe(1);
      expect(response.probeAttempts).toEqual([
        expect.objectContaining({
          attemptNumber: 1,
          isOnline: false,
          failureCause: REQUEST_BODY_NOT_JSON,
        }),
      ]);
      expect(received).toHaveLength(0);
      expect(Sleep.sleep).not.toHaveBeenCalled();
      // The monitor's configuration, not the probe's network.
      expect(OnlineCheck.canProbeMonitorWebsiteMonitors).not.toHaveBeenCalled();
    },
  );

  it("logs where the body stops being JSON, never what it holds, as the monitor's own fault", async () => {
    await ping({ body: '{"password": "hunter2" oops}' });

    expect(logger.error).toHaveBeenCalledTimes(1);

    const [message, attributes] = (logger.error as jest.Mock).mock.calls[0] as [
      string,
      unknown,
    ];

    expect(message).toContain(MONITOR_ID.toString());
    expect(message).toContain(
      "the request body is not valid JSON at line 1, column 24, so the request was not sent.",
    );
    expect(message).not.toContain("hunter2");
    expect(attributes).toBe(EXTERNAL_FAULT);
  });

  it("the cause is the sentence a monitor's summary words in the reader's language", () => {
    expect(REQUEST_BODY_NOT_JSON).toBe(
      "The request body is not valid JSON, so the request was not sent. Correct the body, or the value of a monitor secret it uses.",
    );
  });
});

describe("a body's placeholders and redirects", () => {
  const LOGIN: TotpParameters = {
    secret: "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ",
    algorithm: TotpAlgorithm.SHA1,
    digits: 6,
    periodInSeconds: 30,
  };

  it("fills a one-time code into an array body, as written around it", async () => {
    // The middle of a period, so the code is not about to expire.
    const nowInMs: number = 1111111080000 + 10_000;

    await ping({
      body: '[{"otp": "{{monitorSecrets.LoginCode}}"}, 2]',
      totpCodes: new TotpCodeIssuer({
        secrets: { LoginCode: LOGIN },
        now: (): number => {
          return nowInMs;
        },
      }),
    });

    expectSent(
      onlyRequest(),
      `[{"otp": "${generateTotpCode(LOGIN, nowInMs)}"}, 2]`,
    );
  });

  it("sends the same bytes again after a 307 redirect", async () => {
    const response: APIResponse = await ping({
      body: ARRAY_BODY,
      path: "/moved-307",
    });

    expect(response.isOnline).toBe(true);
    expect(
      received.map((request: ReceivedRequest) => {
        return request.path;
      }),
    ).toEqual(["/moved-307", "/echo"]);

    for (const request of received) {
      expectSent(request, ARRAY_BODY);
    }
  });

  it("drops the body when a 303 turns the request into a GET", async () => {
    await ping({ body: ARRAY_BODY, path: "/moved-303" });

    expect(received).toHaveLength(2);
    expectSent(received[0]!, ARRAY_BODY);
    expect(received[1]!.method).toBe("GET");
    expect(received[1]!.body.length).toBe(0);
  });
});

describe("the probe's step sends the body the monitor was saved with", () => {
  // An API step as the server hands it to the probe: JSON, read by fromJSON.
  function apiStep(requestBody: unknown, retryCount: number = 0): MonitorStep {
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
      monitorDestination: { _type: "URL", value: `${serverUrl}/echo` },
      requestType: HTTPMethod.POST,
      retryCount: retryCount,
      monitorCriteria: {
        _type: "MonitorCriteria",
        value: { monitorCriteriaInstanceArray: [criteria.toJSON()] },
      },
    };

    if (requestBody !== undefined) {
      value["requestBody"] = requestBody as JSONObject;
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

  it("checks a monitor whose body is an array: the issue's monitor", async () => {
    const response: ProbeMonitorResponse = await probeStep(apiStep(ARRAY_BODY));

    expect(response.isOnline).toBe(true);
    expect(response.responseCode).toBe(200);
    expect(response.failureCause).toBe("");
    expectSent(onlyRequest(), ARRAY_BODY);
  });

  it.each([
    { name: "a single value", body: '"ping"' },
    { name: "a number", body: "7" },
    { name: "an object", body: '{"check": "deep"}' },
  ])(
    "checks a monitor whose body is $name",
    async ({ body }: { name: string; body: string }) => {
      const response: ProbeMonitorResponse = await probeStep(apiStep(body));

      expect(response.isOnline).toBe(true);
      expectSent(onlyRequest(), body);
    },
  );

  it("checks a monitor with no body, sending none", async () => {
    for (const body of [undefined, "", "  \n"]) {
      received = [];

      const response: ProbeMonitorResponse = await probeStep(apiStep(body));

      expect(response.isOnline).toBe(true);
      expect(onlyRequest().body.length).toBe(0);
    }
  });

  it("checks a monitor whose body an API client wrote as a JSON value, sending its JSON", async () => {
    const response: ProbeMonitorResponse = await probeStep(
      apiStep([{ id: 1 }, { id: 2 }]),
    );

    expect(response.isOnline).toBe(true);
    expectSent(onlyRequest(), JSON.stringify([{ id: 1 }, { id: 2 }], null, 2));
  });

  it("fails a monitor whose body is not JSON, saying why, and sends nothing", async () => {
    const response: ProbeMonitorResponse = await probeStep(
      apiStep("<ping/>", 3),
    );

    expect(response.isOnline).toBe(false);
    expect(response.failureCause).toBe(REQUEST_BODY_NOT_JSON);
    expect(response.totalAttempts).toBe(1);
    expect(received).toHaveLength(0);
  });
});

// Text a drawn string is built from: letters, scripts, escapes, emoji.
const STRING_PIECES: ReadonlyArray<string> = [
  "a",
  "0",
  " ",
  "é",
  "日本",
  '"',
  "\\",
  "\n",
  "😀",
  "{",
  "]",
];

const drawString: (random: SeededRandom) => string = (
  random: SeededRandom,
): string => {
  let text: string = "";

  for (let piece: number = random(5); piece > 0; piece--) {
    text += STRING_PIECES[random(STRING_PIECES.length)];
  }

  return text;
};

// A JSON value: an object, an array or a single value, nested up to `depth`.
const drawJsonValue: (random: SeededRandom, depth: number) => unknown = (
  random: SeededRandom,
  depth: number,
): unknown => {
  switch (random(depth > 0 ? 7 : 5)) {
    case 0:
      return null;
    case 1:
      return random(2) === 0;
    case 2:
      return (random(2000001) - 1000000) / 8;
    case 3:
    case 4:
      return drawString(random);
    case 5: {
      const items: Array<unknown> = [];

      for (let item: number = random(4); item > 0; item--) {
        items.push(drawJsonValue(random, depth - 1));
      }

      return items;
    }
    default: {
      const object: Record<string, unknown> = {};

      for (let key: number = random(3); key > 0; key--) {
        object[`${drawString(random)}${key}`] = drawJsonValue(
          random,
          depth - 1,
        );
      }

      return object;
    }
  }
};
