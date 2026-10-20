import { JSONObject } from "../JSON";

/*
 * A FIX OneUptime AI MADE, OR PROPOSES, THROUGH THE PROJECT'S EXTERNAL MCP
 * SERVERS: the plan stored on an AutoRemediationSuggestion of type
 * McpToolCalls (its mcpToolCallPlan column).
 *
 * Each entry is one call of one tool that may change something - the
 * server it goes to, the tool, its arguments and, once it was made, what
 * the server answered. Tools that only read are never in it: they are part
 * of working out the fix, in the run's activity, not part of the fix.
 *
 * What runs is decided by the rule's Approval, never by the model
 * (Server/Utils/AI/Remediation/McpRemediationRunner):
 *
 *   - Ask before fixing - and always when the rule names no MCP server, as
 *     a runbook picked from all of the project's is always proposed: every
 *     call is Proposed, and a person's one click makes exactly the calls
 *     recorded here, in order;
 *   - Fix without asking, for a rule that names its MCP servers: OneUptime
 *     AI makes the calls itself, each recorded (Running) before it is sent,
 *     so a run that dies leaves a truthful record of what may have changed.
 *
 * Data the AI run wrote: the server is named by its id and the name it had
 * then, never a credential. Parsed defensively - a stored plan that is not
 * one reads as none.
 */

export enum ExternalMcpToolCallStatus {
  // Recorded for approval: nothing was sent.
  Proposed = "Proposed",
  // Sent, and not answered yet (or the run died waiting).
  Running = "Running",
  Succeeded = "Succeeded",
  // Sent, and the server said it failed (or no answer came).
  Failed = "Failed",
  // Never sent: an earlier call of the plan failed, or the fix was settled first.
  Skipped = "Skipped",
}

export interface ExternalMcpToolCall {
  // 1-based; calls are made in this order.
  sequence: number;
  serverId: string;
  serverNameSnapshot: string;
  toolName: string;
  arguments: JSONObject;
  status: ExternalMcpToolCallStatus;
  // Made by OneUptime AI itself, for a rule that fixes without asking.
  wasMadeWithoutAsking?: boolean | undefined;
  // What the server answered, held to MAX_STORED_MCP_RESULT_CHARS.
  resultText?: string | undefined;
  errorMessage?: string | undefined;
  startedAt?: string | undefined; // ISO 8601
  completedAt?: string | undefined; // ISO 8601
}

export interface ExternalMcpToolCallPlan {
  calls: Array<ExternalMcpToolCall>;
}

// How much of each answer is kept on the suggestion.
export const MAX_STORED_MCP_RESULT_CHARS: number = 6000;

// The most calls one fix proposes or makes.
export const MAX_MCP_TOOL_CALLS_PER_FIX: number = 5;

const STATUSES: Array<string> = Object.values(ExternalMcpToolCallStatus);

function readString(value: unknown, maxChars: number): string | undefined {
  if (typeof value !== "string" || !value) {
    return undefined;
  }

  return value.length > maxChars ? `${value.slice(0, maxChars - 1)}…` : value;
}

export class ExternalMcpToolCallPlanUtil {
  public static empty(): ExternalMcpToolCallPlan {
    return { calls: [] };
  }

  // A stored plan, or null when the value is not one.
  public static parse(value: unknown): ExternalMcpToolCallPlan | null {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }

    const rawCalls: unknown = (value as JSONObject)["calls"];

    if (!Array.isArray(rawCalls)) {
      return null;
    }

    const calls: Array<ExternalMcpToolCall> = [];

    for (const raw of rawCalls) {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        continue;
      }

      const entry: JSONObject = raw as JSONObject;
      const serverId: string | undefined = readString(entry["serverId"], 64);
      const toolName: string | undefined = readString(entry["toolName"], 128);
      const status: unknown = entry["status"];
      const args: unknown = entry["arguments"];

      if (
        !serverId ||
        !toolName ||
        typeof status !== "string" ||
        !STATUSES.includes(status)
      ) {
        continue;
      }

