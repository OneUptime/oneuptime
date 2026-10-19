import {
  restoreClusterKey,
  setClusterKey,
} from "Common/Tests/Server/TestingUtils/ShippedClusterKeys";
import ObjectID from "Common/Types/ObjectID";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { createServer, IncomingMessage, Server, ServerResponse } from "http";
import { AddressInfo } from "net";

/*
 * OneUptime's own services present the cluster key to each other in the
 * clusterkey request header, at the installation's own addresses: the
 * app's API (SERVER_APP_HOSTNAME), the workflow service, the telemetry
 * writer (TELEMETRY_WRITER_URL). An HTTP client follows a redirect to
 * wherever it points and takes the request's headers - and, for a 307 or
 * 308, its body - along. So a call that presents the key follows a
 * redirect only while it stays on the server it was sent to; one that
 * points anywhere else fails the call, and the key goes nowhere else.
 *
 * The real services, through the real request client, to an installation
 * address that answers every request with a redirect: to another server on
 * this machine, or to another path of its own.
 */

const CLUSTER_KEY: string = "Q7dVk2LmX9pR4tWz8NcB1sHf6JyG3uAe";
const PROJECT_ID: ObjectID = new ObjectID(
  "6c7f1e2a-3b4d-4e5f-8a9b-0c1d2e3f4a5b",
);
const INCIDENT_ID: ObjectID = new ObjectID(
  "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
);

// Where a server that redirects to itself sends every request.
const MOVED_PATH: string = "/moved";

type AnyModule = any; // eslint-disable-line @typescript-eslint/no-explicit-any

function require_(modulePath: string): AnyModule {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  return require(modulePath);
}

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
}

/*
 * A server that keeps what it is sent. It answers with a 307 to
 * `redirectTo()` + the path it was asked for when it is given one (its own
 * origin makes it redirect to itself, under MOVED_PATH), and otherwise - and
 * for MOVED_PATH - with an empty JSON object.
 */
async function startServer(
  redirectTo?: (self: string) => string,
): Promise<TestServer> {
  const received: Array<Received> = [];
  let origin: string = "";

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

        if (redirectTo && !(req.url || "").startsWith(MOVED_PATH)) {
          res.writeHead(307, {
            location: `${redirectTo(origin)}${MOVED_PATH}${req.url || ""}`,
          });
          res.end();
          return;
        }

        res.writeHead(200, { "content-type": "application/json" });
        res.end("{}");
      });
    },
  );

  await new Promise<void>((resolve: () => void) => {
    http.listen(0, "127.0.0.1", resolve);
  });

  const port: number = (http.address() as AddressInfo).port;
  origin = `http://127.0.0.1:${port}`;

  return { http: http, origin: origin, port: port, received: received };
}

async function stopServer(server: TestServer): Promise<void> {
  await new Promise<void>((resolve: () => void) => {
    server.http.close(() => {
      resolve();
    });
  });
}

interface Process {
  logger: AnyModule;
  IncidentService: AnyModule;
  MailService: AnyModule;
  SmsService: AnyModule;
  CallService: AnyModule;
  WhatsAppService: AnyModule;
  TelegramService: AnyModule;
  WebhookService: AnyModule;
  releaseIncomingCallPhoneNumber: AnyModule;
  createTelemetryWriterTransport: AnyModule;
  Email: AnyModule;
  Phone: AnyModule;
}

/*
 * One app process of an installation whose operator set ONEUPTIME_SECRET,
 * whose own addresses (the app's API, the workflow service, the telemetry
 * writer) are `installation`.
 */
function startProcess(installation: TestServer): Process {
  const saved: Record<string, string | undefined> = {
    SERVER_APP_HOSTNAME: process.env["SERVER_APP_HOSTNAME"],
    APP_PORT: process.env["APP_PORT"],
  };

  process.env["SERVER_APP_HOSTNAME"] = "127.0.0.1";
  process.env["APP_PORT"] = String(installation.port);
  setClusterKey(CLUSTER_KEY);

  let started: Process | null = null;

  try {
    jest.isolateModules(() => {
      const BlockedProjectNotifications: AnyModule = require_(
        "Common/Server/Utils/Notification/BlockedProjectNotifications",
      ).default;

      jest
        .spyOn(BlockedProjectNotifications, "getRefusal")
        .mockImplementation((async () => {
          return null;
        }) as never);

      started = {
        logger: require_("Common/Server/Utils/Logger").default,
        IncidentService: require_("Common/Server/Services/IncidentService")
          .default,
        MailService: require_("Common/Server/Services/MailService").default,
        SmsService: require_("Common/Server/Services/SmsService").default,
        CallService: require_("Common/Server/Services/CallService").default,
        WhatsAppService: require_("Common/Server/Services/WhatsAppService")
          .default,
        TelegramService: require_("Common/Server/Services/TelegramService")
          .default,
        WebhookService: require_("Common/Server/Services/WebhookService")
          .default,
        releaseIncomingCallPhoneNumber: require_(
          "Common/Server/Utils/IncomingCallPhoneNumber",
        ).default,
        createTelemetryWriterTransport: require_(
          "Common/Server/Utils/Telemetry/TelemetryWriterClient",
        ).createTelemetryWriterTransport,
        Email: require_("Common/Types/Email").default,
        Phone: require_("Common/Types/Phone").default,
      };
    });
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }

    restoreClusterKey();
  }

  return started!;
}

