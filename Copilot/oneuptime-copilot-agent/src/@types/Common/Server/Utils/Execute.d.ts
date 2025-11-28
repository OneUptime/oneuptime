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
