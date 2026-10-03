import PageComponentProps from "../../../PageComponentProps";
import PageMap from "../../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../../Utils/RouteMap";
import {
  canReadKubectlJobs,
  getKubectlJobsPermissionTitles,
} from "../../Utils/KubernetesAiAccessPermissions";
import {
  getAutomaticInvestigation,
  parseStatus,
} from "../../Utils/KubernetesAiAgentStatus";
import AIRunStatus from "Common/Types/AI/AIRunStatus";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import AutoRemediationSuggestionStatus from "Common/Types/AutoRemediation/AutoRemediationSuggestionStatus";
import AutoRemediationSuggestionType from "Common/Types/AutoRemediation/AutoRemediationSuggestionType";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import Color from "Common/Types/Color";
import { Gray500, Green500, Red500, Yellow500 } from "Common/Types/BrandColors";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import {
  KubernetesAiAutomaticInvestigationSettings,
  KubernetesClusterAiAccessStatus,
} from "Common/Types/Kubernetes/KubernetesClusterAiAccess";
import ObjectID from "Common/Types/ObjectID";
import RunbookStepType from "Common/Types/Runbook/RunbookStepType";
import RunnerJobOrigin from "Common/Types/Runbook/RunnerJobOrigin";
import RunnerJobStatus from "Common/Types/Runbook/RunnerJobStatus";
import RunnerJob from "Common/Models/DatabaseModels/RunnerJob";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import DropdownUtil from "Common/UI/Utils/Dropdown";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Card from "Common/UI/Components/Card/Card";
import EmptyState from "Common/UI/Components/EmptyState/EmptyState";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ModelTable from "Common/UI/Components/ModelTable/ModelTable";
import Pill from "Common/UI/Components/Pill/Pill";
import FieldType from "Common/UI/Components/Types/FieldType";
import React, {
  Fragment,
  FunctionComponent,
  MutableRefObject,
  ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useParams } from "react-router-dom";
