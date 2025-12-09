import { z } from "zod";
import Execute from "Common/Server/Utils/Execute";
import { JSONObject } from "Common/Types/JSON";
import { StructuredTool, ToolResponse, ToolRuntime } from "./Tool";
import AgentLogger from "../Utils/AgentLogger";

/** Parameters describing how to search the workspace. */
interface SearchArgs {
  query: string;
  path?: string | undefined;
  useRegex?: boolean | undefined;
  maxResults?: number | undefined;
}

/** Wraps ripgrep/grep so the agent can quickly locate text across files. */
export class SearchWorkspaceTool extends StructuredTool<SearchArgs> {
  public readonly name: string = "search_workspace";
  public readonly description: string =
    "Searches the workspace for a literal string or regular expression to quickly find relevant files.";
  public readonly parameters: JSONObject = {
    type: "object",
    required: ["query"],
    properties: {
      query: {
        type: "string",
        description: "String or regex to search for.",
      },
      path: {
        type: "string",
        description:
          "Optional folder to scope the search to. Defaults to the workspace root.",
      },
      useRegex: {
        type: "boolean",
        description: "Set true to treat query as a regular expression.",
      },
      maxResults: {
        type: "integer",
        minimum: 1,
        maximum: 200,
        description: "Maximum number of matches to return (default 40).",
      },
    },
  };

  protected schema = z
    .object({
      query: z.string().min(2),
      path: z.string().trim().optional(),
      useRegex: z.boolean().optional().default(false),
      maxResults: z.number().int().min(1).max(200).optional().default(40),
    })
    .strict();

  /** Runs the configured search and decorates the raw CLI output. */
  public async execute(
    args: SearchArgs,
    runtime: ToolRuntime,
  ): Promise<ToolResponse> {
    const cwd: string = args.path
      ? runtime.workspacePaths.resolve(args.path)
      : runtime.workspaceRoot;

    const relativeScope: string = runtime.workspacePaths.relative(cwd);
    AgentLogger.debug("SearchWorkspaceTool executing", {
      query: args.query,
      path: args.path,
      useRegex: args.useRegex,
      maxResults: args.maxResults,
    });

    try {
      const rgOutput: string = await this.runRipgrep(args, cwd);
      AgentLogger.debug("SearchWorkspaceTool ripgrep success", {
        scope: relativeScope,
      });
      return {
        content: this.decorateSearchResult({
          engine: "ripgrep",
          scope: relativeScope,
          body: rgOutput,
        }),
      };
    } catch (rgError) {
      AgentLogger.debug(
        "SearchWorkspaceTool ripgrep failed, falling back to grep",
        {
          error: (rgError as Error).message,
        },
      );
      const fallbackOutput: string = await this.runGrep(args, cwd);
      AgentLogger.debug("SearchWorkspaceTool grep success", {
        scope: relativeScope,
      });
      return {
        content: this.decorateSearchResult({
          engine: "grep",
          scope: relativeScope,
          body: fallbackOutput,
        }),
        isError: false,
      };
    }
  }

  /** Executes ripgrep with safe defaults and returns its stdout. */
  private async runRipgrep(args: SearchArgs, cwd: string): Promise<string> {
    const cliArgs: Array<string> = [
      "--line-number",
      "--color",
      "never",
      "--no-heading",
      "--context",
      "2",
      "--max-filesize",
      "200K",
      "--max-columns",
      "200",
      "--max-count",
      String(args.maxResults ?? 40),
      "--glob",
      "!*node_modules/*",
      "--glob",
      "!*.lock",
      "--glob",
      "!.git/*",
    ];

    if (!args.useRegex) {
      cliArgs.push("--fixed-strings");
    }

    cliArgs.push(args.query);
    cliArgs.push(".");

    return Execute.executeCommandFile({
      command: "rg",
      args: cliArgs,
      cwd,
    });
  }

  /** Fallback search implementation using standard grep. */
  private async runGrep(args: SearchArgs, cwd: string): Promise<string> {
    const finalArgs: Array<string> = [
      "-R",
      "-n",
      "-C",
      "2",
      "--exclude-dir=.git",
      "--exclude-dir=node_modules",
      "--exclude=*.lock",
      args.useRegex ? "-E" : "-F",
      args.query,
      ".",
    ];

    try {
      return await Execute.executeCommandFile({
        command: "grep",
        args: finalArgs,
        cwd,
      });
    } catch (error) {
      // grep exits with code 1 when no matches are found - treat this as empty result
      const errorMessage: string = (error as Error).message || "";
      if (
        errorMessage.includes("exit code 1") ||
        errorMessage.includes("Command failed")
      ) {
        return "No matches found";
      }
      throw error;
    }
  }

  /** Formats CLI output with context about scope and engine. */
  private decorateSearchResult(data: {
    engine: string;
    scope: string;
    body: string;
  }): string {
    const scope: string = data.scope || ".";
    const trimmedBody: string = data.body.trim() || "No matches found";
    return `Search (${data.engine}) under ${scope}\n${trimmedBody}`;
  }
}
