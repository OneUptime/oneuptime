import OneUptimeDate from "../../../Types/Date";
import Color from "../../../Types/Color";
import UptimeHistoryLabels, {
  DefaultUptimeHistoryLabels,
} from "../../../Types/Monitor/UptimeHistoryLabels";
import MonitorPausedBy from "../../../Types/Monitor/MonitorPausedBy";
import DayUptimeGraphUtil, {
  DayLeftOutReading,
  MONITORING_OFF_MINIMUM_SECONDS,
} from "../../../Utils/Uptime/DayUptimeGraphUtil";
import React, { FunctionComponent, ReactElement } from "react";
import { getStatusTextProps } from "../../Utils/StatusColorStyle";

/*
 * The pause the Status Timeline's Monitoring Off pill and the "Monitoring is
 * turned off" banner carry, drawn the way the no-data block draws its icon.
 */
const PauseIcon: FunctionComponent<{ size: number; color: string }> = (props: {
  size: number;
  color: string;
}): ReactElement => {
  return (
    <svg
      aria-hidden="true"
      width={props.size}
      height={props.size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={props.color}
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      style={{ flexShrink: 0 }}
    >
      <circle cx="12" cy="12" r="10" />
      <line x1="10" y1="9" x2="10" y2="15" />
      <line x1="14" y1="9" x2="14" y2="15" />
    </svg>
  );
};

// A day nothing was measured on, with or without monitoring: one quiet block.
const NO_READING_BLOCK_STYLE: React.CSSProperties = {
  backgroundColor: "var(--ou-surface-secondary, #f9fafb)",
  borderRadius: "8px",
  padding: "16px",
  textAlign: "center",
};

/*
 * Its words in the muted grey every other line of the summary is set in,
 * which reads at 4.5:1 on that surface: the subtle grey they were in read
 * at 2.5:1.
 */
const NO_READING_TEXT_STYLE: React.CSSProperties = {
  fontSize: "12px",
  color: "var(--ou-text-muted, #6b7280)",
  fontWeight: 500,
};

export interface StatusDuration {
  label: string;
  seconds: number;
  color: Color;
  isDowntime: boolean;
  /*
   * The monitor status's priority; a higher number wins the bar's colour, as
   * it does for events (the default statuses run Operational 1, Degraded 2,
   * Offline 3). Only a server reading carries it: a day painted from that
   * reading takes the colour of its highest-priority status, as a day painted
   * from events does. Optional because event-derived durations never need it.
   */
  priority?: number | undefined;
}

export interface ComponentProps {
  uptimePercent: number;
  /*
   * False when the page holds no timeline rows for this day at all - a day
   * before the monitor existed, say. That is not the same as a day of
   * downtime and must not be drawn as one.
   */
  hasEvents: boolean;
  statusDurations: Array<StatusDuration>;
  /*
   * Whether the caller draws anything below this block (the incident list, in
   * both of today's callers). Only affects the trailing margin and rule.
   */
  hasFollowingContent?: boolean | undefined;
  /*
   * How long monitoring was off that day (issue #7112). With no events, the
   * day was not checked because monitoring was off, and says so in place of
   * "No monitoring data"; with events, the uptime is of the checked time,
   * and a line under it says for how long monitoring was off.
   */
  monitoringOffSeconds?: number | undefined;
  /*
   * Of it, how long a pause left out - an incident declared by hand or
   * scheduled maintenance that paused the checks with no status set
   * (#11433) - and what paused them: said as paused, and why, never as
   * monitoring off.
   */
  pausedSeconds?: number | undefined;
  pausedBy?: MonitorPausedBy | null | undefined;
  /* Defaults to English. The status page passes translated strings. */
  labels?: UptimeHistoryLabels | undefined;
}

// A line under the day for time left out: the pause icon, and for how long.
const LeftOutLine: FunctionComponent<{
  testId: string;
  text: string;
}> = (props: { testId: string; text: string }): ReactElement => {
  return (
    <div
      data-testid={props.testId}
      style={{
        display: "flex",
        alignItems: "center",
        padding: "4px 0",
        gap: "6px",
      }}
    >
      <PauseIcon size={12} color="var(--ou-text-muted, #6b7280)" />
      <span
        style={{
          fontSize: "12px",
          color: "var(--ou-text-muted, #6b7280)",
          fontWeight: 500,
        }}
      >
        {props.text}
      </span>
    </div>
  );
};

/*
 * One day of uptime: the percentage, a bar showing how the day was spent, and
 * a row per monitor status with how long the day spent in it.
 *
 * Shared by the hover tooltip on the uptime strip and by the dialog that same
 * strip opens on click or on Enter. It exists because those two used to be
 * different: the tooltip showed the reading and the dialog showed only
 * incidents, so a visitor without a mouse - a phone, a screen reader, a
 * keyboard - could never see how a day had actually gone.
 */
const UptimeDaySummary: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const hasFollowingContent: boolean = Boolean(props.hasFollowingContent);
  const labels: UptimeHistoryLabels =
    props.labels || DefaultUptimeHistoryLabels;

  // Color tiers
  const isGood: boolean = props.uptimePercent >= 99.9;
  const isWarn: boolean = !isGood && props.uptimePercent >= 99;

  const uptimeColor: string = isGood
    ? "#059669"
    : isWarn
      ? "#d97706"
      : "#dc2626";

  // Sort: downtime first, then by duration desc
  const sortedDurations: Array<StatusDuration> = [
    ...props.statusDurations,
  ].sort((a: StatusDuration, b: StatusDuration) => {
    if (a.isDowntime !== b.isDowntime) {
      return a.isDowntime ? -1 : 1;
    }
    return b.seconds - a.seconds;
  });

  const totalSeconds: number = sortedDurations.reduce(
    (sum: number, d: StatusDuration) => {
      return sum + d.seconds;
    },
    0,
  );

  const hasStatuses: boolean = sortedDurations.length > 0;

  const monitoringOffSeconds: number = Math.max(
    Number(props.monitoringOffSeconds) || 0,
    0,
  );

  // Nothing checked, because monitoring was off: not a day with no data.
  const isMonitoringOffDay: boolean = DayUptimeGraphUtil.isMonitoringOffDay({
    hasEvents: props.hasEvents,
    monitoringOffSeconds: monitoringOffSeconds,
  });

  // Checked for part of the day: the uptime is of that part.
  const isMonitoringOffForPart: boolean =
    props.hasEvents && monitoringOffSeconds >= MONITORING_OFF_MINIMUM_SECONDS;

  /*
   * Of the time left out, what a pause left out and what had monitoring
   * turned off (#11433): each said as what it was.
   */
  const leftOut: DayLeftOutReading = DayUptimeGraphUtil.readLeftOutTime({
    monitoringOffSeconds: monitoringOffSeconds,
    pausedSeconds: props.pausedSeconds,
    pausedBy: props.pausedBy,
  });

  const leftOutLines: Array<ReactElement> = [];

  /*
   * For how long each part lasted: under the uptime of a day with data,
   * and under the block of a day nothing was checked on when both parts
   * are there.
   */
  if (
    isMonitoringOffForPart ||
    (isMonitoringOffDay &&
      leftOut.turnedOffSeconds > 0 &&
      leftOut.pausedSeconds > 0)
  ) {
    if (leftOut.pausedSeconds > 0 && leftOut.pausedBy) {
      leftOutLines.push(
        <LeftOutLine
          key="paused"
          testId="uptime-day-paused-for"
          text={DayUptimeGraphUtil.fillLabel(
            DayUptimeGraphUtil.getPausedForLabel({
              pausedBy: leftOut.pausedBy,
              labels: labels,
            }),
            {
              duration: OneUptimeDate.secondsToFormattedFriendlyTimeString(
                leftOut.pausedSeconds,
              ),
            },
          )}
        />,
      );
    }

    if (leftOut.turnedOffSeconds > 0) {
      leftOutLines.push(
        <LeftOutLine
          key="monitoring-off"
          testId="uptime-day-monitoring-off-for"
          text={DayUptimeGraphUtil.fillLabel(labels.monitoringOffFor, {
            duration: OneUptimeDate.secondsToFormattedFriendlyTimeString(
              leftOut.turnedOffSeconds,
            ),
          })}
        />,
      );
    }
  }

  const hasBreakdown: boolean = hasStatuses || isMonitoringOffForPart;

  return (
    <>
      {/* ── Uptime ── */}
      {props.hasEvents && (
        <div
          style={{
            marginBottom: hasBreakdown || hasFollowingContent ? "12px" : "0",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "baseline",
              justifyContent: "space-between",
              marginBottom: "8px",
            }}
          >
            <span
              style={{
                fontSize: "11px",
                color: "var(--ou-text-muted, #6b7280)",
                fontWeight: 500,
              }}
            >
              {labels.uptime}
            </span>
            <div style={{ display: "flex", alignItems: "baseline" }}>
              <span
                {...getStatusTextProps(uptimeColor, {
                  fontSize: "14px",
                  fontWeight: 600,
                  fontVariantNumeric: "tabular-nums",
                  lineHeight: 1,
                  letterSpacing: "-0.03em",
                })}
              >
                {props.uptimePercent >= 100
                  ? "100"
                  : props.uptimePercent.toFixed(2)}
              </span>
              <span
                {...getStatusTextProps(uptimeColor, {
                  fontSize: "11px",
                  fontWeight: 600,
                  marginInlineStart: "1px",
                  opacity: 0.7,
                })}
              >
                %
              </span>
            </div>
          </div>
          {/* Segmented bar */}
          {totalSeconds > 0 && sortedDurations.length > 1 ? (
            <div
              style={{
                width: "100%",
                height: "4px",
                borderRadius: "100px",
                overflow: "hidden",
                display: "flex",
                gap: "1px",
                backgroundColor: "var(--ou-border-default, #e5e7eb)",
              }}
            >
              {sortedDurations.map((status: StatusDuration, index: number) => {
                const widthPercent: number =
                  (status.seconds / totalSeconds) * 100;
                if (widthPercent < 0.5) {
                  return null;
                }
                return (
                  <div
                    key={index}
                    style={{
                      width: `${widthPercent}%`,
                      height: "100%",
                      backgroundColor: status.color.toString(),
                    }}
                  />
                );
              })}
            </div>
          ) : (
            <div
              style={{
                width: "100%",
                height: "4px",
                backgroundColor: "var(--ou-border-default, #e5e7eb)",
                borderRadius: "100px",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  width: `${Math.min(props.uptimePercent, 100)}%`,
                  height: "100%",
                  backgroundColor: uptimeColor,
                  borderRadius: "100px",
                }}
              />
            </div>
          )}
        </div>
      )}

      {/*
       * ── Monitoring off (issue #7112), or paused (#11433) ──
       * A day nothing was checked on says why: a pause - by an incident
       * declared by hand, for scheduled maintenance, or both - or
       * monitoring turned off, whichever left out more of it.
       */}
      {isMonitoringOffDay && (
        <div
          data-testid={
            leftOut.isNamedPaused
              ? "uptime-day-paused"
              : "uptime-day-monitoring-off"
          }
          data-paused-by={leftOut.pausedBy || undefined}
          style={NO_READING_BLOCK_STYLE}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "center",
              marginBottom: "6px",
            }}
          >
            <PauseIcon size={18} color="var(--ou-text-subtle, #9ca3af)" />
          </div>
          <div style={NO_READING_TEXT_STYLE}>
            {leftOut.isNamedPaused && leftOut.pausedBy
              ? DayUptimeGraphUtil.getPausedOnThisDayLabel({
                  pausedBy: leftOut.pausedBy,
                  labels: labels,
                })
              : labels.monitoringOffOnThisDay}
          </div>
          {leftOutLines.length > 0 ? (
            <div
              style={{
                display: "inline-flex",
                flexDirection: "column",
                alignItems: "flex-start",
                marginTop: "8px",
              }}
            >
              {leftOutLines}
            </div>
          ) : (
            <></>
          )}
        </div>
      )}

      {/* ── No data ── */}
      {!props.hasEvents && !isMonitoringOffDay && (
        <div data-testid="uptime-day-no-data" style={NO_READING_BLOCK_STYLE}>
          <svg
            width="18"
            height="18"
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--ou-border-strong, #d1d5db)"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={{ margin: "0 auto 6px" }}
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
          <div style={NO_READING_TEXT_STYLE}>{labels.noMonitoringData}</div>
        </div>
      )}

      {/* ── Status breakdown ── */}
      {hasBreakdown && (
        <div
          style={{
            paddingBottom: hasFollowingContent ? "10px" : "0",
            marginBottom: hasFollowingContent ? "10px" : "0",
            borderBottom: hasFollowingContent
              ? "1px solid var(--ou-border-subtle, #f0f0f0)"
              : "none",
          }}
        >
          {sortedDurations.map((status: StatusDuration, index: number) => {
            const pct: number =
              totalSeconds > 0 ? (status.seconds / totalSeconds) * 100 : 0;
            return (
              <div
                key={index}
                style={{
                  display: "flex",
                  alignItems: "center",
                  padding: "4px 0",
                  gap: "8px",
                }}
              >
                {/* Color dot + label */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "6px",
                    width: "100px",
                    flexShrink: 0,
                  }}
                >
                  <span
                    style={{
                      width: "6px",
                      height: "6px",
                      borderRadius: "50%",
                      backgroundColor: status.color.toString(),
                      display: "inline-block",
                      flexShrink: 0,
                    }}
                  />
                  <span
                    style={{
                      fontSize: "12px",
                      color: "var(--ou-text-secondary, #374151)",
                      fontWeight: 500,
                      whiteSpace: "nowrap",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                    }}
                  >
                    {status.label}
                  </span>
                </div>
                {/* Mini bar */}
                <div
                  style={{
                    flex: 1,
                    height: "4px",
                    backgroundColor: "var(--ou-surface-tertiary, #f3f4f6)",
                    borderRadius: "100px",
                    overflow: "hidden",
                  }}
                >
                  <div
                    style={{
                      width: `${pct}%`,
                      height: "100%",
                      backgroundColor: status.color.toString(),
                      borderRadius: "100px",
                      opacity: 0.7,
                    }}
                  />
                </div>
                {/* Duration */}
                <span
                  style={{
                    fontSize: "11px",
                    color: status.isDowntime
                      ? "var(--ou-danger-text, #b91c1c)"
                      : "var(--ou-text-muted, #6b7280)",
                    fontWeight: status.isDowntime ? 600 : 400,
                    fontVariantNumeric: "tabular-nums",
                    whiteSpace: "nowrap",
                    flexShrink: 0,
                  }}
                >
                  {OneUptimeDate.secondsToFormattedFriendlyTimeString(
                    status.seconds,
                  )}
                </span>
              </div>
            );
          })}
          {/*
           * Time left out is in no status and out of the uptime above, as
           * the Status Timeline's legend lists it last with no share: said
           * in a line of its own each, how long it lasted - paused, and
           * why, or with monitoring off (#11433).
           */}
          {isMonitoringOffForPart && leftOutLines}
        </div>
      )}
    </>
  );
};

export default UptimeDaySummary;
