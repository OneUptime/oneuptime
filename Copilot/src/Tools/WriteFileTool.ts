import fs from "node:fs/promises";
import { z } from "zod";
import LocalFile from "Common/Server/Utils/LocalFile";
import { JSONObject } from "Common/Types/JSON";
import { StructuredTool, ToolResponse, ToolRuntime } from "./Tool";
import AgentLogger from "../Utils/AgentLogger";

/** Arguments describing what to write and where. */
interface WriteFileArgs {
  path: string;
  content: string;
  mode?: "overwrite" | "append" | undefined;
}

/** Creates or appends to workspace files with validated inputs. */
export class WriteFileTool extends StructuredTool<WriteFileArgs> {
  public readonly name: string = "write_file";
  public readonly description: string =
    "Creates a new file or replaces an existing file with the provided content. Use this for docs, configs, or single-file outputs.";
  public readonly parameters: JSONObject = {
    type: "object",
    required: ["path", "content"],
    properties: {
      path: {
        type: "string",
        description: "File path relative to the workspace root.",
      },
      content: {
        type: "string",
        description: "Entire file content to be written.",
      },
      mode: {
        type: "string",
        enum: ["overwrite", "append"],
        description:
          "Overwrite replaces the file (default). Append adds content to the end of the file.",
      },
    },
  };

  protected schema = z
    .object({
      path: z.string().min(1),
      content: z.string().min(1),
      mode: z.enum(["overwrite", "append"]).optional().default("overwrite"),
    })
    .strict();

  /** Persists the provided content at the resolved workspace path. */
  public async execute(
    args: WriteFileArgs,
    runtime: ToolRuntime,
  ): Promise<ToolResponse> {
    const absolutePath: string = runtime.workspacePaths.resolve(args.path);
    AgentLogger.debug("WriteFileTool executing", {
      path: args.path,
      mode: args.mode,
      contentLength: args.content.length,
    });
    await runtime.workspacePaths.ensureParentDirectory(absolutePath);

    if (
      args.mode === "append" &&
      (await LocalFile.doesFileExist(absolutePath))
    ) {
      await fs.appendFile(absolutePath, args.content);
    } else {
      await LocalFile.write(absolutePath, args.content);
    }

    const relative: string = runtime.workspacePaths.relative(absolutePath);
    AgentLogger.debug("WriteFileTool completed", {
      relative,
      mode: args.mode ?? "overwrite",
    });
    return {
      content: `${args.mode === "append" ? "Appended to" : "Wrote"} ${relative} (${args.content.length} characters).`,
    };
  }
}
