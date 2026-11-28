import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import useAiOffered from "../../Utils/UseAiOffered";
import CodeRepositorySearchField from "../Code/CodeRepositorySearchField";
import { TELEMETRY_AI_FIX_COPY } from "../TelemetryAi/TelemetryAiFixCopy";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import { CodeRepositoryListGroup } from "Common/Types/AI/CodeTask";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import ActionCard from "Common/UI/Components/ActionCard/ActionCard";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Link from "Common/UI/Components/Link/Link";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { translationKey, Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import SuggestionOffer from "Common/Utils/Suggestions/SuggestionOffer";
import { isPickRefusal } from "Common/Utils/Suggestions/CodeFixRepositoryPick";
import {
  NO_TELEMETRY_IMPROVEMENT_SUGGESTION,
  TelemetryImprovementSuggestion,
  parseTelemetryImprovementSuggestion,
} from "Common/Utils/Suggestions/TelemetryImprovementSuggestion";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useId,
} from "react";
import { ErrorInSentence } from "Common/UI/Components/ErrorMessage/ErrorSentence";

/*
 * "Improve logging / tracing with AI" — the service-scoped instrumentation
 * recipes (ImproveLogging / ImproveTracing). One quiet ActionCard under a
 * service's logs or traces, shown only when it can do something: the page
 * asks the server first (POST /ai-investigation/telemetry-improvement-
 * suggestion, the rule in Common/Utils/Suggestions/
 * TelemetryImprovementSuggestion), which answers with the gates the create
 * route enforces - AI on, a repository for the pull request, no improvement
 * of the same kind already on its way, and a repository the person may use
 * in Code (#11209). With AI off it does not even ask. An improvement already
 * on its way is linked instead of offered again, and anything else draws
 * nothing.
 *
 * When several repositories are the person's and none is named like the
 * service, the server says which (the suggestion's `repositories`): the
 * confirmation asks which holds the service's code, from a search of those
 * on the server, before it starts - as a trace's Fix performance with AI
 * asks. A pick the server refuses as one the person cannot make is cleared.
 */

export const TELEMETRY_IMPROVEMENT_SUGGESTION_PATH: string =
  "/ai-investigation/telemetry-improvement-suggestion";

export interface ComponentProps {
  telemetryServiceId: ObjectID;
  taskType: "ImproveLogging" | "ImproveTracing";
}

// What the server offers this service now. Throws when it cannot be read.
const readSuggestion: (data: {
  serviceId: string;
  taskType: ComponentProps["taskType"];
}) => Promise<TelemetryImprovementSuggestion> = async (data: {
  serviceId: string;
  taskType: ComponentProps["taskType"];
}): Promise<TelemetryImprovementSuggestion> => {
  const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
    await API.post<JSONObject>({
      url: URL.fromString(APP_API_URL.toString()).addRoute(
        TELEMETRY_IMPROVEMENT_SUGGESTION_PATH,
      ),
      data: {
        telemetryServiceId: data.serviceId,
        taskType: data.taskType,
      },
      headers: ModelAPI.getCommonHeaders(),
    });

  return response instanceof HTTPErrorResponse
    ? NO_TELEMETRY_IMPROVEMENT_SUGGESTION
    : parseTelemetryImprovementSuggestion(response.data);
};

const TelemetryImprovementCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement | null => {
  const translator: Translator = useTranslator();
  const isAiOffered: boolean = useAiOffered();
  const [suggestion, setSuggestion] =
    React.useState<TelemetryImprovementSuggestion>(
      NO_TELEMETRY_IMPROVEMENT_SUGGESTION,
    );
  const [isCreating, setIsCreating] = React.useState<boolean>(false);
  const [error, setError] = React.useState<string | null>(null);
  const [aiRunId, setAiRunId] = React.useState<string | null>(null);
  // The repository the person picked, when the card asks for one.
  const [pickedRepositoryId, setPickedRepositoryId] =
    React.useState<string>("");
  const repositoryLabelId: string = `telemetry-improvement-repository-${useId()}`;

  const isLogging: boolean = props.taskType === "ImproveLogging";
  const serviceId: string = props.telemetryServiceId.toString();

  /*
   * Several repositories are the person's, and none is named like the
   * service: the pick comes first, or the run would find none to work in.
   */
  const needsRepositoryPick: boolean =
    suggestion.offer === SuggestionOffer.Act &&
    suggestion.repositories.length > 1;

  useEffect(() => {
    let isCurrent: boolean = true;

    setSuggestion(NO_TELEMETRY_IMPROVEMENT_SUGGESTION);
    setAiRunId(null);
    setError(null);
    setPickedRepositoryId("");

    if (!isAiOffered) {
      return;
    }

    const loadSuggestion: () => Promise<void> = async (): Promise<void> => {
      try {
        const answer: TelemetryImprovementSuggestion = await readSuggestion({
          serviceId,
          taskType: props.taskType,
        });

        if (isCurrent) {
          setSuggestion(answer);
        }
      } catch {
        // A suggestion is an offer, never something the page depends on.
        if (isCurrent) {
          setSuggestion(NO_TELEMETRY_IMPROVEMENT_SUGGESTION);
        }
      }
    };

    void loadSuggestion();

    return () => {
      isCurrent = false;
    };
  }, [serviceId, props.taskType, isAiOffered]);

  const createTask: () => Promise<void> = async (): Promise<void> => {
    setIsCreating(true);
    setError(null);

    try {
      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await API.post<JSONObject>({
          url: URL.fromString(APP_API_URL.toString()).addRoute(
            "/ai-investigation/create-telemetry-improvement-task",
          ),
          data: {
            telemetryServiceId: serviceId,
            taskType: props.taskType,
            // In the repository the person picked, when the card asked.
            ...(needsRepositoryPick && pickedRepositoryId
              ? { repositoryId: pickedRepositoryId }
              : {}),
          },
          headers: ModelAPI.getCommonHeaders(),
        });

      if (response instanceof HTTPErrorResponse) {
        throw response;
      }

      setAiRunId(((response.data as JSONObject)["aiRunId"] as string) || null);
    } catch (err) {
      /*
       * Ask again what the server offers: an improvement someone else
       * started meanwhile is linked like any other on its way, rather than
       * reported as a refusal. Anything else keeps the card and the reason.
       */
      const reason: string = API.getFriendlyMessage(err);

      /*
       * A pick the server refused as one the person cannot make - no longer
       * connected, or no longer theirs to read or ask OneUptime AI in - is
       * no pick: the card waits for another, and the search no longer
       * offers it (#11209).
       */
      if (isPickRefusal(reason)) {
        setPickedRepositoryId("");
      }
      let latest: TelemetryImprovementSuggestion | null = null;

      try {
        latest = await readSuggestion({ serviceId, taskType: props.taskType });
      } catch {
        latest = null;
      }

      if (latest && latest.offer === SuggestionOffer.InProgress) {
        setSuggestion(latest);
      } else {
        /*
         * A pick the card did not know to ask for - a repository was
         * connected after it read its choices: the choices of now, so the
         * confirmation asks for it beside why.
         */
        if (
          latest &&
          latest.offer === SuggestionOffer.Act &&
          latest.repositories.length > 1
        ) {
          setSuggestion(latest);
        }

        setError(reason);
      }
    }

    setIsCreating(false);
  };

  /*
   * The improvement to link to: the one started here, or the one the server
   * says is already on its way for this service.
   */
  const linkedRunId: string | null =
    aiRunId ||
    (suggestion.offer === SuggestionOffer.InProgress
      ? suggestion.aiRunId
      : null);

  if (linkedRunId) {
    return (
      <div className="mt-4" data-testid="telemetry-improvement-progress">
        <Alert
          type={aiRunId ? AlertType.SUCCESS : AlertType.INFO}
          strongTitle={
            aiRunId
              ? isLogging
                ? "Logging improvement task created"
                : "Tracing improvement task created"
              : isLogging
                ? "Logging improvement in progress"
                : "Tracing improvement in progress"
          }
          title={
            <span>
              <TranslatedSentence
                template={
                  isLogging
                    ? "AI will audit this service's logging and open a pull request with the improvements, ready for review. {{taskLink}}."
                    : "AI will audit this service's tracing and open a pull request with the improvements, ready for review. {{taskLink}}."
                }
                slots={{
                  taskLink: (
                    <Link
                      className="underline"
                      to={RouteUtil.populateRouteParams(
                        RouteMap[PageMap.CODE_TASK_VIEW] as Route,
                        { modelId: linkedRunId },
                      )}
                    >
                      {translator.translateText("View task progress")}
                    </Link>
                  ),
                }}
              />
            </span>
          }
        />
      </div>
    );
  }

  if (suggestion.offer !== SuggestionOffer.Act) {
    return null;
  }

  return (
    <div className="mt-4 space-y-3" data-testid="telemetry-improvement-card">
      {error && (
        <Alert
          type={AlertType.DANGER}
          strongTitle={
            isLogging
              ? "Could not create the logging improvement task"
              : "Could not create the tracing improvement task"
          }
          title={
            <span>
              <ErrorInSentence message={error} showWhereToLook={true} />
            </span>
          }
          onClose={() => {
            setError(null);
          }}
        />
      )}
      <ActionCard
        title={
          isLogging ? "Improve logging with AI" : "Improve tracing with AI"
        }
        description={
          isLogging
            ? "AI reviews this service's logging and opens a pull request that fixes levels, structure and noise, without changing behavior."
            : "AI reviews this service's tracing and opens a pull request that adds missing spans and fixes names and attributes, without changing behavior."
        }
        actions={[
          {
            // The card's button translates it.
            actionName: isLogging
              ? translationKey("Improve Logging")
              : translationKey("Improve Tracing"),
            actionIcon: isLogging ? IconProp.Logs : IconProp.Activity,
            actionButtonStyle: ButtonStyleType.PRIMARY,
            isLoading: isCreating,
            onConfirmAction: async () => {
              await createTask();
            },
            /*
             * The one thing the confirmation also asks, when the server
             * could not tell: which of the person's repositories holds the
             * service's code. Searched on the server among the connected
             * repositories they may ask OneUptime AI to work in - the ones
             * the improvement accepts.
             */
            ...(needsRepositoryPick
              ? {
                  confirmContent: (
                    <div
                      className="mt-4"
                      data-testid="telemetry-improvement-repository"
                    >
                      <p
                        className="mb-1 text-sm font-medium text-gray-700"
                        id={repositoryLabelId}
                      >
                        {translator.translateText(
                          TELEMETRY_AI_FIX_COPY.pickRepository,
                        )}
                      </p>
                      <CodeRepositorySearchField
                        value={pickedRepositoryId || null}
                        group={CodeRepositoryListGroup.Connected}
                        isAskableOnly={true}
                        isClearable={false}
                        placeholder={
                          TELEMETRY_AI_FIX_COPY.pickRepositoryPlaceholder
                        }
                        emptyListText={
                          TELEMETRY_AI_FIX_COPY.noAskableRepository
                        }
                        ariaLabelledby={repositoryLabelId}
                        dataTestId="telemetry-improvement-repository-picker"
                        onChange={(repositoryId: string | null) => {
                          setPickedRepositoryId(repositoryId || "");
                        }}
                      />
                    </div>
                  ),
                  isConfirmDisabled: !pickedRepositoryId,
                }
              : {}),
          },
        ]}
      />
    </div>
  );
};

export default TelemetryImprovementCard;
