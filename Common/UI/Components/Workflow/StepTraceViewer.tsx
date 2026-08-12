/*
 * A workflow run, read as the list of steps it actually took.
 *
 * The raw log is still there and still useful — it carries the component's own
 * log lines and the warnings the runner emits — but "what did this step
 * receive, what did it return, and where did it go next" is a question about
 * structure, and answering it by scanning a newline-joined blob was the whole
 * problem.
 */

import Icon from "../Icon/Icon";
import IconProp from "../../../Types/Icon/IconProp";
import { JSONObject } from "../../../Types/JSON";
import {
  WorkflowStepStatus,
  WorkflowStepTrace,
  WorkflowStepTraceEntry,
} from "../../../Types/Workflow/StepTrace";
import React, { FunctionComponent, ReactElement, useState } from "react";

export interface ComponentProps {
  trace: WorkflowStepTrace;
}

type FormatDurationFunction = (durationInMs: number) => string;

export const formatStepDuration: FormatDurationFunction = (
  durationInMs: number,
): string => {
  if (durationInMs < 1000) {
    return `${durationInMs}ms`;
  }

  if (durationInMs < 60000) {
    return `${(durationInMs / 1000).toFixed(1)}s`;
  }

  const minutes: number = Math.floor(durationInMs / 60000);
  const seconds: number = Math.round((durationInMs % 60000) / 1000);

  return `${minutes}m ${seconds}s`;
};

interface ValueBlockProps {
  title: string;
  values: JSONObject;
}

const ValueBlock: FunctionComponent<ValueBlockProps> = (
  props: ValueBlockProps,
): ReactElement => {
  const keys: Array<string> = Object.keys(props.values || {});

  return (
    <div>
      <p className="text-[11px] font-semibold uppercase tracking-wider text-gray-500 mb-1">
        {props.title}
      </p>
      {keys.length === 0 ? (
        <p className="text-sm text-gray-400">None</p>
      ) : (
        <dl className="space-y-1">
          {keys.map((key: string) => {
            const value: unknown = props.values[key];
            const text: string =
              typeof value === "string"
                ? value
                : JSON.stringify(value, null, 2);

            return (
              <div key={key} className="text-sm">
                <dt className="text-gray-500 font-medium">{key}</dt>
                <dd className="text-gray-800 font-mono text-xs whitespace-pre-wrap break-all">
                  {text}
                </dd>
              </div>
            );
          })}
        </dl>
      )}
    </div>
  );
};

interface StepRowProps {
  step: WorkflowStepTraceEntry;
  index: number;
}

const StepRow: FunctionComponent<StepRowProps> = (
  props: StepRowProps,
): ReactElement => {
  const [isOpen, setIsOpen] = useState<boolean>(
    props.step.status === WorkflowStepStatus.Error,
  );

  const isError: boolean = props.step.status === WorkflowStepStatus.Error;

  return (
    <div
      className={`rounded-md border ${
        isError ? "border-red-200 bg-red-50" : "border-gray-200 bg-white"
      }`}
    >
      <button
        type="button"
        aria-expanded={isOpen}
        className="w-full text-left p-3 flex items-center gap-3 cursor-pointer"
        onClick={() => {
          setIsOpen(!isOpen);
        }}
      >
        <span className="text-xs text-gray-400 w-5 shrink-0">
          {props.index + 1}
        </span>

        <Icon
          icon={isError ? IconProp.Alert : IconProp.CheckCircle}
          className={`h-4 w-4 shrink-0 ${
            isError ? "text-red-500" : "text-green-500"
          }`}
        />

        <span className="flex-1 min-w-0">
          <span className="block text-sm font-medium text-gray-900 truncate">
            {props.step.title}
          </span>
          <span className="block text-xs text-gray-500 truncate">
            {props.step.componentId}
          </span>
        </span>

        <span className="text-xs text-gray-500 shrink-0">
          {formatStepDuration(props.step.durationInMs)}
        </span>

        {props.step.executedPort && (
          <span className="text-xs text-gray-500 shrink-0 hidden sm:inline">
            → {props.step.executedPort}
          </span>
        )}
      </button>

      {isOpen && (
        <div className="border-t border-gray-200 p-3 space-y-3">
          {props.step.errorMessage && (
            <p className="text-sm text-red-700">{props.step.errorMessage}</p>
          )}
          <ValueBlock title="Received" values={props.step.argumentValues} />
          <ValueBlock title="Returned" values={props.step.returnValues} />
        </div>
      )}
    </div>
  );
};

const StepTraceViewer: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const steps: Array<WorkflowStepTraceEntry> = props.trace?.steps || [];

  if (steps.length === 0) {
    return (
      <p className="text-sm text-gray-500">
        This run has no recorded steps. Runs from before step recording was
        added show only the log below.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {props.trace.truncated && (
        <p className="text-sm text-amber-700">
          Only the last {steps.length} steps of this run were kept.
        </p>
      )}

      {steps.map((step: WorkflowStepTraceEntry, index: number) => {
        return <StepRow key={index} step={step} index={index} />;
      })}
    </div>
  );
};

export default StepTraceViewer;
