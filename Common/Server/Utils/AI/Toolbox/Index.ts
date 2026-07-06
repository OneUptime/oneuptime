import { JSONObject } from "../../../../Types/JSON";
import Permission, {
  PermissionHelper,
  UserPermission,
} from "../../../../Types/Permission";
import DatabaseCommonInteractionPropsUtil, {
  PermissionType,
} from "../../../../Types/BaseDatabase/DatabaseCommonInteractionPropsUtil";
import { LLMToolDefinition } from "../../LLM/LLMService";
import logger from "../../Logger";
import {
  ObservabilityTool,
  ToolContext,
  ToolExecutionResult,
} from "./ToolTypes";
import { QueryIncidentsTool } from "./IncidentTools";
import { QueryAlertsTool } from "./AlertTools";
import { QueryMonitorsTool } from "./MonitorTools";
import { TopExceptionsTool } from "./ExceptionTools";
import { LogHistogramTool, SearchLogsTool } from "./LogTools";
import { QueryMetricsTool } from "./MetricTools";
import { GetTraceTool, QueryTracesTool } from "./TraceTools";
import { LookupContextTool } from "./ContextTools";

export interface ToolCallOutcome {
  success: boolean;
  /*
   * What goes back to the LLM: serialized data, or an error envelope the
   * model can self-correct from.
   */
  textForLlm: string;
  result?: ToolExecutionResult | undefined;
  errorMessage?: string | undefined;
}

const TOOL_EXECUTION_TIMEOUT_MS: number = 45 * 1000;

/*
 * The curated, read-only tool belt for AI features (chat today, the
 * Investigation Engine later). Every tool wraps an existing deterministic
 * query and executes under the requesting user's permission props.
 */
export default class AIToolbox {
  private static readonly tools: Array<ObservabilityTool> = [
    LookupContextTool,
    QueryIncidentsTool,
    QueryAlertsTool,
    QueryMonitorsTool,
    TopExceptionsTool,
    SearchLogsTool,
    LogHistogramTool,
    QueryMetricsTool,
    QueryTracesTool,
    GetTraceTool,
  ];

  public static getTools(): Array<ObservabilityTool> {
    return this.tools;
  }

  private static llmToolDefinitions: Array<LLMToolDefinition> | null = null;

  public static getToolByName(name: string): ObservabilityTool | undefined {
    return this.tools.find((tool: ObservabilityTool) => {
      return tool.name === name;
    });
  }

  public static getLlmToolDefinitions(): Array<LLMToolDefinition> {
    if (!this.llmToolDefinitions) {
      this.llmToolDefinitions = this.tools.map((tool: ObservabilityTool) => {
        return {
          name: tool.name,
          description: tool.description,
          inputSchema: tool.inputSchema,
        };
      });
    }
    return this.llmToolDefinitions;
  }

  public static hasPermissionForTool(
    tool: ObservabilityTool,
    ctx: ToolContext,
  ): boolean {
    if (ctx.props.isRoot || ctx.props.isMasterAdmin) {
      return true;
    }

    /*
     * Fail closed on block permissions: if any of the tool's permissions is
     * block-listed for this user, deny the tool outright. This is coarser
     * than the label-scoped block filtering the model layer applies, but the
     * raw-SQL aggregation tools have no model layer — this gate is their
     * only authorization.
     */
    const blockedPermissions: Array<Permission> =
      DatabaseCommonInteractionPropsUtil.getUserPermissions(
        ctx.props,
        PermissionType.Block,
      ).map((userPermission: UserPermission) => {
        return userPermission.permission;
      });

    if (
      PermissionHelper.doesPermissionsIntersect(
        blockedPermissions,
        tool.requiredPermissions,
      )
    ) {
      return false;
    }

    const userPermissions: Array<Permission> =
      DatabaseCommonInteractionPropsUtil.getUserPermissions(
        ctx.props,
        PermissionType.Allow,
      ).map((userPermission: UserPermission) => {
        return userPermission.permission;
      });

    return PermissionHelper.doesPermissionsIntersect(
      userPermissions,
      tool.requiredPermissions,
    );
  }

  public static async executeTool(data: {
    name: string;
    args: JSONObject;
    ctx: ToolContext;
  }): Promise<ToolCallOutcome> {
    const tool: ObservabilityTool | undefined = this.getToolByName(data.name);

    if (!tool) {
      return {
        success: false,
        textForLlm: `Error: unknown tool "${data.name}". Available tools: ${this.tools
          .map((availableTool: ObservabilityTool) => {
            return availableTool.name;
          })
          .join(", ")}.`,
        errorMessage: `Unknown tool: ${data.name}`,
      };
    }

    if (!this.hasPermissionForTool(tool, data.ctx)) {
      return {
        success: false,
        textForLlm: `Error: the current user does not have permission to use ${data.name}. Answer with the data you already have, and tell the user which permission is missing.`,
        errorMessage: `Permission denied for tool: ${data.name}`,
      };
    }

    try {
      const result: ToolExecutionResult = await Promise.race([
        tool.execute(data.args, data.ctx),
        new Promise<never>(
          (_resolve: unknown, reject: (err: Error) => void) => {
            setTimeout(() => {
              reject(new Error("Tool execution timed out."));
            }, TOOL_EXECUTION_TIMEOUT_MS);
          },
        ),
      ]);

      return {
        success: true,
        textForLlm: result.dataForLlm,
        result: result,
      };
    } catch (error) {
      const message: string =
        error instanceof Error ? error.message : String(error);

      logger.error(`AI toolbox tool ${data.name} failed: ${message}`);

      return {
        success: false,
        textForLlm: `Error executing ${data.name}: ${message}. Adjust the arguments and try again, or answer with the data you already have.`,
        errorMessage: message,
      };
    }
  }
}
