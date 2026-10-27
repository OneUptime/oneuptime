import { MAINTENANCE_MARK_COLOR } from "../../../Utils/StatusPage/HistoryChartBarColors";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  size: number;
}

/*
 * A wrench in the maintenance blue: scheduled maintenance in the uptime
 * history's tooltip and dialog, beside the band it draws on a day's bar
 * (MAINTENANCE_MARK_COLOR). The dashboard's own wrench (IconProp.Wrench),
 * drawn inline like the tooltip's other icons, so the tooltip needs nothing
 * but its own styles. Decorative: the heading beside it says what it means.
 */
const MaintenanceIcon: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <svg
      width={props.size}
      height={props.size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={MAINTENANCE_MARK_COLOR.toString()}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      data-testid="uptime-day-maintenance-icon"
      style={{ flexShrink: 0 }}
    >
      <path d="M21.75 6.75a4.5 4.5 0 01-4.884 4.484c-1.076-.091-2.264.071-2.95.904l-7.152 8.684a2.548 2.548 0 11-3.586-3.586l8.684-7.152c.833-.686.995-1.874.904-2.95a4.5 4.5 0 016.336-4.486l-3.276 3.276a3.004 3.004 0 002.25 2.25l3.276-3.276c.256.565.398 1.192.398 1.852z" />
    </svg>
  );
};

export default MaintenanceIcon;
