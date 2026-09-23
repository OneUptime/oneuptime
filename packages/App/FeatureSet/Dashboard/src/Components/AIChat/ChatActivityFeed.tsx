import {
  describeClusterToolOutcome,
  ClusterToolOutcome,
  isClusterToolName,
  isKubectlResultUnknownMessage,
} from "../AI/ClusterToolFormat";
import AIRunEvent from "Common/Models/DatabaseModels/AIRunEvent";
import AIRunEventType from "Common/Types/AI/AIRunEventType";
import IconProp from "Common/Types/Icon/IconProp";
import { RUN_KUBECTL_TOOL_NAME } from "Common/Types/Kubernetes/KubernetesClusterAiAccessToolNames";
import Icon from "Common/UI/Components/Icon/Icon";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * The AI tools that reach a Kubernetes cluster rather than the project's
 * telemetry — their calls are never "telemetry queries". Defined with the
 * rest of the cluster-tool wording; re-exported for existing importers.
 */
export { CLUSTER_TOOL_NAMES, isClusterToolName } from "../AI/ClusterToolFormat";

/*
 * What an investigation's kubectl calls actually did, read from the run's
 * own events. The server records a command that reached kubectl as a
 * completed call (rowCount 1 when it succeeded, 0 when kubectl returned an
 * error), a command that never reached kubectl — refused, never picked up
 * by the cluster's Runner, or out of budget — as a failed call, and a
 * command a Runner took whose result never came back as a failed call
 * marked "result unknown". The three are never confused for one another.
 */
export interface KubectlActivitySummary {
  // run_kubectl calls that ran on the cluster.
  executed: number;
  // Of those, the ones kubectl completed without an error.
  succeeded: number;
  // run_kubectl calls that did not run at all.
  notRun: number;
  /*
   * run_kubectl calls a Runner took but never reported back on: they may
   * or may not have run. Absent (read as 0) from callers that predate it.
   */
  unknown?: number | undefined;
  /*
   * Every cluster tool call started (run_kubectl and list_cluster_access),
   * which the run's toolCallCount includes and "telemetry queries" must not.
   */
  clusterToolCalls: number;
}

/*
 * Counted over the latest attempt only (the events after the last
 * RunStarted), the same span the report, its evidence and the run's
 * counters describe: a retried run keeps its earlier attempts' events.
 */
export function summarizeKubectlActivity(
  events: Array<AIRunEvent>,
): KubectlActivitySummary {
  let latestRunStartedIndex: number = -1;
  events.forEach((event: AIRunEvent, index: number): void => {
    if (event.eventType === AIRunEventType.RunStarted) {
      latestRunStartedIndex = index;
    }
  });

  const summary: KubectlActivitySummary = {
    executed: 0,
    succeeded: 0,
    notRun: 0,
    unknown: 0,
    clusterToolCalls: 0,
  };

  events.forEach((event: AIRunEvent, index: number): void => {
    if (index < latestRunStartedIndex) {
      return;
    }

    if (
      event.eventType === AIRunEventType.ToolCallStarted &&
      isClusterToolName(event.toolName)
    ) {
      summary.clusterToolCalls++;
      return;
    }

    if (event.toolName !== RUN_KUBECTL_TOOL_NAME) {
      return;
    }

    if (event.eventType === AIRunEventType.ToolCallCompleted) {
      summary.executed++;
      if ((event.resultSummary?.rowCount ?? 0) > 0) {
        summary.succeeded++;
      }
      return;
    }

    if (event.eventType === AIRunEventType.ToolCallFailed) {
      if (isKubectlResultUnknownMessage(event.resultSummary?.errorMessage)) {
        summary.unknown = (summary.unknown || 0) + 1;
      } else {
        summary.notRun++;
      }
    }
  });

  return summary;
}

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
  /*
   * Render only the steps — no assistant avatar, bubble, or title row. Use it
   * when the host already provides that framing (the AI investigation panel
   * puts the feed inside its own titled section); leaving the chrome on there
   * would stack a bordered bubble inside a bordered panel and repeat the
   * heading. Defaults to false, so the chat panel is unchanged.
   */
  hideChrome?: boolean | undefined;
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
  run_kubectl: "Running kubectl on the cluster",
  list_cluster_access: "Checking cluster access",
  list_command_targets: "Listing where commands may run",
  execute_remediation_command: "Applying a fix",
  propose_remediation_commands: "Proposing a fix for approval",
};

