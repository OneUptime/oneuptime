import {
  AiRemediationCommand,
  AiRemediationCommandPlan,
  AiRemediationCommandPlanUtil,
} from "./AiRemediationCommandPlan";
import AutoRemediationSuggestionType from "./AutoRemediationSuggestionType";
import {
  ExternalMcpToolCall,
  ExternalMcpToolCallPlan,
  ExternalMcpToolCallPlanUtil,
} from "./ExternalMcpToolCallPlan";
import { JSONObject } from "../JSON";
import { sha256 } from "../../Utils/DataSecurity/Sha256";

/*
 * WHAT A FIX WAITING FOR APPROVAL RUNS, IN SIXTEEN HEX DIGITS.
 *
 * Every approval names the fix it approves by this fingerprint: a Slack or
 * Microsoft Teams message carries it on its Approve button and the dialog it
 * opens carries it again, and the AI card sends the fingerprint of the fix it
 * shows with its Approve. The approval is refused when the fix no longer runs
 * exactly that (RemediationApproval), and the first of two approvals records
 * it (AutoRemediationSuggestion.firstApprovedPlanFingerprint): a second
 * approval runs the fix only while it is still the fix approved first. A
 * person approves what they read, never what a later version of the fix
 * became.
 *
 * It covers everything that decides what runs - the kind of fix, each
 * command in order with what it runs on and its undo, the runbook, the
 * changes through MCP servers - and nothing that does not: a dry run's
 * answer, a track record, the time. Two reads of the same fix always give
 * the same fingerprint.
 *
 * Shared by the server and the Dashboard, so the card works it out from the
 * fix it shows: a synchronous SHA-256 in plain TypeScript
 * (Utils/DataSecurity/Sha256) over the UTF-8 of one JSON text, the same
 * digest Node's crypto gives.
 */

export const REMEDIATION_PLAN_FINGERPRINT_LENGTH: number = 16;

// Only hex digits, of the fingerprint's length.
const FINGERPRINT_PATTERN: RegExp = /^[0-9a-f]{16}$/;

export function isRemediationPlanFingerprint(value: unknown): value is string {
  return typeof value === "string" && FINGERPRINT_PATTERN.test(value);
}

// What decides what a fix runs: the parts its fingerprint is made of.
export interface RemediationPlanFingerprintInput {
  suggestionType?: AutoRemediationSuggestionType | string | undefined;
  commandPlan?: JSONObject | null | undefined;
  mcpToolCallPlan?: JSONObject | null | undefined;
  runbookId?: { toString: () => string } | string | null | undefined;
}

/*
 * A text's UTF-8 bytes, as Node's Buffer writes them: a lone surrogate (which
 * JSON.stringify never leaves in its text anyway) is written as U+FFFD.
 */
export function toUtf8Bytes(text: string): Uint8Array {
  const bytes: Array<number> = [];

  for (const character of text) {
    let codePoint: number = character.codePointAt(0)!;

    if (codePoint >= 0xd800 && codePoint <= 0xdfff) {
      codePoint = 0xfffd;
    }

    if (codePoint < 0x80) {
      bytes.push(codePoint);
    } else if (codePoint < 0x800) {
      bytes.push(0xc0 | (codePoint >> 6), 0x80 | (codePoint & 0x3f));
    } else if (codePoint < 0x10000) {
      bytes.push(
        0xe0 | (codePoint >> 12),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    } else {
      bytes.push(
        0xf0 | (codePoint >> 18),
        0x80 | ((codePoint >> 12) & 0x3f),
        0x80 | ((codePoint >> 6) & 0x3f),
        0x80 | (codePoint & 0x3f),
      );
    }
  }

  return Uint8Array.from(bytes);
}

// A text's SHA-256, in lowercase hex.
export function sha256Hex(text: string): string {
  return Array.from(sha256(toUtf8Bytes(text)))
    .map((byte: number): string => {
      return byte.toString(16).padStart(2, "0");
    })
    .join("");
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
export function getRemediationPlanFingerprint(
  suggestion: RemediationPlanFingerprintInput,
): string {
  let parts: JSONObject = {
    type: suggestion.suggestionType || AutoRemediationSuggestionType.Runbook,
  };

  if (suggestion.suggestionType === AutoRemediationSuggestionType.CommandPlan) {
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
      calls: (plan
        ? ExternalMcpToolCallPlanUtil.getProposedCalls(plan)
        : []
      ).map(describeMcpCall),
    };
  } else {
    parts = {
      ...parts,
      runbookId: (suggestion.runbookId?.toString() || "").toLowerCase(),
    };
  }

  return sha256Hex(JSON.stringify(parts)).slice(
    0,
    REMEDIATION_PLAN_FINGERPRINT_LENGTH,
  );
}
