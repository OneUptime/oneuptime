import { PromiseRejectErrorFunction } from "Common/Types/FunctionTypes";
import { ExecException, exec } from "node:child_process";
import logger from "./Logger";

export default class Execute {
  public static executeCommand(command: string): Promise<string> {
    return new Promise(
      (
        resolve: (output: string) => void,
        reject: PromiseRejectErrorFunction,
      ) => {
        exec(`${command}`, (err: ExecException | null, stdout: string) => {
          if (err) {
            logger.error(`Error executing command: ${command}`);
            logger.error(err);
            logger.error(stdout);
            return reject(err);
          }

          return resolve(stdout);
        });
      },
    );
  }
}