async function waitFor(condition: () => boolean): Promise<void> {
  for (let attempt: number = 0; attempt < 300; attempt++) {
    if (condition()) {
      return;
    }

    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 10);
    });
  }

  throw new Error("Timed out waiting for the condition.");
}

// Runs a call and keeps what it threw: a refused redirect fails the call.
async function settled(call: () => Promise<unknown>): Promise<unknown> {
  try {
    await call();
    return null;
  } catch (error) {
    return error;
  }
}

/*
 * Every call that presents the key, as the service that makes it is
 * called, with the path it calls on the installation.
 */
interface PresentingCall {
  name: string;
  path: string;
  call: (running: Process) => Promise<unknown>;
  // A call nobody awaits: the service logs what failed.
  isFireAndForget?: boolean;
}

const PRESENTING_CALLS: Array<PresentingCall> = [
  {
    name: "an email",
    path: "/api/notification/email/send",
    call: async (running: Process): Promise<unknown> => {
      return await running.MailService.sendMail({
        toEmail: new running.Email("oncall@example.com"),
        subject: "Incident #1",
        templateType: "EmptyTemplate",
        vars: {},
        body: "An incident was created.",
      });
    },
  },
  {
    name: "an SMS",
    path: "/api/notification/sms/send",
    call: async (running: Process): Promise<unknown> => {
      return await running.SmsService.sendSms(
        {
          to: new running.Phone("+15555550100"),
          message: "Incident #1 was created.",
        },
        { projectId: PROJECT_ID },
      );
    },
  },
  {
    name: "a phone call",
    path: "/api/notification/call/make-call",
    call: async (running: Process): Promise<unknown> => {
      return await running.CallService.makeCall(
        {
          to: new running.Phone("+15555550100"),
          data: [{ sayMessage: "Incident #1 was created." }],
        },
        { projectId: PROJECT_ID },
      );
    },
  },
  {
    name: "a WhatsApp message",
    path: "/api/notification/whatsapp/send",
    call: async (running: Process): Promise<unknown> => {
      return await running.WhatsAppService.sendWhatsAppMessage(
        {
          to: new running.Phone("+15555550100"),
          body: "Incident #1 was created.",
        },
        { projectId: PROJECT_ID },
      );
    },
  },
  {
    name: "a Telegram message",
    path: "/api/notification/telegram/send",
    call: async (running: Process): Promise<unknown> => {
      return await running.TelegramService.sendTelegramMessage(
        { to: "123456", body: "Incident #1 was created." },
        { projectId: PROJECT_ID },
      );
    },
  },
  {
    name: "a webhook",
    path: "/api/notification/webhook/send",
    call: async (running: Process): Promise<unknown> => {
      return await running.WebhookService.sendWebhook(
        {
          url: "https://hooks.example.com/oneuptime",
          eventType: "incident.created",
          payload: { text: "Incident #1 was created." },
        },
        { projectId: PROJECT_ID },
      );
    },
  },
  {
    name: "a phone number release",
    path: "/api/notification/phone-number/internal/release",
    call: async (running: Process): Promise<unknown> => {
      return await running.releaseIncomingCallPhoneNumber({
        projectCallSMSConfigId: PROJECT_ID,
        callProviderPhoneNumberId: "PN0123456789abcdef",
      });
    },
  },
  {
    name: "a workflow trigger",
    path: `/workflow/model/${PROJECT_ID.toString()}/incident/on-create`,
    call: async (running: Process): Promise<unknown> => {
      return await running.IncidentService.onTriggerWorkflow(
        INCIDENT_ID,
        PROJECT_ID,
        "on-create",
      );
    },
    isFireAndForget: true,
  },
];

/*
 * Rows for the telemetry writer, which the writer's own address
 * (TELEMETRY_WRITER_URL) takes - read when the rows are sent.
 */
