import React, { FunctionComponent, ReactElement } from "react";
import { LiveLogsOptions } from "../types";

export type LiveLogsToggleProps = LiveLogsOptions;

const LiveLogsToggle: FunctionComponent<LiveLogsToggleProps> = (
  props: LiveLogsToggleProps,
): ReactElement => {
  const { isLive, onToggle, isDisabled } = props;

  const baseClasses: string =
    "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm font-medium transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-emerald-500/60 bg-white/90 backdrop-blur";
  const activeClasses: string = isLive
    ? "border-emerald-600 text-emerald-700 hover:border-emerald-500 hover:bg-emerald-50"
    : "border-slate-300 text-slate-600 hover:border-slate-400 hover:bg-white";
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
          isLive ? "bg-emerald-500 animate-pulse" : "bg-slate-400"
        }`}
      />
      <span className="font-semibold">Live</span>
    </button>
  );

  return content;
};

export default LiveLogsToggle;
