import { Gray500 } from "Common/Types/BrandColors";
import Statusbubble from "Common/UI/Components/StatusBubble/StatusBubble";
import MonitorGroupMonitoringCopy, {
  MONITOR_GROUP_DISABLED_STATUS_TEST_ID,
} from "./MonitorGroupMonitoringCopy";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * The status of a monitor group whose monitors all have monitoring turned
 * off (issue #6401): "Disabled", in grey and still, as the Monitors list
 * shows a monitor with monitoring off. Nothing checks those monitors, so
 * the worst status among them is only what their last checks saw. The
 * group's Overview and the list of groups both draw it in place of that
 * status.
 */
const MonitorGroupDisabledStatus: FunctionComponent = (): ReactElement => {
  return (
    <div data-testid={MONITOR_GROUP_DISABLED_STATUS_TEST_ID}>
      <Statusbubble
        text={MonitorGroupMonitoringCopy.disabledStatus}
        color={Gray500}
        shouldAnimate={false}
      />
    </div>
  );
};

export default MonitorGroupDisabledStatus;
