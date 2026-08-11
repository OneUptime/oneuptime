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
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import dns from "dns";
import nodemailer from "nodemailer";

/*
 * Two tenant-controlled SMTP sinks, both reachable from ProjectSmtpConfig,
 * which any project member can write:
 *
 *  - tokenUrl, which SMTPOAuthService POSTs the OAuth client_id and
 *    client_secret to, and whose response body is echoed back through
 *    POST /api/notification/smtp-config/test. Unvalidated, that is credential
 *    exfiltration plus a read-capable probe of the internal network — and node
 *    fetch follows redirects by default, so validating the first hop is not
 *    enough on its own.
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
let fetchSpy: jest.SpyInstance;

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

  fetchSpy = jest.spyOn(globalThis, "fetch").mockResolvedValue({
    ok: true,
    status: 200,
    json: () => {
      return Promise.resolve({
        access_token: "token",
        token_type: "Bearer",
        expires_in: 3600,
      });
    },
    text: () => {
      return Promise.resolve("");
    },
  } as unknown as Response);
});

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
      ).rejects.toThrow();

      expect(fetchSpy).not.toHaveBeenCalled();
    },
  );

  test("a hostname that resolves to the metadata address is refused", async () => {
    lookupSpy.mockResolvedValue([{ address: "169.254.169.254", family: 4 }]);

    await expect(
      SMTPOAuthService.getAccessToken(
        makeOAuthConfig("https://login.attacker.example/token"),
      ),
    ).rejects.toThrow();

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test("a public token URL is fetched with redirects set to manual", async () => {
    const token: string = await SMTPOAuthService.getAccessToken(
      makeOAuthConfig("https://login.microsoftonline.com/tenant/oauth2/token"),
    );

    expect(token).toBe("token");
    expect(fetchSpy).toHaveBeenCalled();

    const requestInit: RequestInit = fetchSpy.mock.calls[0]![1] as RequestInit;

    /*
     * Without this, a validated host can 3xx the credentials onward to one
     * that was never checked.
     */
    expect(requestInit.redirect).toBe("manual");
  });

  test("the JWT Bearer flow is guarded on the same path", async () => {
    await expect(
      SMTPOAuthService.getAccessToken({
        ...makeOAuthConfig("http://169.254.169.254/token"),
        providerType: OAuthProviderType.JWTBearer,
        clientSecret:
          "-----BEGIN PRIVATE KEY-----\nnot-a-real-key\n-----END PRIVATE KEY-----",
      }),
    ).rejects.toThrow();

    expect(fetchSpy).not.toHaveBeenCalled();
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
});