async function sendTelemetryRows(
  running: Process,
  writer: TestServer,
): Promise<unknown> {
  const saved: string | undefined = process.env["TELEMETRY_WRITER_URL"];
  process.env["TELEMETRY_WRITER_URL"] = writer.origin;

  try {
    return await running.createTelemetryWriterTransport()(
      { model: { tableName: "LogItem" } },
      [{ body: "a log line" }],
      { dedupToken: "token-1", clickhouseSettings: undefined },
    );
  } finally {
    if (saved === undefined) {
      delete process.env["TELEMETRY_WRITER_URL"];
    } else {
      process.env["TELEMETRY_WRITER_URL"] = saved;
    }
  }
}

let otherServer: TestServer;
// Redirects every request to the other server.
let redirectingAway: TestServer;
// Redirects every request to another path of its own.
let redirectingToItself: TestServer;

beforeAll(async () => {
  otherServer = await startServer();
  redirectingAway = await startServer(() => {
    return otherServer.origin;
  });
  redirectingToItself = await startServer((self: string) => {
    return self;
  });
});

afterAll(async () => {
  await stopServer(redirectingAway);
  await stopServer(redirectingToItself);
  await stopServer(otherServer);
  restoreClusterKey();
});

afterEach(() => {
  otherServer.received.length = 0;
  redirectingAway.received.length = 0;
  redirectingToItself.received.length = 0;
  jest.restoreAllMocks();
});

function pathsOf(server: TestServer): Array<string> {
  return server.received.map((request: Received): string => {
    return request.url;
  });
}

describe("a call that presents the cluster key, redirected to another server", () => {
  test.each(
    PRESENTING_CALLS.map((presenting: PresentingCall) => {
      return [presenting.name, presenting] as [string, PresentingCall];
    }),
  )(
    "%s is not sent on: the key reaches its own server and no other",
    async (_name: string, presenting: PresentingCall) => {
      const running: Process = startProcess(redirectingAway);

      await settled(async () => {
        await presenting.call(running);
      });

      if (presenting.isFireAndForget) {
        await waitFor(() => {
          return (
            otherServer.received.length > 0 ||
            running.logger.getRecentLogs().length > 0
          );
        });
      }

      expect(pathsOf(redirectingAway)).toEqual([presenting.path]);
      expect(redirectingAway.received[0]!.headers["clusterkey"]).toBe(
        CLUSTER_KEY,
      );
      expect(otherServer.received).toEqual([]);
    },
  );

  test("telemetry rows for the writer are not sent on", async () => {
    const running: Process = startProcess(redirectingAway);

    const failure: unknown = await settled(async () => {
      await sendTelemetryRows(running, redirectingAway);
    });

    // The rows are not taken, so the writer tries them again later.
    expect(failure).not.toBeNull();
    expect(pathsOf(redirectingAway)).toEqual(["/telemetry-writer/insert"]);
    expect(otherServer.received).toEqual([]);
  });

  test("an email that is not sent on fails, saying where the redirect pointed", async () => {
    const running: Process = startProcess(redirectingAway);

    const failure: unknown = await settled(async () => {
      await PRESENTING_CALLS[0]!.call(running);
    });

    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toContain(otherServer.origin);
    expect((failure as Error).message).not.toContain(CLUSTER_KEY);
  });
});

describe("a call that presents the cluster key, redirected on its own server", () => {
  test.each(
    PRESENTING_CALLS.filter((presenting: PresentingCall): boolean => {
      return !presenting.isFireAndForget;
    }).map((presenting: PresentingCall) => {
      return [presenting.name, presenting] as [string, PresentingCall];
    }),
  )(
    "%s gets there, with the key",
    async (_name: string, presenting: PresentingCall) => {
      const running: Process = startProcess(redirectingToItself);

      await presenting.call(running);

      expect(pathsOf(redirectingToItself)).toEqual([
        presenting.path,
        `${MOVED_PATH}${presenting.path}`,
      ]);
      expect(redirectingToItself.received[1]!.headers["clusterkey"]).toBe(
        CLUSTER_KEY,
      );
      expect(otherServer.received).toEqual([]);
    },
  );

  test("telemetry rows for the writer get there", async () => {
    const running: Process = startProcess(redirectingToItself);

    await sendTelemetryRows(running, redirectingToItself);

    expect(pathsOf(redirectingToItself)).toEqual([
      "/telemetry-writer/insert",
      `${MOVED_PATH}/telemetry-writer/insert`,
    ]);
    expect(otherServer.received).toEqual([]);
  });
});
