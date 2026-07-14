import AIRunEvent from "Common/Models/DatabaseModels/AIRunEvent";
import AIRunEventType from "Common/Types/AI/AIRunEventType";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  events: Array<AIRunEvent>;
  /*
   * Header text above the steps. Defaults to the live "Investigating…"
   * wording used by chat and the AI investigation panel.
   */
  title?: string | undefined;
  // Show the pulsing "live" dot next to the title. Defaults to true.
  showLiveIndicator?: boolean | undefined;
  // How many trailing steps to show. Defaults to 7 (chat-panel sizing).
  maxVisibleSteps?: number | undefined;
}

interface ActivityStep {
  key: string;
  text: string;
  detail?: string | undefined;
  status: "running" | "done" | "failed";
  /*
   * Distinguishes plain steps from executor log lines (ProgressLog) and
   * executed actions (ActionExecuted) so they can render differently.
   */
  kind?: "log" | "action" | undefined;
  // Log severity for ProgressLog steps (Info/Warning/Error/…).
  severity?: string | undefined;
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
  create_incident: "Creating incident",
  acknowledge_incident: "Acknowledging incident",
  resolve_incident: "Resolving incident",
  acknowledge_alert: "Acknowledging alert",
  resolve_alert: "Resolving alert",
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
      /*
       * Plain progress lines from an external executor (e.g. the code-fix
       * agent container). The display text lives in resultSummary.message.
       */
      case AIRunEventType.ProgressLog: {
        const message: string | undefined = event.resultSummary?.message;
        if (message) {
          steps.push({
            key,
            text: message,
            status: "done",
            kind: "log",
            severity: event.resultSummary?.severity,
          });
        }
        break;
      }
      // A mutating action was executed — e.g. "Opened pull request: … — <url>".
      case AIRunEventType.ActionExecuted: {
        const message: string | undefined = event.resultSummary?.message;
        steps.push({
          key,
          text: message || `Executed ${event.toolName || "action"}`,
          status: "done",
          kind: "action",
        });
        break;
      }
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
  const maxVisibleSteps: number = props.maxVisibleSteps ?? 7;
  const hiddenStepCount: number = Math.max(0, steps.length - maxVisibleSteps);
  const visibleSteps: Array<ActivityStep> = steps.slice(-1 * maxVisibleSteps);
  const showLiveIndicator: boolean = props.showLiveIndicator ?? true;

  type RenderStepIconFunction = (step: ActivityStep) => ReactElement;

  const renderStepIcon: RenderStepIconFunction = (
    step: ActivityStep,
  ): ReactElement => {
    if (step.status === "running") {
      return (
        <span className="h-3 w-3 flex-shrink-0 animate-spin rounded-full border-2 border-gray-200 border-t-gray-600"></span>
      );
    }

    if (step.kind === "action") {
      return (
        <Icon
          icon={IconProp.ExternalLink}
          className="h-3 w-3 flex-shrink-0 text-indigo-500"
        />
      );
    }

    if (step.kind === "log") {
      if (step.severity === "Error" || step.severity === "Fatal") {
        return (
          <Icon
            icon={IconProp.Alert}
            className="h-3 w-3 flex-shrink-0 text-red-500"
          />
        );
      }

      if (step.severity === "Warning") {
        return (
          <Icon
            icon={IconProp.Info}
            className="h-3 w-3 flex-shrink-0 text-amber-500"
          />
        );
      }

      return (
        <span className="mx-0.5 h-1.5 w-1.5 flex-shrink-0 rounded-full bg-gray-300"></span>
      );
    }

    if (step.status === "failed") {
      return (
        <Icon
          icon={IconProp.Info}
          className="h-3 w-3 flex-shrink-0 text-amber-500"
        />
      );
    }

    return (
      <Icon
        icon={IconProp.Check}
        className="h-3 w-3 flex-shrink-0 text-emerald-500"
      />
    );
  };

  type RenderStepTextFunction = (step: ActivityStep) => ReactElement;

  const renderStepText: RenderStepTextFunction = (
    step: ActivityStep,
  ): ReactElement => {
    if (step.kind === "action") {
      // Link-ish: if the message carries a URL, make the whole line a link.
      const urlMatch: RegExpMatchArray | null =
        step.text.match(/https?:\/\/\S+/);

      if (urlMatch && urlMatch[0]) {
        return (
          <a
            href={urlMatch[0]}
            target="_blank"
            rel="noreferrer"
            className="break-words font-medium text-indigo-600 hover:underline"
          >
            {step.text}
          </a>
        );
      }

      return (
        <span className="break-words font-medium text-indigo-600">
          {step.text}
        </span>
      );
    }

    if (step.kind === "log") {
      if (step.severity === "Error" || step.severity === "Fatal") {
        return <span className="break-words text-red-600">{step.text}</span>;
      }

      if (step.severity === "Warning") {
        return <span className="break-words text-amber-600">{step.text}</span>;
      }

      return <span className="break-words text-gray-500">{step.text}</span>;
    }

    return (
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
    );
  };

  return (
    <div className="flex gap-3.5">
      <div className="mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-gray-900">
        <Icon icon={IconProp.Sparkles} className="h-3.5 w-3.5 text-white" />
      </div>

      <div className="min-w-0 flex-1">
        <div className="rounded-xl border border-gray-200 bg-gray-50/60 px-4 py-3">
          <div className="flex items-center gap-2">
            {showLiveIndicator ? (
              <span className="relative flex h-2 w-2">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-gray-400 opacity-75"></span>
                <span className="relative inline-flex h-2 w-2 rounded-full bg-gray-500"></span>
              </span>
            ) : (
              <></>
            )}
            <span className="text-sm font-medium text-gray-700">
              {props.title || "Investigating…"}
            </span>
          </div>

          {visibleSteps.length > 0 && (
            <div className="mt-3 space-y-1.5 border-t border-gray-200/70 pt-3">
              {hiddenStepCount > 0 && (
                <div className="text-[11px] text-gray-400">
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
                    {renderStepIcon(step)}
                    {renderStepText(step)}
                    {step.detail && (
                      <span className="text-gray-400">· {step.detail}</span>
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
