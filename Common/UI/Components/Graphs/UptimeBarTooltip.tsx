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

  return (
    <div style={{ minWidth: "260px", maxWidth: "340px" }}>
      {/* Date header */}
      <div
        style={{
          paddingBottom: "8px",
          marginBottom: "8px",
          borderBottom: "1px solid #f3f4f6",
        }}
      >
        <div
          style={{
            fontWeight: 600,
            fontSize: "13px",
            color: "#111827",
          }}
        >
          {dateStr}
        </div>
      </div>

      {/* Uptime card */}
      {props.hasEvents && (
        <div
          style={{
            backgroundColor: uptimeBgColor,
            borderRadius: "8px",
            padding: "10px 12px",
            marginBottom: "10px",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "baseline",
              marginBottom: "6px",
            }}
          >
            <span
              style={{ fontSize: "11px", color: "#6b7280", fontWeight: 500 }}
            >
              Uptime
            </span>
            <span
              style={{
                fontSize: "18px",
                fontWeight: 700,
                color: uptimeColor,
                fontVariantNumeric: "tabular-nums",
                lineHeight: 1,
              }}
            >
              {props.uptimePercent.toFixed(2)}%
            </span>
          </div>
          <div
            style={{
              width: "100%",
              height: "6px",
              backgroundColor: uptimeTrackColor,
              borderRadius: "3px",
              overflow: "hidden",
            }}
          >
            <div
              style={{
                width: `${Math.min(props.uptimePercent, 100)}%`,
                height: "100%",
                backgroundColor: uptimeColor,
                borderRadius: "3px",
              }}
            />
          </div>
        </div>
      )}

      {!props.hasEvents && (
        <div
          style={{
            backgroundColor: "#f9fafb",
            borderRadius: "8px",
            padding: "12px",
            textAlign: "center",
            marginBottom: "4px",
          }}
        >
          <div style={{ fontSize: "12px", color: "#9ca3af", fontWeight: 500 }}>
            No data available for this day
          </div>
        </div>
      )}

      {/* Status breakdown */}
      {props.statusDurations.length > 0 && (
        <div
          style={{
            marginBottom: props.incidents.length > 0 ? "10px" : "0",
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
          {props.statusDurations.map(
            (status: StatusDuration, index: number) => {
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
                        boxShadow: `0 0 0 2px ${status.color.toString()}30`,
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
            },
          )}
        </div>
      )}

      {/* Incidents section */}
      {props.incidents.length > 0 && (
        <div
          style={{
            borderTop: "1px solid #f3f4f6",
            paddingTop: "10px",
          }}
        >
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
                fontWeight: 600,
                color: "#dc2626",
                backgroundColor: "#fef2f2",
                padding: "1px 8px",
                borderRadius: "9999px",
                lineHeight: "1.6",
              }}
            >
              {props.incidents.length}
            </div>
          </div>
          {props.incidents.slice(0, 3).map(
            (incident: UptimeBarTooltipIncident) => {
              return (
                <div
                  key={incident.id}
                  style={{
                    backgroundColor: "#f9fafb",
                    border: "1px solid #f3f4f6",
                    borderRadius: "8px",
                    padding: "8px 10px",
                    marginBottom: "6px",
                  }}
                >
                  <div
                    style={{
                      fontSize: "12px",
                      color: "#111827",
                      fontWeight: 600,
                      marginBottom: "4px",
                      lineHeight: "1.4",
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
                          fontWeight: 600,
                          color: incident.incidentSeverity.color.toString(),
                          backgroundColor:
                            incident.incidentSeverity.color.toString() + "15",
                          border: `1px solid ${incident.incidentSeverity.color.toString()}30`,
                          padding: "1px 8px",
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
                            "15",
                          border: `1px solid ${incident.currentIncidentState.color.toString()}30`,
                          padding: "1px 8px",
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
                color: "#9ca3af",
                textAlign: "center",
                padding: "2px 0",
                fontWeight: 500,
              }}
            >
              +{props.incidents.length - 3} more incident
              {props.incidents.length - 3 !== 1 ? "s" : ""}
            </div>
          )}
          <div
            style={{
              fontSize: "10px",
              color: "#9ca3af",
              textAlign: "center",
              marginTop: "8px",
              fontWeight: 500,
              letterSpacing: "0.02em",
            }}
          >
            Click bar to view details
          </div>
        </div>
      )}
    </div>
  );
};

export default UptimeBarTooltip;
