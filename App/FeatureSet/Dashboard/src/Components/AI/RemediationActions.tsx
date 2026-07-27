import RunbookAgentEnvironmentBadge from "../RunbookAgent/EnvironmentBadge";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import AIRemediationAction from "Common/Models/DatabaseModels/AIRemediationAction";
import Runbook from "Common/Models/DatabaseModels/Runbook";
import RunbookAgent from "Common/Models/DatabaseModels/RunbookAgent";
import AIRemediationActionStatus from "Common/Types/AI/AIRemediationActionStatus";
import AIRemediationActionType from "Common/Types/AI/AIRemediationActionType";
import AIRemediationDecisionMode from "Common/Types/AI/AIRemediationDecisionMode";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import Includes from "Common/Types/BaseDatabase/Includes";
import Query from "Common/Types/BaseDatabase/Query";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import BasicFormModal from "Common/UI/Components/FormModal/BasicFormModal";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

export type RemediationSubjectType = "incident" | "alert";

export interface ComponentProps {
  subjectType: RemediationSubjectType;
  subjectId: ObjectID;
  // Poll while the investigation is live so proposals appear as they land.
  isInvestigationActive: boolean;
  // True when the latest investigation run finished with status Completed.
  isInvestigationCompleted: boolean;
  /*
   * When that run completed (from the run payload). Drives the
   * post-completion grace window below — proposals are persisted by
   * trailing server work AFTER the run flips to Completed, so a live
   * viewer needs a bounded window of continued polling to see them land.
   */
  investigationCompletedAt?: Date | undefined;
}

// Same cadence the investigation panel itself polls on.
const POLL_INTERVAL_MS: number = 2500;

/*
 * After the run completes, the server still makes two trailing LLM calls
 * (confidence classification, then the remediation proposal call) before
 * persisting any actions. Keep polling — at a slightly slower cadence —
 * for a bounded grace window after completion, or until the first
 * non-empty action list arrives, whichever comes first. Outside this
 * window a Proposed-only list deliberately does not poll (approve/reject
 * refetch, and the server sweeps stale proposals to Expired on its own).
 */
const POST_COMPLETION_GRACE_WINDOW_MS: number = 5 * 60 * 1000;
const GRACE_POLL_INTERVAL_MS: number = 5000;

// Human labels for the wire-contract enum values.
const ACTION_TYPE_LABELS: Record<AIRemediationActionType, string> = {
  [AIRemediationActionType.Runbook]: "Runbook",
  [AIRemediationActionType.Command]: "Command",
};

/*
 * Proposed is the attention state (amber), Approved/Executing are in-flight
 * (blue), Succeeded is calm green, Failed is red, and the two "nothing will
 * ever run" terminal states (Rejected/Expired) stay gray.
 */
const STATUS_BADGE_CLASSES: Record<AIRemediationActionStatus, string> = {
  [AIRemediationActionStatus.Proposed]:
    "bg-amber-50 text-amber-700 ring-amber-600/20",
  [AIRemediationActionStatus.Approved]:
    "bg-blue-50 text-blue-700 ring-blue-600/20",
  [AIRemediationActionStatus.Executing]:
    "bg-blue-50 text-blue-700 ring-blue-600/20",
  [AIRemediationActionStatus.Succeeded]:
    "bg-green-50 text-green-700 ring-green-600/20",
  [AIRemediationActionStatus.Failed]: "bg-red-50 text-red-700 ring-red-600/20",
  [AIRemediationActionStatus.Rejected]:
    "bg-gray-100 text-gray-600 ring-gray-500/20",
  [AIRemediationActionStatus.Expired]:
    "bg-gray-100 text-gray-600 ring-gray-500/20",
};

/*
 * Approved is strictly transient — the executor either moves it to
 * Executing immediately or reverts it to Proposed on a budget/cap refusal
 * — so its pill reads as motion, never as a resting state.
 */
const STATUS_LABELS: Record<AIRemediationActionStatus, string> = {
  [AIRemediationActionStatus.Proposed]: "Proposed",
  [AIRemediationActionStatus.Approved]: "Approved — starting…",
  [AIRemediationActionStatus.Executing]: "Executing",
  [AIRemediationActionStatus.Succeeded]: "Succeeded",
  [AIRemediationActionStatus.Failed]: "Failed",
  [AIRemediationActionStatus.Rejected]: "Rejected",
  [AIRemediationActionStatus.Expired]: "Expired",
};

