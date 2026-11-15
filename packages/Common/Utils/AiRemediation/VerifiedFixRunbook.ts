import {
  AiRemediationCommand,
  AiRemediationCommandExecutionStatus,
  AiRemediationCommandPlan,
  isRemovedSshCommand,
} from "../../Types/AutoRemediation/AiRemediationCommandPlan";
import { AiRemediationCommandPolicyVerdict } from "../../Types/AutoRemediation/AiRemediationCommandPolicyVerdict";
import AutoRemediationSuggestionType from "../../Types/AutoRemediation/AutoRemediationSuggestionType";
import AutoRemediationVerificationStatus from "../../Types/AutoRemediation/AutoRemediationVerificationStatus";
import {
  ExternalMcpToolCall,
  ExternalMcpToolCallPlan,
  ExternalMcpToolCallStatus,
} from "../../Types/AutoRemediation/ExternalMcpToolCallPlan";
import ColumnLength from "../../Types/Database/ColumnLength";
import ObjectID from "../../Types/ObjectID";
import { RunbookStep } from "../../Types/Runbook/RunbookStep";
import RunbookStepType from "../../Types/Runbook/RunbookStepType";

/*
 * A FIX THAT WORKED, WRITTEN DOWN AS A RUNBOOK (issue #6801).
 *
 * OneUptime AI could run a runbook but never write one. When it fixes an
 * incident or an alert itself - commands on a Runner, a change through a
 * cluster's or a resource's AI agent, calls to an MCP server - and the fix
 * is verified (the monitors recovered, or the subject was resolved, within
 * the verification window), what it ran is exactly the procedure the team
 * would want written down. Save as Runbook writes it: a runbook of the
 * steps that ran, in the order they ran, each with why OneUptime AI ran it
 * and how to undo it.
 *
 *   - A command on a Runner becomes a Bash step on that Runner, as written,
 *     with the same time limit. One the policy made a person approve waits
 *     for an approval before it runs in the runbook too.
 *   - A change through a cluster's Kubernetes AI agent, through a
 *     resource's AI agent (Docker, a host, a cloud account ...) or through
 *     an MCP server becomes a manual step that holds the exact command or
 *     call: a runbook's own steps cannot reach those agents, and would go
 *     around the command policy if they could (as the OpenStack runbook
 *     templates do, OpenStackRunbookTemplates). The step says to ask
 *     OneUptime AI for the change, or to make it by hand.
 *   - A command or call that did not run, or failed, is left out: the
 *     runbook is what worked.
 *
 * The runbook starts turned off: OneUptime AI never picks it, no rule runs
 * it, and nobody can start it until a person has read its steps and turned
 * it on (RunbookService, RunbookStarter). Pure: the server builds the
 * runbook with it, and the tests pin it.
 */

// Why a fix cannot be saved as a runbook.
export enum VerifiedFixRunbookRefusal {
  // The fix was not verified: only what worked is written down.
  NotVerified = "NotVerified",
  // The fix ran a runbook already.
  RanARunbook = "RanARunbook",
  // Nothing of the fix ran and succeeded.
  NothingRan = "NothingRan",
  // It was saved as a runbook already.
  AlreadySaved = "AlreadySaved",
}

export const VERIFIED_FIX_RUNBOOK_REFUSAL_MESSAGES: Readonly<
  Record<VerifiedFixRunbookRefusal, string>
> = {
  [VerifiedFixRunbookRefusal.NotVerified]:
    "Only a fix that worked can be saved as a runbook, and this one has not been verified. Wait for its verification, or write the runbook yourself under Runbooks.",
  [VerifiedFixRunbookRefusal.RanARunbook]:
    "This fix ran a runbook already, so there is nothing new to save. Open the runbook from the fix to change it.",
  [VerifiedFixRunbookRefusal.NothingRan]:
    "None of this fix's commands ran and succeeded, so there is nothing to save as a runbook.",
  [VerifiedFixRunbookRefusal.AlreadySaved]:
    "This fix is saved as a runbook already. Open that runbook from the fix.",
};

// What the runbook is written from: the fix, and the incident or alert it fixed.
export interface VerifiedFixRunbookInput {
  suggestionType: AutoRemediationSuggestionType | null | undefined;
  verificationStatus: AutoRemediationVerificationStatus | null | undefined;
  commandPlan: AiRemediationCommandPlan | null;
  mcpToolCallPlan: ExternalMcpToolCallPlan | null;
  // The runbook it was saved as, when it was.
  savedAsRunbookId?: string | null | undefined;
  subject: {
    // "incident" or "alert", as a sentence names it.
    kind: "incident" | "alert";
    // "#42" or "INC-42".
    handle: string;
    title: string;
  };
}

