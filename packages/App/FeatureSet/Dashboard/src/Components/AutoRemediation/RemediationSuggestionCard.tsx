import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import { JSONObject } from "Common/Types/JSON";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import AutoRemediationSuggestion from "Common/Models/DatabaseModels/AutoRemediationSuggestion";
import AutoRemediationSuggestionStatus from "Common/Types/AutoRemediation/AutoRemediationSuggestionStatus";
import AutoRemediationVerificationStatus from "Common/Types/AutoRemediation/AutoRemediationVerificationStatus";
import AutoRemediationSuggestionType from "Common/Types/AutoRemediation/AutoRemediationSuggestionType";
import {
  AiRemediationCommand,
  AiRemediationCommandExecutionState,
  AiRemediationCommandExecutionStatus,
  AiRemediationCommandPlan,
  AiRemediationCommandPlanUtil,
  AiRemediationPlanExecutionStatus,
} from "Common/Types/AutoRemediation/AiRemediationCommandPlan";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import RunbookStepType from "Common/Types/Runbook/RunbookStepType";
import { KubectlCommandTier } from "Common/Types/Kubernetes/KubernetesClusterAiAccess";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import MarkdownViewer from "Common/UI/Components/Markdown.tsx/LazyMarkdownViewer";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

export interface ComponentProps {
  incidentId?: ObjectID | undefined;
  alertId?: ObjectID | undefined;
  hideIfEmpty?: boolean | undefined;
}

interface StatusVisual {
  label: string;
  badge: string;
  dot: string;
}

const STATUS_VISUAL: Record<AutoRemediationSuggestionStatus, StatusVisual> = {
  [AutoRemediationSuggestionStatus.Planning]: {
    label: "AI is picking a runbook…",
    badge: "bg-blue-50 text-blue-700 ring-blue-200",
    dot: "bg-blue-500",
  },
  [AutoRemediationSuggestionStatus.Suggested]: {
    label: "Waiting for approval",
    badge: "bg-amber-50 text-amber-700 ring-amber-200",
    dot: "bg-amber-500",
  },
  [AutoRemediationSuggestionStatus.Approved]: {
    label: "Approved & started",
    badge: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    dot: "bg-emerald-500",
  },
  [AutoRemediationSuggestionStatus.AutoExecuted]: {
    label: "Auto-executed",
    badge: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    dot: "bg-emerald-500",
  },
  [AutoRemediationSuggestionStatus.Dismissed]: {
    label: "Dismissed",
    badge: "bg-gray-100 text-gray-700 ring-gray-200",
    dot: "bg-gray-400",
  },
  [AutoRemediationSuggestionStatus.NoneApplicable]: {
    label: "No runbook applies",
    badge: "bg-gray-100 text-gray-700 ring-gray-200",
    dot: "bg-gray-400",
  },
};

