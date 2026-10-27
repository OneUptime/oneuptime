import OneUptimeDate from "../../../Types/Date";
import DayUptimeGraphUtil from "../../../Utils/Uptime/DayUptimeGraphUtil";
import UptimeBarTooltipIncident from "../../../Types/Monitor/UptimeBarTooltipIncident";
import UptimeBarTooltipMaintenance from "../../../Types/Monitor/UptimeBarTooltipMaintenance";
import { MAINTENANCE_MARK_COLOR } from "../../../Utils/StatusPage/HistoryChartBarColors";
import { getStatusTextProps } from "../../Utils/StatusColorStyle";
import MaintenanceIcon from "./MaintenanceIcon";
import MaintenanceWindow from "./MaintenanceWindow";
import UptimeDaySummary, { StatusDuration } from "./UptimeDaySummary";
import UptimeHistoryLabels, {
  DefaultUptimeHistoryLabels,
} from "../../../Types/Monitor/UptimeHistoryLabels";
import { Translator } from "../../Utils/TranslateTemplate";
import useTranslator from "../../Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * Re-exported from where it now lives so the many callers that import it from
 * here keep working. The uptime block itself moved to UptimeDaySummary, which
 * the day dialog renders too.
 */
export type { StatusDuration };

export interface ComponentProps {
  date: Date;
  uptimePercent: number;
  hasEvents: boolean;
  statusDurations: Array<StatusDuration>;
  incidents: Array<UptimeBarTooltipIncident>;
  onIncidentClick?: ((incidentId: string) => void) | undefined;
  /*
   * The day's scheduled maintenance, earliest first, listed after the
   * incidents with its window and state. Optional: a caller with none
   * draws the tooltip it always drew.
   */
  maintenanceEvents?: Array<UptimeBarTooltipMaintenance> | undefined;
  onMaintenanceClick?: ((maintenanceId: string) => void) | undefined;
  /* Defaults to English. The status page passes translated strings. */
  labels?: UptimeHistoryLabels | undefined;
  /*
   * The zone the bar's day was drawn in, so the date reads as that day. The
   * browser's own zone when absent. See DayUptimeGraphUtil.formatDayLabel.
   */
  timezone?: string | undefined;
}

