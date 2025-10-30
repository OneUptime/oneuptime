import React, { FunctionComponent, ReactElement } from "react";
import { LiveLogsOptions } from "../types";

export type LiveLogsToggleProps = LiveLogsOptions;

const LiveLogsToggle: FunctionComponent<LiveLogsToggleProps> = (
  props: LiveLogsToggleProps,
): ReactElement => {
  const { isLive, onToggle, isDisabled } = props;

  const baseClasses: string =
    "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm font-medium transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-emerald-500/60";
  const activeClasses: string = isLive
    ? "border-emerald-400/70 bg-emerald-500/10 text-emerald-200 hover:border-emerald-300"
    : "border-slate-700/70 bg-slate-900/70 text-slate-300 hover:border-slate-500/70 hover:text-slate-100";
  const disabledClasses: string = isDisabled
    ? "cursor-not-allowed opacity-50"
    : "cursor-pointer";

  const content: ReactElement = (
    <button
      type="button"
      aria-pressed={isLive}
      disabled={isDisabled}
      onClick={() => {
        if (isDisabled) {
          return;
        }

        onToggle(!isLive);
      }}
      className={`${baseClasses} ${activeClasses} ${disabledClasses}`}
    >
      <span
        className={`h-2 w-2 rounded-full ${
          isLive ? "bg-emerald-400 animate-pulse" : "bg-slate-500"
        }`}
      />
      <span>Live</span>
    </button>
  );

  return content;
};

export default LiveLogsToggle;
