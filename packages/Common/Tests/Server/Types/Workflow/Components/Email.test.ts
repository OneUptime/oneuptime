import Email from "../../../../../Server/Types/Workflow/Components/Email";
import {
  RunOptions,
  RunReturnType,
} from "../../../../../Server/Types/Workflow/ComponentCode";
import Exception from "../../../../../Types/Exception/Exception";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import nodemailer from "nodemailer";
import SMTPTransport from "nodemailer/lib/smtp-transport";
import dns from "dns";
import { EventEmitter } from "events";
import net from "net";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

jest.mock("nodemailer", () => {
  return {
    __esModule: true,
    default: {
      createTransport: jest.fn(),
    },
  };
});

interface LogSpy {
  (item: Parameters<RunOptions["log"]>[0]): void;
  mock: { calls: Array<Array<unknown>> };
}

interface OnErrorSpy {
  (exception: Exception): Exception;
  mock: { calls: Array<Array<unknown>> };
}

interface OptionsFixture {
  options: RunOptions;
  log: LogSpy;
  onError: OnErrorSpy;
}

function makeOptions(): OptionsFixture {
  const log: LogSpy = jest.fn() as unknown as LogSpy;
  const onError: OnErrorSpy = jest.fn((exception: Exception): Exception => {
    return exception;
  }) as unknown as OnErrorSpy;

  return {
    log,
    onError,
    options: {
      log: log,
      workflowLogId: ObjectID.generate(),
      workflowId: ObjectID.generate(),
      projectId: ObjectID.generate(),
      onError: onError,
      executeWorkflow: async (): Promise<void> => {},
    },
  };
}

function validArgs(overrides: JSONObject = {}): JSONObject {
  return {
    from: "alerts@example.com",
    to: "on-call@example.com",
    subject: "Workflow alert",
    "email-body": "Something needs attention.",
    "smtp-host": "smtp.example.com",
    "smtp-port": 587,
    secure: false,
    ...overrides,
  };
}

const createTransportMock: ReturnType<typeof jest.fn> =
  nodemailer.createTransport as unknown as ReturnType<typeof jest.fn>;

type LookupSpy = jest.SpiedFunction<
  (
    hostname: string,
    options: { all: true },
  ) => Promise<Array<{ address: string; family: number }>>
>;

const BILLING_ENV: string = "BILLING_ENABLED";
const BLOCK_PRIVATE_ENV: string = "DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES";

let lookupSpy: LookupSpy;
let originalBilling: string | undefined;
let originalBlockPrivate: string | undefined;

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

function transportOptions(): SMTPTransport.Options {
  return createTransportMock.mock.calls[0]![0] as SMTPTransport.Options;
}

interface SocketTarget {
  host: string;
  port: number;
  autoSelectFamily: boolean | undefined;
  // Everything the socket's lookup will ever answer, for any name.
  addresses: Array<{ address: string; family: number }>;
}

type PinnedLookup = (
  hostname: string,
  options: { all: boolean },
  callback: (
    error: Error | null,
    addresses: Array<{ address: string; family: number }>,
  ) => void,
) => void;

/*
 * nodemailer is mocked here, so nothing ever calls the getSocket hook the
 * component hands it. Call it, catch the net.connect it makes, and ask that
 * socket's lookup what it will connect to — for the typed name and for an
 * unrelated one, to show it can reach nothing but the validated addresses.
 * EmailSmtpPinning.test.ts drives the same path through real sockets.
 */