function friendlyToolName(toolName: string | undefined): string {
  return friendlyToolNames[toolName || ""] || `Running ${toolName || "query"}`;
}

/*
 * The detail for a failed call. A failed kubectl call produced nothing to
 * read: either it never reached the cluster, or a Runner took it and never
 * reported back, in which case it may have run. Say which rather than
 * implying it ran and will be retried.
 */
function describeFailedToolCall(event: AIRunEvent): string {
  if (event.toolName !== RUN_KUBECTL_TOOL_NAME) {
    return "did not succeed — retrying differently";
  }

  return isKubectlResultUnknownMessage(event.resultSummary?.errorMessage)
    ? "no result came back — it may have run"
    : "did not run on the cluster";
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
        /*
         * A cluster tool call has no rows: a kubectl command's rowCount only
         * says whether kubectl completed (1) or ran and returned an error
         * (0), and a cluster listing's is how many clusters it listed.
         */
        const clusterOutcome: ClusterToolOutcome | null =
          describeClusterToolOutcome(event.toolName, rowCount);
        if (clusterOutcome) {
          parts.push(clusterOutcome.detail);
        } else if (rowCount !== undefined) {
          parts.push(`${rowCount} ${rowCount === 1 ? "row" : "rows"}`);
        }
        if (durationInMs !== undefined) {
          parts.push(`${(durationInMs / 1000).toFixed(1)}s`);
        }
        completeLastRunning(
          friendlyToolName(event.toolName),
          parts.join(" · ") || undefined,
          clusterOutcome?.isError === true,
        );
        break;
      }
      case AIRunEventType.ToolCallFailed:
        completeLastRunning(
          friendlyToolName(event.toolName),
          describeFailedToolCall(event),
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
 * Whether these events will actually draw any steps. Several event types
 * (RunCompleted, RunFailed, and the completion halves of LLM/tool calls)
 * only close a step that an earlier event opened, so a non-empty event list
 * can still render nothing — a run whose RunStarted failed to persist and
 * then failed outright is one real example. A host that frames the feed in
 * its own titled panel must ask this instead of counting raw events, or it
 * draws an empty box. Exported so the predicate has exactly one owner.
 */
export function hasRenderableActivity(events: Array<AIRunEvent>): boolean {
  return countActivitySteps(events) > 0;
}

/*
 * How many steps the feed draws for these events. Hosts label the feed with
 * this rather than the raw event count, which also counts the events that
 * only close a step.
 */
export function countActivitySteps(events: Array<AIRunEvent>): number {
  return buildSteps(events).length;
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

  const stepList: ReactElement =
    visibleSteps.length > 0 ? (
      <div className="space-y-1.5">
        {hiddenStepCount > 0 && (
          <div className="text-[11px] text-gray-400">
            + {hiddenStepCount} earlier{" "}
            {hiddenStepCount === 1 ? "step" : "steps"}
          </div>
        )}
        {visibleSteps.map((step: ActivityStep) => {
          return (
            <div key={step.key} className="flex items-center gap-2 text-xs">
              {renderStepIcon(step)}
              {renderStepText(step)}
              {step.detail && (
                <span className="text-gray-400">· {step.detail}</span>
              )}
            </div>
          );
        })}
      </div>
    ) : (
      <></>
    );

  if (props.hideChrome) {
    return stepList;
  }

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
            <div className="mt-3 border-t border-gray-200/70 pt-3">
              {stepList}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ChatActivityFeed;
