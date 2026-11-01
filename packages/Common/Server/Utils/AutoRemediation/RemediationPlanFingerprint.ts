import Crypto from "crypto";
import AutoRemediationSuggestion from "../../../Models/DatabaseModels/AutoRemediationSuggestion";
import {
  AiRemediationCommand,
  AiRemediationCommandPlan,
  AiRemediationCommandPlanUtil,
} from "../../../Types/AutoRemediation/AiRemediationCommandPlan";
import AutoRemediationSuggestionType from "../../../Types/AutoRemediation/AutoRemediationSuggestionType";
import {
  ExternalMcpToolCall,
  ExternalMcpToolCallPlan,
  ExternalMcpToolCallPlanUtil,
} from "../../../Types/AutoRemediation/ExternalMcpToolCallPlan";
import { JSONObject } from "../../../Types/JSON";

/*
 * WHAT A FIX WAITING FOR APPROVAL RUNS, IN SIXTEEN HEX DIGITS.
 *
 * A Slack or Microsoft Teams message about a fix carries its fingerprint
 * on its Approve button, and the approval dialog it opens carries it again:
 * the approval is refused when the fix no longer runs exactly what the
 * message showed (RemediationApproval). A person approves what they read,
 * never what a later version of the fix became.
 *
 * It covers everything that decides what runs - the kind of fix, each
 * command in order with what it runs on and its undo, the runbook, the
 * changes through MCP servers - and nothing that does not: a dry run's
 * answer, a track record, the time. Two reads of the same fix always give
 * the same fingerprint.
 */

export const REMEDIATION_PLAN_FINGERPRINT_LENGTH: number = 16;

// Only hex digits, of the fingerprint's length.
const FINGERPRINT_PATTERN: RegExp = /^[0-9a-f]{16}$/;

export function isRemediationPlanFingerprint(value: unknown): value is string {
  return typeof value === "string" && FINGERPRINT_PATTERN.test(value);
}

function describeCommand(command: AiRemediationCommand): JSONObject {
  return {
    sequence: command.sequence,
    stepType: command.stepType,
    runnerId: command.runnerId.toLowerCase(),
    kubernetesClusterId: (command.kubernetesClusterId || "").toLowerCase(),
    resourceType: command.resourceType || "",
    resourceId: (command.resourceId || "").toLowerCase(),
    command: command.command,
    rollbackCommand: command.rollbackCommand || "",
  };
}

function describeMcpCall(call: ExternalMcpToolCall): JSONObject {
  return {
    sequence: call.sequence,
    serverId: call.serverId.toLowerCase(),
    toolName: call.toolName,
    arguments: call.arguments,
  };
}

/*
 * The fingerprint of a suggestion's fix, as it stands: what its plan runs,
 * read the way approving reads it.
 */
export function getRemediationPlanFingerprint(suggestion: {
  suggestionType?: AutoRemediationSuggestion["suggestionType"];
  commandPlan?: JSONObject | null | undefined;
  mcpToolCallPlan?: JSONObject | null | undefined;
  runbookId?: AutoRemediationSuggestion["runbookId"] | null;
}): string {
  let parts: JSONObject = { type: suggestion.suggestionType || "Runbook" };

  if (
    suggestion.suggestionType === AutoRemediationSuggestionType.CommandPlan
  ) {
    const plan: AiRemediationCommandPlan | null =
      AiRemediationCommandPlanUtil.parse(suggestion.commandPlan);

    parts = {
      ...parts,
      commands: (plan?.commands || []).map(describeCommand),
    };
  } else if (
    suggestion.suggestionType === AutoRemediationSuggestionType.McpToolCalls
  ) {
    const plan: ExternalMcpToolCallPlan | null =
      ExternalMcpToolCallPlanUtil.parse(suggestion.mcpToolCallPlan);

    parts = {
      ...parts,
      calls: (plan ? ExternalMcpToolCallPlanUtil.getProposedCalls(plan) : []).map(
        describeMcpCall,
      ),
    };
  } else {
    parts = {
      ...parts,
      runbookId: (suggestion.runbookId?.toString() || "").toLowerCase(),
    };
  }

  return Crypto.createHash("sha256")
    .update(JSON.stringify(parts))
    .digest("hex")
    .slice(0, REMEDIATION_PLAN_FINGERPRINT_LENGTH);
}
