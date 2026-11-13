import PageComponentProps from "../../PageComponentProps";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useParams } from "react-router-dom";
import AIRunStatus, { AIRunStatusHelper } from "Common/Types/AI/AIRunStatus";
import AIRunEventType from "Common/Types/AI/AIRunEventType";
import { LlmProviderActivity } from "Common/Types/AI/LlmProviderChoice";
import { describeRuleLlmProviderActivity } from "../../../Components/AI/RuleLlmProviderCopy";
import AiTokenCount from "Common/Types/AI/AiTokenCount";
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
import IsolatedText from "Common/UI/Components/IsolatedText/IsolatedText";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import Pill from "Common/UI/Components/Pill/Pill";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import Navigation from "Common/UI/Utils/Navigation";
import ObjectID from "Common/Types/ObjectID";
import Route from "Common/Types/API/Route";
import LinkComponent from "Common/UI/Components/Link/Link";
import { usePageBreadcrumbLinks } from "Common/UI/Components/Page/Page";
import Link from "Common/Types/Link";
import CodeApi, { CodeTaskResponse } from "../../../Components/Code/CodeApi";
import { getCodeTaskTrail } from "../../../Components/Code/CodeTaskTrail";
import {
  CODE_TASK_LOG_TURN_COPY,
  CodeTaskLogPickerEntry,
  CodeTaskLogRecordCopy,
  CodeTaskLogShownTurn,
  CodeTaskLogTurn,
  getCodeTaskLogPickerEntries,
  getCodeTaskLogRecordCopy,
  getCodeTaskLogShownTurn,
  getCodeTaskLogTurnKey,
  getCodeTaskLogTurnRoute,
  isCodeTaskLogTurnOf,
} from "../../../Components/Code/CodeTaskLogTurns";
import { CODE_TASK_TURNS_NOT_SHOWN_COPY } from "../../../Components/Code/CodeTaskTurnsNotShown";
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import useCodeTaskLive from "../../../Components/Code/UseCodeTaskLive";
import ProjectUtil from "Common/UI/Utils/Project";

/*
 * While the turn works, the record reads again as each of its steps is
 * announced (CodeTaskLive) - at most once a second, the whole record being
 * read each time - and on its own every five seconds while it hears none.
 */
export const CODE_TASK_LOG_LIVE_MIN_INTERVAL_MS: number = 1000;
export const CODE_TASK_LOG_POLL_MS: number = 5000;

export const CODE_TASK_LOG_TURN_PICKER_TEST_ID: string =
  "code-task-log-turn-picker";

/*
 * The value of the picker's line where a long task's turns are not listed
 * - never picked, so never a turn's. A turn a link names between them
 * splits the line in two: the second line's value ends "-2".
 */
export const CODE_TASK_LOG_TURNS_NOT_SHOWN_VALUE: string = "turns-not-shown";

// The page's word that the turn its address names is not one of the task's.
export const CODE_TASK_LOG_TURN_NOT_OF_TASK_TEST_ID: string =
  "code-task-log-turn-not-of-task";

// A read of the task: what came back, and what it was read for.
interface CodeTaskLogTaskRead {
  response: CodeTaskResponse;
  // The task it is of, its id in lower case.
  taskId: string;
  // The address's turn it was read for (getCodeTaskLogTurnKey: "" for none).
  turn: string;
}

/*
 * A task's Log page in Code: everything recorded about one of its turns (one
 * code-fix run), in the order it happened - the page you open when a task
 * did something you did not expect. The conversation shows the same steps
 * in plain words; this is the verbatim record. Which turn is the `turn`
 * query parameter (the conversation links each turn's Log); without one,
 * the task's first turn. A task of more than one turn lists them all in a
 * picker at the top (CodeTaskLogTurns), so another turn's record is one
 * pick away. A long task's turn its conversation does not show is asked for
 * by name, so a link to it opens it (issue #7130); a link to a run of
 * another task opens the task's first turn, and says so.
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
  // Of them, read from and written to the provider's prompt cache.
  cachedInputTokens: number | undefined;
  cacheCreationTokens: number | undefined;
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
  /*
   * The LLM provider a run's rule picked, or why it used another: the step's
   * message says it in English, and this is the same line as data, so the
   * step reads it in the reader's language (as the conversation does).
   */
  llmProvider: LlmProviderActivity | undefined;
  severity: string | undefined;
  createdAt: Date | undefined;
  durationInMs: number | undefined;
  contentPayload: AIRunEventContentPayload | undefined;
}

