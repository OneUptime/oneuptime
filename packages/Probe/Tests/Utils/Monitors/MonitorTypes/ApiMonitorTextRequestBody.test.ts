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
import HTTPMethod from "Common/Types/API/HTTPMethod";
import URL from "Common/Types/API/URL";
import Dictionary from "Common/Types/Dictionary";
import { JSONObject } from "Common/Types/JSON";
import { CheckOn, FilterType } from "Common/Types/Monitor/CriteriaFilter";
import MonitorCriteriaInstance from "Common/Types/Monitor/MonitorCriteriaInstance";
import MonitorRequestBodyFormat from "Common/Types/Monitor/MonitorRequestBodyFormat";
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
 * AN API MONITOR SENDS A TEXT BODY BYTE FOR BYTE (#10736).
 *
 * A body was always read as JSON, so XML for a SOAP endpoint, plain text or
 * form fields written as a=1&b=2 never left the probe. A step whose body
 * format is text sends the body exactly as written, never parsed, under
 * the Content-Type its headers name, or text/plain;charset=UTF-8. A step
 * stored before the format existed has none, and still sends JSON.
 *
 * A real HTTP server on this machine receives every request, so what is
 * checked is the bytes that arrive, their Content-Type and their length.
 */

const PROJECT_ID: ObjectID = ObjectID.generate();
const MONITOR_ID: ObjectID = ObjectID.generate();

const TEXT_CONTENT_TYPE: string = "text/plain;charset=UTF-8";
const JSON_CONTENT_TYPE: string = "application/json;charset=UTF-8";

const SOAP_BODY: string = [
  '<?xml version="1.0" encoding="utf-8"?>',
  '<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">',
  "  <soap:Body><Ping><Id>1</Id></Ping></soap:Body>",
  "</soap:Envelope>",
].join("\r\n");

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

        response.writeHead(200, { "Content-Type": "text/xml" });
        response.end("<ok/>");
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
        throw new Error("Unexpected request outside the text body fixture");
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
  body: string;
  format?: MonitorRequestBodyFormat | undefined;
  headers?: Dictionary<string> | undefined;
  path?: string | undefined;
  totpCodes?: TotpCodeIssuer | undefined;
}): Promise<APIResponse> {
  const response: APIResponse | null = await ApiMonitor.ping(
    URL.fromString(`${serverUrl}${options.path || "/echo"}`),
    {
      requestType: HTTPMethod.POST,
      requestHeaders: options.headers,
      requestBody: options.body,
      requestBodyFormat: options.format,
      retry: 0,
      timeout: new PositiveNumber(30000),
      monitorId: MONITOR_ID,
      totpCodes: options.totpCodes,
    },
  );

  expect(response).not.toBeNull();

  return response!;
}

