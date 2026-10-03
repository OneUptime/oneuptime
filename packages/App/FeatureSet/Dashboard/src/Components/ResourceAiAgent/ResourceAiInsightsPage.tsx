import PageComponentProps from "../../Pages/PageComponentProps";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import { ResourceAiAgentDescriptor } from "./ResourceAiAgentDescriptors";
import {
  RESOURCE_AI_ACCESS_INSIGHTS_ROUTE,
  RESOURCE_AI_ACCESS_STATUS_ROUTE,
  getResourceAiAccessRequestBody,
  getResourceAiAgentPageHint,
  parseResourceAiAccessStatus,
} from "./ResourceAiAgentStatus";
import {
  RESOURCE_AI_INSIGHTS_EMPTY_TITLE,
  RESOURCE_AI_INSIGHTS_PAGE_TITLE,
  RESOURCE_COMMAND_JOB_ORIGIN_LABELS,
  ResourceAiInsights,
  ResourceAiInsightsFix,
  ResourceAiInsightsInvestigation,
  ResourceAiStatusLook,
  describeResourceCommandJobOrigin,
  describeResourceFixType,
  describeResourceInvestigationSubject,
  getResourceAiInsightsEmptyDescription,
  getResourceAiInsightsPageSubtitle,
  getResourceCommandsCardDescription,
  getResourceCommandsEmptyMessage,
  getResourceFixStatusLook,
  getResourceInvestigationStatusLook,
  getResourceInvestigationSummary,
  parseResourceAiInsights,
} from "./ResourceAiInsights";
import {
  canReadResourceCommandJobs,
  getResourceCommandJobsPermissionTitles,
} from "./ResourceAiAccessPermissions";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import Color from "Common/Types/Color";
import { Green500, Red500, Yellow500 } from "Common/Types/BrandColors";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { ResourceAiAccessStatus } from "Common/Types/ResourceAiAgent/ResourceAiAccess";
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
import {
  translatableTerm,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";

/*
 * A resource's AI Insights page (AI → Insights): what OneUptime AI
 * investigated and changed on this resource, newest first — the incidents
 * and alerts it investigated (with the one-line finding), the fixes it
 * proposed or applied, and every command it ran here through the resource
 * AI agent. The resource twin of Pages/Kubernetes/View/AI/Insights.tsx.
 *
 * The first two lists come from POST /resource-ai-access/insights, which
 * the server computes (summaries only, never command output) behind the
 * same read gate as the resource's AI status. The command history is the
 * RunnerJob table filtered on this resource's ResourceCommand jobs, with a
 * permission fallback for the roles that may not read Runner jobs.
 */

export interface ComponentProps extends PageComponentProps {
  descriptor: ResourceAiAgentDescriptor;
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
  descriptor: ResourceAiAgentDescriptor;
  resourceId: ObjectID;
  hint: string;
}): ReactElement {
  const translator: Translator = useTranslator();

  return (
    <p className="text-sm text-gray-600" data-testid="ai-insights-agent-hint">
      {props.hint}{" "}
      <Link
        to={RouteUtil.populateRouteParams(
          RouteMap[props.descriptor.agentPage] as Route,
          { modelId: props.resourceId },
        )}
        className="font-medium text-indigo-600 hover:text-indigo-800 underline"
      >
        {translator.translateText("Open the AI agent page")}
      </Link>
    </p>
  );
}

function InvestigationRow(props: {
  investigation: ResourceAiInsightsInvestigation;
}): ReactElement {
  const subject: {
    text: string;
    incidentId: string | null;
    alertId: string | null;
  } = describeResourceInvestigationSubject(props.investigation);
  const look: ResourceAiStatusLook | null = props.investigation.status
    ? getResourceInvestigationStatusLook(props.investigation.status)
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
        {getResourceInvestigationSummary(props.investigation)}
      </p>
    </li>
  );
}