type ReadLlmProviderActivityFunction = (
  value: unknown,
) => LlmProviderActivity | undefined;

const readLlmProviderActivity: ReadLlmProviderActivityFunction = (
  value: unknown,
): LlmProviderActivity | undefined => {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as LlmProviderActivity)
    : undefined;
};

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
      llmProvider: readLlmProviderActivity(resultSummary["llmProvider"]),
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
      cachedInputTokens: logJson["cachedInputTokens"] as number | undefined,
      cacheCreationTokens: logJson["cacheCreationTokens"] as number | undefined,
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
  const translator: Translator = useTranslator();
  const { entry } = props;

  const [isExpanded, setIsExpanded] = useState<boolean>(false);

  const hasContent: boolean = Boolean(
    entry.contentPayload &&
      (entry.contentPayload.requestMessages?.length ||
        entry.contentPayload.responseContent ||
        entry.contentPayload.toolResult ||
        entry.contentPayload.responseToolCalls?.length),
  );

  /*
   * One line on a wide screen. On a phone the time and the tool's pill
   * fill a line on their own, so the step's words take the next line -
   * lined up with the time, as a pill that does not fit beside the time is
   * - rather than being cut to nothing.
   */
  const header: ReactElement = (
    <div className="flex w-full items-center gap-3 text-left max-sm:items-start">
      <Icon
        icon={
          hasContent
            ? isExpanded
              ? IconProp.ChevronDown
              : IconProp.ChevronRight
            : IconProp.Circle
        }
        className={`h-3 w-3 shrink-0 max-sm:mt-1 ${
          hasContent ? "text-gray-500" : "text-gray-400"
        }`}
      />
      <div className="flex min-w-0 flex-1 items-center gap-x-3 gap-y-0.5 max-sm:flex-wrap">
        <span className="shrink-0 font-mono text-xs text-gray-400">
          {formatTimestamp(entry.createdAt)}
        </span>
        <Pill
          text={getEntryLabel(entry)}
          color={getEntryColor(entry)}
          isMinimal={true}
        />
        <span
          data-testid="code-task-log-entry-message"
          className={`truncate text-sm max-sm:order-last max-sm:basis-full ${
            isFailureEntry(entry) ? "text-red-600" : "text-gray-700"
          }`}
        >
          {/*
            What the Runner wrote - a path, a search, a command - read the
            way it is written: on a Persian page "isExpired(" keeps its
            bracket at its end.
          */}
          {entry.llmProvider ? (
            describeRuleLlmProviderActivity(entry.llmProvider, translator)
          ) : entry.message ? (
            <IsolatedText text={entry.message} />
          ) : (
            translator.translateText("(no message)")
          )}
        </span>
        {entry.durationInMs !== undefined ? (
          <span className="ml-auto shrink-0 text-xs text-gray-400">
            {entry.durationInMs} ms
          </span>
        ) : (
          <></>
        )}
      </div>
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
  const translator: Translator = useTranslator();
  const { payload } = props;

  // The usage line under a model call: one sentence per fact that is known.
  const usageSentences: Array<string> = [
    payload.stopReason
      ? translator.translateTemplate("Stop reason: {{stopReason}}.", {
          stopReason: payload.stopReason,
        })
      : "",
    payload.completionTokens !== undefined
      ? translator.translatePlural(
          {
            one: "{{count}} completion token.",
            other: "{{count}} completion tokens.",
          },
          payload.completionTokens,
        )
      : "",
    payload.totalTokens !== undefined
      ? translator.translatePlural(
          {
            one: "{{count}} total token.",
            other: "{{count}} total tokens.",
          },
          payload.totalTokens,
        )
      : "",
  ].filter((sentence: string): boolean => {
    return sentence.length > 0;
  });

  return (
    <Fragment>
      {payload.isTruncated ? (
        <p className="text-xs text-yellow-700">
          {translator.translateText(
            "Some content below was clipped at its storage cap.",
          )}
        </p>
      ) : (
        <></>
      )}

      {payload.requestMessages?.length ? (
        <div>
          <p className="mb-1 text-xs font-medium text-gray-500">
            {translator.translateText("Sent to the model")}
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
            {payload.modelName
              ? translator.translateTemplate("Model replied ({{modelName}})", {
                  modelName: payload.modelName,
                })
              : translator.translateText("Model replied")}
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
            {translator.translateText("Tool arguments")}
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
            {translator.translateText("Tool returned")}
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
        <p className="text-xs text-gray-400">{usageSentences.join(" ")}</p>
      ) : (
        <></>
      )}
    </Fragment>
  );
};

