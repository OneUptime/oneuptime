import Modal, { ModalWidth } from "../Modal/Modal";
import OneUptimeDate from "../../../Types/Date";
import UptimeBarTooltipIncident from "../../../Types/Monitor/UptimeBarTooltipIncident";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  date: Date;
  incidents: Array<UptimeBarTooltipIncident>;
  onClose: () => void;
  onIncidentClick?:
    | ((incidentId: string) => void)
    | undefined;
}

const UptimeBarDayModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const dateStr: string =
    OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(props.date, true);

  return (
    <Modal
      title={`Incidents - ${dateStr}`}
      description={
        props.incidents.length > 0
          ? `${props.incidents.length} incident${props.incidents.length !== 1 ? "s" : ""} reported on this day`
          : undefined
      }
      onClose={props.onClose}
      modalWidth={ModalWidth.Medium}
      closeButtonText="Close"
    >
      <div>
        {props.incidents.length === 0 && (
          <div
            style={{
              textAlign: "center",
              padding: "32px 16px",
            }}
          >
            <div
              style={{
                width: "48px",
                height: "48px",
                borderRadius: "50%",
                backgroundColor: "#f0fdf4",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                margin: "0 auto 12px",
              }}
            >
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="#16a34a"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M20 6L9 17l-5-5" />
              </svg>
            </div>
            <div
              style={{
                fontSize: "14px",
                fontWeight: 600,
                color: "#111827",
                marginBottom: "4px",
              }}
            >
              No incidents
            </div>
            <div style={{ fontSize: "13px", color: "#6b7280" }}>
              No incidents were reported on this day.
            </div>
          </div>
        )}

        {props.incidents.map((incident: UptimeBarTooltipIncident) => {
          const isClickable: boolean = Boolean(props.onIncidentClick);

          return (
            <div
              key={incident.id}
              onClick={
                isClickable
                  ? () => {
                      props.onIncidentClick!(incident.id);
                    }
                  : undefined
              }
              style={{
                border: "1px solid #e5e7eb",
                borderRadius: "10px",
                padding: "14px 16px",
                marginBottom: "10px",
                cursor: isClickable ? "pointer" : "default",
                transition: "all 0.15s ease",
                backgroundColor: "#ffffff",
              }}
              onMouseEnter={(e: React.MouseEvent<HTMLDivElement>) => {
                if (isClickable) {
                  (e.currentTarget as HTMLDivElement).style.backgroundColor =
                    "#f9fafb";
                  (e.currentTarget as HTMLDivElement).style.borderColor =
                    "#d1d5db";
                  (e.currentTarget as HTMLDivElement).style.boxShadow =
                    "0 1px 3px rgba(0,0,0,0.06)";
                }
              }}
              onMouseLeave={(e: React.MouseEvent<HTMLDivElement>) => {
                if (isClickable) {
                  (e.currentTarget as HTMLDivElement).style.backgroundColor =
                    "#ffffff";
                  (e.currentTarget as HTMLDivElement).style.borderColor =
                    "#e5e7eb";
                  (e.currentTarget as HTMLDivElement).style.boxShadow = "none";
                }
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  justifyContent: "space-between",
                  gap: "12px",
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div
                    style={{
                      fontSize: "14px",
                      fontWeight: 600,
                      color: isClickable ? "#2563eb" : "#111827",
                      lineHeight: "1.4",
                      marginBottom: "4px",
                    }}
                  >
                    {incident.title}
                  </div>
                  <div
                    style={{
                      fontSize: "12px",
                      color: "#6b7280",
                    }}
                  >
                    Declared{" "}
                    {OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
                      incident.declaredAt,
                      false,
                    )}
                  </div>
                </div>
                {isClickable && (
                  <svg
                    width="16"
                    height="16"
                    viewBox="0 0 16 16"
                    fill="none"
                    style={{ flexShrink: 0, marginTop: "3px" }}
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
                  gap: "8px",
                  flexWrap: "wrap",
                  marginTop: "8px",
                }}
              >
                {incident.incidentSeverity && (
                  <span
                    style={{
                      fontSize: "11px",
                      fontWeight: 600,
                      color: incident.incidentSeverity.color.toString(),
                      backgroundColor:
                        incident.incidentSeverity.color.toString() + "12",
                      border: `1px solid ${incident.incidentSeverity.color.toString()}25`,
                      padding: "2px 10px",
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
                      fontSize: "11px",
                      fontWeight: 600,
                      color: incident.currentIncidentState.color.toString(),
                      backgroundColor:
                        incident.currentIncidentState.color.toString() + "12",
                      border: `1px solid ${incident.currentIncidentState.color.toString()}25`,
                      padding: "2px 10px",
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
        })}
      </div>
    </Modal>
  );
};

export default UptimeBarDayModal;
