import {
  getCommandProgramChip,
  getCommandTargetLabel,
  readRemediationMoment,
} from "./RemediationFixSteps";
import RemediationFixFact, {
  RemediationFixFactVisual,
} from "./RemediationFixFact";
import RemediationTrackRecordLine from "./RemediationTrackRecordLine";
import CloudDryRunNote from "./CloudDryRunNote";
import {
  AiRemediationCommand,
  AiRemediationCommandExecutionState,
  AiRemediationCommandExecutionStatus,
  AiRemediationCommandPlan,
  isRemovedSshCommand,
} from "Common/Types/AutoRemediation/AiRemediationCommandPlan";
import AutoRemediationSuggestionStatus from "Common/Types/AutoRemediation/AutoRemediationSuggestionStatus";
import { KubectlCommandTier } from "Common/Types/Kubernetes/KubernetesClusterAiAccess";
import { ResourceCommandTier } from "Common/Types/ResourceAiAgent/ResourceAiAccess";
import { isCloudAiResourceType } from "Common/Types/ResourceAiAgent/AiResourceType";
import RunbookStepType from "Common/Types/Runbook/RunbookStepType";
import {
  CloudChangeWords,
  describeCloudChange,
} from "Common/Utils/AiRemediation/CloudChangeWords";
import { formatDurationCompactInLanguage } from "Common/Utils/Slo/SloDuration";
import MarkdownViewer from "Common/UI/Components/Markdown.tsx/LazyMarkdownViewer";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import { translationKey, Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * WHAT A FIX'S STEPS SHOW ONCE OPENED, ON THE AI CARD'S REMEDIATION STEP
 * (issue #5598): "when I expand the step - it shows me more context into
 * why, commands ran, outputs".
 *
 *   plan     - the reasoning, then each command: where it runs, how risky
 *              it is, the command, why, what it should do, how it went the
 *              last times, who declares what it changes, and its undo
 *              (RemediationCommandPlanList);
 *   run      - each command as it ran: how it went, how long it took, its
 *              exit code, its error and its output, in sight
 *              (RemediationCommandRunList);
 *   rollback - each undo as it ran, the same way
 *              (RemediationCommandRollbackList).
 *
 * Each command and each undo is a line with a rule beside it, never a box:
 * the AI card is the only frame (block 43). Code reads left to right in
 * every language (Theme.css); what OneUptime AI and the agents wrote reads
 * in its own direction (dir="auto").
 */

/*
 * The kubectl policy tier, in the reader's words: is this a look, a safe
 * change, or something that needed a human to say yes.
 */
const TIER_VISUAL: Record<KubectlCommandTier, RemediationFixFactVisual> = {
  [KubectlCommandTier.Read]: {
    label: "read-only",
    dot: "bg-sky-500",
  },
  [KubectlCommandTier.SafeWrite]: {
    label: "safe change",
    dot: "bg-emerald-500",
  },
  [KubectlCommandTier.RiskyWrite]: {
    label: "riskier change",
    dot: "bg-amber-500",
  },
  [KubectlCommandTier.Denied]: {
    label: "denied",
    dot: "bg-rose-500",
    isAlarming: true,
  },
};

function KubectlTierFact({ tier }: { tier: KubectlCommandTier }): ReactElement {
  return (
    <RemediationFixFact
      visual={TIER_VISUAL[tier] || TIER_VISUAL[KubectlCommandTier.RiskyWrite]!}
      testId="remediation-command-tier"
    />
  );
}

/*
 * The resource command policy's tier, in the same words and colours: the
 * two tier enums carry the same values (a Common test asserts it), so a
 * resource command's "safe change" reads exactly like a kubectl one.
 */
const RESOURCE_TIER_TO_KUBECTL_TIER: Record<
  ResourceCommandTier,
  KubectlCommandTier
> = {
  [ResourceCommandTier.Read]: KubectlCommandTier.Read,
  [ResourceCommandTier.SafeWrite]: KubectlCommandTier.SafeWrite,
  [ResourceCommandTier.RiskyWrite]: KubectlCommandTier.RiskyWrite,
  [ResourceCommandTier.Denied]: KubectlCommandTier.Denied,
};

export function getResourceCommandTierLabel(tier: ResourceCommandTier): string {
  const kubectlTier: KubectlCommandTier =
    RESOURCE_TIER_TO_KUBECTL_TIER[tier] || KubectlCommandTier.RiskyWrite;
  return (
    TIER_VISUAL[kubectlTier] || TIER_VISUAL[KubectlCommandTier.RiskyWrite]!
  ).label;
}

function ResourceCommandTierFact({
  tier,
}: {
  tier: ResourceCommandTier;
}): ReactElement {
  return (
    <KubectlTierFact
      tier={
        RESOURCE_TIER_TO_KUBECTL_TIER[tier] || KubectlCommandTier.RiskyWrite
      }
    />
  );
}

/*
 * What the per-command approval pill says: did (or will) this command run
 * without a human saying yes?
 *
 * It is NOT read off command.policyVerdict. The server stores that verdict
 * as information for the approval card: every kubectl command on a
 * proposed plan is recorded RequiresApproval, and AutoApproved appears
 * only on a command a FullAuto run executed inline (wasAutoExecuted) or,
 * for Bash/SSH, on an informational allowlist match — a proposed plan can
 * therefore carry "AutoApproved" Bash commands that have not run and will
 * not run until someone approves. A green "auto-approved" pill under an
 * "Approve & Run" button reads as "already ran"; the on-call reader then
 * skips the approval, or approves expecting a second run. The pill is
 * therefore derived from what actually happened to the command and its
 * plan.
 */
export enum CommandApprovalPillKind {
  // Ran, or runs, with nobody approving it — the only time "auto-approved" is true.
  RanWithoutApproval = "RanWithoutApproval",
  // Nothing runs until a human approves the plan it belongs to.
  NeedsApproval = "NeedsApproval",
  /*
   * An SSH command of a plan composed before runbook credentials were
   * removed, which never ran: its plan cannot be approved any more, so
   * "needs approval" would ask for what nobody can give.
   */
  NoLongerRuns = "NoLongerRuns",
}

export function getCommandApprovalPillKind(
  command: Pick<AiRemediationCommand, "wasAutoExecuted"> &
    Partial<Pick<AiRemediationCommand, "stepType" | "execution">>,
  suggestionStatus: AutoRemediationSuggestionStatus,
): CommandApprovalPillKind | null {
  // A FullAuto / Automatic run executed this inline during planning.
  if (command.wasAutoExecuted === true) {
    return CommandApprovalPillKind.RanWithoutApproval;
  }

  if (
    command.stepType !== undefined &&
    isRemovedSshCommand({ stepType: command.stepType }) &&
    !command.execution &&
    (suggestionStatus === AutoRemediationSuggestionStatus.Suggested ||
      suggestionStatus === AutoRemediationSuggestionStatus.Planning)
  ) {
    return CommandApprovalPillKind.NoLongerRuns;
  }

  switch (suggestionStatus) {
    // The whole plan executed unattended; no approval step exists for it.
    case AutoRemediationSuggestionStatus.AutoExecuted:
      return CommandApprovalPillKind.RanWithoutApproval;
    /*
     * Waiting for a human (or still being composed and headed that way):
     * every command in the plan, whatever its verdict, runs only on
     * approval.
     */
    case AutoRemediationSuggestionStatus.Suggested:
    case AutoRemediationSuggestionStatus.Planning:
      return CommandApprovalPillKind.NeedsApproval;
    /*
     * Approved: a human said yes, so neither label is true any more — the
     * status pill and each command's execution pill tell the story.
     * Dismissed / NoneApplicable: nothing ran and nothing will.
     */
    default:
      return null;
  }
}

const APPROVAL_VISUAL: Record<
  CommandApprovalPillKind,
  RemediationFixFactVisual
> = {
  [CommandApprovalPillKind.RanWithoutApproval]: {
    label: "auto-approved",
    dot: "bg-emerald-500",
  },
  [CommandApprovalPillKind.NeedsApproval]: {
    label: "needs approval",
    dot: "bg-amber-500",
  },
  [CommandApprovalPillKind.NoLongerRuns]: {
    label: "no longer runs",
    dot: "bg-gray-400",
  },
};

function CommandApprovalFact({
  kind,
}: {
  kind: CommandApprovalPillKind;
}): ReactElement {
  return (
    <RemediationFixFact
      visual={
        APPROVAL_VISUAL[kind] ||
        APPROVAL_VISUAL[CommandApprovalPillKind.NeedsApproval]!
      }
      testId="remediation-command-approval"
    />
  );
}

const COMMAND_EXECUTION_VISUAL: Record<
  AiRemediationCommandExecutionStatus,
  RemediationFixFactVisual
> = {
  [AiRemediationCommandExecutionStatus.Pending]: {
    label: "Pending",
    dot: "bg-gray-400",
  },
  [AiRemediationCommandExecutionStatus.Running]: {
    label: "Running…",
    dot: "bg-blue-500",
  },
  [AiRemediationCommandExecutionStatus.Succeeded]: {
    label: "Succeeded",
    dot: "bg-emerald-500",
  },
  [AiRemediationCommandExecutionStatus.Failed]: {
    label: "Failed",
    dot: "bg-rose-500",
    isAlarming: true,
  },
  [AiRemediationCommandExecutionStatus.Skipped]: {
    label: "Skipped",
    dot: "bg-gray-400",
  },
};

function CommandExecutionFact({
  status,
  testId,
}: {
  status: AiRemediationCommandExecutionStatus;
  testId?: string | undefined;
}): ReactElement {
  return (
    <RemediationFixFact
      visual={
        COMMAND_EXECUTION_VISUAL[status] ||
        COMMAND_EXECUTION_VISUAL[AiRemediationCommandExecutionStatus.Pending]!
      }
      testId={testId || "remediation-command-execution"}
    />
  );
}

/*
 * Under a plan waiting for approval that holds an SSH command (composed
 * before runbook credentials were removed), in place of "Approve & Run":
 * the server refuses to approve it, so the card says so before anyone
 * clicks, and Dismiss is the one thing left to do.
 */
export const REMOVED_SSH_PLAN_NOTE: string = translationKey(
  "This plan can't be approved: OneUptime AI no longer runs SSH commands.",
);

// Whether a plan holds an SSH command, which no longer runs (isRemovedSshCommand).
export function hasRemovedSshCommand(
  plan: Pick<AiRemediationCommandPlan, "commands"> | null,
): boolean {
  return Boolean(
    plan?.commands.some((command: AiRemediationCommand): boolean => {
      return isRemovedSshCommand(command);
    }),
  );
}

// What an undo that was left for a person says, when the agent said nothing.
const UNDO_NOT_RUN: string = translationKey(
  "The undo did not run — undo this change by hand if it is still needed.",
);

/*
 * Where a command runs and the program it runs, after its place in the
 * plan: "1. cluster prod-east", "2. Docker host web-1  docker". The facts
 * a step says of it follow, as words with a dot that wrap as words do.
 */
function CommandHeading(props: {
  command: AiRemediationCommand;
  children?: React.ReactNode;
}): ReactElement {
  const translator: Translator = useTranslator();
  const programChip: string | null = getCommandProgramChip(props.command);

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
      <span className="inline-flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-xs font-medium text-gray-500">
          {props.command.sequence}.
        </span>
        <span className="break-words text-xs font-medium text-gray-900">
          {getCommandTargetLabel(props.command, translator)}
        </span>
        {programChip ? (
          <code
            data-testid="remediation-command-program"
            className="rounded bg-gray-100 px-1.5 py-0.5 font-mono text-xs text-gray-700"
          >
            {programChip}
          </code>
        ) : (
          <></>
        )}
      </span>
      {props.children}
    </div>
  );
}

/*
 * A command, exactly as it runs - all of it in sight, wrapped where the
 * card is narrower than the command: what is approved is what is read, not
 * its first forty characters and a scrollbar.
 */
function CommandCode(props: {
  command: string;
  testId?: string | undefined;
}): ReactElement {
  return (
    <pre
      data-testid={props.testId}
      className="mt-2 whitespace-pre-wrap rounded-md bg-gray-50 px-3 py-2 font-mono text-xs leading-5 text-gray-800 [overflow-wrap:anywhere]"
    >
      {props.command}
    </pre>
  );
}

/*
 * Who declares the object a kubectl command changes (Argo CD, Flux or a
 * Helm release) and what that means for the change, in OneUptime's own
 * sentence. A change its owner puts back is labelled a temporary fix, so
 * nobody approves it as the lasting one.
 */
function CommandGitOpsNote(props: {
  command: AiRemediationCommand;
}): ReactElement {
  const translator: Translator = useTranslator();
  const { gitOps } = props.command;

  if (!gitOps) {
    return <></>;
  }

  return (
    <div className="mt-2" data-testid="remediation-command-gitops">
      <p className="break-words text-xs leading-5 text-gray-600">
        {gitOps.putsBack ? (
          <span className="me-1 font-medium text-amber-700">
            {translator.translateText("Temporary fix")}
          </span>
        ) : (
          <></>
        )}
        {gitOps.summary}
      </p>
    </div>
  );
}

/*
 * Once verification read the object a command changed again: what of the
 * change its owner put back - with the command as it ran.
 */
function CommandPutBackNote(props: {
  command: AiRemediationCommand;
}): ReactElement {
  const translator: Translator = useTranslator();
  const { revertWatch } = props.command;

  if (!revertWatch?.putBackAt) {
    return <></>;
  }

  return (
    <div
      className="mt-2 text-xs text-rose-600"
      data-testid="remediation-command-put-back"
    >
      {translator.translateTemplate("Put back on the cluster: {{fields}}", {
        fields: (revertWatch.putBackFields || []).join(", "),
      })}
    </div>
  );
}

/*
 * A cloud change in plain words, above its exact command: "Scale the ECS
 * service checkout-api out to 8 tasks" - read from the command by the
 * catalog's grammar (Common/Utils/AiRemediation/CloudChangeWords), never
 * from the model's words, in the reader's language. Nothing for a command
 * that is not a cloud change; the command under it is what runs.
 */
function CloudChangeWordsLine(props: {
  command: AiRemediationCommand;
}): ReactElement {
  const translator: Translator = useTranslator();
  const { command } = props;

  if (
    command.stepType !== RunbookStepType.ResourceCommand ||
    !isCloudAiResourceType(command.resourceType)
  ) {
    return <></>;
  }

  const words: CloudChangeWords | null = describeCloudChange({
    resourceType: command.resourceType,
    command: command.command,
    translator,
  });

  if (!words) {
    return <></>;
  }

  return (
    <div
      dir="auto"
      data-testid="remediation-command-words"
      className="mt-2 break-words text-sm font-medium text-gray-900"
    >
      {words.sentence}
    </div>
  );
}

/*
 * A cloud change's notes: the code that declares its resource (such a
 * change is only ever proposed: the next apply would put the old value
 * back), and, before it ran, its dry run (CloudDryRunNote) - or, before
 * any, that its undo is written from the value it replaces: the agent
 * reads that value first and reports it.
 */
function CloudCommandNote(props: {
  command: AiRemediationCommand;
}): ReactElement {
  const translator: Translator = useTranslator();
  const { command } = props;

  if (
    command.stepType !== RunbookStepType.ResourceCommand ||
    !isCloudAiResourceType(command.resourceType)
  ) {
    return <></>;
  }

  return (
    <div className="mt-2 space-y-1" data-testid="remediation-command-cloud">
      {command.managedAsCode ? (
        <div className="text-xs leading-5 text-amber-700">
          {translator.translateTemplate(
            "Declared as code by {{owner}}: the next apply may put the old value back, so change the code too.",
            { owner: command.managedAsCode },
          )}
        </div>
      ) : (
        <></>
      )}
      {!command.execution && command.dryRun ? (
        <CloudDryRunNote dryRun={command.dryRun} />
      ) : !command.execution && !command.rollbackCommand ? (
        <div className="text-xs text-gray-500">
          {translator.translateText(
            "The agent reads the value this change replaces before it makes it, and OneUptime writes the exact undo from it.",
          )}
        </div>
      ) : (
        <></>
      )}
    </div>
  );
}

// How long a command or an undo took, once it ended: "2s", "1m 5s".
function getExecutionDuration(
  execution: AiRemediationCommandExecutionState,
  translator: Translator,
): string | null {
  const startedAt: Date | null = readRemediationMoment(execution.startedAt);
  const completedAt: Date | null = readRemediationMoment(execution.completedAt);

  if (!startedAt || !completedAt) {
    return null;
  }

  const seconds: number = Math.max(
    0,
    Math.round((completedAt.getTime() - startedAt.getTime()) / 1000),
  );

  return formatDurationCompactInLanguage(seconds, translator.language);
}

/*
 * A command as it ran, as a terminal shows it: the command after its
 * prompt, then what it printed, in one block that scrolls once it is long -
 * then its exit code, and its error in red. For a command and for its undo.
 * Each part is mono itself: the Dashboard gives every element Inter (its
 * universal rule), which a span would take over the block's own font.
 */
function CommandTranscript(props: {
  command: string;
  execution?: AiRemediationCommandExecutionState | undefined;
}): ReactElement {
  const translator: Translator = useTranslator();
  const execution: AiRemediationCommandExecutionState | undefined =
    props.execution;

  return (
    <>
      <pre
        data-testid="remediation-command-transcript"
        className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap rounded-md bg-gray-50 px-3 py-2 font-mono text-xs leading-5 text-gray-700 [overflow-wrap:anywhere]"
      >
        {props.command ? (
          <>
            <span
              aria-hidden="true"
              className="select-none font-mono text-gray-400"
            >
              {"$ "}
            </span>
            <span
              data-testid="remediation-command-line"
              className="font-mono font-medium text-gray-900"
            >
              {props.command}
            </span>
          </>
        ) : (
          <></>
        )}
        {execution?.output ? (
          <>
            {props.command ? "\n" : ""}
            <span
              data-testid="remediation-command-output"
              className="font-mono"
            >
              {execution.output}
            </span>
          </>
        ) : (
          <></>
        )}
      </pre>
      {typeof execution?.exitCode === "number" ? (
        <div
          data-testid="remediation-command-exit-code"
          className="mt-1.5 text-xs text-gray-500"
        >
          {translator.translateTemplate("Exit code: {{code}}", {
            code: execution.exitCode,
          })}
        </div>
      ) : (
        <></>
      )}
      {execution?.errorMessage ? (
        <div
          dir="auto"
          data-testid="remediation-command-error"
          className="mt-1 whitespace-pre-wrap break-words text-xs text-rose-600"
        >
          {execution.errorMessage}
        </div>
      ) : (
        <></>
      )}
    </>
  );
}

/*
 * The reasoning OneUptime AI wrote for a fix: the first thing its plan
 * step opens to, in its own direction.
 */
export const RemediationFixReasoning: FunctionComponent<{
  markdown: string;
}> = (props: { markdown: string }): ReactElement => {
  return (
    <div
      dir="auto"
      data-testid="remediation-fix-reasoning"
      className="text-sm text-gray-700"
    >
      <MarkdownViewer text={props.markdown} safeMode={true} />
    </div>
  );
};

/*
 * A plan's commands as its plan step opens to them: what each one is and
 * why, before anything ran - and, while the fix waits for approval, how
 * the same change went before and its dry run.
 */
export const RemediationCommandPlanList: FunctionComponent<{
  plan: AiRemediationCommandPlan;
  suggestionStatus: AutoRemediationSuggestionStatus;
  // A plan that can no longer be approved: nothing in it waits for approval.
  isUnapprovable: boolean;
}> = (props: {
  plan: AiRemediationCommandPlan;
  suggestionStatus: AutoRemediationSuggestionStatus;
  isUnapprovable: boolean;
}): ReactElement => {
  return (
    <ol data-testid="remediation-plan-commands" className="flex flex-col gap-4">
      {props.plan.commands.map(
        (command: AiRemediationCommand): ReactElement => {
          const commandPillKind: CommandApprovalPillKind | null =
            getCommandApprovalPillKind(command, props.suggestionStatus);
          /*
           * Nothing in a plan that can't be approved waits for an approval:
           * only its SSH command's "no longer runs" is said.
           */
          const approvalPillKind: CommandApprovalPillKind | null =
            props.isUnapprovable &&
            commandPillKind === CommandApprovalPillKind.NeedsApproval
              ? null
              : commandPillKind;

          return (
            <li
              key={`plan-${command.sequence}`}
              data-testid="remediation-command"
              data-sequence={command.sequence}
              className="border-s-2 border-gray-200 ps-3"
            >
              <CommandHeading command={command}>
                {command.kubectlTier ? (
                  <KubectlTierFact tier={command.kubectlTier} />
                ) : command.stepType === RunbookStepType.ResourceCommand &&
                  command.resourceCommandTier ? (
                  <ResourceCommandTierFact tier={command.resourceCommandTier} />
                ) : (
                  <></>
                )}
                {approvalPillKind ? (
                  <CommandApprovalFact kind={approvalPillKind} />
                ) : (
                  <></>
                )}
              </CommandHeading>

              <CloudChangeWordsLine command={command} />

              <CommandCode command={command.command} />

              <div
                dir="auto"
                data-testid="remediation-command-rationale"
                className="mt-2 text-xs leading-5 text-gray-600"
              >
                {command.rationale}
              </div>
              {/*
              What OneUptime AI expects, in its own words, set apart from
              the label (TranslatedSentence): on a Persian page an English
              effect kept its full stop at the start of its last line.
            */}
              <div
                data-testid="remediation-command-expected-effect"
                className="mt-1 text-xs leading-5 text-gray-500"
              >
                <TranslatedSentence
                  template="Expected effect: {{effect}}"
                  slots={{}}
                  values={{ effect: command.expectedEffect }}
                />
              </div>

              {/*
              How the same change went the last times it ran on this
              cluster or resource, while it waits for approval: what the
              person approving weighs.
            */}
              {command.trackRecord && !command.execution ? (
                <RemediationTrackRecordLine record={command.trackRecord} />
              ) : (
                <></>
              )}

              <CommandGitOpsNote command={command} />

              <CloudCommandNote command={command} />

              {command.rollbackCommand ? (
                <div
                  data-testid="remediation-command-undo"
                  className="mt-1 text-xs leading-5 text-gray-500"
                >
                  <TranslatedSentence
                    template="Rollback: {{command}}"
                    slots={{
                      // Code, which reads left to right in every language (Theme.css).
                      command: (
                        <code className="font-mono text-gray-700">
                          {command.rollbackCommand}
                        </code>
                      ),
                    }}
                  />
                </div>
              ) : (
                <></>
              )}
            </li>
          );
        },
      )}
    </ol>
  );
};

/*
 * A plan's commands as its run step opens to them: each as it ran, in the
 * order it ran - how it went and how long it took, then its exit code, its
 * error and its output.
 */
export const RemediationCommandRunList: FunctionComponent<{
  plan: AiRemediationCommandPlan;
}> = (props: { plan: AiRemediationCommandPlan }): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <ol data-testid="remediation-run-commands" className="flex flex-col gap-4">
      {props.plan.commands.map(
        (command: AiRemediationCommand): ReactElement => {
          const duration: string | null = command.execution
            ? getExecutionDuration(command.execution, translator)
            : null;

          return (
            <li
              key={`run-${command.sequence}`}
              data-testid="remediation-command-run"
              data-sequence={command.sequence}
              data-status={
                command.execution?.status ||
                AiRemediationCommandExecutionStatus.Pending
              }
              className="border-s-2 border-gray-200 ps-3"
            >
              <CommandHeading command={command}>
                <CommandExecutionFact
                  status={
                    command.execution?.status ||
                    AiRemediationCommandExecutionStatus.Pending
                  }
                />
                {duration ? (
                  <span
                    data-testid="remediation-command-duration"
                    className="text-xs text-gray-500 tabular-nums"
                  >
                    {duration}
                  </span>
                ) : (
                  <></>
                )}
              </CommandHeading>

              <CommandTranscript
                command={command.command}
                execution={command.execution}
              />

              <CommandPutBackNote command={command} />
            </li>
          );
        },
      )}
    </ol>
  );
};

