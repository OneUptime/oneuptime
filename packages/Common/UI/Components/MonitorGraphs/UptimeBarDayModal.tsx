import Modal, { ModalWidth } from "../Modal/Modal";
import UptimeDaySummary, { StatusDuration } from "../Graphs/UptimeDaySummary";
import MaintenanceIcon from "../Graphs/MaintenanceIcon";
import OneUptimeDate from "../../../Types/Date";
import DayUptimeGraphUtil from "../../../Utils/Uptime/DayUptimeGraphUtil";
import UptimeMaintenanceUtil from "../../../Utils/Uptime/UptimeMaintenanceUtil";
import { MAINTENANCE_MARK_COLOR } from "../../../Utils/StatusPage/HistoryChartBarColors";
import UptimeBarTooltipIncident from "../../../Types/Monitor/UptimeBarTooltipIncident";
import UptimeBarTooltipMaintenance from "../../../Types/Monitor/UptimeBarTooltipMaintenance";
import UptimeHistoryLabels, {
  DefaultUptimeHistoryLabels,
} from "../../../Types/Monitor/UptimeHistoryLabels";
import { getStatusTextProps } from "../../Utils/StatusColorStyle";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  date: Date;
  incidents: Array<UptimeBarTooltipIncident>;
  onClose: () => void;
  onIncidentClick?: ((incidentId: string) => void) | undefined;
  /*
   * The day's scheduled maintenance, earliest first, as the tooltip lists
   * it: each event's title, window and state, opening the event's page on
   * click when onMaintenanceClick is given. Optional: a caller with none
   * gets the dialog it always got.
   */
  maintenanceEvents?: Array<UptimeBarTooltipMaintenance> | undefined;
  onMaintenanceClick?: ((maintenanceId: string) => void) | undefined;
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
  /*
   * The zone the day was drawn in, so the dialog names the same day as the
   * bar that opened it. The browser's own zone when absent.
   */
  timezone?: string | undefined;
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
  const dateStr: string = DayUptimeGraphUtil.formatDayLabel({
    date: props.date,
    timezone: props.timezone,
  });

  const labels: UptimeHistoryLabels =
    props.labels || DefaultUptimeHistoryLabels;

  /*
   * Only drawn when the caller actually measured the day. hasEvents false with
   * a summary present is a real state - a day before the monitor existed - and
   * UptimeDaySummary says so; hasEvents undefined means nobody measured, which
   * is not the same claim and must not be rendered as one.
   */
  const hasSummary: boolean = props.hasEvents !== undefined;

  const maintenanceEvents: Array<UptimeBarTooltipMaintenance> =
    props.maintenanceEvents || [];
  const hasMaintenance: boolean = maintenanceEvents.length > 0;
  const hasIncidents: boolean = props.incidents.length > 0;

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

        {/*
         * No incidents and planned work: the work is the day's story, so the
         * all-clear is one quiet line above it rather than the big empty
         * state, which would read as "nothing happened".
         */}
        {!hasIncidents && hasMaintenance && (
          <div
            data-testid="uptime-day-no-incidents-line"
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              fontSize: "13px",
              color: "var(--ou-text-muted, #6b7280)",
              marginBottom: "16px",
            }}
          >
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#16a34a"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
              style={{ flexShrink: 0 }}
            >
              <path d="M20 6L9 17l-5-5" />
            </svg>
            {labels.noIncidentsDescription}
          </div>
        )}

        {hasIncidents && hasMaintenance && (
          <DaySectionHeading
            title={labels.incidents}
            count={props.incidents.length}
          />
        )}

        {!hasIncidents && !hasMaintenance && (
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

        {hasMaintenance && (
          <div
            data-testid="uptime-day-maintenance"
            style={{ marginTop: hasIncidents ? "16px" : "0" }}
          >
            <DaySectionHeading
              title={labels.scheduledMaintenance}
              count={maintenanceEvents.length}
              isMaintenance={true}
            />

            {maintenanceEvents.map((event: UptimeBarTooltipMaintenance) => {
              return (
                <MaintenanceCard
                  key={event.id}
                  event={event}
                  onClick={props.onMaintenanceClick}
                />
              );
            })}
          </div>
        )}
      </div>
    </Modal>
  );
};

/*
 * The heading over one kind of event in the dialog - "Incidents",
 * "Scheduled maintenance" - with how many there are. Drawn only when the day
 * has maintenance: a dialog of incidents alone says how many in its
 * subtitle, as it always has.
 */
