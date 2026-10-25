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
import http from "http";
import { AddressInfo } from "net";
import CodeHostHttp, {
  CodeHostHttpErrorKind,
  CodeHostHttpResponse,
  CodeHostTransport,
} from "../../../../../Server/Utils/CodeRepository/CodeHost/CodeHostHttp";
import { ResolvedAddress } from "../../../../../Server/Utils/DataSource/EgressGuard";

/*
 * Every request OneUptime's server makes to a Git server a person named
 * goes through the outbound address policy:
 *
 *   - never loopback, link-local (the cloud metadata address) or reserved
 *     addresses, on any installation;
 *   - never a private address on OneUptime Cloud - with what to do instead;
 *   - https only on OneUptime Cloud; http only where private addresses are
 *     allowed (a self-hosted OneUptime);
 *   - no credentials in the address, no redirects followed, answers capped.
 *
 * Each refusal is asserted before a socket opens: the hosts below resolve
 * through a fake DNS, and the requests that are refused never reach it.
 */

jest.mock("axios", () => {
  return jest.requireActual("axios/dist/node/axios.cjs");
});

const BILLING: string = "BILLING_ENABLED";
const BLOCK: string = "DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES";

let savedBilling: string | undefined;
let savedBlock: string | undefined;

beforeEach(() => {
  savedBilling = process.env[BILLING];
  savedBlock = process.env[BLOCK];
  delete process.env[BILLING];
  delete process.env[BLOCK];
});

afterEach(() => {
  if (savedBilling === undefined) {
    delete process.env[BILLING];
  } else {
    process.env[BILLING] = savedBilling;
  }

  if (savedBlock === undefined) {
    delete process.env[BLOCK];
  } else {
    process.env[BLOCK] = savedBlock;
  }
});

function resolvingTo(address: string): {
  transport: CodeHostTransport;
  lookups: Array<string>;
} {
  const lookups: Array<string> = [];

  return {
    lookups,
    transport: CodeHostHttp.createTransport({
      egressOptions: {
        resolveFunction: async (
          hostname: string,
        ): Promise<Array<ResolvedAddress>> => {
          lookups.push(hostname);
          return [{ address, family: address.includes(":") ? 6 : 4 }];
        },
      },
    }),
  };
}

async function refusal(
  transport: CodeHostTransport,
  url: string,
): Promise<{ kind: string; message: string }> {
  try {
    await transport({ method: "GET", url, headers: {}, timeoutInMs: 2000 });
  } catch (error) {
    return error as { kind: string; message: string };
  }

  throw new Error(`${url} was not refused`);
}

describe("on OneUptime Cloud", () => {
  beforeEach(() => {
    process.env[BILLING] = "true";
  });

  test("a Git server on a private network is refused - by name without saying where it resolves, by address with what to do instead", async () => {
    const { transport } = resolvingTo("10.20.30.40");
    const byName: { kind: string; message: string } = await refusal(
      transport,
      "https://gitlab.internal.example.com/api/v4/user",
    );

    expect(byName.kind).toBe(CodeHostHttpErrorKind.NotAllowed);
    // No map of the network for a tenant: the address it resolved to is not said.
    expect(byName.message).not.toContain("10.20.30.40");

    const byAddress: { kind: string; message: string } = await refusal(
      CodeHostHttp.createTransport(),
      "https://10.20.30.40/api/v4/user",
    );

    expect(byAddress.kind).toBe(CodeHostHttpErrorKind.NotAllowed);
    expect(byAddress.message).toContain("one of your own Runners");
  });

  test("plain http is refused before anything is looked up", async () => {
    const { transport, lookups } = resolvingTo("203.0.113.5");
    const refused: { kind: string; message: string } = await refusal(
      transport,
      "http://git.example.com/api/v1/user",
    );

    expect(refused.kind).toBe(CodeHostHttpErrorKind.NotAllowed);
    expect(refused.message).toContain("https only");
    expect(lookups).toEqual([]);
    expect(CodeHostHttp.isHttpAllowed()).toBe(false);
  });
});

