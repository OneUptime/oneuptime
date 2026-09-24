import MicrosoftGraphMailProvider from "../../FeatureSet/Notification/Services/MailProviders/MicrosoftGraphMailProvider";
import MailService, {
  TransporterPool,
} from "../../FeatureSet/Notification/Services/MailService";
import SMTPOAuthService, {
  SMTPOAuthConfig,
} from "../../FeatureSet/Notification/Services/SMTPOAuthService";
import Hostname from "Common/Types/API/Hostname";
import URL from "Common/Types/API/URL";
import Email from "Common/Types/Email";
import EmailMessage from "Common/Types/Email/EmailMessage";
import EmailServer from "Common/Types/Email/EmailServer";
import MailTransportType from "Common/Types/Email/MailTransportType";
import OAuthProviderType from "Common/Types/Email/OAuthProviderType";
import SMTPAuthenticationType from "Common/Types/Email/SMTPAuthenticationType";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import Port from "Common/Types/Port";
import GlobalCache from "Common/Server/Infrastructure/GlobalCache";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import dns from "dns";
import nodemailer from "nodemailer";
import SMTPTransport from "nodemailer/lib/smtp-transport";

jest.mock("Common/Server/Infrastructure/GlobalCache", () => {
  return {
    __esModule: true,
    default: {
      getJSONObject: jest.fn(),
      setJSON: jest.fn(),
    },
  };
});

jest.mock("../../FeatureSet/Notification/Config", () => {
  return {
    getEmailServerType: jest.fn(),
    getGlobalSMTPConfig: jest.fn(),
    getSendgridConfig: jest.fn(),
  };
});

jest.mock("Common/Server/EnvironmentConfig", () => {
  return { IsDevelopment: false, EncryptionSecret: "test-encryption-secret" };
});

jest.mock("Common/Server/Services/EmailLogService", () => {
  return { __esModule: true, default: { create: jest.fn() } };
});

jest.mock("Common/Server/Services/UserOnCallLogTimelineService", () => {
  return { __esModule: true, default: { updateOneById: jest.fn() } };
});

jest.mock("Common/Models/DatabaseModels/EmailLog", () => {
  return { __esModule: true, default: jest.fn() };
});

jest.mock("Common/Models/DatabaseModels/GlobalConfig", () => {
  return {
    EmailServerType: { Sendgrid: "Sendgrid", CustomSMTP: "Custom SMTP" },
  };
});

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    EXTERNAL_FAULT: {},
    default: {
      debug: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
      info: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Utils/Telemetry/AppMetrics", () => {
  return {
    __esModule: true,
    default: {
      getNotificationCounter: () => {
        return { add: jest.fn() };
      },
      getNotificationDuration: () => {
        return { record: jest.fn() };
      },
    },
  };
});

/*
 * Two projects on one OneUptime instance must never authenticate as each
 * other. Before this fix, both credential caches in the Notification feature
 * set were keyed only on values that are not secret:
 *
 *  - TransporterPool keyed pooled (already authenticated) nodemailer
 *    transporters on host:port:username:mode:authType. Project B could copy
 *    project A's host, port and username ("apikey" on SendGrid, the sender
 *    address on O365/Gmail), give any password, and send through A's
 *    authenticated SMTP session.
 *
 *  - SMTPOAuthService keyed its Redis token cache on
 *    tokenUrl:clientId:username. Project B could copy those, give any secret,
 *    and receive A's access token. It could then send as any mailbox that
 *    token covers through Microsoft Graph, or point its own SMTP host at a
 *    server it controls and read the token off the XOAUTH2 exchange.
 *
 * Everything outside the process (DNS, the token endpoint, Microsoft Graph,
 * the SMTP server and Redis) is faked here. The keying logic under test is
 * real.
 */

const IDLE_TTL_MS: number = 10 * 60 * 1000; // TransporterPool.IDLE_TTL_MS
const MAX_CONCURRENT_CONNECTIONS: number = 100; // TransporterPool.MAX_CONCURRENT_CONNECTIONS