export interface VerifiedFixRunbookDraft {
  name: string;
  description: string;
  steps: Array<RunbookStep>;
}

// The longest step title the runbook editor shows on one line.
export const MAX_VERIFIED_FIX_STEP_TITLE_LENGTH: number = 120;

function cut(text: string, maxLength: number): string {
  const line: string = text.replace(/\s+/g, " ").trim();

  return line.length > maxLength
    ? `${line.slice(0, maxLength - 1).trimEnd()}…`
    : line;
}

// The commands of the fix that ran and succeeded, in the order they ran.
export function getSucceededCommands(
  plan: AiRemediationCommandPlan | null,
): Array<AiRemediationCommand> {
  return (plan?.commands || [])
    .filter((command: AiRemediationCommand): boolean => {
      return (
        !isRemovedSshCommand(command) &&
        command.execution?.status ===
          AiRemediationCommandExecutionStatus.Succeeded
      );
    })
    .sort((a: AiRemediationCommand, b: AiRemediationCommand): number => {
      return a.sequence - b.sequence;
    });
}

// The MCP calls of the fix that were made and succeeded, in the order they were made.
export function getSucceededMcpCalls(
  plan: ExternalMcpToolCallPlan | null,
): Array<ExternalMcpToolCall> {
  return (plan?.calls || [])
    .filter((call: ExternalMcpToolCall): boolean => {
      return call.status === ExternalMcpToolCallStatus.Succeeded;
    })
    .sort((a: ExternalMcpToolCall, b: ExternalMcpToolCall): number => {
      return a.sequence - b.sequence;
    });
}

// Why a fix cannot be saved as a runbook, or null when it can.
export function getVerifiedFixRunbookRefusal(
  input: VerifiedFixRunbookInput,
): VerifiedFixRunbookRefusal | null {
  if (input.suggestionType === AutoRemediationSuggestionType.Runbook) {
    return VerifiedFixRunbookRefusal.RanARunbook;
  }

  if (input.savedAsRunbookId) {
    return VerifiedFixRunbookRefusal.AlreadySaved;
  }

  if (input.verificationStatus !== AutoRemediationVerificationStatus.Verified) {
    return VerifiedFixRunbookRefusal.NotVerified;
  }

  const ranSomething: boolean =
    input.suggestionType === AutoRemediationSuggestionType.McpToolCalls
      ? getSucceededMcpCalls(input.mcpToolCallPlan).length > 0
      : getSucceededCommands(input.commandPlan).length > 0;

  return ranSomething ? null : VerifiedFixRunbookRefusal.NothingRan;
}

// "incident #42", or "the incident" when it has no handle.
function nameSubject(subject: VerifiedFixRunbookInput["subject"]): string {
  return subject.handle.trim()
    ? `${subject.kind} ${subject.handle.trim()}`
    : `the ${subject.kind}`;
}

// What a step says under its title: why it ran, what it did, how to undo it.
function describeCommand(
  command: AiRemediationCommand,
  lead: string | null,
): string {
  return [
    lead,
    command.rationale.trim() ? `Why: ${command.rationale.trim()}` : null,
    command.expectedEffect.trim()
      ? `What it does: ${command.expectedEffect.trim()}`
      : null,
    command.rollbackCommand?.trim()
      ? `To undo it: ${command.rollbackCommand.trim()}`
      : null,
  ]
    .filter((line: string | null): line is string => {
      return Boolean(line);
    })
    .join("\n\n");
}

// Where a change through an AI agent ran: "the prod cluster", "web-01".
function getAgentTarget(command: AiRemediationCommand): string {
  if (command.stepType === RunbookStepType.Kubectl) {
    const cluster: string = (
      command.kubernetesClusterNameSnapshot || ""
    ).trim();

    return cluster ? `the ${cluster} cluster` : "the cluster";
  }

  const resource: string = (command.resourceNameSnapshot || "").trim();
  const agent: string = (command.runnerNameSnapshot || "").trim();

  if (resource && agent) {
    return `${resource} (${agent})`;
  }

  return resource || agent || "the resource";
}

