import React, { FunctionComponent, ReactElement, useMemo } from "react";
import { JSONObject } from "Common/Types/JSON";
import { SpanEvent } from "Common/Models/AnalyticsModels/Span";
import Icon from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";
import LazyMarkdownViewer from "Common/UI/Components/Markdown.tsx/LazyMarkdownViewer";
import LlmSpanDisplayUtil, {
  LlmMessage,
  LlmSpanDisplay,
} from "../../Utils/LlmSpanDisplay";

export interface ComponentProps {
  attributes: JSONObject | undefined;
  events?: Array<SpanEvent> | undefined;
  // Optional latency label, rendered alongside token/cost metrics.
  durationLabel?: string | undefined;
}

function getRoleColor(role: string): { bg: string; text: string } {
  const normalized: string = (role || "").toLowerCase();
  if (normalized.includes("system")) {
    return { bg: "#f3f4f6", text: "#374151" };
  }
  if (normalized.includes("assistant") || normalized.includes("choice")) {
    return { bg: "#eef2ff", text: "#4338ca" };
  }
  if (normalized.includes("tool")) {
    return { bg: "#ecfeff", text: "#0e7490" };
  }
  if (normalized.includes("user")) {
    return { bg: "#f0fdf4", text: "#15803d" };
  }
  return { bg: "#f9fafb", text: "#4b5563" };
}

const Metric: FunctionComponent<{
  label: string;
  value: string;
}> = (props: { label: string; value: string }): ReactElement => {
  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
      <div className="text-[11px] uppercase tracking-wide text-gray-400">
        {props.label}
      </div>
      <div className="mt-0.5 font-mono text-sm font-semibold text-gray-800">
        {props.value}
      </div>
    </div>
  );
};

const MessageBlock: FunctionComponent<{
  message: LlmMessage;
}> = (props: { message: LlmMessage }): ReactElement => {
  const colors: { bg: string; text: string } = getRoleColor(props.message.role);
  return (
    <div className="overflow-hidden rounded-lg border border-gray-200">
      <div
        className="px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide"
        style={{ backgroundColor: colors.bg, color: colors.text }}
      >
        {props.message.role || "message"}
      </div>
      <div className="max-h-72 overflow-auto bg-white px-3 py-2 text-[13px] leading-6 text-gray-800">
        {props.message.content ? (
          <LazyMarkdownViewer text={props.message.content} />
        ) : (
          <span className="italic text-gray-400">(no text content)</span>
        )}
      </div>
    </div>
  );
};

const Messages: FunctionComponent<{
  title: string;
  messages: Array<LlmMessage>;
}> = (props: {
  title: string;
  messages: Array<LlmMessage>;
}): ReactElement | null => {
  if (props.messages.length === 0) {
    return null;
  }
  return (
    <div className="space-y-2">
      <div className="text-[11px] uppercase tracking-wide text-gray-400">
        {props.title}
      </div>
      <div className="space-y-2">
        {props.messages.map(
          (message: LlmMessage, index: number): ReactElement => {
            return <MessageBlock key={index} message={message} />;
          },
        )}
      </div>
    </div>
  );
};

/*
 * First-class panel for LLM / GenAI / AI-agent spans. Renders model, token
 * usage, cost (when the SDK reports it), request params, and the prompt /
 * completion content. Returns null for non-LLM spans so callers can include it
 * unconditionally.
 */
const LlmSpanPanel: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement | null => {
  const display: LlmSpanDisplay = useMemo(() => {
    return LlmSpanDisplayUtil.parse({
      attributes: props.attributes,
      events: props.events,
    });
  }, [props.attributes, props.events]);

  if (!display.isLlmSpan) {
    return null;
  }

  const chips: Array<{ label: string; value: string }> = [];
  if (display.system) {
    chips.push({ label: "Provider", value: display.system });
  }
  if (display.operation) {
    chips.push({ label: "Operation", value: display.operation });
  }
  if (display.requestModel) {
    const model: string =
      display.responseModel && display.responseModel !== display.requestModel
        ? `${display.requestModel} → ${display.responseModel}`
        : display.requestModel;
    chips.push({ label: "Model", value: model });
  }
  if (display.agentName) {
    chips.push({ label: "Agent", value: display.agentName });
  }
  if (display.toolName) {
    chips.push({ label: "Tool", value: display.toolName });
  }

  const metrics: Array<{ label: string; value: string }> = [];
  metrics.push({
    label: "Input tokens",
    value: display.inputTokens.toLocaleString(),
  });
  metrics.push({
    label: "Output tokens",
    value: display.outputTokens.toLocaleString(),
  });
  metrics.push({
    label: "Total tokens",
    value: display.totalTokens.toLocaleString(),
  });
  metrics.push({
    label: "Cost",
    value: display.hasCost
      ? `$${display.cost.toFixed(6)}`
      : "not reported by SDK",
  });
  if (props.durationLabel) {
    metrics.push({ label: "Latency", value: props.durationLabel });
  }

  const params: Array<{ label: string; value: string }> = [];
  if (display.temperature) {
    params.push({ label: "Temperature", value: display.temperature });
  }
  if (display.maxTokens) {
    params.push({ label: "Max tokens", value: display.maxTokens });
  }
  if (display.topP) {
    params.push({ label: "Top P", value: display.topP });
  }
  if (display.finishReasons) {
    params.push({ label: "Finish reason", value: display.finishReasons });
  }

  return (
    <section className="space-y-3">
      <header className="flex items-center gap-2">
        <Icon icon={IconProp.Sparkles} className="h-4 w-4 text-violet-500" />
        <span className="text-[11px] font-semibold uppercase tracking-wide text-violet-500">
          AI / LLM Call
        </span>
      </header>

      <div className="space-y-4 rounded-lg border border-violet-100 bg-violet-50/40 p-4">
        {chips.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {chips.map(
              (chip: { label: string; value: string }): ReactElement => {
                return (
                  <span
                    key={chip.label}
                    className="inline-flex items-center gap-1.5 rounded-full border border-violet-200 bg-white px-2.5 py-1 text-xs"
                  >
                    <span className="text-gray-400">{chip.label}</span>
                    <span className="font-mono font-medium text-gray-800">
                      {chip.value}
                    </span>
                  </span>
                );
              },
            )}
          </div>
        )}

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
          {metrics.map(
            (metric: { label: string; value: string }): ReactElement => {
              return (
                <Metric
                  key={metric.label}
                  label={metric.label}
                  value={metric.value}
                />
              );
            },
          )}
        </div>

        {params.length > 0 && (
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-gray-600">
            {params.map(
              (param: { label: string; value: string }): ReactElement => {
                return (
                  <span key={param.label}>
                    <span className="text-gray-400">{param.label}:</span>{" "}
                    <span className="font-mono text-gray-800">
                      {param.value}
                    </span>
                  </span>
                );
              },
            )}
          </div>
        )}

        <Messages title="Prompt" messages={display.promptMessages} />
        <Messages title="Completion" messages={display.completionMessages} />
      </div>
    </section>
  );
};

export default LlmSpanPanel;