const TOKEN_URL: string =
  "https://login.microsoftonline.com/victim-tenant/oauth2/v2.0/token";
const GRAPH_SCOPE: string = "https://graph.microsoft.com/.default";
const SMTP_SCOPE: string = "https://outlook.office365.com/.default";

interface FakeTransporter {
  options: SMTPTransport.Options;
  sendMail: jest.Mock;
  close: jest.Mock;
}

let transporters: Array<FakeTransporter>;
let redis: Map<string, JSONObject>;
let tokenRequests: Array<URLSearchParams>;
let graphAuthorizations: Array<string>;
let fetchSpy: jest.SpyInstance;

function projectSmtpServer(data: {
  id: string;
  password: string;
  host?: string | undefined;
  port?: number | undefined;
  secure?: boolean | undefined;
  username?: string | undefined;
}): EmailServer {
  return {
    id: new ObjectID(data.id),
    transportType: MailTransportType.SMTP,
    host: new Hostname(data.host || "smtp.sendgrid.net"),
    port: new Port(data.port || 587),
    secure: data.secure === undefined ? true : data.secure,
    username: data.username || "apikey",
    password: data.password,
    fromEmail: new Email("alerts@project-a.example.com"),
    fromName: "Alerts",
    authType: SMTPAuthenticationType.UsernamePassword,
  };
}

function oauthServer(data: {
  id: string;
  clientSecret: string;
  transportType: MailTransportType;
  host?: string | undefined;
  username?: string | undefined;
  fromEmail?: string | undefined;
}): EmailServer {
  const isGraph: boolean =
    data.transportType === MailTransportType.MicrosoftGraph;

  return {
    id: new ObjectID(data.id),
    transportType: data.transportType,
    host: isGraph ? undefined : new Hostname(data.host || "smtp.office365.com"),
    port: isGraph ? undefined : new Port(587),
    secure: isGraph ? undefined : true,
    username: data.username,
    password: undefined,
    fromEmail: new Email(data.fromEmail || "alerts@project-a.example.com"),
    fromName: "Alerts",
    authType: SMTPAuthenticationType.OAuth,
    clientId: "victim-client-id",
    clientSecret: data.clientSecret,
    tokenUrl: URL.fromString(TOKEN_URL),
    scope: isGraph ? GRAPH_SCOPE : SMTP_SCOPE,
    oauthProviderType: OAuthProviderType.ClientCredentials,
  };
}

function oauthConfig(overrides?: Partial<SMTPOAuthConfig>): SMTPOAuthConfig {
  return {
    configId: "config-a",
    clientId: "victim-client-id",
    clientSecret: "victim-secret",
    tokenUrl: URL.fromString(TOKEN_URL),
    scope: GRAPH_SCOPE,
    username: "alerts@project-a.example.com",
    providerType: OAuthProviderType.ClientCredentials,
    ...overrides,
  };
}

function testMail(): EmailMessage {
  return {
    toEmail: new Email("recipient@example.com"),
    subject: "Test",
    body: "<p>Test</p>",
    vars: {},
  };
}

/*
 * The pool key for a caller that asks for no particular connection timeout,
 * which is every real send. The timeout is the other half of the key (see
 * MailTransporterPoolTimeout.test.ts); holding it constant here is what keeps
 * these tests about credentials, which is what they are for.
 */
function poolKey(emailServer: EmailServer): string {
  return TransporterPool["getPoolKey"](emailServer, {});
}

function tokenCacheKey(config: SMTPOAuthConfig): string {
  return SMTPOAuthService["getCacheKey"](config);
}

function mockNow(): { advance: (ms: number) => void } {
  let now: number = Date.now();
  jest.spyOn(Date, "now").mockImplementation(() => {
    return now;
  });

  return {
    advance: (ms: number): void => {
      now += ms;
    },
  };
}

