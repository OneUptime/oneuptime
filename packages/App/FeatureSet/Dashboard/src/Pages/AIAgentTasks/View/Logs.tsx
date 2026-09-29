import PageComponentProps from "../../PageComponentProps";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useParams } from "react-router-dom";
import AIRunStatus, { AIRunStatusHelper } from "Common/Types/AI/AIRunStatus";
import AIRunEventType from "Common/Types/AI/AIRunEventType";
import { AIRunEventContentPayload } from "Common/Types/AI/AIChatTypes";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import IconProp from "Common/Types/Icon/IconProp";
import {
  Green,
  Red,
  Yellow,
  Gray500,
  Indigo500,
} from "Common/Types/BrandColors";
import Color from "Common/Types/Color";
import OneUptimeDate from "Common/Types/Date";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import Card from "Common/UI/Components/Card/Card";
import CodeBlock from "Common/UI/Components/CodeBlock/CodeBlock";
import EmptyState from "Common/UI/Components/EmptyState/EmptyState";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Icon from "Common/UI/Components/Icon/Icon";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import Pill from "Common/UI/Components/Pill/Pill";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";

const POLL_INTERVAL_MS: number = 5000;

/*
 * The AI task Logs page: everything recorded about one code-fix run, in the
 * order it happened — the page you open when a task did something you did not
 * expect.
 *
 * Two things are worth knowing about the data:
 *
 * - The verbatim content (prompts, model replies, tool output) arrives only
 *   for project owners and admins. It embeds customer source code, so the
 *   server gates it harder than the page itself; everyone else sees the same
 *   timeline without the bodies. `canReadContent` says which you got.
 * - LLM metering rows are read under the CALLER's permissions, so they are
 *   absent rather than empty when the reader cannot read LlmLog.
 */

interface LlmCallLog {
  key: string;
  modelName: string;
  providerName: string;
  status: string;
  statusMessage: string;
  totalTokens: number | undefined;
  completionTokens: number | undefined;
  durationMs: number | undefined;
  startedAt: Date | undefined;
}

interface LogEntry {
  key: string;
  sequence: number;
  eventType: AIRunEventType | undefined;
  toolName: string | undefined;
  message: string;
  severity: string | undefined;
  createdAt: Date | undefined;
  durationInMs: number | undefined;
  contentPayload: AIRunEventContentPayload | undefined;
}

type FormatTimestampFunction = (date: Date | undefined) => string;

const formatTimestamp: FormatTimestampFunction = (
  date: Date | undefined,
): string => {
  if (!date) {
    return "-";
  }

  return OneUptimeDate.getDateAsLocalFormattedString(date, false);
};

/*
 * The event types that mean something failed — rendered red so a long trail
 * can be skimmed for the moment it went wrong.
 */
const FAILURE_EVENT_TYPES: Array<AIRunEventType> = [
  AIRunEventType.ToolCallFailed,
  AIRunEventType.RunFailed,
];

type IsFailureEntryFunction = (entry: LogEntry) => boolean;

const isFailureEntry: IsFailureEntryFunction = (entry: LogEntry): boolean => {
  return (
    (entry.eventType !== undefined &&
      FAILURE_EVENT_TYPES.includes(entry.eventType)) ||
    entry.severity?.toLowerCase() === "error"
  );
};

type EntryColorFunction = (entry: LogEntry) => Color;

const getEntryColor: EntryColorFunction = (entry: LogEntry): Color => {
  if (isFailureEntry(entry)) {
    return Red;
  }

  if (entry.severity?.toLowerCase() === "warning") {
    return Yellow;
  }

  if (entry.eventType === AIRunEventType.RunCompleted) {
    return Green;
  }

  if (entry.eventType === AIRunEventType.LlmCallCompleted) {
    return Indigo500;
  }

  return Gray500;
};

type EntryLabelFunction = (entry: LogEntry) => string;

const getEntryLabel: EntryLabelFunction = (entry: LogEntry): string => {
  if (entry.toolName) {
    return entry.toolName;
  }

  return entry.eventType || "Event";
};

type ToLogEntriesFunction = (eventsJson: Array<JSONObject>) => Array<LogEntry>;

