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

  const uptimeBg: string = isGood
    ? "#ecfdf5"
    : isWarn
      ? "#fffbeb"
      : "#fef2f2";

  const uptimeTrack: string = isGood
    ? "#d1fae5"
    : isWarn
      ? "#fef3c7"
      : "#fecaca";

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
          justifyContent: "space-between",
          marginBottom: "12px",
        }}
      >
        <span
          style={{
            fontWeight: 600,
            fontSize: "13px",
            color: "#1f2937",
            letterSpacing: "-0.01em",
          }}
        >
          {dateStr}
        </span>
      </div>

      {/* ── Uptime meter ── */}
      {props.hasEvents && (
        <div
          style={{
            backgroundColor: uptimeBg,
            borderRadius: "10px",
            padding: "10px 12px",
            marginBottom: hasStatuses || hasIncidents ? "12px" : "0",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: "8px",
            }}
          >
            <span
              style={{
                fontSize: "11px",
                color: "#6b7280",
                fontWeight: 600,
                textTransform: "uppercase",
                letterSpacing: "0.05em",
              }}
            >
              Uptime
            </span>
            <span
              style={{
                fontSize: "22px",
                fontWeight: 700,
                color: uptimeColor,
                fontVariantNumeric: "tabular-nums",
                lineHeight: 1,
                letterSpacing: "-0.02em",
              }}
            >
              {props.uptimePercent >= 100
                ? "100"
                : props.uptimePercent.toFixed(2)}
              <span
                style={{
                  fontSize: "12px",
                  fontWeight: 600,
                  marginLeft: "1px",
                  opacity: 0.8,
                }}
              >
                %
              </span>
            </span>
          </div>
          {/* Segmented bar showing all statuses proportionally */}
          {totalSeconds > 0 && sortedDurations.length > 1 ? (
            <div
              style={{
                width: "100%",
                height: "6px",
                borderRadius: "100px",
                overflow: "hidden",
                display: "flex",
                gap: "1px",
                backgroundColor: uptimeTrack,
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
                        borderRadius:
                          index === 0
                            ? "100px 0 0 100px"
                            : index === sortedDurations.length - 1
                              ? "0 100px 100px 0"
                              : "0",
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
                height: "6px",
                backgroundColor: uptimeTrack,
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
            borderRadius: "10px",
            padding: "14px 16px",
            textAlign: "center",
          }}
        >
          <svg
            width="20"
            height="20"
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
            marginBottom: hasIncidents ? "2px" : "0",
            borderBottom: hasIncidents ? "1px solid #f3f4f6" : "none",
          }}
        >
          <div
            style={{
              fontSize: "10px",
              color: "#9ca3af",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              fontWeight: 600,
              marginBottom: "4px",
            }}
          >
            Status Breakdown
          </div>
          {sortedDurations.map((status: StatusDuration, index: number) => {
            const pct: string =
              totalSeconds > 0
                ? ((status.seconds / totalSeconds) * 100).toFixed(1)
                : "0";
            return (
              <div
                key={index}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "3px 0",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "7px",
                    flex: 1,
                    minWidth: 0,
                  }}
                >
                  <span
                    style={{
                      width: "7px",
                      height: "7px",
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
                    }}
                  >
                    {status.label}
                  </span>
                  <span
                    style={{
                      fontSize: "10px",
                      color: "#d1d5db",
                      fontWeight: 400,
                    }}
                  >
                    {pct}%
                  </span>
                </div>
                <span
                  style={{
                    fontSize: "11px",
                    color: status.isDowntime ? "#dc2626" : "#6b7280",
                    fontWeight: status.isDowntime ? 600 : 400,
                    fontVariantNumeric: "tabular-nums",
                    whiteSpace: "nowrap",
                    marginLeft: "12px",
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
        <div style={{ paddingTop: "10px" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              marginBottom: "8px",
            }}
          >
            {/* small warning triangle icon */}
            <svg
              width="12"
              height="12"
              viewBox="0 0 24 24"
              fill="#dc2626"
              style={{ flexShrink: 0, opacity: 0.8 }}
            >
              <path d="M12 2L1 21h22L12 2zm0 4l7.53 13H4.47L12 6zm-1 5v4h2v-4h-2zm0 6v2h2v-2h-2z" />
            </svg>
            <span
              style={{
                fontSize: "10px",
                color: "#9ca3af",
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                fontWeight: 600,
                flex: 1,
              }}
            >
              Incidents
            </span>
            <span
              style={{
                fontSize: "10px",
                fontWeight: 700,
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
                    border: "1px solid #f3f4f6",
                    borderRadius: "8px",
                    padding: "7px 10px",
                    marginBottom: "5px",
                    cursor: isClickable ? "pointer" : "default",
                    transition: "all 0.12s ease",
                    backgroundColor: "#ffffff",
                  }}
                  onMouseEnter={(e: React.MouseEvent<HTMLDivElement>) => {
                    if (isClickable) {
                      const el: HTMLDivElement =
                        e.currentTarget as HTMLDivElement;
                      el.style.backgroundColor = "#f9fafb";
                      el.style.borderColor = "#e5e7eb";
                    }
                  }}
                  onMouseLeave={(e: React.MouseEvent<HTMLDivElement>) => {
                    if (isClickable) {
                      const el: HTMLDivElement =
                        e.currentTarget as HTMLDivElement;
                      el.style.backgroundColor = "#ffffff";
                      el.style.borderColor = "#f3f4f6";
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
                        color: isClickable ? "#2563eb" : "#111827",
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
                        width="12"
                        height="12"
                        viewBox="0 0 16 16"
                        fill="none"
                        style={{ flexShrink: 0, opacity: 0.4 }}
                      >
                        <path
                          d="M6 3l5 5-5 5"
                          stroke="currentColor"
                          strokeWidth="1.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    )}
                  </div>
                  {/* Meta row: badges */}
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
                          fontSize: "10px",
                          fontWeight: 600,
                          color: incident.incidentSeverity.color.toString(),
                          backgroundColor:
                            incident.incidentSeverity.color.toString() + "10",
                          padding: "0px 6px",
                          borderRadius: "4px",
                          lineHeight: "1.7",
                        }}
                      >
                        {incident.incidentSeverity.name}
                      </span>
                    )}
                    {incident.currentIncidentState && (
                      <span
                        style={{
                          fontSize: "10px",
                          fontWeight: 600,
                          color:
                            incident.currentIncidentState.color.toString(),
                          backgroundColor:
                            incident.currentIncidentState.color.toString() +
                            "10",
                          padding: "0px 6px",
                          borderRadius: "4px",
                          lineHeight: "1.7",
                        }}
                      >
                        {incident.currentIncidentState.name}
                      </span>
                    )}
                    <span
                      style={{
                        fontSize: "10px",
                        color: "#c0c0c0",
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
                padding: "3px 0 0",
                fontWeight: 500,
              }}
            >
              +{props.incidents.length - 3} more
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default UptimeBarTooltip;