const STATUS_DOT_CLASSES: Record<AIRemediationActionStatus, string> = {
  [AIRemediationActionStatus.Proposed]: "bg-amber-500",
  [AIRemediationActionStatus.Approved]: "bg-blue-500",
  [AIRemediationActionStatus.Executing]: "bg-blue-500",
  [AIRemediationActionStatus.Succeeded]: "bg-green-500",
  [AIRemediationActionStatus.Failed]: "bg-red-500",
  [AIRemediationActionStatus.Rejected]: "bg-gray-400",
  [AIRemediationActionStatus.Expired]: "bg-gray-400",
};

export function getRemediationStatusElement(
  status: AIRemediationActionStatus | undefined,
): ReactElement {
  if (!status) {
    return <></>;
  }
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${
        STATUS_BADGE_CLASSES[status] ||
        "bg-gray-100 text-gray-600 ring-gray-500/20"
      }`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${
          STATUS_DOT_CLASSES[status] || "bg-gray-400"
        }`}
      />
      {STATUS_LABELS[status] || status}
    </span>
  );
}

export function getRemediationActionTypeElement(
  actionType: AIRemediationActionType | undefined,
): ReactElement {
  if (!actionType) {
    return <></>;
  }
  return (
    <span className="inline-flex items-center rounded-full bg-indigo-50 px-2 py-0.5 text-xs font-medium text-indigo-700 ring-1 ring-inset ring-indigo-600/20">
      {ACTION_TYPE_LABELS[actionType] || actionType}
    </span>
  );
}

interface AgentMeta {
  name: string;
  environmentType: string | undefined;
}

/*
 * The "Remediation" section of the AI investigation panel: the structured
 * remediation actions AI proposed from its completed analysis, newest first,
 * each with its policy decision, target, approve/reject controls and
 * execution outcome. Renders nothing until at least one action exists, so
 * projects that never enabled the remediation lane never see it. The server
 * is the authority on every transition — this component only surfaces the
 * refusal messages it returns (budget exhausted, proposal expired, already
 * decided).
 */
