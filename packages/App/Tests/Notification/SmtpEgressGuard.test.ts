import SMTPOAuthService from "../../FeatureSet/Notification/Services/SMTPOAuthService";
import { TransporterPool } from "../../FeatureSet/Notification/Services/MailService";
import Hostname from "Common/Types/API/Hostname";
import URL from "Common/Types/API/URL";
import Email from "Common/Types/Email";
import EmailServer from "Common/Types/Email/EmailServer";
import OAuthProviderType from "Common/Types/Email/OAuthProviderType";
import SMTPAuthenticationType from "Common/Types/Email/SMTPAuthenticationType";
import ObjectID from "Common/Types/ObjectID";
import Port from "Common/Types/Port";
import GlobalCache from "Common/Server/Infrastructure/GlobalCache";
import OAuth2TokenClient, {
  OAuth2TokenHttpRequest,
} from "Common/Server/Utils/Workflow/OAuth2TokenClient";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import { startEachTestOnSelfHostedEgressPolicy } from "Common/Tests/Server/Utils/EgressPolicyEnvironment";
import { generateKeyPairSync } from "crypto";
import dns from "dns";
import http from "http";
import https from "https";
import nodemailer from "nodemailer";

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
  // SMTPOAuthService keys its token cache with EncryptionSecret.
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
    default: { debug: jest.fn(), error: jest.fn() },
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

jest.mock(
  "../../FeatureSet/Notification/Services/MailProviders/MicrosoftGraphMailProvider",
  () => {
    return { __esModule: true, default: jest.fn() };
  },
);

/*
 * Two tenant-controlled SMTP sinks, both reachable from ProjectSmtpConfig,
 * which any project member can write:
 *
 *  - tokenUrl, which SMTPOAuthService POSTs the OAuth client_id and
 *    client_secret to, and whose response body is echoed back through
 *    POST /api/notification/smtp-config/test. Unvalidated, that is credential
 *    exfiltration plus a read-capable probe of the internal network — and an
 *    HTTP client that follows redirects would let a validated first hop send
 *    the secret on to one that was never checked.
 *
 *  - hostname/port, which nodemailer dials and then reports on: its "Invalid
 *    greeting. response=<raw bytes>" lands in EmailLog.statusMessage and is
 *    shown to the project, which is an internal port scanner with banner
 *    disclosure.
 *
 * DNS is mocked throughout so nothing here touches the network.
 */

type LookupSpy = jest.SpiedFunction<
  (
    hostname: string,
    options: { all: true },
  ) => Promise<Array<{ address: string; family: number }>>
>;

let lookupSpy: LookupSpy;
// Every outbound HTTP(S) request made through node's http/https modules.
let requestSpies: Array<jest.SpyInstance>;

function makeOAuthConfig(tokenUrl: string): {
  clientId: string;
  clientSecret: string;
  tokenUrl: URL;
  scope: string;
  username: string;
  providerType: OAuthProviderType;
} {
  return {
    clientId: "client-id",
    clientSecret: "client-secret",
    tokenUrl: URL.fromString(tokenUrl),
    scope: "https://outlook.office365.com/.default",
    username: "sender@example.com",
    providerType: OAuthProviderType.ClientCredentials,
  };
}

/*
 * Refusals are asserted with the detail a self-hosted install shows; the
 * SaaS wording is tested on its own below. CI exports BILLING_ENABLED=true.
 */
startEachTestOnSelfHostedEgressPolicy();

beforeEach(() => {
  lookupSpy = jest.spyOn(dns.promises, "lookup") as unknown as LookupSpy;

  lookupSpy.mockImplementation((hostname: string) => {
    if (hostname === "localhost") {
      return Promise.resolve([{ address: "127.0.0.1", family: 4 }]);
    }

    return Promise.resolve([{ address: "93.184.216.34", family: 4 }]);
  });

  // The token cache must miss so every call reaches the network path.
  jest.spyOn(GlobalCache, "getJSONObject").mockResolvedValue(null);
  jest.spyOn(GlobalCache, "setJSON").mockResolvedValue(undefined as never);

  /*
   * The token request goes out through axios' node adapter, which calls
   * http.request / https.request. Nothing here may get that far; a call
   * fails loudly instead of reaching the network.
   */
  requestSpies = [http, https].map((module: typeof http | typeof https) => {
    return jest.spyOn(module, "request").mockImplementation((() => {
      throw new Error("No request should have been sent.");
    }) as never);
  });
});