/*
 * A plan's undos as its rollback step opens to them: each undo that ran,
 * or was left for a person, as it ran.
 */
export const RemediationCommandRollbackList: FunctionComponent<{
  plan: AiRemediationCommandPlan;
}> = (props: { plan: AiRemediationCommandPlan }): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <ol
      data-testid="remediation-rollback-commands"
      className="flex flex-col gap-4"
    >
      {props.plan.commands
        .filter((command: AiRemediationCommand): boolean => {
          return Boolean(command.rollbackExecution);
        })
        .map((command: AiRemediationCommand): ReactElement => {
          const execution: AiRemediationCommandExecutionState =
            command.rollbackExecution!;
          const duration: string | null = getExecutionDuration(
            execution,
            translator,
          );

          return (
            <li
              key={`rollback-${command.sequence}`}
              data-testid="remediation-rollback-outcome"
              data-sequence={command.sequence}
              data-status={execution.status}
              className="border-s-2 border-gray-200 ps-3"
            >
              <CommandHeading command={command}>
                <CommandExecutionFact
                  status={execution.status}
                  testId="remediation-rollback-execution"
                />
                {duration ? (
                  <span className="text-xs text-gray-500 tabular-nums">
                    {duration}
                  </span>
                ) : (
                  <></>
                )}
              </CommandHeading>

              <CommandTranscript
                command={command.rollbackCommand || ""}
                execution={execution}
              />

              {execution.status ===
                AiRemediationCommandExecutionStatus.Skipped &&
              !execution.errorMessage ? (
                <div className="mt-2 text-xs text-gray-500">
                  {translator.translateText(UNDO_NOT_RUN)}
                </div>
              ) : (
                <></>
              )}
            </li>
          );
        })}
    </ol>
  );
};
