import {
  CLUSTER_KEY_ROUTE_TOOL_CALLERS,
  ClusterKeyRouteToolCaller,
} from "Common/Tests/Server/TestingUtils/ClusterKeyRoutes";
import {
  ClusterKeyConfiguration,
  OPERATOR_CLUSTER_KEYS,
  restoreClusterKey,
  setClusterKey,
} from "Common/Tests/Server/TestingUtils/ShippedClusterKeys";
import type ClusterKeyAuthorizationType from "Common/Server/Middleware/ClusterKeyAuthorization";
import { JSONObject } from "Common/Types/JSON";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { execFile } from "child_process";
import fs from "fs";
import { createServer, IncomingMessage, Server, ServerResponse } from "http";
import { AddressInfo } from "net";
import os from "os";
import path from "path";

jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
    getLogAttributesFromRequest: jest.fn().mockReturnValue({}),
  };
});

/*
 * The key the installation's own tools present is the key the app accepts,
 * whatever characters the operator chose.
 *
 * `npm run doctor` (Scripts/Install/Doctor.js) and HelmChart/Public/diagnose.sh
 * read ONEUPTIME_SECRET from the installation's own configuration and present
 * it to the doctor's POST (CLUSTER_KEY_ROUTE_TOOL_CALLERS); ClusterKeyGuard
 * holds how each writes that request. Here each runs as it runs on a server,
 * with this machine's node - the doctor as `npm start` ends, in a folder with
 * a config.env, and the script diagnose.sh hands the app pod with the pod's
 * environment - against a server that answers the doctor's POST as the app's
 * check decides: ClusterKeyAuthorization.isAcceptedClusterKey, in a fresh
 * copy of the product loaded with the ONEUPTIME_SECRET the app runs with. So
 * the way the tools present a key and the way the app compares one cannot
 * drift apart.
 */

type ClusterKeyAuthorizationClass = typeof ClusterKeyAuthorizationType;

type AnyModule = any; // eslint-disable-line @typescript-eslint/no-explicit-any

function require_(modulePath: string): AnyModule {
  // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
  return require(modulePath);
}

// <repo>/packages/App/Tests/ClusterKey -> <repo>
const REPOSITORY_ROOT: string = path.resolve(__dirname, "../../../..");

const DOCTOR_TOOL: string = "Scripts/Install/Doctor.js";
const DIAGNOSE_TOOL: string = "HelmChart/Public/diagnose.sh";

// What `npm start` runs Docker Compose through: it exports config.env's settings.
const WITH_CONFIG: string = path.join(
  REPOSITORY_ROOT,
  "Scripts/Install/WithConfig.sh",
);

// The keys an operator chooses, and one with each character of a query string's syntax.
const KEYS: Array<ClusterKeyConfiguration> = [
  ...OPERATOR_CLUSTER_KEYS,
  { label: "+ / = @ & % between letters", value: "Ab+c/d=e@f&g%h" },
];

// The app's answer: one thing to fix, and its version.
const ANSWER: JSONObject = {
  findings: [
    {
      id: "setup-email",
      level: "fix",
      title: "Email",
      sentence: "Not set up yet: OneUptime cannot send invitations.",
      fixSentence: "Finish it on the Server setup page.",
    },
  ],
  version: { current: "14.0.109" },
};

/*
 * Whether the app accepts what a caller presents, when it runs with this
 * ONEUPTIME_SECRET: the real check, in a fresh copy of the product.
 */
const acceptances: Map<string, (presented: unknown) => boolean> = new Map();

function appAccepting(configured: string): (presented: unknown) => boolean {
  const known: ((presented: unknown) => boolean) | undefined =
    acceptances.get(configured);

  if (known) {
    return known;
  }

  setClusterKey(configured);

  let accepts: ((presented: unknown) => boolean) | null = null;

  try {
    jest.isolateModules(() => {
      const ClusterKeyAuthorization: ClusterKeyAuthorizationClass = require_(
        "Common/Server/Middleware/ClusterKeyAuthorization",
      ).default;

      accepts = (presented: unknown): boolean => {
        return ClusterKeyAuthorization.isAcceptedClusterKey(presented);
      };
    });
  } finally {
    restoreClusterKey();
  }

  acceptances.set(configured, accepts!);

  return accepts!;
}

function toolCaller(tool: string): ClusterKeyRouteToolCaller {
  const entry: ClusterKeyRouteToolCaller | undefined =
    CLUSTER_KEY_ROUTE_TOOL_CALLERS.find(
      (caller: ClusterKeyRouteToolCaller): boolean => {
        return caller.tool === tool;
      },
    );

  if (!entry) {
    throw new Error(`${tool} is not in CLUSTER_KEY_ROUTE_TOOL_CALLERS`);
  }

  return entry;
}

// The node script diagnose.sh hands the app pod: its single quotes hold it whole.
function podScript(): string {
  const name: string = toolCaller(DIAGNOSE_TOOL).script || "";
  const match: RegExpExecArray | null = new RegExp(
    `^${name}='([^']*)'$`,
    "m",
  ).exec(fs.readFileSync(path.join(REPOSITORY_ROOT, DIAGNOSE_TOOL), "utf8"));

  if (!name || !match) {
    throw new Error(`${DIAGNOSE_TOOL} holds no ${name || "script"}`);
  }

  return match[1]!;
}