async function socketTarget(
  options: SMTPTransport.Options,
): Promise<SocketTarget> {
  interface CapturedConnect {
    host: string;
    port: number;
    autoSelectFamily?: boolean;
    lookup: PinnedLookup;
  }

  const seen: { connect?: CapturedConnect } = {};

  const connectSpy: ReturnType<typeof jest.spyOn> = jest
    .spyOn(net, "connect")
    .mockImplementation(((given: CapturedConnect): net.Socket => {
      seen.connect = given;
      return Object.assign(new EventEmitter(), {
        setTimeout: jest.fn(),
        destroy: jest.fn(),
      }) as unknown as net.Socket;
    }) as never);

  try {
    expect(options.getSocket).toBeInstanceOf(Function);
    options.getSocket!(options, () => {});
  } finally {
    connectSpy.mockRestore();
  }

  expect(seen.connect).toBeDefined();
  const captured: CapturedConnect = seen.connect!;

  const answer: (
    hostname: string,
  ) => Promise<Array<{ address: string; family: number }>> = (
    hostname: string,
  ) => {
    return new Promise(
      (
        resolve: (value: Array<{ address: string; family: number }>) => void,
        reject: (error: Error) => void,
      ) => {
        captured.lookup(
          hostname,
          { all: true },
          (
            error: Error | null,
            addresses: Array<{ address: string; family: number }>,
          ) => {
            return error ? reject(error) : resolve(addresses);
          },
        );
      },
    );
  };

  const addresses: Array<{ address: string; family: number }> = await answer(
    captured.host,
  );
  expect(await answer("anything-else.example")).toEqual(addresses);

  return {
    host: captured.host,
    port: captured.port,
    autoSelectFamily: captured.autoSelectFamily,
    addresses,
  };
}

beforeEach(() => {
  jest.clearAllMocks();

  originalBilling = process.env[BILLING_ENV];
  originalBlockPrivate = process.env[BLOCK_PRIVATE_ENV];
  delete process.env[BILLING_ENV];
  delete process.env[BLOCK_PRIVATE_ENV];

  /*
   * The component resolves the SMTP host through the egress guard before it
   * connects. Answer with a public address unless a test says otherwise, so
   * nothing here depends on the machine's resolver.
   */
  lookupSpy = jest.spyOn(dns.promises, "lookup") as unknown as LookupSpy;
  lookupSpy.mockResolvedValue([{ address: "93.184.216.34", family: 4 }]);
});

afterEach(() => {
  lookupSpy.mockRestore();
  restoreEnv(BILLING_ENV, originalBilling);
  restoreEnv(BLOCK_PRIVATE_ENV, originalBlockPrivate);
});

describe("Email workflow component failures", () => {
  test.each([
    ["username only", { "smtp-username": "mailer-user" }],
    ["password only", { "smtp-password": "super-secret-password" }],
  ])(
    "routes %s SMTP credentials to the Error port without logging them",
    async (_label: string, credentials: JSONObject) => {
      const fixture: OptionsFixture = makeOptions();

      const result: RunReturnType = await new Email().run(
        validArgs(credentials),
        fixture.options,
      );

      const diagnostic: string =
        "SMTP username and password must be provided together.";

      expect(result.executePort?.id).toBe("error");
      expect(result.returnValues).toEqual({ error: diagnostic });
      expect(fixture.log).toHaveBeenCalledWith(diagnostic);
      expect(JSON.stringify(fixture.log.mock.calls)).not.toContain(
        "mailer-user",
      );
      expect(JSON.stringify(fixture.log.mock.calls)).not.toContain(
        "super-secret-password",
      );
      expect(fixture.onError).not.toHaveBeenCalled();
      expect(createTransportMock).not.toHaveBeenCalled();
    },
  );

  test("returns a send failure diagnostic through the Error port", async () => {
    const sendMail: ReturnType<typeof jest.fn> = jest
      .fn()
      .mockRejectedValue(new Error("SMTP authentication failed") as never);
    createTransportMock.mockReturnValue({ sendMail });
    const fixture: OptionsFixture = makeOptions();

    const result: RunReturnType = await new Email().run(
      validArgs({
        "smtp-username": "mailer-user",
        "smtp-password": "super-secret-password",
      }),
      fixture.options,
    );

    expect(result.executePort?.id).toBe("error");
    expect(result.returnValues).toEqual({
      error: "SMTP authentication failed",
    });
    expect(fixture.log).toHaveBeenCalledWith("SMTP authentication failed");
    expect(fixture.onError).not.toHaveBeenCalled();
    expect(sendMail).toHaveBeenCalledTimes(1);
  });

  test("still sends when username and password are both supplied", async () => {
    const sendMail: ReturnType<typeof jest.fn> = jest
      .fn()
      .mockResolvedValue(undefined as never);
    createTransportMock.mockReturnValue({ sendMail });
    const fixture: OptionsFixture = makeOptions();

    const result: RunReturnType = await new Email().run(
      validArgs({
        "smtp-username": "mailer-user",
        "smtp-password": "super-secret-password",
      }),
      fixture.options,
    );

    expect(result.executePort?.id).toBe("success");
    expect(result.returnValues).toEqual({});
    expect(sendMail).toHaveBeenCalledTimes(1);
  });
});