function expectNoRequestSent(): void {
  for (const spy of requestSpies) {
    expect(spy).not.toHaveBeenCalled();
  }
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("SMTP OAuth token URL is guarded", () => {
  const blockedTokenUrls: Array<string> = [
    "http://127.0.0.1:8080/token",
    "http://localhost:8080/token",
    "http://169.254.169.254/latest/meta-data/",
    "http://169.254.169.254:80/token",
    "http://[::1]:8080/token",
    "http://0.0.0.0/token",
  ];

  test.each(blockedTokenUrls)(
    "never sends the client secret to %s",
    async (tokenUrl: string) => {
      await expect(
        SMTPOAuthService.getAccessToken(makeOAuthConfig(tokenUrl)),
      ).rejects.toThrow("OAuth token URL host");

      expectNoRequestSent();
    },
  );

  test("a hostname that resolves to the metadata address is refused", async () => {
    lookupSpy.mockResolvedValue([{ address: "169.254.169.254", family: 4 }]);

    await expect(
      SMTPOAuthService.getAccessToken(
        makeOAuthConfig("https://login.attacker.example/token"),
      ),
    ).rejects.toThrow(
      "OAuth token URL host login.attacker.example resolves to 169.254.169.254, which is not allowed",
    );

    expectNoRequestSent();
  });

  /*
   * The transport itself (pinning, the redirect refusal) runs for real over
   * a socket in SmtpOAuthTokenPinning.test.ts. This pins that the SMTP token
   * request is handed to it, with a wall-clock deadline attached.
   */
  test("a public token URL goes out through the egress-guarded, pinned token transport", async () => {
    const transportSpy: jest.SpyInstance = jest
      .spyOn(OAuth2TokenClient, "sendThroughEgressGuard")
      .mockResolvedValue({
        statusCode: 200,
        bodyText: JSON.stringify({
          access_token: "token",
          token_type: "Bearer",
          expires_in: 3600,
        }),
        headers: {},
      });

    const token: string = await SMTPOAuthService.getAccessToken(
      makeOAuthConfig("https://login.microsoftonline.com/tenant/oauth2/token"),
    );

    expect(token).toBe("token");
    expect(transportSpy).toHaveBeenCalledTimes(1);

    const request: OAuth2TokenHttpRequest = transportSpy.mock
      .calls[0]![0] as OAuth2TokenHttpRequest;

    expect(request.url).toBe(
      "https://login.microsoftonline.com/tenant/oauth2/token",
    );
    expect(request.body).toEqual({
      client_id: "client-id",
      client_secret: "client-secret",
      scope: "https://outlook.office365.com/.default",
      grant_type: "client_credentials",
    });
    expect(request.signal).toBeInstanceOf(AbortSignal);
  });

  test("the JWT Bearer flow is guarded on the same path", async () => {
    /*
     * A real key, so the assertion is signed and the only thing left that can
     * refuse the request is the egress guard. With a fake key, signing throws
     * first and the test would pass even if the guard were removed.
     */
    const { privateKey } = generateKeyPairSync("rsa", {
      modulusLength: 2048,
      privateKeyEncoding: { type: "pkcs8", format: "pem" },
      publicKeyEncoding: { type: "spki", format: "pem" },
    });

    await expect(
      SMTPOAuthService.getAccessToken({
        ...makeOAuthConfig("http://169.254.169.254/token"),
        providerType: OAuthProviderType.JWTBearer,
        clientSecret: privateKey,
      }),
    ).rejects.toThrow("OAuth token URL host 169.254.169.254 is not allowed");

    expectNoRequestSent();
  });
});

describe("custom SMTP hosts are guarded before nodemailer dials them", () => {
  function makeProjectEmailServer(host: string): EmailServer {
    return {
      // An id means "this came from a project's ProjectSmtpConfig".
      id: new ObjectID("smtp-config-1"),
      host: new Hostname(host),
      port: new Port(25),
      username: "user",
      password: "pass",
      fromEmail: new Email("noreply@example.com"),
      fromName: "OneUptime",
      secure: false,
      authType: SMTPAuthenticationType.UsernamePassword,
    };
  }

  let createTransportSpy: jest.SpyInstance;

  beforeEach(() => {
    createTransportSpy = jest
      .spyOn(nodemailer, "createTransport")
      .mockReturnValue({
        sendMail: () => {
          return Promise.resolve({});
        },
        close: () => {
          return undefined;
        },
      } as never);
  });

  const blockedHosts: Array<string> = [
    "127.0.0.1",
    "localhost",
    "169.254.169.254",
    "0.0.0.0",
  ];

  test.each(blockedHosts)(
    "refuses to build a transporter for %s",
    async (host: string) => {
      await expect(
        TransporterPool.getTransporter(makeProjectEmailServer(host), {}),
      ).rejects.toThrow();

      expect(createTransportSpy).not.toHaveBeenCalled();
    },
  );

  test("a public mail server is still allowed", async () => {
    await expect(
      TransporterPool.getTransporter(
        makeProjectEmailServer("smtp.sendgrid.net"),
        {},
      ),
    ).resolves.toBeDefined();

    expect(createTransportSpy).toHaveBeenCalled();
  });

  test("the operator's global mail server is exempt", async () => {
    /*
     * No id — this is the deployment's own SMTP config, not a tenant's. A
     * self-hosted install pointing it at an internal relay is normal.
     */
    const globalServer: EmailServer = makeProjectEmailServer("127.0.0.1");
    delete (globalServer as { id?: ObjectID | undefined }).id;

    await expect(
      TransporterPool.getTransporter(globalServer, {}),
    ).resolves.toBeDefined();

    expect(createTransportSpy).toHaveBeenCalled();
  });

  /*
   * The refusal becomes EmailLog.statusMessage and the SMTP test endpoint's
   * response, both readable by project members. On SaaS it must not say
   * whether the name they typed exists inside OneUptime's network, or where
   * it points; a self-hosted operator still gets the diagnosis.
   */
  describe("what the refusal says about the configured host", () => {
    async function refusalFor(host: string): Promise<string> {
      try {
        await TransporterPool.getTransporter(makeProjectEmailServer(host), {});
      } catch (err) {
        return (err as Error).message;
      }

      throw new Error(`Expected ${host} to be refused.`);
    }

    async function refusalsForTheSameName(): Promise<Array<string>> {
      lookupSpy.mockRejectedValue(new Error("getaddrinfo ENOTFOUND redis"));
      const missing: string = await refusalFor("redis");

      lookupSpy.mockResolvedValue([{ address: "10.96.0.9", family: 4 }]);
      const internal: string = await refusalFor("redis");

      lookupSpy.mockResolvedValue([{ address: "127.0.0.1", family: 4 }]);
      const loopback: string = await refusalFor("redis");

      return [missing, internal, loopback];
    }

    test("on SaaS a missing name and an internal name are refused identically", async () => {
      process.env["BILLING_ENABLED"] = "true";

      const refusals: Array<string> = await refusalsForTheSameName();

      expect(refusals).toEqual([
        "SMTP server host redis could not be reached.",
        "SMTP server host redis could not be reached.",
        "SMTP server host redis could not be reached.",
      ]);
      expect(createTransportSpy).not.toHaveBeenCalled();
    });

    test("on a self-hosted install the operator is told what went wrong", async () => {
      // Private ranges are reachable here, so only DNS and loopback refuse.
      lookupSpy.mockRejectedValue(new Error("getaddrinfo ENOTFOUND redis"));
      expect(await refusalFor("redis")).toBe(
        "Could not resolve smtp server host redis: getaddrinfo ENOTFOUND redis",
      );

      lookupSpy.mockResolvedValue([{ address: "127.0.0.1", family: 4 }]);
      expect(await refusalFor("redis")).toBe(
        "SMTP server host redis resolves to 127.0.0.1, which is not allowed: loopback address.",
      );
    });
  });
});
