import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import { JSONObject } from "Common/Types/JSON";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import AutoRemediationSuggestion from "Common/Models/DatabaseModels/AutoRemediationSuggestion";
import AutoRemediationSuggestionStatus from "Common/Types/AutoRemediation/AutoRemediationSuggestionStatus";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import MarkdownViewer from "Common/UI/Components/Markdown.tsx/MarkdownViewer";
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
    (s: AutoRemediationSuggestion) => {
      return s.status === AutoRemediationSuggestionStatus.Planning;
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

            return (
              <div
                key={suggestionId}
                className="rounded-md border border-gray-200 p-4"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-col">
                    <span className="text-sm font-medium text-gray-900">
                      {suggestion.runbookNameSnapshot ||
                        (status === AutoRemediationSuggestionStatus.Planning
                          ? "Picking the best runbook…"
                          : "No runbook")}
                    </span>
                    <span className="text-xs text-gray-500">
                      Rule: {suggestion.ruleNameSnapshot || "Unknown"}
                    </span>
                  </div>
                  <StatusPill status={status} />
                </div>

                {suggestion.rationaleMarkdown ? (
                  <div className="mt-3">
                    <button
                      type="button"
                      className="text-xs font-medium text-indigo-600 hover:text-indigo-500"
                      onClick={() => {
                        setExpandedIds((prev: Set<string>) => {
                          const next: Set<string> = new Set<string>(prev);
                          if (next.has(suggestionId)) {
                            next.delete(suggestionId);
                          } else {
                            next.add(suggestionId);
                          }
                          return next;
                        });
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

                  {(status === AutoRemediationSuggestionStatus.Approved ||
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
