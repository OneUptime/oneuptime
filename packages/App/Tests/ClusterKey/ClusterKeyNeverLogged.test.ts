import {
  ClusterKeyConfiguration,
  OPERATOR_CLUSTER_KEYS,
  restoreClusterKey,
  setClusterKey,
} from "Common/Tests/Server/TestingUtils/ShippedClusterKeys";
import ObjectID from "Common/Types/ObjectID";
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
import { createServer, Server } from "http";
import { AddressInfo } from "net";
import util from "util";

/*
 * OneUptime's own services present the cluster key to each other in the
 * clusterkey request header. A call that fails - the workflow service still
 * starting, the notification service restarting - is logged by whoever made
 * it, with the request the client was making. Every log record goes to the
 * console, to the recent-log buffer the support bundle reads, and to the
 * configured log exporter, so the key is redacted there like every other
 * credential: as a header, as a field of a body, and as text.
 *
 * The calls below are the real ones, through the real request client, to an
 * address nothing listens on, logged by the real logger.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "6c7f1e2a-3b4d-4e5f-8a9b-0c1d2e3f4a5b",
);
const INCIDENT_ID: ObjectID = new ObjectID(
  "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
);

type AnyModule = any; // eslint-disable-line @typescript-eslint/no-explicit-any

function require_(modulePath: string): AnyModule {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  return require(modulePath);
}

interface Process {
  logger: AnyModule;
  ClusterKeyAuthorization: AnyModule;
  IncidentService: AnyModule;
  MailService: AnyModule;
  Email: AnyModule;
  // What the log exporter was handed.
  exported: Array<string>;
}

// A port nothing listens on.
async function closedPort(): Promise<number> {
  const http: Server = createServer();

  await new Promise<void>((resolve: () => void) => {
    http.listen(0, "127.0.0.1", resolve);
  });

  const port: number = (http.address() as AddressInfo).port;

  await new Promise<void>((resolve: () => void) => {
    http.close(() => {
      resolve();
    });
  });

  return port;
}

/*
 * One app process of an installation whose operator set this
 * ONEUPTIME_SECRET, reaching its own services at an address that does not
 * answer.
 */
