import React, { FunctionComponent, ReactElement } from "react";
import SecurityEvent from "Common/Models/AnalyticsModels/SecurityEvent";
import OneUptimeDate from "Common/Types/Date";
import OcsfSeverity from "Common/Types/SecurityEvent/OcsfSeverity";
import {
  SECURITY_EVENT_VOLUME_COLORS,
  toSecurityEventVolumeSeverity,
} from "./SecurityEventVolume";

export const SECURITY_EVENT_ROW_TEST_ID: string = "security-event-row";

export interface ComponentProps {
  securityEvent: SecurityEvent;
  isSelected?: boolean | undefined;
  onClick?: (() => void) | undefined;
}

type ChipProps = {
  label: string;
  value: string;
};

/*
 * A "who / what / where" chip. Labelled because `svc-deploy` and `web-01`
 * are indistinguishable without one, and a SIEM row that shows the wrong
 * side of an interaction is worse than one that shows nothing.
 */
const Chip: FunctionComponent<ChipProps> = (props: ChipProps): ReactElement => {
  return (
    <span className="inline-flex max-w-[16rem] items-center gap-1 rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-[10px] text-gray-600">
      <span className="text-gray-400">{props.label}</span>
      <span className="truncate font-medium text-gray-700" title={props.value}>
        {props.value}
      </span>
    </span>
  );
};

/*
 * One security event, as a dense list row — the same shape the logs and
 * traces explorers use, rather than a table cell grid.
 *
 * Line 1 is the one-line read: severity, when, event class, message.
 * Line 2 is the context a responder scans for: who acted, on what, what
 * happened, and which product said so.
 */
const SecurityEventListRow: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const event: SecurityEvent = props.securityEvent;
  const severity: OcsfSeverity = toSecurityEventVolumeSeverity(
    event.severityName,
  );
  const severityColor: string = SECURITY_EVENT_VOLUME_COLORS[severity];
  const time: Date | null = event.time ? new Date(event.time) : null;
  const message: string = (event.message || "").split("\n")[0] || "";

  return (
    <button
      type="button"
      data-testid={SECURITY_EVENT_ROW_TEST_ID}
      aria-pressed={props.isSelected ? true : undefined}
      className={`group block w-full px-4 py-2.5 text-left transition-colors hover:bg-indigo-50/40 focus:outline-none focus-visible:bg-indigo-50/60 ${
        props.isSelected ? "bg-indigo-50/60" : ""
      }`}
      onClick={props.onClick}
    >
      <div className="flex items-start gap-3">
        <span
          className="mt-1.5 inline-block h-2 w-2 flex-shrink-0 rounded-full"
          style={{ backgroundColor: severityColor }}
          aria-hidden="true"
        />

        <div className="flex min-w-0 flex-1 flex-col gap-1">
          <div className="flex min-w-0 items-baseline gap-2">
            {time && (
              <span
                className="flex-shrink-0 font-mono text-[11px] text-gray-400"
                title={OneUptimeDate.getDateAsLocalFormattedString(time)}
              >
                {OneUptimeDate.getDateAsLocalFormattedString(time)}
              </span>
            )}
            <span
              className="flex-shrink-0 text-[11px] font-semibold uppercase tracking-wide"
              style={{ color: severityColor }}
            >
              {severity}
            </span>
            {event.className && (
              <span className="flex-shrink-0 font-mono text-xs font-semibold text-gray-900">
                {event.className}
              </span>
            )}
            <span className="min-w-0 flex-1 truncate font-mono text-xs text-gray-700">
              {message || (
                <span className="text-gray-400">No message recorded</span>
              )}
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {event.principalUser && (
              <Chip label="user" value={event.principalUser} />
            )}
            {event.principalHost && (
              <Chip label="host" value={event.principalHost} />
            )}
            {event.principalIp && (
              <Chip label="ip" value={event.principalIp} />
            )}
            {event.targetUser && (
              <Chip label="target user" value={event.targetUser} />
            )}
            {event.targetHost && (
              <Chip label="target host" value={event.targetHost} />
            )}
            {event.targetIp && <Chip label="target ip" value={event.targetIp} />}
            {event.statusName && (
              <Chip label="status" value={event.statusName} />
            )}
            {event.ruleName && <Chip label="rule" value={event.ruleName} />}
            {event.vendorName && (
              <Chip label="vendor" value={event.vendorName} />
            )}
          </div>
        </div>
      </div>
    </button>
  );
};

export default SecurityEventListRow;
