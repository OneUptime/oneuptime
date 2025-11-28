import { z } from "zod";
import LocalFile from "Common/Server/Utils/LocalFile";
import { JSONObject } from "Common/Types/JSON";
import { StructuredTool, ToolResponse, ToolRuntime } from "./Tool";

interface ReadFileArgs {
  path: string;
  startLine?: number | undefined;
  endLine?: number | undefined;
  limit?: number | undefined;
}

export class ReadFileTool extends StructuredTool<ReadFileArgs> {
  public readonly name: string = "read_file";
  public readonly description: string =
    "Reads a file from the workspace so you can inspect existing code before editing.";
  public readonly parameters: JSONObject = {
    type: "object",
    required: ["path"],
    properties: {
      path: {
        type: "string",
        description: "File path relative to the workspace root.",
      },
      startLine: {
        type: "integer",
        minimum: 1,
        description: "Optional starting line (1-indexed).",
      },
      endLine: {
        type: "integer",
        minimum: 1,
        description: "Optional ending line (inclusive).",
      },
      limit: {
        type: "integer",
        minimum: 100,
        maximum: 20000,
        description: "Maximum number of characters to return (default 6000).",
      },
    },
  };

  protected schema = z
    .object({
      path: z.string().min(1),
      startLine: z.number().int().min(1).optional(),
      endLine: z.number().int().min(1).optional(),
      limit: z.number().int().min(100).max(20000).optional().default(6000),
    })
    .strict()
    .refine((data) => {
      if (data.startLine && data.endLine) {
        return data.endLine >= data.startLine;
      }
      return true;
    }, "endLine must be greater than startLine");

  public async execute(
    args: ReadFileArgs,
    runtime: ToolRuntime,
  ): Promise<ToolResponse> {
    const absolutePath: string = runtime.workspacePaths.resolve(args.path);

    if (!(await LocalFile.doesFileExist(absolutePath))) {
      return {
        content: `File ${args.path} does not exist in the workspace`,
        isError: true,
      };
    }

    const rawContent: string = await LocalFile.read(absolutePath);
    const lines: Array<string> = rawContent.split(/\r?\n/);
    const start: number = (args.startLine ?? 1) - 1;
    const end: number = args.endLine ? args.endLine : lines.length;
    const slice: Array<string> = lines.slice(start, end);
    let text: string = slice.join("\n");

    let truncated: boolean = false;
    const limit: number = args.limit ?? 6000;
    if (text.length > limit) {
      text = text.substring(0, limit);
      truncated = true;
    }

    const relative: string = runtime.workspacePaths.relative(absolutePath);
    const header: string = `Contents of ${relative} (lines ${start + 1}-${Math.min(end, lines.length)})`;

    return {
      content: truncated ? `${header}\n${text}\n... [truncated]` : `${header}\n${text}`,
    };
  }
}