function startProcess(clusterKey: string, port: number): Process {
  const saved: Record<string, string | undefined> = {
    SERVER_APP_HOSTNAME: process.env["SERVER_APP_HOSTNAME"],
    APP_PORT: process.env["APP_PORT"],
    LOG_LEVEL: process.env["LOG_LEVEL"],
  };

  process.env["SERVER_APP_HOSTNAME"] = "127.0.0.1";
  process.env["APP_PORT"] = String(port);
  process.env["LOG_LEVEL"] = "DEBUG";
  setClusterKey(clusterKey);

  let started: Process | null = null;

  try {
    jest.isolateModules(() => {
      const exported: Array<string> = [];
      const Telemetry: AnyModule = require_(
        "Common/Server/Utils/Telemetry",
      ).default;

      jest.spyOn(Telemetry, "getLogger").mockReturnValue({
        emit: (record: { body: string }): void => {
          exported.push(String(record.body));
        },
      } as never);

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
        ClusterKeyAuthorization: require_(
          "Common/Server/Middleware/ClusterKeyAuthorization",
        ).default,
        IncidentService: require_("Common/Server/Services/IncidentService")
          .default,
        MailService: require_("Common/Server/Services/MailService").default,
        Email: require_("Common/Types/Email").default,
        exported: exported,
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

// Everything the console printed, printed as deep as anything would.
const printed: Array<string> = [];

beforeEach(() => {
  printed.length = 0;

  for (const method of ["log", "info", "warn", "error", "debug"] as const) {
    jest
      .spyOn(console, method)
      .mockImplementation((...args: Array<unknown>): void => {
        printed.push(
          args
            .map((arg: unknown): string => {
              return typeof arg === "string"
                ? arg
                : util.inspect(arg, { depth: null });
            })
            .join(" "),
        );
      });
  }
});

afterEach(() => {
  jest.restoreAllMocks();
});

afterAll(() => {
  restoreClusterKey();
});

// Every sink a log record reaches, as text.
function everySink(running: Process): Record<string, string> {
  return {
    console: printed.join("\n"),
    "recent logs": running.logger
      .getRecentLogs()
      .map((entry: { message: string }): string => {
        return entry.message;
      })
      .join("\n"),
    exporter: running.exported.join("\n"),
  };
}

async function waitFor(condition: () => boolean): Promise<void> {
  for (let attempt: number = 0; attempt < 200; attempt++) {
    if (condition()) {
      return;
    }

    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 10);
    });
  }

  throw new Error("Timed out waiting for the condition.");
}

describe.each(
  OPERATOR_CLUSTER_KEYS.filter((configuration: ClusterKeyConfiguration) => {
    // Long enough that finding it in a log is not a coincidence.
    return (configuration.value || "").trim().length >= 12;
  }).map((configuration: ClusterKeyConfiguration): [string, string] => {
    return [configuration.label, configuration.value!];
  }),
)(
  "an installation whose ONEUPTIME_SECRET is %s",
  (_label: string, clusterKey: string) => {
    let port: number;

    beforeAll(async () => {
      port = await closedPort();
    });

    function expectNoKeyIn(running: Process): void {
      const presented: string = running.ClusterKeyAuthorization.getClusterKey();

      for (const [sink, text] of Object.entries(everySink(running))) {
        for (const form of [presented, clusterKey.trim()]) {
          expect({ sink, holdsTheKey: text.includes(form) }).toStrictEqual({
            sink,
            holdsTheKey: false,
          });
        }
      }
    }

    test("a workflow trigger the workflow service did not answer is logged without the key", async () => {
      const running: Process = startProcess(clusterKey, port);

      await running.IncidentService.onTriggerWorkflow(
        INCIDENT_ID,
        PROJECT_ID,
        "on-create",
      );

      await waitFor(() => {
        return running.logger.getRecentLogs().length > 0;
      });

      // The failure is logged, and says where the call went.
      expect(everySink(running)["recent logs"]).toContain(
        `127.0.0.1:${port}/workflow/model/${PROJECT_ID.toString()}/incident/on-create`,
      );
      expectNoKeyIn(running);
    });

    test("an email the notification service did not answer is logged without the key", async () => {
      const running: Process = startProcess(clusterKey, port);
      let failure: unknown = null;

      try {
        await running.MailService.sendMail({
          toEmail: new running.Email("oncall@example.com"),
          subject: "Incident #1",
          templateType: "EmptyTemplate",
          vars: {},
          body: "An incident was created.",
        });
      } catch (error) {
        failure = error;
      }

      expect(failure).not.toBeNull();

      // As the workers that send email log what failed.
      running.logger.error(failure);

      expect(everySink(running)["recent logs"]).toContain(
        "/api/notification/email/send",
      );
      expectNoKeyIn(running);
    });

    test("the headers, a body field and text naming the key are all logged without it", () => {
      const running: Process = startProcess(clusterKey, port);
      const presented: string = running.ClusterKeyAuthorization.getClusterKey();

      running.logger.error({
        headers: running.ClusterKeyAuthorization.getClusterKeyHeaders(),
      });
      running.logger.error({ headers: { "x-clusterkey": presented } });
      running.logger.error({ data: { clusterKey: presented } });
      running.logger.error(JSON.stringify({ clusterKey: presented }));
      running.logger.debug(
        `POST /api/ai-agent/register HTTP/1.1\r\nclusterkey: ${presented}\r\nHost: oneuptime\r\n`,
      );
      running.logger.debug(`calling with clusterKey=${presented}&skip=0`);

      expect(running.logger.getRecentLogs()).toHaveLength(6);
      expectNoKeyIn(running);
    });
  },
);
