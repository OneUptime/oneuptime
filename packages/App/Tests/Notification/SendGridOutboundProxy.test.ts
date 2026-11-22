import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { MailService } from "@sendgrid/mail";
import OutboundProxyAgents from "Common/Server/Utils/OutboundProxyAgents";
import {
  LocalHttpServer,
  PLAIN_CREDENTIALS,
  ProxyCredentials,
  RESERVED_CHARACTER_CREDENTIALS,
  clearOutboundProxyEnvironmentForEachTest,
  proxyUrlWithCredentials,
  signedInAs,
  useLocalHttpServers,
} from "Common/Tests/Server/TestingUtils/OutboundProxyFixture";
import Email from "Common/Types/Email";
import SendGridMailProvider from "../../FeatureSet/Notification/Services/MailProviders/SendGridMailProvider";

/*
 * SENDGRID'S MAIL GOES THROUGH THE OUTBOUND PROXY WITH THE PROXY'S REAL USER
 * NAME AND PASSWORD (issue #10442).
 *
 * @sendgrid/client sends with axios and left the outbound proxy to it, so a
 * proxy whose password holds an @, a : or a % - percent-encoded in
 * HTTPS_PROXY, as a URL must write it - was signed in to with the encoded
 * password, and refused every email with 407. The client a send uses is
 * routed now (SendGridMailProvider.routeThroughOutboundProxy). These send
 * through the real @sendgrid/mail to a proxy on this machine
 * (OutboundProxyFixture), which refuses every tunnel: who signed in to it,
 * and for where, is the point.
 */

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    EXTERNAL_FAULT: {},
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      error: jest.fn(),
      warn: jest.fn(),
    },
  };
});

clearOutboundProxyEnvironmentForEachTest();

const serve: (options?: {
  host?: string | undefined;
  port?: number | undefined;
  name?: string | undefined;
}) => Promise<LocalHttpServer> = useLocalHttpServers();

afterEach(() => {
  OutboundProxyAgents.destroySharedAgents();
});

const CONFIG: { apiKey: string; fromEmail: Email; fromName: string } = {
  apiKey: "SG.test-key",
  fromEmail: new Email("notifications@example.test"),
  fromName: "Acme Alerts",
};

async function settle(sending: Promise<unknown>): Promise<void> {
  try {
    await sending;
  } catch {
    // The proxy refuses every tunnel here.
  }
}

describe.each([
  ["with @, : and % in its password", RESERVED_CHARACTER_CREDENTIALS],
  ["with no character a URL reserves", PLAIN_CREDENTIALS],
])(
  "behind an outbound proxy %s",
  (_kind: string, credentials: ProxyCredentials) => {
    test("the server's own SendGrid settings sign in to it with the real user name and password", async () => {
      const proxy: LocalHttpServer = await serve({ name: "proxy" });
      process.env["HTTPS_PROXY"] = proxyUrlWithCredentials(
        proxy.port,
        credentials,
      );

      await settle(
        new SendGridMailProvider().send(
          {
            toEmail: new Email("alice@example.test"),
            subject: "A monitor is down",
            vars: {},
            body: "<p>A monitor is down.</p>",
          },
          CONFIG,
        ),
      );

      expect(proxy.connects).toEqual(["api.sendgrid.com:443"]);
      expect(proxy.connectCredentials).toEqual([signedInAs(credentials)]);
    });

    test("a client of a project's own signs in the same way", async () => {
      const proxy: LocalHttpServer = await serve({ name: "proxy" });
      process.env["HTTPS_PROXY"] = proxyUrlWithCredentials(
        proxy.port,
        credentials,
      );
      const mailer: MailService = new MailService();
      mailer.setApiKey(CONFIG.apiKey);
      SendGridMailProvider.routeThroughOutboundProxy(mailer);

      await settle(
        mailer.send({
          to: "alice@example.test",
          from: "notifications@example.test",
          subject: "A monitor is down",
          html: "<p>A monitor is down.</p>",
        }),
      );

      expect(proxy.connects).toEqual(["api.sendgrid.com:443"]);
      expect(proxy.connectCredentials).toEqual([signedInAs(credentials)]);
    });
  },
);

describe("a client routed with no proxy set", () => {
  test("is left exactly as @sendgrid/client made it", () => {
    const mailer: MailService = new MailService();
    const client: { defaultRequest: Record<string, unknown> } = (
      mailer as unknown as {
        client: { defaultRequest: Record<string, unknown> };
      }
    ).client;
    const before: Record<string, unknown> = { ...client.defaultRequest };

    SendGridMailProvider.routeThroughOutboundProxy(mailer);

    expect(client.defaultRequest).toEqual(before);
    expect("proxy" in client.defaultRequest).toBe(false);
  });

  test("a stand-in with no client, as a test's mock, is left alone", () => {
    expect(() => {
      SendGridMailProvider.routeThroughOutboundProxy({} as MailService);
    }).not.toThrow();
  });
});