const DaySectionHeading: FunctionComponent<{
  title: string;
  count: number;
  isMaintenance?: boolean | undefined;
}> = (props: {
  title: string;
  count: number;
  isMaintenance?: boolean | undefined;
}): ReactElement => {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: "8px",
        marginBottom: "10px",
      }}
    >
      {props.isMaintenance ? <MaintenanceIcon size={14} /> : <></>}
      {/* Under the dialog's own title, an h3. */}
      <h4
        style={{
          margin: 0,
          fontSize: "13px",
          fontWeight: 600,
          color: "var(--ou-text-secondary, #374151)",
          flex: 1,
        }}
      >
        {props.title}
      </h4>
      <span
        {...getStatusTextProps(
          props.isMaintenance ? MAINTENANCE_MARK_COLOR.toString() : "#b91c1c",
          {
            fontSize: "11px",
            fontWeight: 600,
            backgroundColor: `color-mix(in srgb, ${
              props.isMaintenance
                ? MAINTENANCE_MARK_COLOR.toString()
                : "#ef4444"
            } 14%, var(--ou-surface-primary, #ffffff))`,
            padding: "1px 8px",
            borderRadius: "9999px",
            lineHeight: "1.6",
          },
        )}
      >
        {props.count}
      </span>
    </div>
  );
};

/*
 * One scheduled maintenance event of the day: its title, its planned window
 * in the reader's own time zone, and the state it is in. A button that opens
 * the event's page when the caller can open one.
 */
const MaintenanceCard: FunctionComponent<{
  event: UptimeBarTooltipMaintenance;
  onClick?: ((maintenanceId: string) => void) | undefined;
}> = (props: {
  event: UptimeBarTooltipMaintenance;
  onClick?: ((maintenanceId: string) => void) | undefined;
}): ReactElement => {
  const isClickable: boolean = Boolean(props.onClick);
  const event: UptimeBarTooltipMaintenance = props.event;

  const style: React.CSSProperties = {
    display: "block",
    width: "100%",
    textAlign: "start",
    font: "inherit",
    border: "1px solid var(--ou-border-default, #e5e7eb)",
    borderLeft: `3px solid ${MAINTENANCE_MARK_COLOR.toString()}`,
    borderRadius: "10px",
    padding: "14px 16px",
    marginBottom: "10px",
    cursor: isClickable ? "pointer" : "default",
    transition: "background-color 0.15s ease, box-shadow 0.15s ease",
    backgroundColor: "var(--ou-surface-primary, #ffffff)",
  };

  /*
   * Spans laid out as blocks, not divs: the card is a button when it opens
   * the event's page, and a button holds phrasing content only.
   */
  const content: ReactElement = (
    <>
      <span
        style={{
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "space-between",
          gap: "12px",
        }}
      >
        <span style={{ display: "block", flex: 1, minWidth: 0 }}>
          <span
            style={{
              display: "block",
              fontSize: "14px",
              fontWeight: 600,
              color: isClickable
                ? "var(--ou-link, #2563eb)"
                : "var(--ou-text-primary, #111827)",
              lineHeight: "1.4",
              marginBottom: "4px",
              overflowWrap: "anywhere",
            }}
          >
            {event.title}
          </span>
          <span
            data-testid="uptime-day-maintenance-window"
            style={{
              display: "block",
              fontSize: "12px",
              color: "var(--ou-text-muted, #6b7280)",
              fontVariantNumeric: "tabular-nums",
            }}
          >
            {UptimeMaintenanceUtil.formatWindow({
              startsAt: event.startsAt,
              endsAt: event.endsAt,
            })}
          </span>
        </span>
        {isClickable && (
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            aria-hidden="true"
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
      </span>
      {event.currentState && (
        <span style={{ display: "block", marginTop: "8px" }}>
          <span
            data-testid="uptime-day-maintenance-state"
            {...getStatusTextProps(event.currentState.color.toString(), {
              display: "inline-block",
              fontSize: "11px",
              fontWeight: 600,
              backgroundColor: `color-mix(in srgb, ${event.currentState.color.toString()} 10%, var(--ou-surface-primary, #ffffff))`,
              border: `1px solid color-mix(in srgb, ${event.currentState.color.toString()} 22%, transparent)`,
              padding: "2px 10px",
              borderRadius: "9999px",
              lineHeight: "1.6",
            })}
          >
            {event.currentState.name}
          </span>
        </span>
      )}
    </>
  );

  if (!isClickable) {
    return (
      <div data-testid="uptime-day-maintenance-item" style={style}>
        {content}
      </div>
    );
  }

  return (
    <button
      type="button"
      data-testid="uptime-day-maintenance-item"
      style={style}
      onClick={() => {
        props.onClick!(event.id);
      }}
      onMouseEnter={(e: React.MouseEvent<HTMLButtonElement>) => {
        e.currentTarget.style.backgroundColor =
          "var(--ou-surface-secondary, #f9fafb)";
        e.currentTarget.style.boxShadow = "0 1px 3px rgba(0,0,0,0.06)";
      }}
      onMouseLeave={(e: React.MouseEvent<HTMLButtonElement>) => {
        e.currentTarget.style.backgroundColor =
          "var(--ou-surface-primary, #ffffff)";
        e.currentTarget.style.boxShadow = "none";
      }}
    >
      {content}
    </button>
  );
};

export default UptimeBarDayModal;
