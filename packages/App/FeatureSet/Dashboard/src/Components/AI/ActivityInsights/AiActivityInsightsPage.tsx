import {
  AI_INSIGHTS_EMPTY_TITLE,
  AI_INSIGHTS_PAGE_TITLE,
  getAiInsightsEmptyDescription,
  getAiInsightsPageSubtitle,
  hasAiActivity,
  parseAiActivityInsights,
} from "./AiActivityInsightsData";
import AiActivityInsightsView, { CoverageCard } from "./AiActivityInsightsView";
import { AiActivityInsights } from "Common/Types/AI/AiActivityInsights";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import EmptyState from "Common/UI/Components/EmptyState/EmptyState";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import {
  translateTemplate,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  Fragment,
  FunctionComponent,
  MutableRefObject,
  ReactElement,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

/*
 * An AI Insights page (AI → Insights): what OneUptime AI has learned about
 * one scope from its own work there in the last 30 days, and what deserves
 * attention. It loads the scope's insights route (AiActivityInsights,
 * computed on the server behind the scope's read gate) and renders
 * AiActivityInsightsView, with one empty state when the window holds no AI
 * activity, a loader, and an error with a retry.
 *
 * The everything-AI-did list is the scope's AI Logs page, linked from the
 * heading — and an old bookmark of the Insights URL, which used to show that
 * list, lands here, one click from it.
 *
 * Scope-agnostic, so every Insights page is this one: a cluster's
 * (Pages/Kubernetes/View/AI/Insights), a resource's (ResourceAiInsightsPage),
 * and the incidents' and alerts' (IncidentAlertAiInsightsPage), which say
 * what they cover in sentences of their own and, with nothing to show yet,
 * why AI skipped the window's incidents.
 */

export interface ComponentProps {
  // The scope in sentences: "cluster", "Docker host".
  noun: string;
  // The insights route under /api, and the body it takes.
  insightsRoute: string;
  requestBody: JSONObject;
  // Changes with the scope, so moving to another one loads again.
  requestKey: string;
  // The scope's AI Logs and AI agent pages, populated.
  logsRoute: Route;
  // A project's incidents and alerts have no AI agent page of their own.
  agentRoute?: Route | undefined;
  // Where what AI does on its own here is set (the incidents' AI → Settings).
  settingsRoute?: Route | undefined;
  /*
   * The heading's line and the empty state's text in place of the noun's,
   * for a scope that is not one thing ("your incidents"). English keys,
   * translated where they are drawn.
   */
  subtitle?: string | undefined;
  emptyDescription?: string | undefined;
  /*
   * Why AI cannot work on the scope right now, or null. Optional, and
   * never blocks the page: a failure only leaves the pointer out.
   */
  loadAgentHint?: (() => Promise<string | null>) | undefined;
  // The empty state's id.
  emptyStateId: string;
}

function AgentHint(props: {
  hint: string;
  agentRoute?: Route | undefined;
}): ReactElement {
  const translator: Translator = useTranslator();

  return (
    <p className="text-sm text-gray-600" data-testid="ai-insights-agent-hint">
      {props.hint}{" "}
      {props.agentRoute ? (
        <Link
          to={props.agentRoute}
          className="font-medium text-indigo-600 hover:text-indigo-800 underline"
        >
          {translator.translateText("Open the AI agent page")}
        </Link>
      ) : (
        <></>
      )}
    </p>
  );
}

const AiActivityInsightsPage: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  const [insights, setInsights] = useState<AiActivityInsights | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [refresher, setRefresher] = useState<boolean>(false);
  const [hint, setHint] = useState<string | null>(null);

  /*
   * The latest request of each kind. Moving to another scope (or retrying)
   * starts new requests; an answer to an older one is dropped instead of
   * painting the wrong scope's insights.
   */
  const insightsRequestRef: MutableRefObject<number> = useRef<number>(0);
  const hintRequestRef: MutableRefObject<number> = useRef<number>(0);

  /*
   * Read through refs so the loaders depend on the scope's key alone: a
   * caller's freshly built body or callback each render must not reload.
   */
  const requestBodyRef: MutableRefObject<JSONObject> = useRef<JSONObject>(
    props.requestBody,
  );
  requestBodyRef.current = props.requestBody;
  const loadAgentHintRef: MutableRefObject<
    (() => Promise<string | null>) | undefined
  > = useRef<(() => Promise<string | null>) | undefined>(props.loadAgentHint);
  loadAgentHintRef.current = props.loadAgentHint;

  const fetchInsights: () => Promise<void> =
    useCallback(async (): Promise<void> => {
      const request: number = ++insightsRequestRef.current;
      setIsLoading(true);
      setError("");

      let parsed: AiActivityInsights | null = null;
      let failure: string = "";

      try {
        const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
          await API.post<JSONObject>({
            url: URL.fromString(APP_API_URL.toString()).addRoute(
              props.insightsRoute,
            ),
            data: requestBodyRef.current,
            headers: ModelAPI.getCommonHeaders(),
          });

        if (response instanceof HTTPErrorResponse) {
          throw response;
        }

        parsed = parseAiActivityInsights(response.data);

        if (!parsed) {
          throw new Error(
            translateTemplate(
              "The server returned AI insights this page cannot read.",
            ),
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
    }, [props.insightsRoute, props.requestKey]);

  const fetchHint: () => Promise<void> =
    useCallback(async (): Promise<void> => {
      const request: number = ++hintRequestRef.current;
      let loaded: string | null = null;

      try {
        loaded = loadAgentHintRef.current
          ? await loadAgentHintRef.current()
          : null;
      } catch {
        loaded = null;
      }

      if (request === hintRequestRef.current) {
        setHint(loaded);
      }
    }, [props.requestKey]);

  useEffect(() => {
    fetchInsights().catch(() => {
      // handled inside fetchInsights
    });
    fetchHint().catch(() => {
      // handled inside fetchHint
    });
  }, [fetchInsights, fetchHint, refresher]);

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
  } else if (!hasAiActivity(insights)) {
    body = (
      <Fragment>
        <div className="mb-5" data-testid="ai-insights-empty">
          <EmptyState
            id={props.emptyStateId}
            icon={IconProp.LightBulb}
            title={AI_INSIGHTS_EMPTY_TITLE}
            description={
              props.emptyDescription ||
              getAiInsightsEmptyDescription(props.noun)
            }
            showSolidBackground={true}
            paddingClassName="py-12"
            footer={
              <div className="space-y-2">
                {hint ? (
                  <AgentHint hint={hint} agentRoute={props.agentRoute} />
                ) : (
                  <></>
                )}
                <p className="text-sm text-gray-600">
                  {translator.translateText(
                    "Anything older is on the AI Logs page.",
                  )}{" "}
                  <Link
                    to={props.logsRoute}
                    className="font-medium text-indigo-600 hover:text-indigo-800 underline"
                  >
                    {translator.translateText("Open AI Logs")}
                  </Link>
                </p>
              </div>
            }
          />
        </div>
        {/*
         * Nothing investigated is when the reasons matter most: AI off, no
         * provider, no credits.
         */}
        {insights.coverage && insights.subjectKind ? (
          <CoverageCard
            coverage={insights.coverage}
            subjectKind={insights.subjectKind}
            settingsRoute={props.settingsRoute}
          />
        ) : (
          <></>
        )}
      </Fragment>
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
            <AgentHint hint={hint} agentRoute={props.agentRoute} />
          </div>
        ) : (
          <></>
        )}
        <AiActivityInsightsView
          insights={insights}
          noun={props.noun}
          logsRoute={props.logsRoute}
          agentRoute={props.agentRoute}
          settingsRoute={props.settingsRoute}
        />
      </Fragment>
    );
  }

  return (
    <Fragment>
      <div
        className="mb-5 flex flex-wrap items-start justify-between gap-3"
        data-testid="ai-insights-page-heading"
      >
        <div className="min-w-0">
          <h2 className="text-lg font-semibold text-gray-900">
            {translator.translateText(AI_INSIGHTS_PAGE_TITLE)}
          </h2>
          <p className="mt-1 text-sm text-gray-500">
            {props.subtitle
              ? translator.translateText(props.subtitle)
              : getAiInsightsPageSubtitle(props.noun)}
          </p>
        </div>
        <Link
          to={props.logsRoute}
          className="flex items-center gap-1 whitespace-nowrap text-sm font-medium text-indigo-600 hover:text-indigo-800"
        >
          <span data-testid="ai-insights-logs-link">
            {translator.translateText("See everything AI did in AI Logs")}
          </span>
          <Icon icon={IconProp.ChevronRight} className="h-4 w-4" />
        </Link>
      </div>

      {body}
    </Fragment>
  );
};

export default AiActivityInsightsPage;
