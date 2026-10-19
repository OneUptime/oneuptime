import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { JSONObject } from "Common/Types/JSON";
import {
  ClientRequest,
  createServer,
  request as httpRequest,
  IncomingMessage,
  Server,
} from "http";
import { AddressInfo } from "net";

/*
 * POST /incoming-email/sendgrid/:secret, over HTTP: who may deliver an email.
 *
 * SendGrid Inbound Parse posts every email sent to the inbound domain to the
 * Destination URL its operator gave it, which ends with the installation's
 * INBOUND_EMAIL_WEBHOOK_SECRET. The route is on the public ingress (the
 * bundled Nginx sends /incoming-email and /probe-ingest to the app), and what
 * it takes becomes an Incoming Email monitor's or a workflow's email: it
 * opens and resolves incidents and alerts and starts workflows. So:
 *
 *   - an installation with no secret of its own - unset, blank, a value the
 *     repository ships or a placeholder the setup guide prints - refuses
 *     every delivery with 503 (which SendGrid retries), at every address the
 *     app answers the route on, whatever the request's address ends with;
 *   - an installation with a secret takes a delivery only when the address
 *     ends with exactly that secret, and refuses anything else with 403;
 *   - a refused request is refused before its body is read: neither a body
 *     the multipart parser cannot read nor one over its limits changes the
 *     answer, and the parser still guards the deliveries that are let in;
 *   - nothing a refused request carried reaches the queue, and the secret, or
 *     a guess at it, never reaches the log.
 *
 * Each installation is a fresh copy of the product loaded with the
 * environment it names: the real EnvironmentConfig reads it, the real router
 * is mounted where Telemetry mounts it, with the real multipart parser, the
 * real SendGrid provider and the real error handler. Only the queue the route
 * hands an email to, and the logger, are stood in for.
 */

const DOMAIN: string = "inbound.oneuptime.example";
const MONITOR_KEY: string = "b1946ac9-2492-4b0f-9b2f-ee9b6cbe36ba";
const MONITOR_ADDRESS: string = `monitor-${MONITOR_KEY}@${DOMAIN}`;

// A long random value of an operator's own, and another installation's.
const OPERATORS_SECRET: string =
  "6f1c9a2e8b4d7f30a5c1e9b2d6f8a0c4e7b1d3f5a9c2e6b8";
const OTHER_INSTALLATIONS_SECRET: string = "9d2e7a1c5b3f8e0a4c6d2b9f1e7a3c5d";

const BOUNDARY: string = "oneuptime-inbound-email-boundary-4f2a";
const MULTIPART: string = `multipart/form-data; boundary=${BOUNDARY}`;

// Where Telemetry mounts the router (Telemetry/Index.ts).
const ADDRESSES: Array<string> = [
  "/incoming-email/sendgrid",
  "/probe-ingest/incoming-email/sendgrid",
];

const MANAGED_KEYS: Array<string> = [
  "INBOUND_EMAIL_PROVIDER",
  "INBOUND_EMAIL_DOMAIN",
  "INBOUND_EMAIL_WEBHOOK_SECRET",
];

// What the stand-ins were handed: the emails queued, and every log line.
const mockQueuedEmails: Array<JSONObject> = [];
const mockLogLines: Array<string> = [];

jest.mock(
  "../../FeatureSet/Telemetry/Services/Queue/TelemetryQueueService",
  () => {
    return {
      __esModule: true,
      default: {
        addIncomingEmailJob: async (job: JSONObject): Promise<void> => {
          mockQueuedEmails.push(job);
        },
      },
    };
  },
);

jest.mock("Common/Server/Utils/Logger", () => {
  const record: (level: string) => (message: unknown) => void = (
    level: string,
  ): ((message: unknown) => void) => {
    return (message: unknown): void => {
      mockLogLines.push(
        `${level}: ${
          message instanceof Error
            ? `${message.message} ${message.stack || ""}`
            : typeof message === "string"
              ? message
              : JSON.stringify(message)
        }`,
      );
    };
  };

  return {
    __esModule: true,
    default: {
      debug: record("debug"),
      info: record("info"),
      warn: record("warn"),
      error: record("error"),
    },
    getLogAttributesFromRequest: (): JSONObject => {
      return {};
    },
  };
});

