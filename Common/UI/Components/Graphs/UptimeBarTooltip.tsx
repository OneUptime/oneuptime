import OneUptimeDate from "../../../Types/Date";
import Dictionary from "../../../Types/Dictionary";
import UptimeBarTooltipIncident from "../../../Types/Monitor/UptimeBarTooltipIncident";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  date: Date;
  uptimePercent: number;
  hasEvents: boolean;
  eventLabels: Dictionary<string>;
  secondsOfEvent: Dictionary<number>;
  downtimeEventStatusIds: Array<string>;
  incidents: Array<UptimeBarTooltipIncident>;
}

const UptimeBarTooltip: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const dateStr: string =
    OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(props.date, true);

  return (
    <div className="text-left text-xs" style={{ minWidth: "200px" }}>
      <div className="font-semibold text-sm mb-1">{dateStr}</div>

      {props.hasEvents && (
        <div className="mb-1">
          <span className="font-medium">
            {props.uptimePercent.toFixed(2)}% uptime
          </span>
        </div>
      )}

      {!props.hasEvents && (
        <div className="text-gray-300 mb-1">No data for this day.</div>
      )}

      {/* Status durations */}
      {Object.keys(props.secondsOfEvent).length > 0 && (
        <div className="mb-1">
          {Object.keys(props.secondsOfEvent).map((key: string) => {
            const isDowntime: boolean = props.downtimeEventStatusIds.includes(key);
            if (!isDowntime) {
              return null;
            }
            return (
              <div key={key} className="text-gray-300">
                {props.eventLabels[key]} for{" "}
                {OneUptimeDate.secondsToFormattedFriendlyTimeString(
                  props.secondsOfEvent[key] || 0,
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Incidents */}
      {props.incidents.length > 0 && (
        <div className="mt-1 border-t border-gray-600 pt-1">
          <div className="font-medium text-gray-300 mb-0.5">
            {props.incidents.length} Incident
            {props.incidents.length > 1 ? "s" : ""}:
          </div>
          {props.incidents.slice(0, 5).map(
            (incident: UptimeBarTooltipIncident) => {
              return (
                <div key={incident.id} className="mb-0.5 flex items-start">
                  {incident.incidentSeverity?.color && (
                    <span
                      className="inline-block w-2 h-2 rounded-full mt-1 mr-1 flex-shrink-0"
                      style={{
                        backgroundColor:
                          incident.incidentSeverity.color.toString(),
                      }}
                    ></span>
                  )}
                  <span className="text-gray-200">{incident.title}</span>
                </div>
              );
            },
          )}
          {props.incidents.length > 5 && (
            <div className="text-gray-400">
              +{props.incidents.length - 5} more...
            </div>
          )}
        </div>
      )}

      {props.incidents.length > 0 && (
        <div className="mt-1 text-gray-400 text-[10px]">
          Click for details
        </div>
      )}
    </div>
  );
};

export default UptimeBarTooltip;
