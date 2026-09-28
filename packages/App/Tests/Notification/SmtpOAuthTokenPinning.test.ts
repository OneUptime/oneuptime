import SMTPOAuthService, {
  SMTPOAuthConfig,
} from "../../FeatureSet/Notification/Services/SMTPOAuthService";
import URL from "Common/Types/API/URL";
import OAuthProviderType from "Common/Types/Email/OAuthProviderType";
import GlobalCache from "Common/Server/Infrastructure/GlobalCache";
import DataSourceEgressGuard, {
  EgressGuardOptions,
  ResolvedAddress,
} from "Common/Server/Utils/DataSource/EgressGuard";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import { generateKeyPairSync } from "crypto";
import dns from "dns";
import http, { IncomingMessage, Server, ServerResponse } from "http";
import net from "net";

jest.mock("Common/Server/Infrastructure/GlobalCache", () => {
  return {
    __esModule: true,
    default: {
      getJSONObject: jest.fn(),
      setJSON: jest.fn(),
    },
  };
});

jest.mock("Common/Server/EnvironmentConfig", () => {
  // SMTPOAuthService keys its token cache with EncryptionSecret.
  return { IsDevelopment: false, EncryptionSecret: "test-encryption-secret" };
});

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    EXTERNAL_FAULT: {},
    default: { debug: jest.fn(), error: jest.fn(), warn: jest.fn() },
  };
});

/*
 * The SMTP OAuth token request carries the tenant's client_id and
 * client_secret (or a signed assertion), and its response is echoed back
 * through POST /api/notification/smtp-config/test. The egress guard checks
 * the token URL first; this pins that the request then goes to the address
 * the guard checked.
 *
 * It used to go through node fetch, which resolved the name again on its
 * own. A DNS server that answered the guard with a public address and fetch
 * with 127.0.0.1 or 169.254.169.254 received the secret, and the answer came
 * back to the project.
 *
 * The request runs for real here, over a socket, against a loopback token
 * endpoint. The guard is stubbed to "validate" the made-up name to
 * loopback, because the real guard rightly refuses loopback; the name is
 * under .invalid (RFC 6761), which never resolves, so the pinned lookup is
 * the only thing that can turn it into 127.0.0.1. Every resolver the
 * request could otherwise reach for is spied on.
 */

const TOKEN_HOST: string = "token.pinning.invalid";

interface RecordedRequest {
  method: string;
  path: string;
  host: string;
  form: URLSearchParams;
}

type ResolverMethod = (
  hostname: string,
  callback: (error: NodeJS.ErrnoException | null, addresses: never) => void,
) => void;

let server: Server;
let port: number;
let requests: Array<RecordedRequest>;
// Every name something tried to resolve outside the guard; must stay empty.
const resolverCalls: Array<string> = [];
let guardSpy: jest.SpyInstance;

function tokenUrl(path: string): URL {
  return URL.fromString(`http://${TOKEN_HOST}:${port}${path}`);
}

function config(overrides: Partial<SMTPOAuthConfig> = {}): SMTPOAuthConfig {
  return {
    configId: "config-a",
    clientId: "client-id",
    clientSecret: "client-secret",
    tokenUrl: tokenUrl("/oauth2/token"),
    scope: "https://outlook.office365.com/.default",
    username: "sender@example.com",
    providerType: OAuthProviderType.ClientCredentials,
    ...overrides,
  };
}

function handle(req: IncomingMessage, res: ServerResponse): void {
  let body: string = "";

  req.on("data", (chunk: Buffer) => {
    body += chunk.toString("utf8");
  });

  req.on("end", () => {
    requests.push({
      method: req.method || "",
      path: req.url || "",
      host: req.headers.host || "",
      form: new URLSearchParams(body),
    });

    if (req.url === "/redirect") {
      /*
       * Back to this same server, so a client that followed it would show
       * up as a second request.
       */
      res.writeHead(302, {
        Location: `http://${TOKEN_HOST}:${port}/oauth2/token`,
      });
      res.end();
      return;
    }

    if (req.url === "/trickle") {
      /*
       * Never finishes, but never goes quiet either: a byte every 100ms
       * keeps any socket idle timeout from firing.
       */
      res.writeHead(200, { "Content-Type": "application/json" });
      const interval: ReturnType<typeof setInterval> = setInterval(() => {
        res.write(" ");
      }, 100);
      res.on("close", () => {
        clearInterval(interval);
      });
      return;
    }

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify({
        access_token: "pinned-access-token",
        token_type: "Bearer",
        expires_in: 3600,
      }),
    );
  });
}

