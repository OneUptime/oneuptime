import UptimeMaintenanceUtil, {
  MAINTENANCE_WINDOW_SEPARATOR,
  MaintenanceWindowText,
} from "../../../Utils/Uptime/UptimeMaintenanceUtil";
import React, { CSSProperties, FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  startsAt: Date;
  endsAt: Date;
  dataTestId?: string | undefined;
  style?: CSSProperties | undefined;
}

/*
 * A scheduled maintenance event's planned window, on the reader's clock and
 * in their language: "Oct 21, 18:00 – 20:00 CEST"
 * (UptimeMaintenanceUtil.getWindowText).
 *
 * Each end is its own <bdi>. Without that, in Persian the digits after the
 * start's month name joined its right-to-left run, the end's digits with
 * them, and on a page laid out left to right "02:00 - 04:00" drew as
 * "04:00 - 02:00": the window read backwards.
 */
const MaintenanceWindow: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const text: MaintenanceWindowText | null =
    UptimeMaintenanceUtil.getWindowText({
      startsAt: props.startsAt,
      endsAt: props.endsAt,
    });

  if (!text) {
    return <></>;
  }

  return (
    <span data-testid={props.dataTestId} style={props.style}>
      <bdi>{text.start}</bdi>
      {MAINTENANCE_WINDOW_SEPARATOR}
      <bdi>{text.end}</bdi>
    </span>
  );
};

export default MaintenanceWindow;