const LlmCallRow: FunctionComponent<{ call: LlmCallLog }> = (props: {
  call: LlmCallLog;
}): ReactElement => {
  const translator: Translator = useTranslator();
  const { call } = props;

  const isError: boolean = call.status.toLowerCase() === "error";

  return (
    <div className="flex items-center gap-x-3 gap-y-0.5 border-b border-gray-100 py-2 max-sm:flex-wrap">
      <span className="shrink-0 font-mono text-xs text-gray-400">
        {formatTimestamp(call.startedAt)}
      </span>
      <Pill
        text={call.status || "Unknown"}
        color={isError ? Red : Green}
        isMinimal={true}
      />
      <span className="min-w-0 break-words text-sm text-gray-700 max-sm:order-last max-sm:basis-full">
        {call.modelName}
        {call.providerName ? ` · ${call.providerName}` : ""}
      </span>
      {isError && call.statusMessage ? (
        <span className="min-w-0 break-words text-sm text-red-600 max-sm:order-last max-sm:basis-full">
          {call.statusMessage}
        </span>
      ) : (
        <></>
      )}
      <span
        data-testid="code-log-call-tokens"
        className="ml-auto shrink-0 text-xs text-gray-400"
      >
        {/*
         * As the AI Logs count a call (AiTokenCount): a token the prompt
         * cache served, or took, counts at what the call's model charges
         * for it next to a fresh token.
         */}
        {call.totalTokens !== undefined
          ? translator.translatePlural(
              { one: "{{count}} token", other: "{{count}} tokens" },
              AiTokenCount.count({
                totalTokens: call.totalTokens,
                cachedInputTokens: call.cachedInputTokens,
                cacheCreationTokens: call.cacheCreationTokens,
                modelName: call.modelName,
              }),
            )
          : ""}
        {call.durationMs !== undefined ? ` · ${call.durationMs} ms` : ""}
      </span>
    </div>
  );
};

/*
 * The task's turns, one pick away: "Turn 2 · Failed", with what was asked
 * under each. Only for a task of more than one turn.
 *
 * A long task lists the turns its conversation shows - its first and its
 * newest - and between them, where the conversation draws its line, the
 * same words on a line that is never picked: "7 earlier turns are not
 * shown". Turn 1 then Turn 9 reads as the task's own numbering, not as
 * turns gone missing. A turn between them that the address names is
 * listed at its place, with a line on each side of it.
 */
