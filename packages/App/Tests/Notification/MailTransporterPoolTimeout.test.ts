import { TransporterPool } from "../../FeatureSet/Notification/Services/MailService";
import Hostname from "Common/Types/API/Hostname";
import Email from "Common/Types/Email";
import EmailServer from "Common/Types/Email/EmailServer";
import SMTPAuthenticationType from "Common/Types/Email/SMTPAuthenticationType";
import ObjectID from "Common/Types/ObjectID";
import Port from "Common/Types/Port";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import dns from "dns";
import nodemailer from "nodemailer";

/*
 * "Send Test Email" must not change how real mail is sent.
 *
 * POST /api/notification/smtp-config/test passes `timeout: 4000` so a
 * misconfigured server fails fast instead of making the user wait out the 60s
 * default. That timeout is not a per-send option: createTransporter bakes it
 * into the nodemailer transport as `connectionTimeout`, and the transport is
 * then POOLED and reused.
 *
 * The pool key used to cover only the connection identity - id, host, port,
 * mode, secure flag, auth type and every credential - and not the timeout. So
 * the first caller to reach a given SMTP config decided the timeout for
 * everyone after them:
 *
 *   - Test first: that project's config was left pinned to
 *     connectionTimeout=4000 for every real alert email. getTransporter
 *     restamps lastUsedAt on every hit, so an actively-used config never idles
 *     out of the 10-minute pool - a single click could drop production mail to
 *     a healthy-but-slow SMTP server indefinitely.
 *   - Real send first: the test quietly got the 60s transporter and never
 *     failed fast, which is the whole reason the 4000 is there.
 *
 * The hazard was unreachable while the test route itself was broken
 * (issue #3920: it answered "Project ID is required" before it ever sent
 * anything), so fixing that route is what makes this reachable again. The two
 * belong together.
 *
 * The fix splits the two questions: a POOL key that carries the timeout
 * (which cached transporter may I be handed?) and a CONNECTION key that does
 * not (how many sockets are open to this server?). These tests pin both.
 *
 * DNS is mocked throughout so nothing here touches the network.
 */

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
    default: { debug: jest.fn(), error: jest.fn(), warn: jest.fn() },
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

/* The timeout POST /smtp-config/test asks for. */
const TEST_TIMEOUT_MS: number = 4000;

/* What createTransporter falls back to when no timeout is requested. */
const DEFAULT_TIMEOUT_MS: number = 60000;

const CONFIG_ID: ObjectID = new ObjectID(
  "019acd20-3333-4333-8333-333333333333",
);

function makeProjectEmailServer(): EmailServer {
  return {
    id: CONFIG_ID,
    host: Hostname.fromString("smtp.sendgrid.net"),
    port: new Port(587),
    username: "apikey",
    password: "a-secret",
    fromEmail: new Email("noreply@example.com"),
    fromName: "OneUptime",
    secure: false,
    authType: SMTPAuthenticationType.UsernamePassword,
  };
}

interface FakeTransport {
  id: number;
  connectionTimeout: number | undefined;
  close: () => void;
  sendMail: () => Promise<unknown>;
}