import useTranslator from "Common/UI/Utils/UseTranslator";
import {
  translatableTerm,
  translateTemplate,
  translateTerm,
  translationKey,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";

/*
 * The cluster's AI Insights page: what OneUptime AI investigated and changed
 * on this cluster, newest first — the incidents and alerts it investigated
 * (with the one-line finding), the fixes it proposed or applied, and every
 * kubectl command it ran here.
 *
 * The first two lists come from POST /kubernetes-cluster/ai-access/insights,
 * which the server computes (summaries only, never command output) behind
 * the same read gate as the cluster's AI status. The command history is the
 * RunnerJob table the old AI page showed, moved here unchanged, with the
 * same permission fallback. No KPI tiles: on most clusters they would read
 * zero.
 */

export const AI_INSIGHTS_PAGE_TITLE: string = "AI Insights";

export const AI_INSIGHTS_PAGE_SUBTITLE: string =
  "What OneUptime AI investigated and changed on this cluster.";

export const AI_INSIGHTS_EMPTY_TITLE: string = "Nothing yet";

export const AI_INSIGHTS_EMPTY_DESCRIPTION: string =
  "When an incident or alert on this cluster is investigated, the findings, proposed fixes and every kubectl command appear here.";

export const KUBECTL_JOBS_TABLE_PREFERENCES_KEY: string =
  "kubernetes-cluster-ai-kubectl-jobs";

export const KUBECTL_COMMANDS_CARD_TITLE: string = "kubectl commands";

export const KUBECTL_COMMANDS_CARD_DESCRIPTION: string =
  "Every kubectl command OneUptime AI ran on this cluster — while investigating (read-only), for fixes, and for connection tests — with its result.";

export const KUBECTL_COMMANDS_EMPTY_MESSAGE: string =
  "OneUptime AI has not run any kubectl commands on this cluster yet.";

/*
 * The "Why" filter of the commands table, in the reader's words. Only the
 * two AI origins ever carry a Kubectl step; runbook steps are not kubectl.
 */
export const KUBECTL_JOB_ORIGIN_LABELS: Record<
  Extract<
    RunnerJobOrigin,
    RunnerJobOrigin.AiInvestigation | RunnerJobOrigin.AiRemediation
  >,
  string
> = {
  [RunnerJobOrigin.AiInvestigation]: "Investigation or connection test",
  [RunnerJobOrigin.AiRemediation]: "Fix",
};

/*
 * One row's "Why". An AiInvestigation job without an AI run is the AI agent
 * page's connection test (kubectl version, auth can-i --list), which spends
 * the same read-only access.
 */
export function describeKubectlJobOrigin(job: {
  origin?: string | undefined;
  aiRunId?: unknown;
}): string {
  const origin: string = String(job.origin || "");

  if (origin === RunnerJobOrigin.AiInvestigation) {
    return job.aiRunId
      ? "Investigation (read-only)"
      : "Connection test (read-only)";
  }

  if (origin === RunnerJobOrigin.AiRemediation) {
    return "Fix";
  }

  return origin;
}

/*
 * The rows below are the page's normalised reading of the route's body
 * (Common/Types/Kubernetes/KubernetesClusterAiInsights.ts): every field the
 * contract leaves optional is null here when it is missing or unreadable.
 */

// What the insights route returns for one investigation (an AI run).
export interface KubernetesAiInsightsInvestigation {
  aiRunId: string;
  // AIRunStatus; null when the server did not say.
  status: string | null;
  analysisTldr: string | null;
  createdAt: string | null;
  completedAt: string | null;
  incident: { id: string; title: string; number: number | null } | null;
  alert: { id: string; title: string } | null;
}

// What the insights route returns for one fix (an auto-remediation suggestion).
export interface KubernetesAiInsightsFix {
  id: string;
  // AutoRemediationSuggestionStatus; null when the server did not say.
  status: string | null;
  executionMode: string | null;
  suggestionType: string | null;
  rationale: string | null;
  createdAt: string | null;
  incidentId: string | null;
  alertId: string | null;
  approvedAt: string | null;
}

export interface KubernetesAiInsights {
  investigations: Array<KubernetesAiInsightsInvestigation>;
  fixes: Array<KubernetesAiInsightsFix>;
}

function isObject(value: unknown): value is JSONObject {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

/*
 * A string the server may have sent bare or in its serialized
 * { _type, value } envelope (ObjectID, DateTime). Anything else — a number,
 * an empty string, an object without a string value — is no value.
 */
function readString(value: unknown): string | null {
  if (typeof value === "string") {
    return value.trim() ? value : null;
  }

  if (isObject(value) && typeof value["value"] === "string") {
    return value["value"].trim() ? value["value"] : null;
  }

  return null;
}

function parseInvestigation(
  value: unknown,
): KubernetesAiInsightsInvestigation | null {
  if (!isObject(value)) {
    return null;
  }

  const aiRunId: string | null = readString(value["aiRunId"]);
  if (!aiRunId) {
    return null;
  }

  const incidentValue: unknown = value["incident"];
  const alertValue: unknown = value["alert"];
  const incidentId: string | null = isObject(incidentValue)
    ? readString(incidentValue["id"])
    : null;
  const alertId: string | null = isObject(alertValue)
    ? readString(alertValue["id"])
    : null;

  return {
    aiRunId,
    status: readString(value["status"]),
    analysisTldr: readString(value["analysisTldr"]),
    createdAt: readString(value["createdAt"]),
    completedAt: readString(value["completedAt"]),
    incident:
      incidentId && isObject(incidentValue)
        ? {
            id: incidentId,
            title: readString(incidentValue["title"]) || "",
            number:
              typeof incidentValue["number"] === "number" &&
              Number.isFinite(incidentValue["number"])
                ? (incidentValue["number"] as number)
                : null,
          }
        : null,
    alert:
      alertId && isObject(alertValue)
        ? { id: alertId, title: readString(alertValue["title"]) || "" }
        : null,
  };
}

function parseFix(value: unknown): KubernetesAiInsightsFix | null {
  if (!isObject(value)) {
    return null;
  }

  const id: string | null = readString(value["id"]);
  if (!id) {
    return null;
  }

  return {
    id,
    status: readString(value["status"]),
    executionMode: readString(value["executionMode"]),
    suggestionType: readString(value["suggestionType"]),
    rationale: readString(value["rationale"]),
    createdAt: readString(value["createdAt"]),
    incidentId: readString(value["incidentId"]),
    alertId: readString(value["alertId"]),
    approvedAt: readString(value["approvedAt"]),
  };
}

function parseList<T>(
  value: unknown,
  parseRow: (row: unknown) => T | null,
): Array<T> {
  if (!Array.isArray(value)) {
    return [];
  }

  const rows: Array<T> = [];

  for (const row of value) {
    const parsed: T | null = parseRow(row);

    if (parsed) {
      rows.push(parsed);
    }
  }

  return rows;
}

/*
 * The insights as the route returns them, or null when the body is not
 * that shape at all (neither list is present). A row without an id is
 * dropped — there is nothing to key or link it by; everything else is
 * optional and read defensively where it is shown. Server text is only ever
 * rendered as plain text.
 */
export function parseKubernetesAiInsights(
  value: unknown,
): KubernetesAiInsights | null {
  if (!isObject(value)) {
    return null;
  }

  if (
    !Array.isArray(value["investigations"]) &&
    !Array.isArray(value["fixes"])
  ) {
    return null;
  }

  return {
    investigations: parseList(value["investigations"], parseInvestigation),
    fixes: parseList(value["fixes"], parseFix),
  };
}

interface StatusLook {
  label: string;
  color: Color;
}

const INVESTIGATION_STATUS_LOOKS: Record<AIRunStatus, StatusLook> = {
  [AIRunStatus.Queued]: { label: "Queued", color: Yellow500 },
  [AIRunStatus.Running]: { label: "Investigating", color: Yellow500 },
  [AIRunStatus.WaitingForApproval]: {
    label: "Waiting for approval",
    color: Yellow500,
  },
  [AIRunStatus.Completed]: { label: "Completed", color: Green500 },
  [AIRunStatus.NoFixFound]: { label: "No fix found", color: Gray500 },
  [AIRunStatus.Error]: { label: "Failed", color: Red500 },
  [AIRunStatus.Cancelled]: { label: "Cancelled", color: Gray500 },
  [AIRunStatus.Stale]: { label: "Timed out", color: Gray500 },
};

const FIX_STATUS_LOOKS: Record<AutoRemediationSuggestionStatus, StatusLook> = {
  [AutoRemediationSuggestionStatus.Planning]: {
    label: "Planning",
    color: Yellow500,
  },
  [AutoRemediationSuggestionStatus.Suggested]: {
    label: "Waiting for approval",
    color: Yellow500,
  },
  [AutoRemediationSuggestionStatus.Approved]: {
    label: "Applied after approval",
    color: Green500,
  },
  [AutoRemediationSuggestionStatus.AutoExecuted]: {
    label: "Applied automatically",
    color: Green500,
  },
  [AutoRemediationSuggestionStatus.Dismissed]: {
    label: "Dismissed",
    color: Gray500,
  },
  [AutoRemediationSuggestionStatus.NoneApplicable]: {
    label: "No fix found",
    color: Gray500,
  },
};

// A status a newer server added shows as it is, in a neutral pill.
export function getInvestigationStatusLook(status: string): StatusLook {
  return (
    INVESTIGATION_STATUS_LOOKS[status as AIRunStatus] || {
      label: status,
      color: Gray500,
    }
  );
}

export function getFixStatusLook(status: string): StatusLook {
  return (
    FIX_STATUS_LOOKS[status as AutoRemediationSuggestionStatus] || {
      label: status,
      color: Gray500,
    }
  );
}

export function describeFixType(suggestionType: string | null): string | null {
  if (suggestionType === AutoRemediationSuggestionType.CommandPlan) {
    return translationKey("Command plan");
  }

  if (suggestionType === AutoRemediationSuggestionType.Runbook) {
    return translationKey("Runbook");
  }

  return null;
}

// The line an investigation row leads with, and where it links.
export function describeInvestigationSubject(
  investigation: KubernetesAiInsightsInvestigation,
): { text: string; incidentId: string | null; alertId: string | null } {
  if (investigation.incident) {
    const number: number | null = investigation.incident.number;
    const title: string | null = investigation.incident.title || null;
    let text: string = translateTerm("Incident");

    if (number !== null && title) {
      text = translateTemplate("Incident #{{number}}: {{title}}", {
        number: number,
        title: title,
      });
    } else if (number !== null) {
      text = translateTemplate("Incident #{{number}}", { number: number });
    } else if (title) {
      text = translateTemplate("Incident: {{title}}", { title: title });
    }

    return {
      text: text,
      incidentId: investigation.incident.id,
      alertId: null,
    };
  }

  if (investigation.alert) {
    return {
      text: investigation.alert.title
        ? translateTemplate("Alert: {{title}}", {
            title: investigation.alert.title,
          })
        : translateTerm("Alert"),
      incidentId: null,
      alertId: investigation.alert.id,
    };
  }

  return {
    text: translateTerm("Investigation"),
    incidentId: null,
    alertId: null,
  };
}

// What an investigation found, or why there is nothing to show yet.
export function getInvestigationSummary(
  investigation: KubernetesAiInsightsInvestigation,
): string {
  if (investigation.analysisTldr) {
    return investigation.analysisTldr;
  }

  if (
    investigation.status === AIRunStatus.Queued ||
    investigation.status === AIRunStatus.Running
  ) {
    return translationKey("Still investigating.");
  }

  return translationKey("No summary was recorded.");
}

/*
 * Why the page points at the cluster's AI agent page, or null when it has
 * no reason to. From the server's status: AI cannot run kubectl here (the
 * status's own verdict, gaps included), or the project investigates neither
 * new incidents nor new alerts, so nothing new will show up here.
 */
export function getAgentPageHint(
  status: KubernetesClusterAiAccessStatus | null,
): string | null {
  if (!status) {
    return null;
  }

  if (!status.isInvestigationReady) {
    return translationKey(
      "OneUptime AI can't run kubectl on this cluster right now.",
    );
  }

  const automatic: KubernetesAiAutomaticInvestigationSettings | null =
    getAutomaticInvestigation(status);

  if (automatic && !automatic.incidents && !automatic.alerts) {
    return translationKey(
      "Automatic investigation is off for new incidents and alerts in this project.",
    );
  }

  return null;
}

function getIncidentRoute(incidentId: string): Route {
  return RouteUtil.populateRouteParams(
    RouteMap[PageMap.INCIDENT_VIEW] as Route,
    {
      modelId: incidentId,
    },
  );
}

function getAlertRoute(alertId: string): Route {
  return RouteUtil.populateRouteParams(RouteMap[PageMap.ALERT_VIEW] as Route, {
    modelId: alertId,
  });
}

function When(props: { at: string | null }): ReactElement {
  if (!props.at) {
    return <></>;
  }

  const date: Date = OneUptimeDate.fromString(props.at);

  if (Number.isNaN(date.getTime())) {
    return <></>;
  }

  return (
    <time
      className="whitespace-nowrap text-xs text-gray-500"
      dateTime={props.at}
      title={OneUptimeDate.getDateAsFormattedString(date)}
    >
      {OneUptimeDate.fromNow(date)}
    </time>
  );
}

function AgentPageLink(props: {
  clusterId: ObjectID;
  hint: string;
  testId: string;
}): ReactElement {
  const translator: Translator = useTranslator();

  return (
    <p className="text-sm text-gray-600" data-testid={props.testId}>
      {translator.translateText(props.hint)}{" "}
      <Link
        to={RouteUtil.populateRouteParams(
          RouteMap[PageMap.KUBERNETES_CLUSTER_VIEW_AI_AGENT] as Route,
          { modelId: props.clusterId },
        )}
        className="font-medium text-indigo-600 hover:text-indigo-800 underline"
      >
        {translator.translateText("Open the AI agent page")}
      </Link>
    </p>
  );
}

function InvestigationRow(props: {
  investigation: KubernetesAiInsightsInvestigation;
}): ReactElement {
  const translator: Translator = useTranslator();
  const subject: {
    text: string;
    incidentId: string | null;
    alertId: string | null;
  } = describeInvestigationSubject(props.investigation);
  const look: StatusLook | null = props.investigation.status
    ? getInvestigationStatusLook(props.investigation.status)
    : null;
  const target: Route | null = subject.incidentId
    ? getIncidentRoute(subject.incidentId)
    : subject.alertId
      ? getAlertRoute(subject.alertId)
      : null;

  return (
    <li className="py-3" data-testid="ai-insights-investigation">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0 text-sm font-medium text-gray-900">
          {target ? (
            <Link to={target} className="hover:text-indigo-700 hover:underline">
              {subject.text}
            </Link>
          ) : (
            <span>{subject.text}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {look ? <Pill text={look.label} color={look.color} /> : null}
          <When at={props.investigation.createdAt} />
        </div>
      </div>
      <p className="mt-1 break-words text-sm text-gray-600">
        {translator.translateText(getInvestigationSummary(props.investigation))}
      </p>
    </li>
  );
}

function FixRow(props: { fix: KubernetesAiInsightsFix }): ReactElement {
  const translator: Translator = useTranslator();
  const look: StatusLook | null = props.fix.status
    ? getFixStatusLook(props.fix.status)
    : null;
  const type: string | null = describeFixType(props.fix.suggestionType);
  const target: { route: Route; label: string } | null = props.fix.incidentId
    ? {
        route: getIncidentRoute(props.fix.incidentId),
        label: translationKey("Open incident"),
      }
    : props.fix.alertId
      ? {
          route: getAlertRoute(props.fix.alertId),
          label: translationKey("Open alert"),
        }
      : null;

  return (
    <li className="py-3" data-testid="ai-insights-fix">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          {look ? <Pill text={look.label} color={look.color} /> : null}
          {type ? (
            <span className="text-xs text-gray-500">
              {translator.translateText(type)}
            </span>
          ) : null}
        </div>
        <div className="flex items-center gap-3">
          {target ? (
            <Link
              to={target.route}
              className="text-sm font-medium text-indigo-600 hover:text-indigo-800"
            >
              {translator.translateText(target.label)}
            </Link>
          ) : null}
          <When at={props.fix.createdAt} />
        </div>
      </div>
      <p className="mt-1 break-words text-sm text-gray-600">
        {props.fix.rationale ||
          translator.translateText("No reason was recorded.")}
      </p>
    </li>
  );
}

const KubernetesClusterAIInsights: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const { id } = useParams();
  /*
   * Memoized on the string it was read from: a fresh ObjectID every render
   * would recreate the loaders (which depend on it) and re-run the load
   * effect after every state update.
   */
  const clusterId: ObjectID = useMemo((): ObjectID => {
    return new ObjectID(id || "");
  }, [id]);

  const [insights, setInsights] = useState<KubernetesAiInsights | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [refresher, setRefresher] = useState<boolean>(false);
  /*
   * Only for the pointer to the AI agent page. A status that fails to load
   * leaves the pointer out; it never blocks the page.
   */
  const [status, setStatus] = useState<KubernetesClusterAiAccessStatus | null>(
    null,
  );
  /*
   * The latest request of each kind. Moving to another cluster (or retrying)
   * starts new requests; an answer to an older one is dropped instead of
   * painting the wrong cluster's history.
   */
  const insightsRequestRef: MutableRefObject<number> = useRef<number>(0);
  const statusRequestRef: MutableRefObject<number> = useRef<number>(0);

  const fetchInsights: () => Promise<void> =
    useCallback(async (): Promise<void> => {
      const request: number = ++insightsRequestRef.current;
      setIsLoading(true);
      setError("");

      let parsed: KubernetesAiInsights | null = null;
      let failure: string = "";

      try {
        const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
          await API.post<JSONObject>({
            url: URL.fromString(APP_API_URL.toString()).addRoute(
              "/kubernetes-cluster/ai-access/insights",
            ),
            data: { clusterId: clusterId.toString() },
            headers: ModelAPI.getCommonHeaders(),
          });

        if (response instanceof HTTPErrorResponse) {
          throw response;
        }

        parsed = parseKubernetesAiInsights(response.data);

        if (!parsed) {
          throw new Error(
            "The server returned AI insights this page cannot read.",
          );
        }
      } catch (err) {
        parsed = null;
        failure = API.getFriendlyMessage(err);
      }

      if (request !== insightsRequestRef.current) {
        return;
      }

      setInsights(parsed);
      setError(failure);
      setIsLoading(false);
    }, [clusterId]);

  const fetchStatus: () => Promise<void> =
    useCallback(async (): Promise<void> => {
      const request: number = ++statusRequestRef.current;
      let parsed: KubernetesClusterAiAccessStatus | null = null;

      try {
        const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
          await API.post<JSONObject>({
            url: URL.fromString(APP_API_URL.toString()).addRoute(
              "/kubernetes-cluster/ai-access/status",
            ),
            data: { clusterId: clusterId.toString() },
            headers: ModelAPI.getCommonHeaders(),
          });

        parsed =
          response instanceof HTTPErrorResponse
            ? null
            : parseStatus(response.data);
      } catch {
        parsed = null;
      }

      if (request === statusRequestRef.current) {
        setStatus(parsed);
      }
    }, [clusterId]);

  useEffect(() => {
    fetchInsights().catch(() => {
      // handled inside fetchInsights
    });
    fetchStatus().catch(() => {
      // handled inside fetchStatus
    });
  }, [fetchInsights, fetchStatus, refresher]);

  const hint: string | null = getAgentPageHint(status);
  const isEmpty: boolean = Boolean(
    insights &&
      insights.investigations.length === 0 &&
      insights.fixes.length === 0,
  );

  let body: ReactElement;

  if (isLoading) {
    body = (
      <div data-testid="ai-insights-loading">
        <PageLoader isVisible={true} />
      </div>
    );
  } else if (!insights) {
    body = (
      <div data-testid="ai-insights-error">
        <ErrorMessage
          message={error || "Could not load AI insights."}
          onRefreshClick={() => {
            setRefresher(!refresher);
          }}
        />
      </div>
    );
  } else if (isEmpty) {
    body = (
      <div className="mb-5">
        <EmptyState
          id="kubernetes-ai-insights-empty"
          icon={IconProp.LightBulb}
          title={AI_INSIGHTS_EMPTY_TITLE}
          description={AI_INSIGHTS_EMPTY_DESCRIPTION}
          showSolidBackground={true}
          paddingClassName="py-12"
          footer={
            hint ? (
              <AgentPageLink
                clusterId={clusterId}
                hint={hint}
                testId="ai-insights-agent-hint"
              />
            ) : undefined
          }
        />
      </div>
    );
  } else {
    body = (
      <Fragment>
        {hint ? (
          <div className="mb-5 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
            <Icon
              icon={IconProp.Info}
              className="mt-0.5 h-4 w-4 flex-shrink-0 text-amber-600"
            />
            <AgentPageLink
              clusterId={clusterId}
              hint={hint}
              testId="ai-insights-agent-hint"
            />
          </div>
        ) : (
          <></>
        )}

        <Card
          title="Investigations"
          description="Incidents and alerts on this cluster that OneUptime AI investigated, newest first."
        >
          {insights.investigations.length > 0 ? (
            <ul className="divide-y divide-gray-100">
              {insights.investigations.map(
                (
                  investigation: KubernetesAiInsightsInvestigation,
                ): ReactElement => {
                  return (
                    <InvestigationRow
                      key={investigation.aiRunId}
                      investigation={investigation}
                    />
                  );
                },
              )}
            </ul>
          ) : (
            <p
              className="text-sm text-gray-500"
              data-testid="ai-insights-no-investigations"
            >
              {translator.translateText("No investigations yet.")}
            </p>
          )}
        </Card>

        <Card
          title="Fixes"
          description="Fixes OneUptime AI proposed or applied on this cluster, newest first."
        >
          {insights.fixes.length > 0 ? (
            <ul className="divide-y divide-gray-100">
              {insights.fixes.map(
                (fix: KubernetesAiInsightsFix): ReactElement => {
                  return <FixRow key={fix.id} fix={fix} />;
                },
              )}
            </ul>
          ) : (
            <p
              className="text-sm text-gray-500"
              data-testid="ai-insights-no-fixes"
            >
              {translator.translateText("No fixes yet.")}
            </p>
          )}
        </Card>
      </Fragment>
    );
  }

  return (
    <Fragment>
      <div className="mb-5">
        <h2 className="text-lg font-semibold text-gray-900">
          {AI_INSIGHTS_PAGE_TITLE}
        </h2>
        <p className="mt-1 text-sm text-gray-500">
          {AI_INSIGHTS_PAGE_SUBTITLE}
        </p>
      </div>

      {body}

      {canReadKubectlJobs() ? (
        <ModelTable<RunnerJob>
          modelType={RunnerJob}
          id="kubernetes-cluster-ai-kubectl-jobs"
          name={KUBECTL_COMMANDS_CARD_TITLE}
          isDeleteable={false}
          isEditable={false}
          isCreateable={false}
          isViewable={false}
          showViewIdButton={false}
          query={{
            kubernetesClusterId: clusterId,
            stepType: RunbookStepType.Kubectl,
          }}
          cardProps={{
            title: KUBECTL_COMMANDS_CARD_TITLE,
            description: KUBECTL_COMMANDS_CARD_DESCRIPTION,
          }}
          userPreferencesKey={KUBECTL_JOBS_TABLE_PREFERENCES_KEY}
          /*
           * The table fetches exactly the column fields plus these, so every
           * field a cell reads must be named here or it is undefined on the
           * row: aiRunId tells an investigation from a connection test,
           * exitCode and errorMessage say how a command ended.
           */
          selectMoreFields={{
            aiRunId: true,
            exitCode: true,
            errorMessage: true,
          }}
          noItemsMessage={KUBECTL_COMMANDS_EMPTY_MESSAGE}
          sortBy="createdAt"
          sortOrder={SortOrder.Descending}
          showRefreshButton={true}
          filters={[
            {
              field: { status: true },
              title: "Result",
              type: FieldType.Dropdown,
              filterDropdownOptions:
                DropdownUtil.getDropdownOptionsFromEnum(RunnerJobStatus),
            },
            {
              field: { origin: true },
              title: "Why",
              type: FieldType.Dropdown,
              filterDropdownOptions: [
                {
                  value: RunnerJobOrigin.AiInvestigation,
                  label:
                    KUBECTL_JOB_ORIGIN_LABELS[RunnerJobOrigin.AiInvestigation],
                },
                {
                  value: RunnerJobOrigin.AiRemediation,
                  label:
                    KUBECTL_JOB_ORIGIN_LABELS[RunnerJobOrigin.AiRemediation],
                },
              ],
            },
            {
              field: { createdAt: true },
              title: "When",
              type: FieldType.Date,
            },
          ]}
          columns={[
            {
              field: { createdAt: true },
              title: "When",
              type: FieldType.DateTime,
            },
            {
              field: { payload: true },
              title: "Command",
              type: FieldType.Element,
              getElement: (item: RunnerJob): ReactElement => {
                const payload: JSONObject = (item.payload || {}) as JSONObject;
                return (
                  <span className="font-mono text-xs text-gray-800">
                    {String(payload["displayCommand"] || "kubectl …")}
                  </span>
                );
              },
            },
            {
              field: { origin: true },
              title: "Why",
              type: FieldType.Element,
              getElement: (item: RunnerJob): ReactElement => {
                return (
                  <span className="text-xs text-gray-700">
                    {describeKubectlJobOrigin({
                      origin: item.origin,
                      aiRunId: item.aiRunId,
                    })}
                  </span>
                );
              },
            },
            {
              field: { status: true },
              title: "Result",
              type: FieldType.Element,
              getElement: (item: RunnerJob): ReactElement => {
                const statusText: string = String(item.status || "");
                const color: Color =
                  statusText === RunnerJobStatus.Succeeded
                    ? Green500
                    : statusText === RunnerJobStatus.Pending ||
                        statusText === RunnerJobStatus.Claimed ||
                        statusText === RunnerJobStatus.Running
                      ? Yellow500
                      : Red500;
                return (
                  <div>
                    <Pill
                      text={
                        typeof item.exitCode === "number"
                          ? translator.translateTemplate(
                              "{{status}} (exit {{exitCode}})",
                              {
                                status: translatableTerm(statusText),
                                exitCode: item.exitCode,
                              },
                            )
                          : statusText
                      }
                      color={color}
                    />
                    {item.errorMessage ? (
                      <p className="mt-1 max-w-md break-words text-xs text-rose-600">
                        {item.errorMessage}
                      </p>
                    ) : (
                      <></>
                    )}
                  </div>
                );
              },
            },
          ]}
        />
      ) : (
        /*
         * Settings roles and ReadKubernetesCluster may open this page but
         * not read RunnerJob rows, so the table could only fail. Explain
         * instead; RunnerJob's ACL stays as it is.
         */
        <Card
          title={KUBECTL_COMMANDS_CARD_TITLE}
          description={KUBECTL_COMMANDS_CARD_DESCRIPTION}
        >
          <p
            className="text-sm text-gray-600"
            data-testid="kubectl-jobs-permission-note"
          >
            {translator.translateTemplate(
              "Seeing the commands needs permission to read Runner jobs (one of: {{permissions}}). Commands AI ran while investigating or fixing an incident or alert also appear on that incident or alert.",
              { permissions: getKubectlJobsPermissionTitles().join(", ") },
            )}
          </p>
        </Card>
      )}
    </Fragment>
  );
};

export default KubernetesClusterAIInsights;