beforeEach(async () => {
  requests = [];
  resolverCalls.length = 0;

  server = http.createServer(handle);
  await new Promise<void>((resolve: () => void) => {
    server.listen(0, "127.0.0.1", resolve);
  });
  port = (server.address() as net.AddressInfo).port;

  // The token cache must miss so every call reaches the network path.
  jest.spyOn(GlobalCache, "getJSONObject").mockResolvedValue(null);
  jest.spyOn(GlobalCache, "setJSON").mockResolvedValue(undefined as never);

  const realAssertHostnameAllowed: typeof DataSourceEgressGuard.assertHostnameAllowed =
    DataSourceEgressGuard.assertHostnameAllowed.bind(DataSourceEgressGuard);

  guardSpy = jest
    .spyOn(DataSourceEgressGuard, "assertHostnameAllowed")
    .mockImplementation(
      (
        hostname: string,
        options?: EgressGuardOptions,
      ): Promise<Array<ResolvedAddress>> => {
        if (hostname === TOKEN_HOST) {
          return Promise.resolve([{ address: "127.0.0.1", family: 4 }]);
        }
        return realAssertHostnameAllowed(hostname, options);
      },
    );

  for (const method of ["resolve4", "resolve6"] as const) {
    jest.spyOn(dns.Resolver.prototype, method).mockImplementation(((
      hostname: string,
      callback: Parameters<ResolverMethod>[1],
    ): void => {
      resolverCalls.push(`${method}:${hostname}`);
      const error: NodeJS.ErrnoException = new Error(`unexpected ${method}`);
      error.code = dns.NOTFOUND;
      callback(error, undefined as never);
    }) as never);
  }

  // IP literals go through; only a name counts as a re-resolution.
  const realLookup: typeof dns.lookup = dns.lookup;
  jest.spyOn(dns, "lookup").mockImplementation(((
    hostname: string,
    options: unknown,
    callback: (error: NodeJS.ErrnoException | null) => void,
  ): void => {
    if (net.isIP(hostname) !== 0) {
      (realLookup as unknown as (...args: Array<unknown>) => void)(
        hostname,
        options,
        callback,
      );
      return;
    }
    resolverCalls.push(`lookup:${hostname}`);
    const error: NodeJS.ErrnoException = new Error("unexpected lookup");
    error.code = "ENOTFOUND";
    callback(error);
  }) as never);
});

afterEach(async () => {
  jest.restoreAllMocks();
  server.closeAllConnections();
  await new Promise<void>((resolve: () => void) => {
    server.close(() => {
      resolve();
    });
  });
});

describe("the SMTP OAuth token request goes to the validated address", () => {
  test("client credentials are posted to the validated address, without resolving the name again", async () => {
    const token: string = await SMTPOAuthService.getAccessToken(config());

    expect(token).toBe("pinned-access-token");
    expect(guardSpy).toHaveBeenCalledWith(TOKEN_HOST, {
      targetLabel: "OAuth token URL",
    });
    expect(resolverCalls).toEqual([]);

    expect(requests).toHaveLength(1);
    expect(requests[0]!.method).toBe("POST");
    expect(requests[0]!.path).toBe("/oauth2/token");
    // The name stays on the request; only the dial is pinned.
    expect(requests[0]!.host).toBe(`${TOKEN_HOST}:${port}`);
    expect(requests[0]!.form.get("client_id")).toBe("client-id");
    expect(requests[0]!.form.get("client_secret")).toBe("client-secret");
    expect(requests[0]!.form.get("grant_type")).toBe("client_credentials");
  });

  test("the JWT bearer assertion takes the same pinned path", async () => {
    const { privateKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
      publicKeyEncoding: { type: "spki", format: "pem" },
    });

    const token: string = await SMTPOAuthService.getAccessToken(
      config({
        providerType: OAuthProviderType.JWTBearer,
        clientSecret: privateKey,
      }),
    );

    expect(token).toBe("pinned-access-token");
    expect(resolverCalls).toEqual([]);
    expect(requests).toHaveLength(1);
    expect(requests[0]!.form.get("grant_type")).toBe(
      "urn:ietf:params:oauth:grant-type:jwt-bearer",
    );
    expect(requests[0]!.form.get("assertion")).toBeTruthy();
  });

  /*
   * Pinning covers the validated host only. A redirect would carry the
   * credentials to a host nobody checked, so it comes back as the answer.
   */
  test("a redirect is reported, not followed", async () => {
    await expect(
      SMTPOAuthService.getAccessToken(
        config({ tokenUrl: tokenUrl("/redirect") }),
      ),
    ).rejects.toThrow("Failed to authenticate with OAuth provider: 302");

    expect(requests).toHaveLength(1);
    expect(requests[0]!.path).toBe("/redirect");
    expect(guardSpy).toHaveBeenCalledTimes(1);
  });

  /*
   * The transport's own timeout only bounds how long the socket sits idle.
   * A token endpoint that trickles its answer must still be cut off at the
   * deadline, or it holds the mail worker for as long as it likes.
   */
  test("a token endpoint that trickles its answer is cut off at the deadline", async () => {
    const service: { FETCH_TIMEOUT_MS: number } =
      SMTPOAuthService as unknown as { FETCH_TIMEOUT_MS: number };
    const originalTimeout: number = service.FETCH_TIMEOUT_MS;
    service.FETCH_TIMEOUT_MS = 500;

    try {
      const startedAt: number = Date.now();

      await expect(
        SMTPOAuthService.getAccessToken(
          config({ tokenUrl: tokenUrl("/trickle") }),
        ),
      ).rejects.toThrow("OAuth token request timed out after 500ms");

      expect(Date.now() - startedAt).toBeLessThan(5000);
    } finally {
      service.FETCH_TIMEOUT_MS = originalTimeout;
    }

    expect(requests).toHaveLength(1);
  }, 20000);
});