type AnyModule = any; // eslint-disable-line @typescript-eslint/no-explicit-any

function require_(modulePath: string): AnyModule {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  return require(modulePath);
}

interface Installation {
  origin: string;
  http: Server;
  messages: {
    notConfigured: string;
    noSecret: string;
    wrongSecret: string;
  };
}

interface Answer {
  status: number;
  body: string;
}

const originalEnv: NodeJS.ProcessEnv = { ...process.env };
const running: Array<Server> = [];

async function listen(): Promise<{ http: Server; origin: string }> {
  const http: Server = createServer();

  await new Promise<void>((resolve: () => void) => {
    http.listen(0, "127.0.0.1", resolve);
  });

  running.push(http);

  return {
    http: http,
    origin: `http://127.0.0.1:${(http.address() as AddressInfo).port}`,
  };
}

/*
 * A fresh copy of the product, loaded with `environment` (keys left out are
 * unset), the incoming email router mounted where Telemetry mounts it.
 */
async function startInstallation(
  environment: Record<string, string | undefined>,
): Promise<Installation> {
  for (const key of MANAGED_KEYS) {
    delete process.env[key];
  }

  for (const [key, value] of Object.entries(environment)) {
    if (value !== undefined) {
      process.env[key] = value;
    }
  }

  const { http, origin } = await listen();
  let installation: Installation | null = null;

  jest.isolateModules(() => {
    const ExpressUtils: AnyModule = require_("Common/Server/Utils/Express");
    const routeModule: AnyModule = require_(
      "../../FeatureSet/Telemetry/API/ProbeIngest/IncomingEmail",
    );

    const app: AnyModule = ExpressUtils.createExpressApp();
    app.use(ExpressUtils.ExpressJson());
    app.use(["/probe-ingest", "/"], routeModule.default);
    app.use(require_("Common/Server/Utils/StartServer").expressErrorHandler);

    http.on("request", app);

    installation = {
      origin: origin,
      http: http,
      messages: {
        notConfigured: routeModule.INBOUND_EMAIL_NOT_CONFIGURED_MESSAGE,
        noSecret: routeModule.INBOUND_EMAIL_NO_WEBHOOK_SECRET_MESSAGE,
        wrongSecret: routeModule.INBOUND_EMAIL_WRONG_WEBHOOK_SECRET_MESSAGE,
      },
    };
  });

  return installation!;
}

function post(data: {
  origin: string;
  path: string;
  body: string;
  contentType?: string | undefined;
}): Promise<Answer> {
  return new Promise<Answer>(
    (resolve: (answer: Answer) => void, reject: (error: Error) => void) => {
      const request: ClientRequest = httpRequest(
        `${data.origin}${data.path}`,
        {
          method: "POST",
          agent: false,
          headers: {
            "content-type": data.contentType || MULTIPART,
            "content-length": Buffer.byteLength(data.body),
          },
        },
        (response: IncomingMessage) => {
          let text: string = "";
          response.setEncoding("utf8");
          response.on("data", (chunk: string) => {
            text += chunk;
          });
          response.on("end", () => {
            resolve({ status: response.statusCode || 0, body: text });
          });
        },
      );

      request.on("error", reject);
      request.end(data.body);
    },
  );
}

function multipart(fields: Array<[string, string]>): string {
  return (
    fields
      .map(([name, value]: [string, string]): string => {
        return `--${BOUNDARY}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`;
      })
      .join("") + `--${BOUNDARY}--\r\n`
  );
}