// Runs a program with only this environment besides PATH: what it printed.
function runProgram(
  file: string,
  args: Array<string>,
  options: { cwd?: string; env?: Record<string, string> },
): Promise<string> {
  return new Promise<string>(
    (resolve: (output: string) => void, reject: (error: Error) => void) => {
      execFile(
        file,
        args,
        {
          cwd: options.cwd,
          encoding: "utf8",
          env: { PATH: process.env["PATH"] || "", ...(options.env || {}) },
          timeout: 30000,
        },
        (error: Error | null, stdout: string) => {
          if (error) {
            reject(error);
            return;
          }

          resolve(stdout);
        },
      );
    },
  );
}

// config.env of a Docker Compose install whose ingress is this port, with this key.
function doctorConfig(port: number, key: string): string {
  return [
    `HOST=127.0.0.1:${port}`,
    "HTTP_PROTOCOL=http",
    "PROVISION_SSL=false",
    `ONEUPTIME_HTTP_PORT=127.0.0.1:${port}`,
    `ONEUPTIME_SECRET=${key}`,
  ].join("\n");
}

interface ToolRun {
  /*
   * Runs the tool with this key in its configuration, against the app at
   * this port, once `startApp` is handed the ONEUPTIME_SECRET the app runs
   * with: what the tool printed.
   */
  run: (
    port: number,
    key: string,
    startApp: (configured: string) => void,
  ) => Promise<string>;
  // What it prints of ANSWER.
  printed: string;
}

const TOOL_RUNS: Record<string, ToolRun> = {
  [DIAGNOSE_TOOL]: {
    run: async (
      port: number,
      key: string,
      startApp: (configured: string) => void,
    ): Promise<string> => {
      // Inside the app pod: the app's own environment.
      startApp(key);

      return await runProgram(process.execPath, ["-e", podScript()], {
        env: { PORT: String(port), ONEUPTIME_SECRET: key },
      });
    },
    printed:
      "fix|Email|Not set up yet: OneUptime cannot send invitations.|Finish it on the Server setup page.",
  },
  [DOCTOR_TOOL]: {
    run: async (
      port: number,
      key: string,
      startApp: (configured: string) => void,
    ): Promise<string> => {
      const directory: string = fs.mkdtempSync(
        path.join(os.tmpdir(), "doctor-key-"),
      );

      try {
        fs.writeFileSync(
          path.join(directory, "config.env"),
          doctorConfig(port, key),
        );

        /*
         * config.env's, as npm start hands it to the app: WithConfig.sh
         * exports it, and docker-compose.base.yml passes ONEUPTIME_SECRET on
         * as it is.
         */
        startApp(
          await runProgram(
            "sh",
            [
              WITH_CONFIG,
              process.execPath,
              "-e",
              'process.stdout.write(process.env.ONEUPTIME_SECRET || "")',
            ],
            { cwd: directory },
          ),
        );

        // As npm start ends: node ./Scripts/Install/Doctor.js --after-start, where config.env is.
        return await runProgram(
          process.execPath,
          [path.join(REPOSITORY_ROOT, DOCTOR_TOOL), "--after-start"],
          { cwd: directory },
        );
      } finally {
        fs.rmSync(directory, { recursive: true, force: true });
      }
    },
    printed: "✗ Email: Not set up yet: OneUptime cannot send invitations.",
  },
};

describe("the key the installation's own tools present is the key the app accepts", () => {
  let server: Server;
  let port: number = 0;
  let accepts: (presented: unknown) => boolean = (): boolean => {
    return false;
  };
  // Whether the app accepted each key presented to the doctor's POST.
  const answered: Array<boolean> = [];

  beforeAll(async () => {
    server = createServer((req: IncomingMessage, res: ServerResponse) => {
      if (req.method === "POST" && req.url === toolCaller(DOCTOR_TOOL).path) {
        const isAccepted: boolean = accepts(req.headers["clusterkey"]);

        answered.push(isAccepted);
        res.writeHead(isAccepted ? 200 : 400, {
          "content-type": "application/json",
        });
        res.end(
          JSON.stringify(
            isAccepted ? ANSWER : { message: "Invalid cluster key provided" },
          ),
        );
        return;
      }

      // The doctor's ready check, at the ingress: OneUptime answers.
      res.writeHead(req.method === "GET" ? 200 : 404);
      res.end("ok");
    });

    await new Promise<void>((resolve: () => void) => {
      server.listen(0, "127.0.0.1", resolve);
    });
    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    await new Promise<void>((resolve: () => void) => {
      server.close(() => {
        resolve();
      });
    });
  });

  test("every tool that presents the key is run here, at the doctor's path", () => {
    expect(Object.keys(TOOL_RUNS).sort()).toEqual(
      CLUSTER_KEY_ROUTE_TOOL_CALLERS.map(
        (entry: ClusterKeyRouteToolCaller): string => {
          return entry.tool;
        },
      ).sort(),
    );
    expect(
      CLUSTER_KEY_ROUTE_TOOL_CALLERS.map(
        (entry: ClusterKeyRouteToolCaller): string => {
          return entry.path;
        },
      ),
    ).toEqual(
      CLUSTER_KEY_ROUTE_TOOL_CALLERS.map((): string => {
        return toolCaller(DOCTOR_TOOL).path;
      }),
    );
  });

  describe.each(KEYS)(
    "a key $label",
    (configuration: ClusterKeyConfiguration) => {
      const key: string = configuration.value!;

      test.each(Object.keys(TOOL_RUNS))(
        "%s presents it as the app accepts it, and reads the app's answer",
        async (tool: string) => {
          answered.length = 0;

          const output: string = await TOOL_RUNS[tool]!.run(
            port,
            key,
            (configured: string): void => {
              accepts = appAccepting(configured);
            },
          );

          expect({ tool, answered }).toEqual({ tool, answered: [true] });
          expect(output).toContain(TOOL_RUNS[tool]!.printed);
        },
      );
    },
  );
});
