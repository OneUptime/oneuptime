import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useRef,
  useState,
} from "react";
import Route from "Common/Types/API/Route";
import API from "Common/UI/Utils/API/API";
import MonitorStepLlmMonitor, {
  MonitorStepLlmMonitorUtil,
} from "Common/Types/Monitor/MonitorStepLlmMonitor";
import { LlmAnswerStatsResponse } from "Common/Types/Telemetry/LlmConversationApi";
import TimeRange from "Common/Types/Time/TimeRange";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { RouteUtil } from "../../Utils/RouteMap";
import PageMap from "../../Utils/PageMap";
import AppLink from "../AppLink/AppLink";
import { fetchLlmAnswerStats } from "../LlmConversations/LlmConversationsApi";
import { formatLlmCount } from "../LlmConversations/LlmConversationFormat";
import { getLlmMonitorWindowLabel } from "./LlmMonitorWindow";

/*
 * What an AI / LLM monitor with these settings would count right now: the
 * answers in its window, how many were bad and their share. Read from the
 * server with the same query the monitor's check runs, so tuning "what
 * counts as bad" shows its effect before the monitor is saved.
 */

export interface ComponentProps {
  step: MonitorStepLlmMonitor;
}

// Settings typed in a burst are read once they settle.
export const LLM_MONITOR_PREVIEW_DEBOUNCE_MS: number = 500;

type LoadState =
  | { kind: "loading" }
  | { kind: "loaded"; stats: LlmAnswerStatsResponse }
  | { kind: "error"; message: string };

// The conversations the numbers came from, in the list, problems first.
export function getLlmPreviewConversationsRoute(
  stats: LlmAnswerStatsResponse,
): Route {
  return RouteUtil.getPageRoute(PageMap.LLM_CONVERSATIONS, {
    query: {
      range: TimeRange.CUSTOM,
      start: stats.startTime,
      end: stats.endTime,
      issue: "any",
    },
  });
}

const Figure: FunctionComponent<{
  label: string;
  value: string;
  tone: "neutral" | "bad";
  dataTestId: string;
}> = (props: {
  label: string;
  value: string;
  tone: "neutral" | "bad";
  dataTestId: string;
}): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <div className="min-w-0" data-testid={props.dataTestId}>
      <div className="text-xs text-gray-500">
        {translator.translateText(props.label)}
      </div>
      <div
        className={`mt-0.5 text-lg font-semibold ${
          props.tone === "bad" ? "text-red-700" : "text-gray-900"
        }`}
        data-testid={`${props.dataTestId}-value`}
      >
        {props.value}
      </div>
    </div>
  );
};

const LlmMonitorPreview: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const sequenceRef: React.MutableRefObject<number> = useRef<number>(0);

  // One key per distinct setting, so an unchanged step reads nothing again.
  const stepKey: string = JSON.stringify(
    MonitorStepLlmMonitorUtil.toJSON(props.step),
  );

  useEffect(() => {
    const sequence: number = ++sequenceRef.current;
    setState({ kind: "loading" });

    const timer: ReturnType<typeof setTimeout> = setTimeout(() => {
      fetchLlmAnswerStats(props.step)
        .then((stats: LlmAnswerStatsResponse | null) => {
          if (sequence !== sequenceRef.current) {
            return;
          }

          setState(
            stats
              ? { kind: "loaded", stats: stats }
              : {
                  kind: "error",
                  message:
                    translator.translateText(
                      "The preview could not be read.",
                    ) || "",
                },
          );
        })
        .catch((error: unknown) => {
          if (sequence !== sequenceRef.current) {
            return;
          }

          setState({
            kind: "error",
            message: API.getFriendlyMessage(error as Error),
          });
        });
    }, LLM_MONITOR_PREVIEW_DEBOUNCE_MS);

    return () => {
      clearTimeout(timer);
    };
  }, [stepKey]);

  const windowText: string = getLlmMonitorWindowLabel(
    MonitorStepLlmMonitorUtil.fromJSON(
      MonitorStepLlmMonitorUtil.toJSON(props.step),
    ).lastXSecondsOfCalls,
    translator,
  );

  return (
    <div
      className="rounded-lg bg-gray-50 px-4 py-3 ring-1 ring-inset ring-gray-200"
      data-testid="llm-monitor-preview"
    >
      <div
        className="text-sm font-medium text-gray-900"
        data-testid="llm-monitor-preview-window"
      >
        {windowText}
      </div>

      {state.kind === "loading" ? (
        <div
          className="mt-3 grid grid-cols-3 gap-4"
          data-testid="llm-monitor-preview-loading"
        >
          {[0, 1, 2].map((index: number) => {
            return (
              <div key={index}>
                <div className="h-3 w-16 animate-pulse rounded bg-gray-200" />
                <div className="mt-2 h-5 w-10 animate-pulse rounded bg-gray-200" />
              </div>
            );
          })}
        </div>
      ) : (
        <></>
      )}

      {state.kind === "error" ? (
        <div
          className="mt-2 text-sm text-red-700"
          data-testid="llm-monitor-preview-error"
        >
          {state.message}
        </div>
      ) : (
        <></>
      )}

      {state.kind === "loaded" ? (
        <>
          <div className="mt-3 grid grid-cols-3 gap-4">
            <Figure
              label="AI answers"
              value={formatLlmCount(state.stats.answerCount)}
              tone="neutral"
              dataTestId="llm-monitor-preview-answers"
            />
            <Figure
              label="Bad answers"
              value={formatLlmCount(state.stats.badAnswerCount)}
              tone={state.stats.badAnswerCount > 0 ? "bad" : "neutral"}
              dataTestId="llm-monitor-preview-bad"
            />
            <Figure
              label="Share of answers"
              value={`${state.stats.badAnswerPercent}%`}
              tone={state.stats.badAnswerCount > 0 ? "bad" : "neutral"}
              dataTestId="llm-monitor-preview-share"
            />
          </div>
          {state.stats.answerCount === 0 ? (
            <div
              className="mt-2 text-xs text-gray-500"
              data-testid="llm-monitor-preview-empty"
            >
              {translator.translateText(
                "No AI answers in this window yet. The monitor counts them as they arrive.",
              )}
            </div>
          ) : (
            <div className="mt-2 text-xs">
              <AppLink
                to={getLlmPreviewConversationsRoute(state.stats)}
                className="font-medium text-indigo-600 hover:text-indigo-700"
              >
                {translator.translateText(
                  "See the conversations that need attention",
                ) || ""}
              </AppLink>
            </div>
          )}
        </>
      ) : (
        <></>
      )}
    </div>
  );
};

export default LlmMonitorPreview;
