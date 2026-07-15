import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useState,
} from "react";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { APP_API_URL } from "Common/UI/Config";
import URL from "Common/Types/API/URL";
import Route from "Common/Types/API/Route";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import Card from "Common/UI/Components/Card/Card";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import Icon from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import ProgressBar, {
  ProgressBarSize,
} from "Common/UI/Components/ProgressBar/ProgressBar";
import Navigation from "Common/UI/Utils/Navigation";
import {
  AIFixReadinessCheck,
  AIFixReadinessCheckId,
} from "Common/Types/AI/AIFixReadiness";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";

interface ReadinessState {
  ready: boolean;
  checks: Array<AIFixReadinessCheck>;
}

// Where the user goes to satisfy a gate, and the icon that represents it.
interface GatePresentation {
  icon: IconProp;
  iconBackgroundClassName: string;
  actionTitle: string;
  pageMap: PageMap;
}

type GetGatePresentationFunction = (
  id: AIFixReadinessCheckId,
) => GatePresentation | null;

const getGatePresentation: GetGatePresentationFunction = (
  id: AIFixReadinessCheckId,
): GatePresentation | null => {
  switch (id) {
    case "repositoryConnected":
    case "repositoryResolved":
      return {
        icon: IconProp.Code,
        iconBackgroundClassName: "bg-indigo-500",
        actionTitle: "Connect repository",
        pageMap: PageMap.CODE_REPOSITORY,
      };
    case "llmProvider":
      return {
        icon: IconProp.Bolt,
        iconBackgroundClassName: "bg-amber-500",
        actionTitle: "Add LLM provider",
        pageMap: PageMap.SETTINGS_AI_LLM_PROVIDERS,
      };
    case "agentAvailable":
      return {
        icon: IconProp.Server,
        iconBackgroundClassName: "bg-sky-500",
        actionTitle: "Set up agent",
        pageMap: PageMap.SETTINGS_AI_AGENTS,
      };
    default:
      return null;
  }
};

