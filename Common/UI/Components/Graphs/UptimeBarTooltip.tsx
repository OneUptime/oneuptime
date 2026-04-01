import OneUptimeDate from "../../../Types/Date";
import Color from "../../../Types/Color";
import UptimeBarTooltipIncident from "../../../Types/Monitor/UptimeBarTooltipIncident";
import React, { FunctionComponent, ReactElement } from "react";

export interface StatusDuration {
  label: string;
  seconds: number;
  color: Color;
  isDowntime: boolean;
}

export interface ComponentProps {
  date: Date;
  uptimePercent: number;
  hasEvents: boolean;
  statusDurations: Array<StatusDuration>;
  incidents: Array<UptimeBarTooltipIncident>;
  onIncidentClick?:
    | ((incidentId: string) => void)
    | undefined;
}

const UptimeBarTooltip: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const dateStr: string =
    OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(props.date, true);

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

  const hasIncidents: boolean = props.incidents.length > 0;
  const hasStatuses: boolean = sortedDurations.length > 0;

  return (
    <div
      style={{
        minWidth: "280px",
        maxWidth: "340px",
        fontFamily:
          '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      }}
    >
      {/* ── Date header ── */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
          paddingBottom: "10px",
          marginBottom: "10px",
          borderBottom: "1px solid #f0f0f0",
        }}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#9ca3af"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ flexShrink: 0 }}
        >
          <rect x="3" y="4" width="18" height="18" rx="2" ry="2" />
          <line x1="16" y1="2" x2="16" y2="6" />
          <line x1="8" y1="2" x2="8" y2="6" />
          <line x1="3" y1="10" x2="21" y2="10" />
        </svg>
        <span
          style={{
            fontWeight: 600,
            fontSize: "13px",
            color: "#111827",
            letterSpacing: "-0.01em",
          }}
        >
          {dateStr}
        </span>
      </div>

      {/* ── Uptime ── */}
      {props.hasEvents && (
        <div
          style={{
            marginBottom: hasStatuses || hasIncidents ? "12px" : "0",
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
                color: "#6b7280",
                fontWeight: 500,
              }}
            >
              Uptime
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
                backgroundColor: "#e5e7eb",
              }}
            >
              {sortedDurations.map(
                (status: StatusDuration, index: number) => {
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
                },
              )}
            </div>
          ) : (
            <div
              style={{
                width: "100%",
                height: "4px",
                backgroundColor: "#e5e7eb",
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
            backgroundColor: "#f9fafb",
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
            stroke="#d1d5db"
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
              color: "#9ca3af",
              fontWeight: 500,
            }}
          >
            No monitoring data for this day
          </div>
        </div>
      )}

      {/* ── Status breakdown ── */}
      {hasStatuses && (
        <div
          style={{
            paddingBottom: hasIncidents ? "10px" : "0",
            marginBottom: hasIncidents ? "10px" : "0",
            borderBottom: hasIncidents ? "1px solid #f0f0f0" : "none",
          }}
        >
          {sortedDurations.map((status: StatusDuration, index: number) => {
            const pct: number =
              totalSeconds > 0
                ? (status.seconds / totalSeconds) * 100
                : 0;
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
                      color: "#374151",
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
                    backgroundColor: "#f3f4f6",
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
                    color: status.isDowntime ? "#dc2626" : "#6b7280",
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

      {/* ── Incidents ── */}
      {hasIncidents && (
        <div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              marginBottom: "8px",
            }}
          >
            <span
              style={{
                fontSize: "11px",
                color: "#6b7280",
                fontWeight: 500,
                flex: 1,
              }}
            >
              Incidents
            </span>
            <span
              style={{
                fontSize: "10px",
                fontWeight: 600,
                color: "#dc2626",
                backgroundColor: "#fef2f2",
                padding: "1px 7px",
                borderRadius: "9999px",
                lineHeight: "1.6",
              }}
            >
              {props.incidents.length}
            </span>
          </div>

          {props.incidents.slice(0, 3).map(
            (incident: UptimeBarTooltipIncident) => {
              const isClickable: boolean = Boolean(props.onIncidentClick);

              return (
                <div
                  key={incident.id}
                  onClick={
                    isClickable
                      ? (e: React.MouseEvent) => {
                          e.stopPropagation();
                          props.onIncidentClick!(incident.id);
                        }
                      : undefined
                  }
                  style={{
                    borderLeft: `3px solid ${incident.incidentSeverity ? incident.incidentSeverity.color.toString() : "#dc2626"}`,
                    padding: "6px 10px",
                    marginBottom: "6px",
                    cursor: isClickable ? "pointer" : "default",
                    transition: "background-color 0.12s ease",
                    backgroundColor: "#fafafa",
                    borderRadius: "0 6px 6px 0",
                  }}
                  onMouseEnter={(e: React.MouseEvent<HTMLDivElement>) => {
                    if (isClickable) {
                      (e.currentTarget as HTMLDivElement).style.backgroundColor =
                        "#f3f4f6";
                    }
                  }}
                  onMouseLeave={(e: React.MouseEvent<HTMLDivElement>) => {
                    if (isClickable) {
                      (e.currentTarget as HTMLDivElement).style.backgroundColor =
                        "#fafafa";
                    }
                  }}
                >
                  {/* Title row */}
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "6px",
                    }}
                  >
                    <div
                      style={{
                        flex: 1,
                        minWidth: 0,
                        fontSize: "12px",
                        color: "#111827",
                        fontWeight: 600,
                        lineHeight: "1.3",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {incident.title}
                    </div>
                    {isClickable && (
                      <svg
                        width="10"
                        height="10"
                        viewBox="0 0 16 16"
                        fill="none"
                        style={{ flexShrink: 0, opacity: 0.35 }}
                      >
                        <path
                          d="M6 3l5 5-5 5"
                          stroke="#6b7280"
                          strokeWidth="1.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    )}
                  </div>
                  {/* Meta row: badges + time */}
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "4px",
                      flexWrap: "wrap",
                      marginTop: "4px",
                    }}
                  >
                    {incident.incidentSeverity && (
                      <span
                        style={{
                          fontSize: "9px",
                          fontWeight: 600,
                          color: incident.incidentSeverity.color.toString(),
                          backgroundColor:
                            incident.incidentSeverity.color.toString() + "14",
                          padding: "1px 5px",
                          borderRadius: "3px",
                          lineHeight: "1.6",
                          textTransform: "uppercase",
                          letterSpacing: "0.03em",
                        }}
                      >
                        {incident.incidentSeverity.name}
                      </span>
                    )}
                    {incident.currentIncidentState && (
                      <span
                        style={{
                          fontSize: "9px",
                          fontWeight: 600,
                          color:
                            incident.currentIncidentState.color.toString(),
                          backgroundColor:
                            incident.currentIncidentState.color.toString() +
                            "14",
                          padding: "1px 5px",
                          borderRadius: "3px",
                          lineHeight: "1.6",
                          textTransform: "uppercase",
                          letterSpacing: "0.03em",
                        }}
                      >
                        {incident.currentIncidentState.name}
                      </span>
                    )}
                    <span
                      style={{
                        fontSize: "10px",
                        color: "#b0b0b0",
                        marginLeft: "auto",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
                        incident.declaredAt,
                        false,
                      )}
                    </span>
                  </div>
                </div>
              );
            },
          )}

          {props.incidents.length > 3 && (
            <div
              style={{
                fontSize: "11px",
                color: "#9ca3af",
                textAlign: "center",
                padding: "4px 0 0",
                fontWeight: 500,
              }}
            >
              +{props.incidents.length - 3} more incident
              {props.incidents.length - 3 !== 1 ? "s" : ""}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default UptimeBarTooltip;
