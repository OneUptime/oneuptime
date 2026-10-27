import { INCIDENT_MARK_COLOR } from "./UptimeDayEventTone";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  size: number;
}

/*
 * A warning triangle in the incidents' red: the heading over a day's
 * incidents in the uptime history's tooltip and dialog, as the wrench is
 * over its scheduled maintenance (MaintenanceIcon), so the two lists read
 * apart at a glance and their names line up. The dashboard's own triangle
 * (IconProp.Alert), drawn inline like the tooltip's other icons. Decorative:
 * the heading beside it says what it means.
 */
const IncidentIcon: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <svg
      width={props.size}
      height={props.size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={INCIDENT_MARK_COLOR.toString()}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      data-testid="uptime-day-incident-icon"
      style={{ flexShrink: 0 }}
    >
      <path d="M12 10.5v3.75m-9.303 3.376C1.83 19.126 2.914 21 4.645 21h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 4.88c-.866-1.501-3.032-1.501-3.898 0L2.697 17.626zM12 17.25h.007v.008H12v-.008z" />
    </svg>
  );
};

export default IncidentIcon;