const ReadinessTile: FunctionComponent<{
  check: AIFixReadinessCheck;
}> = (props: { check: AIFixReadinessCheck }): ReactElement => {
  const { check } = props;
  const presentation: GatePresentation | null = getGatePresentation(check.id);

  const goToGate: () => void = (): void => {
    if (check.ok || !presentation) {
      return;
    }

    Navigation.navigate(
      RouteUtil.populateRouteParams(RouteMap[presentation.pageMap] as Route),
    );
  };

  return (
    <div
      onClick={goToGate}
      role={check.ok || !presentation ? undefined : "button"}
      data-testid={`ai-readiness-check-${check.id}`}
      className={`group flex items-start gap-4 rounded-lg border p-4 transition ${
        check.ok
          ? "border-gray-200 bg-gray-50"
          : "cursor-pointer border-gray-200 bg-white hover:border-indigo-300 hover:shadow-md"
      }`}
    >
      <div
        className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg ${
          check.ok
            ? "bg-emerald-100"
            : presentation?.iconBackgroundClassName || "bg-amber-500"
        }`}
      >
        <Icon
          icon={check.ok ? IconProp.Check : presentation?.icon || IconProp.Bolt}
          className={`h-5 w-5 ${check.ok ? "text-emerald-600" : "text-white"}`}
        />
      </div>
      <div className="min-w-0 flex-1">
        <div
          className={`text-sm font-medium ${
            check.ok ? "text-gray-500" : "text-gray-900"
          }`}
        >
          {check.title}
        </div>
        {check.detail && (
          <div className="mt-1 text-sm text-gray-500">{check.detail}</div>
        )}
        {!check.ok && presentation && (
          <div className="mt-2 text-sm font-medium text-indigo-600 transition group-hover:text-indigo-700">
            {presentation.actionTitle} →
          </div>
        )}
      </div>
      {check.ok ? (
        <span className="mt-0.5 flex-shrink-0 text-xs font-medium text-emerald-600">
          Ready
        </span>
      ) : (
        <Icon
          icon={IconProp.ChevronRight}
          className="mt-0.5 h-5 w-5 flex-shrink-0 text-gray-400 transition group-hover:text-indigo-500"
        />
      )}
    </div>
  );
};

/*
 * What this project's AI tasks actually need, and which of it is in place —
 * read from the same server checks that gate a real run, so this never
 * promises something the agent will then refuse to do.
 *
 * This replaced a static "Prerequisites" banner that told every project it
 * needed a *project* LLM provider. It does not: agent completions are
 * server-mediated, so the shared global provider is a valid fallback (see
 * LlmProviderService.getLlmProviderForMeteredAgentPath). The banner also
 * never mentioned the agent gate, so a project with no running agent watched
 * its tasks sit Queued with nothing on screen to explain why.
 *
 * A configured project sees one quiet line rather than a wall of chrome.
 */
const AICodeFixReadiness: FunctionComponent = (): ReactElement => {
  const [readiness, setReadiness] = useState<ReadinessState | undefined>(
    undefined,
  );
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [isExpanded, setIsExpanded] = useState<boolean>(false);

  const fetchReadiness: () => Promise<void> =
    useCallback(async (): Promise<void> => {
      try {
        setIsLoading(true);
        setError("");

        const response: HTTPErrorResponse | HTTPResponse<JSONObject> =
          await API.post({
            url: URL.fromString(APP_API_URL.toString()).addRoute(
              "/ai-readiness/code-fix",
            ),
            data: {},
            headers: ModelAPI.getCommonHeaders(),
          });

        if (response instanceof HTTPErrorResponse) {
          throw response;
        }

        const checksJson: JSONArray =
          (response.data?.["checks"] as JSONArray) || [];

        setReadiness({
          ready: Boolean(response.data?.["ready"]),
          checks: checksJson.map((check: JSONObject): AIFixReadinessCheck => {
            return {
              id: check["id"] as AIFixReadinessCheckId,
              ok: Boolean(check["ok"]),
              title: (check["title"] as string) || "",
              detail: (check["detail"] as string) || "",
            };
          }),
        });
      } catch (err) {
        setError(API.getFriendlyMessage(err));
      }

      setIsLoading(false);
    }, []);

  useEffect(() => {
    fetchReadiness().catch(() => {
      // handled inside fetchReadiness
    });
  }, [fetchReadiness]);

  if (isLoading) {
    return (
      <div className="mb-5 flex items-center gap-3">
        <div className="h-4 w-4 animate-pulse rounded-full bg-gray-100"></div>
        <div className="h-4 w-72 animate-pulse rounded bg-gray-100"></div>
      </div>
    );
  }

  /*
   * Never hide a failed readiness check: a section that vanishes on error is
   * indistinguishable from one saying everything is fine, which is the one
   * lie this component exists to prevent.
   */
  if (error) {
    return (
      <div className="mb-5">
        <ErrorMessage
          message={error}
          onRefreshClick={() => {
            fetchReadiness().catch(() => {
              // handled inside fetchReadiness
            });
          }}
        />
      </div>
    );
  }

  if (!readiness || readiness.checks.length === 0) {
    return <Fragment />;
  }

  const okCount: number = readiness.checks.filter(
    (check: AIFixReadinessCheck) => {
      return check.ok;
    },
  ).length;

  /*
   * Configured and collapsed: one line. Unlike a welcome nudge this cannot
   * retire itself permanently — readiness regresses (an agent container
   * dies, a balance empties), so the line stays as the cheap standing signal
   * that it has not.
   */
  if (readiness.ready && !isExpanded) {
    return (
      <div
        className="mb-5 flex items-center gap-2 text-sm text-gray-500"
        data-testid="ai-readiness-ready-strip"
      >
        <Icon
          icon={IconProp.CheckCircle}
          className="h-4 w-4 flex-shrink-0 text-emerald-600"
        />
        <span>AI is ready to open fix pull requests on this project.</span>
        <Button
          title="Details"
          buttonStyle={ButtonStyleType.SECONDARY_LINK}
          buttonSize={ButtonSize.Small}
          onClick={() => {
            setIsExpanded(true);
          }}
          dataTestId="ai-readiness-expand"
        />
      </div>
    );
  }

  return (
    <Card
      title={readiness.ready ? "AI setup" : "Finish setting up AI"}
      description={
        readiness.ready
          ? "Everything AI needs to open fix pull requests on this project."
          : "AI turns exceptions into fix pull requests. Here is what is still missing."
      }
      rightElement={
        readiness.ready ? (
          <Button
            title="Hide"
            buttonStyle={ButtonStyleType.SECONDARY_LINK}
            buttonSize={ButtonSize.Small}
            onClick={() => {
              setIsExpanded(false);
            }}
            dataTestId="ai-readiness-collapse"
          />
        ) : (
          <Button
            title="Recheck"
            icon={IconProp.Refresh}
            buttonStyle={ButtonStyleType.SECONDARY_LINK}
            buttonSize={ButtonSize.Small}
            onClick={() => {
              fetchReadiness().catch(() => {
                // handled inside fetchReadiness
              });
            }}
            dataTestId="ai-readiness-recheck"
          />
        )
      }
    >
      <div data-testid="ai-readiness">
        <div className="mb-6 max-w-md">
          <ProgressBar
            count={okCount}
            totalCount={readiness.checks.length}
            suffix="ready"
            size={ProgressBarSize.Small}
          />
        </div>
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
          {readiness.checks.map((check: AIFixReadinessCheck) => {
            return <ReadinessTile key={check.id} check={check} />;
          })}
        </div>
      </div>
    </Card>
  );
};

export default AICodeFixReadiness;