describe("on every installation", () => {
  test("loopback, link-local and the cloud metadata address are refused, self-hosted too", async () => {
    for (const address of ["127.0.0.1", "169.254.169.254", "::1", "0.0.0.0"]) {
      const { transport } = resolvingTo(address);
      const refused: { kind: string; message: string } = await refusal(
        transport,
        "https://git.example.com/api/v1/user",
      );

      expect(refused.kind).toBe(CodeHostHttpErrorKind.NotAllowed);
    }

    // Typed as themselves, too.
    const literal: CodeHostTransport = CodeHostHttp.createTransport();

    for (const url of [
      "https://127.0.0.1/api/v1/user",
      "https://169.254.169.254/latest/meta-data/",
      "https://[::1]/api/v1/user",
    ]) {
      expect((await refusal(literal, url)).kind).toBe(
        CodeHostHttpErrorKind.NotAllowed,
      );
    }
  });

  test("an address that carries a username or password is refused, and so is what is not an address", async () => {
    const { transport, lookups } = resolvingTo("203.0.113.5");

    expect(
      (await refusal(transport, "https://alice:secret@git.example.com/x")).kind,
    ).toBe(CodeHostHttpErrorKind.NotAllowed);
    expect((await refusal(transport, "not an address")).kind).toBe(
      CodeHostHttpErrorKind.NotAllowed,
    );
    expect((await refusal(transport, "ftp://git.example.com/x")).kind).toBe(
      CodeHostHttpErrorKind.NotAllowed,
    );
    expect(lookups).toEqual([]);
  });

  test("a self-hosted OneUptime reaches its own network, http included - unless its operator says otherwise", () => {
    expect(CodeHostHttp.isHttpAllowed()).toBe(true);

    process.env[BLOCK] = "true";

    expect(CodeHostHttp.isHttpAllowed()).toBe(false);
  });
});

describe("the answer", () => {
  let server: http.Server;
  let origin: string = "";

  beforeAll(async () => {
    server = http.createServer(
      (request: http.IncomingMessage, response: http.ServerResponse) => {
        if (request.url === "/redirect") {
          response.writeHead(302, { Location: "http://169.254.169.254/" });
          response.end();
          return;
        }

        if (request.url === "/large") {
          response.writeHead(200, { "Content-Type": "application/json" });
          response.end(JSON.stringify({ data: "x".repeat(4096) }));
          return;
        }

        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(JSON.stringify({ ok: true }));
      },
    );

    await new Promise<void>((resolve: () => void) => {
      server.listen(0, "127.0.0.1", () => {
        resolve();
      });
    });

    origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    await new Promise<void>((resolve: () => void) => {
      server.close(() => {
        resolve();
      });
    });
  });

  test("a redirect is handed back, never followed", async () => {
    const response: CodeHostHttpResponse =
      await CodeHostHttp.createUnguardedTransportForTests()({
        method: "GET",
        url: `${origin}/redirect`,
        headers: {},
        timeoutInMs: 2000,
      });

    expect(response.statusCode).toBe(302);
    expect(response.headers["location"]).toBe("http://169.254.169.254/");
  });

  test("an answer past the cap is refused, not read", async () => {
    await expect(
      CodeHostHttp.createUnguardedTransportForTests({ maxResponseBytes: 1024 })(
        {
          method: "GET",
          url: `${origin}/large`,
          headers: {},
          timeoutInMs: 2000,
        },
      ),
    ).rejects.toMatchObject({ kind: CodeHostHttpErrorKind.Unavailable });
  });

  test("its JSON is read, and its headers lowercased", async () => {
    const response: CodeHostHttpResponse =
      await CodeHostHttp.createUnguardedTransportForTests()({
        method: "GET",
        url: `${origin}/ok`,
        headers: {},
        timeoutInMs: 2000,
      });

    expect(response.bodyJson).toEqual({ ok: true });
    expect(response.headers["content-type"]).toBe("application/json");
  });

  test("a message never says a secret it was given", () => {
    expect(
      CodeHostHttp.clean("refused glpat-abc123 for alice", ["glpat-abc123"]),
    ).not.toContain("glpat-abc123");
  });
});
