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
}

const UptimeBarTooltip: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const dateStr: string =
    OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(props.date, true);

  const uptimeColor: string =
    props.uptimePercent >= 99.9
      ? "#22c55e"
      : props.uptimePercent >= 99
        ? "#eab308"
        : "#ef4444";

  return (
    <div style={{ minWidth: "240px", maxWidth: "320px", padding: "4px" }}>
      {/* Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "10px",
        }}
      >
        <span
          style={{
            fontWeight: 600,
            fontSize: "13px",
            color: "#f3f4f6",
          }}
        >
          {dateStr}
        </span>
      </div>

      {/* Uptime bar */}
      {props.hasEvents && (
        <div style={{ marginBottom: "10px" }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              marginBottom: "4px",
            }}
          >
            <span style={{ fontSize: "11px", color: "#9ca3af" }}>Uptime</span>
            <span
              style={{
                fontSize: "13px",
                fontWeight: 600,
                color: uptimeColor,
              }}
            >
              {props.uptimePercent.toFixed(2)}%
            </span>
          </div>
          <div
            style={{
              width: "100%",
              height: "4px",
              backgroundColor: "#374151",
              borderRadius: "2px",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                width: `${Math.min(props.uptimePercent, 100)}%`,
                height: "100%",
                backgroundColor: uptimeColor,
                borderRadius: "2px",
                transition: "width 0.3s ease",
              }}
            />
          </div>
        </div>
      )}

      {!props.hasEvents && (
        <div
          style={{
            fontSize: "12px",
            color: "#6b7280",
            textAlign: "center",
            padding: "6px 0",
          }}
        >
          No data available for this day
        </div>
      )}

      {/* Status breakdown */}
      {props.statusDurations.length > 0 && (
        <div style={{ marginBottom: props.incidents.length > 0 ? "8px" : "0" }}>
          {props.statusDurations.map(
            (status: StatusDuration, index: number) => {
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
                    style={{ display: "flex", alignItems: "center", gap: "6px" }}
                  >
                    <span
                      style={{
                        width: "8px",
                        height: "8px",
                        borderRadius: "50%",
                        backgroundColor: status.color.toString(),
                        display: "inline-block",
                        flexShrink: 0,
                      }}
                    />
                    <span style={{ fontSize: "11px", color: "#d1d5db" }}>
                      {status.label}
                    </span>
                  </div>
                  <span
                    style={{
                      fontSize: "11px",
                      color: status.isDowntime ? "#fbbf24" : "#9ca3af",
                      fontWeight: status.isDowntime ? 500 : 400,
                      fontVariantNumeric: "tabular-nums",
                    }}
                  >
                    {OneUptimeDate.secondsToFormattedFriendlyTimeString(
                      status.seconds,
                    )}
                  </span>
                </div>
              );
            },
          )}
        </div>
      )}

      {/* Incidents section */}
      {props.incidents.length > 0 && (
        <div
          style={{
            borderTop: "1px solid #374151",
            paddingTop: "8px",
          }}
        >
          <div
            style={{
              fontSize: "11px",
              color: "#9ca3af",
              marginBottom: "6px",
              textTransform: "uppercase",
              letterSpacing: "0.05em",
              fontWeight: 500,
            }}
          >
            {props.incidents.length} Incident
            {props.incidents.length !== 1 ? "s" : ""}
          </div>
          {props.incidents.slice(0, 3).map(
            (incident: UptimeBarTooltipIncident) => {
              return (
                <div
                  key={incident.id}
                  style={{
                    backgroundColor: "rgba(255,255,255,0.05)",
                    borderRadius: "6px",
                    padding: "6px 8px",
                    marginBottom: "4px",
                  }}
                >
                  <div
                    style={{
                      fontSize: "12px",
                      color: "#e5e7eb",
                      fontWeight: 500,
                      marginBottom: "3px",
                      lineHeight: "1.3",
                    }}
                  >
                    {incident.title}
                  </div>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "6px",
                      flexWrap: "wrap",
                    }}
                  >
                    {incident.incidentSeverity && (
                      <span
                        style={{
                          fontSize: "10px",
                          fontWeight: 500,
                          color: incident.incidentSeverity.color.toString(),
                          backgroundColor:
                            incident.incidentSeverity.color.toString() + "20",
                          padding: "1px 6px",
                          borderRadius: "9999px",
                          lineHeight: "1.5",
                        }}
                      >
                        {incident.incidentSeverity.name}
                      </span>
                    )}
                    {incident.currentIncidentState && (
                      <span
                        style={{
                          fontSize: "10px",
                          fontWeight: 500,
                          color:
                            incident.currentIncidentState.color.toString(),
                          backgroundColor:
                            incident.currentIncidentState.color.toString() +
                            "20",
                          padding: "1px 6px",
                          borderRadius: "9999px",
                          lineHeight: "1.5",
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
                paddingTop: "2px",
              }}
            >
              +{props.incidents.length - 3} more
            </div>
          )}
          <div
            style={{
              fontSize: "10px",
              color: "#6b7280",
              textAlign: "center",
              marginTop: "6px",
            }}
          >
            Click bar for full details
          </div>
        </div>
      )}
    </div>
  );
};

export default UptimeBarTooltip;
