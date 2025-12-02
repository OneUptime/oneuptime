import { OpenAIToolCall, ToolDefinition, ToolExecutionResult } from "../Types";
import { WorkspacePaths } from "../Utils/WorkspacePaths";
import { ApplyPatchTool } from "./ApplyPatchTool";
import { ListDirectoryTool } from "./ListDirectoryTool";
import { ReadFileTool } from "./ReadFileTool";
import { RunCommandTool } from "./RunCommandTool";
import { SearchWorkspaceTool } from "./SearchWorkspaceTool";
import { AgentTool, ToolResponse, ToolRuntime } from "./Tool";
import { WriteFileTool } from "./WriteFileTool";
import AgentLogger from "../Utils/AgentLogger";

export class ToolRegistry {
  private readonly tools: Map<string, AgentTool<unknown>>;
  private readonly runtime: ToolRuntime;

  public constructor(workspaceRoot: string) {
    const workspacePaths: WorkspacePaths = new WorkspacePaths(workspaceRoot);
    this.runtime = {
      workspacePaths,
      workspaceRoot: workspacePaths.getRoot(),
    };
    AgentLogger.debug("Tool registry initialized", {
      workspaceRoot: workspacePaths.getRoot(),
    });

    const toolInstances: Array<AgentTool<unknown>> = [
      new ListDirectoryTool(),
      new ReadFileTool(),
      new SearchWorkspaceTool(),
      new ApplyPatchTool(),
      new WriteFileTool(),
      new RunCommandTool(),
    ];

    this.tools = new Map(
      toolInstances.map((tool: AgentTool<unknown>) => {
        return [tool.name, tool];
      }),
    );
  }

  public getToolDefinitions(): Array<ToolDefinition> {
    const definitions: Array<ToolDefinition> = Array.from(
      this.tools.values(),
    ).map((tool: AgentTool<unknown>) => {
      return tool.getDefinition();
    });
    AgentLogger.debug("Tool definitions requested", {
      count: definitions.length,
      toolNames: definitions.map((definition: ToolDefinition) => {
        return definition.function.name;
      }),
    });
    return definitions;
  }

  public async execute(call: OpenAIToolCall): Promise<ToolExecutionResult> {
    const tool: AgentTool<unknown> | undefined = this.tools.get(
      call.function.name,
    );

    if (!tool) {
      const message: string = `Tool ${call.function.name} is not available.`;
      AgentLogger.error(message);
      return {
        toolCallId: call.id,
        output: message,
      };
    }

    let parsedArgs: unknown;
    try {
      parsedArgs = call.function.arguments
        ? JSON.parse(call.function.arguments)
        : {};
      AgentLogger.debug("Tool arguments parsed", {
        toolName: call.function.name,
        argumentKeys:
          typeof parsedArgs === "object" && parsedArgs !== null
            ? Object.keys(parsedArgs as Record<string, unknown>)
            : [],
      });
    } catch (error) {
      const message: string = `Unable to parse tool arguments for ${call.function.name}: ${(error as Error).message}`;
      AgentLogger.error(message);
      return {
        toolCallId: call.id,
        output: message,
      };
    }

    try {
      AgentLogger.debug("Executing tool via registry", {
        toolName: call.function.name,
      });
      const typedArgs: unknown = tool.parse(parsedArgs);
      AgentLogger.debug("Tool arguments validated", {
        toolName: call.function.name,
      });
      const response: ToolResponse = await tool.execute(
        typedArgs,
        this.runtime,
      );
      const prefix: string = response.isError ? "ERROR: " : "";
      AgentLogger.debug("Tool execution result", {
        toolName: call.function.name,
        isError: response.isError ?? false,
      });
      return {
        toolCallId: call.id,
        output: `${prefix}${response.content}`,
      };
    } catch (error) {
      const message: string = `Tool ${call.function.name} failed: ${(error as Error).message}`;
      AgentLogger.error(message, error as Error);
      return {
        toolCallId: call.id,
        output: message,
      };
    }
  }
}
