import { z } from "zod";
import { JSONObject } from "Common/Types/JSON";
import { ToolDefinition } from "../Types";
import { WorkspacePaths } from "../Utils/WorkspacePaths";
import AgentLogger from "../Utils/AgentLogger";

/**
 * Shared context passed to every tool execution so it can resolve workspace
 * paths safely and consistently.
 */
export interface ToolRuntime {
  workspacePaths: WorkspacePaths;
  workspaceRoot: string;
}

/**
 * Canonical wrapper returned by tools with their textual output and optional
 * error flag so the agent can prefix failures.
 */
export interface ToolResponse {
  content: string;
  isError?: boolean;
}

/**
 * Contract implemented by every tool so it can be surfaced as an OpenAI
 * function and executed with validated arguments.
 */
export interface AgentTool<TArgs> {
  readonly name: string;
  readonly description: string;
  readonly parameters: JSONObject;
  getDefinition(): ToolDefinition;
  parse(input: unknown): TArgs;
  execute(args: TArgs, runtime: ToolRuntime): Promise<ToolResponse>;
}

/**
 * Base class that combines a zod schema with helper logic to expose a tool as
 * an OpenAI function.
 */
export abstract class StructuredTool<TArgs> implements AgentTool<TArgs> {
  public abstract readonly name: string;
  public abstract readonly description: string;
  public abstract readonly parameters: JSONObject;
  protected abstract schema: z.ZodType<TArgs>;

  /** Describes the tool in the OpenAI function-calling format. */
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

  /**
   * Validates raw JSON arguments against the schema before execution to guard
   * against malformed tool calls.
   */
  public parse(input: unknown): TArgs {
    AgentLogger.debug("Parsing tool arguments", {
      tool: this.name,
      inputType: typeof input,
    });
    const parsed: TArgs = this.schema.parse(input ?? {});
    AgentLogger.debug("Parsed tool arguments", {
      tool: this.name,
    });
    return parsed;
  }

  /**
   * Executes the tool's core behavior with validated args and shared runtime.
   */
  public abstract execute(
    args: TArgs,
    runtime: ToolRuntime,
  ): Promise<ToolResponse>;
}