const toLogEntries: ToLogEntriesFunction = (
  eventsJson: Array<JSONObject>,
): Array<LogEntry> => {
  return eventsJson.map((eventJson: JSONObject, index: number) => {
    const resultSummary: JSONObject =
      (eventJson["resultSummary"] as JSONObject) || {};

    const createdAt: string | undefined = eventJson["createdAt"] as
      | string
      | undefined;

    return {
      key: (eventJson["_id"] as string) || `event-${index}`,
      sequence: (eventJson["sequence"] as number) ?? index,
      eventType: eventJson["eventType"] as AIRunEventType | undefined,
      toolName: eventJson["toolName"] as string | undefined,
      message: (resultSummary["message"] as string) || "",
      severity: resultSummary["severity"] as string | undefined,
      createdAt: createdAt ? OneUptimeDate.fromString(createdAt) : undefined,
      durationInMs: resultSummary["durationInMs"] as number | undefined,
      contentPayload: eventJson["contentPayload"] as
        | AIRunEventContentPayload
        | undefined,
    };
  });
};

type ToLlmCallLogsFunction = (
  llmLogsJson: Array<JSONObject>,
) => Array<LlmCallLog>;

const toLlmCallLogs: ToLlmCallLogsFunction = (
  llmLogsJson: Array<JSONObject>,
): Array<LlmCallLog> => {
  return llmLogsJson.map((logJson: JSONObject, index: number) => {
    const startedAt: string | undefined = logJson["requestStartedAt"] as
      | string
      | undefined;

    return {
      key: (logJson["_id"] as string) || `llm-${index}`,
      modelName: (logJson["modelName"] as string) || "Unknown model",
      providerName: (logJson["llmProviderName"] as string) || "",
      status: (logJson["status"] as string) || "",
      statusMessage: (logJson["statusMessage"] as string) || "",
      totalTokens: logJson["totalTokens"] as number | undefined,
      completionTokens: logJson["completionTokens"] as number | undefined,
      durationMs: logJson["durationMs"] as number | undefined,
      startedAt: startedAt ? OneUptimeDate.fromString(startedAt) : undefined,
    };
  });
};

/*
 * One step, collapsed to its narration. Expanding reveals the verbatim
 * content behind it — what the model was sent, what it said, what a tool
 * returned. Collapsed by default: a run can log hundreds of steps, and the
 * point of the list is to find the interesting one.
 */
const LogEntryRow: FunctionComponent<{
  entry: LogEntry;
}> = (props: { entry: LogEntry }): ReactElement => {
  const { entry } = props;

  const [isExpanded, setIsExpanded] = useState<boolean>(false);

  const hasContent: boolean = Boolean(
    entry.contentPayload &&
      (entry.contentPayload.requestMessages?.length ||
        entry.contentPayload.responseContent ||
        entry.contentPayload.toolResult ||
        entry.contentPayload.responseToolCalls?.length),
  );

  const header: ReactElement = (
    <div className="flex w-full items-center gap-3 text-left">
      <Icon
        icon={
          hasContent
            ? isExpanded
              ? IconProp.ChevronDown
              : IconProp.ChevronRight
            : IconProp.Circle
        }
        className={`h-3 w-3 shrink-0 ${
          hasContent ? "text-gray-500" : "text-gray-200"
        }`}
      />
      <span className="shrink-0 font-mono text-xs text-gray-400">
        {formatTimestamp(entry.createdAt)}
      </span>
      <Pill
        text={getEntryLabel(entry)}
        color={getEntryColor(entry)}
        isMinimal={true}
      />
      <span
        className={`truncate text-sm ${
          isFailureEntry(entry) ? "text-red-600" : "text-gray-700"
        }`}
      >
        {entry.message || "(no message)"}
      </span>
      {entry.durationInMs !== undefined ? (
        <span className="ml-auto shrink-0 text-xs text-gray-400">
          {entry.durationInMs} ms
        </span>
      ) : (
        <></>
      )}
    </div>
  );

  if (!hasContent) {
    return <div className="border-b border-gray-100 py-2">{header}</div>;
  }

  return (
    <div className="border-b border-gray-100">
      <div
        className="cursor-pointer select-none py-2"
        onClick={() => {
          setIsExpanded(!isExpanded);
        }}
        role="button"
        tabIndex={0}
        aria-expanded={isExpanded}
        onKeyDown={(e: React.KeyboardEvent) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            setIsExpanded(!isExpanded);
          }
        }}
      >
        {header}
      </div>
      {isExpanded ? (
        <div className="space-y-3 pb-3 pl-6">
          <ContentPayloadView payload={entry.contentPayload!} />
        </div>
      ) : (
        <></>
      )}
    </div>
  );
};

