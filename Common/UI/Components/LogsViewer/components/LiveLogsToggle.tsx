import React, { FunctionComponent, ReactElement } from "react";
import { LiveLogsOptions } from "../types";

export type LiveLogsToggleProps = LiveLogsOptions;

const LiveLogsToggle: FunctionComponent<LiveLogsToggleProps> = (
  props: LiveLogsToggleProps,
): ReactElement => {
  const { isLive, onToggle, isDisabled } = props;

  const baseClasses: string =
    "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs font-medium shadow-sm transition-all focus:outline-none focus:ring-2 focus:ring-emerald-200";
  const activeClasses: string = isLive
    ? "border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
    : "border-gray-200 bg-white text-gray-700 hover:bg-gray-50";
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
          isLive ? "bg-emerald-500 animate-pulse" : "bg-gray-300"
        }`}
      />
      <span>Live</span>
    </button>
  );

  return content;
};

export default LiveLogsToggle;
