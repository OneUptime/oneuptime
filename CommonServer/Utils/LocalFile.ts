import { PromiseRejectErrorFunction } from "Common/Types/FunctionTypes";
import fs from "fs";

export default class LocalFile {
  public static sanitizeFilePath(filePath: string): string {
    // remove double slashes
    return filePath.replace(/\/\//g, "/");
  }

  public static getFileExtension(filePath: string): string {
    const fileExtention: Array<string> = filePath.split(".");
    return fileExtention[fileExtention.length - 1]?.toLowerCase() || "";
  }

  public static async makeDirectory(path: string): Promise<void> {
    return new Promise(
      (resolve: VoidFunction, reject: PromiseRejectErrorFunction) => {
        fs.mkdir(path, { recursive: true }, (err: Error | null) => {
          if (err) {
            return reject(err);
          }
          resolve();
        });
      },
    );
  }

  public static async write(path: string, data: string): Promise<void> {
    return new Promise(
      (resolve: VoidFunction, reject: PromiseRejectErrorFunction) => {
        fs.writeFile(path, data, (err: Error | null) => {
          if (err) {
            return reject(err);
          }
          resolve();
        });
      },
    );
  }

  public static async read(path: string): Promise<string> {
    return new Promise(
      (resolve: (data: string) => void, reject: PromiseRejectErrorFunction) => {
        fs.readFile(
          path,
          { encoding: "utf-8" },
          (err: Error | null, data: string) => {
            if (!err) {
              return resolve(data);
            }
            return reject(err);
          },
        );
      },
    );
  }
}
