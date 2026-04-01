import Modal, { ModalWidth } from "../Modal/Modal";
import OneUptimeDate from "../../../Types/Date";
import UptimeBarTooltipIncident from "../../../Types/Monitor/UptimeBarTooltipIncident";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  date: Date;
  incidents: Array<UptimeBarTooltipIncident>;
  onClose: () => void;
}

const UptimeBarDayModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const dateStr: string =
    OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(props.date, true);

  return (
    <Modal
      title={`Incidents on ${dateStr}`}
      onClose={props.onClose}
      modalWidth={ModalWidth.Medium}
      closeButtonText="Close"
    >
      <div>
        {props.incidents.length === 0 && (
          <div className="text-gray-500 text-sm py-4 text-center">
            No incidents on this day.
          </div>
        )}
        {props.incidents.map((incident: UptimeBarTooltipIncident) => {
          return (
            <div
              key={incident.id}
              className="border border-gray-200 rounded-lg p-4 mb-3"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="font-medium text-base text-gray-900">
                    {incident.title}
                  </div>
                  <div className="text-sm text-gray-500 mt-1">
                    Declared at{" "}
                    {OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
                      incident.declaredAt,
                      false,
                    )}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-3 mt-2">
                {incident.incidentSeverity && (
                  <span
                    className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium"
                    style={{
                      backgroundColor:
                        incident.incidentSeverity.color.toString() + "20",
                      color: incident.incidentSeverity.color.toString(),
                    }}
                  >
                    {incident.incidentSeverity.name}
                  </span>
                )}
                {incident.currentIncidentState && (
                  <span
                    className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium"
                    style={{
                      backgroundColor:
                        incident.currentIncidentState.color.toString() + "20",
                      color: incident.currentIncidentState.color.toString(),
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
