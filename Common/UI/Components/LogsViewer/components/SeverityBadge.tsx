import React, { FunctionComponent, ReactElement } from "react";
import LogSeverity from "../../../../Types/Log/LogSeverity";
import { getSeverityTheme } from "./severityTheme";

export interface SeverityBadgeProps {
  severity?: LogSeverity | string | null | undefined;
}

const SeverityBadge: FunctionComponent<SeverityBadgeProps> = (
  props: SeverityBadgeProps,
): ReactElement => {
  const label: string = props.severity
    ? props.severity.toString().toUpperCase()
    : "UNKNOWN";

  const theme = getSeverityTheme(props.severity);

  return (
    <span
      className={`inline-flex items-center gap-2 rounded-full px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide ring-1 ring-inset ${theme.badgeClass}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${theme.dotClass}`} />
      <span>{label}</span>
    </span>
  );
};

export default SeverityBadge;
