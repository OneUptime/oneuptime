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

  const uptimeColor: string =
    props.uptimePercent >= 99.9
      ? "#16a34a"
      : props.uptimePercent >= 99
        ? "#ca8a04"
        : "#dc2626";

  const uptimeBgColor: string =
    props.uptimePercent >= 99.9
      ? "#f0fdf4"
      : props.uptimePercent >= 99
        ? "#fefce8"
        : "#fef2f2";

  const uptimeTrackColor: string =
    props.uptimePercent >= 99.9
      ? "#dcfce7"
      : props.uptimePercent >= 99
        ? "#fef9c3"
        : "#fee2e2";

  // Sort: downtime statuses first so they're prominent
  const sortedDurations: Array<StatusDuration> = [
    ...props.statusDurations,
  ].sort((a: StatusDuration, b: StatusDuration) => {
    if (a.isDowntime && !b.isDowntime) {
      return -1;
    }
    if (!a.isDowntime && b.isDowntime) {
      return 1;
    }
    return b.seconds - a.seconds;
  });

  return (
    <div style={{ minWidth: "270px", maxWidth: "340px" }}>
      {/* ── Header ── */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          paddingBottom: "10px",
          marginBottom: props.hasEvents ? "0" : "8px",
          borderBottom: props.hasEvents ? "none" : "1px solid #e5e7eb",
        }}
      >
        <span style={{ fontWeight: 600, fontSize: "13px", color: "#111827" }}>
          {dateStr}
        </span>
        {props.hasEvents && props.incidents.length === 0 && (
          <span
            style={{
              fontSize: "10px",
              fontWeight: 600,
              color: uptimeColor,
              backgroundColor: uptimeBgColor,
              padding: "2px 8px",
              borderRadius: "9999px",
              lineHeight: "1.5",
            }}
          >
            {props.uptimePercent >= 100 ? "100%" : props.uptimePercent.toFixed(2) + "%"}
          </span>
        )}
      </div>

      {/* ── Uptime meter ── */}
      {props.hasEvents && (
        <div
          style={{
            backgroundColor: uptimeBgColor,
            borderRadius: "10px",
            padding: "12px 14px",
            marginBottom: sortedDurations.length > 0 || props.incidents.length > 0 ? "12px" : "0",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "baseline",
              marginBottom: "8px",
            }}
          >
            <span
              style={{
                fontSize: "11px",
                color: "#6b7280",
                fontWeight: 500,
                textTransform: "uppercase",
                letterSpacing: "0.04em",
              }}
            >
              Uptime
            </span>
            <span
              style={{
                fontSize: "20px",
                fontWeight: 700,
                color: uptimeColor,
                fontVariantNumeric: "tabular-nums",
                lineHeight: 1,
              }}
            >
              {props.uptimePercent >= 100
                ? "100"
                : props.uptimePercent.toFixed(2)}
              <span style={{ fontSize: "13px", fontWeight: 600 }}>%</span>
            </span>
          </div>
          <div
            style={{
              width: "100%",
              height: "6px",
              backgroundColor: uptimeTrackColor,
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
        </div>
      )}

      {/* ── No data ── */}
      {!props.hasEvents && (
        <div
          style={{
            backgroundColor: "#f9fafb",
            borderRadius: "10px",
            padding: "16px",
            textAlign: "center",
          }}
        >
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
      {sortedDurations.length > 0 && (
        <div
          style={{
            marginBottom: props.incidents.length > 0 ? "0" : "0",
            paddingBottom: props.incidents.length > 0 ? "10px" : "0",
            borderBottom:
              props.incidents.length > 0 ? "1px solid #e5e7eb" : "none",
          }}
        >
          <div
            style={{
              fontSize: "10px",
              color: "#9ca3af",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              fontWeight: 600,
              marginBottom: "6px",
            }}
          >
            Status Breakdown
          </div>
          {sortedDurations.map((status: StatusDuration, index: number) => {
            return (
              <div
                key={index}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  padding: "4px 0",
                }}
              >
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "8px",
                  }}
                >
                  <span
                    style={{
                      width: "8px",
                      height: "8px",
                      borderRadius: "50%",
                      backgroundColor: status.color.toString(),
                      display: "inline-block",
                      flexShrink: 0,
                      boxShadow: `0 0 0 2px ${status.color.toString()}25`,
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
                </div>
                <span
                  style={{
                    fontSize: "12px",
                    color: status.isDowntime ? "#dc2626" : "#6b7280",
                    fontWeight: status.isDowntime ? 600 : 400,
                    fontVariantNumeric: "tabular-nums",
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
      {props.incidents.length > 0 && (
        <div style={{ paddingTop: "10px" }}>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              marginBottom: "8px",
            }}
          >
            <div
              style={{
                fontSize: "10px",
                color: "#9ca3af",
                textTransform: "uppercase",
                letterSpacing: "0.06em",
                fontWeight: 600,
              }}
            >
              Incidents
            </div>
            <div
              style={{
                fontSize: "10px",
                fontWeight: 700,
                color: "#dc2626",
                backgroundColor: "#fef2f2",
                padding: "1px 8px",
                borderRadius: "9999px",
                lineHeight: "1.6",
                minWidth: "20px",
                textAlign: "center",
              }}
            >
              {props.incidents.length}
            </div>
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
                    backgroundColor: "#f9fafb",
                    border: "1px solid #e5e7eb",
                    borderRadius: "8px",
                    padding: "8px 10px",
                    marginBottom: "6px",
                    cursor: isClickable ? "pointer" : "default",
                    transition: "all 0.15s ease",
                  }}
                  onMouseEnter={(e: React.MouseEvent<HTMLDivElement>) => {
                    if (isClickable) {
                      (e.currentTarget as HTMLDivElement).style.backgroundColor =
                        "#f3f4f6";
                      (e.currentTarget as HTMLDivElement).style.borderColor =
                        "#d1d5db";
                    }
                  }}
                  onMouseLeave={(e: React.MouseEvent<HTMLDivElement>) => {
                    if (isClickable) {
                      (e.currentTarget as HTMLDivElement).style.backgroundColor =
                        "#f9fafb";
                      (e.currentTarget as HTMLDivElement).style.borderColor =
                        "#e5e7eb";
                    }
                  }}
                >
                  <div
                    style={{
                      display: "flex",
                      alignItems: "flex-start",
                      justifyContent: "space-between",
                      gap: "8px",
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div
                        style={{
                          fontSize: "12px",
                          color: isClickable ? "#2563eb" : "#111827",
                          fontWeight: 600,
                          lineHeight: "1.4",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {incident.title}
                      </div>
                      <div
                        style={{
                          fontSize: "10px",
                          color: "#9ca3af",
                          marginTop: "2px",
                        }}
                      >
                        {OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
                          incident.declaredAt,
                          false,
                        )}
                      </div>
                    </div>
                    {isClickable && (
                      <svg
                        width="14"
                        height="14"
                        viewBox="0 0 16 16"
                        fill="none"
                        style={{ flexShrink: 0, marginTop: "2px" }}
                      >
                        <path
                          d="M6 3l5 5-5 5"
                          stroke="#9ca3af"
                          strokeWidth="1.5"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    )}
                  </div>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "5px",
                      flexWrap: "wrap",
                      marginTop: "5px",
                    }}
                  >
                    {incident.incidentSeverity && (
                      <span
                        style={{
                          fontSize: "10px",
                          fontWeight: 600,
                          color: incident.incidentSeverity.color.toString(),
                          backgroundColor:
                            incident.incidentSeverity.color.toString() + "12",
                          border: `1px solid ${incident.incidentSeverity.color.toString()}25`,
                          padding: "1px 7px",
                          borderRadius: "9999px",
                          lineHeight: "1.6",
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
                            "12",
                          border: `1px solid ${incident.currentIncidentState.color.toString()}25`,
                          padding: "1px 7px",
                          borderRadius: "9999px",
                          lineHeight: "1.6",
                        }}
                      >
                        {incident.currentIncidentState.name}
                      </span>
                    )}
                  </div>
                </div>
              );
            },
          )}

          {props.incidents.length > 3 && (
            <div
              style={{
                fontSize: "11px",
                color: "#6b7280",
                textAlign: "center",
                padding: "4px 0 2px",
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
