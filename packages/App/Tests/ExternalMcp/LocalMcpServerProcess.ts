import { JSONObject } from "Common/Types/JSON";
import { ChildProcess, spawn } from "child_process";
import path from "path";

/*
 * THE FIXTURE MCP SERVER (Fixtures/LocalMcpServer.js), RUN AS A PROCESS OF
 * ITS OWN: started with this machine's node, from App (whose node_modules
 * hold the official MCP SDK it is built with), and read line by line - the
 * address it listens on, and every tool call it receives, as the arguments
 * arrived. A test asserts on what reached the server, and on what never did.
 */

const FIXTURE_PATH: string = path.join(
  __dirname,
  "Fixtures",
  "LocalMcpServer.js",
);

/*
 * The server that answers tools/list as a recorded one did (#11081):
 * kAgent's tool server, from Common/Tests/Fixtures/KAgentTools.
 */
export const RECORDED_FIXTURE_PATH: string = path.join(
  __dirname,
  "Fixtures",
  "RecordedMcpServer.js",
);

const APP_DIRECTORY: string = path.join(__dirname, "..", "..");

const READY_PREFIX: string = "MCP_FIXTURE_READY ";
const CALL_PREFIX: string = "MCP_FIXTURE_CALL ";

// How long the process may take to start listening.
const START_TIMEOUT_MS: number = 20000;

export interface McpFixtureCall {
  name: string;
  arguments: JSONObject;
}

export interface LocalMcpServerOptions {
  // The bearer token every request must carry.
  token?: string | undefined;
  // How long slow_query takes to answer.
  slowMs?: number | undefined;
  // Which fixture runs: LocalMcpServer.js unless a test says.
  fixture?: string | undefined;
  // More of the fixture's environment (RecordedMcpServer.js: its recording).
  env?: Record<string, string> | undefined;
}

export default class LocalMcpServerProcess {
  public readonly url: string;
  public readonly calls: Array<McpFixtureCall>;
  private readonly child: ChildProcess;
  private readonly exited: Promise<void>;

  private constructor(data: {
    url: string;
    calls: Array<McpFixtureCall>;
    child: ChildProcess;
    exited: Promise<void>;
  }) {
    this.url = data.url;
    this.calls = data.calls;
    this.child = data.child;
    this.exited = data.exited;
  }

  public static async start(
    options: LocalMcpServerOptions = {},
  ): Promise<LocalMcpServerProcess> {
    const calls: Array<McpFixtureCall> = [];
    const child: ChildProcess = spawn(
      process.execPath,
      [options.fixture || FIXTURE_PATH],
      {
        cwd: APP_DIRECTORY,
        env: {
          ...process.env,
          MCP_FIXTURE_TOKEN: options.token || "",
          MCP_FIXTURE_SLOW_MS: String(options.slowMs ?? 30000),
          ...(options.env || {}),
        },
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    const exited: Promise<void> = new Promise<void>((resolve: () => void) => {
      child.once("exit", () => {
        resolve();
      });
    });

    let errorOutput: string = "";

    child.stderr?.setEncoding("utf8");
    child.stderr?.on("data", (chunk: string) => {
      errorOutput += chunk;
    });

    const url: string = await new Promise<string>(
      (resolve: (url: string) => void, reject: (error: Error) => void) => {
        let pending: string = "";
        let isReady: boolean = false;

        const timer: ReturnType<typeof setTimeout> = setTimeout(() => {
          reject(
            new Error(
              `The fixture MCP server did not start in ${START_TIMEOUT_MS} ms: ${errorOutput}`,
            ),
          );
        }, START_TIMEOUT_MS);

        child.stdout?.setEncoding("utf8");
        child.stdout?.on("data", (chunk: string) => {
          pending += chunk;

          let newline: number = pending.indexOf("\n");

          while (newline >= 0) {
            const line: string = pending.slice(0, newline);
            pending = pending.slice(newline + 1);
            newline = pending.indexOf("\n");

            if (line.startsWith(READY_PREFIX) && !isReady) {
              isReady = true;
              clearTimeout(timer);
              resolve(line.slice(READY_PREFIX.length).trim());
            } else if (line.startsWith(CALL_PREFIX)) {
              calls.push(
                JSON.parse(line.slice(CALL_PREFIX.length)) as McpFixtureCall,
              );
            }
          }
        });

        child.once("exit", (code: number | null) => {
          if (!isReady) {
            clearTimeout(timer);
            reject(
              new Error(
                `The fixture MCP server exited (${code}) before it listened: ${errorOutput}`,
              ),
            );
          }
        });
      },
    );

    return new LocalMcpServerProcess({ url, calls, child, exited });
  }

  // The names of the tools it was asked to call, in order.
  public callNames(): Array<string> {
    return this.calls.map((call: McpFixtureCall): string => {
      return call.name;
    });
  }

  // Ends the process the way a server is stopped, and waits for it.
  public async stop(): Promise<void> {
    if (this.child.exitCode === null && this.child.signalCode === null) {
      this.child.kill("SIGTERM");
    }

    await this.exited;
  }

  // The server goes away at once, as a crashed or unplugged one does.
  public async kill(): Promise<void> {
    if (this.child.exitCode === null && this.child.signalCode === null) {
      this.child.kill("SIGKILL");
    }

    await this.exited;
  }
}