function FixRow(props: { fix: ResourceAiInsightsFix }): ReactElement {
  const translator: Translator = useTranslator();
  const look: ResourceAiStatusLook | null = props.fix.status
    ? getResourceFixStatusLook(props.fix.status)
    : null;
  const type: string | null = describeResourceFixType(props.fix.suggestionType);
  const target: { route: Route; label: string } | null = props.fix.incidentId
    ? { route: getIncidentRoute(props.fix.incidentId), label: "Open incident" }
    : props.fix.alertId
      ? { route: getAlertRoute(props.fix.alertId), label: "Open alert" }
      : null;

  return (
    <li className="py-3" data-testid="ai-insights-fix">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          {look ? <Pill text={look.label} color={look.color} /> : null}
          {type ? <span className="text-xs text-gray-500">{type}</span> : null}
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

const ResourceAiInsightsPage: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const descriptor: ResourceAiAgentDescriptor = props.descriptor;
  const { id } = useParams();
  /*
   * Memoized on the string it was read from: a fresh ObjectID every render
   * would recreate the loaders (which depend on it) and re-run the load
   * effect after every state update.
   */
  const resourceId: ObjectID = useMemo((): ObjectID => {
    return new ObjectID(id || "");
  }, [id]);

  const [insights, setInsights] = useState<ResourceAiInsights | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [refresher, setRefresher] = useState<boolean>(false);
  /*
   * Only for the pointer to the AI agent page. A status that fails to load
   * leaves the pointer out; it never blocks the page.
   */
  const [status, setStatus] = useState<ResourceAiAccessStatus | null>(null);
  /*
   * The latest request of each kind. Moving to another resource (or
   * retrying) starts new requests; an answer to an older one is dropped
   * instead of painting the wrong resource's history.
   */
  const insightsRequestRef: MutableRefObject<number> = useRef<number>(0);
  const statusRequestRef: MutableRefObject<number> = useRef<number>(0);

  const fetchInsights: () => Promise<void> =
    useCallback(async (): Promise<void> => {
      const request: number = ++insightsRequestRef.current;
      setIsLoading(true);
      setError("");

      let parsed: ResourceAiInsights | null = null;
      let failure: string = "";

      try {
        const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
          await API.post<JSONObject>({
            url: URL.fromString(APP_API_URL.toString()).addRoute(
              RESOURCE_AI_ACCESS_INSIGHTS_ROUTE,
            ),
            data: getResourceAiAccessRequestBody(
              descriptor,
              resourceId.toString(),
            ),
            headers: ModelAPI.getCommonHeaders(),
          });

        if (response instanceof HTTPErrorResponse) {
          throw response;
        }

        parsed = parseResourceAiInsights(response.data);

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
    }, [resourceId, descriptor]);

  const fetchStatus: () => Promise<void> =
    useCallback(async (): Promise<void> => {
      const request: number = ++statusRequestRef.current;
      let parsed: ResourceAiAccessStatus | null = null;

      try {
        const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
          await API.post<JSONObject>({
            url: URL.fromString(APP_API_URL.toString()).addRoute(
              RESOURCE_AI_ACCESS_STATUS_ROUTE,
            ),
            data: getResourceAiAccessRequestBody(
              descriptor,
              resourceId.toString(),
            ),
            headers: ModelAPI.getCommonHeaders(),
          });

        parsed =
          response instanceof HTTPErrorResponse
            ? null
            : parseResourceAiAccessStatus(response.data);
      } catch {
        parsed = null;
      }

      if (request === statusRequestRef.current) {
        setStatus(parsed);
      }
    }, [resourceId, descriptor]);

  useEffect(() => {
    fetchInsights().catch(() => {
      // handled inside fetchInsights
    });
    fetchStatus().catch(() => {
      // handled inside fetchStatus
    });
  }, [fetchInsights, fetchStatus, refresher]);

  const hint: string | null = getResourceAiAgentPageHint(status, descriptor);
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
          id={`${descriptor.commandsTableId}-insights-empty`}
          icon={IconProp.LightBulb}
          title={RESOURCE_AI_INSIGHTS_EMPTY_TITLE}
          description={getResourceAiInsightsEmptyDescription(descriptor)}
          showSolidBackground={true}
          paddingClassName="py-12"
          footer={
            hint ? (
              <AgentPageLink
                descriptor={descriptor}
                resourceId={resourceId}
                hint={hint}
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
              descriptor={descriptor}
              resourceId={resourceId}
              hint={hint}
            />
          </div>
        ) : (
          <></>
        )}

        <Card
          title="Investigations"
          description={translator.translateTemplate(
            "Incidents and alerts on this {{noun}} that OneUptime AI investigated, newest first.",
            { noun: translatableTerm(descriptor.noun) },
          )}
        >
          {insights.investigations.length > 0 ? (
            <ul className="divide-y divide-gray-100">
              {insights.investigations.map(
                (
                  investigation: ResourceAiInsightsInvestigation,
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
          description={translator.translateTemplate(
            "Fixes OneUptime AI proposed or applied on this {{noun}}, newest first.",
            { noun: translatableTerm(descriptor.noun) },
          )}
        >
          {insights.fixes.length > 0 ? (
            <ul className="divide-y divide-gray-100">
              {insights.fixes.map(
                (fix: ResourceAiInsightsFix): ReactElement => {
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
      <div className="mb-5" data-testid="ai-insights-page-heading">
        <h2 className="text-lg font-semibold text-gray-900">
          {RESOURCE_AI_INSIGHTS_PAGE_TITLE}
        </h2>
        <p className="mt-1 text-sm text-gray-500">
          {getResourceAiInsightsPageSubtitle(descriptor)}
        </p>
      </div>

      {body}

      {canReadResourceCommandJobs() ? (
        <ModelTable<RunnerJob>
          modelType={RunnerJob}
          id={descriptor.commandsTableId}
          name={descriptor.commandsCardTitle}
          isDeleteable={false}
          isEditable={false}
          isCreateable={false}
          isViewable={false}
          showViewIdButton={false}
          query={{
            resourceType: descriptor.resourceType,
            resourceId: resourceId,
            stepType: RunbookStepType.ResourceCommand,
          }}
          cardProps={{
            title: descriptor.commandsCardTitle,
            description: getResourceCommandsCardDescription(descriptor),
          }}
          userPreferencesKey={descriptor.commandsTableId}
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
          noItemsMessage={getResourceCommandsEmptyMessage(descriptor)}
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
                    RESOURCE_COMMAND_JOB_ORIGIN_LABELS[
                      RunnerJobOrigin.AiInvestigation
                    ],
                },
                {
                  value: RunnerJobOrigin.AiRemediation,
                  label:
                    RESOURCE_COMMAND_JOB_ORIGIN_LABELS[
                      RunnerJobOrigin.AiRemediation
                    ],
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
                    {String(payload["displayCommand"] || "…")}
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
                    {describeResourceCommandJobOrigin({
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
         * Roles that may open this page may not read RunnerJob rows, so
         * the table could only fail. Explain instead; RunnerJob's ACL
         * stays as it is.
         */
        <Card
          title={descriptor.commandsCardTitle}
          description={getResourceCommandsCardDescription(descriptor)}
        >
          <p
            className="text-sm text-gray-600"
            data-testid="resource-command-jobs-permission-note"
          >
            {translator.translateTemplate(
              "Seeing the commands needs permission to read Runner jobs (one of: {{permissions}}). Commands AI ran while investigating or fixing an incident or alert also appear on that incident or alert.",
              {
                permissions:
                  getResourceCommandJobsPermissionTitles().join(", "),
              },
            )}
          </p>
        </Card>
      )}
    </Fragment>
  );
};

export default ResourceAiInsightsPage;