beforeEach(() => {
  // The module-level mocks above keep their call history across tests.
  jest.clearAllMocks();

  transporters = [];
  redis = new Map<string, JSONObject>();
  tokenRequests = [];
  graphAuthorizations = [];

  jest
    .spyOn(dns.promises, "lookup")
    .mockResolvedValue([{ address: "93.184.216.34", family: 4 }] as never);

  jest.spyOn(nodemailer, "createTransport").mockImplementation(((
    options: SMTPTransport.Options,
  ) => {
    const transporter: FakeTransporter = {
      options,
      sendMail: jest.fn(() => {
        return Promise.resolve({ messageId: "message-id" });
      }),
      close: jest.fn(),
    };
    transporters.push(transporter);
    return transporter;
  }) as never);

  // An in-memory stand-in for the Redis token cache.
  jest
    .spyOn(GlobalCache, "getJSONObject")
    .mockImplementation((namespace: string, key: string) => {
      return Promise.resolve(redis.get(`${namespace}:${key}`) || null);
    });
  jest
    .spyOn(GlobalCache, "setJSON")
    .mockImplementation((namespace: string, key: string, value: JSONObject) => {
      redis.set(`${namespace}:${key}`, value);
      return Promise.resolve();
    });

  /*
   * The token endpoint issues a token named after the secret it was given,
   * so each assertion can tell whose credentials a token came from.
   * Microsoft Graph accepts every send and records the bearer token used.
   */
  fetchSpy = jest
    .spyOn(globalThis, "fetch")
    .mockImplementation(
      (input: Parameters<typeof fetch>[0], init?: RequestInit | undefined) => {
        const url: string = input.toString();

        if (url === TOKEN_URL) {
          const params: URLSearchParams = new URLSearchParams(
            init?.body as string,
          );
          tokenRequests.push(params);

          return Promise.resolve({
            ok: true,
            status: 200,
            json: () => {
              return Promise.resolve({
                access_token: `token-issued-for:${params.get("client_secret")}`,
                token_type: "Bearer",
                expires_in: 3600,
              });
            },
            text: () => {
              return Promise.resolve("");
            },
          } as unknown as Response);
        }

        graphAuthorizations.push(
          (init?.headers as Record<string, string>)["Authorization"] || "",
        );

        return Promise.resolve({
          status: 202,
          headers: {
            get: () => {
              return null;
            },
          },
          text: () => {
            return Promise.resolve("");
          },
        } as unknown as Response);
      },
    );
});

afterEach(async () => {
  await TransporterPool.cleanup();
  jest.restoreAllMocks();
});