const UptimeBarTooltip: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const dateStr: string = DayUptimeGraphUtil.formatDayLabel({
    date: props.date,
    timezone: props.timezone,
  });

  const hasIncidents: boolean = props.incidents.length > 0;
  const maintenanceEvents: Array<UptimeBarTooltipMaintenance> =
    props.maintenanceEvents || [];
  const hasMaintenance: boolean = maintenanceEvents.length > 0;
  const labels: UptimeHistoryLabels =
    props.labels || DefaultUptimeHistoryLabels;

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
          borderBottom: "1px solid var(--ou-border-subtle, #f0f0f0)",
        }}
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="var(--ou-text-subtle, #9ca3af)"
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
            color: "var(--ou-text-primary, #111827)",
            letterSpacing: "-0.01em",
          }}
        >
          {dateStr}
        </span>
      </div>

      <UptimeDaySummary
        uptimePercent={props.uptimePercent}
        hasEvents={props.hasEvents}
        statusDurations={props.statusDurations}
        hasFollowingContent={hasIncidents || hasMaintenance}
        labels={props.labels}
      />

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
                color: "var(--ou-text-muted, #6b7280)",
                fontWeight: 500,
                flex: 1,
              }}
            >
              {labels.incidents}
            </span>
            <span
              style={{
                fontSize: "10px",
                fontWeight: 600,
                color: "var(--ou-danger-text, #b91c1c)",
                backgroundColor:
                  "color-mix(in srgb, #ef4444 14%, var(--ou-surface-primary, #ffffff))",
                padding: "1px 7px",
                borderRadius: "9999px",
                lineHeight: "1.6",
              }}
            >
              {props.incidents.length}
            </span>
          </div>

          {props.incidents
            .slice(0, 3)
            .map((incident: UptimeBarTooltipIncident) => {
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
                    backgroundColor: "var(--ou-surface-secondary, #fafafa)",
                    borderRadius: "0 6px 6px 0",
                  }}
                  onMouseEnter={(e: React.MouseEvent<HTMLDivElement>) => {
                    if (isClickable) {
                      (
                        e.currentTarget as HTMLDivElement
                      ).style.backgroundColor =
                        "var(--ou-surface-tertiary, #f3f4f6)";
                    }
                  }}
                  onMouseLeave={(e: React.MouseEvent<HTMLDivElement>) => {
                    if (isClickable) {
                      (
                        e.currentTarget as HTMLDivElement
                      ).style.backgroundColor =
                        "var(--ou-surface-secondary, #fafafa)";
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
                        color: "var(--ou-text-primary, #111827)",
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
                          stroke="var(--ou-text-muted, #6b7280)"
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
                          color: incident.currentIncidentState.color.toString(),
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
                        color: "var(--ou-text-subtle, #b0b0b0)",
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
            })}

          {props.incidents.length > 3 && (
            <div
              style={{
                fontSize: "11px",
                color: "var(--ou-text-subtle, #9ca3af)",
                textAlign: "center",
                padding: "4px 0 0",
                fontWeight: 500,
              }}
            >
              {translator.translatePlural(
                {
                  one: "+{{count}} more incident",
                  other: "+{{count}} more incidents",
                },
                props.incidents.length - 3,
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Scheduled maintenance ── */}
      {hasMaintenance && (
        <div
          data-testid="uptime-tooltip-maintenance"
          style={
            hasIncidents
              ? {
                  marginTop: "4px",
                  paddingTop: "10px",
                  borderTop: "1px solid var(--ou-border-subtle, #f0f0f0)",
                }
              : undefined
          }
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              marginBottom: "8px",
            }}
          >
            <MaintenanceIcon size={12} />
            <span
              style={{
                fontSize: "11px",
                color: "var(--ou-text-muted, #6b7280)",
                fontWeight: 500,
                flex: 1,
              }}
            >
              {labels.scheduledMaintenance}
            </span>
            <span
              {...getStatusTextProps(MAINTENANCE_MARK_COLOR.toString(), {
                fontSize: "10px",
                fontWeight: 600,
                backgroundColor: `color-mix(in srgb, ${MAINTENANCE_MARK_COLOR.toString()} 14%, var(--ou-surface-primary, #ffffff))`,
                padding: "1px 7px",
                borderRadius: "9999px",
                lineHeight: "1.6",
              })}
            >
              {maintenanceEvents.length}
            </span>
          </div>

          {maintenanceEvents
            .slice(0, 3)
            .map((event: UptimeBarTooltipMaintenance) => {
              const isClickable: boolean = Boolean(props.onMaintenanceClick);

              /*
               * Spans laid out as blocks: the item is a button when it opens
               * the event's page, and a button holds phrasing content only.
               */
              const content: ReactElement = (
                <>
                  {/* Title row */}
                  <span
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "6px",
                    }}
                  >
                    <span
                      style={{
                        display: "block",
                        flex: 1,
                        minWidth: 0,
                        fontSize: "12px",
                        color: "var(--ou-text-primary, #111827)",
                        fontWeight: 600,
                        lineHeight: "1.3",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {event.title}
                    </span>
                    {isClickable && <ChevronIcon />}
                  </span>
                  {/* Meta row: state + window */}
                  <span
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "4px 6px",
                      flexWrap: "wrap",
                      marginTop: "4px",
                    }}
                  >
                    {event.currentState && (
                      <span
                        data-testid="uptime-tooltip-maintenance-state"
                        {...getStatusTextProps(
                          event.currentState.color.toString(),
                          {
                            fontSize: "9px",
                            fontWeight: 600,
                            backgroundColor: `color-mix(in srgb, ${event.currentState.color.toString()} 12%, var(--ou-surface-primary, #ffffff))`,
                            padding: "1px 5px",
                            borderRadius: "3px",
                            lineHeight: "1.6",
                            textTransform: "uppercase",
                            letterSpacing: "0.03em",
                          },
                        )}
                      >
                        {event.currentState.name}
                      </span>
                    )}
                    <MaintenanceWindow
                      dataTestId="uptime-tooltip-maintenance-window"
                      startsAt={event.startsAt}
                      endsAt={event.endsAt}
                      style={{
                        fontSize: "10px",
                        color: "var(--ou-text-muted, #6b7280)",
                        fontVariantNumeric: "tabular-nums",
                      }}
                    />
                  </span>
                </>
              );

              const itemStyle: React.CSSProperties = {
                display: "block",
                width: "100%",
                textAlign: "start",
                font: "inherit",
                border: "none",
                borderLeft: `3px solid ${MAINTENANCE_MARK_COLOR.toString()}`,
                padding: "6px 10px",
                marginBottom: "6px",
                cursor: isClickable ? "pointer" : "default",
                transition: "background-color 0.12s ease",
                backgroundColor: "var(--ou-surface-secondary, #fafafa)",
                borderRadius: "0 6px 6px 0",
              };

              if (!isClickable) {
                return (
                  <div
                    key={event.id}
                    data-testid="uptime-tooltip-maintenance-item"
                    style={itemStyle}
                  >
                    {content}
                  </div>
                );
              }

              return (
                <button
                  key={event.id}
                  type="button"
                  data-testid="uptime-tooltip-maintenance-item"
                  className="focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                  style={itemStyle}
                  onClick={(e: React.MouseEvent) => {
                    e.stopPropagation();
                    props.onMaintenanceClick!(event.id);
                  }}
                  onMouseEnter={(e: React.MouseEvent<HTMLButtonElement>) => {
                    e.currentTarget.style.backgroundColor =
                      "var(--ou-surface-tertiary, #f3f4f6)";
                  }}
                  onMouseLeave={(e: React.MouseEvent<HTMLButtonElement>) => {
                    e.currentTarget.style.backgroundColor =
                      "var(--ou-surface-secondary, #fafafa)";
                  }}
                >
                  {content}
                </button>
              );
            })}

          {maintenanceEvents.length > 3 && (
            <div
              style={{
                fontSize: "11px",
                color: "var(--ou-text-subtle, #9ca3af)",
                textAlign: "center",
                padding: "4px 0 0",
                fontWeight: 500,
              }}
            >
              {DayUptimeGraphUtil.fillLabel(labels.moreMaintenance, {
                total: String(maintenanceEvents.length - 3),
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

const ChevronIcon: FunctionComponent = (): ReactElement => {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      style={{ flexShrink: 0, opacity: 0.35 }}
    >
      <path
        d="M6 3l5 5-5 5"
        stroke="var(--ou-text-muted, #6b7280)"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
};

export default UptimeBarTooltip;
