import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import ActionCard from "Common/UI/Components/ActionCard/ActionCard";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Link from "Common/UI/Components/Link/Link";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * "Improve logging / tracing with AI" — the service-scoped instrumentation
 * recipes (ImproveLogging / ImproveTracing). One quiet ActionCard: click,
 * the server gates it (budget, GitHub-App repository, per-service dedupe),
 * and a draft PR task is queued. Rejections surface inline — the button
 * never pretends.
 */

export interface ComponentProps {
  telemetryServiceId: ObjectID;
  taskType: "ImproveLogging" | "ImproveTracing";
}

const TelemetryImprovementCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [isCreating, setIsCreating] = React.useState<boolean>(false);
  const [error, setError] = React.useState<string | null>(null);
  const [aiRunId, setAiRunId] = React.useState<string | null>(null);

  const isLogging: boolean = props.taskType === "ImproveLogging";

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
            telemetryServiceId: props.telemetryServiceId.toString(),
            taskType: props.taskType,
          },
          headers: ModelAPI.getCommonHeaders(),
        });

      if (response instanceof HTTPErrorResponse) {
        throw response;
      }

      setAiRunId(((response.data as JSONObject)["aiRunId"] as string) || null);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }

    setIsCreating(false);
  };

  if (aiRunId) {
    return (
      <Alert
        type={AlertType.SUCCESS}
        strongTitle={
          isLogging
            ? "Logging improvement task created"
            : "Tracing improvement task created"
        }
        title={
          <span>
            AI will audit this service&apos;s{" "}
            {isLogging ? "logging" : "tracing"} and open a draft pull request
            with the improvements.{" "}
            <Link
              className="underline"
              to={RouteUtil.populateRouteParams(
                RouteMap[PageMap.AI_AGENT_TASK_VIEW] as Route,
                { modelId: aiRunId },
              )}
            >
              View task progress
            </Link>
            .
          </span>
        }
      />
    );
  }

  return (
    <div className="space-y-3">
      {error && (
        <Alert
          type={AlertType.DANGER}
          strongTitle={
            isLogging
              ? "Could not create the logging improvement task"
              : "Could not create the tracing improvement task"
          }
          title={<span>{error}</span>}
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
            ? "AI will audit this service's logging and open a draft Pull Request that parameterizes messages (user data out of log text), fixes severity levels, records exceptions structurally, adds trace correlation, and cuts noise — without changing behavior."
            : "AI will audit this service's tracing and open a draft Pull Request that adds spans on uninstrumented operations, fixes span naming and status/exception semantics, stamps semantic-convention attributes, and propagates context across async boundaries — without changing behavior."
        }
        actions={[
          {
            actionName: isLogging ? "Improve Logging" : "Improve Tracing",
            actionIcon: isLogging ? IconProp.Logs : IconProp.Activity,
            actionButtonStyle: ButtonStyleType.PRIMARY,
            isLoading: isCreating,
            onConfirmAction: async () => {
              await createTask();
            },
          },
        ]}
      />
    </div>
  );
};

export default TelemetryImprovementCard;
