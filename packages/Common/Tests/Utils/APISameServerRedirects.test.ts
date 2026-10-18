import URL from "../../Types/API/URL";
import HTTPErrorResponse from "../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../Types/API/HTTPResponse";
import APIException from "../../Types/Exception/ApiException";
import { JSONObject } from "../../Types/JSON";
import API from "../../Utils/API";
import {
  getSameServerRedirectCheck,
  isRedirectOnSameServer,
} from "../../Utils/SameServerRedirect";
import {
  afterAll,
  afterEach,
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
 * adapter. The requests that carry OneUptime's keys are made by server
 * processes, through Axios's Node bundle and its http adapter (which
 * follows redirects): use those here.
 */
jest.mock("axios", () => {
  return jest.requireActual("axios/dist/node/axios.cjs");
});

/*
 * A request that carries one of OneUptime's keys - the cluster key in a
 * header, a probe's or a Runner's key in its body - follows a redirect only
 * while it stays on the server it was sent to: the same address, or that
 * address moved from http to https. An HTTP client hands a redirected
 * request's headers, and for a 307 or 308 its body, to wherever the
 * redirect points, so anywhere else the request fails instead.
 *
 * Over real HTTP: two servers on this machine, the one a request is sent to
 * and another one.
 */

const CLUSTER_KEY: string = "Q7dVk2LmX9pR4tWz8NcB1sHf6JyG3uAe";
const PROBE_KEY: string = "0b1c2d3e-4f50-4a61-8b72-9c83d4e5f601";

interface Received {
  method: string;
  url: string;
  headers: IncomingMessage["headers"];
  body: string;
}

interface TestServer {
  http: Server;
  origin: string;
  port: number;
  received: Array<Received>;
  // What the next request to a path is answered with.
  answers: Map<string, { status: number; location?: string }>;
}

async function startServer(): Promise<TestServer> {
  const received: Array<Received> = [];
  const answers: Map<string, { status: number; location?: string }> = new Map();

  const http: Server = createServer(
    (req: IncomingMessage, res: ServerResponse) => {
      let body: string = "";

      req.on("data", (chunk: Buffer) => {
        body += chunk.toString("utf8");
      });

      req.on("end", () => {
        received.push({
          method: req.method || "",
          url: req.url || "",
          headers: req.headers,
          body: body,
        });

        const answer: { status: number; location?: string } | undefined =
          answers.get((req.url || "").split("?")[0] || "");

        if (answer && answer.location) {
          res.writeHead(answer.status, {
            location: answer.location,
            "content-type": "text/html",
          });
          res.end("<html>Moved</html>");
          return;
        }

        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ answeredBy: req.url }));
      });
    },
  );

  await new Promise<void>((resolve: () => void) => {
    http.listen(0, "127.0.0.1", resolve);
  });

  const port: number = (http.address() as AddressInfo).port;

  return {
    http: http,
    origin: `http://127.0.0.1:${port}`,
    port: port,
    received: received,
    answers: answers,
  };
}

async function stopServer(server: TestServer): Promise<void> {
  await new Promise<void>((resolve: () => void) => {
    server.http.close(() => {
      resolve();
    });
  });
}

let server: TestServer;
let otherServer: TestServer;

const originalAxiosAdapter: typeof axios.defaults.adapter =
  axios.defaults.adapter;

beforeAll(async () => {
  axios.defaults.adapter = "http";
  server = await startServer();
  otherServer = await startServer();
});

afterAll(async () => {
  await stopServer(server);
  await stopServer(otherServer);

  if (originalAxiosAdapter === undefined) {
    delete axios.defaults.adapter;
  } else {
    axios.defaults.adapter = originalAxiosAdapter;
  }
});

afterEach(() => {
  server.received.length = 0;
  server.answers.clear();
  otherServer.received.length = 0;
  otherServer.answers.clear();
});

// A POST that carries a key in its header and in its body, as OneUptime's own services send one.
async function postWithKey(
  path: string,
  options: { sameServerRedirectsOnly?: boolean } = {
    sameServerRedirectsOnly: true,
  },
): Promise<HTTPResponse<JSONObject> | HTTPErrorResponse> {
  return await API.post<JSONObject>({
    url: URL.fromString(`${server.origin}${path}`),
    data: { probeKey: PROBE_KEY, probeId: "a-probe" },
    headers: { clusterkey: CLUSTER_KEY },
    options: options,
  });
}