// An email to the monitor's address, as SendGrid Inbound Parse posts it.
const DELIVERY: string = multipart([
  ["from", "Backups <nightly-backups@acme.example>"],
  ["to", MONITOR_ADDRESS],
  ["subject", "Nightly backups completed"],
  ["text", "Backup finished in 42 minutes."],
  [
    "envelope",
    JSON.stringify({ to: [MONITOR_ADDRESS], from: "bounces@acme.example" }),
  ],
]);

// A body the multipart parser cannot read: no part ever ends.
const UNREADABLE_BODY: string = `--${BOUNDARY}\r\nContent-Disposition: form-data; name="to"\r\n\r\nnever closed`;

// One field more than the parser takes (MAX_MULTIPART_FIELDS is 200).
const OVER_LIMIT_BODY: string = multipart(
  Array.from({ length: 201 }, (_value: unknown, index: number) => {
    return [`field-${index}`, "x"] as [string, string];
  }),
);

function webhookPath(address: string, pathSecret: string): string {
  return `${address}/${encodeURIComponent(pathSecret)}`;
}

function messageOf(answer: Answer): string {
  return (JSON.parse(answer.body) as JSONObject)["message"] as string;
}

beforeEach(() => {
  mockQueuedEmails.length = 0;
  mockLogLines.length = 0;
});

afterEach(async () => {
  process.env = { ...originalEnv };

  while (running.length > 0) {
    const http: Server = running.pop()!;

    await new Promise<void>((resolve: () => void) => {
      http.close(() => {
        resolve();
      });
    });
  }
});

afterAll(() => {
  process.env = { ...originalEnv };
});

/*
 * Values that are no secret of the installation's own: whoever reads the
 * OneUptime repository or the setup guide has them.
 */
const NO_SECRET_OF_ITS_OWN: Array<[string, string | undefined]> = [
  ["unset", undefined],
  ["empty", ""],
  ["blank", "   "],
  ["the value the code used to fall back to", "secret"],
  ["a config.example.env placeholder", "please-change-this-to-random-value"],
  ["the guide's URL placeholder", "YOUR_SECRET"],
  ["the guide's example", "your-secret"],
  ["the guide's config placeholder", "replace-with-a-strong-random-secret"],
  [
    "the guide's config placeholder in other case",
    "Replace-With-A-Strong-Random-Secret",
  ],
  ["the guide's URL placeholder, padded", "  YOUR_SECRET  "],
];

describe("an installation with no webhook secret of its own refuses every delivery", () => {
  test.each(NO_SECRET_OF_ITS_OWN)(
    "INBOUND_EMAIL_WEBHOOK_SECRET %s: 503 at every address, whatever the address ends with, and nothing is queued",
    async (_label: string, secret: string | undefined) => {
      const installation: Installation = await startInstallation({
        INBOUND_EMAIL_DOMAIN: DOMAIN,
        INBOUND_EMAIL_WEBHOOK_SECRET: secret,
      });

      const endings: Array<string> = [
        "anything",
        OPERATORS_SECRET,
        "undefined",
        "null",
        "secret",
        "YOUR_SECRET",
        ...(secret && secret.trim() ? [secret, secret.trim()] : []),
      ];

      for (const address of ADDRESSES) {
        for (const ending of endings) {
          const answer: Answer = await post({
            origin: installation.origin,
            path: webhookPath(address, ending),
            body: DELIVERY,
          });

          expect({ address, ending, status: answer.status }).toEqual({
            address,
            ending,
            status: 503,
          });
          expect(messageOf(answer)).toBe(installation.messages.noSecret);
        }
      }

      expect(mockQueuedEmails).toEqual([]);
    },
  );

  test("says what to set, and nothing about what a request ended with", async () => {
    const installation: Installation = await startInstallation({
      INBOUND_EMAIL_DOMAIN: DOMAIN,
    });

    const answer: Answer = await post({
      origin: installation.origin,
      path: webhookPath(ADDRESSES[0]!, "guess-4c7e1a93"),
      body: DELIVERY,
    });

    expect(answer.status).toBe(503);
    expect(installation.messages.noSecret).toContain(
      "INBOUND_EMAIL_WEBHOOK_SECRET",
    );
    expect(answer.body).not.toContain("guess-4c7e1a93");
    expect(mockLogLines.join("\n")).not.toContain("guess-4c7e1a93");
  });
});

