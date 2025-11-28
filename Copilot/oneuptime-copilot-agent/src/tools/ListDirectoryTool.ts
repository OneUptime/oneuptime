import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import LocalFile from "Common/Server/Utils/LocalFile";
import { JSONObject } from "Common/Types/JSON";
import { StructuredTool, ToolResponse, ToolRuntime } from "./Tool";

interface ListDirectoryArgs {
  path?: string;
  depth?: number;
  includeFiles?: boolean;
  limit?: number;
}

export class ListDirectoryTool extends StructuredTool<ListDirectoryArgs> {
  public readonly name: string = "list_directory";
  public readonly description: string =
    "Lists files and folders inside the workspace to help you locate relevant code.";
  public readonly parameters: JSONObject = {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Directory to inspect. Defaults to the workspace root.",
      },
      depth: {
        type: "integer",
        minimum: 1,
        maximum: 5,
        description: "How deep to recurse into subdirectories (default 2).",
      },
      includeFiles: {
        type: "boolean",
        description: "Include file entries as well as directories.",
      },
      limit: {
        type: "integer",
        minimum: 1,
        maximum: 400,
        description: "Maximum number of entries to return (default 80).",
      },
    },
  };

  protected schema = z
    .object({
      path: z.string().trim().optional(),
      depth: z.number().int().min(1).max(5).optional().default(2),
      includeFiles: z.boolean().optional().default(true),
      limit: z.number().int().min(1).max(400).optional().default(80),
    })
    .strict();

  public async execute(
    args: ListDirectoryArgs,
    runtime: ToolRuntime,
  ): Promise<ToolResponse> {
    const targetPath: string = runtime.workspacePaths.resolve(
      args.path ?? ".",
    );

    if (!(await LocalFile.doesDirectoryExist(targetPath))) {
      return {
        content: `Directory ${args.path ?? "."} does not exist in the workspace`,
        isError: true,
      };
    }

    const rows: Array<string> = [];
    await this.walkDirectory({
      current: targetPath,
      currentDepth: 0,
      maxDepth: args.depth ?? 2,
      includeFiles: args.includeFiles ?? true,
      limit: args.limit ?? 80,
      output: rows,
      runtime,
    });

    const relativeRoot: string = runtime.workspacePaths.relative(targetPath);
    const header: string = `Listing ${rows.length} item(s) under ${relativeRoot || "."}`;

    return {
      content: [header, ...rows].join("\n"),
    };
  }

  private async walkDirectory(data: {
    current: string;
    currentDepth: number;
    maxDepth: number;
    includeFiles: boolean;
    limit: number;
    output: Array<string>;
    runtime: ToolRuntime;
  }): Promise<void> {
    if (data.output.length >= data.limit) {
      return;
    }

    const entries = await fs.readdir(data.current, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      if (data.output.length >= data.limit) {
        break;
      }

      if (this.shouldSkip(entry.name)) {
        continue;
      }

      const absoluteEntry: string = path.join(data.current, entry.name);
      const prefix: string = "  ".repeat(data.currentDepth);

      if (entry.isDirectory()) {
        data.output.push(`${prefix}${entry.name}/`);
        if (data.currentDepth + 1 < data.maxDepth) {
          await this.walkDirectory({
            ...data,
            current: absoluteEntry,
            currentDepth: data.currentDepth + 1,
          });
        }
      } else if (data.includeFiles) {
        data.output.push(`${prefix}${entry.name}`);
      }
    }
  }

  private shouldSkip(entryName: string): boolean {
    const blocked = [
      ".git",
      "node_modules",
      ".turbo",
      "dist",
      "build",
      ".next",
    ];

    return blocked.includes(entryName);
  }
}
