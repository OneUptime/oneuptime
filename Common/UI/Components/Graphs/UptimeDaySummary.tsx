import OneUptimeDate from "../../../Types/Date";
import Color from "../../../Types/Color";
import UptimeHistoryLabels, {
  DefaultUptimeHistoryLabels,
} from "../../../Types/Monitor/UptimeHistoryLabels";
import React, { FunctionComponent, ReactElement } from "react";

export interface StatusDuration {
  label: string;
  seconds: number;
  color: Color;
  isDowntime: boolean;
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
  /* Defaults to English. The status page passes translated strings. */
  labels?: UptimeHistoryLabels | undefined;
}

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

  return (
    <>
      {/* ── Uptime ── */}
      {props.hasEvents && (
        <div
          style={{
            marginBottom: hasStatuses || hasFollowingContent ? "12px" : "0",
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
                style={{
                  fontSize: "14px",
                  fontWeight: 600,
                  color: uptimeColor,
                  fontVariantNumeric: "tabular-nums",
                  lineHeight: 1,
                  letterSpacing: "-0.03em",
                }}
              >
                {props.uptimePercent >= 100
                  ? "100"
                  : props.uptimePercent.toFixed(2)}
              </span>
              <span
                style={{
                  fontSize: "11px",
                  fontWeight: 600,
                  color: uptimeColor,
                  marginLeft: "1px",
                  opacity: 0.7,
                }}
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

      {/* ── No data ── */}
      {!props.hasEvents && (
        <div
          style={{
            backgroundColor: "var(--ou-surface-secondary, #f9fafb)",
            borderRadius: "8px",
            padding: "16px",
            textAlign: "center",
          }}
        >
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
          <div
            style={{
              fontSize: "12px",
              color: "var(--ou-text-subtle, #9ca3af)",
              fontWeight: 500,
            }}
          >
            {labels.noMonitoringData}
          </div>
        </div>
      )}

      {/* ── Status breakdown ── */}
      {hasStatuses && (
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
        </div>
      )}
    </>
  );
};

export default UptimeDaySummary;