// An API step as the server hands it to the probe: JSON, read by fromJSON.
function apiStep(data: {
  body: string;
  format?: string | undefined;
  headers?: Dictionary<string> | undefined;
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
    monitorDestination: { _type: "URL", value: `${serverUrl}/echo` },
    requestType: HTTPMethod.POST,
    retryCount: 0,
    requestBody: data.body,
    monitorCriteria: {
      _type: "MonitorCriteria",
      value: { monitorCriteriaInstanceArray: [criteria.toJSON()] },
    },
  };

  if (data.format !== undefined) {
    value["requestBodyFormat"] = data.format;
  }

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

// The server got exactly these bytes, with a length to match.
function expectSent(request: ReceivedRequest, body: string): void {
  expect(request.body.toString("utf8")).toBe(body);
  expect(request.headers["content-length"]).toBe(
    String(Buffer.byteLength(body, "utf8")),
  );
}

describe("a text body is sent byte for byte", () => {
  it.each([
    { name: "XML for a SOAP endpoint", body: SOAP_BODY },
    { name: "plain text", body: "ping from OneUptime\n" },
    { name: "form fields written as text", body: "a=1&b=2" },
    { name: "text that is JSON too, never reformatted", body: '{ "a" : 1 }' },
    { name: "JSON5, never turned into JSON", body: "{a: 1,} // as typed" },
    { name: "unicode", body: "café 日本 😀 Привет" },
  ])(
    "$name, under text/plain",
    async ({ body }: { name: string; body: string }) => {
      const response: APIResponse = await ping({
        body,
        format: MonitorRequestBodyFormat.Text,
      });

      expect(response.isOnline).toBe(true);
      expect(response.failureCause).toBe("");
      // What is reported is the body as configured.
      expect(response.requestBody).toBe(body);

      const request: ReceivedRequest = onlyRequest();

      expectSent(request, body);
      expect(request.headers["content-type"]).toBe(TEXT_CONTENT_TYPE);
    },
  );

  it("under the Content-Type the headers name, in any case", async () => {
    await ping({
      body: SOAP_BODY,
      format: MonitorRequestBodyFormat.Text,
      headers: {
        "content-type": "text/xml; charset=utf-8",
        SOAPAction: '"urn:Ping"',
      },
    });

    const request: ReceivedRequest = onlyRequest();

    expectSent(request, SOAP_BODY);
    expect(request.headers["content-type"]).toBe("text/xml; charset=utf-8");
    expect(request.headers["soapaction"]).toBe('"urn:Ping"');
  });

  it("form fields under a form's Content-Type, as typed", async () => {
    await ping({
      body: "name=ops&count=2",
      format: MonitorRequestBodyFormat.Text,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });

    const request: ReceivedRequest = onlyRequest();

    expectSent(request, "name=ops&count=2");
    expect(request.headers["content-type"]).toBe(
      "application/x-www-form-urlencoded",
    );
  });

  it("the same bytes again after a 307 redirect", async () => {
    const response: APIResponse = await ping({
      body: "a=1&b=2",
      format: MonitorRequestBodyFormat.Text,
      path: "/moved-307",
    });

    expect(response.isOnline).toBe(true);
    expect(received).toHaveLength(2);

    for (const request of received) {
      expectSent(request, "a=1&b=2");
      expect(request.headers["content-type"]).toBe(TEXT_CONTENT_TYPE);
    }
  });

  it("any text, drawn", async () => {
    const random: SeededRandom = seededRandom(10736);
    const pieces: ReadonlyArray<string> = [
      "<",
      ">",
      "&",
      "=",
      "{",
      "}",
      '"',
      "\\",
      "\n",
      "\t",
      "a",
      "é",
      "日本",
      "😀",
    ];

    for (let draw: number = 0; draw < 20; draw++) {
      received = [];

      let body: string = "x";

      for (let piece: number = random(20); piece > 0; piece--) {
        body += pieces[random(pieces.length)];
      }

      await ping({ body, format: MonitorRequestBodyFormat.Text });

      expect({ draw, sent: onlyRequest().body.toString("utf8") }).toEqual({
        draw,
        sent: body,
      });
    }
  });
});

describe("placeholders in a text body are filled in as they are", () => {
  it("a monitor secret, as the server fills it", async () => {
    const body: string = MonitorRequestBody.fillSecrets(
      "<login><user>ops</user><pass>{{monitorSecrets.Password}}</pass></login>",
      new Map([["Password", 'p"a\\ss&<>']]),
      MonitorRequestBodyFormat.Text,
    );

    await ping({ body, format: MonitorRequestBodyFormat.Text });

    expectSent(
      onlyRequest(),
      '<login><user>ops</user><pass>p"a\\ss&<></pass></login>',
    );
  });

  it("a one-time code, as the probe makes it for each attempt", async () => {
    const LOGIN: TotpParameters = {
      secret: "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ",
      algorithm: TotpAlgorithm.SHA1,
      digits: 6,
      periodInSeconds: 30,
    };
    // The middle of a period, so the code is not about to expire.
    const nowInMs: number = 1111111080000 + 10_000;

    await ping({
      body: "user=ops&otp={{monitorSecrets.LoginCode}}",
      format: MonitorRequestBodyFormat.Text,
      totpCodes: new TotpCodeIssuer({
        secrets: { LoginCode: LOGIN },
        now: (): number => {
          return nowInMs;
        },
      }),
    });

    expectSent(
      onlyRequest(),
      `user=ops&otp=${generateTotpCode(LOGIN, nowInMs)}`,
    );
  });
});

describe("the probe's step sends the body in the format it was saved with", () => {
  it("text, as the form or the API saved it", async () => {
    const response: ProbeMonitorResponse = await probeStep(
      apiStep({ body: SOAP_BODY, format: "text" }),
    );

    expect(response.isOnline).toBe(true);
    expect(response.failureCause).toBe("");

    const request: ReceivedRequest = onlyRequest();

    expectSent(request, SOAP_BODY);
    expect(request.headers["content-type"]).toBe(TEXT_CONTENT_TYPE);
  });

  it("a monitor stored before the format existed still sends JSON", async () => {
    const response: ProbeMonitorResponse = await probeStep(
      apiStep({ body: '[{"id": 1}]' }),
    );

    expect(response.isOnline).toBe(true);

    const request: ReceivedRequest = onlyRequest();

    expectSent(request, '[{"id": 1}]');
    expect(request.headers["content-type"]).toBe(JSON_CONTENT_TYPE);
  });

  it("and still refuses to send one that is no JSON, saying why", async () => {
    const response: ProbeMonitorResponse = await probeStep(
      apiStep({ body: SOAP_BODY }),
    );

    expect(response.isOnline).toBe(false);
    expect(response.failureCause).toBe(
      writeProbeFailureCause(ProbeFailureCause.RequestBodyNotJson),
    );
    expect(received).toHaveLength(0);
  });

  it("a format that names none is JSON", async () => {
    const response: ProbeMonitorResponse = await probeStep(
      apiStep({ body: '{"a": 1}', format: "xml" }),
    );

    expect(response.isOnline).toBe(true);
    expect(onlyRequest().headers["content-type"]).toBe(JSON_CONTENT_TYPE);
  });

  it("JSON, as the step says", async () => {
    await probeStep(apiStep({ body: '{"a": 1}', format: "json" }));

    const request: ReceivedRequest = onlyRequest();

    expectSent(request, '{"a": 1}');
    expect(request.headers["content-type"]).toBe(JSON_CONTENT_TYPE);
  });
});