// The verbatim content behind one step.
const ContentPayloadView: FunctionComponent<{
  payload: AIRunEventContentPayload;
}> = (props: { payload: AIRunEventContentPayload }): ReactElement => {
  const { payload } = props;

  return (
    <Fragment>
      {payload.isTruncated ? (
        <p className="text-xs text-yellow-700">
          Some content below was clipped at its storage cap.
        </p>
      ) : (
        <></>
      )}

      {payload.requestMessages?.length ? (
        <div>
          <p className="mb-1 text-xs font-medium text-gray-500">
            Sent to the model
          </p>
          <CodeBlock
            language="text"
            maxHeight="24rem"
            code={payload.requestMessages
              .map((message: { role: string; content: string }) => {
                return `[${message.role}]\n${message.content}`;
              })
              .join("\n\n")}
          />
        </div>
      ) : (
        <></>
      )}

      {payload.responseContent ? (
        <div>
          <p className="mb-1 text-xs font-medium text-gray-500">
            Model replied
            {payload.modelName ? ` (${payload.modelName})` : ""}
          </p>
          <CodeBlock
            language="text"
            maxHeight="24rem"
            code={payload.responseContent}
          />
        </div>
      ) : (
        <></>
      )}

      {payload.responseToolCalls?.length ? (
        <div>
          <p className="mb-1 text-xs font-medium text-gray-500">
            Tool arguments
          </p>
          <CodeBlock
            language="json"
            maxHeight="20rem"
            code={JSON.stringify(payload.responseToolCalls, null, 2)}
          />
        </div>
      ) : (
        <></>
      )}

      {payload.toolResult ? (
        <div>
          <p className="mb-1 text-xs font-medium text-gray-500">
            Tool returned
          </p>
          <CodeBlock
            language="text"
            maxHeight="24rem"
            code={payload.toolResult}
          />
        </div>
      ) : (
        <></>
      )}

      {payload.totalTokens !== undefined || payload.stopReason ? (
        <p className="text-xs text-gray-400">
          {payload.stopReason ? `Stop reason: ${payload.stopReason}. ` : ""}
          {payload.completionTokens !== undefined
            ? `${payload.completionTokens} completion tokens. `
            : ""}
          {payload.totalTokens !== undefined
            ? `${payload.totalTokens} total tokens.`
            : ""}
        </p>
      ) : (
        <></>
      )}
    </Fragment>
  );
};

const LlmCallRow: FunctionComponent<{ call: LlmCallLog }> = (props: {
  call: LlmCallLog;
}): ReactElement => {
  const { call } = props;

  const isError: boolean = call.status.toLowerCase() === "error";

  return (
    <div className="flex items-center gap-3 border-b border-gray-100 py-2">
      <span className="shrink-0 font-mono text-xs text-gray-400">
        {formatTimestamp(call.startedAt)}
      </span>
      <Pill
        text={call.status || "Unknown"}
        color={isError ? Red : Green}
        isMinimal={true}
      />
      <span className="text-sm text-gray-700">
        {call.modelName}
        {call.providerName ? ` · ${call.providerName}` : ""}
      </span>
      {isError && call.statusMessage ? (
        <span className="text-sm text-red-600">{call.statusMessage}</span>
      ) : (
        <></>
      )}
      <span className="ml-auto shrink-0 text-xs text-gray-400">
        {call.totalTokens !== undefined ? `${call.totalTokens} tokens` : ""}
        {call.durationMs !== undefined ? ` · ${call.durationMs} ms` : ""}
      </span>
    </div>
  );
};

const AIAgentTaskLogsPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const { id } = useParams();

  const [entries, setEntries] = useState<Array<LogEntry>>([]);
  const [llmCalls, setLlmCalls] = useState<Array<LlmCallLog>>([]);
  const [status, setStatus] = useState<AIRunStatus | undefined>(undefined);
  const [canReadContent, setCanReadContent] = useState<boolean>(false);
  const [error, setError] = useState<string | undefined>(undefined);
  const [hasLoadedOnce, setHasLoadedOnce] = useState<boolean>(false);
  const signatureRef: React.MutableRefObject<string> = useRef<string>("");

  const fetchData: () => Promise<void> =
    useCallback(async (): Promise<void> => {
      try {
        const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
          await API.post<JSONObject>({
            url: URL.fromString(APP_API_URL.toString()).addRoute(
              `/code-fix-run/logs/${id || ""}`,
            ),
            data: {},
            headers: ModelAPI.getCommonHeaders(),
          });

        if (response instanceof HTTPErrorResponse) {
          throw response;
        }

        const data: JSONObject = response.data as JSONObject;
        const runJson: JSONObject | null =
          (data["run"] as JSONObject | null) || null;
        const eventsJson: JSONArray = (data["events"] as JSONArray) || [];
        const llmLogsJson: JSONArray = (data["llmLogs"] as JSONArray) || [];

        const runStatus: string =
          (runJson?.["status"] as string | undefined) || "none";

        /*
         * Re-render only when something actually changed. A 5s poll that
         * rebuilt the tree every tick would collapse whichever step the
         * reader had just opened.
         */
        const signature: string = `${runStatus}:${eventsJson.length}:${llmLogsJson.length}`;

        if (signature !== signatureRef.current) {
          signatureRef.current = signature;
          setStatus(runJson?.["status"] as AIRunStatus | undefined);
          setCanReadContent(data["canReadContent"] === true);
          setEntries(toLogEntries(eventsJson as Array<JSONObject>));
          setLlmCalls(toLlmCallLogs(llmLogsJson as Array<JSONObject>));
        }

        setError(undefined);
        setHasLoadedOnce(true);
      } catch (err) {
        // Keep already-loaded data on transient poll failures.
        if (!signatureRef.current) {
          setError(API.getFriendlyMessage(err));
        }
        setHasLoadedOnce(true);
      }
    }, [id]);

  useEffect(() => {
    fetchData().catch(() => {
      // handled inside fetchData
    });
  }, [fetchData]);

  const isActive: boolean = Boolean(
    status && !AIRunStatusHelper.isTerminalStatus(status),
  );

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

  if (!hasLoadedOnce) {
    return <PageLoader isVisible={true} />;
  }

  if (error && entries.length === 0) {
    return <ErrorMessage message={error} />;
  }

  return (
    <Fragment>
      <div className="space-y-5">
        {!canReadContent ? (
          <Alert
            type={AlertType.INFO}
            strongTitle="Prompts and model output are hidden"
            title={
              "These embed your source code, so only project owners and admins can read them. Everything else about the run is shown below."
            }
          />
        ) : (
          <></>
        )}

        <Card
          title="Session Log"
          description={
            isActive
              ? "Every step this task has taken so far. Updates every 5 seconds."
              : "Every step this task took, in order. Expand a step to see what the model was sent and what it said."
          }
        >
          {entries.length === 0 ? (
            <EmptyState
              id="ai-task-logs-empty"
              icon={IconProp.List}
              title={isActive ? "Nothing logged yet" : "No logs"}
              description={
                isActive
                  ? "This task has not reported a step yet. This page updates on its own."
                  : "This task recorded no steps. If it failed before starting, the reason is on the Overview."
              }
            />
          ) : (
            <div className="space-y-1">
              {entries.map((entry: LogEntry) => {
                return <LogEntryRow key={entry.key} entry={entry} />;
              })}
            </div>
          )}
        </Card>

        {llmCalls.length > 0 ? (
          <Card
            title="LLM Calls"
            description="Each model call this task made, with its tokens and timing."
          >
            <div className="space-y-1">
              {llmCalls.map((call: LlmCallLog) => {
                return <LlmCallRow key={call.key} call={call} />;
              })}
            </div>
          </Card>
        ) : (
          <></>
        )}
      </div>
    </Fragment>
  );
};

export default AIAgentTaskLogsPage;