export function toRunbookSteps(input: {
  commands: Array<AiRemediationCommand>;
  mcpCalls: Array<ExternalMcpToolCall>;
}): Array<RunbookStep> {
  const steps: Array<RunbookStep> = [];

  const add: (step: Omit<RunbookStep, "id" | "order">) => void = (
    step: Omit<RunbookStep, "id" | "order">,
  ): void => {
    steps.push({
      id: ObjectID.generate().toString(),
      order: steps.length + 1,
      ...step,
    } as RunbookStep);
  };

  for (const command of input.commands) {
    if (command.stepType === RunbookStepType.Bash) {
      add({
        type: RunbookStepType.Bash,
        title: cut(command.command, MAX_VERIFIED_FIX_STEP_TITLE_LENGTH),
        description: describeCommand(command, null),
        requireApprovalBeforeRunning:
          command.policyVerdict ===
          AiRemediationCommandPolicyVerdict.RequiresApproval,
        config: {
          script: command.command,
          agentId: command.runnerId,
          timeoutInMs: command.timeoutInMs,
        },
      });
      continue;
    }

    const target: string = getAgentTarget(command);

    add({
      type: RunbookStepType.Manual,
      title: cut(
        `On ${target}: ${command.command}`,
        MAX_VERIFIED_FIX_STEP_TITLE_LENGTH,
      ),
      description: describeCommand(
        command,
        `Run this on ${target}: ${command.command}\n\nOneUptime AI made this change through the AI agent there. Ask OneUptime AI to make it again, or make it yourself, then mark this step done.`,
      ),
      config: {},
    });
  }

  for (const call of input.mcpCalls) {
    const server: string = call.serverNameSnapshot.trim() || "the MCP server";

    add({
      type: RunbookStepType.Manual,
      title: cut(
        `${call.toolName} on ${server}`,
        MAX_VERIFIED_FIX_STEP_TITLE_LENGTH,
      ),
      description: `Call the tool ${call.toolName} on ${server} with these arguments:\n\n${JSON.stringify(call.arguments, null, 2)}\n\nOneUptime AI made this change through the MCP server. Ask OneUptime AI to make it again, or make it yourself, then mark this step done.`,
      config: {},
    });
  }

  return steps;
}

/*
 * The runbook a verified fix is written down as: named for what it fixed,
 * said where it comes from, its steps what ran. Its name may be taken in
 * the project already - the server makes it unique (getUniqueRunbookName).
 */
export function buildVerifiedFixRunbook(
  input: VerifiedFixRunbookInput,
): VerifiedFixRunbookDraft {
  const steps: Array<RunbookStep> = toRunbookSteps({
    commands:
      input.suggestionType === AutoRemediationSuggestionType.McpToolCalls
        ? []
        : getSucceededCommands(input.commandPlan),
    mcpCalls:
      input.suggestionType === AutoRemediationSuggestionType.McpToolCalls
        ? getSucceededMcpCalls(input.mcpToolCallPlan)
        : [],
  });

  const subjectTitle: string = input.subject.title.trim();
  const name: string = cut(
    subjectTitle ? `Fix: ${subjectTitle}` : "Verified fix",
    ColumnLength.ShortText,
  );

  const description: string = cut(
    `Written from the fix OneUptime AI ran for ${nameSubject(input.subject)}${
      subjectTitle ? ` (${subjectTitle})` : ""
    }, which was verified when it recovered. Turned off until someone reviews each step and turns it on.`,
    ColumnLength.LongText,
  );

  return { name, description, steps };
}

/*
 * A name no runbook of the project has yet: the name itself, or with " (2)",
 * " (3)" ... after it, cut so the whole stays within a runbook's name.
 */
export function getUniqueRunbookName(
  name: string,
  takenNames: Array<string>,
): string {
  const taken: Set<string> = new Set(
    takenNames.map((taken: string): string => {
      return taken.trim().toLowerCase();
    }),
  );

  if (!taken.has(name.trim().toLowerCase())) {
    return name;
  }

  for (let number: number = 2; number < 1000; number++) {
    const suffix: string = ` (${number.toString()})`;
    const candidate: string = `${cut(name, ColumnLength.ShortText - suffix.length)}${suffix}`;

    if (!taken.has(candidate.toLowerCase())) {
      return candidate;
    }
  }

  return `${cut(name, ColumnLength.ShortText - 37)} ${ObjectID.generate().toString()}`;
}