describe("pooled SMTP transporters are not shared across credentials", () => {
  test("a project that copies another's host, port and username but not its password gets its own transporter", async () => {
    const victim: EmailServer = projectSmtpServer({
      id: "config-a",
      password: "SG.victim-api-key",
    });
    const attacker: EmailServer = projectSmtpServer({
      id: "config-b",
      password: "any-junk-password",
    });

    await MailService.send(testMail(), { emailServer: victim });
    await MailService.send(testMail(), { emailServer: attacker });

    expect(transporters).toHaveLength(2);

    const [victimTransporter, attackerTransporter] = transporters as [
      FakeTransporter,
      FakeTransporter,
    ];

    expect(victimTransporter.options.auth).toEqual({
      user: "apikey",
      pass: "SG.victim-api-key",
    });
    expect(attackerTransporter.options.auth).toEqual({
      user: "apikey",
      pass: "any-junk-password",
    });

    // The attacker's mail never rode on the victim's authenticated session.
    expect(victimTransporter.sendMail).toHaveBeenCalledTimes(1);
    expect(attackerTransporter.sendMail).toHaveBeenCalledTimes(1);
  });

  test("editing a config's password gives it a new transporter instead of the one authenticated with the old password", async () => {
    const a: unknown = await TransporterPool.getTransporter(
      projectSmtpServer({ id: "config-a", password: "password-one" }),
      {},
    );
    const b: unknown = await TransporterPool.getTransporter(
      projectSmtpServer({ id: "config-a", password: "password-two" }),
      {},
    );

    expect(a).not.toBe(b);
    expect(transporters).toHaveLength(2);
    expect(transporters[1]!.options.auth).toEqual({
      user: "apikey",
      pass: "password-two",
    });
  });

  test("two configs with identical credentials but different ids never share a transporter", async () => {
    const a: unknown = await TransporterPool.getTransporter(
      projectSmtpServer({ id: "config-a", password: "same-password" }),
      {},
    );
    const b: unknown = await TransporterPool.getTransporter(
      projectSmtpServer({ id: "config-b", password: "same-password" }),
      {},
    );

    expect(a).not.toBe(b);
    expect(transporters).toHaveLength(2);
  });

  test("a project config never reuses the operator's global transporter", async () => {
    const global: EmailServer = projectSmtpServer({
      id: "unused",
      password: "operator-password",
    });
    delete (global as { id?: ObjectID | undefined }).id;

    const globalTransporter: unknown = await TransporterPool.getTransporter(
      global,
      {},
    );
    const projectTransporter: unknown = await TransporterPool.getTransporter(
      projectSmtpServer({ id: "config-b", password: "operator-password" }),
      {},
    );

    expect(globalTransporter).not.toBe(projectTransporter);
  });

  test("the same config with the same credentials still reuses its pooled transporter", async () => {
    const a: unknown = await TransporterPool.getTransporter(
      projectSmtpServer({ id: "config-a", password: "same-password" }),
      {},
    );
    const b: unknown = await TransporterPool.getTransporter(
      projectSmtpServer({ id: "config-a", password: "same-password" }),
      {},
    );

    expect(a).toBe(b);
    expect(transporters).toHaveLength(1);
  });

  test("the requested secure flag is part of the key, so a certificate-checking config never reuses a non-checking transporter", async () => {
    // Port 465 is implicit TLS either way; only certificate checking differs.
    await TransporterPool.getTransporter(
      projectSmtpServer({
        id: "config-a",
        password: "p",
        port: 465,
        secure: false,
      }),
      {},
    );
    await TransporterPool.getTransporter(
      projectSmtpServer({
        id: "config-a",
        password: "p",
        port: 465,
        secure: true,
      }),
      {},
    );

    expect(transporters).toHaveLength(2);
    expect(transporters[0]!.options.tls).toEqual({
      rejectUnauthorized: false,
    });
    expect(transporters[1]!.options.tls).toBeUndefined();
  });

  test.each([
    ["password", { password: "other" }],
    ["id", { id: new ObjectID("config-other") }],
    ["username", { username: "other-user" }],
    ["host", { host: new Hostname("smtp.other.example.com") }],
    ["port", { port: new Port(2525) }],
    ["secure flag", { secure: false }],
    ["auth type", { authType: SMTPAuthenticationType.None }],
    ["client secret", { clientSecret: "other-secret" }],
  ] as Array<[string, Partial<EmailServer>]>)(
    "changing the %s changes the pool key",
    (_field: string, change: Partial<EmailServer>) => {
      const base: EmailServer = projectSmtpServer({
        id: "config-a",
        password: "password",
      });

      expect(poolKey({ ...base, ...change })).not.toBe(poolKey(base));
    },
  );

  test("a separator inside a tenant-supplied value cannot make two keys collide", () => {
    const a: EmailServer = {
      ...projectSmtpServer({ id: "config-a", password: "b" }),
      username: "a:",
    };
    const b: EmailServer = {
      ...projectSmtpServer({ id: "config-a", password: ":b" }),
      username: "a",
    };

    expect(poolKey(a)).not.toBe(poolKey(b));
  });

  test("the pool key holds no plaintext password", () => {
    const key: string = poolKey(
      projectSmtpServer({ id: "config-a", password: "SG.victim-api-key" }),
    );

    expect(key).not.toContain("SG.victim-api-key");
    expect(key).toMatch(/^[0-9a-f]{64}$/);
  });

  test("connection slots are counted per config, so one project cannot starve another that shares its host and username", async () => {
    const victim: EmailServer = projectSmtpServer({
      id: "config-a",
      password: "victim-password",
    });
    const attacker: EmailServer = projectSmtpServer({
      id: "config-b",
      password: "junk",
    });

    for (let i: number = 0; i < MAX_CONCURRENT_CONNECTIONS; i++) {
      await TransporterPool.acquireConnection(attacker);
    }

    const outcome: string = await Promise.race([
      TransporterPool.acquireConnection(victim).then(() => {
        return "acquired";
      }),
      new Promise<string>((resolve: (value: string) => void) => {
        setTimeout(() => {
          resolve("blocked");
        }, 250);
      }),
    ]);

    expect(outcome).toBe("acquired");
  });
});