describe("a request that carries a key, redirected to another server", () => {
  test.each([301, 302, 303, 307, 308])(
    "is not sent on when the redirect is a %s, and fails saying where it pointed",
    async (status: number) => {
      server.answers.set("/api/notification/email/send", {
        status: status,
        location: `${otherServer.origin}/collect`,
      });

      let failure: unknown = null;

      try {
        await postWithKey("/api/notification/email/send");
      } catch (error) {
        failure = error;
      }

      // The server it was sent to got it once, and nobody else anything.
      expect(server.received).toHaveLength(1);
      expect(otherServer.received).toEqual([]);

      expect(failure).toBeInstanceOf(APIException);
      expect((failure as APIException).message).toContain(otherServer.origin);
    },
  );

  test("is not sent on to the same address under another name", async () => {
    server.answers.set("/probe-ingest/alive", {
      status: 307,
      location: `http://localhost:${server.port}/probe-ingest/alive`,
    });

    await expect(postWithKey("/probe-ingest/alive")).rejects.toBeInstanceOf(
      APIException,
    );
    expect(server.received).toHaveLength(1);
  });

  test("is not sent on by the second redirect of a chain whose first stayed on the server", async () => {
    server.answers.set("/first", { status: 307, location: "/second" });
    server.answers.set("/second", {
      status: 308,
      location: `${otherServer.origin}/collect`,
    });

    await expect(postWithKey("/first")).rejects.toBeInstanceOf(APIException);

    expect(
      server.received.map((request: Received): string => {
        return request.url;
      }),
    ).toEqual(["/first", "/second"]);
    expect(otherServer.received).toEqual([]);
  });

  /*
   * What every key-carrying call would do without the option: the HTTP
   * client follows the redirect anywhere, with the key's header, and a 307
   * or 308 with its body too. This is why the option exists.
   */
  test("without the option, is followed to the other server with its header and its body", async () => {
    server.answers.set("/api/notification/email/send", {
      status: 307,
      location: `${otherServer.origin}/collect`,
    });

    const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
      await postWithKey("/api/notification/email/send", {});

    expect(response.statusCode).toBe(200);
    expect(otherServer.received).toHaveLength(1);
    expect(otherServer.received[0]!.headers["clusterkey"]).toBe(CLUSTER_KEY);
    expect(otherServer.received[0]!.body).toContain(PROBE_KEY);
  });
});

describe("a request that carries a key, redirected on its own server", () => {
  test.each([
    ["a path", "/moved"],
    ["the server's own address", "SELF/moved"],
  ])(
    "follows a redirect to %s, header and body with it",
    async (_label: string, location: string) => {
      server.answers.set("/old", {
        status: 307,
        location: location.replace("SELF", server.origin),
      });

      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await postWithKey("/old");

      expect(response).toBeInstanceOf(HTTPResponse);
      expect((response as HTTPResponse<JSONObject>).data).toEqual({
        answeredBy: "/moved",
      });
      expect(
        server.received.map((request: Received): string => {
          return request.url;
        }),
      ).toEqual(["/old", "/moved"]);
      expect(server.received[1]!.headers["clusterkey"]).toBe(CLUSTER_KEY);
      expect(server.received[1]!.body).toContain(PROBE_KEY);
      expect(otherServer.received).toEqual([]);
    },
  );
});

describe("which redirects stay on the server", () => {
  test.each([
    ["the same address", "http://app:3002/a", "http://app:3002/b"],
    [
      "the same address, a query added",
      "https://x.com/a",
      "https://x.com/b?c=d",
    ],
    [
      "the same name in other capitals",
      "https://oneuptime.com/a",
      "https://OneUptime.COM/a",
    ],
    [
      "http moved to https",
      "http://oneuptime.example.com/a",
      "https://oneuptime.example.com/a",
    ],
    [
      "http on 80 moved to https on 443, written out",
      "http://x.com:80/a",
      "https://x.com:443/a",
    ],
    ["an IPv6 address", "http://[::1]:3002/a", "http://[::1]:3002/b"],
    [
      "from an address that names a user, to the server without it",
      "https://probe:secret@oneuptime.example.com/a",
      "https://oneuptime.example.com/b",
    ],
  ])("%s", (_label: string, from: string, to: string) => {
    expect(isRedirectOnSameServer(from, to)).toBe(true);
  });

  test.each([
    [
      "another host",
      "https://oneuptime.com/a",
      "https://collector.example.net/a",
    ],
    [
      "a host that only starts like it",
      "https://oneuptime.com/a",
      "https://oneuptime.com.example.net/a",
    ],
    ["a subdomain", "https://oneuptime.com/a", "https://www.oneuptime.com/a"],
    ["another port", "http://app:3002/a", "http://app:3003/a"],
    [
      "https moved to http",
      "https://oneuptime.com/a",
      "http://oneuptime.com/a",
    ],
    [
      "http moved to https on another port",
      "http://x.com:3002/a",
      "https://x.com/a",
    ],
    [
      "http moved to https from another port",
      "http://x.com/a",
      "https://x.com:8443/a",
    ],
    ["another scheme", "https://oneuptime.com/a", "ftp://oneuptime.com/a"],
    [
      "credentials added",
      "https://oneuptime.com/a",
      "https://user:pass@oneuptime.com/a",
    ],
    [
      "an address that cannot be read",
      "https://oneuptime.com/a",
      "http://[bad",
    ],
    ["no address", "https://oneuptime.com/a", ""],
  ])("not %s", (_label: string, from: string, to: string) => {
    expect(isRedirectOnSameServer(from, to)).toBe(false);
  });

  test("a request sent to an address that cannot be read follows no redirect", () => {
    expect(isRedirectOnSameServer("not a url", "not a url")).toBe(false);
  });

  test("the check an HTTP client calls refuses a redirect elsewhere and names where it pointed, never what it carried", () => {
    const check: (options: Record<string, unknown>) => void =
      getSameServerRedirectCheck("https://oneuptime.com/probe-ingest/alive");

    expect(() => {
      check({ href: "https://oneuptime.com/probe-ingest/alive/" });
    }).not.toThrow();

    let refusal: unknown = null;

    try {
      check({
        href: `https://collector.example.net/x?probeKey=${PROBE_KEY}`,
      });
    } catch (error) {
      refusal = error;
    }

    expect(refusal).toBeInstanceOf(Error);
    expect((refusal as Error).message).toContain(
      "https://collector.example.net",
    );
    expect((refusal as Error).message).not.toContain(PROBE_KEY);
    expect((refusal as Error).message).not.toContain("/x");
  });
});
