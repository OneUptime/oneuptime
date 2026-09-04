import Modal, { ModalWidth } from "../Modal/Modal";
import UptimeDaySummary, { StatusDuration } from "../Graphs/UptimeDaySummary";
import OneUptimeDate from "../../../Types/Date";
import UptimeBarTooltipIncident from "../../../Types/Monitor/UptimeBarTooltipIncident";
import UptimeHistoryLabels, {
  DefaultUptimeHistoryLabels,
} from "../../../Types/Monitor/UptimeHistoryLabels";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  date: Date;
  incidents: Array<UptimeBarTooltipIncident>;
  onClose: () => void;
  onIncidentClick?: ((incidentId: string) => void) | undefined;
  /*
   * The day's reading, when the caller has it. Optional so that a caller that
   * only knows about incidents still renders; the uptime block is simply
   * absent then, which is what this dialog used to be in every case.
   */
  uptimePercent?: number | undefined;
  hasEvents?: boolean | undefined;
  statusDurations?: Array<StatusDuration> | undefined;
  /* Defaults to English. The status page passes translated strings. */
  labels?: UptimeHistoryLabels | undefined;
}

/*
 * What happened on one day of the uptime history.
 *
 * This is the only way to read a day without a mouse - the strip's tooltip is
 * hover-only, so on a phone (which is how most people open a status page
 * during an outage) and with a keyboard it was previously unreachable. It
 * therefore shows the same reading the tooltip does, not a strictly poorer
 * one: uptime, how the day was spent, and then the incidents.
 */
const UptimeBarDayModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const dateStr: string =
    OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(props.date, true);

  const labels: UptimeHistoryLabels =
    props.labels || DefaultUptimeHistoryLabels;

  /*
   * Only drawn when the caller actually measured the day. hasEvents false with
   * a summary present is a real state - a day before the monitor existed - and
   * UptimeDaySummary says so; hasEvents undefined means nobody measured, which
   * is not the same claim and must not be rendered as one.
   */
  const hasSummary: boolean = props.hasEvents !== undefined;

  let description: string | undefined = undefined;

  if (props.incidents.length === 1) {
    description = labels.oneIncidentOnThisDay;
  } else if (props.incidents.length > 1) {
    description = labels.incidentsOnThisDay.replace(
      "{{total}}",
      String(props.incidents.length),
    );
  }

  return (
    <Modal
      title={dateStr}
      description={description}
      onClose={props.onClose}
      modalWidth={ModalWidth.Medium}
      closeButtonText={labels.close}
    >
      <div>
        {hasSummary && (
          <div style={{ marginBottom: "16px" }}>
            <UptimeDaySummary
              uptimePercent={props.uptimePercent || 0}
              hasEvents={Boolean(props.hasEvents)}
              statusDurations={props.statusDurations || []}
              hasFollowingContent={true}
              labels={props.labels}
            />
          </div>
        )}

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
                backgroundColor:
                  "color-mix(in srgb, #22c55e 14%, var(--ou-surface-primary, #ffffff))",
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
                color: "var(--ou-text-primary, #111827)",
                marginBottom: "4px",
              }}
            >
              {labels.noIncidents}
            </div>
            <div
              style={{
                fontSize: "13px",
                color: "var(--ou-text-muted, #6b7280)",
              }}
            >
              {labels.noIncidentsDescription}
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
                border: "1px solid var(--ou-border-default, #e5e7eb)",
                borderRadius: "10px",
                padding: "14px 16px",
                marginBottom: "10px",
                cursor: isClickable ? "pointer" : "default",
                transition: "all 0.15s ease",
                backgroundColor: "var(--ou-surface-primary, #ffffff)",
              }}
              onMouseEnter={(e: React.MouseEvent<HTMLDivElement>) => {
                if (isClickable) {
                  (e.currentTarget as HTMLDivElement).style.backgroundColor =
                    "var(--ou-surface-secondary, #f9fafb)";
                  (e.currentTarget as HTMLDivElement).style.borderColor =
                    "var(--ou-border-strong, #d1d5db)";
                  (e.currentTarget as HTMLDivElement).style.boxShadow =
                    "0 1px 3px rgba(0,0,0,0.06)";
                }
              }}
              onMouseLeave={(e: React.MouseEvent<HTMLDivElement>) => {
                if (isClickable) {
                  (e.currentTarget as HTMLDivElement).style.backgroundColor =
                    "var(--ou-surface-primary, #ffffff)";
                  (e.currentTarget as HTMLDivElement).style.borderColor =
                    "var(--ou-border-default, #e5e7eb)";
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
                      color: isClickable
                        ? "var(--ou-link, #2563eb)"
                        : "var(--ou-text-primary, #111827)",
                      lineHeight: "1.4",
                      marginBottom: "4px",
                    }}
                  >
                    {incident.title}
                  </div>
                  <div
                    style={{
                      fontSize: "12px",
                      color: "var(--ou-text-muted, #6b7280)",
                    }}
                  >
                    {labels.declared}{" "}
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
                      stroke="var(--ou-text-subtle, #9ca3af)"
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
