import AIRunEvent from "Common/Models/DatabaseModels/AIRunEvent";
import AIRunEventType from "Common/Types/AI/AIRunEventType";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  events: Array<AIRunEvent>;
}

interface ActivityStep {
  key: string;
  text: string;
  detail?: string | undefined;
  status: "running" | "done" | "failed";
}

const friendlyToolNames: { [key: string]: string } = {
  query_incidents: "Checking incidents",
  query_alerts: "Checking alerts",
  query_monitors: "Checking monitors",
  top_exceptions: "Ranking exceptions",
  search_logs: "Searching logs",
  log_histogram: "Charting log volume",
  query_metrics: "Aggregating metrics",
  query_traces: "Analyzing traces",
  get_trace: "Reading trace",
  lookup_context: "Resolving names",
};

function friendlyToolName(toolName: string | undefined): string {
  return friendlyToolNames[toolName || ""] || `Running ${toolName || "query"}`;
}

function buildSteps(events: Array<AIRunEvent>): Array<ActivityStep> {
  const steps: Array<ActivityStep> = [];

  const completeLastRunning: (
    text: string | undefined,
    detail: string | undefined,
    failed: boolean,
  ) => void = (
    text: string | undefined,
    detail: string | undefined,
    failed: boolean,
  ): void => {
    for (let i: number = steps.length - 1; i >= 0; i--) {
      const step: ActivityStep = steps[i]!;
      if (step.status === "running" && (!text || step.text === text)) {
        step.status = failed ? "failed" : "done";
        step.detail = detail;
        return;
      }
    }
  };

  for (const event of events) {
    const key: string = event.id?.toString() || `${steps.length}`;

    switch (event.eventType) {
      case AIRunEventType.RunStarted:
        steps.push({ key, text: "Starting investigation", status: "done" });
        break;
      case AIRunEventType.LlmCallStarted:
        steps.push({ key, text: "Thinking", status: "running" });
        break;
      case AIRunEventType.LlmCallCompleted:
        completeLastRunning("Thinking", undefined, false);
        break;
      case AIRunEventType.ToolCallStarted:
        steps.push({
          key,
          text: friendlyToolName(event.toolName),
          status: "running",
        });
        break;
      case AIRunEventType.ToolCallCompleted: {
        const rowCount: number | undefined = event.resultSummary?.rowCount;
        const durationInMs: number | undefined =
          event.resultSummary?.durationInMs;
        const parts: Array<string> = [];
        if (rowCount !== undefined) {
          parts.push(`${rowCount} ${rowCount === 1 ? "row" : "rows"}`);
        }
        if (durationInMs !== undefined) {
          parts.push(`${(durationInMs / 1000).toFixed(1)}s`);
        }
        completeLastRunning(
          friendlyToolName(event.toolName),
          parts.join(" · ") || undefined,
          false,
        );
        break;
      }
      case AIRunEventType.ToolCallFailed:
        completeLastRunning(
          friendlyToolName(event.toolName),
          "did not succeed — retrying differently",
          true,
        );
        break;
      default:
        break;
    }
  }

  return steps;
}

/*
 * The live "investigating…" feed: renders the run's real tool activity so
 * the user watches actual queries execute instead of a generic spinner.
 */
const ChatActivityFeed: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const steps: Array<ActivityStep> = buildSteps(props.events);
  const maxVisibleSteps: number = 7;
  const hiddenStepCount: number = Math.max(0, steps.length - maxVisibleSteps);
  const visibleSteps: Array<ActivityStep> = steps.slice(-1 * maxVisibleSteps);

  return (
    <div className="flex gap-2.5">
      <div className="mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-violet-600 shadow-sm">
        <Icon icon={IconProp.Sparkles} className="h-4 w-4 text-white" />
      </div>

      <div className="min-w-0 flex-1">
        <div className="rounded-2xl rounded-tl-sm border border-indigo-100 bg-white px-4 py-3 shadow-sm">
          <div className="flex items-center gap-2">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-indigo-400 opacity-75"></span>
              <span className="relative inline-flex h-2 w-2 rounded-full bg-indigo-500"></span>
            </span>
            <span className="text-sm font-medium text-indigo-700">
              Investigating…
            </span>
          </div>

          {visibleSteps.length > 0 && (
            <div className="mt-3 space-y-1.5 border-t border-gray-50 pt-3">
              {hiddenStepCount > 0 && (
                <div className="text-[11px] text-gray-300">
                  + {hiddenStepCount} earlier{" "}
                  {hiddenStepCount === 1 ? "step" : "steps"}
                </div>
              )}
              {visibleSteps.map((step: ActivityStep) => {
                return (
                  <div
                    key={step.key}
                    className="flex items-center gap-2 text-xs"
                  >
                    {step.status === "running" && (
                      <span className="h-3 w-3 flex-shrink-0 animate-spin rounded-full border-2 border-indigo-200 border-t-indigo-600"></span>
                    )}
                    {step.status === "done" && (
                      <Icon
                        icon={IconProp.Check}
                        className="h-3 w-3 flex-shrink-0 text-emerald-500"
                      />
                    )}
                    {step.status === "failed" && (
                      <Icon
                        icon={IconProp.Info}
                        className="h-3 w-3 flex-shrink-0 text-amber-500"
                      />
                    )}
                    <span
                      className={
                        step.status === "running"
                          ? "font-medium text-gray-700"
                          : "text-gray-500"
                      }
                    >
                      {step.text}
                      {step.status === "running" ? "…" : ""}
                    </span>
                    {step.detail && (
                      <span className="text-gray-300">· {step.detail}</span>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ChatActivityFeed;