function StatusPill({
  status,
  isCommandPlan,
}: {
  status: AutoRemediationSuggestionStatus;
  isCommandPlan?: boolean | undefined;
}): ReactElement {
  const v: StatusVisual =
    STATUS_VISUAL[status] ||
    STATUS_VISUAL[AutoRemediationSuggestionStatus.Planning]!;
  // A command plan is composed, not picked from runbooks.
  const label: string =
    isCommandPlan && status === AutoRemediationSuggestionStatus.Planning
      ? "AI is composing a fix…"
      : isCommandPlan &&
          status === AutoRemediationSuggestionStatus.NoneApplicable
        ? "No safe fix found"
        : v.label;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${v.badge}`}
    >
      <span className={`inline-block w-1.5 h-1.5 rounded-full ${v.dot}`}></span>
      {label}
    </span>
  );
}

interface TierVisual {
  label: string;
  badge: string;
  dot: string;
}

/*
 * The kubectl policy tier, in the reader's words: is this a look, a safe
 * change, or something that needed a human to say yes.
 */
const TIER_VISUAL: Record<KubectlCommandTier, TierVisual> = {
  [KubectlCommandTier.Read]: {
    label: "read-only",
    badge: "bg-sky-50 text-sky-700 ring-sky-200",
    dot: "bg-sky-500",
  },
  [KubectlCommandTier.SafeWrite]: {
    label: "safe change",
    badge: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    dot: "bg-emerald-500",
  },
  [KubectlCommandTier.RiskyWrite]: {
    label: "riskier change",
    badge: "bg-amber-50 text-amber-700 ring-amber-200",
    dot: "bg-amber-500",
  },
  [KubectlCommandTier.Denied]: {
    label: "denied",
    badge: "bg-rose-50 text-rose-700 ring-rose-200",
    dot: "bg-rose-500",
  },
};

function KubectlTierPill({ tier }: { tier: KubectlCommandTier }): ReactElement {
  const v: TierVisual =
    TIER_VISUAL[tier] || TIER_VISUAL[KubectlCommandTier.RiskyWrite]!;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${v.badge}`}
    >
      <span className={`inline-block w-1.5 h-1.5 rounded-full ${v.dot}`}></span>
      {v.label}
    </span>
  );
}

interface VerificationVisual {
  label: string;
  badge: string;
  dot: string;
}

const VERIFICATION_VISUAL: Record<
  AutoRemediationVerificationStatus,
  VerificationVisual
> = {
  [AutoRemediationVerificationStatus.Pending]: {
    label: "Verifying recovery\u2026",
    badge: "bg-blue-50 text-blue-700 ring-blue-200",
    dot: "bg-blue-500",
  },
  [AutoRemediationVerificationStatus.Verified]: {
    label: "Verified fixed",
    badge: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    dot: "bg-emerald-500",
  },
  [AutoRemediationVerificationStatus.Failed]: {
    label: "Verification failed",
    badge: "bg-rose-50 text-rose-700 ring-rose-200",
    dot: "bg-rose-500",
  },
  [AutoRemediationVerificationStatus.Skipped]: {
    label: "Verification skipped",
    badge: "bg-gray-100 text-gray-700 ring-gray-200",
    dot: "bg-gray-400",
  },
};

function VerificationPill({
  status,
}: {
  status: AutoRemediationVerificationStatus;
}): ReactElement {
  const v: VerificationVisual =
    VERIFICATION_VISUAL[status] ||
    VERIFICATION_VISUAL[AutoRemediationVerificationStatus.Pending]!;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${v.badge}`}
    >
      <span className={`inline-block w-1.5 h-1.5 rounded-full ${v.dot}`}></span>
      {v.label}
    </span>
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
}

export function getCommandApprovalPillKind(
  command: Pick<AiRemediationCommand, "wasAutoExecuted">,
  suggestionStatus: AutoRemediationSuggestionStatus,
): CommandApprovalPillKind | null {
  // A FullAuto / Automatic run executed this inline during planning.
  if (command.wasAutoExecuted === true) {
    return CommandApprovalPillKind.RanWithoutApproval;
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

interface ApprovalVisual {
  label: string;
  badge: string;
  dot: string;
}

const APPROVAL_VISUAL: Record<CommandApprovalPillKind, ApprovalVisual> = {
  [CommandApprovalPillKind.RanWithoutApproval]: {
    label: "auto-approved",
    badge: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    dot: "bg-emerald-500",
  },
  [CommandApprovalPillKind.NeedsApproval]: {
    label: "needs approval",
    badge: "bg-amber-50 text-amber-700 ring-amber-200",
    dot: "bg-amber-500",
  },
};

function CommandApprovalPill({
  kind,
}: {
  kind: CommandApprovalPillKind;
}): ReactElement {
  const v: ApprovalVisual =
    APPROVAL_VISUAL[kind] ||
    APPROVAL_VISUAL[CommandApprovalPillKind.NeedsApproval]!;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${v.badge}`}
    >
      <span className={`inline-block w-1.5 h-1.5 rounded-full ${v.dot}`}></span>
      {v.label}
    </span>
  );
}