describe("pooled SMTP transporters are evicted once idle", () => {
  test("an idle transporter is closed and a later send builds a fresh one", async () => {
    const clock: { advance: (ms: number) => void } = mockNow();
    const server: EmailServer = projectSmtpServer({
      id: "config-a",
      password: "password",
    });

    const first: unknown = await TransporterPool.getTransporter(server, {});
    clock.advance(IDLE_TTL_MS + 1);

    // Any later request sweeps the pool.
    await TransporterPool.getTransporter(
      projectSmtpServer({ id: "config-b", password: "other" }),
      {},
    );

    expect(transporters[0]!.close).toHaveBeenCalledTimes(1);

    const second: unknown = await TransporterPool.getTransporter(server, {});

    expect(second).not.toBe(first);
    expect(transporters).toHaveLength(3);
  });

  test("the same config sending again after going idle gets a fresh transporter, never the one just closed", async () => {
    const clock: { advance: (ms: number) => void } = mockNow();
    const server: EmailServer = projectSmtpServer({
      id: "config-a",
      password: "password",
    });

    await MailService.send(testMail(), { emailServer: server });
    clock.advance(IDLE_TTL_MS + 1);
    await MailService.send(testMail(), { emailServer: server });

    /*
     * A closed nodemailer pool drops new mail without ever calling back, so
     * handing out the transporter the sweep just closed would hang the send.
     */
    expect(transporters).toHaveLength(2);
    expect(transporters[0]!.close).toHaveBeenCalledTimes(1);
    expect(transporters[0]!.sendMail).toHaveBeenCalledTimes(1);
    expect(transporters[1]!.close).not.toHaveBeenCalled();
    expect(transporters[1]!.sendMail).toHaveBeenCalledTimes(1);
  });

  test("a transporter used within the idle window is kept", async () => {
    const clock: { advance: (ms: number) => void } = mockNow();
    const server: EmailServer = projectSmtpServer({
      id: "config-a",
      password: "password",
    });

    const first: unknown = await TransporterPool.getTransporter(server, {});
    clock.advance(IDLE_TTL_MS - 1);
    const second: unknown = await TransporterPool.getTransporter(server, {});
    clock.advance(IDLE_TTL_MS - 1);
    const third: unknown = await TransporterPool.getTransporter(server, {});

    expect(second).toBe(first);
    expect(third).toBe(first);
    expect(transporters[0]!.close).not.toHaveBeenCalled();
  });

  test("a transporter with a send in flight is never evicted, and its idle clock restarts when the send finishes", async () => {
    const clock: { advance: (ms: number) => void } = mockNow();
    const server: EmailServer = projectSmtpServer({
      id: "config-a",
      password: "password",
    });
    const other: EmailServer = projectSmtpServer({
      id: "config-b",
      password: "other",
    });

    await TransporterPool.getTransporter(server, {});
    await TransporterPool.acquireConnection(server);

    clock.advance(IDLE_TTL_MS * 3);
    await TransporterPool.getTransporter(other, {});

    expect(transporters[0]!.close).not.toHaveBeenCalled();

    TransporterPool.releaseConnection(server);
    clock.advance(IDLE_TTL_MS - 1);
    await TransporterPool.getTransporter(other, {});

    expect(transporters[0]!.close).not.toHaveBeenCalled();

    clock.advance(2);
    await TransporterPool.getTransporter(other, {});

    expect(transporters[0]!.close).toHaveBeenCalledTimes(1);
  });

  test("an edited config's old transporter is closed once idle", async () => {
    const clock: { advance: (ms: number) => void } = mockNow();

    await TransporterPool.getTransporter(
      projectSmtpServer({ id: "config-a", password: "old-password" }),
      {},
    );
    await TransporterPool.getTransporter(
      projectSmtpServer({ id: "config-a", password: "new-password" }),
      {},
    );

    clock.advance(IDLE_TTL_MS / 2);
    await TransporterPool.getTransporter(
      projectSmtpServer({ id: "config-a", password: "new-password" }),
      {},
    );
    clock.advance(IDLE_TTL_MS / 2 + 1);
    await TransporterPool.getTransporter(
      projectSmtpServer({ id: "config-a", password: "new-password" }),
      {},
    );

    expect(transporters[0]!.close).toHaveBeenCalledTimes(1);
    expect(transporters[1]!.close).not.toHaveBeenCalled();
  });
});

