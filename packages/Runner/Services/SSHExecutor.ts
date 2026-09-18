import { Client, ClientChannel, ConnectConfig } from "ssh2";
import { MAX_OUTPUT_BYTES } from "../Config";
import { JSONObject } from "Common/Types/JSON";

export interface SSHExecResult {
  success: boolean;
  output: string;
  exitCode?: number | undefined;
  errorMessage?: string | undefined;
}

function truncate(s: string): string {
  if (Buffer.byteLength(s, "utf8") <= MAX_OUTPUT_BYTES) {
    return s;
  }

  return (
    Buffer.from(s, "utf8").slice(0, MAX_OUTPUT_BYTES).toString("utf8") +
    "\n... [output truncated]"
  );
}

/*
 * Run one command on a remote host over SSH.
 *
 * The connection is opened, used and closed per step — no pooling. A runbook
 * step is an occasional, consequential action, and a pool would keep
 * credentials resident and connections open against hosts that may be exactly
 * the ones misbehaving.
 *
 * The command is sent verbatim rather than through a shell the Runner builds,
 * so nothing here re-quotes or re-interprets what the author wrote.
 */
export default class SSHExecutor {
  public static execute(data: {
    payload: JSONObject;
    credential: JSONObject;
    timeoutInMs: number;
  }): Promise<SSHExecResult> {
    const command: string = String(data.payload["command"] || "");
    const hostname: string = String(data.credential["hostname"] || "");
    const username: string = String(data.credential["username"] || "");
    const port: number = Number(data.credential["port"] || 22);

    if (!hostname || !username) {
      return Promise.resolve({
        success: false,
        output: "",
        errorMessage: "SSH credential is missing a hostname or username.",
      });
    }

    if (!command) {
      return Promise.resolve({
        success: false,
        output: "",
        errorMessage: "SSH step has no command to run.",
      });
    }

    const privateKey: string | undefined = data.credential["privateKey"]
      ? String(data.credential["privateKey"])
      : undefined;
    const passphrase: string | undefined = data.credential["passphrase"]
      ? String(data.credential["passphrase"])
      : undefined;
    const password: string | undefined = data.credential["password"]
      ? String(data.credential["password"])
      : undefined;

    if (!privateKey && !password) {
      return Promise.resolve({
        success: false,
        output: "",
        errorMessage:
          "SSH credential has neither a private key nor a password.",
      });
    }

    return new Promise<SSHExecResult>((resolve: (v: SSHExecResult) => void) => {
      const conn: Client = new Client();

      let stdout: string = "";
      let stderr: string = "";
      let settled: boolean = false;

      const finish: (result: SSHExecResult) => void = (
        result: SSHExecResult,
      ): void => {
        if (settled) {
          return;
        }
        settled = true;
        clearTimeout(timer);

        try {
          conn.end();
        } catch {
          // The connection is already gone; the result stands either way.
        }

        resolve(result);
      };

      /*
       * One deadline covers connect, auth and execution together. ssh2's own
       * readyTimeout only covers the handshake, which would leave a command
       * that hangs forever holding the step open past its timeout.
       */
      const timer: ReturnType<typeof setTimeout> = setTimeout(() => {
        finish({
          success: false,
          output: truncate(stdout + stderr),
          errorMessage: `SSH step timed out after ${data.timeoutInMs}ms.`,
        });
      }, data.timeoutInMs);

      conn.on("ready", () => {
        conn.exec(command, (err: Error | undefined, stream: ClientChannel) => {
          if (err) {
            return finish({
              success: false,
              output: "",
              errorMessage: err.message,
            });
          }

          stream.on("data", (chunk: Buffer) => {
            if (Buffer.byteLength(stdout, "utf8") < MAX_OUTPUT_BYTES) {
              stdout += chunk.toString("utf8");
            }
          });

          stream.stderr.on("data", (chunk: Buffer) => {
            if (Buffer.byteLength(stderr, "utf8") < MAX_OUTPUT_BYTES) {
              stderr += chunk.toString("utf8");
            }
          });

          stream.on("close", (code: number | null) => {
            const exitCode: number = typeof code === "number" ? code : 1;
            const output: string = truncate(
              stdout + (stderr ? `\n${stderr}` : ""),
            );

            finish({
              success: exitCode === 0,
              output,
              exitCode,
              ...(exitCode === 0
                ? {}
                : { errorMessage: `Command exited with code ${exitCode}.` }),
            });
          });

          return undefined;
        });
      });

      conn.on("error", (err: Error) => {
        finish({
          success: false,
          output: truncate(stdout + stderr),
          errorMessage: err.message,
        });
      });

      const connectConfig: ConnectConfig = {
        host: hostname,
        port,
        username,
        readyTimeout: data.timeoutInMs,
        ...(privateKey ? { privateKey } : {}),
        ...(passphrase ? { passphrase } : {}),
        ...(password ? { password } : {}),
      };

      try {
        conn.connect(connectConfig);
      } catch (err) {
        finish({
          success: false,
          output: "",
          errorMessage: err instanceof Error ? err.message : String(err),
        });
      }
    });
  }
}