describe("an installation with its own secret takes a delivery only at its own address", () => {
  test.each(ADDRESSES)(
    "the address that ends with the secret, at %s: 200, and the email is queued for the monitor",
    async (address: string) => {
      const installation: Installation = await startInstallation({
        INBOUND_EMAIL_DOMAIN: DOMAIN,
        INBOUND_EMAIL_WEBHOOK_SECRET: OPERATORS_SECRET,
      });

      const answer: Answer = await post({
        origin: installation.origin,
        path: webhookPath(address, OPERATORS_SECRET),
        body: DELIVERY,
      });

      expect(answer.status).toBe(200);
      expect(JSON.parse(answer.body)).toEqual({
        status: "accepted",
        message: "Email queued for processing",
      });
      expect(mockQueuedEmails).toHaveLength(1);
      expect(mockQueuedEmails[0]!["secretKey"]).toBe(MONITOR_KEY);
      expect(mockQueuedEmails[0]!["emailSubject"]).toBe(
        "Nightly backups completed",
      );
    },
  );

  test("a secret set with whitespace around it is the secret without it", async () => {
    const installation: Installation = await startInstallation({
      INBOUND_EMAIL_DOMAIN: DOMAIN,
      INBOUND_EMAIL_WEBHOOK_SECRET: `  ${OPERATORS_SECRET}\t`,
    });

    const answer: Answer = await post({
      origin: installation.origin,
      path: webhookPath(ADDRESSES[0]!, OPERATORS_SECRET),
      body: DELIVERY,
    });

    expect(answer.status).toBe(200);
    expect(mockQueuedEmails).toHaveLength(1);
  });

  test.each([
    ["another value", "anything"],
    ["another installation's secret", OTHER_INSTALLATIONS_SECRET],
    ["the secret in other case", OPERATORS_SECRET.toUpperCase()],
    ["the secret less its last character", OPERATORS_SECRET.slice(0, -1)],
    ["the secret and one character more", `${OPERATORS_SECRET}0`],
    ["the secret with a space before it", ` ${OPERATORS_SECRET}`],
    ["the secret twice", `${OPERATORS_SECRET}${OPERATORS_SECRET}`],
    ["the guide's placeholder", "YOUR_SECRET"],
  ])(
    "an address that ends with %s: 403 at every address, and nothing is queued",
    async (_label: string, ending: string) => {
      const installation: Installation = await startInstallation({
        INBOUND_EMAIL_DOMAIN: DOMAIN,
        INBOUND_EMAIL_WEBHOOK_SECRET: OPERATORS_SECRET,
      });

      for (const address of ADDRESSES) {
        const answer: Answer = await post({
          origin: installation.origin,
          path: webhookPath(address, ending),
          body: DELIVERY,
        });

        expect({ address, status: answer.status }).toEqual({
          address,
          status: 403,
        });
        expect(messageOf(answer)).toBe(installation.messages.wrongSecret);
      }

      expect(mockQueuedEmails).toEqual([]);
    },
  );

  test("the address without its last part is no route at all", async () => {
    const installation: Installation = await startInstallation({
      INBOUND_EMAIL_DOMAIN: DOMAIN,
      INBOUND_EMAIL_WEBHOOK_SECRET: OPERATORS_SECRET,
    });

    for (const address of ADDRESSES) {
      for (const path of [address, `${address}/`]) {
        const answer: Answer = await post({
          origin: installation.origin,
          path: path,
          body: DELIVERY,
        });

        expect(answer.status).toBe(404);
      }
    }

    expect(mockQueuedEmails).toEqual([]);
  });

  test("neither the secret nor a wrong guess at it reaches the log", async () => {
    const installation: Installation = await startInstallation({
      INBOUND_EMAIL_DOMAIN: DOMAIN,
      INBOUND_EMAIL_WEBHOOK_SECRET: OPERATORS_SECRET,
    });

    await post({
      origin: installation.origin,
      path: webhookPath(ADDRESSES[0]!, OPERATORS_SECRET),
      body: DELIVERY,
    });
    await post({
      origin: installation.origin,
      path: webhookPath(ADDRESSES[0]!, "guess-0b5d2e71"),
      body: DELIVERY,
    });

    const log: string = mockLogLines.join("\n");

    expect(log).not.toContain(OPERATORS_SECRET);
    expect(log).not.toContain("guess-0b5d2e71");
  });
});