describe("OAuth tokens are not shared across credentials", () => {
  test("a config that copies another's token URL, client id and username but not its secret gets no cached token", async () => {
    const victimToken: string =
      await SMTPOAuthService.getAccessToken(oauthConfig());
    expect(victimToken).toBe("token-issued-for:victim-secret");

    const attackerToken: string = await SMTPOAuthService.getAccessToken(
      oauthConfig({ configId: "config-b", clientSecret: "junk" }),
    );

    expect(attackerToken).toBe("token-issued-for:junk");
    expect(tokenRequests).toHaveLength(2);
    expect(tokenRequests[1]!.get("client_secret")).toBe("junk");
  });

  test("the same config reuses its cached token", async () => {
    await SMTPOAuthService.getAccessToken(oauthConfig());
    const cached: string = await SMTPOAuthService.getAccessToken(oauthConfig());

    expect(cached).toBe("token-issued-for:victim-secret");
    expect(tokenRequests).toHaveLength(1);
  });

  test("the same secret under a different config id is not shared", async () => {
    await SMTPOAuthService.getAccessToken(oauthConfig());
    await SMTPOAuthService.getAccessToken(
      oauthConfig({ configId: "config-b" }),
    );

    expect(tokenRequests).toHaveLength(2);
  });

  test.each([
    ["client secret", { clientSecret: "other-secret" }],
    ["config id", { configId: "config-other" }],
    ["config id (global)", { configId: undefined }],
    ["scope", { scope: SMTP_SCOPE }],
    ["provider type", { providerType: OAuthProviderType.JWTBearer }],
    ["client id", { clientId: "other-client" }],
    [
      "token URL",
      {
        tokenUrl: URL.fromString(
          "https://login.microsoftonline.com/other-tenant/oauth2/v2.0/token",
        ),
      },
    ],
    ["username", { username: "other@project-a.example.com" }],
  ] as Array<[string, Partial<SMTPOAuthConfig>]>)(
    "changing the %s changes the token cache key",
    (_field: string, change: Partial<SMTPOAuthConfig>) => {
      expect(tokenCacheKey(oauthConfig(change))).not.toBe(
        tokenCacheKey(oauthConfig()),
      );
    },
  );

  test("a separator inside a tenant-supplied value cannot make two keys collide", () => {
    expect(
      tokenCacheKey(oauthConfig({ clientId: "a:b", username: "c" })),
    ).not.toBe(tokenCacheKey(oauthConfig({ clientId: "a", username: "b:c" })));
  });

  test("Redis never sees the client secret or the token URL in a key", async () => {
    await SMTPOAuthService.getAccessToken(oauthConfig());

    const keys: Array<string> = Array.from(redis.keys());

    expect(keys).toHaveLength(1);
    expect(keys[0]).not.toContain("victim-secret");
    expect(keys[0]).not.toContain(TOKEN_URL);
    expect(keys[0]).toMatch(/^smtp-oauth-tokens:[0-9a-f]{64}$/);
  });

  test("the JWT Bearer private key check runs before the cache is read", async () => {
    // Even if every lookup would hit, a non-PEM secret is refused first.
    const getJSONObject: jest.SpyInstance = jest
      .spyOn(GlobalCache, "getJSONObject")
      .mockResolvedValue({
        accessToken: "someone-elses-token",
        expiresAt: Date.now() + 3600 * 1000,
      });

    await expect(
      SMTPOAuthService.getAccessToken(
        oauthConfig({
          providerType: OAuthProviderType.JWTBearer,
          clientSecret: "not-a-private-key",
        }),
      ),
    ).rejects.toThrow("private key in PEM format");

    expect(getJSONObject).not.toHaveBeenCalled();
  });

  test("the JWT Bearer subject check runs before the cache is read", async () => {
    const getJSONObject: jest.SpyInstance = jest
      .spyOn(GlobalCache, "getJSONObject")
      .mockResolvedValue({
        accessToken: "someone-elses-token",
        expiresAt: Date.now() + 3600 * 1000,
      });

    const config: SMTPOAuthConfig = oauthConfig({
      providerType: OAuthProviderType.JWTBearer,
      clientSecret:
        "-----BEGIN PRIVATE KEY-----\nnot-a-real-key\n-----END PRIVATE KEY-----",
    });
    delete config.username;

    await expect(SMTPOAuthService.getAccessToken(config)).rejects.toThrow(
      "Username (subject) is required",
    );

    expect(getJSONObject).not.toHaveBeenCalled();
  });
});

