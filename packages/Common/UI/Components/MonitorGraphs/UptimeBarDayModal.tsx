import Modal, { ModalWidth } from "../Modal/Modal";
import UptimeDaySummary, { StatusDuration } from "../Graphs/UptimeDaySummary";
import IncidentIcon from "../Graphs/IncidentIcon";
import MaintenanceIcon from "../Graphs/MaintenanceIcon";
import MaintenanceWindow from "../Graphs/MaintenanceWindow";
import {
  getUptimeDayToneProps,
  INCIDENT_MARK_COLOR,
  UPTIME_DAY_COUNT_STYLE,
} from "../Graphs/UptimeDayEventTone";
import { ICON_MIRRORED_RIGHT_TO_LEFT_CLASS_NAME } from "../Icon/Icon";
import Pill from "../Pill/Pill";
import Color from "../../../Types/Color";
import OneUptimeDate from "../../../Types/Date";
import DayUptimeGraphUtil from "../../../Utils/Uptime/DayUptimeGraphUtil";
import { MAINTENANCE_MARK_COLOR } from "../../../Utils/StatusPage/HistoryChartBarColors";
import UptimeBarTooltipIncident from "../../../Types/Monitor/UptimeBarTooltipIncident";
import UptimeBarTooltipMaintenance from "../../../Types/Monitor/UptimeBarTooltipMaintenance";
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
      /*
       * A dialog to read. Its events open their own pages, and a dialog that
       * started on the first of them - the Enter that opened it, held a
       * moment too long - would leave the page for it: it starts on itself,
       * and Tab reaches the events.
       */
      isInitialFocusOnDialog={true}
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

        {hasIncidents && (
          <div data-testid="uptime-day-incidents">
            {/*
             * A dialog of incidents alone says how many in its subtitle, as
             * it always has; beside maintenance, each kind gets its heading.
             */}
            {hasMaintenance && (
              <DaySectionHeading
                title={labels.incidents}
                count={props.incidents.length}
                icon={<IncidentIcon size={14} />}
                color={INCIDENT_MARK_COLOR}
              />
            )}

            {props.incidents.map((incident: UptimeBarTooltipIncident) => {
              const pills: Array<DayEventPill> = [];

              if (incident.incidentSeverity) {
                pills.push({
                  name: incident.incidentSeverity.name,
                  color: incident.incidentSeverity.color,
                });
              }

              if (incident.currentIncidentState) {
                pills.push({
                  name: incident.currentIncidentState.name,
                  color: incident.currentIncidentState.color,
                });
              }

              return (
                <DayEventCard
                  key={incident.id}
                  dataTestId="uptime-day-incident-item"
                  title={incident.title}
                  detail={
                    <span
                      style={{
                        display: "block",
                        fontSize: "12px",
                        color: "var(--ou-text-muted, #6b7280)",
                      }}
                    >
                      {labels.declared}{" "}
                      {OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
                        incident.declaredAt,
                        false,
                      )}
                    </span>
                  }
                  pills={pills}
                  onClick={
                    props.onIncidentClick
                      ? () => {
                          props.onIncidentClick!(incident.id);
                        }
                      : undefined
                  }
                />
              );
            })}
          </div>
        )}

        {hasMaintenance && (
          <div
            data-testid="uptime-day-maintenance"
            style={{ marginTop: hasIncidents ? "16px" : "0" }}
          >
            <DaySectionHeading
              title={labels.scheduledMaintenance}
              count={maintenanceEvents.length}
              icon={<MaintenanceIcon size={14} />}
              color={MAINTENANCE_MARK_COLOR}
            />

            {maintenanceEvents.map((event: UptimeBarTooltipMaintenance) => {
              return (
                <DayEventCard
                  key={event.id}
                  dataTestId="uptime-day-maintenance-item"
                  title={event.title}
                  detail={
                    <MaintenanceWindow
                      dataTestId="uptime-day-maintenance-window"
                      startsAt={event.startsAt}
                      endsAt={event.endsAt}
                      style={{
                        display: "block",
                        fontSize: "12px",
                        color: "var(--ou-text-muted, #6b7280)",
                        fontVariantNumeric: "tabular-nums",
                      }}
                    />
                  }
                  pills={
                    event.currentState
                      ? [
                          {
                            name: event.currentState.name,
                            color: event.currentState.color,
                            dataTestId: "uptime-day-maintenance-state",
                          },
                        ]
                      : []
                  }
                  onClick={
                    props.onMaintenanceClick
                      ? () => {
                          props.onMaintenanceClick!(event.id);
                        }
                      : undefined
                  }
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
 * "Scheduled maintenance" - with its icon and how many there are. Drawn
 * only when the day has maintenance: a dialog of incidents alone says how
 * many in its subtitle, as it always has.
 */
const DaySectionHeading: FunctionComponent<{
  title: string;
  count: number;
  icon: ReactElement;
  color: Color;
}> = (props: {
  title: string;
  count: number;
  icon: ReactElement;
  color: Color;
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
      {props.icon}
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
        data-testid="uptime-day-section-count"
        {...getUptimeDayToneProps(props.color, {
          ...UPTIME_DAY_COUNT_STYLE,
          fontSize: "11px",
          padding: "1px 8px",
        })}
      >
        {props.count}
      </span>
    </div>
  );
};

// The keyboard's ring round an event that opens its page.
export const DAY_EVENT_CARD_FOCUS_CLASS_NAME: string =
  "focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-500";

// A severity or a state, drawn as the product's Pill.
interface DayEventPill {
  name: string;
  color: Color;
  dataTestId?: string | undefined;
}

/*
 * One event of the day, an incident or a scheduled maintenance event, in
 * the same card: its title, when it happened - an incident's declaration, an
 * event's planned window on the reader's clock - and its severity and
 * state. A button that opens the event's own page when the caller can open
 * one, so a keyboard reaches every event the dialog lists, incidents too.
 */
const DayEventCard: FunctionComponent<{
  title: string;
  detail: ReactElement;
  pills: Array<DayEventPill>;
  onClick?: (() => void) | undefined;
  dataTestId: string;
}> = (props: {
  title: string;
  detail: ReactElement;
  pills: Array<DayEventPill>;
  onClick?: (() => void) | undefined;
  dataTestId: string;
}): ReactElement => {
  const isClickable: boolean = Boolean(props.onClick);

  const style: React.CSSProperties = {
    display: "block",
    width: "100%",
    textAlign: "start",
    font: "inherit",
    border: "1px solid var(--ou-border-default, #e5e7eb)",
    borderRadius: "10px",
    padding: "14px 16px",
    marginBottom: "10px",
    cursor: isClickable ? "pointer" : "default",
    transition:
      "background-color 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease",
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
            {props.title}
          </span>
          {props.detail}
        </span>
        {isClickable && (
          <svg
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            aria-hidden="true"
            data-testid="uptime-day-event-chevron"
            // It points along the line: a right-to-left page turns it round.
            className={ICON_MIRRORED_RIGHT_TO_LEFT_CLASS_NAME}
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
      {props.pills.length > 0 && (
        <span
          style={{
            display: "flex",
            alignItems: "center",
            gap: "6px",
            flexWrap: "wrap",
            marginTop: "8px",
          }}
        >
          {props.pills.map((pill: DayEventPill, index: number) => {
            return (
              <span
                key={index}
                data-testid={pill.dataTestId}
                style={{ display: "inline-flex", maxWidth: "100%" }}
              >
                <Pill
                  text={pill.name}
                  color={pill.color}
                  style={{ fontSize: "12px" }}
                />
              </span>
            );
          })}
        </span>
      )}
    </>
  );

  if (!isClickable) {
    return (
      <div data-testid={props.dataTestId} style={style}>
        {content}
      </div>
    );
  }

  return (
    <button
      type="button"
      data-testid={props.dataTestId}
      /*
       * The product's focus ring, not the browser's black outline. An
       * outline rather than a box-shadow ring: the hover lifts the card with
       * a shadow of its own, written inline, which would hide a ring once
       * the pointer had passed over it.
       */
      className={DAY_EVENT_CARD_FOCUS_CLASS_NAME}
      style={style}
      onClick={() => {
        props.onClick!();
      }}
      onMouseEnter={(e: React.MouseEvent<HTMLButtonElement>) => {
        e.currentTarget.style.backgroundColor =
          "var(--ou-surface-secondary, #f9fafb)";
        e.currentTarget.style.borderColor = "var(--ou-border-strong, #d1d5db)";
        e.currentTarget.style.boxShadow = "0 1px 3px rgba(0,0,0,0.06)";
      }}
      onMouseLeave={(e: React.MouseEvent<HTMLButtonElement>) => {
        e.currentTarget.style.backgroundColor =
          "var(--ou-surface-primary, #ffffff)";
        e.currentTarget.style.borderColor = "var(--ou-border-default, #e5e7eb)";
        e.currentTarget.style.removeProperty("box-shadow");
      }}
    >
      {content}
    </button>
  );
};

export default UptimeBarDayModal;