describe("The SMTP transporter pool keeps test timeouts out of real sends", () => {
  let createTransportSpy: jest.SpyInstance;
  let lookupSpy: jest.SpyInstance;
  let built: Array<FakeTransport>;

  beforeEach(async () => {
    await TransporterPool.cleanup();
    built = [];

    /*
     * The egress guard resolves the host before dialling. Answer with a public
     * address so the guard allows it and nothing leaves the machine.
     */
    lookupSpy = jest
      .spyOn(dns.promises, "lookup")
      .mockResolvedValue([{ address: "159.112.240.1", family: 4 }] as never);

    /*
     * Stand in for nodemailer and record the connectionTimeout each transport
     * was built with. Identity matters as much as the value: the bug was a
     * cached transport being handed to a caller who asked for something else,
     * which only shows up if you can tell two transports apart.
     */
    createTransportSpy = jest
      .spyOn(nodemailer, "createTransport")
      .mockImplementation((options?: unknown): never => {
        const transport: FakeTransport = {
          id: built.length,
          connectionTimeout: (
            options as { connectionTimeout?: number | undefined } | undefined
          )?.connectionTimeout,
          close: (): void => {
            return undefined;
          },
          sendMail: (): Promise<unknown> => {
            return Promise.resolve({});
          },
        };

        built.push(transport);

        return transport as never;
      });
  });

  afterEach(async () => {
    await TransporterPool.cleanup();
    createTransportSpy.mockRestore();
    lookupSpy.mockRestore();
  });

  test("a real send after a test email is not left with the test's 4s timeout", async () => {
    // The user clicks "Send Test Email".
    const testTransport: FakeTransport = (await TransporterPool.getTransporter(
      makeProjectEmailServer(),
      { timeout: TEST_TIMEOUT_MS },
    )) as unknown as FakeTransport;

    // Then an alert fires and a real email goes out on the same config.
    const realTransport: FakeTransport = (await TransporterPool.getTransporter(
      makeProjectEmailServer(),
      {},
    )) as unknown as FakeTransport;

    expect(testTransport.connectionTimeout).toBe(TEST_TIMEOUT_MS);
    expect(realTransport.connectionTimeout).toBe(DEFAULT_TIMEOUT_MS);
    expect(realTransport.id).not.toBe(testTransport.id);
  });

  test("a test email after a real send still fails fast", async () => {
    const realTransport: FakeTransport = (await TransporterPool.getTransporter(
      makeProjectEmailServer(),
      {},
    )) as unknown as FakeTransport;

    const testTransport: FakeTransport = (await TransporterPool.getTransporter(
      makeProjectEmailServer(),
      { timeout: TEST_TIMEOUT_MS },
    )) as unknown as FakeTransport;

    expect(realTransport.connectionTimeout).toBe(DEFAULT_TIMEOUT_MS);
    expect(testTransport.connectionTimeout).toBe(TEST_TIMEOUT_MS);
    expect(testTransport.id).not.toBe(realTransport.id);
  });

  /*
   * The point of the pool is still to pool. A per-request timeout key would be
   * a cache that never hits, which trades one bug for a reconnect on every
   * send - so pin that identical requests still share one transport.
   */
  test("two real sends to the same config share one transporter", async () => {
    const first: FakeTransport = (await TransporterPool.getTransporter(
      makeProjectEmailServer(),
      {},
    )) as unknown as FakeTransport;

    const second: FakeTransport = (await TransporterPool.getTransporter(
      makeProjectEmailServer(),
      {},
    )) as unknown as FakeTransport;

    expect(second.id).toBe(first.id);
    expect(createTransportSpy).toHaveBeenCalledTimes(1);
  });

  test("two test emails to the same config share one transporter", async () => {
    const first: FakeTransport = (await TransporterPool.getTransporter(
      makeProjectEmailServer(),
      { timeout: TEST_TIMEOUT_MS },
    )) as unknown as FakeTransport;

    const second: FakeTransport = (await TransporterPool.getTransporter(
      makeProjectEmailServer(),
      { timeout: TEST_TIMEOUT_MS },
    )) as unknown as FakeTransport;

    expect(second.id).toBe(first.id);
    expect(createTransportSpy).toHaveBeenCalledTimes(1);
  });

  /* An explicit timeout equal to the default is the default. */
  test("asking for the default timeout reuses the default transporter", async () => {
    const implicit: FakeTransport = (await TransporterPool.getTransporter(
      makeProjectEmailServer(),
      {},
    )) as unknown as FakeTransport;

    const explicit: FakeTransport = (await TransporterPool.getTransporter(
      makeProjectEmailServer(),
      { timeout: undefined },
    )) as unknown as FakeTransport;

    expect(explicit.id).toBe(implicit.id);
    expect(createTransportSpy).toHaveBeenCalledTimes(1);
  });

  /*
   * The credential separation the pool key already had must survive the
   * change. Two projects that share a host, port and username but not a
   * password must never be handed each other's authenticated connection -
   * that was a real defect once, and splitting the key is exactly the kind of
   * edit that could undo it.
   */
  test("a different password still gets its own transporter", async () => {
    const mine: EmailServer = makeProjectEmailServer();
    const theirs: EmailServer = makeProjectEmailServer();
    theirs.password = "a-different-secret";

    const first: FakeTransport = (await TransporterPool.getTransporter(
      mine,
      {},
    )) as unknown as FakeTransport;

    const second: FakeTransport = (await TransporterPool.getTransporter(
      theirs,
      {},
    )) as unknown as FakeTransport;

    expect(second.id).not.toBe(first.id);
  });

  test("a different config id still gets its own transporter", async () => {
    const mine: EmailServer = makeProjectEmailServer();
    const theirs: EmailServer = makeProjectEmailServer();
    theirs.id = new ObjectID("019acd20-4444-4444-8444-444444444444");

    const first: FakeTransport = (await TransporterPool.getTransporter(
      mine,
      {},
    )) as unknown as FakeTransport;

    const second: FakeTransport = (await TransporterPool.getTransporter(
      theirs,
      {},
    )) as unknown as FakeTransport;

    expect(second.id).not.toBe(first.id);
  });

  /*
   * The concurrency semaphore is the half of the split that must NOT see the
   * timeout: it caps how many sockets we open to one server, which is a
   * property of that server and not of who asked. acquireConnection and
   * releaseConnection are only ever told the server, so the accounting has to
   * balance across both kinds of caller - otherwise a test send could release
   * a slot a real send is holding, or leak one it took.
   */
  test("a test send and a real send share the same concurrency slot accounting", async () => {
    const server: EmailServer = makeProjectEmailServer();

    await TransporterPool.getTransporter(server, { timeout: TEST_TIMEOUT_MS });
    await TransporterPool.getTransporter(server, {});

    await TransporterPool.acquireConnection(server);
    TransporterPool.releaseConnection(server);

    /*
     * Balanced accounting means the next acquire is immediate. An unbalanced
     * one would either hang here (slot never released) or let the cap be
     * exceeded. Resolving at all is the assertion.
     */
    await expect(
      TransporterPool.acquireConnection(server),
    ).resolves.toBeUndefined();

    TransporterPool.releaseConnection(server);
  });
});
