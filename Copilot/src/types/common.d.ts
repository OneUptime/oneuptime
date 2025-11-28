declare module "Common/Server/Utils/Logger" {
  interface Logger {
    info(message: unknown): void;
    error(message: unknown): void;
    warn(message: unknown): void;
    debug(message: unknown): void;
    trace(message: unknown): void;
  }

  const logger: Logger;
  export default logger;
}

declare module "Common/Server/Utils/Execute" {
  import { ExecOptions, SpawnOptions } from "node:child_process";

  export default class Execute {
    public static executeCommand(
      command: string,
      options?: ExecOptions,
    ): Promise<string>;

    public static executeCommandFile(data: {
      command: string;
      args: Array<string>;
      cwd: string;
    }): Promise<string>;

    public static executeCommandInheritStdio(data: {
      command: string;
      args?: Array<string>;
      options?: SpawnOptions;
    }): Promise<void>;
  }
}

declare module "Common/Server/Utils/LocalFile" {
  export default class LocalFile {
    public static read(path: string): Promise<string>;
    public static write(path: string, data: string): Promise<void>;
    public static makeDirectory(path: string): Promise<void>;
    public static deleteFile(path: string): Promise<void>;
    public static deleteDirectory(path: string): Promise<void>;
    public static readDirectory(path: string): Promise<Array<import("node:fs").Dirent>>;
    public static doesFileExist(path: string): Promise<boolean>;
    public static doesDirectoryExist(path: string): Promise<boolean>;
    public static sanitizeFilePath(path: string): string;
  }
}

declare module "Common/Types/Exception/BadDataException" {
  export default class BadDataException extends Error {}
}

declare module "Common/Types/JSON" {
  export type JSONValue = string | number | boolean | null | JSONArray | JSONObject;
  export interface JSONObject {
    [key: string]: JSONValue;
  }
  export interface JSONArray extends Array<JSONValue> {}
}