/*
 * The SMTP host is typed into the workflow node by any project member who can
 * edit workflows, and whatever the socket reports comes back through the
 * Error port. These pin the component to the guard, and the policy, that a
 * project's own SMTP server gets in MailService: private ranges refused on
 * SaaS and allowed on self-hosted installs, loopback / link-local / metadata
 * refused everywhere, and the socket opened to the address that was checked.
 */
describe("Email workflow component egress guard", () => {
  function mockSendMail(): ReturnType<typeof jest.fn> {
    const sendMail: ReturnType<typeof jest.fn> = jest
      .fn()
      .mockResolvedValue(undefined as never);
    createTransportMock.mockReturnValue({ sendMail });
    return sendMail;
  }

  // Returns the error the workflow saw, for tests that compare refusals.
  async function expectRefused(
    args: JSONObject,
    reason: string,
  ): Promise<string> {
    const sendMail: ReturnType<typeof jest.fn> = mockSendMail();
    const fixture: OptionsFixture = makeOptions();

    const result: RunReturnType = await new Email().run(
      validArgs(args),
      fixture.options,
    );

    expect(result.executePort?.id).toBe("error");
    expect(String(result.returnValues["error"])).toContain(reason);
    expect(fixture.log).toHaveBeenCalledWith(result.returnValues["error"]);
    expect(fixture.onError).not.toHaveBeenCalled();
    expect(createTransportMock).not.toHaveBeenCalled();
    expect(sendMail).not.toHaveBeenCalled();

    return String(result.returnValues["error"]);
  }

  async function expectSent(args: JSONObject): Promise<SMTPTransport.Options> {
    const sendMail: ReturnType<typeof jest.fn> = mockSendMail();
    const fixture: OptionsFixture = makeOptions();

    const result: RunReturnType = await new Email().run(
      validArgs(args),
      fixture.options,
    );

    expect(result.executePort?.id).toBe("success");
    expect(createTransportMock).toHaveBeenCalledTimes(1);
    expect(sendMail).toHaveBeenCalledTimes(1);

    return transportOptions();
  }

  describe("on SaaS (BILLING_ENABLED=true)", () => {
    beforeEach(() => {
      process.env[BILLING_ENV] = "true";
    });

    test.each([
      ["10.0.0.25", "private network address"],
      ["172.16.4.2", "private network address"],
      ["192.168.1.10", "private network address"],
      ["100.64.0.7", "carrier-grade NAT address"],
      ["[fd12:3456::25]", "private network address"],
      ["::ffff:10.0.0.25", "private network address"],
    ])(
      "refuses the private SMTP host %s without connecting",
      async (host: string, reason: string) => {
        await expectRefused({ "smtp-host": host }, reason);
        expect(lookupSpy).not.toHaveBeenCalled();
      },
    );

    test("refuses a hostname that resolves to a private address without saying where it points", async () => {
      lookupSpy.mockResolvedValue([{ address: "10.20.30.40", family: 4 }]);

      const error: string = await expectRefused(
        { "smtp-host": "smtp.internal.example" },
        "SMTP server host smtp.internal.example could not be reached.",
      );
      expect(error).not.toContain("10.20.30.40");
      expect(error).not.toContain("private network");
      expect(lookupSpy).toHaveBeenCalledWith("smtp.internal.example", {
        all: true,
      });
    });

    test("refuses a hostname when any one of its addresses is private", async () => {
      lookupSpy.mockResolvedValue([
        { address: "93.184.216.34", family: 4 },
        { address: "192.168.0.5", family: 4 },
      ]);

      const error: string = await expectRefused(
        { "smtp-host": "smtp.mixed.example" },
        "SMTP server host smtp.mixed.example could not be reached.",
      );
      expect(error).not.toContain("192.168.0.5");
    });

    /*
     * The error lands in the workflow log, which every member who can read
     * the workflow sees. If "no such name" and "that name is internal" read
     * differently there, the SMTP host field is a free DNS oracle for the
     * network the workflow worker runs in.
     */
    test("a missing name and an internal name produce the same error", async () => {
      const host: string = "redis";

      lookupSpy.mockRejectedValue(
        Object.assign(new Error(`getaddrinfo ENOTFOUND ${host}`), {
          code: "ENOTFOUND",
        }) as never,
      );
      const missing: string = await expectRefused(
        { "smtp-host": host },
        "could not be reached",
      );

      lookupSpy.mockResolvedValue([]);
      const empty: string = await expectRefused(
        { "smtp-host": host },
        "could not be reached",
      );

      lookupSpy.mockResolvedValue([{ address: "10.96.0.12", family: 4 }]);
      const internal: string = await expectRefused(
        { "smtp-host": host },
        "could not be reached",
      );

      lookupSpy.mockResolvedValue([{ address: "127.0.0.1", family: 4 }]);
      const loopback: string = await expectRefused(
        { "smtp-host": host },
        "could not be reached",
      );

      expect(missing).toBe("SMTP server host redis could not be reached.");
      expect([empty, internal, loopback]).toEqual([missing, missing, missing]);
    });

    test("still sends through a public SMTP server", async () => {
      const options: SMTPTransport.Options = await expectSent({
        "smtp-host": "smtp.example.com",
      });

      expect((await socketTarget(options)).addresses).toEqual([
        { address: "93.184.216.34", family: 4 },
      ]);
    });
  });

  describe("on a self-hosted install (BILLING_ENABLED unset)", () => {
    test("reaches a private SMTP host typed as an IP", async () => {
      const options: SMTPTransport.Options = await expectSent({
        "smtp-host": "10.0.0.25",
      });

      expect(options.host).toBe("10.0.0.25");
      expect(options.port).toBe(587);
      expect(await socketTarget(options)).toMatchObject({
        host: "10.0.0.25",
        port: 587,
        addresses: [{ address: "10.0.0.25", family: 4 }],
      });
      expect(lookupSpy).not.toHaveBeenCalled();
    });

    test("reaches a private IPv6 literal written in brackets", async () => {
      const options: SMTPTransport.Options = await expectSent({
        "smtp-host": "[fd12:3456::25]",
        "smtp-port": 25,
      });

      // Bare, so TLS treats it as an IP literal rather than a server name.
      expect(options.host).toBe("fd12:3456::25");
      expect((await socketTarget(options)).addresses).toEqual([
        { address: "fd12:3456::25", family: 6 },
      ]);
    });

    test("reaches a hostname that resolves to a private address", async () => {
      lookupSpy.mockResolvedValue([{ address: "192.168.1.10", family: 4 }]);

      const options: SMTPTransport.Options = await expectSent({
        "smtp-host": "postfix.corp.example",
      });

      expect(options.host).toBe("postfix.corp.example");
      expect((await socketTarget(options)).addresses).toEqual([
        { address: "192.168.1.10", family: 4 },
      ]);
    });

    test("treats BILLING_ENABLED=false the same as unset", async () => {
      process.env[BILLING_ENV] = "false";

      const options: SMTPTransport.Options = await expectSent({
        "smtp-host": "172.20.0.9",
      });

      expect((await socketTarget(options)).addresses).toEqual([
        { address: "172.20.0.9", family: 4 },
      ]);
    });

    test("refuses private hosts once DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES=true", async () => {
      process.env[BLOCK_PRIVATE_ENV] = "true";

      await expectRefused(
        { "smtp-host": "10.0.0.25" },
        "SMTP server host 10.0.0.25 is not allowed: private network address.",
      );
    });

    test("stops saying where a refused name points once DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES=true", async () => {
      process.env[BLOCK_PRIVATE_ENV] = "true";
      lookupSpy.mockResolvedValue([{ address: "192.168.1.10", family: 4 }]);

      const error: string = await expectRefused(
        { "smtp-host": "postfix.corp.example" },
        "SMTP server host postfix.corp.example could not be reached.",
      );
      expect(error).not.toContain("192.168.1.10");
    });

    test.each([
      ["127.0.0.1", "loopback address"],
      ["127.1.2.3", "loopback address"],
      ["169.254.169.254", "link-local address (cloud metadata range)"],
      ["0.0.0.0", "unspecified address"],
      ["[::1]", "loopback address"],
      ["[fe80::1]", "link-local address"],
      ["::ffff:127.0.0.1", "loopback address"],
    ])(
      "still refuses %s, which no setting opens",
      async (host: string, reason: string) => {
        await expectRefused({ "smtp-host": host }, reason);
      },
    );

    test("still refuses a name that resolves to loopback, and says so", async () => {
      lookupSpy.mockResolvedValue([{ address: "127.0.0.1", family: 4 }]);

      // The operator configured this network, so they get the diagnosis.
      await expectRefused(
        { "smtp-host": "localhost" },
        "SMTP server host localhost resolves to 127.0.0.1, which is not allowed: loopback address.",
      );
    });

    test("still refuses a name that resolves to the metadata endpoint", async () => {
      lookupSpy.mockResolvedValue([{ address: "169.254.169.254", family: 4 }]);

      await expectRefused(
        { "smtp-host": "metadata.attacker.example" },
        "link-local address (cloud metadata range)",
      );
    });
  });

  describe("connecting to the checked address", () => {
    test("connects only to the validated address, keeping the typed name for TLS", async () => {
      lookupSpy.mockResolvedValue([{ address: "203.0.114.10", family: 4 }]);

      const options: SMTPTransport.Options = await expectSent({
        "smtp-host": "smtp.example.com",
        "smtp-port": "465",
        secure: true,
      });

      /*
       * host is what nodemailer sends as SNI and verifies the certificate
       * against; the socket it is given is what decides where it connects.
       */
      expect(options).toMatchObject({
        host: "smtp.example.com",
        port: 465,
        secure: true,
      });
      expect(await socketTarget(options)).toEqual({
        host: "smtp.example.com",
        port: 465,
        autoSelectFamily: true,
        addresses: [{ address: "203.0.114.10", family: 4 }],
      });
      // The name is resolved once, by the guard, and never again.
      expect(lookupSpy).toHaveBeenCalledTimes(1);
    });

    test("offers every validated address, both families, for fallback", async () => {
      const addresses: Array<{ address: string; family: number }> = [
        { address: "2606:2800:220:1:248:1893:25c8:1946", family: 6 },
        { address: "93.184.216.34", family: 4 },
        { address: "93.184.216.35", family: 4 },
      ];
      lookupSpy.mockResolvedValue(addresses);

      const options: SMTPTransport.Options = await expectSent({
        "smtp-host": "smtp.example.com",
      });

      /*
       * An IPv6-only worker must still reach a dual-stack server, and one
       * dead record must not fail the send: autoSelectFamily walks this list.
       */
      expect(await socketTarget(options)).toMatchObject({
        autoSelectFamily: true,
        addresses,
      });
    });

    test("trims whitespace pasted around the host", async () => {
      const options: SMTPTransport.Options = await expectSent({
        "smtp-host": "  smtp.example.com \n",
      });

      expect(lookupSpy).toHaveBeenCalledWith("smtp.example.com", {
        all: true,
      });
      expect(options.host).toBe("smtp.example.com");
    });

    test("routes a host that does not resolve to the Error port, naming the resolver error on a self-hosted install", async () => {
      lookupSpy.mockRejectedValue(
        Object.assign(new Error("getaddrinfo ENOTFOUND smtp.typo.example"), {
          code: "ENOTFOUND",
        }) as never,
      );

      await expectRefused(
        { "smtp-host": "smtp.typo.example" },
        "Could not resolve smtp server host smtp.typo.example",
      );
    });
  });
});
