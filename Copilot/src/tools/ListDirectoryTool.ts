import fs from "node:fs/promises";
import type { Dirent } from "node:fs";
import path from "node:path";
import { z } from "zod";
import LocalFile from "Common/Server/Utils/LocalFile";
import { JSONObject } from "Common/Types/JSON";
import { StructuredTool, ToolResponse, ToolRuntime } from "./Tool";
import AgentLogger from "../utils/AgentLogger";

interface ListDirectoryArgs {
  path?: string | undefined;
  depth?: number | undefined;
  includeFiles?: boolean | undefined;
  limit?: number | undefined;
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
    AgentLogger.debug("ListDirectoryTool executing", {
      path: args.path,
      depth: args.depth,
      includeFiles: args.includeFiles,
      limit: args.limit,
    });
    const targetPath: string = runtime.workspacePaths.resolve(args.path ?? ".");

    if (!(await LocalFile.doesDirectoryExist(targetPath))) {
      AgentLogger.warn("ListDirectoryTool target missing", {
        targetPath,
      });
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

    AgentLogger.debug("ListDirectoryTool completed", {
      relativeRoot,
      rowCount: rows.length,
    });
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

    const entries: Array<Dirent> = await fs.readdir(data.current, {
      withFileTypes: true,
    });
    entries.sort((a: Dirent, b: Dirent) => {
      return a.name.localeCompare(b.name);
    });
    AgentLogger.debug("Listing directory entries", {
      current: data.current,
      depth: data.currentDepth,
      entryCount: entries.length,
    });

    for (let index: number = 0; index < entries.length; index += 1) {
      const entry: Dirent = entries[index];
      if (data.output.length >= data.limit) {
        break;
      }

      if (this.shouldSkip(entry.name)) {
        AgentLogger.debug("Skipping directory entry", {
          entry: entry.name,
        });
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
    const blocked: Array<string> = [
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