describe("a request is refused before its body is read", () => {
  test.each([
    ["a body the multipart parser cannot read", UNREADABLE_BODY],
    ["a body over the multipart parser's limits", OVER_LIMIT_BODY],
    ["a body that is not multipart at all", "not a form"],
  ])(
    "%s, with no secret of the installation's own: 503",
    async (_label: string, body: string) => {
      const installation: Installation = await startInstallation({
        INBOUND_EMAIL_DOMAIN: DOMAIN,
      });

      for (const address of ADDRESSES) {
        const answer: Answer = await post({
          origin: installation.origin,
          path: webhookPath(address, "anything"),
          body: body,
        });

        expect(answer.status).toBe(503);
        expect(messageOf(answer)).toBe(installation.messages.noSecret);
      }

      expect(mockQueuedEmails).toEqual([]);
    },
  );

  test.each([
    ["a body the multipart parser cannot read", UNREADABLE_BODY],
    ["a body over the multipart parser's limits", OVER_LIMIT_BODY],
  ])(
    "%s, at an address that does not end with the secret: 403",
    async (_label: string, body: string) => {
      const installation: Installation = await startInstallation({
        INBOUND_EMAIL_DOMAIN: DOMAIN,
        INBOUND_EMAIL_WEBHOOK_SECRET: OPERATORS_SECRET,
      });

      for (const address of ADDRESSES) {
        const answer: Answer = await post({
          origin: installation.origin,
          path: webhookPath(address, OTHER_INSTALLATIONS_SECRET),
          body: body,
        });

        expect(answer.status).toBe(403);
        expect(messageOf(answer)).toBe(installation.messages.wrongSecret);
      }

      expect(mockQueuedEmails).toEqual([]);
    },
  );

  test("the parser still holds the provider's deliveries to its limits", async () => {
    const installation: Installation = await startInstallation({
      INBOUND_EMAIL_DOMAIN: DOMAIN,
      INBOUND_EMAIL_WEBHOOK_SECRET: OPERATORS_SECRET,
    });

    const answer: Answer = await post({
      origin: installation.origin,
      path: webhookPath(ADDRESSES[0]!, OPERATORS_SECRET),
      body: OVER_LIMIT_BODY,
    });

    expect(answer.status).toBe(413);
    expect(mockQueuedEmails).toEqual([]);
  });
});

describe("an installation with incoming email off", () => {
  test.each([
    ["no secret", undefined],
    ["a secret", OPERATORS_SECRET],
  ])(
    "with %s: 400, incoming email is not configured, and nothing is queued",
    async (_label: string, secret: string | undefined) => {
      const installation: Installation = await startInstallation({
        INBOUND_EMAIL_WEBHOOK_SECRET: secret,
      });

      for (const address of ADDRESSES) {
        const answer: Answer = await post({
          origin: installation.origin,
          path: webhookPath(address, OPERATORS_SECRET),
          body: DELIVERY,
        });

        expect(answer.status).toBe(400);
        expect(messageOf(answer)).toBe(installation.messages.notConfigured);
      }

      expect(mockQueuedEmails).toEqual([]);
    },
  );
});