const RemediationActions: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [actions, setActions] = useState<Array<AIRemediationAction>>([]);
  const [hasLoadedOnce, setHasLoadedOnce] = useState<boolean>(false);

  // Per-action inline errors (the 400 refusal messages from approve/reject).
  const [actionErrors, setActionErrors] = useState<Record<string, string>>({});
  const [busyActionId, setBusyActionId] = useState<string | null>(null);

  // Reject-with-optional-reason modal state.
  const [rejectTarget, setRejectTarget] = useState<AIRemediationAction | null>(
    null,
  );
  const [isRejecting, setIsRejecting] = useState<boolean>(false);
  const [rejectError, setRejectError] = useState<string | null>(null);

  /*
   * Target names resolved out-of-band (the action row only stores ids).
   * Kept in refs so resolving them never rebuilds the fetch callback — a
   * version bump re-renders once the names land. A target deleted since the
   * proposal simply keeps showing its id.
   */
  const runbookNamesRef: React.MutableRefObject<Record<string, string>> =
    useRef<Record<string, string>>({});
  const agentMetaRef: React.MutableRefObject<Record<string, AgentMeta>> =
    useRef<Record<string, AgentMeta>>({});
  const [, setTargetVersion] = useState<number>(0);

  const resolveTargets: (items: Array<AIRemediationAction>) => Promise<void> =
    useCallback(async (items: Array<AIRemediationAction>): Promise<void> => {
      const missingRunbookIds: Array<ObjectID> = [];
      const missingAgentIds: Array<ObjectID> = [];

      for (const item of items) {
        const runbookId: string | undefined = item.runbookId?.toString();
        if (
          runbookId &&
          !runbookNamesRef.current[runbookId] &&
          !missingRunbookIds.some((id: ObjectID) => {
            return id.toString() === runbookId;
          })
        ) {
          missingRunbookIds.push(new ObjectID(runbookId));
        }

        const agentId: string | undefined = item.runbookAgentId?.toString();
        if (
          agentId &&
          !agentMetaRef.current[agentId] &&
          !missingAgentIds.some((id: ObjectID) => {
            return id.toString() === agentId;
          })
        ) {
          missingAgentIds.push(new ObjectID(agentId));
        }
      }

      if (missingRunbookIds.length === 0 && missingAgentIds.length === 0) {
        return;
      }

      let didResolveAny: boolean = false;

      if (missingRunbookIds.length > 0) {
        try {
          const runbooks: ListResult<Runbook> = await ModelAPI.getList<Runbook>(
            {
              modelType: Runbook,
              query: {
                _id: new Includes(missingRunbookIds),
              },
              limit: LIMIT_PER_PROJECT,
              skip: 0,
              select: {
                _id: true,
                name: true,
              },
              sort: {
                name: SortOrder.Ascending,
              },
            },
          );

          for (const runbook of runbooks.data) {
            if (runbook.id && runbook.name) {
              runbookNamesRef.current[runbook.id.toString()] = runbook.name;
              didResolveAny = true;
            }
          }
        } catch {
          // Best-effort — the id renders instead.
        }
      }

      if (missingAgentIds.length > 0) {
        try {
          const agents: ListResult<RunbookAgent> =
            await ModelAPI.getList<RunbookAgent>({
              modelType: RunbookAgent,
              query: {
                _id: new Includes(missingAgentIds),
              },
              limit: LIMIT_PER_PROJECT,
              skip: 0,
              select: {
                _id: true,
                name: true,
                environmentType: true,
              },
              sort: {
                name: SortOrder.Ascending,
              },
            });

          for (const agent of agents.data) {
            if (agent.id && agent.name) {
              agentMetaRef.current[agent.id.toString()] = {
                name: agent.name,
                environmentType: agent.environmentType,
              };
              didResolveAny = true;
            }
          }
        } catch {
          // Best-effort — the id renders instead.
        }
      }

      if (didResolveAny) {
        setTargetVersion((version: number) => {
          return version + 1;
        });
      }
    }, []);

  const fetchActions: () => Promise<void> =
    useCallback(async (): Promise<void> => {
      try {
        const query: Query<AIRemediationAction> =
          props.subjectType === "incident"
            ? { incidentId: props.subjectId }
            : { alertId: props.subjectId };

        const result: ListResult<AIRemediationAction> =
          await ModelAPI.getList<AIRemediationAction>({
            modelType: AIRemediationAction,
            query: query,
            limit: 25,
            skip: 0,
            select: {
              _id: true,
              actionType: true,
              title: true,
              rationale: true,
              runbookId: true,
              runbookAgentId: true,
              commandScript: true,
              status: true,
              decisionMode: true,
              errorMessage: true,
              rejectionReason: true,
              runbookExecutionId: true,
              expiresAt: true,
              createdAt: true,
            },
            sort: {
              createdAt: SortOrder.Descending,
            },
          });

        setActions(result.data);
        await resolveTargets(result.data);
      } catch {
        // Best-effort section — never surface a fetch error here.
      }

      setHasLoadedOnce(true);
    }, [props.subjectType, props.subjectId, resolveTargets]);

  useEffect(() => {
    fetchActions().catch(() => {
      // handled inside fetchActions
    });
  }, [fetchActions]);

  /*
   * Post-completion grace window (epoch ms deadline, or null when no
   * window is open). Opened when the run completed within the last
   * POST_COMPLETION_GRACE_WINDOW_MS — covering both the live transition
   * from active to Completed and mounting onto a recently-completed run —
   * so the trailing proposal write lands without a page reload.
   */
  const [graceDeadlineMs, setGraceDeadlineMs] = useState<number | null>(null);
  const wasActiveRef: React.MutableRefObject<boolean> = useRef<boolean>(
    props.isInvestigationActive,
  );

  // Primitive so effect deps ignore the Date object's identity.
  const completedAtMs: number | null = props.investigationCompletedAt
    ? props.investigationCompletedAt.getTime()
    : null;

  useEffect(() => {
    const wasActive: boolean = wasActiveRef.current;
    wasActiveRef.current = props.isInvestigationActive;

    if (props.isInvestigationActive) {
      // A live (re)run supersedes any grace window — live polling covers it.
      setGraceDeadlineMs(null);
      return;
    }

    if (!props.isInvestigationCompleted) {
      // Failed/stopped runs never get trailing proposals.
      return;
    }

    /*
     * Prefer the server's completedAt (which also recognizes a recently
     * completed run on mount); if it is somehow missing, fall back to
     * "we just watched the run finish".
     */
    const graceStartMs: number | null =
      completedAtMs !== null ? completedAtMs : wasActive ? Date.now() : null;

    if (graceStartMs === null) {
      return;
    }

    const deadlineMs: number = graceStartMs + POST_COMPLETION_GRACE_WINDOW_MS;

    if (deadlineMs <= Date.now()) {
      /*
       * Long-completed run: keep the deliberate no-poll behavior for
       * stale Proposed-only lists.
       */
      return;
    }

    setGraceDeadlineMs(deadlineMs);
  }, [
    props.isInvestigationActive,
    props.isInvestigationCompleted,
    completedAtMs,
  ]);

  // Close the grace window the moment its deadline passes.
  useEffect(() => {
    if (graceDeadlineMs === null) {
      return;
    }

    const remainingMs: number = graceDeadlineMs - Date.now();

    if (remainingMs <= 0) {
      setGraceDeadlineMs(null);
      return;
    }

    const timeout: ReturnType<typeof setTimeout> = setTimeout(() => {
      setGraceDeadlineMs(null);
    }, remainingMs);

    return () => {
      return clearTimeout(timeout);
    };
  }, [graceDeadlineMs]);

  /*
   * Poll while proposals can still appear (the investigation is live, or
   * it just completed and the trailing proposal write has not landed yet)
   * or an approved action is executing and we are waiting on its outcome.
   * Actions sitting in Proposed do not need polling — the approve/reject
   * buttons refetch, and the server sweeps stale proposals to Expired on
   * its own.
   */
  const hasInFlightExecution: boolean = actions.some(
    (action: AIRemediationAction) => {
      return (
        action.status === AIRemediationActionStatus.Approved ||
        action.status === AIRemediationActionStatus.Executing
      );
    },
  );

  // The grace window only matters until the first non-empty list arrives.
  const isAwaitingFirstProposals: boolean =
    graceDeadlineMs !== null && actions.length === 0;

  const shouldPoll: boolean =
    props.isInvestigationActive ||
    hasInFlightExecution ||
    isAwaitingFirstProposals;

  // The grace window polls a touch slower than the live investigation.
  const pollIntervalMs: number =
    props.isInvestigationActive || hasInFlightExecution
      ? POLL_INTERVAL_MS
      : GRACE_POLL_INTERVAL_MS;

  useEffect(() => {
    if (!shouldPoll) {
      return;
    }

    const interval: ReturnType<typeof setInterval> = setInterval(() => {
      fetchActions().catch(() => {
        // handled inside fetchActions
      });
    }, pollIntervalMs);

    return () => {
      return clearInterval(interval);
    };
  }, [shouldPoll, pollIntervalMs, fetchActions]);

  /*
   * "Approve & Execute": the server re-checks everything (lane enabled,
   * proposal not expired, daily budget, per-subject cap) and refuses with a
   * human-readable 400 when it will not run — shown inline on the action.
   */
  const approveAction: (action: AIRemediationAction) => Promise<void> =
    useCallback(
      async (action: AIRemediationAction): Promise<void> => {
        const actionId: string = action.id?.toString() || "";

        setBusyActionId(actionId);
        setActionErrors((current: Record<string, string>) => {
          const next: Record<string, string> = { ...current };
          delete next[actionId];
          return next;
        });

        try {
          const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
            await API.post<JSONObject>({
              url: URL.fromString(
                APP_API_URL.toString() + "/ai-remediation/approve",
              ),
              data: { aiRemediationActionId: actionId },
              headers: ModelAPI.getCommonHeaders(),
            });

          if (response instanceof HTTPErrorResponse) {
            throw response;
          }
        } catch (err) {
          setActionErrors((current: Record<string, string>) => {
            return { ...current, [actionId]: API.getFriendlyMessage(err) };
          });
        }

        setBusyActionId(null);

        // Refetch either way — the server state is the source of truth.
        fetchActions().catch(() => {
          // handled inside fetchActions
        });
      },
      [fetchActions],
    );

  const rejectAction: (
    action: AIRemediationAction,
    reason: string | undefined,
  ) => Promise<void> = useCallback(
    async (
      action: AIRemediationAction,
      reason: string | undefined,
    ): Promise<void> => {
      const actionId: string = action.id?.toString() || "";

      setIsRejecting(true);
      setRejectError(null);

      try {
        const data: JSONObject = { aiRemediationActionId: actionId };
        if (reason) {
          data["reason"] = reason;
        }

        const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
          await API.post<JSONObject>({
            url: URL.fromString(
              APP_API_URL.toString() + "/ai-remediation/reject",
            ),
            data: data,
            headers: ModelAPI.getCommonHeaders(),
          });

        if (response instanceof HTTPErrorResponse) {
          throw response;
        }

        setRejectTarget(null);

        fetchActions().catch(() => {
          // handled inside fetchActions
        });
      } catch (err) {
        // Keep the modal open so the reason is not lost on a refusal.
        setRejectError(API.getFriendlyMessage(err));
      }

      setIsRejecting(false);
    },
    [fetchActions],
  );

  // Nothing to show until the remediation lane produced something.
  if (!hasLoadedOnce || actions.length === 0) {
    return <></>;
  }

  type GetActionCardFunction = (action: AIRemediationAction) => ReactElement;

  const getActionCard: GetActionCardFunction = (
    action: AIRemediationAction,
  ): ReactElement => {
    const actionId: string = action.id?.toString() || "";
    const runbookId: string | undefined = action.runbookId?.toString();
    const agentId: string | undefined = action.runbookAgentId?.toString();
    const agentMeta: AgentMeta | undefined = agentId
      ? agentMetaRef.current[agentId]
      : undefined;

    const isExpired: boolean = Boolean(
      action.expiresAt && OneUptimeDate.isInThePast(action.expiresAt),
    );
    const canDecide: boolean =
      action.status === AIRemediationActionStatus.Proposed && !isExpired;

    return (
      <div
        key={actionId}
        className="rounded-lg border border-gray-200 bg-gray-50 p-3"
      >
        <div className="flex flex-wrap items-center gap-1.5">
          {getRemediationActionTypeElement(action.actionType)}
          {getRemediationStatusElement(action.status)}
          {action.decisionMode === AIRemediationDecisionMode.AutoApproved ? (
            <span className="text-xs text-gray-400">
              auto-approved: non-production
            </span>
          ) : (
            <></>
          )}
        </div>

        <h4 className="mt-2 text-sm font-semibold text-gray-900">
          {action.title}
        </h4>

        {action.rationale ? (
          <p className="mt-1 text-sm text-gray-600">{action.rationale}</p>
        ) : (
          <></>
        )}

        {action.actionType === AIRemediationActionType.Runbook ? (
          <p className="mt-2 text-xs text-gray-500">
            Runbook:{" "}
            <span className="font-medium text-gray-700">
              {(runbookId && runbookNamesRef.current[runbookId]) || runbookId}
            </span>
          </p>
        ) : (
          <></>
        )}

        {action.actionType === AIRemediationActionType.Command ? (
          <>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-gray-500">
              <span>Agent:</span>
              <span className="font-medium text-gray-700">
                {agentMeta?.name || agentId}
              </span>
              <RunbookAgentEnvironmentBadge
                environmentType={agentMeta?.environmentType}
              />
            </div>
            {action.commandScript ? (
              /*
               * The exact script that would run, verbatim — what you
               * approve is what executes.
               */
              <pre className="mt-2 overflow-x-auto rounded-md bg-gray-900 p-3 font-mono text-xs text-gray-100">
                <code>{action.commandScript}</code>
              </pre>
            ) : (
              <></>
            )}
          </>
        ) : (
          <></>
        )}

        {action.status === AIRemediationActionStatus.Rejected &&
        action.rejectionReason ? (
          <p className="mt-2 text-xs text-gray-500">
            Rejection reason: {action.rejectionReason}
          </p>
        ) : (
          <></>
        )}

        {/*
          errorMessage never implies Failed. On a budget/per-subject-cap
          refusal the server CAS-reverts the approval back to Proposed and
          stores the human-readable reason on errorMessage — so a Proposed
          action carrying one gets an amber "here is why your earlier
          approval did not run" note while Approve/Reject stay available
          (that is the point of the revert). Any other status with an
          errorMessage is a real execution failure and stays red. The note
          is skipped when the identical inline 400 message from the approve
          attempt is already showing right below.
        */}
        {action.errorMessage &&
        action.status === AIRemediationActionStatus.Proposed ? (
          actionErrors[actionId] === action.errorMessage ? (
            <></>
          ) : (
            <p className="mt-2 text-xs text-amber-600">
              Last approval attempt: {action.errorMessage}
            </p>
          )
        ) : action.errorMessage ? (
          <p className="mt-2 text-xs text-red-500">{action.errorMessage}</p>
        ) : (
          <></>
        )}

        {actionErrors[actionId] ? (
          <p className="mt-2 text-xs text-red-500">{actionErrors[actionId]}</p>
        ) : (
          <></>
        )}

        {action.runbookExecutionId && action.runbookId ? (
          <div className="mt-2">
            <Link
              to={RouteUtil.populateRouteParams(
                RouteMap[PageMap.RUNBOOK_VIEW_EXECUTION] as Route,
                {
                  modelId: action.runbookId,
                  subModelId: action.runbookExecutionId,
                },
              )}
              className="inline-flex items-center gap-1 text-xs font-medium text-indigo-600 hover:text-indigo-500"
            >
              <span>View runbook execution</span>
              <Icon icon={IconProp.ArrowRight} className="h-3.5 w-3.5" />
            </Link>
          </div>
        ) : (
          <></>
        )}

        {canDecide ? (
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button
              title="Approve & Execute"
              icon={IconProp.Check}
              buttonStyle={ButtonStyleType.SUCCESS_OUTLINE}
              buttonSize={ButtonSize.Small}
              isLoading={busyActionId === actionId}
              disabled={busyActionId !== null}
              onClick={() => {
                approveAction(action).catch(() => {
                  // handled inside approveAction
                });
              }}
            />
            <Button
              title="Reject"
              icon={IconProp.Close}
              buttonStyle={ButtonStyleType.HOVER_DANGER_OUTLINE}
              buttonSize={ButtonSize.Small}
              disabled={busyActionId !== null}
              onClick={() => {
                setRejectError(null);
                setRejectTarget(action);
              }}
            />
          </div>
        ) : (
          <></>
        )}
      </div>
    );
  };

  return (
    <div className="mt-5 border-t border-gray-100 pt-4">
      <div className="flex items-center gap-2 text-sm font-medium text-gray-900">
        <Icon icon={IconProp.Bolt} className="h-4 w-4 text-indigo-500" />
        <span>Remediation</span>
      </div>
      <p className="mt-1 text-xs text-gray-400">
        Remediation actions AI proposed from this analysis. Runbook actions
        start a runbook you already wrote; drafted commands always require your
        approval before anything runs.
      </p>

      <div className="mt-3 space-y-3">
        {actions.map((action: AIRemediationAction) => {
          return getActionCard(action);
        })}
      </div>

      {rejectTarget ? (
        <BasicFormModal<JSONObject>
          title="Reject Remediation Action"
          description={`"${
            rejectTarget.title || "This action"
          }" will be marked Rejected and will never execute.`}
          submitButtonText="Reject Action"
          submitButtonStyleType={ButtonStyleType.DANGER}
          isLoading={isRejecting}
          error={rejectError || undefined}
          onClose={() => {
            setRejectTarget(null);
            setRejectError(null);
          }}
          onSubmit={(data: JSONObject) => {
            rejectAction(
              rejectTarget,
              (data["reason"] as string | undefined) || undefined,
            ).catch(() => {
              // handled inside rejectAction
            });
          }}
          formProps={{
            fields: [
              {
                field: {
                  reason: true,
                },
                title: "Reason (optional)",
                description:
                  "Recorded on the action's audit trail so the team knows why this was not the right call.",
                fieldType: FormFieldSchemaType.LongText,
                required: false,
                placeholder: "Why is this not the right action?",
              },
            ],
          }}
        />
      ) : (
        <></>
      )}
    </div>
  );
};

export default RemediationActions;