describe("OAuth mail transports do not hand one project's token to another", () => {
  test("Microsoft Graph: a copied token URL, client id and sender with a junk secret does not send with the victim's token", async () => {
    const victim: EmailServer = oauthServer({
      id: "config-a",
      clientSecret: "victim-secret",
      transportType: MailTransportType.MicrosoftGraph,
      fromEmail: "alerts@project-a.example.com",
    });

    /*
     * The attacker's username matches the victim's cache key (the Graph
     * provider falls back to fromEmail for it), and fromEmail is any mailbox
     * in the victim's tenant.
     */
    const attacker: EmailServer = oauthServer({
      id: "config-b",
      clientSecret: "junk",
      transportType: MailTransportType.MicrosoftGraph,
      username: "alerts@project-a.example.com",
      fromEmail: "ceo@project-a.example.com",
    });

    await MailService.send(testMail(), { emailServer: victim });
    await MailService.send(testMail(), { emailServer: attacker });

    expect(graphAuthorizations).toEqual([
      "Bearer token-issued-for:victim-secret",
      "Bearer token-issued-for:junk",
    ]);
  });

  test("SMTP XOAUTH2: a copied token URL, client id and username with a junk secret does not send the victim's token to the attacker's SMTP host", async () => {
    const victim: EmailServer = oauthServer({
      id: "config-a",
      clientSecret: "victim-secret",
      transportType: MailTransportType.SMTP,
      username: "alerts@project-a.example.com",
    });

    const attacker: EmailServer = oauthServer({
      id: "config-b",
      clientSecret: "junk",
      transportType: MailTransportType.SMTP,
      username: "alerts@project-a.example.com",
      host: "smtp.attacker.example.com",
    });

    await MailService.send(testMail(), { emailServer: victim });
    await MailService.send(testMail(), { emailServer: attacker });

    expect(transporters).toHaveLength(2);

    const attackerTransporter: FakeTransporter = transporters[1]!;

    expect(attackerTransporter.options.host).toBe("smtp.attacker.example.com");
    expect(attackerTransporter.options.auth).toMatchObject({
      accessToken: "token-issued-for:junk",
    });
    expect(transporters[0]!.options.auth).toMatchObject({
      accessToken: "token-issued-for:victim-secret",
    });
  });

  test("the config id reaches the token cache from both transports", async () => {
    const getAccessToken: jest.SpyInstance = jest.spyOn(
      SMTPOAuthService,
      "getAccessToken",
    );

    await MailService.send(testMail(), {
      emailServer: oauthServer({
        id: "config-graph",
        clientSecret: "s",
        transportType: MailTransportType.MicrosoftGraph,
      }),
    });
    await MailService.send(testMail(), {
      emailServer: oauthServer({
        id: "config-smtp",
        clientSecret: "s",
        transportType: MailTransportType.SMTP,
        username: "alerts@project-a.example.com",
      }),
    });

    expect(
      getAccessToken.mock.calls.map((call: Array<unknown>) => {
        return (call[0] as SMTPOAuthConfig).configId;
      }),
    ).toEqual([
      new ObjectID("config-graph").toString(),
      new ObjectID("config-smtp").toString(),
    ]);
    expect(fetchSpy).toHaveBeenCalled();
  });
});