interface CommandExecutionVisual {
  label: string;
  badge: string;
  dot: string;
}

const COMMAND_EXECUTION_VISUAL: Record<
  AiRemediationCommandExecutionStatus,
  CommandExecutionVisual
> = {
  [AiRemediationCommandExecutionStatus.Pending]: {
    label: "Pending",
    badge: "bg-gray-100 text-gray-700 ring-gray-200",
    dot: "bg-gray-400",
  },
  [AiRemediationCommandExecutionStatus.Running]: {
    label: "Running…",
    badge: "bg-blue-50 text-blue-700 ring-blue-200",
    dot: "bg-blue-500",
  },
  [AiRemediationCommandExecutionStatus.Succeeded]: {
    label: "Succeeded",
    badge: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    dot: "bg-emerald-500",
  },
  [AiRemediationCommandExecutionStatus.Failed]: {
    label: "Failed",
    badge: "bg-rose-50 text-rose-700 ring-rose-200",
    dot: "bg-rose-500",
  },
  [AiRemediationCommandExecutionStatus.Skipped]: {
    label: "Skipped",
    badge: "bg-gray-100 text-gray-700 ring-gray-200",
    dot: "bg-gray-400",
  },
};

function CommandExecutionPill({
  status,
}: {
  status: AiRemediationCommandExecutionStatus;
}): ReactElement {
  const v: CommandExecutionVisual =
    COMMAND_EXECUTION_VISUAL[status] ||
    COMMAND_EXECUTION_VISUAL[AiRemediationCommandExecutionStatus.Pending]!;
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${v.badge}`}
    >
      <span className={`inline-block w-1.5 h-1.5 rounded-full ${v.dot}`}></span>
      {v.label}
    </span>
  );
}

/*
 * What one execution record says beyond its status pill: the exit code,
 * the error, and the output behind a toggle. Used for a command and for
 * its rollback.
 */
function CommandExecutionDetails(props: {
  execution: AiRemediationCommandExecutionState;
  isOutputExpanded: boolean;
  onToggleOutput: () => void;
}): ReactElement {
  return (
    <div className="mt-2">
      {typeof props.execution.exitCode === "number" ? (
        <div className="text-xs text-gray-500">
          Exit code: {props.execution.exitCode}
        </div>
      ) : (
        <></>
      )}
      {props.execution.errorMessage ? (
        <div className="mt-1 text-xs text-rose-600">
          {props.execution.errorMessage}
        </div>
      ) : (
        <></>
      )}
      {props.execution.output ? (
        <div className="mt-1">
          <button
            type="button"
            className="text-xs font-medium text-indigo-600 hover:text-indigo-500"
            onClick={props.onToggleOutput}
          >
            {props.isOutputExpanded ? "Hide output" : "Show output"}
          </button>
          {props.isOutputExpanded ? (
            <pre className="mt-1 max-h-64 overflow-auto rounded border border-gray-200 bg-white px-3 py-2 font-mono text-xs text-gray-800">
              {props.execution.output}
            </pre>
          ) : (
            <></>
          )}
        </div>
      ) : (
        <></>
      )}
    </div>
  );
}

const POLL_INTERVAL_MS: number = 15 * 1000;

export type RemediationSuggestionAction = "approve" | "dismiss";

// The suggestion has left "waiting": someone approved it, or it ran unattended.
function isAlreadyStarted(
  status: AutoRemediationSuggestionStatus | undefined,
): boolean {
  return (
    status === AutoRemediationSuggestionStatus.Approved ||
    status === AutoRemediationSuggestionStatus.AutoExecuted
  );
}

/*
 * The refusal's headline: the action that failed, and what the reloaded
 * suggestion says really happened. The server refuses an approval BEFORE
 * it claims the plan when the plan cannot run — the cluster's remediation
 * was switched off, its Runner changed — so a refused approval of a plan
 * that is still waiting ran nothing. But it also refuses an approval that
 * lost to another one ("Only suggested remediations can be approved — this
 * one is Approved", "This suggestion was just actioned by someone else"):
 * then the plan WAS approved and is running, and "nothing ran" would tell
 * the reader the opposite of what happened to the cluster.
 */
export function getActionErrorTitle(
  action: RemediationSuggestionAction | null,
  statusAfterReload?: AutoRemediationSuggestionStatus | undefined,
): string {
  if (action === "approve") {
    if (statusAfterReload === AutoRemediationSuggestionStatus.Approved) {
      return "Your approval was not recorded: this fix had already been approved, and it has started — see its commands below";
    }
    if (statusAfterReload === AutoRemediationSuggestionStatus.AutoExecuted) {
      return "Your approval was not recorded: this fix already ran without approval — see its commands below";
    }
    return "Could not save your action: the fix was not approved and nothing ran";
  }
  if (action === "dismiss") {
    if (isAlreadyStarted(statusAfterReload)) {
      return "Could not save your action: the suggestion was not dismissed — this fix had already started; see its commands below";
    }
    return "Could not save your action: the suggestion was not dismissed";
  }
  return "Could not save your action";
}

const RemediationSuggestionCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [suggestions, setSuggestions] = useState<
    Array<AutoRemediationSuggestion>
  >([]);
  const [isLoaded, setIsLoaded] = useState<boolean>(false);
  const [actionError, setActionError] = useState<string>("");
  const [failedAction, setFailedAction] =
    useState<RemediationSuggestionAction | null>(null);
  // Which suggestion the refused action was on, to read its reloaded status.
  const [failedSuggestionId, setFailedSuggestionId] = useState<string>("");
  const [busySuggestionId, setBusySuggestionId] = useState<string>("");
  const [busyAction, setBusyAction] =
    useState<RemediationSuggestionAction | null>(null);
  const [expandedIds, setExpandedIds] = useState<Set<string>>(
    new Set<string>(),
  );
  /*
   * An approve/dismiss is in flight — from the click until the reload that
   * shows its outcome has landed. It is both the single-submit guard and
   * what keeps a background poll from clobbering the list meanwhile.
   */
  const isActionInFlightRef: React.MutableRefObject<boolean> =
    useRef<boolean>(false);

  const incidentIdString: string | undefined = props.incidentId?.toString();
  const alertIdString: string | undefined = props.alertId?.toString();

  const load: (options?: { isActionReload?: boolean }) => Promise<void> =
    useCallback(
      async (options?: { isActionReload?: boolean }): Promise<void> => {
        /*
         * Don't clobber the list while an approve/dismiss is in flight —
         * except for that action's own reload, which is what ends it.
         */
        if (isActionInFlightRef.current && !options?.isActionReload) {
          return;
        }
        try {
          const query: Record<string, ObjectID> = {};
          if (incidentIdString) {
            query["incidentId"] = new ObjectID(incidentIdString);
          } else if (alertIdString) {
            query["alertId"] = new ObjectID(alertIdString);
          } else {
            return;
          }

          const result: ListResult<AutoRemediationSuggestion> =
            await ModelAPI.getList<AutoRemediationSuggestion>({
              modelType: AutoRemediationSuggestion,
              query,
              limit: 10,
              skip: 0,
              select: {
                _id: true,
                status: true,
                ruleNameSnapshot: true,
                runbookNameSnapshot: true,
                rationaleMarkdown: true,
                runbookId: true,
                runbookExecutionId: true,
                suggestionType: true,
                commandPlan: true,
                verificationStatus: true,
                verificationNote: true,
                kubernetesClusterId: true,
                createdAt: true,
              },
              sort: {
                createdAt: SortOrder.Descending,
              },
            });

          setSuggestions(result.data);
          setIsLoaded(true);
        } catch {
          // Best-effort card — a failed refresh keeps the previous state.
          setIsLoaded(true);
        }
      },
      [incidentIdString, alertIdString],
    );

  useEffect(() => {
    load().catch(() => {
      // handled inside load
    });
  }, [load]);

  // Poll while an AI plan is still in flight so the pick lands live.
  const hasPlanning: boolean = suggestions.some(
    (s: AutoRemediationSuggestion): boolean => {
      if (
        s.status === AutoRemediationSuggestionStatus.Planning ||
        s.verificationStatus === AutoRemediationVerificationStatus.Pending
      ) {
        return true;
      }
      // An approved command plan settles asynchronously — keep polling until it does.
      if (
        s.suggestionType === AutoRemediationSuggestionType.CommandPlan &&
        (s.status === AutoRemediationSuggestionStatus.Approved ||
          s.status === AutoRemediationSuggestionStatus.AutoExecuted)
      ) {
        const plan: AiRemediationCommandPlan | null =
          AiRemediationCommandPlanUtil.parse(s.commandPlan || null);
        if (!plan) {
          return false;
        }
        // A missing executionStatus right after approval means the sweep has not started yet.
        const executionStatus: AiRemediationPlanExecutionStatus =
          plan.executionStatus || AiRemediationPlanExecutionStatus.NotStarted;
        return (
          executionStatus === AiRemediationPlanExecutionStatus.Running ||
          executionStatus === AiRemediationPlanExecutionStatus.NotStarted
        );
      }
      return false;
    },
  );

  useEffect(() => {
    if (!hasPlanning) {
      return;
    }
    const interval: ReturnType<typeof setInterval> = setInterval(() => {
      load().catch(() => {
        // handled inside load
      });
    }, POLL_INTERVAL_MS);
    return () => {
      clearInterval(interval);
    };
  }, [hasPlanning, load]);

  const toggleExpanded: (key: string) => void = (key: string): void => {
    setExpandedIds((prev: Set<string>): Set<string> => {
      const next: Set<string> = new Set<string>(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const performAction: (
    suggestion: AutoRemediationSuggestion,
    action: RemediationSuggestionAction,
  ) => Promise<void> = async (
    suggestion: AutoRemediationSuggestion,
    action: RemediationSuggestionAction,
  ): Promise<void> => {
    const suggestionId: string | undefined = suggestion.id?.toString();
    if (!suggestionId) {
      return;
    }

    /*
     * One action at a time, decided on the ref rather than on state: a
     * double click lands both clicks before React re-renders the button
     * as disabled, and each click would otherwise post its own approve.
     */
    if (isActionInFlightRef.current) {
      return;
    }
    isActionInFlightRef.current = true;

    setActionError("");
    setFailedAction(null);
    setFailedSuggestionId("");
    setBusySuggestionId(suggestionId);
    setBusyAction(action);

    let refusal: string = "";

    try {
      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await API.post<JSONObject>({
          url: URL.fromString(APP_API_URL.toString()).addRoute(
            `/auto-remediation/${action}`,
          ),
          data: { suggestionId },
          headers: ModelAPI.getCommonHeaders(),
        });

      if (response instanceof HTTPErrorResponse) {
        throw response;
      }
    } catch (err) {
      /*
       * The server re-checks a kubectl plan at approval time — the cluster's
       * remediation may have been switched off, or its Runner or
       * credential changed, since the plan was composed — and refuses the
       * click with the reason and what to do. It also refuses a click that
       * lost to someone else's; the reload below says which.
       */
      refusal = API.getFriendlyMessage(err);
    }

    /*
     * Reload either way — a refusal usually means the plan's state moved
     * on — and only then release the guard. Until the reloaded row
     * replaces the one the click was made on, that row still shows
     * "Approve & Run", and a second click there would post again. The
     * refusal is shown together with the reloaded row, so its headline can
     * say what really happened.
     */
    try {
      await load({ isActionReload: true });
    } finally {
      if (refusal) {
        setActionError(refusal);
        setFailedAction(action);
        setFailedSuggestionId(suggestionId);
      }
      setBusySuggestionId("");
      setBusyAction(null);
      isActionInFlightRef.current = false;
    }
  };

  if (!isLoaded && props.hideIfEmpty) {
    return <Fragment />;
  }

  if (props.hideIfEmpty && suggestions.length === 0) {
    return <Fragment />;
  }

  if (suggestions.length === 0) {
    return <Fragment />;
  }

  return (
    <Card
      title="Remediation"
      description="Fixes OneUptime AI proposed or applied for this signal — kubectl on a cluster, commands on a Runner, or a runbook. Approving runs exactly what is shown, under your name."
    >
      <div className="flex flex-col gap-4">
        {actionError ? (
          <Alert
            type={AlertType.DANGER}
            strongTitle={getActionErrorTitle(
              failedAction,
              suggestions.find(
                (suggestion: AutoRemediationSuggestion): boolean => {
                  return suggestion.id?.toString() === failedSuggestionId;
                },
              )?.status as AutoRemediationSuggestionStatus | undefined,
            )}
            title={actionError}
            dataTestId="remediation-action-error"
          />
        ) : (
          <></>
        )}

        {suggestions.map(
          (suggestion: AutoRemediationSuggestion): ReactElement => {
            const suggestionId: string = suggestion.id?.toString() || "";
            const status: AutoRemediationSuggestionStatus =
              (suggestion.status as AutoRemediationSuggestionStatus) ||
              AutoRemediationSuggestionStatus.Planning;
            const isBusy: boolean = busySuggestionId === suggestionId;
            const isExpanded: boolean = expandedIds.has(suggestionId);
            const isCommandPlan: boolean =
              suggestion.suggestionType ===
              AutoRemediationSuggestionType.CommandPlan;
            const plan: AiRemediationCommandPlan | null = isCommandPlan
              ? AiRemediationCommandPlanUtil.parse(
                  suggestion.commandPlan || null,
                )
              : null;
            const runbookTitle: string =
              suggestion.runbookNameSnapshot ||
              (status === AutoRemediationSuggestionStatus.Planning
                ? "Picking the best runbook…"
                : "No runbook");
            const isClusterFix: boolean = Boolean(
              suggestion.kubernetesClusterId ||
                plan?.commands.some((command: AiRemediationCommand) => {
                  return command.stepType === RunbookStepType.Kubectl;
                }),
            );
            const title: string = isCommandPlan
              ? isClusterFix
                ? "AI kubectl fix"
                : "AI Command Plan"
              : runbookTitle;
            const sourceLabel: string = suggestion.kubernetesClusterId
              ? suggestion.ruleNameSnapshot || "AI remediation for cluster"
              : `Rule: ${suggestion.ruleNameSnapshot || "Unknown"}`;

            return (
              <div
                key={suggestionId}
                className="rounded-md border border-gray-200 p-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-col">
                    <span className="text-sm font-medium text-gray-900">
                      {title}
                    </span>
                    <span className="text-xs text-gray-500">{sourceLabel}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusPill status={status} isCommandPlan={isCommandPlan} />
                    {suggestion.verificationStatus ? (
                      <VerificationPill
                        status={
                          suggestion.verificationStatus as AutoRemediationVerificationStatus
                        }
                      />
                    ) : (
                      <></>
                    )}
                  </div>
                </div>

                {suggestion.verificationNote ? (
                  <div className="mt-2 text-xs text-gray-500">
                    {suggestion.verificationNote}
                  </div>
                ) : (
                  <></>
                )}

                {suggestion.rationaleMarkdown ? (
                  <div className="mt-3">
                    <button
                      type="button"
                      className="text-xs font-medium text-indigo-600 hover:text-indigo-500"
                      onClick={() => {
                        toggleExpanded(suggestionId);
                      }}
                    >
                      {isExpanded ? "Hide reasoning" : "Show reasoning"}
                    </button>
                    {isExpanded ? (
                      <div className="mt-2 text-sm text-gray-700">
                        <MarkdownViewer
                          text={suggestion.rationaleMarkdown}
                          safeMode={true}
                        />
                      </div>
                    ) : (
                      <></>
                    )}
                  </div>
                ) : (
                  <></>
                )}

                {plan ? (
                  <div className="mt-3">
                    <ol className="flex flex-col gap-3">
                      {plan.commands.map(
                        (command: AiRemediationCommand): ReactElement => {
                          const commandKey: string = `${suggestionId}:command:${command.sequence}`;
                          const isOutputExpanded: boolean =
                            expandedIds.has(commandKey);
                          const approvalPillKind: CommandApprovalPillKind | null =
                            getCommandApprovalPillKind(command, status);

                          return (
                            <li
                              key={commandKey}
                              className="rounded-md border border-gray-100 bg-gray-50 p-3"
                            >
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="text-xs font-medium text-gray-500">
                                  {command.sequence}.
                                </span>
                                <span className="text-xs font-medium text-gray-900">
                                  {command.stepType === RunbookStepType.Kubectl
                                    ? `cluster ${
                                        command.kubernetesClusterNameSnapshot ||
                                        "(unknown)"
                                      }`
                                    : command.runnerNameSnapshot}
                                </span>
                                <span className="inline-flex items-center rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700 ring-1 ring-inset ring-indigo-200">
                                  {command.stepType === RunbookStepType.Kubectl
                                    ? "kubectl"
                                    : command.stepType}
                                </span>
                                {command.kubectlTier ? (
                                  <KubectlTierPill tier={command.kubectlTier} />
                                ) : (
                                  <></>
                                )}
                                {approvalPillKind ? (
                                  <CommandApprovalPill
                                    kind={approvalPillKind}
                                  />
                                ) : (
                                  <></>
                                )}
                                {command.execution ? (
                                  <CommandExecutionPill
                                    status={command.execution.status}
                                  />
                                ) : (
                                  <></>
                                )}
                              </div>

                              <pre className="mt-2 overflow-x-auto rounded border border-gray-200 bg-white px-3 py-2 font-mono text-xs text-gray-800">
                                {command.command}
                              </pre>

                              <div className="mt-2 text-xs text-gray-600">
                                {command.rationale}
                              </div>
                              <div className="mt-1 text-xs text-gray-500">
                                Expected effect: {command.expectedEffect}
                              </div>

                              {command.rollbackCommand ? (
                                <div className="mt-1 text-xs text-gray-500">
                                  Rollback:{" "}
                                  <span className="font-mono text-gray-700">
                                    {command.rollbackCommand}
                                  </span>
                                </div>
                              ) : (
                                <></>
                              )}

                              {command.execution ? (
                                <CommandExecutionDetails
                                  execution={command.execution}
                                  isOutputExpanded={isOutputExpanded}
                                  onToggleOutput={() => {
                                    toggleExpanded(commandKey);
                                  }}
                                />
                              ) : (
                                <></>
                              )}

                              {/*
                               * The undo's own outcome, when the rollback
                               * arm ran (or skipped) it for this command:
                               * "Rollback status" below the plan says how
                               * the rollback as a whole ended, this says
                               * what happened to each undo.
                               */}
                              {command.rollbackExecution ? (
                                <div
                                  className="mt-2 rounded border border-gray-200 bg-white px-2 py-1.5"
                                  data-testid="remediation-rollback-outcome"
                                >
                                  <div className="flex flex-wrap items-center gap-2">
                                    <span className="text-xs font-medium text-gray-700">
                                      Rollback result
                                    </span>
                                    <CommandExecutionPill
                                      status={command.rollbackExecution.status}
                                    />
                                  </div>
                                  {command.rollbackExecution.status ===
                                    AiRemediationCommandExecutionStatus.Skipped &&
                                  !command.rollbackExecution.errorMessage ? (
                                    <div className="mt-1 text-xs text-gray-500">
                                      The undo did not run — undo this change by
                                      hand if it is still needed.
                                    </div>
                                  ) : (
                                    <></>
                                  )}
                                  <CommandExecutionDetails
                                    execution={command.rollbackExecution}
                                    isOutputExpanded={expandedIds.has(
                                      `${commandKey}:rollback`,
                                    )}
                                    onToggleOutput={() => {
                                      toggleExpanded(`${commandKey}:rollback`);
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
                    {plan.executionStatus ? (
                      <div className="mt-2 text-xs text-gray-500">
                        Plan execution: {plan.executionStatus}
                      </div>
                    ) : (
                      <></>
                    )}
                    {plan.rollbackStatus ? (
                      <div className="mt-1 text-xs text-gray-500">
                        Rollback status: {plan.rollbackStatus}
                      </div>
                    ) : (
                      <></>
                    )}
                  </div>
                ) : (
                  <></>
                )}

                {isCommandPlan &&
                !plan &&
                status !== AutoRemediationSuggestionStatus.Planning ? (
                  <div className="mt-3 text-xs text-gray-500">
                    The command plan could not be displayed.
                  </div>
                ) : (
                  <></>
                )}

                <div className="mt-3 flex flex-wrap items-center gap-2">
                  {status === AutoRemediationSuggestionStatus.Suggested ? (
                    <Button
                      title="Approve & Run"
                      icon={IconProp.Check}
                      buttonStyle={ButtonStyleType.SUCCESS_OUTLINE}
                      buttonSize={ButtonSize.Small}
                      disabled={isBusy}
                      isLoading={isBusy && busyAction === "approve"}
                      dataTestId="remediation-approve-button"
                      onClick={() => {
                        performAction(suggestion, "approve").catch(() => {
                          // handled inside performAction
                        });
                      }}
                    />
                  ) : (
                    <></>
                  )}

                  {status === AutoRemediationSuggestionStatus.Suggested ||
                  status === AutoRemediationSuggestionStatus.Planning ? (
                    <Button
                      title="Dismiss"
                      icon={IconProp.Close}
                      buttonStyle={ButtonStyleType.HOVER_DANGER_OUTLINE}
                      buttonSize={ButtonSize.Small}
                      disabled={isBusy}
                      onClick={() => {
                        performAction(suggestion, "dismiss").catch(() => {
                          // handled inside performAction
                        });
                      }}
                    />
                  ) : (
                    <></>
                  )}

                  {!isCommandPlan &&
                  (status === AutoRemediationSuggestionStatus.Approved ||
                    status === AutoRemediationSuggestionStatus.AutoExecuted) &&
                  suggestion.runbookId &&
                  suggestion.runbookExecutionId ? (
                    <Button
                      title="View Execution"
                      icon={IconProp.List}
                      buttonStyle={ButtonStyleType.OUTLINE}
                      buttonSize={ButtonSize.Small}
                      onClick={() => {
                        Navigation.navigate(
                          RouteUtil.populateRouteParams(
                            RouteMap[PageMap.RUNBOOK_VIEW_EXECUTION] as Route,
                            {
                              modelId: suggestion.runbookId!,
                              subModelId:
                                suggestion.runbookExecutionId!.toString(),
                            },
                          ),
                        );
                      }}
                    />
                  ) : (
                    <></>
                  )}
                </div>
              </div>
            );
          },
        )}
      </div>
    </Card>
  );
};

export default RemediationSuggestionCard;
