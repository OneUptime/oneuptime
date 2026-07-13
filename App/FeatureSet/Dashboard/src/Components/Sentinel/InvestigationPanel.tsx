import ChatActivityFeed from "../AIChat/ChatActivityFeed";
import AIRunEvent from "Common/Models/DatabaseModels/AIRunEvent";
import AIRunStatus from "Common/Types/AI/AIRunStatus";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import IconProp from "Common/Types/Icon/IconProp";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Card from "Common/UI/Components/Card/Card";
import Icon from "Common/UI/Components/Icon/Icon";
import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";

export type InvestigationSubjectType = "incident" | "alert";

export interface ComponentProps {
  subjectType: InvestigationSubjectType;
  subjectId: ObjectID;
}

const POLL_INTERVAL_MS: number = 2500;

/*
 * Sentinel's live "watch it think" panel, shared by the incident and alert
 * view pages. It shows the autonomous investigation narrating its steps in
 * real time (reusing ChatActivityFeed over the run's AIRunEvents) and its
 * status. Renders nothing until an investigation exists for the subject, so
 * it's invisible for projects that haven't enabled Sentinel. The full cited
 * root cause lands in the subject's timeline below; this panel is the
 * reasoning trail.
 */
const InvestigationPanel: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [runStatus, setRunStatus] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [events, setEvents] = useState<Array<AIRunEvent>>([]);
  const [stats, setStats] = useState<{
    toolCallCount: number;
    totalTokens: number;
  } | null>(null);
  const [hasLoadedOnce, setHasLoadedOnce] = useState<boolean>(false);
  const signatureRef: React.MutableRefObject<string> = useRef<string>("");

  const fetchData: () => Promise<void> =
    useCallback(async (): Promise<void> => {
      try {
        const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
          await API.post<JSONObject>({
            url: URL.fromString(
              APP_API_URL.toString() + `/ai-investigation/${props.subjectType}`,
            ),
            data: { [`${props.subjectType}Id`]: props.subjectId.toString() },
            headers: ModelAPI.getCommonHeaders(),
          });

        if (response instanceof HTTPErrorResponse) {
          setHasLoadedOnce(true);
          return;
        }

        const data: JSONObject = response.data as JSONObject;
        const runJson: JSONObject | null =
          (data["run"] as JSONObject | null) || null;
        const eventsJson: JSONArray = (data["events"] as JSONArray) || [];

        const status: string | null =
          (runJson?.["status"] as string | undefined) || null;

        // Skip re-render when nothing changed (status + event count is enough).
        const signature: string = `${status || "none"}:${eventsJson.length}`;
        if (signature !== signatureRef.current) {
          signatureRef.current = signature;
          setRunStatus(status);
          setErrorMessage(
            (runJson?.["errorMessage"] as string | undefined) || null,
          );
          setEvents(
            AIRunEvent.fromJSONArray(
              eventsJson as Array<JSONObject>,
              AIRunEvent,
            ),
          );
          setStats(
            runJson
              ? {
                  toolCallCount:
                    (runJson["toolCallCount"] as number | undefined) || 0,
                  totalTokens:
                    (runJson["totalTokens"] as number | undefined) || 0,
                }
              : null,
          );
        }

        setHasLoadedOnce(true);
      } catch {
        // Best-effort panel — never surface an error here.
        setHasLoadedOnce(true);
      }
    }, [props.subjectType, props.subjectId]);

  useEffect(() => {
    fetchData().catch(() => {
      // handled inside fetchData
    });
  }, [fetchData]);

  const isRunning: boolean = runStatus === AIRunStatus.Running;
  const isQueued: boolean = runStatus === AIRunStatus.Queued;
  // Poll while the run can still make progress (queued runs get claimed).
  const isActive: boolean = isRunning || isQueued;

  useEffect(() => {
    if (!isActive) {
      return;
    }

    const interval: ReturnType<typeof setInterval> = setInterval(() => {
      fetchData().catch(() => {
        // handled inside fetchData
      });
    }, POLL_INTERVAL_MS);

    return () => {
      return clearInterval(interval);
    };
  }, [isActive, fetchData]);

  // Nothing to show until an investigation exists for this subject.
  if (!hasLoadedOnce || !runStatus) {
    return <></>;
  }

  interface StatusMeta {
    text: string;
    className: string;
    icon: IconProp;
  }

  let statusMeta: StatusMeta = {
    text: "Investigation did not finish",
    className: "text-red-600",
    icon: IconProp.Alert,
  };
  let isFailed: boolean = true;

  if (runStatus === AIRunStatus.Running) {
    statusMeta = {
      text: "Investigating…",
      className: "text-indigo-600",
      icon: IconProp.Sparkles,
    };
    isFailed = false;
  } else if (runStatus === AIRunStatus.Queued) {
    statusMeta = {
      text: "Queued — waiting for a worker…",
      className: "text-indigo-600",
      icon: IconProp.Sparkles,
    };
    isFailed = false;
  } else if (runStatus === AIRunStatus.Completed) {
    statusMeta = {
      text: "Investigation complete",
      className: "text-green-600",
      icon: IconProp.Check,
    };
    isFailed = false;
  }

  return (
    <Card
      title="AI Investigation"
      description={`Sentinel's live root-cause investigation for this ${props.subjectType}.`}
    >
      <div className="-mt-4">
        <div
          className={`flex items-center gap-2 text-sm font-medium ${statusMeta.className}`}
        >
          <Icon icon={statusMeta.icon} className="h-4 w-4" />
          <span>{statusMeta.text}</span>
          {isActive ? (
            <span className="ml-1 inline-block h-2 w-2 animate-ping rounded-full bg-indigo-500" />
          ) : (
            <></>
          )}
        </div>

        {isFailed && errorMessage ? (
          <p className="mt-1 text-xs text-red-500">{errorMessage}</p>
        ) : (
          <></>
        )}

        <div className="mt-3">
          {events.length > 0 ? (
            <ChatActivityFeed events={events} />
          ) : (
            <p className="text-sm text-gray-500">
              {isActive
                ? "Starting investigation…"
                : "No investigation steps were recorded."}
            </p>
          )}
        </div>

        {!isRunning && stats ? (
          <p className="mt-3 text-xs text-gray-400">
            {stats.toolCallCount} quer
            {stats.toolCallCount === 1 ? "y" : "ies"} across your telemetry
            {stats.totalTokens > 0
              ? ` · ${stats.totalTokens.toLocaleString()} tokens`
              : ""}
            . The full cited root cause is in the {props.subjectType} timeline
            below.
          </p>
        ) : (
          <></>
        )}
      </div>
    </Card>
  );
};

export default InvestigationPanel;