describe("the Microsoft Graph per-mailbox gate is not shared across configs", () => {
  // MicrosoftGraphMailProvider.MAX_CONCURRENT_PER_MAILBOX.
  const GRAPH_MAX_CONCURRENT_PER_MAILBOX: number = 3;

  test("a project that fills the slots for another project's sender address does not hold up that project's mail", async () => {
    const victim: EmailServer = oauthServer({
      id: "config-a",
      clientSecret: "victim-secret",
      transportType: MailTransportType.MicrosoftGraph,
      fromEmail: "alerts@project-a.example.com",
    });

    // The sender address is printed on every email the victim sends.
    const attacker: EmailServer = oauthServer({
      id: "config-b",
      clientSecret: "junk",
      transportType: MailTransportType.MicrosoftGraph,
      fromEmail: "alerts@project-a.example.com",
    });

    // The attacker's token URL never answers, so each of its sends holds a slot.
    let releaseAttacker: (error: Error) => void = () => {};
    const attackerTokenFetch: Promise<string> = new Promise<string>(
      (_resolve: (token: string) => void, reject: (error: Error) => void) => {
        releaseAttacker = reject;
      },
    );
    // Keeps the rejection handled even when no attacker send waits on it.
    attackerTokenFetch.catch(() => {});

    jest
      .spyOn(SMTPOAuthService, "getAccessToken")
      .mockImplementation((config: SMTPOAuthConfig) => {
        return config.clientSecret === "junk"
          ? attackerTokenFetch
          : Promise.resolve("victim-token");
      });

    const provider: MicrosoftGraphMailProvider =
      new MicrosoftGraphMailProvider();

    const attackerSends: Array<Promise<void>> = Array.from(
      { length: GRAPH_MAX_CONCURRENT_PER_MAILBOX + 2 },
      () => {
        return provider.send(testMail(), attacker);
      },
    );

    const outcome: string = await Promise.race([
      provider.send(testMail(), victim).then(() => {
        return "sent";
      }),
      new Promise<string>((resolve: (value: string) => void) => {
        setTimeout(() => {
          resolve("blocked");
        }, 1000);
      }),
    ]);

    releaseAttacker(new Error("the attacker's token URL gave up"));
    await Promise.allSettled(attackerSends);

    expect(outcome).toBe("sent");
    expect(graphAuthorizations).toEqual(["Bearer victim-token"]);
  });
});