const CodeTaskLogTurnPicker: FunctionComponent<{
  taskId: string;
  entries: Array<CodeTaskLogPickerEntry>;
  shownRunId: string;
}> = (props: {
  taskId: string;
  entries: Array<CodeTaskLogPickerEntry>;
  shownRunId: string;
}): ReactElement => {
  const translator: Translator = useTranslator();

  let lines: number = 0;

  const options: Array<DropdownOption> = props.entries.map(
    (entry: CodeTaskLogPickerEntry): DropdownOption => {
      if (entry.kind === "turnsNotShown") {
        lines++;

        return {
          value:
            lines === 1
              ? CODE_TASK_LOG_TURNS_NOT_SHOWN_VALUE
              : `${CODE_TASK_LOG_TURNS_NOT_SHOWN_VALUE}-${lines}`,
          label: translator.translatePlural(
            CODE_TASK_TURNS_NOT_SHOWN_COPY,
            entry.count,
          ),
          // Never picked: the Dropdown passes it by.
          isDisabled: true,
          // Translated here, whole: drawn as it is, the page's way.
          isUserContent: true,
          isInPageDirection: true,
        };
      }

      const turn: CodeTaskLogTurn = entry.turn;
      const description: string = turn.isSummaryTranslated
        ? translator.translateText(turn.summary) || turn.summary
        : turn.summary;

      return {
        value: turn.runId,
        label: `${translator.translateTemplate(CODE_TASK_LOG_TURN_COPY.option, {
          number: translator.formatNumber(turn.number),
        })} · ${translator.translateText(turn.stateLabel) || turn.stateLabel}`,
        ...(description ? { description } : {}),
        // Translated here, part by part; the request is as its person wrote it.
        isUserContent: true,
        /*
         * What was asked, as it was written - or what started the turn,
         * translated above: never looked up again, and read the way its
         * words are, so an English request on an Arabic page keeps its
         * full stop at its end.
         */
        isDescriptionUserContent: true,
      };
    },
  );

  const shown: DropdownOption | undefined = options.find(
    (option: DropdownOption): boolean => {
      return (
        !option.isDisabled &&
        String(option.value).toLowerCase() === props.shownRunId.toLowerCase()
      );
    },
  );

  return (
    <div
      className="w-full sm:w-72"
      data-testid={CODE_TASK_LOG_TURN_PICKER_TEST_ID}
    >
      <Dropdown
        options={options}
        value={shown}
        ariaLabel={CODE_TASK_LOG_TURN_COPY.label}
        // A turn is always shown: there is nothing to clear it to.
        isClearable={false}
        dataTestId={`${CODE_TASK_LOG_TURN_PICKER_TEST_ID}-dropdown`}
        onChange={(
          value: DropdownValue | Array<DropdownValue> | null,
        ): void => {
          const runId: string = Array.isArray(value)
            ? String(value[0] ?? "")
            : String(value ?? "");

          if (
            !runId ||
            runId.toLowerCase() === props.shownRunId.toLowerCase()
          ) {
            return;
          }

          Navigation.navigate(
            getCodeTaskLogTurnRoute({ taskId: props.taskId, runId: runId }),
          );
        }}
      />
    </div>
  );
};

const CodeTaskLogPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const { id } = useParams();
  const turnParam: string | null = Navigation.getQueryStringByName("turn");
  // The turn the address names, as the task is asked for it ("" for none).
  const turnKey: string = getCodeTaskLogTurnKey(turnParam);
  const isTaskIdValid: boolean = Boolean(id && ObjectID.isValidUUID(id));

  const [entries, setEntries] = useState<Array<LogEntry>>([]);
  const [llmCalls, setLlmCalls] = useState<Array<LlmCallLog>>([]);
  const [status, setStatus] = useState<AIRunStatus | undefined>(undefined);
  const [canReadContent, setCanReadContent] = useState<boolean>(false);
  const [error, setError] = useState<string | undefined>(undefined);
  /*
   * The turn whose record the page holds - read, or failed to read. The
   * record is drawn only under that turn: the render that moves the page
   * to another turn (a pick, or the task's first turn taking the place of
   * another task's run the address named) still holds the record before,
   * until an effect clears it, and drawn then, it was on the screen for a
   * frame under the wrong turn - another task's steps under this task's
   * name.
   */
  const [loadedRunId, setLoadedRunId] = useState<string | null>(null);
  const signatureRef: React.MutableRefObject<string> = useRef<string>("");

  // The task the address names, as its reads are keyed.
  const taskKey: string = (id || "").toLowerCase();

  /*
   * The task as read, with the address's turn it was read for: a turn its
   * conversation does not show is asked for by name (linkedTurn). A read
   * of another task - the page stays on the screen when a link opens
   * another task's Log - is no read of this one.
   */
  const [taskRead, setTaskRead] = useState<CodeTaskLogTaskRead | null>(null);
  // The task and turn ("task:turn") whose read failed.
  const [taskReadFailedFor, setTaskReadFailedFor] = useState<string | null>(
    null,
  );
  const currentRead: CodeTaskLogTaskRead | null =
    taskRead && taskRead.taskId === taskKey ? taskRead : null;
  const task: CodeTaskResponse | null = currentRead?.response || null;

  /*
   * The turn shown: the one the address names once the task's read says
   * it is one of the task's turns, else the task's first - said so on the
   * page. Its record is read meanwhile, but not shown until then.
   */
  const shownTurn: CodeTaskLogShownTurn = getCodeTaskLogShownTurn({
    taskId: id || "",
    turnParam,
    task,
    taskReadFor: currentRead?.turn,
    hasTaskReadFailed:
      !isTaskIdValid || taskReadFailedFor === `${taskKey}:${turnKey}`,
  });
  const runId: string = shownTurn.runId;
  const hasLoadedOnce: boolean = loadedRunId === runId;

  const pickerEntries: Array<CodeTaskLogPickerEntry> = useMemo(() => {
    // A long task's newer turns keep their places past the ones not shown.
    return getCodeTaskLogPickerEntries({
      turns: task?.turns || [],
      turnsNotShown: task?.turnsNotShown?.count || 0,
      linkedTurn: task?.linkedTurn,
    });
  }, [task]);

  const listedTurnCount: number = pickerEntries.filter(
    (entry: CodeTaskLogPickerEntry): boolean => {
      return entry.kind === "turn";
    },
  ).length;

  // "this task", or "this turn" once the picker lists more than one.
  const recordCopy: CodeTaskLogRecordCopy =
    getCodeTaskLogRecordCopy(listedTurnCount);

  /*
   * Another turn picked: its record starts from nothing, so nothing of the
   * turn before stays on the page while it is read.
   */
  const shownRunIdRef: React.MutableRefObject<string> = useRef<string>(runId);

  if (shownRunIdRef.current !== runId) {
    shownRunIdRef.current = runId;
    signatureRef.current = "";
  }

  useEffect(() => {
    setEntries([]);
    setLlmCalls([]);
    setStatus(undefined);
    setError(undefined);
    setLoadedRunId(null);
  }, [runId]);

  /*
   * The task, read for its turns and for the trail - Code > the repository
   * > Task #42 > Log - which the address alone cannot name. Read again for
   * an address that names another task, or a turn the read does not hold.
   * A task that cannot be read keeps the address's trail.
   */
  const taskReadRef: React.MutableRefObject<CodeTaskLogTaskRead | null> =
    useRef<CodeTaskLogTaskRead | null>(null);
  taskReadRef.current = taskRead;

  /*
   * The read the page wants ("task:turn"): an answer to any other - one
   * still on its way when the address moved on - is dropped.
   */
  const wantedReadRef: React.MutableRefObject<string | null> = useRef<
    string | null
  >(null);

  useEffect(() => {
    if (!id || !ObjectID.isValidUUID(id)) {
      return;
    }

    const read: CodeTaskLogTaskRead | null = taskReadRef.current;

    if (
      read &&
      read.taskId === taskKey &&
      (read.turn === turnKey || isCodeTaskLogTurnOf(read.response, turnKey))
    ) {
      // The read the page has holds the turn: nothing on its way is wanted.
      wantedReadRef.current = `${read.taskId}:${read.turn}`;
      return;
    }

    const wanted: string = `${taskKey}:${turnKey}`;
    wantedReadRef.current = wanted;

    CodeApi.getTask(id, turnKey ? { turn: turnKey } : {})
      .then((response: CodeTaskResponse) => {
        if (wantedReadRef.current !== wanted) {
          return;
        }

        setTaskRead({ response, taskId: taskKey, turn: turnKey });
        setTaskReadFailedFor(null);
      })
      .catch(() => {
        if (wantedReadRef.current !== wanted) {
          return;
        }

        // The trail stays Code > Task > Log, and the address's turn is shown.
        setTaskReadFailedFor(wanted);
      });
  }, [id, taskKey, turnKey]);

  const breadcrumbs: Array<Link> | null = useMemo(() => {
    if (!task || !id) {
      return null;
    }

    return getCodeTaskTrail({
      taskId: id,
      response: task,
      translator: translator,
      isLog: true,
    });
  }, [
    task?.repository?.id,
    task?.repository?.name,
    task?.task.taskNumber,
    translator.language,
  ]);

  usePageBreadcrumbLinks(breadcrumbs);

  const fetchData: () => Promise<void> =
    useCallback(async (): Promise<void> => {
      try {
        const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
          await API.post<JSONObject>({
            url: URL.fromString(APP_API_URL.toString()).addRoute(
              `/code-fix-run/logs/${runId}`,
            ),
            data: {},
            headers: ModelAPI.getCommonHeaders(),
          });

        /*
         * Another turn was picked while this one was read: its answer is
         * not the page's any more.
         */
        if (shownRunIdRef.current !== runId) {
          return;
        }

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
         * Re-render only when something actually changed. A read that
         * rebuilt the tree every time would collapse whichever step the
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
        setLoadedRunId(runId);
      } catch (err) {
        if (shownRunIdRef.current !== runId) {
          return;
        }

        // Keep already-loaded data on transient poll failures.
        if (!signatureRef.current) {
          setError(API.getFriendlyMessage(err));
        }
        setLoadedRunId(runId);
      }
    }, [runId]);

  useEffect(() => {
    fetchData().catch(() => {
      // handled inside fetchData
    });
  }, [fetchData]);

  const isActive: boolean = Boolean(
    status && !AIRunStatusHelper.isTerminalStatus(status),
  );

  useCodeTaskLive({
    projectId: ProjectUtil.getCurrentProjectId(),
    // The turn shown: its own room hears its every step.
    recordId: runId,
    isWorking: isActive,
    refresh: fetchData,
    pollMs: CODE_TASK_LOG_POLL_MS,
    minIntervalMs: CODE_TASK_LOG_LIVE_MIN_INTERVAL_MS,
  });

  const conversationRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.CODE_TASK_VIEW] as Route,
    { modelId: new ObjectID(id || "") },
  );

  /*
   * The way back, and the task's turns: in sight whichever turn's record is
   * on its way, so picking another never blanks the page.
   */
  const header: ReactElement = (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <LinkComponent
        to={conversationRoute}
        dataTestId="code-task-log-back"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-gray-500 hover:text-gray-700"
      >
        <>
          <Icon icon={IconProp.ArrowLeft} className="h-4 w-4" />
          {translator.translateText("Back to the conversation")}
        </>
      </LinkComponent>
      {listedTurnCount > 1 ? (
        <CodeTaskLogTurnPicker
          taskId={id || ""}
          entries={pickerEntries}
          shownRunId={runId}
        />
      ) : (
        <></>
      )}
    </div>
  );

  /*
   * The address named a run that is not one of the task's turns - another
   * task's, one gone, or no run's id at all (a link cut short): the task's
   * first turn is shown, and said so.
   */
  const notOfTask: ReactElement = shownTurn.isNotOfTask ? (
    <Alert
      type={AlertType.WARNING}
      strongTitle="That turn is not part of this task"
      title="The task's first turn is shown instead."
      dataTestId={CODE_TASK_LOG_TURN_NOT_OF_TASK_TEST_ID}
    />
  ) : (
    <></>
  );

  // Said as soon as it is known, while the first turn's record is read.
  if (!hasLoadedOnce || !shownTurn.isKnown) {
    return (
      <div className="space-y-5">
        {header}
        {notOfTask}
        <PageLoader isVisible={true} />
      </div>
    );
  }

  /*
   * The turn's record could not be read: said under the way back and the
   * picker, with a way to read it again - a finished turn's page does not
   * poll, so nothing else would.
   */
  if (error && entries.length === 0) {
    return (
      <div className="space-y-5">
        {header}
        {notOfTask}
        <ErrorMessage
          message={error}
          onRefreshClick={(): void => {
            fetchData().catch(() => {
              // handled inside fetchData
            });
          }}
        />
      </div>
    );
  }

  return (
    <Fragment>
      <div className="space-y-5">
        {header}

        {notOfTask}

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
          description={isActive ? recordCopy.stepsSoFar : recordCopy.steps}
        >
          {entries.length === 0 ? (
            <EmptyState
              id="ai-task-logs-empty"
              icon={IconProp.List}
              title={isActive ? "Nothing logged yet" : "No logs"}
              description={
                isActive ? recordCopy.nothingYet : recordCopy.nothing
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
          <Card title="LLM Calls" description={recordCopy.calls}>
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

export default CodeTaskLogPage;