      calls.push({
        sequence:
          typeof entry["sequence"] === "number"
            ? entry["sequence"]
            : calls.length + 1,
        serverId,
        serverNameSnapshot:
          readString(entry["serverNameSnapshot"], 200) || "MCP server",
        toolName,
        arguments:
          args && typeof args === "object" && !Array.isArray(args)
            ? (args as JSONObject)
            : {},
        status: status as ExternalMcpToolCallStatus,
        wasMadeWithoutAsking: entry["wasMadeWithoutAsking"] === true,
        resultText: readString(
          entry["resultText"],
          MAX_STORED_MCP_RESULT_CHARS,
        ),
        errorMessage: readString(entry["errorMessage"], 2000),
        startedAt: readString(entry["startedAt"], 40),
        completedAt: readString(entry["completedAt"], 40),
      });
    }

    return { calls };
  }

  // A plan as stored: undefined fields left out.
  public static toJSON(plan: ExternalMcpToolCallPlan): JSONObject {
    return {
      calls: plan.calls.map((call: ExternalMcpToolCall): JSONObject => {
        const json: JSONObject = {};

        for (const [key, value] of Object.entries(call)) {
          if (value !== undefined) {
            json[key] = value as JSONObject[keyof JSONObject];
          }
        }

        return json;
      }),
    };
  }

  // The calls a person's approval makes.
  public static getProposedCalls(
    plan: ExternalMcpToolCallPlan,
  ): Array<ExternalMcpToolCall> {
    return plan.calls.filter((call: ExternalMcpToolCall): boolean => {
      return call.status === ExternalMcpToolCallStatus.Proposed;
    });
  }

  // The calls that were sent: they may have changed something.
  public static getSentCalls(
    plan: ExternalMcpToolCallPlan,
  ): Array<ExternalMcpToolCall> {
    return plan.calls.filter((call: ExternalMcpToolCall): boolean => {
      return (
        call.status === ExternalMcpToolCallStatus.Running ||
        call.status === ExternalMcpToolCallStatus.Succeeded ||
        call.status === ExternalMcpToolCallStatus.Failed
      );
    });
  }

  // Whether every call that was sent has an answer, and none failed.
  public static hasSucceeded(plan: ExternalMcpToolCallPlan): boolean {
    const sent: Array<ExternalMcpToolCall> =
      ExternalMcpToolCallPlanUtil.getSentCalls(plan);

    return (
      sent.length > 0 &&
      sent.every((call: ExternalMcpToolCall): boolean => {
        return call.status === ExternalMcpToolCallStatus.Succeeded;
      })
    );
  }

  public static hasFailed(plan: ExternalMcpToolCallPlan): boolean {
    return plan.calls.some((call: ExternalMcpToolCall): boolean => {
      return call.status === ExternalMcpToolCallStatus.Failed;
    });
  }

  // A call sent with no answer yet: the fix is still being made.
  public static isInFlight(plan: ExternalMcpToolCallPlan): boolean {
    return plan.calls.some((call: ExternalMcpToolCall): boolean => {
      return call.status === ExternalMcpToolCallStatus.Running;
    });
  }

  // The servers the plan reaches, by the names they had, each once.
  public static getServerNames(plan: ExternalMcpToolCallPlan): Array<string> {
    const names: Array<string> = [];

    for (const call of plan.calls) {
      if (!names.includes(call.serverNameSnapshot)) {
        names.push(call.serverNameSnapshot);
      }
    }

    return names;
  }

  /*
   * How the incident's feed - and the Slack or Teams post made from it -
   * counts a fix's changes: "1 change", "3 changes".
   */
  public static describeChangeCount(count: number): string {
    return count === 1 ? "1 change" : `${count} changes`;
  }

  /*
   * The servers a plan reaches, as the feed names them: MCP server "AWS",
   * MCP servers "AWS" and "GitHub", MCP servers "AWS", "GitHub" and "Azure".
   */
  public static describeServers(plan: ExternalMcpToolCallPlan): string {
    const names: Array<string> = ExternalMcpToolCallPlanUtil.getServerNames(
      plan,
    ).map((name: string): string => {
      return `"${name}"`;
    });

    if (names.length === 0) {
      return "MCP servers";
    }

    if (names.length === 1) {
      return `MCP server ${names[0]}`;
    }

    return `MCP servers ${names.slice(0, -1).join(", ")} and ${
      names[names.length - 1]
    }`;
  }
}
