import { PromiseRejectErrorFunction } from "../../Types/FunctionTypes";
import {
  ChildProcess,
  ExecException,
  ExecFileException,
  ExecOptions,
  SpawnOptions,
  exec,
  execFile,
  spawn,
} from "node:child_process";
import logger from "./Logger";
import CaptureSpan from "./Telemetry/CaptureSpan";

export default class Execute {
  @CaptureSpan()
  public static executeCommand(
    command: string,
    options?: ExecOptions,
  ): Promise<string> {
    return new Promise(
      (
        resolve: (output: string) => void,
        reject: PromiseRejectErrorFunction,
      ) => {
        exec(
          `${command}`,
          {
            ...options,
          },
          (
            err: ExecException | null,
            stdout: string | Buffer,
            stderr: string | Buffer,
          ) => {
            // See executeCommandFile: string | Buffer for @types/node drift.
            const stdoutText: string = stdout.toString();
            const stderrText: string = stderr.toString();

            if (err) {
              logger.error(`Error executing command: ${command}`);
              logger.error(err);
              logger.error(stdoutText);
              if (stderrText) {
                logger.error(stderrText);
              }
              return reject(err);
            }

            if (stderrText) {
              logger.debug(stderrText);
            }

            return resolve(stdoutText);
          },
        );
      },
    );
  }

  @CaptureSpan()
  public static executeCommandFile(data: {
    command: string;
    args: Array<string>;
    cwd: string;
    /*
     * Override the child_process default stdout/stderr cap (1 MB). Commands that
     * can emit large output (e.g. `git log` over a whole repo) should raise this.
     */
    maxBuffer?: number | undefined;
    /*
     * Hard upper bound (ms) on how long the child may run. When exceeded the
     * child is force-killed (SIGKILL) and the promise rejects, so a slow command
     * (e.g. `git log` over a huge full-history repo) can never hang the caller.
     */
    timeoutInMS?: number | undefined;
  }): Promise<string> {
    return new Promise(
      (
        resolve: (output: string) => void,
        reject: PromiseRejectErrorFunction,
      ) => {
        execFile(
          data.command,
          data.args,
          {
            cwd: data.cwd,
            ...(data.maxBuffer ? { maxBuffer: data.maxBuffer } : {}),
            ...(data.timeoutInMS
              ? { timeout: data.timeoutInMS, killSignal: "SIGKILL" }
              : {}),
          },
          (
            err: ExecFileException | null,
            stdout: string | Buffer,
            stderr: string | Buffer,
          ) => {
            /*
             * Newer @types/node type execFile's callback output as
             * string | Buffer — coerce so this compiles on both the pinned
             * and freshly-resolved typings (caret ranges drift in CI).
             */
            const stdoutText: string = stdout.toString();
            const stderrText: string = stderr.toString();

            if (err) {
              logger.error(
                `Error executing command: ${data.command} ${data.args.join(" ")}`,
              );
              logger.error(err);
              logger.error(stdoutText);
              logger.error(stderrText);
              return reject(err);
            }

            if (stderrText) {
              logger.debug(stderrText);
            }

            return resolve(stdoutText);
          },
        );
      },
    );
  }

  @CaptureSpan()
  public static executeCommandInheritStdio(data: {
    command: string;
    args?: Array<string>;
    options?: SpawnOptions;
  }): Promise<void> {
    return new Promise(
      (resolve: VoidFunction, reject: PromiseRejectErrorFunction) => {
        const spawnOptions: SpawnOptions = {
          stdio: ["ignore", "inherit", "inherit"],
          shell: false,
          ...data.options,
        };

        const child: ChildProcess = spawn(
          data.command,
          data.args ?? [],
          spawnOptions,
        );

        child.on("error", (err: Error) => {
          logger.error(
            `Error executing command: ${data.command} ${(data.args ?? []).join(" ")}`,
          );
          logger.error(err);
          reject(err);
        });

        child.on("close", (code: number | null) => {
          if (code === 0) {
            resolve();
            return;
          }

          const error: Error = new Error(
            `Command failed: ${data.command} ${(data.args ?? []).join(" ")} (exit code ${code ?? "unknown"})`,
          );
          logger.error(error);
          reject(error);
        });
      },
    );
  }
}
