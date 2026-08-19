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
  AiRemediationCommandExecutionStatus,
  AiRemediationCommandPlan,
  AiRemediationCommandPlanUtil,
  AiRemediationCommandPolicyVerdict,
  AiRemediationPlanExecutionStatus,
} from "Common/Types/AutoRemediation/AiRemediationCommandPlan";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
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
}: {
  status: AutoRemediationSuggestionStatus;
}): ReactElement {
  const v: StatusVisual =
    STATUS_VISUAL[status] ||
    STATUS_VISUAL[AutoRemediationSuggestionStatus.Planning]!;
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

interface VerdictVisual {
  label: string;
  badge: string;
  dot: string;
}

const VERDICT_VISUAL: Record<AiRemediationCommandPolicyVerdict, VerdictVisual> =
  {
    [AiRemediationCommandPolicyVerdict.AutoApproved]: {
      label: "allowlisted",
      badge: "bg-emerald-50 text-emerald-700 ring-emerald-200",
      dot: "bg-emerald-500",
    },
    [AiRemediationCommandPolicyVerdict.RequiresApproval]: {
      label: "needs approval",
      badge: "bg-amber-50 text-amber-700 ring-amber-200",
      dot: "bg-amber-500",
    },
    // Denied commands are never stored in a plan — entry exists only to satisfy the Record type.
    [AiRemediationCommandPolicyVerdict.Denied]: {
      label: "denied",
      badge: "bg-rose-50 text-rose-700 ring-rose-200",
      dot: "bg-rose-500",
    },
  };

function PolicyVerdictPill({
  verdict,
}: {
  verdict: AiRemediationCommandPolicyVerdict;
}): ReactElement {
  const v: VerdictVisual =
    VERDICT_VISUAL[verdict] ||
    VERDICT_VISUAL[AiRemediationCommandPolicyVerdict.RequiresApproval]!;
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

const POLL_INTERVAL_MS: number = 15 * 1000;

const RemediationSuggestionCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [suggestions, setSuggestions] = useState<
    Array<AutoRemediationSuggestion>
  >([]);
  const [isLoaded, setIsLoaded] = useState<boolean>(false);
  const [actionError, setActionError] = useState<string>("");
  const [busySuggestionId, setBusySuggestionId] = useState<string>("");
  const [expandedIds, setExpandedIds] = useState<Set<string>>(
    new Set<string>(),
  );
  const isBusyRef: React.MutableRefObject<boolean> = useRef<boolean>(false);

  const incidentIdString: string | undefined = props.incidentId?.toString();
  const alertIdString: string | undefined = props.alertId?.toString();

  const load: () => Promise<void> = useCallback(async (): Promise<void> => {
    // Don't clobber the list while an approve/dismiss is in flight.
    if (isBusyRef.current) {
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
  }, [incidentIdString, alertIdString]);

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
    action: "approve" | "dismiss",
  ) => Promise<void> = async (
    suggestion: AutoRemediationSuggestion,
    action: "approve" | "dismiss",
  ): Promise<void> => {
    const suggestionId: string | undefined = suggestion.id?.toString();
    if (!suggestionId) {
      return;
    }

    setActionError("");
    setBusySuggestionId(suggestionId);
    isBusyRef.current = true;

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
      setActionError(API.getFriendlyMessage(err));
    } finally {
      setBusySuggestionId("");
      isBusyRef.current = false;
    }

    await load();
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
      title="Proposed Remediation"
      description="Runbooks proposed or started by auto-remediation rules. Approving starts the runbook under your name."
    >
      <div className="flex flex-col gap-4">
        {actionError ? (
          <Alert
            type={AlertType.DANGER}
            strongTitle="Could not save your action"
            title={actionError}
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
            const title: string = isCommandPlan
              ? "AI Command Plan"
              : runbookTitle;

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
                    <span className="text-xs text-gray-500">
                      Rule: {suggestion.ruleNameSnapshot || "Unknown"}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <StatusPill status={status} />
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
                                  {command.runnerNameSnapshot}
                                </span>
                                <span className="inline-flex items-center rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700 ring-1 ring-inset ring-indigo-200">
                                  {command.stepType}
                                </span>
                                <PolicyVerdictPill
                                  verdict={command.policyVerdict}
                                />
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
                                <div className="mt-2">
                                  {typeof command.execution.exitCode ===
                                  "number" ? (
                                    <div className="text-xs text-gray-500">
                                      Exit code: {command.execution.exitCode}
                                    </div>
                                  ) : (
                                    <></>
                                  )}
                                  {command.execution.errorMessage ? (
                                    <div className="mt-1 text-xs text-rose-600">
                                      {command.execution.errorMessage}
                                    </div>
                                  ) : (
                                    <></>
                                  )}
                                  {command.execution.output ? (
                                    <div className="mt-1">
                                      <button
                                        type="button"
                                        className="text-xs font-medium text-indigo-600 hover:text-indigo-500"
                                        onClick={() => {
                                          toggleExpanded(commandKey);
                                        }}
                                      >
                                        {isOutputExpanded
                                          ? "Hide output"
                                          : "Show output"}
                                      </button>
                                      {isOutputExpanded ? (
                                        <pre className="mt-1 max-h-64 overflow-auto rounded border border-gray-200 bg-white px-3 py-2 font-mono text-xs text-gray-800">
                                          {command.execution.output}
                                        </pre>
                                      ) : (
                                        <></>
                                      )}
                                    </div>
                                  ) : (
                                    <></>
                                  )}
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
