import { PromiseRejectErrorFunction } from "../../Types/FunctionTypes";
import {
  ExecException,
  ExecOptions,
  exec,
  execFile,
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
          (err: ExecException | null, stdout: string, stderr: string) => {
          if (err) {
            logger.error(`Error executing command: ${command}`);
            logger.error(err);
            logger.error(stdout);
              if (stderr) {
                logger.error(stderr);
              }
            return reject(err);
          }

            if (stderr) {
              logger.debug(stderr);
            }

          return resolve(stdout);
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
          },
          (err: ExecException | null, stdout: string, stderr: string) => {
            if (err) {
              logger.error(
                `Error executing command: ${data.command} ${data.args.join(" ")}`,
              );
              logger.error(err);
              logger.error(stdout);
              logger.error(stderr);
              return reject(err);
            }

            if (stderr) {
              logger.debug(stderr);
            }

            return resolve(stdout);
          },
        );
      },
    );
  }
}
