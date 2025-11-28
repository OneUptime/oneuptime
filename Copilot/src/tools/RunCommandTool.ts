import { ExecOptions } from "node:child_process";
import { z } from "zod";
import Execute from "Common/Server/Utils/Execute";
import { JSONObject } from "Common/Types/JSON";
import { StructuredTool, ToolResponse, ToolRuntime } from "./Tool";
import AgentLogger from "../utils/AgentLogger";

interface RunCommandArgs {
  command: string;
  path?: string | undefined;
  timeoutMs?: number | undefined;
}

export class RunCommandTool extends StructuredTool<RunCommandArgs> {
  public readonly name: string = "run_command";
  public readonly description: string =
    "Runs a shell command inside the workspace (for unit tests, linters, or project-specific scripts).";
  public readonly parameters: JSONObject = {
    type: "object",
    required: ["command"],
    properties: {
      command: {
        type: "string",
        description:
          "Shell command to execute. Prefer running package scripts instead of raw binaries when possible.",
      },
      path: {
        type: "string",
        description: "Optional subdirectory to run the command from.",
      },
      timeoutMs: {
        type: "integer",
        minimum: 1000,
        maximum: 1800000,
        description: "Timeout in milliseconds (default 10 minutes).",
      },
    },
  };

  protected schema = z
    .object({
      command: z.string().min(1),
      path: z.string().trim().optional(),
      timeoutMs: z.number().int().min(1000).max(1800000).optional(),
    })
    .strict();

  public async execute(
    args: RunCommandArgs,
    runtime: ToolRuntime,
  ): Promise<ToolResponse> {
    const cwd: string = args.path
      ? runtime.workspacePaths.resolve(args.path)
      : runtime.workspaceRoot;
    AgentLogger.debug("RunCommandTool executing", {
      command: args.command,
      cwd,
      timeoutMs: args.timeoutMs,
    });

    const options: ExecOptions = {
      cwd,
      timeout: args.timeoutMs ?? 10 * 60 * 1000,
      maxBuffer: 8 * 1024 * 1024,
    };

    try {
      const output: string = await Execute.executeCommand(args.command, options);
      AgentLogger.debug("RunCommandTool succeeded", {
        command: args.command,
        cwd,
        outputPreview: output.slice(0, 500),
      });
      return {
        content: `Command executed in ${runtime.workspacePaths.relative(cwd) || "."}\n$ ${args.command}\n${output.trim()}`,
      };
    } catch (error) {
      AgentLogger.error("RunCommandTool failed", error as Error);
      return {
        content: `Command failed: ${args.command}\n${(error as Error).message}`,
        isError: true,
      };
    }
  }
}
