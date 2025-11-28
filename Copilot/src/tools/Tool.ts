import { z } from "zod";
import { JSONObject } from "Common/Types/JSON";
import { ToolDefinition } from "../types";
import { WorkspacePaths } from "../utils/WorkspacePaths";

export interface ToolRuntime {
  workspacePaths: WorkspacePaths;
  workspaceRoot: string;
}

export interface ToolResponse {
  content: string;
  isError?: boolean;
}

export interface AgentTool<TArgs> {
  readonly name: string;
  readonly description: string;
  readonly parameters: JSONObject;
  getDefinition(): ToolDefinition;
  parse(input: unknown): TArgs;
  execute(args: TArgs, runtime: ToolRuntime): Promise<ToolResponse>;
}

export abstract class StructuredTool<TArgs> implements AgentTool<TArgs> {
  public abstract readonly name: string;
  public abstract readonly description: string;
  public abstract readonly parameters: JSONObject;
  protected abstract schema: z.ZodType<TArgs>;

  public getDefinition(): ToolDefinition {
    return {
      type: "function",
      function: {
        name: this.name,
        description: this.description,
        parameters: this.parameters,
      },
    };
  }

  public parse(input: unknown): TArgs {
    return this.schema.parse(input ?? {});
  }

  public abstract execute(
    args: TArgs,
    runtime: ToolRuntime,
  ): Promise<ToolResponse>;
}
