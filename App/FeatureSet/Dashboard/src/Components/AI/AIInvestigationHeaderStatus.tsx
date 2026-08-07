import AIRunStatus from "Common/Types/AI/AIRunStatus";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import React, { FunctionComponent, ReactElement } from "react";
import {
  AI_INVESTIGATION_PANEL_ID,
  isActiveAIInvestigationStatus,
} from "./AIInvestigationStatus";

export interface ComponentProps {
  status: AIRunStatus;
  onViewProgress: () => void;
}

export interface LiveRegionProps {
  status: AIRunStatus | null | undefined;
}

export const getAIInvestigationStatusCopy: (status: AIRunStatus) => {
  title: string;
  description: string;
} = (
  status: AIRunStatus,
): {
  title: string;
  description: string;
} => {
  if (status === AIRunStatus.Running) {
    return {
      title: "AI is investigating",
      description: "Reviewing telemetry and tracing the likely root cause.",
    };
  }

  return {
    title: "AI investigation queued",
    description:
      "Waiting for an AI worker. Telemetry review will begin automatically.",
  };
};

export const AIInvestigationStatusLiveRegion: FunctionComponent<
  LiveRegionProps
> = (props: LiveRegionProps): ReactElement => {
  let announcement: string = "";

  if (isActiveAIInvestigationStatus(props.status)) {
    const copy: { title: string; description: string } =
      getAIInvestigationStatusCopy(props.status!);
    announcement = `${copy.title}. ${copy.description}`;
  }

  return (
    <span
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className="sr-only"
    >
      {announcement}
    </span>
  );
};

/*
 * A deliberately prominent, but compact, live status for an incident header.
 * The full event trail remains in InvestigationPanel; this tells responders
 * that work is happening without making them hunt for that card.
 */
const AIInvestigationHeaderStatus: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  if (!isActiveAIInvestigationStatus(props.status)) {
    return <></>;
  }

  const isRunning: boolean = props.status === AIRunStatus.Running;
  const copy: { title: string; description: string } =
    getAIInvestigationStatusCopy(props.status);

  return (
    <div className="relative overflow-hidden rounded-lg border border-indigo-200 bg-gradient-to-r from-indigo-50 via-white to-violet-50 px-3.5 py-3 shadow-sm">
      <div
        aria-hidden="true"
        className="absolute inset-y-0 left-0 w-1 bg-indigo-500"
      />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <span
            aria-hidden="true"
            className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-indigo-600 text-white shadow-sm"
          >
            <Icon icon={IconProp.Sparkles} className="h-4 w-4" />
            <span className="absolute -right-0.5 -top-0.5 flex h-2.5 w-2.5">
              {isRunning ? (
                <span className="absolute inline-flex h-full w-full motion-safe:animate-ping rounded-full bg-indigo-400 opacity-75" />
              ) : (
                <></>
              )}
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full border-2 border-white bg-indigo-500" />
            </span>
          </span>
          <div className="min-w-0">
            <p className="text-sm font-semibold text-indigo-950">
              {copy.title}
            </p>
            <p className="mt-0.5 text-xs leading-5 text-indigo-700">
              {copy.description}
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={props.onViewProgress}
          aria-controls={AI_INVESTIGATION_PANEL_ID}
          aria-label="View live AI investigation progress"
          className="group inline-flex shrink-0 items-center justify-center gap-1.5 self-start rounded-md px-2.5 py-1.5 text-xs font-semibold text-indigo-700 transition-colors hover:bg-indigo-100 hover:text-indigo-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 sm:self-auto"
        >
          View live progress
          <Icon
            icon={IconProp.ChevronDown}
            className="h-3.5 w-3.5 transition-transform motion-safe:group-hover:translate-y-0.5"
          />
        </button>
      </div>
    </div>
  );
};

export default AIInvestigationHeaderStatus;
