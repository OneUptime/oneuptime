import HTTPMethod from "../../Types/API/HTTPMethod";
import HTTPResponse from "../../Types/API/HTTPResponse";
import URL from "../../Types/API/URL";
import { JSONObject } from "../../Types/JSON";
import API from "../../Utils/API";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import axios from "axios";
import { createServer, IncomingMessage, Server, ServerResponse } from "http";
import { AddressInfo } from "net";

/*
 * Common's jsdom resolver selects Axios's browser bundle, and its XHR
 * adapter. A probe forwards through Axios's Node bundle and its http
 * adapter: use those here.
 */
jest.mock("axios", () => {
  return jest.requireActual("axios/dist/node/axios.cjs");
});

/*
 * A BODY OF BYTES IS SENT AS THE BYTES IT IS.
 *
 * A probe relays a text/plain or +json body to OneUptime as the bytes that
 * came, with the Content-Type that came (Probe/API/IncomingRequestIngress,
 * issues #8430 and #8429), so OneUptime reads a relayed text - its charset
 * included - as it would have read it directly. The forward names the
 * request's own content-type in lower case, beside the JSON Content-Type
 * API adds to every request: the request's own is the one sent.
 */

interface Received {
  headers: IncomingMessage["headers"];
  body: Buffer;
}

let server: Server;
let origin: string;
const received: Array<Received> = [];

const originalAxiosAdapter: typeof axios.defaults.adapter =
  axios.defaults.adapter;

beforeAll(async () => {
  // As a server process sends: through Node's http, not jsdom's XMLHttpRequest.
  axios.defaults.adapter = "http";

  server = createServer((req: IncomingMessage, res: ServerResponse) => {
    const chunks: Array<Buffer> = [];
    req.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
    });
    req.on("end", () => {
      received.push({ headers: req.headers, body: Buffer.concat(chunks) });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end("{}");
    });
  });

  await new Promise<void>((resolve: () => void) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve: () => void) => {
    server.close(() => {
      resolve();
    });
  });

  if (originalAxiosAdapter === undefined) {
    delete axios.defaults.adapter;
  } else {
    axios.defaults.adapter = originalAxiosAdapter;
  }
});

async function sendBytes(
  bytes: Buffer,
  contentType: string,
): Promise<Received> {
  const before: number = received.length;

  const result: unknown = await API.fetch<JSONObject>({
    method: HTTPMethod.POST,
    url: URL.fromString(`${origin}/incoming-request/key`),
    data: bytes,
    headers: { "content-type": contentType, "x-sender": "backup-job" },
  });

  expect(result).toBeInstanceOf(HTTPResponse);
  expect(received.length).toBe(before + 1);

  return received[before]!;
}

describe("a body of bytes", () => {
  test("is sent as the bytes it is, with the Content-Type the request names", async () => {
    const request: Received = await sendBytes(
      Buffer.from("backup failed: error 42"),
      "text/plain",
    );

    expect(request.body.toString("utf8")).toBe("backup failed: error 42");
    expect(request.headers["content-type"]).toBe("text/plain");
    expect(request.headers["content-length"]).toBe("23");
    expect(request.headers["x-sender"]).toBe("backup-job");
  });

  test("in another charset keeps every byte, and the charset it names", async () => {
    const latin1: Buffer = Buffer.from("café: sauvegarde échouée", "latin1");

    const request: Received = await sendBytes(
      latin1,
      "text/plain; charset=iso-8859-1",
    );

    expect(request.body.equals(latin1)).toBe(true);
    expect(request.headers["content-type"]).toBe(
      "text/plain; charset=iso-8859-1",
    );
  });

  test("of JSON text is sent as that text, not as JSON of a Buffer", async () => {
    const text: string = '{\n  "Type": "Notification"\n}';

    const request: Received = await sendBytes(
      Buffer.from(text),
      "text/plain; charset=UTF-8",
    );

    expect(request.body.toString("utf8")).toBe(text);
  });
});

/*
 * Under a Content-Type named exactly as API checks it, "Content-Type":
 * "application/x-www-form-urlencoded", an object is sent as a form's
 * fields. Bytes were handed to URLSearchParams too, which threw "Each query
 * pair must be an iterable [name, value] tuple": an API monitor that sends
 * its body as written, an array under a form's Content-Type, never sent it
 * (#9737).
 */
describe("a body under a form's Content-Type", () => {
  const FORM_HEADERS: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
  };

  async function sendUnderForm(data: Buffer | JSONObject): Promise<Received> {
    const before: number = received.length;

    const result: unknown = await API.fetch<JSONObject>({
      method: HTTPMethod.POST,
      url: URL.fromString(`${origin}/form`),
      data: data,
      headers: FORM_HEADERS,
    });

    expect(result).toBeInstanceOf(HTTPResponse);
    expect(received.length).toBe(before + 1);

    return received[before]!;
  }

  test("of bytes is sent as the bytes it is", async () => {
    const request: Received = await sendUnderForm(Buffer.from('[{"id": 1}]'));

    expect(request.body.toString("utf8")).toBe('[{"id": 1}]');
    expect(request.headers["content-type"]).toBe(
      "application/x-www-form-urlencoded",
    );
  });

  test("of an object is still sent as its fields", async () => {
    const request: Received = await sendUnderForm({ name: "ops", count: "2" });

    expect(request.body.toString("utf8")).toBe("name=ops&count=2");
  });
});

describe("a JSON body", () => {
  test("is still sent as JSON", async () => {
    const before: number = received.length;

    await API.fetch<JSONObject>({
      method: HTTPMethod.POST,
      url: URL.fromString(`${origin}/incoming-request/key`),
      data: { status: "healthy" },
    });

    const request: Received = received[before]!;

    expect(JSON.parse(request.body.toString("utf8"))).toEqual({
      status: "healthy",
    });
    expect(request.headers["content-type"]).toContain("application/json");
  });
});
