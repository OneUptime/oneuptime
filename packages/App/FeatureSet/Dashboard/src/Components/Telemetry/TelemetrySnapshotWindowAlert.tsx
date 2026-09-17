import ColorSwatch from "Common/Types/ColorSwatch";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import HeaderAlert, {
  HeaderAlertType,
} from "Common/UI/Components/HeaderAlert/HeaderAlert";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  // The window the monitor evaluated over. Renders nothing when absent.
  window: InBetween<Date> | null | undefined;
}

/*
 * Clock badge naming the telemetry snapshot an incident or alert preview is
 * showing. Every preview on those pages is scoped to the window the monitor
 * evaluated over, not to "now" — without a badge saying so, a card of logs
 * from last Tuesday is indistinguishable from a live tail, which is exactly
 * the confusion this exists to remove.
 */
const TelemetrySnapshotWindowAlert: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  if (!props.window) {
    return <></>;
  }

  return (
    <HeaderAlert
      icon={IconProp.Clock}
      onClick={() => {
        // Informational only — there is nowhere to navigate to.
      }}
      title={OneUptimeDate.getInBetweenDatesAsFormattedString(props.window)}
      alertType={HeaderAlertType.INFO}
      colorSwatch={ColorSwatch.Blue}
    />
  );
};

export default TelemetrySnapshotWindowAlert;
